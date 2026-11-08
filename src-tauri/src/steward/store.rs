//! Durable Steward state in the app's data folder: `state.json` (atomic writes),
//! `audit.jsonl` (append-only, one line per run, rotated) and `run.lock` (one run at a time
//! across Atlas processes that share this folder, such as a dev build beside the installed app).

use super::types::{Run, Saved, STATE_VERSION};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const MAX_HISTORY: usize = 30;
const AUDIT_MAX_BYTES: u64 = 512 * 1024;
/// Longer than a run can take (three-minute budget plus one request timeout), so a lock this
/// old was left by a process that died mid-run.
const STALE_LOCK: Duration = Duration::from_secs(600);

pub struct Store {
    dir: PathBuf,
}

/// How loading went, for the panel to explain.
#[derive(Debug, PartialEq)]
pub enum Loaded {
    Fresh,
    Ok,
    /// The file was unreadable; it was kept beside the new one under this name.
    Recovered(String),
    /// Written by a newer Atlas. Left untouched; runs are blocked until that version returns.
    Newer(u32),
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let mut f =
        fs::File::create(&tmp).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    f.write_all(bytes)
        .and_then(|_| f.sync_all())
        .map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Could not save {}: {e}", path.display()))
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Keeps only well-formed runs whose links stay on github.com, newest first, bounded.
pub fn sanitize(mut saved: Saved) -> Saved {
    saved.history.retain(|r| {
        !r.id.is_empty()
            && r.checks
                .iter()
                .all(|c| c.url.starts_with("https://github.com/"))
    });
    saved.history.truncate(MAX_HISTORY);
    if !super::schedule::valid_time(&saved.schedule.time) {
        saved.schedule = Default::default();
    }
    saved.version = STATE_VERSION;
    saved
}

impl Store {
    pub fn new(dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
        Ok(Self { dir })
    }

    fn state_path(&self) -> PathBuf {
        self.dir.join("state.json")
    }

    pub fn load(&self) -> (Saved, Loaded) {
        let path = self.state_path();
        let Ok(bytes) = fs::read(&path) else {
            return (Saved::default(), Loaded::Fresh);
        };
        let version = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|v| v.get("version")?.as_u64());
        if let Some(v) = version.filter(|v| *v > STATE_VERSION as u64) {
            return (Saved::default(), Loaded::Newer(v as u32));
        }
        match serde_json::from_slice::<Saved>(&bytes) {
            Ok(s) => (sanitize(s), Loaded::Ok),
            Err(_) => {
                let aside = format!("state.unreadable-{}.json", unix_now());
                let _ = fs::rename(&path, self.dir.join(&aside));
                (Saved::default(), Loaded::Recovered(aside))
            }
        }
    }

    pub fn save(&self, s: &Saved) -> Result<(), String> {
        write_atomic(
            &self.state_path(),
            &serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?,
        )
    }

    /// One line per finished run. Holds counts and labels only: no tokens, alert content or
    /// raw error text, because `Run` never carries them.
    pub fn audit(&self, run: &Run) -> Result<(), String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Line<'a> {
            run_id: &'a str,
            trigger: super::types::Trigger,
            started_at: &'a str,
            finished_at: &'a str,
            status: super::types::RunStatus,
            requests: u32,
            rate_remaining: Option<u32>,
            error_class: Option<&'a str>,
            needs_review: usize,
            not_verified: usize,
            changes: usize,
        }
        let path = self.dir.join("audit.jsonl");
        if fs::metadata(&path).is_ok_and(|m| m.len() > AUDIT_MAX_BYTES) {
            fs::rename(&path, self.dir.join("audit.1.jsonl"))
                .map_err(|e| format!("Could not rotate the audit log: {e}"))?;
        }
        let count = |s| run.checks.iter().filter(|c| c.state == s).count();
        let line = Line {
            run_id: &run.id,
            trigger: run.trigger,
            started_at: &run.started_at,
            finished_at: &run.finished_at,
            status: run.status,
            requests: run.requests,
            rate_remaining: run.rate_remaining,
            error_class: run.error_class.as_deref(),
            needs_review: count(super::types::CheckState::Attention),
            not_verified: count(super::types::CheckState::Unknown),
            changes: run.changes.as_ref().map_or(0, Vec::len),
        };
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("Could not open the audit log: {e}"))?;
        let mut bytes = serde_json::to_vec(&line).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        f.write_all(&bytes)
            .map_err(|e| format!("Could not write the audit log: {e}"))
    }

    /// Takes the cross-process run lock, or None if another live process holds it.
    pub fn lock(&self) -> Option<RunLock> {
        let path = self.dir.join("run.lock");
        for _ in 0..2 {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut f) => {
                    let _ = writeln!(f, "{} {}", std::process::id(), unix_now());
                    return Some(RunLock(path));
                }
                Err(_) => {
                    let age = fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.elapsed().ok());
                    if age.is_some_and(|a| a > STALE_LOCK) {
                        let _ = fs::remove_file(&path);
                        continue;
                    }
                    return None;
                }
            }
        }
        None
    }

    #[cfg(test)]
    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

