//! "Re-run failed jobs": the whole decision path for one press of the button. Every step
//! that can stop the action runs before the approval dialog, the dialog runs before the
//! audit record, and the audit record is written before the single request is sent.

use super::store::{rate_block, AuditRecord, Stage, Store, ACTION_RERUN};
use crate::intel::collect::{valid_repo, GithubApi};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

/// GitHub only re-runs workflow runs created within the last 30 days.
pub const RERUN_WINDOW_DAYS: i64 = 30;

pub struct WriteResponse {
    pub status: u16,
    pub body: Value,
    pub request_id: Option<String>,
    pub rate_remaining: Option<u32>,
    pub rate_reset: Option<u64>,
    pub retry_after: Option<u64>,
}

#[derive(Debug)]
pub enum SendError {
    /// The request never left the Mac (no token, connection refused, DNS).
    NotSent(String),
    /// The request may have reached GitHub (timeout, dropped connection).
    Unknown(String),
}

/// The one write Atlas can make. Implemented by the Keychain-backed client in `client.rs`.
#[async_trait::async_trait]
pub trait WriteApi: Send + Sync {
    async fn has_token(&self) -> bool;
    async fn rerun_failed_jobs(&self, repo: &str, run_id: u64) -> Result<WriteResponse, SendError>;
}

/// Asks the person at the Mac. The real one is a native dialog the web view can't answer.
#[async_trait::async_trait]
pub trait Approver: Send + Sync {
    async fn approve(&self, p: &Preview) -> bool;
}

/// What the person approves: the run as GitHub reports it right before the request.
#[derive(Debug, Clone, Serialize)]
pub struct Preview {
    pub repo: String,
    pub run_id: u64,
    pub workflow: String,
    pub run_number: Option<u64>,
    pub attempt: u32,
    pub branch: Option<String>,
    pub head_sha: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub conclusion: String,
    pub failed_jobs: Vec<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Outcome {
    pub stage: Stage,
    pub reason: Option<String>,
    pub message: String,
    pub audit_id: String,
}

pub struct Rerunner {
    pub store: Arc<Store>,
    pub read: Arc<dyn GithubApi>,
    pub write: Arc<dyn WriteApi>,
    pub approver: Arc<dyn Approver>,
    pub actor: String,
    pub clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    in_flight: tokio::sync::Mutex<()>,
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}

fn reset_text(reset: Option<u64>, retry_after: Option<u64>, now: DateTime<Utc>) -> String {
    let at = retry_after
        .map(|secs| now + Duration::seconds(secs as i64))
        .or_else(|| reset.and_then(|r| DateTime::<Utc>::from_timestamp(r as i64, 0)));
    match at {
        Some(t) => format!(
            "GitHub is limiting requests. Try again after {} UTC.",
            t.format("%H:%M")
        ),
        None => "GitHub is limiting requests. Try again later.".into(),
    }
}

/// Turns GitHub's answer to the POST into a stage, a reason and a message for the person.
pub fn classify(
    r: &WriteResponse,
    p: &Preview,
    now: DateTime<Utc>,
) -> (Stage, Option<&'static str>, String) {
    let gh = s(&r.body, "message").unwrap_or_default();
    let limited = r.status == 429
        || (r.status == 403 && (r.rate_remaining == Some(0) || r.retry_after.is_some()));
    match r.status {
        201 => (
            Stage::Started,
            None,
            format!("Started attempt {} of {} on {}.", p.attempt + 1, p.workflow, p.repo),
        ),
        _ if limited => (
            Stage::Failed,
            Some("rate_limited"),
            reset_text(r.rate_reset, r.retry_after, now),
        ),
        401 => (
            Stage::Failed,
            Some("token_rejected"),
            "GitHub rejected the Actions token. It may have expired or been revoked; replace it in Settings.".into(),
        ),
        403 => (
            Stage::Failed,
            Some("forbidden"),
            format!("GitHub refused the re-run{}. Check that the Actions token has Actions: write on this repository.", if gh.is_empty() { String::new() } else { format!(": {gh}") }),
        ),
        404 => (
            Stage::Failed,
            Some("not_found"),
            "The Actions token can't see this repository or run. Add the repository to the token on GitHub.".into(),
        ),
        409 | 422 => (
            Stage::Failed,
            Some("not_rerunnable"),
            format!("GitHub can't re-run this run right now{}.", if gh.is_empty() { String::new() } else { format!(": {gh}") }),
        ),
        status => (
            Stage::Failed,
            Some("github_error"),
            format!("GitHub returned {status}{}. Nothing was retried; refresh to check the run.", if gh.is_empty() { String::new() } else { format!(": {gh}") }),
        ),
    }
}

/// The text of the approval dialog.
pub fn dialog_text(p: &Preview, now: DateTime<Utc>) -> String {
    let mut lines = vec![format!("{} · {}", p.workflow, p.repo)];
    let mut run = match p.run_number {
        Some(n) => format!("Run #{n}, attempt {}", p.attempt),
        None => format!("Run {}, attempt {}", p.run_id, p.attempt),
    };
    if let Some(b) = &p.branch {
        run.push_str(&format!(", branch {b}"));
    }
    if let Some(sha) = &p.head_sha {
        run.push_str(&format!(", commit {}", &sha[..sha.len().min(7)]));
    }
    if let Some(t) = p.created_at {
        let h = (now - t).num_hours();
        run.push_str(&match h {
            0 => ", started under an hour ago".to_string(),
            1..=47 => format!(", started {h} hour{} ago", if h == 1 { "" } else { "s" }),
            _ => format!(", started {} days ago", h / 24),
        });
    }
    lines.push(run);
    if !p.failed_jobs.is_empty() {
        let shown: Vec<&str> = p.failed_jobs.iter().take(6).map(String::as_str).collect();
        let more = p.failed_jobs.len().saturating_sub(shown.len());
        lines.push(format!(
            "Failed jobs: {}{}",
            shown.join(", "),
            if more > 0 {
                format!(" and {more} more")
            } else {
                String::new()
            }
        ));
    }
    lines.push(String::new());
    lines.push(format!(
        "This starts attempt {} on GitHub Actions and uses runner minutes. The jobs run with the permissions of whoever started the original run.",
        p.attempt + 1
    ));
    lines.join("\n")
}

impl Rerunner {
    pub fn new(
        store: Arc<Store>,
        read: Arc<dyn GithubApi>,
        write: Arc<dyn WriteApi>,
        approver: Arc<dyn Approver>,
        actor: String,
        clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    ) -> Self {
        Self {
            store,
            read,
            write,
            approver,
            actor,
            clock,
            in_flight: tokio::sync::Mutex::new(()),
        }
    }

