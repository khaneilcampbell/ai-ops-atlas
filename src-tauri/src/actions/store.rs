//! The action switches (`actions.json`) and the append-only audit log (`audit.jsonl`), both
//! in the app's data folder. The audit log is never trimmed or rewritten; it is small (one
//! line per button press) and is the record of every write Atlas attempted.

use crate::intel::collect::valid_repo;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

pub const ACTION_RERUN: &str = "rerun_failed_jobs";
pub const ACTION_MERGE: &str = "merge_pull_request";
pub const ACTION_EDIT: &str = "propose_edit";
/// The same run can't be re-run again from Atlas within this window.
pub const PER_RUN_COOLDOWN_MINUTES: i64 = 10;
/// Re-runs Atlas will start across all repositories in any rolling hour.
pub const MAX_PER_HOUR: usize = 10;
/// The same pull request can't be merged again from Atlas within this window.
pub const MERGE_COOLDOWN_MINUTES: i64 = 10;
/// Merges Atlas will send across all repositories in any rolling hour.
pub const MAX_MERGES_PER_HOUR: usize = 5;
/// Edit pull requests Atlas will open across all repositories in any rolling hour.
pub const MAX_EDITS_PER_HOUR: usize = 20;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RerunSwitch {
    pub enabled: bool,
    /// Repositories (owner/name) this action may touch. Empty means none.
    pub repos: Vec<String>,
}

/// Merging pull requests. Each repository also needs its own merge token in the Keychain.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct MergeSwitch {
    pub enabled: bool,
    /// Repositories (owner/name) Atlas may merge in. Empty means none.
    pub repos: Vec<String>,
    /// The GitHub account each repository's merge token belongs to, keyed by lowercase
    /// owner/name. A repository is listed here only while its token is saved.
    pub token_logins: BTreeMap<String, String>,
}

/// Editing files: each change goes to a new branch and a pull request, never to the default
/// branch. Uses the repository's merge token, so each repository also needs one saved.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EditSwitch {
    pub enabled: bool,
    /// Repositories (owner/name) Atlas may open edit pull requests on. Empty means none.
    pub repos: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ActionsConfig {
    pub rerun_failed_jobs: RerunSwitch,
    /// The GitHub account the write token belongs to, read once when it is saved.
    pub token_login: Option<String>,
    pub merge_pull_requests: MergeSwitch,
    pub edit_files: EditSwitch,
}

impl ActionsConfig {
    pub fn allows(&self, repo: &str) -> bool {
        self.rerun_failed_jobs.enabled
            && self
                .rerun_failed_jobs
                .repos
                .iter()
                .any(|r| r.eq_ignore_ascii_case(repo))
    }

    pub fn allows_merge(&self, repo: &str) -> bool {
        self.merge_pull_requests.enabled
            && self
                .merge_pull_requests
                .repos
                .iter()
                .any(|r| r.eq_ignore_ascii_case(repo))
    }

    pub fn allows_edit(&self, repo: &str) -> bool {
        self.edit_files.enabled
            && self
                .edit_files
                .repos
                .iter()
                .any(|r| r.eq_ignore_ascii_case(repo))
    }
}

