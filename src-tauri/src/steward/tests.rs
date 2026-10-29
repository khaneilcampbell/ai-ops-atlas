//! Runner tests: pause, overlap, schedule claims, crash recovery, storage failure, migration.

use super::*;
use chrono::TimeZone;
use serde_json::json;
use std::sync::atomic::AtomicUsize;

/// Answers every policy-allowed read with healthy data, optionally waiting on a gate.
struct Healthy {
    calls: Arc<AtomicUsize>,
    gate: Option<Arc<tokio::sync::Notify>>,
}

#[async_trait::async_trait]
impl Source for Healthy {
    async fn get(&self, path: &str) -> Result<Reply, String> {
        assert!(policy::allowed(path));
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(g) = &self.gate {
            g.notified().await;
        }
        let suffix = path.trim_start_matches(&format!("/repos/{}", policy::REPO));
        let body = match suffix {
            "" => json!({"full_name": policy::REPO, "default_branch": "main"}),
            "/commits/main" => json!({"sha": "b".repeat(40)}),
            s if s.starts_with("/actions") => {
                json!({"workflow_runs": [{"id": 1, "workflow_id": 1, "head_branch": "main", "status": "completed", "conclusion": "success", "created_at": "2026-10-28"}]})
            }
            s if s.contains("alerts") => json!([]),
            _ => json!({"type": "file"}),
        };
        Ok(Reply {
            status: 200,
            body,
            rate_remaining: Some(4999),
        })
    }
}

struct Rig {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
    calls: Arc<AtomicUsize>,
    unlocked: Arc<AtomicBool>,
    clock: Arc<Mutex<DateTime<Local>>>,
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("steward");
    Rig {
        _dir: dir,
        path,
        calls: Arc::new(AtomicUsize::new(0)),
        unlocked: Arc::new(AtomicBool::new(true)),
        clock: Arc::new(Mutex::new(
            Local.with_ymd_and_hms(2026, 10, 28, 10, 0, 0).unwrap(),
        )),
    }
}

impl Rig {
    fn steward(&self, gate: Option<Arc<tokio::sync::Notify>>) -> Arc<Steward> {
        let (u, c) = (self.unlocked.clone(), self.clock.clone());
        Arc::new(Steward::new(
            Store::new(self.path.clone()).unwrap(),
            Box::new(Healthy {
                calls: self.calls.clone(),
                gate,
            }),
            Box::new(move || u.load(Ordering::SeqCst)),
            Box::new(move || *c.lock().unwrap()),
            Box::new(|| {}),
        ))
    }
    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
    fn next_day(&self) {
        *self.clock.lock().unwrap() = Local.with_ymd_and_hms(2026, 10, 29, 10, 0, 0).unwrap();
    }
}

#[tokio::test]
async fn schedule_is_off_by_default_and_claims_one_run_per_day_across_restarts() {
    let r = rig();
    let s = r.steward(None);
    s.run(Trigger::Schedule).await;
    assert_eq!(r.calls(), 0);
    s.configure(true, "09:00".into()).unwrap();
    s.run(Trigger::Schedule).await;
    s.run(Trigger::Schedule).await;
    assert_eq!(r.calls(), 7);
    let again = r.steward(None);
    again.run(Trigger::Schedule).await;
    assert_eq!(r.calls(), 7);
    assert_eq!(again.snapshot().history[0].trigger, Trigger::Schedule);
    r.next_day();
    again.run(Trigger::Schedule).await;
    assert_eq!(r.calls(), 14);
}