    fn record(
        &self,
        id: &str,
        repo: &str,
        run_id: u64,
        p: Option<&Preview>,
        stage: Stage,
    ) -> AuditRecord {
        AuditRecord {
            id: id.to_string(),
            at: (self.clock)(),
            action: ACTION_RERUN.into(),
            actor: self.actor.clone(),
            github_login: self.store.load_config().token_login,
            repo: repo.to_string(),
            run_id,
            pull_number: None,
            agent: None,
            title: None,
            base: None,
            workflow: p.map(|p| p.workflow.clone()),
            run_number: p.and_then(|p| p.run_number),
            attempt_before: p.map(|p| p.attempt),
            head_sha: p.and_then(|p| p.head_sha.clone()),
            branch: p.and_then(|p| p.branch.clone()),
            stage,
            reason: None,
            http_status: None,
            request_id: None,
            message: None,
        }
    }

    /// Logs a stop that happened before anything was sent and returns it as the outcome.
    fn stop(&self, mut r: AuditRecord, reason: &str, message: String) -> Outcome {
        let stage = r.stage;
        r.reason = Some(reason.into());
        r.message = Some(message.clone());
        // A refusal sends nothing, so a failed log write doesn't change the outcome.
        let _ = self.store.append(&r);
        Outcome {
            stage,
            reason: Some(reason.into()),
            message,
            audit_id: r.id,
        }
    }

