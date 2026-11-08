//! GitHub Steward: a deterministic, read-only observer of one repository. No model calls,
//! no writes. The desktop app runs it here, in Rust, so scope, scheduling, locking and
//! history don't depend on the web view: checks continue while the window is hidden, but
//! never while Atlas is closed.

mod check;
pub mod policy;
mod schedule;
mod store;
mod types;

use check::{Control, Reply, Source};
use chrono::{DateTime, Local, SecondsFormat, Utc};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use store::{Loaded, Store};
use tauri::{Emitter, Manager};
use types::{Active, Notice, Run, RunStatus, Saved, Schedule, Trigger};

pub const LOCKED_REASON: &str = "Scheduled checks are waiting for Atlas's saved keys. Unlock them from the header to let today's check run with your read-only token.";
/// A scheduled check is a day apart; past this, the last observation is called stale.
const STALE_AFTER_HOURS: i64 = 26;

struct Inner {
    saved: Saved,
    /// Why state can't be saved or trusted right now. Runs are blocked while set.
    storage_error: Option<String>,
    /// A one-time explanation from loading, such as a recovered unreadable file.
    storage_note: Option<String>,
    running: bool,
    waiting: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    paused: bool,
    history: Vec<Run>,
    schedule: Schedule,
    notice: Option<Notice>,
    running: bool,
    storage_error: Option<String>,
    storage_note: Option<String>,
    waiting: Option<String>,
    error: Option<String>,
    last_observed_at: Option<String>,
    stale: bool,
}

struct GithubSource(crate::github::Client);

#[async_trait::async_trait]
impl Source for GithubSource {
    async fn get(&self, path: &str) -> Result<Reply, String> {
        if !policy::allowed(path) {
            return Err("Blocked by the Steward read policy".into());
        }
        let r = crate::github::get(&self.0, path, None).await?;
        Ok(Reply {
            status: r.status,
            body: r.body,
            rate_remaining: r.rate.map(|x| x.remaining),
        })
    }
}

struct RunControl<'a> {
    steward: &'a Steward,
    started: Instant,
}
impl Control for RunControl<'_> {
    fn stopped(&self) -> bool {
        self.steward.cancel.load(Ordering::SeqCst)
    }
    fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }
}

pub struct Steward {
    store: Store,
    inner: Mutex<Inner>,
    cancel: AtomicBool,
    source: Box<dyn Source>,
    unlocked: Box<dyn Fn() -> bool + Send + Sync>,
    now: Box<dyn Fn() -> DateTime<Local> + Send + Sync>,
    changed: Box<dyn Fn() + Send + Sync>,
}