#[tokio::test]
async fn locked_keys_hold_the_scheduled_run_without_claiming_the_day() {
    let r = rig();
    r.unlocked.store(false, Ordering::SeqCst);
    let s = r.steward(None);
    s.configure(true, "09:00".into()).unwrap();
    s.run(Trigger::Schedule).await;
    assert_eq!(r.calls(), 0);
    assert_eq!(s.snapshot().waiting.as_deref(), Some(LOCKED_REASON));
    assert!(s.snapshot().schedule.last_attempt_day.is_none());
    r.unlocked.store(true, Ordering::SeqCst);
    s.run(Trigger::Schedule).await;
    assert_eq!(r.calls(), 7);
    assert!(s.snapshot().waiting.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn overlapping_runs_in_one_process_or_two_do_one_check() {
    let r = rig();
    let gate = Arc::new(tokio::sync::Notify::new());
    let a = r.steward(Some(gate.clone()));
    let other_process = r.steward(None);
    let first = tokio::spawn({
        let a = a.clone();
        async move { a.run(Trigger::Manual).await }
    });
    while r.calls() == 0 {
        tokio::task::yield_now().await;
    }
    a.run(Trigger::Manual).await;
    other_process.run(Trigger::Manual).await;
    assert!(other_process
        .snapshot()
        .error
        .unwrap()
        .contains("Another Atlas process"));
    for _ in 0..7 {
        gate.notify_one();
        tokio::task::yield_now().await;
    }
    while !first.is_finished() {
        gate.notify_one();
        tokio::task::yield_now().await;
    }
    assert_eq!(r.calls(), 7);
    assert_eq!(a.snapshot().history.len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn pause_stops_the_in_flight_run_and_blocks_new_ones() {
    let r = rig();
    let gate = Arc::new(tokio::sync::Notify::new());
    let s = r.steward(Some(gate.clone()));
    let run = tokio::spawn({
        let s = s.clone();
        async move { s.run(Trigger::Manual).await }
    });
    while r.calls() == 0 {
        tokio::task::yield_now().await;
    }
    s.pause(true);
    gate.notify_one();
    run.await.unwrap();
    assert_eq!(r.calls(), 1);
    assert_eq!(s.snapshot().history[0].status, RunStatus::Paused);
    s.run(Trigger::Manual).await;
    assert_eq!(r.calls(), 1);
    assert!(r.steward(None).snapshot().paused);
    s.pause(false);
    assert!(!s.snapshot().paused);
}

#[tokio::test]
async fn a_run_cut_off_by_a_crash_is_recorded_once_as_interrupted() {
    let r = rig();
    let store = Store::new(r.path.clone()).unwrap();
    let saved = Saved {
        active: Some(Active {
            id: "9".into(),
            started_at: "2026-10-28T09:00:00.000Z".into(),
            trigger: Trigger::Schedule,
        }),
        ..Saved::default()
    };
    store.save(&saved).unwrap();
    let s = r.steward(None);
    let snap = s.snapshot();
    assert_eq!(snap.history[0].status, RunStatus::Interrupted);
    assert!(snap.notice.unwrap().message.contains("could not finish"));
    assert_eq!(r.steward(None).snapshot().history.len(), 1);
    s.run(Trigger::Manual).await;
    assert!(s.snapshot().notice.unwrap().message.contains("recovered"));
}

#[tokio::test]
async fn an_unwritable_store_blocks_network_work() {
    let r = rig();
    let s = r.steward(None);
    // Replace the state file's spot with a directory so the atomic rename fails.
    std::fs::create_dir_all(r.path.join("state.json")).unwrap();
    s.pause(false);
    assert!(s.snapshot().storage_error.is_some());
    s.run(Trigger::Manual).await;
    assert_eq!(r.calls(), 0);
}

#[tokio::test]
async fn unchanged_runs_stay_quiet_after_a_dismissed_notice() {
    let r = rig();
    let s = r.steward(None);
    s.run(Trigger::Manual).await;
    assert!(
        s.snapshot().notice.is_none(),
        "healthy baseline needs no notice"
    );
    s.run(Trigger::Manual).await;
    assert!(s.snapshot().notice.is_none());
    let snap = s.snapshot();
    assert_eq!(snap.history.len(), 2);
    assert_eq!(snap.history[0].changes.as_deref(), Some(&[][..]));
    assert!(!snap.stale);
    assert!(
        std::fs::read_to_string(r.path.join("audit.jsonl"))
            .unwrap()
            .lines()
            .count()
            == 2
    );
}

#[tokio::test]
async fn stale_when_the_last_observation_is_older_than_a_day() {
    let r = rig();
    let s = r.steward(None);
    s.configure(true, "23:59".into()).unwrap();
    s.run(Trigger::Manual).await;
    *r.clock.lock().unwrap() = Local.with_ymd_and_hms(2026, 10, 30, 12, 0, 0).unwrap();
    assert!(s.snapshot().stale);
}

#[test]
fn imports_browser_history_once_without_foreign_links() {
    let r = rig();
    let s = r.steward(None);
    let legacy = json!({
        "paused": true,
        "schedule": {"enabled": true, "time": "11:30", "lastAttemptDay": "2026-10-28"},
        "notice": null,
        "history": [
            {"id": "1", "startedAt": "a", "finishedAt": "b", "status": "partial", "requests": 7, "checks": [{"id": "ci", "label": "CI", "state": "unknown", "detail": "d", "url": "https://github.com/x"}]},
            {"id": "2", "startedAt": "a", "finishedAt": "b", "status": "completed", "requests": 7, "checks": [{"id": "ci", "label": "CI", "state": "clear", "detail": "d", "url": "javascript:alert(1)"}]}
        ]
    });
    assert!(s.import(&legacy.to_string()).unwrap());
    let snap = s.snapshot();
    assert_eq!(snap.history.len(), 1);
    assert!(snap.paused);
    assert_eq!(snap.schedule.time, "11:30");
    assert!(
        !s.import(&legacy.to_string()).unwrap(),
        "second import is a no-op"
    );
    assert!(s.import("{nope").is_err() || !s.import("{nope").unwrap());
}