    async fn fetch_run(&self, repo: &str, run_id: u64) -> Result<Value, (String, String)> {
        let r = self
            .read
            .get(&format!("/repos/{repo}/actions/runs/{run_id}"))
            .await
            .map_err(|e| {
                (
                    "preflight_failed".to_string(),
                    format!("Couldn't check the run on GitHub: {e}"),
                )
            })?;
        match r.status {
            200 => Ok(r.body),
            404 => Err((
                "run_not_found".into(),
                "GitHub can't find that run. Refresh and try again.".into(),
            )),
            s => Err((
                "preflight_failed".into(),
                format!("Couldn't check the run on GitHub (status {s})."),
            )),
        }
    }

    async fn failed_jobs(&self, repo: &str, run_id: u64) -> Vec<String> {
        let Ok(r) = self
            .read
            .get(&format!(
                "/repos/{repo}/actions/runs/{run_id}/jobs?filter=latest&per_page=100"
            ))
            .await
        else {
            return vec![];
        };
        r.body
            .get("jobs")
            .and_then(Value::as_array)
            .map(|jobs| {
                jobs.iter()
                    .filter(|j| {
                        matches!(
                            j.get("conclusion").and_then(Value::as_str),
                            Some("failure" | "timed_out" | "cancelled")
                        )
                    })
                    .filter_map(|j| s(j, "name"))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn run(&self, repo: &str, run_id: u64, seen_attempt: Option<u32>) -> Outcome {
        let id = uuid::Uuid::new_v4().to_string();
        let stop = |p: Option<&Preview>, reason: &str, msg: &str| {
            self.stop(
                self.record(&id, repo, run_id, p, Stage::Refused),
                reason,
                msg.to_string(),
            )
        };

        if !valid_repo(repo) {
            return stop(
                None,
                "invalid_repo",
                "That isn't a valid owner/name repository.",
            );
        }
        let Ok(_guard) = self.in_flight.try_lock() else {
            return stop(
                None,
                "busy",
                "Another action is already running. Wait for it to finish.",
            );
        };
        let config = self.store.load_config();
        if !config.rerun_failed_jobs.enabled {
            return stop(
                None,
                "disabled",
                "Re-running failed jobs is off. Turn it on in Settings.",
            );
        }
        if !config.allows(repo) {
            return stop(
                None,
                "repo_not_enabled",
                "This repository isn't enabled for re-runs. Add it in Settings.",
            );
        }
        if !self.write.has_token().await {
            return stop(None, "no_token", "Add an Actions token in Settings first.");
        }

        // Pre-flight: read the run as it is now, with the read-only client.
        let run = match self.fetch_run(repo, run_id).await {
            Ok(v) => v,
            Err((reason, msg)) => return stop(None, &reason, &msg),
        };
        let now = (self.clock)();
        let preview = Preview {
            repo: repo.to_string(),
            run_id,
            workflow: s(&run, "name").unwrap_or_else(|| "Workflow".into()),
            run_number: run.get("run_number").and_then(Value::as_u64),
            attempt: run.get("run_attempt").and_then(Value::as_u64).unwrap_or(1) as u32,
            branch: s(&run, "head_branch"),
            head_sha: s(&run, "head_sha"),
            created_at: s(&run, "created_at").and_then(|t| t.parse().ok()),
            conclusion: s(&run, "conclusion").unwrap_or_default(),
            failed_jobs: vec![],
            url: s(&run, "html_url"),
        };
        let p = Some(&preview);
        let full_name = run
            .pointer("/repository/full_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !full_name.eq_ignore_ascii_case(repo) {
            return stop(
                p,
                "repo_mismatch",
                "GitHub returned a run from a different repository.",
            );
        }
        if s(&run, "status").as_deref() != Some("completed") {
            return stop(p, "in_progress", "This run hasn't finished yet.");
        }
        if !matches!(preview.conclusion.as_str(), "failure" | "timed_out") {
            return stop(
                p,
                "not_failed",
                "This run didn't fail, so there's nothing to re-run.",
            );
        }
        if seen_attempt.is_some_and(|a| a != preview.attempt) {
            return stop(p, "stale_attempt", "This run has been re-run since Atlas last refreshed. Refresh to see the latest attempt.");
        }
        match preview.created_at {
            Some(t) if now - t <= Duration::days(RERUN_WINDOW_DAYS) => {}
            _ => {
                return stop(
                    p,
                    "too_old",
                    "GitHub only re-runs runs from the last 30 days.",
                )
            }
        }
        if let Some(msg) = rate_block(&self.store.audit(), repo, run_id, now) {
            return stop(p, "rate_capped", &msg);
        }

        let preview = Preview {
            failed_jobs: self.failed_jobs(repo, run_id).await,
            ..preview
        };
        let p = Some(&preview);
        if !self.approver.approve(&preview).await {
            return self.stop(
                self.record(&id, repo, run_id, p, Stage::Cancelled),
                "cancelled",
                "Cancelled. Nothing was sent to GitHub.".into(),
            );
        }

        // Fail closed: no audit record, no request.
        if let Err(e) = self
            .store
            .append(&self.record(&id, repo, run_id, p, Stage::Attempted))
        {
            return Outcome {
                stage: Stage::Failed,
                reason: Some("audit_unavailable".into()),
                message: format!("{e}. Nothing was sent to GitHub."),
                audit_id: id,
            };
        }

        let mut result = self.record(&id, repo, run_id, p, Stage::Failed);
        let (stage, reason, message) = match self.write.rerun_failed_jobs(repo, run_id).await {
            Ok(resp) => {
                result.http_status = Some(resp.status);
                result.request_id = resp.request_id.clone();
                classify(&resp, &preview, (self.clock)())
            }
            Err(SendError::NotSent(e)) => (
                Stage::Failed,
                Some("network"),
                format!("{e}. Nothing reached GitHub."),
            ),
            Err(SendError::Unknown(e)) => {
                // The request may have landed. A higher attempt number on the run means it did.
                let landed = self
                    .fetch_run(repo, run_id)
                    .await
                    .ok()
                    .and_then(|r| r.get("run_attempt").and_then(Value::as_u64))
                    .is_some_and(|a| a as u32 > preview.attempt);
                if landed {
                    (
                        Stage::Started,
                        None,
                        format!(
                            "Started attempt {} of {} on {}.",
                            preview.attempt + 1,
                            preview.workflow,
                            repo
                        ),
                    )
                } else {
                    (
                        Stage::Unknown,
                        Some("unknown"),
                        format!("{e}. GitHub may or may not have started the re-run; refresh in a minute to check before trying again."),
                    )
                }
            }
        };
        result.stage = stage;
        result.reason = reason.map(str::to_owned);
        result.message = Some(message.clone());
        result.at = (self.clock)();
        let message = match self.store.append(&result) {
            Ok(()) => message,
            Err(e) => format!("{message} (The result couldn't be added to the audit log: {e}.)"),
        };
        Outcome {
            stage,
            reason: reason.map(str::to_owned),
            message,
            audit_id: id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::store::ActionsConfig;
    use crate::intel::collect::GhResponse;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    const REPO: &str = "khaneilcampbell/benjaire.com";

    fn now() -> DateTime<Utc> {
        "2026-10-27T14:00:00Z".parse().unwrap()
    }

    fn run_json(status: &str, conclusion: &str, attempt: u64, created: &str) -> Value {
        json!({
            "id": 42, "name": "Benjaire Site CI", "run_number": 142, "run_attempt": attempt,
            "status": status, "conclusion": conclusion, "head_branch": "main",
            "head_sha": "a1b2c3d4e5f6", "created_at": created,
            "html_url": "https://github.com/khaneilcampbell/benjaire.com/actions/runs/42",
            "repository": { "full_name": REPO }
        })
    }

    struct FakeRead {
        runs: Mutex<VecDeque<Value>>,
        calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl GithubApi for FakeRead {
        async fn get(&self, path: &str) -> Result<GhResponse, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if path.contains("/jobs") {
                return Ok(GhResponse {
                    status: 200,
                    body: json!({ "jobs": [
                        { "name": "build", "conclusion": "failure" },
                        { "name": "lint", "conclusion": "success" }
                    ]}),
                    rate_remaining: None,
                    rate_reset: None,
                });
            }
            let mut q = self.runs.lock().unwrap();
            let body = if q.len() > 1 {
                q.pop_front().unwrap()
            } else {
                q.front().cloned().unwrap_or(Value::Null)
            };
            Ok(GhResponse {
                status: if body.is_null() { 404 } else { 200 },
                body,
                rate_remaining: None,
                rate_reset: None,
            })
        }
        async fn has_token(&self) -> bool {
            true
        }
    }

    struct FakeWrite {
        token: bool,
        reply: Mutex<Option<Result<WriteResponse, SendError>>>,
        posts: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl WriteApi for FakeWrite {
        async fn has_token(&self) -> bool {
            self.token
        }
        async fn rerun_failed_jobs(
            &self,
            _repo: &str,
            _run_id: u64,
        ) -> Result<WriteResponse, SendError> {
            self.posts.fetch_add(1, Ordering::SeqCst);
            self.reply
                .lock()
                .unwrap()
                .take()
                .unwrap_or_else(|| Ok(resp(201, json!({}))))
        }
    }

    struct FakeApprover {
        answer: bool,
        seen: Mutex<Option<Preview>>,
    }

    #[async_trait::async_trait]
    impl Approver for FakeApprover {
        async fn approve(&self, p: &Preview) -> bool {
            *self.seen.lock().unwrap() = Some(p.clone());
            self.answer
        }
    }

    fn resp(status: u16, body: Value) -> WriteResponse {
        WriteResponse {
            status,
            body,
            request_id: Some("ABCD:1234".into()),
            rate_remaining: Some(4999),
            rate_reset: None,
            retry_after: None,
        }
    }

    struct Rig {
        _dir: tempfile::TempDir,
        store: Arc<Store>,
        read: Arc<FakeRead>,
        write: Arc<FakeWrite>,
        approver: Arc<FakeApprover>,
        r: Rerunner,
    }

    fn rig_with(
        enabled: bool,
        repos: &[&str],
        token: bool,
        approve: bool,
        runs: Vec<Value>,
        reply: Option<Result<WriteResponse, SendError>>,
    ) -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(dir.path().to_path_buf()).unwrap());
        let mut c = ActionsConfig::default();
        c.rerun_failed_jobs.enabled = enabled;
        c.rerun_failed_jobs.repos = repos.iter().map(|s| s.to_string()).collect();
        c.token_login = Some("khaneilcampbell".into());
        store.save_config(&c).unwrap();
        let read = Arc::new(FakeRead {
            runs: Mutex::new(runs.into()),
            calls: AtomicUsize::new(0),
        });
        let write = Arc::new(FakeWrite {
            token,
            reply: Mutex::new(reply),
            posts: AtomicUsize::new(0),
        });
        let approver = Arc::new(FakeApprover {
            answer: approve,
            seen: Mutex::new(None),
        });
        let r = Rerunner::new(
            store.clone(),
            read.clone(),
            write.clone(),
            approver.clone(),
            "kc".into(),
            Box::new(now),
        );
        Rig {
            _dir: dir,
            store,
            read,
            write,
            approver,
            r,
        }
    }

    fn failed() -> Value {
        run_json("completed", "failure", 1, "2026-10-27T12:00:00Z")
    }

    fn rig(reply: Option<Result<WriteResponse, SendError>>) -> Rig {
        rig_with(true, &[REPO], true, true, vec![failed()], reply)
    }

    fn stages(r: &Rig) -> Vec<Stage> {
        r.store.audit().iter().map(|a| a.stage).collect()
    }

    #[tokio::test]
    async fn approved_rerun_is_sent_once_and_logged_twice() {
        let r = rig(None);
        let o = r.r.run(REPO, 42, Some(1)).await;
        assert_eq!(o.stage, Stage::Started, "{}", o.message);
        assert_eq!(r.write.posts.load(Ordering::SeqCst), 1);
        assert_eq!(stages(&r), vec![Stage::Attempted, Stage::Started]);
        let log = r.store.audit();
        assert_eq!(log[0].id, log[1].id);
        assert_eq!(log[1].http_status, Some(201));
        assert_eq!(log[1].request_id.as_deref(), Some("ABCD:1234"));
        assert_eq!(log[1].workflow.as_deref(), Some("Benjaire Site CI"));
        assert_eq!(log[1].attempt_before, Some(1));
        assert_eq!(log[1].github_login.as_deref(), Some("khaneilcampbell"));
        let seen = r.approver.seen.lock().unwrap().clone().unwrap();
        assert_eq!(seen.failed_jobs, vec!["build".to_string()]);
    }

    #[tokio::test]
    async fn switch_repo_and_token_checks_stop_before_any_request() {
        for (enabled, repos, token, reason) in [
            (false, vec![REPO], true, "disabled"),
            (true, vec![], true, "repo_not_enabled"),
            (
                true,
                vec!["khaneilcampbell/other"],
                true,
                "repo_not_enabled",
            ),
            (true, vec![REPO], false, "no_token"),
        ] {
            let r = rig_with(enabled, &repos, token, true, vec![failed()], None);
            let o = r.r.run(REPO, 42, None).await;
            assert_eq!(o.reason.as_deref(), Some(reason));
            assert_eq!(
                r.read.calls.load(Ordering::SeqCst),
                0,
                "{reason}: no GitHub reads"
            );
            assert_eq!(r.write.posts.load(Ordering::SeqCst), 0);
            assert!(
                r.approver.seen.lock().unwrap().is_none(),
                "{reason}: no dialog"
            );
            assert_eq!(stages(&r), vec![Stage::Refused]);
        }
    }

    #[tokio::test]
    async fn preflight_refuses_runs_that_cannot_be_rerun() {
        for (run, seen, reason) in [
            (
                run_json("in_progress", "", 1, "2026-10-27T12:00:00Z"),
                None,
                "in_progress",
            ),
            (
                run_json("completed", "success", 1, "2026-10-27T12:00:00Z"),
                None,
                "not_failed",
            ),
            (
                run_json("completed", "cancelled", 1, "2026-10-27T12:00:00Z"),
                None,
                "not_failed",
            ),
            (
                run_json("completed", "failure", 2, "2026-10-27T12:00:00Z"),
                Some(1),
                "stale_attempt",
            ),
            (
                run_json("completed", "failure", 1, "2026-09-20T12:00:00Z"),
                None,
                "too_old",
            ),
            (
                json!({ "status": "completed", "conclusion": "failure", "created_at": "2026-10-27T12:00:00Z", "repository": { "full_name": "evil/repo" } }),
                None,
                "repo_mismatch",
            ),
            (Value::Null, None, "run_not_found"),
        ] {
            let r = rig_with(true, &[REPO], true, true, vec![run], None);
            let o = r.r.run(REPO, 42, seen).await;
            assert_eq!(o.reason.as_deref(), Some(reason));
            assert_eq!(r.write.posts.load(Ordering::SeqCst), 0, "{reason}");
            assert!(
                r.approver.seen.lock().unwrap().is_none(),
                "{reason}: no dialog"
            );
        }
    }

    #[tokio::test]
    async fn timed_out_runs_can_be_rerun() {
        let r = rig_with(
            true,
            &[REPO],
            true,
            true,
            vec![run_json(
                "completed",
                "timed_out",
                1,
                "2026-10-27T12:00:00Z",
            )],
            None,
        );
        assert_eq!(r.r.run(REPO, 42, None).await.stage, Stage::Started);
    }

    #[tokio::test]
    async fn cancelling_the_dialog_sends_nothing() {
        let r = rig_with(true, &[REPO], true, false, vec![failed()], None);
        let o = r.r.run(REPO, 42, Some(1)).await;
        assert_eq!(o.stage, Stage::Cancelled);
        assert_eq!(r.write.posts.load(Ordering::SeqCst), 0);
        assert_eq!(stages(&r), vec![Stage::Cancelled]);
    }

    #[tokio::test]
    async fn invalid_repo_is_refused() {
        let r = rig(None);
        let o = r.r.run("../../user", 42, None).await;
        assert_eq!(o.reason.as_deref(), Some("invalid_repo"));
        assert_eq!(r.read.calls.load(Ordering::SeqCst), 0);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn audit_failure_means_no_request() {
        use std::os::unix::fs::PermissionsExt;
        let r = rig(None);
        let log = r._dir.path().join("audit.jsonl");
        std::fs::write(&log, "").unwrap();
        std::fs::set_permissions(&log, std::fs::Permissions::from_mode(0o444)).unwrap();
        if std::fs::OpenOptions::new().append(true).open(&log).is_ok() {
            return; // Running as root: the file stays writable, nothing to check.
        }
        let o = r.r.run(REPO, 42, Some(1)).await;
        assert_eq!(o.reason.as_deref(), Some("audit_unavailable"));
        assert_eq!(r.write.posts.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn the_same_run_is_not_rerun_twice_in_a_row() {
        let r = rig(None);
        assert_eq!(r.r.run(REPO, 42, None).await.stage, Stage::Started);
        let again = r.r.run(REPO, 42, None).await;
        assert_eq!(again.reason.as_deref(), Some("rate_capped"));
        assert_eq!(r.write.posts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn github_errors_are_mapped_and_never_retried() {
        let limited = WriteResponse {
            rate_remaining: Some(0),
            rate_reset: Some(1_793_120_400),
            ..resp(403, json!({ "message": "API rate limit exceeded" }))
        };
        let secondary = WriteResponse {
            retry_after: Some(60),
            ..resp(403, json!({ "message": "secondary rate limit" }))
        };
        for (reply, reason) in [
            (
                resp(401, json!({ "message": "Bad credentials" })),
                "token_rejected",
            ),
            (
                resp(
                    403,
                    json!({ "message": "Resource not accessible by personal access token" }),
                ),
                "forbidden",
            ),
            (limited, "rate_limited"),
            (secondary, "rate_limited"),
            (resp(429, json!({})), "rate_limited"),
            (resp(404, json!({ "message": "Not Found" })), "not_found"),
            (
                resp(409, json!({ "message": "already running" })),
                "not_rerunnable",
            ),
            (resp(422, json!({})), "not_rerunnable"),
            (resp(502, json!({})), "github_error"),
        ] {
            let r = rig(Some(Ok(reply)));
            let o = r.r.run(REPO, 42, Some(1)).await;
            assert_eq!(o.stage, Stage::Failed);
            assert_eq!(o.reason.as_deref(), Some(reason));
            assert_eq!(
                r.write.posts.load(Ordering::SeqCst),
                1,
                "{reason}: one request, no retry"
            );
            assert_eq!(stages(&r), vec![Stage::Attempted, Stage::Failed]);
        }
    }

    #[tokio::test]
    async fn a_connection_that_never_opened_is_a_plain_failure() {
        let r = rig(Some(Err(SendError::NotSent(
            "Couldn't reach GitHub".into(),
        ))));
        let o = r.r.run(REPO, 42, Some(1)).await;
        assert_eq!(
            (o.stage, o.reason.as_deref()),
            (Stage::Failed, Some("network"))
        );
    }

    #[tokio::test]
    async fn an_ambiguous_timeout_checks_the_run_again() {
        // Run read 1: pre-flight sees attempt 1. Read 2 (after the timeout): attempt 2.
        let r = rig_with(
            true,
            &[REPO],
            true,
            true,
            vec![
                failed(),
                run_json("in_progress", "", 2, "2026-10-27T12:00:00Z"),
            ],
            Some(Err(SendError::Unknown("Timed out".into()))),
        );
        assert_eq!(r.r.run(REPO, 42, Some(1)).await.stage, Stage::Started);

        let r = rig(Some(Err(SendError::Unknown("Timed out".into()))));
        let o = r.r.run(REPO, 42, Some(1)).await;
        assert_eq!(o.stage, Stage::Unknown);
        assert_eq!(stages(&r), vec![Stage::Attempted, Stage::Unknown]);
    }

    #[test]
    fn dialog_names_the_run() {
        let p = Preview {
            repo: REPO.into(),
            run_id: 42,
            workflow: "Benjaire Site CI".into(),
            run_number: Some(142),
            attempt: 1,
            branch: Some("main".into()),
            head_sha: Some("a1b2c3d4e5f6".into()),
            created_at: Some("2026-10-27T12:00:00Z".parse().unwrap()),
            conclusion: "failure".into(),
            failed_jobs: vec!["build".into(), "lighthouse".into()],
            url: None,
        };
        let t = dialog_text(&p, now());
        assert!(t.contains("Benjaire Site CI · khaneilcampbell/benjaire.com"));
        assert!(t.contains("Run #142, attempt 1, branch main, commit a1b2c3d, started 2 hours ago"));
        assert!(t.contains("Failed jobs: build, lighthouse"));
        assert!(t.contains("starts attempt 2"));
    }
}
