//! Local persistence: JSON files in the app's data folder. Volumes are small (one report
//! per repository, a few hundred runs), so a database isn't needed. Writes go to a temp
//! file and are renamed into place so a crash can't leave half a file.

use super::collect::valid_repo;
use super::types::{AgentConfig, Report, Run, RunError, RunStatus};
use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_RUNS: usize = 300;

pub struct Store {
    dir: PathBuf,
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Could not save {}: {e}", path.display()))
}

impl Store {
    pub fn new(dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(dir.join("reports"))
            .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
        Ok(Self { dir })
    }

    fn read<T: serde::de::DeserializeOwned>(&self, path: &Path) -> Option<T> {
        serde_json::from_slice(&fs::read(path).ok()?).ok()
    }

    fn write<T: serde::Serialize + ?Sized>(&self, path: &Path, v: &T) -> Result<(), String> {
        write_atomic(
            path,
            &serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?,
        )
    }

    pub fn load_config(&self) -> AgentConfig {
        self.read(&self.dir.join("config.json")).unwrap_or_default()
    }

    pub fn save_config(&self, c: &AgentConfig) -> Result<(), String> {
        self.write(&self.dir.join("config.json"), c)
    }

    pub fn load_runs(&self) -> Vec<Run> {
        self.read(&self.dir.join("runs.json")).unwrap_or_default()
    }

    /// Keeps the newest runs; older ones are dropped from history (their cost stays
    /// counted only while they're within the file).
    pub fn save_runs(&self, runs: &[Run]) -> Result<(), String> {
        let start = runs.len().saturating_sub(MAX_RUNS);
        self.write(&self.dir.join("runs.json"), &runs[start..])
    }

    fn report_path(&self, repo: &str) -> Option<PathBuf> {
        valid_repo(repo).then(|| {
            self.dir
                .join("reports")
                .join(format!("{}.json", repo.replace('/', "__")))
        })
    }

    pub fn load_report(&self, repo: &str) -> Option<Report> {
        self.read(&self.report_path(repo)?)
    }

    pub fn save_report(&self, r: &Report) -> Result<(), String> {
        let path = self.report_path(&r.repo).ok_or("Invalid repository name")?;
        self.write(&path, r)
    }

    pub fn list_reports(&self) -> Vec<Report> {
        let Ok(entries) = fs::read_dir(self.dir.join("reports")) else {
            return vec![];
        };
        let mut out: Vec<Report> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| self.read(&e.path()))
            .collect();
        out.sort_by(|a, b| a.repo.cmp(&b.repo));
        out
    }
}

/// Runs still marked queued or running when the app starts were cut off by a quit or
/// crash. They are closed as interrupted so they never look like they're still going or
/// like they succeeded.
pub fn recover_interrupted(runs: &mut [Run], now: &str) -> usize {
    let mut n = 0;
    for r in runs.iter_mut().filter(|r| r.status.is_active()) {
        let was = r.status;
        r.status = RunStatus::Interrupted;
        r.finished_at = Some(now.to_string());
        r.error = Some(RunError {
            kind: "interrupted".into(),
            message: format!(
                "The app closed while this run was {}. Nothing was saved from it{}.",
                if was == RunStatus::Queued {
                    "waiting"
                } else {
                    "in progress"
                },
                if r.attempts > 0 {
                    "; Anthropic may have billed the request that was in flight"
                } else {
                    ""
                }
            ),
            retryable: true,
        });
        n += 1;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intel::types::*;

    #[test]
    fn config_round_trips_and_defaults_when_missing() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path().to_path_buf()).unwrap();
        assert_eq!(s.load_config(), AgentConfig::default());
        let c = AgentConfig {
            monthly_budget_usd: 2.5,
            ..Default::default()
        };
        s.save_config(&c).unwrap();
        assert_eq!(s.load_config().monthly_budget_usd, 2.5);
        // A corrupt file falls back to defaults rather than crashing.
        std::fs::write(d.path().join("config.json"), "{not json").unwrap();
        assert_eq!(s.load_config(), AgentConfig::default());
    }

    #[test]
    fn report_paths_are_confined() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path().to_path_buf()).unwrap();
        assert!(s.report_path("../../etc/passwd").is_none());
        assert!(s.report_path("o/r").unwrap().starts_with(d.path()));
    }
}