/// How far an attempt got. `Attempted` is written before the request is sent, so a crash
/// mid-request still leaves a trace; the outcome follows as a second record with the same id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Refused,
    Cancelled,
    Attempted,
    Started,
    /// A pull request GitHub reports as merged.
    Merged,
    /// An edit pull request GitHub opened.
    Opened,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditRecord {
    pub id: String,
    pub at: DateTime<Utc>,
    pub action: String,
    /// The person at the Mac, as the OS reports them.
    pub actor: String,
    pub github_login: Option<String>,
    pub repo: String,
    /// The workflow run a re-run targets; 0 for merges.
    #[serde(default)]
    pub run_id: u64,
    /// The pull request a merge targets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_number: Option<u64>,
    /// The pull request's title, for merges.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The branch a merge lands on, or an edit pull request targets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    /// The file an edit changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub workflow: Option<String>,
    pub run_number: Option<u64>,
    pub attempt_before: Option<u32>,
    pub head_sha: Option<String>,
    pub branch: Option<String>,
    pub stage: Stage,
    /// Short machine-readable cause for refusals and failures, such as `disabled`.
    pub reason: Option<String>,
    pub http_status: Option<u16>,
    pub request_id: Option<String>,
    pub message: Option<String>,
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
        Ok(Self { dir })
    }

    fn config_path(&self) -> PathBuf {
        self.dir.join("actions.json")
    }

    fn audit_path(&self) -> PathBuf {
        self.dir.join("audit.jsonl")
    }

    /// A missing or unreadable file means the default: everything off.
    pub fn load_config(&self) -> ActionsConfig {
        fs::read(self.config_path())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save_config(&self, c: &ActionsConfig) -> Result<(), String> {
        let path = self.config_path();
        let tmp = path.with_extension("tmp");
        let bytes = serde_json::to_vec_pretty(c).map_err(|e| e.to_string())?;
        fs::write(&tmp, bytes).map_err(|e| format!("Could not save the action settings: {e}"))?;
        fs::rename(&tmp, &path).map_err(|e| format!("Could not save the action settings: {e}"))
    }

    pub fn append(&self, r: &AuditRecord) -> Result<(), String> {
        let mut line = serde_json::to_string(r).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.audit_path())
            .map_err(|e| format!("Could not open the audit log: {e}"))?;
        f.write_all(line.as_bytes())
            .and_then(|_| f.sync_data())
            .map_err(|e| format!("Could not write the audit log: {e}"))
    }

    /// Every record, oldest first. Lines that don't parse are skipped rather than hiding
    /// the rest of the log.
    pub fn audit(&self) -> Vec<AuditRecord> {
        fs::read_to_string(self.audit_path())
            .unwrap_or_default()
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect()
    }
}

/// Cleans a repository list from the web view: valid owner/name only, no duplicates.
pub fn clean_repos(repos: &[String]) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    for r in repos {
        let r = r.trim();
        if !valid_repo(r) {
            return Err(format!("{r} isn't a valid owner/name repository"));
        }
        if !out.iter().any(|x| x.eq_ignore_ascii_case(r)) {
            out.push(r.to_string());
        }
    }
    Ok(out)
}

/// Why Atlas's own limits block a re-run right now, if they do. Counts requests that were
/// sent (`Attempted`), whatever their outcome.
pub fn rate_block(
    log: &[AuditRecord],
    repo: &str,
    run_id: u64,
    now: DateTime<Utc>,
) -> Option<String> {
    let sent = log
        .iter()
        .filter(|r| r.stage == Stage::Attempted && r.action == ACTION_RERUN);
    let cooldown = now - Duration::minutes(PER_RUN_COOLDOWN_MINUTES);
    if let Some(last) = sent
        .clone()
        .filter(|r| r.run_id == run_id && r.repo.eq_ignore_ascii_case(repo) && r.at > cooldown)
        .map(|r| r.at)
        .max()
    {
        let wait = (last + Duration::minutes(PER_RUN_COOLDOWN_MINUTES) - now).num_minutes() + 1;
        return Some(format!(
            "This run was re-run from Atlas a moment ago. Try again in about {wait} minute{}.",
            if wait == 1 { "" } else { "s" }
        ));
    }
    let hour = now - Duration::hours(1);
    if sent.filter(|r| r.at > hour).count() >= MAX_PER_HOUR {
        return Some(format!(
            "Atlas starts at most {MAX_PER_HOUR} re-runs an hour. Try again later."
        ));
    }
    None
}

/// Why Atlas's own limits block a merge right now, if they do. Counts merge requests that
/// were sent (`Attempted`), whatever their outcome.
pub fn merge_rate_block(
    log: &[AuditRecord],
    repo: &str,
    number: u64,
    now: DateTime<Utc>,
) -> Option<String> {
    let sent = log
        .iter()
        .filter(|r| r.stage == Stage::Attempted && r.action == ACTION_MERGE);
    let cooldown = now - Duration::minutes(MERGE_COOLDOWN_MINUTES);
    if sent.clone().any(|r| {
        r.pull_number == Some(number) && r.repo.eq_ignore_ascii_case(repo) && r.at > cooldown
    }) {
        return Some(
            "Atlas sent a merge for this pull request a moment ago. Refresh to see whether it landed."
                .into(),
        );
    }
    let hour = now - Duration::hours(1);
    if sent.filter(|r| r.at > hour).count() >= MAX_MERGES_PER_HOUR {
        return Some(format!(
            "Atlas merges at most {MAX_MERGES_PER_HOUR} pull requests an hour. Try again later."
        ));
    }
    None
}