fn iso(t: DateTime<Local>) -> String {
    t.with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

impl Steward {
    fn new(
        store: Store,
        source: Box<dyn Source>,
        unlocked: Box<dyn Fn() -> bool + Send + Sync>,
        now: Box<dyn Fn() -> DateTime<Local> + Send + Sync>,
        changed: Box<dyn Fn() + Send + Sync>,
    ) -> Self {
        let (mut saved, how) = store.load();
        let (mut storage_error, mut storage_note) = (None, None);
        match how {
            Loaded::Recovered(name) => storage_note = Some(format!("Saved Steward history was unreadable. It was kept as {name} in the app's data folder and a new history started.")),
            Loaded::Newer(v) => storage_error = Some(format!("Steward history was saved by a newer Atlas (format {v}). It was left untouched; checks are blocked until that version is reinstalled.")),
            Loaded::Fresh | Loaded::Ok => {}
        }
        let s = Self {
            store,
            inner: Mutex::new(Inner {
                saved: Saved::default(),
                storage_error: None,
                storage_note: None,
                running: false,
                waiting: None,
                error: None,
            }),
            cancel: AtomicBool::new(false),
            source,
            unlocked,
            now,
            changed,
        };
        // A run marked active at launch was cut off by a quit or crash: record it once.
        if storage_error.is_none() {
            if let Some(a) = saved.active.take() {
                let mut r = Run::new(a.id, a.started_at, a.trigger);
                r.finished_at = iso((s.now)());
                r.status = RunStatus::Interrupted;
                s.finish(&mut saved, r);
                if let Err(e) = s.store.save(&saved) {
                    storage_error = Some(e);
                }
            }
        }
        {
            let mut i = s.inner.lock().unwrap();
            i.saved = saved;
            i.storage_error = storage_error;
            i.storage_note = storage_note;
        }
        s
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> Snapshot {
        let i = self.lock();
        let last = i
            .saved
            .history
            .iter()
            .find(|r| r.observed())
            .map(|r| r.finished_at.clone());
        let age = last
            .as_deref()
            .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
            .map(|t| (self.now)().signed_duration_since(t).num_hours());
        Snapshot {
            paused: i.saved.paused,
            history: i.saved.history.clone(),
            schedule: i.saved.schedule.clone(),
            notice: i.saved.notice.clone(),
            running: i.running,
            storage_error: i.storage_error.clone(),
            storage_note: i.storage_note.clone(),
            waiting: i.waiting.clone(),
            error: i.error.clone(),
            stale: i.saved.schedule.enabled
                && age.map_or(true, |h| h >= STALE_AFTER_HOURS)
                && last.is_some(),
            last_observed_at: last,
        }
    }

    /// Adds `run` to history with its changes and notice, and writes its audit line.
    fn finish(&self, saved: &mut Saved, mut run: Run) {
        let previous = saved.history.iter().find(|r| r.observed());
        let mut changes = schedule::changed(previous, &run);
        saved.notice = schedule::notice(&saved.history, &run, &mut changes, saved.notice.take());
        run.changes = Some(changes);
        let _ = self.store.audit(&run);
        saved.history.insert(0, run);
        saved.history.truncate(store::MAX_HISTORY);
    }

    /// Saves under the lock; on failure keeps the change in memory and blocks further runs.
    fn persist(&self, i: &mut Inner) -> bool {
        match self.store.save(&i.saved) {
            Ok(()) => true,
            Err(e) => {
                i.storage_error = Some(format!(
                    "Steward history could not be saved, so checks are blocked: {e}"
                ));
                false
            }
        }
    }

    fn update(&self, f: impl FnOnce(&mut Inner)) {
        {
            let mut i = self.lock();
            f(&mut i);
        }
        (self.changed)();
    }

    pub fn pause(&self, paused: bool) {
        if paused {
            self.cancel.store(true, Ordering::SeqCst);
        }
        self.update(|i| {
            i.saved.paused = paused;
            self.persist(i);
        });
    }

    pub fn configure(&self, enabled: bool, time: String) -> Result<(), String> {
        if !schedule::valid_time(&time) {
            return Err("Choose a time as HH:MM.".into());
        }
        self.update(|i| {
            i.saved.schedule.enabled = enabled;
            i.saved.schedule.time = time;
            if !enabled {
                i.waiting = None;
                if i.saved
                    .active
                    .as_ref()
                    .is_some_and(|a| a.trigger == Trigger::Schedule)
                {
                    self.cancel.store(true, Ordering::SeqCst);
                }
            }
            self.persist(i);
        });
        Ok(())
    }

    pub fn dismiss(&self) {
        self.update(|i| {
            i.saved.notice = None;
            i.storage_note = None;
            self.persist(i);
        });
    }

    /// Moves history saved by the browser build, once, into an empty desktop history.
    /// Returns whether anything was imported.
    pub fn import(&self, legacy: &str) -> Result<bool, String> {
        let mut i = self.lock();
        if !i.saved.history.is_empty() || i.storage_error.is_some() {
            return Ok(false);
        }
        let mut v: serde_json::Value =
            serde_json::from_str(legacy).map_err(|_| "Unreadable legacy history")?;
        v["version"] = types::STATE_VERSION.into();
        v["active"] = serde_json::Value::Null;
        let parsed: Saved = serde_json::from_value(v).map_err(|_| "Unreadable legacy history")?;
        let parsed = store::sanitize(parsed);
        let any = !parsed.history.is_empty();
        i.saved = parsed;
        let ok = self.persist(&mut i);
        drop(i);
        (self.changed)();
        if ok {
            Ok(any)
        } else {
            Err("Could not save imported history".into())
        }
    }

    pub async fn run(&self, trigger: Trigger) {
        let now = (self.now)();
        {
            let mut i = self.lock();
            if i.running || i.saved.paused || i.storage_error.is_some() {
                return;
            }
            if trigger == Trigger::Schedule {
                if !schedule::due(&i.saved.schedule, now) {
                    return;
                }
                // Never raise Touch ID from the background, and never run anonymously on
                // schedule. The day stays unclaimed, so the check runs once the keys unlock.
                if !(self.unlocked)() {
                    if i.waiting.as_deref() != Some(LOCKED_REASON) {
                        i.waiting = Some(LOCKED_REASON.into());
                        drop(i);
                        (self.changed)();
                    }
                    return;
                }
            }
            // Reserve this process's single run slot before anything slow.
            i.running = true;
        }
        let Some(_held) = self.store.lock() else {
            self.update(|i| {
                i.running = false;
                i.error = (trigger == Trigger::Manual).then(|| {
                    "Another Atlas process is checking. Try again after it finishes.".into()
                });
            });
            return;
        };
        let id = now.timestamp_millis().to_string();
        let started_at = iso(now);
        {
            let mut i = self.lock();
            if trigger == Trigger::Schedule {
                // Claim before network access, so a crash or failure never retries the same day.
                i.saved.schedule.last_attempt_day = Some(schedule::local_day(now));
            }
            i.saved.active = Some(Active {
                id: id.clone(),
                started_at: started_at.clone(),
                trigger,
            });
            if !self.persist(&mut i) {
                i.saved.active = None;
                i.running = false;
                drop(i);
                (self.changed)();
                return;
            }
            i.waiting = None;
            i.error = None;
            self.cancel.store(false, Ordering::SeqCst);
        }
        (self.changed)();
        let control = RunControl {
            steward: self,
            started: Instant::now(),
        };
        let mut run = check::check(self.source.as_ref(), &control, id, started_at, trigger).await;
        run.finished_at = iso((self.now)());
        self.update(|i| {
            i.saved.active = None;
            let mut saved = std::mem::take(&mut i.saved);
            self.finish(&mut saved, run);
            i.saved = saved;
            i.running = false;
            self.persist(i);
        });
    }
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?.join("steward");
    let handle = app.handle().clone();
    let steward = Arc::new(Steward::new(
        Store::new(dir)?,
        Box::new(GithubSource(crate::github::Client::new())),
        Box::new(crate::secrets::unlocked),
        Box::new(Local::now),
        Box::new(move || {
            handle.emit("steward-changed", ()).ok();
        }),
    ));
    app.manage(steward.clone());
    tauri::async_runtime::spawn(async move {
        // Let the window unlock the keys first; then look once a minute. Tokio's timer
        // resumes after sleep, and a missed time catches up once the same day.
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            steward.run(Trigger::Schedule).await;
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
    Ok(())
}

type State<'a> = tauri::State<'a, Arc<Steward>>;

#[tauri::command]
pub fn steward_state(s: State<'_>) -> Snapshot {
    s.snapshot()
}

#[tauri::command]
pub async fn steward_run(s: State<'_>) -> Result<Snapshot, String> {
    let s = s.inner().clone();
    s.run(Trigger::Manual).await;
    Ok(s.snapshot())
}

#[tauri::command]
pub fn steward_pause(paused: bool, s: State<'_>) -> Snapshot {
    s.pause(paused);
    s.snapshot()
}

#[tauri::command]
pub fn steward_configure(enabled: bool, time: String, s: State<'_>) -> Result<Snapshot, String> {
    s.configure(enabled, time)?;
    Ok(s.snapshot())
}

#[tauri::command]
pub fn steward_dismiss(s: State<'_>) -> Snapshot {
    s.dismiss();
    s.snapshot()
}

#[tauri::command]
pub fn steward_import(legacy: String, s: State<'_>) -> Result<bool, String> {
    s.import(&legacy)
}

#[cfg(test)]
mod tests;