/// Removes the lock file when the run ends, including by panic.
pub struct RunLock(PathBuf);
impl Drop for RunLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::steward::types::{Check, CheckState, Trigger};

    fn store() -> (tempfile::TempDir, Store) {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path().join("steward")).unwrap();
        (d, s)
    }

    #[test]
    fn round_trips_and_starts_fresh() {
        let (_d, s) = store();
        assert_eq!(s.load().1, Loaded::Fresh);
        let saved = Saved {
            paused: true,
            ..Saved::default()
        };
        s.save(&saved).unwrap();
        let (back, how) = s.load();
        assert_eq!(how, Loaded::Ok);
        assert!(back.paused);
        assert!(!s.dir().join("state.tmp").exists());
    }

    #[test]
    fn keeps_an_unreadable_file_aside_and_recovers() {
        let (_d, s) = store();
        fs::write(s.dir().join("state.json"), b"{not json").unwrap();
        let (saved, how) = s.load();
        assert_eq!(saved, Saved::default());
        let Loaded::Recovered(name) = how else {
            panic!("{how:?}")
        };
        assert_eq!(fs::read(s.dir().join(name)).unwrap(), b"{not json");
    }

    #[test]
    fn leaves_a_newer_versions_file_untouched() {
        let (_d, s) = store();
        fs::write(
            s.dir().join("state.json"),
            br#"{"version": 9, "future": true}"#,
        )
        .unwrap();
        assert_eq!(s.load().1, Loaded::Newer(9));
        assert!(fs::read_to_string(s.dir().join("state.json"))
            .unwrap()
            .contains("future"));
    }

    #[test]
    fn drops_runs_with_foreign_links_and_bounds_history() {
        let mut saved = Saved::default();
        for i in 0..40 {
            let mut r = Run::new(format!("{i}"), String::new(), Trigger::Manual);
            let url = if i == 0 {
                "https://evil.example/x"
            } else {
                "https://github.com/x"
            };
            r.checks.push(Check {
                id: "ci".into(),
                label: "CI".into(),
                state: CheckState::Clear,
                detail: String::new(),
                url: url.into(),
                signature: None,
            });
            saved.history.push(r);
        }
        let s = sanitize(saved);
        assert_eq!(s.history.len(), MAX_HISTORY);
        assert_eq!(s.history[0].id, "1");
    }

    #[test]
    fn audit_lines_are_structured_and_rotate() {
        let (_d, s) = store();
        let mut r = Run::new("r1".into(), "a".into(), Trigger::Schedule);
        r.error_class = Some("http_403".into());
        s.audit(&r).unwrap();
        let text = fs::read_to_string(s.dir().join("audit.jsonl")).unwrap();
        let v: serde_json::Value = serde_json::from_str(text.trim()).unwrap();
        assert_eq!(v["runId"], "r1");
        assert_eq!(v["trigger"], "schedule");
        assert_eq!(v["errorClass"], "http_403");
        fs::write(
            s.dir().join("audit.jsonl"),
            vec![b'x'; AUDIT_MAX_BYTES as usize + 1],
        )
        .unwrap();
        s.audit(&r).unwrap();
        assert!(s.dir().join("audit.1.jsonl").exists());
        assert_eq!(
            fs::read_to_string(s.dir().join("audit.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
    }

    #[test]
    fn one_lock_holder_and_release_on_drop() {
        let (_d, s) = store();
        let held = s.lock().unwrap();
        assert!(s.lock().is_none());
        drop(held);
        assert!(s.lock().is_some());
    }

    #[test]
    fn a_stale_lock_from_a_dead_process_is_taken_over() {
        let (_d, s) = store();
        let path = s.dir().join("run.lock");
        fs::write(&path, "1 0").unwrap();
        let old = SystemTime::now() - Duration::from_secs(3600);
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert!(s.lock().is_some());
    }
}