/// Why Atlas's own limits block opening another edit pull request right now, if they do.
pub fn edit_rate_block(log: &[AuditRecord], now: DateTime<Utc>) -> Option<String> {
    let hour = now - Duration::hours(1);
    let sent = log
        .iter()
        .filter(|r| r.stage == Stage::Attempted && r.action == ACTION_EDIT && r.at > hour)
        .count();
    (sent >= MAX_EDITS_PER_HOUR).then(|| {
        format!(
            "Atlas opens at most {MAX_EDITS_PER_HOUR} edit pull requests an hour. Try again later."
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn record(stage: Stage, repo: &str, run_id: u64, at: DateTime<Utc>) -> AuditRecord {
        AuditRecord {
            id: "x".into(),
            at,
            action: ACTION_RERUN.into(),
            actor: "kc".into(),
            github_login: None,
            repo: repo.into(),
            run_id,
            pull_number: None,
            title: None,
            base: None,
            path: None,
            workflow: None,
            run_number: None,
            attempt_before: None,
            head_sha: None,
            branch: None,
            stage,
            reason: None,
            http_status: None,
            request_id: None,
            message: None,
        }
    }

    #[test]
    fn defaults_are_off_and_survive_a_missing_file() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path().to_path_buf()).unwrap();
        let c = s.load_config();
        assert!(!c.rerun_failed_jobs.enabled);
        assert!(c.rerun_failed_jobs.repos.is_empty());
        assert!(!c.allows("o/r"));
    }

    #[test]
    fn allows_only_enabled_listed_repos() {
        let mut c = ActionsConfig::default();
        c.rerun_failed_jobs.repos = vec!["Owner/Repo".into()];
        assert!(!c.allows("owner/repo"), "off switch wins");
        c.rerun_failed_jobs.enabled = true;
        assert!(c.allows("owner/repo"));
        assert!(!c.allows("owner/other"));
    }

    #[test]
    fn audit_appends_and_reads_back() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path().to_path_buf()).unwrap();
        let now = Utc::now();
        s.append(&record(Stage::Attempted, "o/r", 1, now)).unwrap();
        s.append(&record(Stage::Started, "o/r", 1, now)).unwrap();
        let log = s.audit();
        assert_eq!(log.len(), 2);
        assert_eq!(log[1].stage, Stage::Started);
        let raw = fs::read_to_string(d.path().join("audit.jsonl")).unwrap();
        assert_eq!(raw.lines().count(), 2);
    }

    #[test]
    fn repo_lists_are_validated() {
        assert_eq!(
            clean_repos(&["o/r".into(), "O/R".into(), " a/b ".into()]).unwrap(),
            vec!["o/r".to_string(), "a/b".to_string()]
        );
        assert!(clean_repos(&["o/r/x".into()]).is_err());
        assert!(clean_repos(&["../x".into()]).is_err());
    }

    #[test]
    fn per_run_cooldown_and_hourly_cap() {
        let now = Utc::now();
        let mut log = vec![record(
            Stage::Attempted,
            "o/r",
            1,
            now - Duration::minutes(3),
        )];
        assert!(
            rate_block(&log, "o/r", 1, now).is_some(),
            "same run within 10 minutes"
        );
        assert!(
            rate_block(&log, "o/r", 2, now).is_none(),
            "other runs are fine"
        );
        assert!(rate_block(&log, "o/r", 1, now + Duration::minutes(11)).is_none());
        // Cancelled and refused presses don't count.
        log.push(record(Stage::Cancelled, "o/r", 5, now));
        for i in 0..9 {
            log.push(record(
                Stage::Attempted,
                "o/r",
                100 + i,
                now - Duration::minutes(20),
            ));
        }
        assert!(
            rate_block(&log, "o/r", 7, now).is_some(),
            "10 sent within the hour"
        );
        assert!(rate_block(&log, "o/r", 7, now + Duration::minutes(45)).is_none());
    }

    #[test]
    fn merge_switch_is_separate_from_reruns() {
        let mut c = ActionsConfig::default();
        c.rerun_failed_jobs.enabled = true;
        c.rerun_failed_jobs.repos = vec!["o/r".into()];
        assert!(!c.allows_merge("o/r"), "re-run switch doesn't allow merges");
        c.merge_pull_requests.repos = vec!["O/R".into()];
        assert!(!c.allows_merge("o/r"), "off switch wins");
        c.merge_pull_requests.enabled = true;
        assert!(c.allows_merge("o/r"));
        assert!(!c.allows_merge("o/other"));
    }

    #[test]
    fn older_audit_lines_and_configs_still_load() {
        let old = r#"{"id":"a","at":"2026-10-27T10:00:00Z","action":"rerun_failed_jobs","actor":"kc","github_login":null,"repo":"o/r","run_id":5,"workflow":null,"run_number":null,"attempt_before":null,"head_sha":null,"branch":null,"stage":"started","reason":null,"http_status":null,"request_id":null,"message":null}"#;
        let r: AuditRecord = serde_json::from_str(old).unwrap();
        assert_eq!((r.run_id, r.pull_number), (5, None));
        let c: ActionsConfig =
            serde_json::from_str(r#"{"rerun_failed_jobs":{"enabled":true,"repos":["o/r"]}}"#)
                .unwrap();
        assert!(!c.merge_pull_requests.enabled);
    }

    #[test]
    fn merge_cooldown_and_hourly_cap() {
        let now = Utc::now();
        let merge = |n: u64, at| AuditRecord {
            action: ACTION_MERGE.into(),
            run_id: 0,
            pull_number: Some(n),
            ..record(Stage::Attempted, "o/r", 0, at)
        };
        let mut log = vec![merge(7, now - Duration::minutes(2))];
        assert!(merge_rate_block(&log, "o/r", 7, now).is_some());
        assert!(merge_rate_block(&log, "o/r", 8, now).is_none());
        // Re-runs don't count towards merges.
        log.push(record(Stage::Attempted, "o/r", 8, now));
        assert!(merge_rate_block(&log, "o/r", 8, now).is_none());
        for n in 20..24 {
            log.push(merge(n, now - Duration::minutes(30)));
        }
        assert!(
            merge_rate_block(&log, "o/r", 9, now).is_some(),
            "5 within the hour"
        );
        assert!(merge_rate_block(&log, "o/r", 9, now + Duration::minutes(31)).is_none());
    }
}

#[cfg(test)]
mod edit_tests {
    use super::*;

    #[test]
    fn edit_switch_is_separate_and_capped() {
        let mut c = ActionsConfig::default();
        c.merge_pull_requests.enabled = true;
        c.merge_pull_requests.repos = vec!["o/r".into()];
        assert!(
            !c.allows_edit("o/r"),
            "the merge switch doesn't allow edits"
        );
        c.edit_files.repos = vec!["O/R".into()];
        assert!(!c.allows_edit("o/r"), "off switch wins");
        c.edit_files.enabled = true;
        assert!(c.allows_edit("o/r"));
        assert!(!c.allows_edit("o/other"));

        let now = Utc::now();
        let rec = |stage| AuditRecord {
            id: "e".into(),
            at: now - Duration::minutes(5),
            action: ACTION_EDIT.into(),
            actor: "kc".into(),
            github_login: None,
            repo: "o/r".into(),
            run_id: 0,
            pull_number: None,
            title: None,
            base: None,
            path: Some("README.md".into()),
            workflow: None,
            run_number: None,
            attempt_before: None,
            head_sha: None,
            branch: None,
            stage,
            reason: None,
            http_status: None,
            request_id: None,
            message: None,
        };
        let mut log: Vec<AuditRecord> = (0..MAX_EDITS_PER_HOUR - 1)
            .map(|_| rec(Stage::Attempted))
            .collect();
        log.push(rec(Stage::Cancelled));
        assert!(edit_rate_block(&log, now).is_none());
        log.push(rec(Stage::Attempted));
        assert!(edit_rate_block(&log, now).is_some());
        assert!(edit_rate_block(&log, now + Duration::minutes(56)).is_none());
    }
}
