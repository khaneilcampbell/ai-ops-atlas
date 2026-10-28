//! Everyday changes: cancel a run, start a workflow by hand, pause or resume a workflow, and
//! close, reopen or comment on a pull request. Each follows the same path as a merge: the
//! switch and repository list, a read-only pre-flight with the read client, a native dialog,
//! a fresh Touch ID check, an `Attempted` audit record, then the single request.
//!
//! Workflow changes use the Actions token; pull request changes use that repository's own
//! pull request token (the one merges use). Re-running or starting Atlas's own workflows is
//! refused outright because it publishes a release.

use super::rerun::{SendError, WriteResponse};
use super::store::{
    is_self_repo, op_rate_block, AuditRecord, Group, Stage, Store, ACTION_CANCEL, ACTION_CLOSE_PR,
    ACTION_COMMENT_PR, ACTION_DISPATCH, ACTION_PAUSE, ACTION_REOPEN_PR, ACTION_RESUME,
};
use crate::intel::collect::{valid_repo, GithubApi};
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

/// Comments longer than this are refused rather than cut.
pub const MAX_COMMENT_CHARS: usize = 4000;

/// One change, as the web view asks for it. The URL and body are built in `client.rs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Op {
    CancelRun { run_id: u64 },
    RunWorkflow { workflow: String },
    PauseWorkflow { workflow: String },
    ResumeWorkflow { workflow: String },
    ClosePull { number: u64 },
    ReopenPull { number: u64 },
    CommentPull { number: u64, body: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    /// The Actions token (Actions: Read and write).
    Actions,
    /// The repository's pull request token (Pull requests: Read and write).
    Pulls,
}

impl Op {
    pub fn action(&self) -> &'static str {
        match self {
            Op::CancelRun { .. } => ACTION_CANCEL,
            Op::RunWorkflow { .. } => ACTION_DISPATCH,
            Op::PauseWorkflow { .. } => ACTION_PAUSE,
            Op::ResumeWorkflow { .. } => ACTION_RESUME,
            Op::ClosePull { .. } => ACTION_CLOSE_PR,
            Op::ReopenPull { .. } => ACTION_REOPEN_PR,
            Op::CommentPull { .. } => ACTION_COMMENT_PR,
        }
    }

    pub fn group(&self) -> Group {
        match self {
            Op::CancelRun { .. } => Group::CancelRuns,
            Op::RunWorkflow { .. } => Group::RunWorkflows,
            Op::PauseWorkflow { .. } | Op::ResumeWorkflow { .. } => Group::PauseWorkflows,
            Op::ClosePull { .. } | Op::ReopenPull { .. } | Op::CommentPull { .. } => {
                Group::PullRequestChanges
            }
        }
    }

    pub fn token(&self) -> TokenKind {
        match self.group() {
            Group::PullRequestChanges => TokenKind::Pulls,
            _ => TokenKind::Actions,
        }
    }

    fn workflow(&self) -> Option<&str> {
        match self {
            Op::RunWorkflow { workflow }
            | Op::PauseWorkflow { workflow }
            | Op::ResumeWorkflow { workflow } => Some(workflow),
            _ => None,
        }
    }

    fn number(&self) -> Option<u64> {
        match self {
            Op::ClosePull { number }
            | Op::ReopenPull { number }
            | Op::CommentPull { number, .. } => Some(*number),
            _ => None,
        }
    }

    /// The cooldown key, matching `store::op_target`.
    fn target(&self) -> String {
        match (self, self.number(), self.workflow()) {
            (_, Some(n), _) => format!("pull:{n}"),
            (Op::CancelRun { run_id }, _, _) => format!("run:{run_id}"),
            (_, _, w) => format!("workflow:{}", w.unwrap_or("")),
        }
    }
}

/// A workflow file name as it appears under `.github/workflows/`, such as `site-ci.yml`.
pub fn valid_workflow(w: &str) -> bool {
    (w.ends_with(".yml") || w.ends_with(".yaml"))
        && (5..=100).contains(&w.len())
        && !w.starts_with('.')
        && w.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// A branch name safe to send as a dispatch `ref`.
pub fn valid_ref(r: &str) -> bool {
    (1..=200).contains(&r.len())
        && !r.starts_with('-')
        && !r.contains("..")
        && r.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
}

/// The writes these changes need. Implemented by the Keychain-backed client in `client.rs`.
#[async_trait::async_trait]
pub trait OpsApi: Send + Sync {
    async fn has_op_token(&self, kind: TokenKind, repo: &str) -> bool;
    /// `git_ref` is the branch a dispatch runs on; unused by every other op.
    async fn send_op(
        &self,
        repo: &str,
        op: &Op,
        git_ref: Option<&str>,
    ) -> Result<WriteResponse, SendError>;
}

/// Asks the person at the Mac: a native dialog the web view can't answer, then Touch ID.
#[async_trait::async_trait]
pub trait OpApprover: Send + Sync {
    async fn approve(&self, title: &str, text: &str, button: &str) -> bool;
    async fn confirm_owner(&self, reason: &str) -> Result<(), String>;
}

/// What the person approves, read from GitHub right before the request.
#[derive(Debug, Clone, Default, Serialize)]
pub struct OpPreview {
    pub title: String,
    pub text: String,
    pub button: String,
    /// Touch ID's "Atlas wants to …" line.
    pub reason: String,
    pub run_id: u64,
    pub run_number: Option<u64>,
    pub workflow: Option<String>,
    pub branch: Option<String>,
    pub head_sha: Option<String>,
    pub pull_title: Option<String>,
    pub base: Option<String>,
    pub git_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpOutcome {
    pub stage: Stage,
    pub reason: Option<String>,
    pub message: String,
    pub audit_id: String,
}

/// A workflow as GitHub reports it, for deciding which buttons to show. Read-only.
#[derive(Debug, Clone, Serialize)]
pub struct WorkflowInfo {
    pub name: String,
    /// `active`, `disabled_manually`, `disabled_inactivity`, …
    pub state: String,
    /// Whether the file on the default branch has a `workflow_dispatch` trigger.
    pub dispatchable: bool,
    pub default_branch: Option<String>,
    pub url: Option<String>,
}

pub struct Operator {
    pub store: Arc<Store>,
    pub read: Arc<dyn GithubApi>,
    pub write: Arc<dyn OpsApi>,
    pub approver: Arc<dyn OpApprover>,
    pub actor: String,
    pub clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    in_flight: tokio::sync::Mutex<()>,
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(7)]
}

/// The first `n` characters, with an ellipsis when cut.
fn clip(t: &str, n: usize) -> String {
    if t.chars().count() <= n {
        t.to_string()
    } else {
        format!("{}…", t.chars().take(n).collect::<String>())
    }
}

/// Whether a workflow file declares a `workflow_dispatch` trigger, from the contents API body.
pub fn has_dispatch_trigger(contents: &Value) -> bool {
    let Some(b64) = contents.get("content").and_then(Value::as_str) else {
        return false;
    };
    let clean: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(clean) else {
        return false;
    };
    String::from_utf8_lossy(&bytes)
        .lines()
        .map(|l| l.split('#').next().unwrap_or(""))
        .any(|l| l.contains("workflow_dispatch"))
}

/// Turns GitHub's answer into a stage, a reason and a message for the person.
pub fn classify(
    op: &Op,
    r: &WriteResponse,
    now: DateTime<Utc>,
) -> (Stage, Option<&'static str>, String) {
    let gh = s(&r.body, "message").unwrap_or_default();
    let gh_suffix = if gh.is_empty() {
        String::new()
    } else {
        format!(": {gh}")
    };
    let limited = r.status == 429
        || (r.status == 403 && (r.rate_remaining == Some(0) || r.retry_after.is_some()));
    let token = match op.token() {
        TokenKind::Actions => "Actions token",
        TokenKind::Pulls => "pull request token for this repository",
    };
    let scope = match op.token() {
        TokenKind::Actions => "Actions: Read and write",
        TokenKind::Pulls => "Pull requests: Read and write",
    };
    match r.status {
        200..=299 => (Stage::Done, None, done_text(op)),
        _ if limited => {
            let at = r
                .retry_after
                .map(|secs| now + Duration::seconds(secs as i64))
                .or_else(|| r.rate_reset.and_then(|t| DateTime::<Utc>::from_timestamp(t as i64, 0)));
            (
                Stage::Failed,
                Some("rate_limited"),
                match at {
                    Some(t) => format!("GitHub is limiting requests. Try again after {} UTC.", t.format("%H:%M")),
                    None => "GitHub is limiting requests. Try again later.".into(),
                },
            )
        }
        401 => (
            Stage::Failed,
            Some("token_rejected"),
            format!("GitHub rejected the {token}. It may have expired or been revoked; replace it in Settings."),
        ),
        403 => (
            Stage::Failed,
            Some("forbidden"),
            format!("GitHub refused{gh_suffix}. Check that the {token} has {scope} on this repository."),
        ),
        404 => (
            Stage::Failed,
            Some("not_found"),
            format!("The {token} can't see this. Add the repository to the token on GitHub."),
        ),
        409 | 422 => (
            Stage::Failed,
            Some("refused_by_github"),
            format!("GitHub didn't accept it{gh_suffix}."),
        ),
        status => (
            Stage::Failed,
            Some("github_error"),
            format!("GitHub returned {status}{gh_suffix}. Nothing was retried; refresh to check."),
        ),
    }
}

fn done_text(op: &Op) -> String {
    match op {
        Op::CancelRun { .. } => {
            "Cancel requested. GitHub stops the run's jobs within a minute.".into()
        }
        Op::RunWorkflow { workflow } => {
            format!("Started {workflow}. The run appears after the next refresh.")
        }
        Op::PauseWorkflow { workflow } => {
            format!("Paused {workflow}. It won't run until you resume it.")
        }
        Op::ResumeWorkflow { workflow } => format!("Resumed {workflow}."),
        Op::ClosePull { number } => format!("Closed #{number}."),
        Op::ReopenPull { number } => format!("Reopened #{number}."),
        Op::CommentPull { number, .. } => format!("Commented on #{number}."),
    }
}

impl Operator {
    pub fn new(
        store: Arc<Store>,
        read: Arc<dyn GithubApi>,
        write: Arc<dyn OpsApi>,
        approver: Arc<dyn OpApprover>,
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
        op: &Op,
        p: Option<&OpPreview>,
        stage: Stage,
    ) -> AuditRecord {
        let c = self.store.load_config();
        let login = match op.token() {
            TokenKind::Actions => c.token_login,
            TokenKind::Pulls => c
                .merge_pull_requests
                .token_logins
                .get(&repo.to_ascii_lowercase())
                .cloned(),
        };
        AuditRecord {
            id: id.to_string(),
            at: (self.clock)(),
            action: op.action().into(),
            actor: self.actor.clone(),
            github_login: login,
            repo: repo.to_string(),
            run_id: match op {
                Op::CancelRun { run_id } => *run_id,
                _ => 0,
            },
            pull_number: op.number(),
            title: p.and_then(|p| p.pull_title.clone()),
            base: p.and_then(|p| p.base.clone()),
            workflow: p
                .and_then(|p| p.workflow.clone())
                .or_else(|| op.workflow().map(str::to_owned)),
            run_number: p.and_then(|p| p.run_number),
            attempt_before: None,
            head_sha: p.and_then(|p| p.head_sha.clone()),
            branch: p.and_then(|p| p.branch.clone().or_else(|| p.git_ref.clone())),
            stage,
            reason: None,
            http_status: None,
            request_id: None,
            message: None,
            detail: match op {
                Op::CommentPull { body, .. } => Some(body.clone()),
                _ => None,
            },
        }
    }

    fn stop(&self, mut r: AuditRecord, reason: &str, message: String) -> OpOutcome {
        let stage = r.stage;
        r.reason = Some(reason.into());
        r.message = Some(message.clone());
        // A refusal sends nothing, so a failed log write doesn't change the outcome.
        let _ = self.store.append(&r);
        OpOutcome {
            stage,
            reason: Some(reason.into()),
            message,
            audit_id: r.id,
        }
    }

    async fn get(&self, path: &str, what: &str) -> Result<Value, (&'static str, String)> {
        let r = self.read.get(path).await.map_err(|e| {
            (
                "preflight_failed",
                format!("Couldn't check the {what} on GitHub: {e}"),
            )
        })?;
        match r.status {
            200 => Ok(r.body),
            404 => Err((
                "not_found",
                format!("GitHub can't find that {what}. Refresh and try again."),
            )),
            st => Err((
                "preflight_failed",
                format!("Couldn't check the {what} on GitHub (status {st})."),
            )),
        }
    }

    /// The workflow, its default branch and whether it can be started by hand. Read-only.
    pub async fn workflow_info(&self, repo: &str, workflow: &str) -> Result<WorkflowInfo, String> {
        if !valid_repo(repo) || !valid_workflow(workflow) {
            return Err("That isn't a valid repository and workflow file.".into());
        }
        let wf = self
            .get(
                &format!("/repos/{repo}/actions/workflows/{workflow}"),
                "workflow",
            )
            .await
            .map_err(|(_, m)| m)?;
        let default_branch = self
            .get(&format!("/repos/{repo}"), "repository")
            .await
            .ok()
            .and_then(|r| s(&r, "default_branch"));
        let path = s(&wf, "path").unwrap_or_else(|| format!(".github/workflows/{workflow}"));
        let dispatchable = if path.starts_with(".github/workflows/")
            && path
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "/-_.".contains(c))
        {
            self.get(&format!("/repos/{repo}/contents/{path}"), "workflow file")
                .await
                .map(|c| has_dispatch_trigger(&c))
                .unwrap_or(false)
        } else {
            false
        };
        Ok(WorkflowInfo {
            name: s(&wf, "name").unwrap_or_else(|| workflow.to_string()),
            state: s(&wf, "state").unwrap_or_default(),
            dispatchable,
            default_branch,
            url: s(&wf, "html_url"),
        })
    }

    /// Reads the target as it is now and builds what the dialog shows. `Err` is a refusal.
    async fn preflight(&self, repo: &str, op: &Op) -> Result<OpPreview, (&'static str, String)> {
        match op {
            Op::CancelRun { run_id } => {
                let run = self
                    .get(&format!("/repos/{repo}/actions/runs/{run_id}"), "run")
                    .await?;
                let full = run
                    .pointer("/repository/full_name")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if !full.eq_ignore_ascii_case(repo) {
                    return Err((
                        "repo_mismatch",
                        "GitHub returned a run from a different repository.".into(),
                    ));
                }
                let status = s(&run, "status").unwrap_or_default();
                if !matches!(
                    status.as_str(),
                    "queued" | "in_progress" | "waiting" | "pending" | "requested"
                ) {
                    return Err((
                        "not_running",
                        "This run has already finished, so there's nothing to cancel.".into(),
                    ));
                }
                let name = s(&run, "name").unwrap_or_else(|| "Workflow".into());
                let number = run.get("run_number").and_then(Value::as_u64);
                let branch = s(&run, "head_branch");
                let sha = s(&run, "head_sha");
                let mut line = match number {
                    Some(n) => format!("Run #{n}, {}", status.replace('_', " ")),
                    None => format!("Run {run_id}, {}", status.replace('_', " ")),
                };
                if let Some(b) = &branch {
                    line.push_str(&format!(", branch {b}"));
                }
                if let Some(h) = &sha {
                    line.push_str(&format!(", commit {}", short(h)));
                }
                Ok(OpPreview {
                    title: "Cancel this workflow run?".into(),
                    text: format!("{name} · {repo}\n{line}\n\nGitHub stops the jobs that are still running. Finished jobs keep their results."),
                    button: "Cancel run".into(),
                    reason: format!("cancel {name} run on {repo}"),
                    run_id: *run_id,
                    run_number: number,
                    workflow: Some(name),
                    branch,
                    head_sha: sha,
                    ..Default::default()
                })
            }
            Op::RunWorkflow { workflow }
            | Op::PauseWorkflow { workflow }
            | Op::ResumeWorkflow { workflow } => {
                if !valid_workflow(workflow) {
                    return Err((
                        "invalid_workflow",
                        "That isn't a workflow file name.".into(),
                    ));
                }
                let info = self
                    .workflow_info(repo, workflow)
                    .await
                    .map_err(|m| ("preflight_failed", m))?;
                let label = format!("{} ({workflow}) · {repo}", info.name);
                match op {
                    Op::RunWorkflow { .. } => {
                        if info.state != "active" {
                            return Err((
                                "workflow_paused",
                                "This workflow is paused. Resume it first.".into(),
                            ));
                        }
                        if !info.dispatchable {
                            return Err(("not_dispatchable", "This workflow can't be started by hand: its file has no workflow_dispatch trigger.".into()));
                        }
                        let branch = info.default_branch.filter(|b| valid_ref(b)).ok_or((
                            "preflight_failed",
                            "Couldn't read the repository's default branch.".to_string(),
                        ))?;
                        Ok(OpPreview {
                            title: "Run this workflow?".into(),
                            text: format!("{label}\nOn branch {branch}, with the workflow's default inputs.\n\nThis starts a new run on GitHub Actions and uses runner minutes. It runs whatever the workflow does, including deploys."),
                            button: "Run workflow".into(),
                            reason: format!("run {} on {repo}", info.name),
                            workflow: Some(workflow.clone()),
                            git_ref: Some(branch),
                            ..Default::default()
                        })
                    }
                    Op::PauseWorkflow { .. } => {
                        if info.state != "active" {
                            return Err((
                                "already_paused",
                                "This workflow is already paused.".into(),
                            ));
                        }
                        Ok(OpPreview {
                            title: "Pause this workflow?".into(),
                            text: format!("{label}\n\nGitHub stops starting new runs of it: no schedules, pushes or manual runs until you resume it. Runs already going carry on."),
                            button: "Pause".into(),
                            reason: format!("pause {} on {repo}", info.name),
                            workflow: Some(workflow.clone()),
                            ..Default::default()
                        })
                    }
                    _ => {
                        if info.state == "active" {
                            return Err((
                                "already_active",
                                "This workflow is already running normally.".into(),
                            ));
                        }
                        Ok(OpPreview {
                            title: "Resume this workflow?".into(),
                            text: format!("{label}\n\nGitHub starts running it again on its usual triggers, including any schedule."),
                            button: "Resume".into(),
                            reason: format!("resume {} on {repo}", info.name),
                            workflow: Some(workflow.clone()),
                            ..Default::default()
                        })
                    }
                }
            }
            Op::ClosePull { number }
            | Op::ReopenPull { number }
            | Op::CommentPull { number, .. } => {
                let pr = self
                    .get(&format!("/repos/{repo}/pulls/{number}"), "pull request")
                    .await?;
                let full = pr
                    .pointer("/base/repo/full_name")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if !full.eq_ignore_ascii_case(repo) {
                    return Err((
                        "repo_mismatch",
                        "GitHub returned a pull request from a different repository.".into(),
                    ));
                }
                let title = s(&pr, "title").unwrap_or_default();
                let state = s(&pr, "state").unwrap_or_default();
                let merged = pr.get("merged").and_then(Value::as_bool).unwrap_or(false);
                let base = pr
                    .pointer("/base/ref")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let head = pr
                    .pointer("/head/ref")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let sha = pr
                    .pointer("/head/sha")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let author = pr
                    .pointer("/user/login")
                    .and_then(Value::as_str)
                    .unwrap_or("someone");
                let label = format!(
                    "#{number} {title}\n{repo} · {} into {} · by {author}",
                    head.as_deref().unwrap_or("?"),
                    base.as_deref().unwrap_or("?")
                );
                let base_preview = OpPreview {
                    pull_title: Some(title.clone()),
                    base: base.clone(),
                    branch: head,
                    head_sha: sha,
                    ..Default::default()
                };
                match op {
                    Op::ClosePull { .. } => {
                        if state != "open" {
                            return Err(("not_open", "This pull request isn't open.".into()));
                        }
                        Ok(OpPreview {
                            title: format!("Close pull request #{number}?"),
                            text: format!("{label}\n\nCloses it without merging. The branch is kept and you can reopen it."),
                            button: "Close".into(),
                            reason: format!("close pull request #{number} on {repo}"),
                            ..base_preview
                        })
                    }
                    Op::ReopenPull { .. } => {
                        if merged {
                            return Err(("merged", "This pull request was merged, so it can't be reopened.".into()));
                        }
                        if state != "closed" {
                            return Err(("not_closed", "This pull request is already open.".into()));
                        }
                        Ok(OpPreview {
                            title: format!("Reopen pull request #{number}?"),
                            text: format!("{label}\n\nReopens it as it was when it was closed."),
                            button: "Reopen".into(),
                            reason: format!("reopen pull request #{number} on {repo}"),
                            ..base_preview
                        })
                    }
                    Op::CommentPull { body, .. } => Ok(OpPreview {
                        title: format!("Comment on pull request #{number}?"),
                        text: format!("{label}\n\nPosts this as you, publicly visible to anyone who can see the pull request:\n\n{}", clip(body.trim(), 600)),
                        button: "Post comment".into(),
                        reason: format!("comment on pull request #{number} on {repo}"),
                        ..base_preview
                    }),
                    _ => unreachable!(),
                }
            }
        }
    }

    pub async fn run(&self, repo: &str, op: Op) -> OpOutcome {
        let id = uuid::Uuid::new_v4().to_string();
        let refuse = |p: Option<&OpPreview>, reason: &str, msg: String| {
            self.stop(self.record(&id, repo, &op, p, Stage::Refused), reason, msg)
        };

        if !valid_repo(repo) {
            return refuse(
                None,
                "invalid_repo",
                "That isn't a valid owner/name repository.".into(),
            );
        }
        if let Some(w) = op.workflow() {
            if !valid_workflow(w) {
                return refuse(
                    None,
                    "invalid_workflow",
                    "That isn't a workflow file name.".into(),
                );
            }
        }
        if let Op::CommentPull { body, .. } = &op {
            if body.trim().is_empty() {
                return refuse(None, "empty_comment", "Write a comment first.".into());
            }
            if body.chars().count() > MAX_COMMENT_CHARS {
                return refuse(
                    None,
                    "comment_too_long",
                    format!("Comments from Atlas are limited to {MAX_COMMENT_CHARS} characters."),
                );
            }
        }
        if matches!(op, Op::RunWorkflow { .. }) && is_self_repo(repo) {
            return refuse(None, "self_repo", "Atlas doesn't start its own workflows: a run would publish a release. Start it on GitHub if you mean to.".into());
        }
        let Ok(_guard) = self.in_flight.try_lock() else {
            return refuse(
                None,
                "busy",
                "Another action is already running. Wait for it to finish.".into(),
            );
        };
        let config = self.store.load_config();
        if !config.switch(op.group()).enabled {
            return refuse(
                None,
                "disabled",
                "This action is off. Turn it on in Settings.".into(),
            );
        }
        if !config.allows_op(op.group(), repo) {
            return refuse(
                None,
                "repo_not_enabled",
                "This repository isn't ticked for this action in Settings.".into(),
            );
        }
        if !self.write.has_op_token(op.token(), repo).await {
            return refuse(
                None,
                "no_token",
                match op.token() {
                    TokenKind::Actions => "Add an Actions token in Settings first.".into(),
                    TokenKind::Pulls => {
                        "Save a pull request token for this repository in Settings first.".into()
                    }
                },
            );
        }

        let preview = match self.preflight(repo, &op).await {
            Ok(p) => p,
            Err((reason, msg)) => return refuse(None, reason, msg),
        };
        let p = Some(&preview);
        let now = (self.clock)();
        if let Some(msg) = op_rate_block(&self.store.audit(), op.action(), repo, &op.target(), now)
        {
            return refuse(p, "rate_capped", msg);
        }

        if !self
            .approver
            .approve(&preview.title, &preview.text, &preview.button)
            .await
        {
            return self.stop(
                self.record(&id, repo, &op, p, Stage::Cancelled),
                "cancelled",
                "Cancelled. Nothing was sent to GitHub.".into(),
            );
        }
        if let Err(e) = self.approver.confirm_owner(&preview.reason).await {
            return self.stop(
                self.record(&id, repo, &op, p, Stage::Cancelled),
                "touch_id",
                format!("{e} Nothing was sent to GitHub."),
            );
        }

        // Fail closed: no audit record, no request.
        if let Err(e) = self
            .store
            .append(&self.record(&id, repo, &op, p, Stage::Attempted))
        {
            return OpOutcome {
                stage: Stage::Failed,
                reason: Some("audit_unavailable".into()),
                message: format!("{e}. Nothing was sent to GitHub."),
                audit_id: id,
            };
        }

        let mut result = self.record(&id, repo, &op, p, Stage::Failed);
        let (stage, reason, message) = match self
            .write
            .send_op(repo, &op, preview.git_ref.as_deref())
            .await
        {
            Ok(resp) => {
                result.http_status = Some(resp.status);
                result.request_id = resp.request_id.clone();
                classify(&op, &resp, (self.clock)())
            }
            Err(SendError::NotSent(e)) => (
                Stage::Failed,
                Some("network"),
                format!("{e}. Nothing reached GitHub."),
            ),
            Err(SendError::Unknown(e)) => (
                Stage::Unknown,
                Some("unknown"),
                format!("{e}. GitHub may or may not have taken it; refresh before trying again."),
            ),
        };
        result.stage = stage;
        result.reason = reason.map(str::to_owned);
        result.message = Some(message.clone());
        result.at = (self.clock)();
        let message = match self.store.append(&result) {
            Ok(()) => message,
            Err(e) => format!("{message} (The result couldn't be added to the audit log: {e}.)"),
        };
        OpOutcome {
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
    use crate::actions::store::{ActionsConfig, SELF_REPO};
    use crate::intel::collect::GhResponse;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    const REPO: &str = "khaneilcampbell/benjaire.com";

    fn now() -> DateTime<Utc> {
        "2026-10-28T10:00:00Z".parse().unwrap()
    }

    fn b64(t: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(t)
    }

    struct FakeRead {
        bodies: Mutex<HashMap<String, Value>>,
        calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl GithubApi for FakeRead {
        async fn get(&self, path: &str) -> Result<GhResponse, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let body = self.bodies.lock().unwrap().get(path).cloned();
            Ok(GhResponse {
                status: if body.is_some() { 200 } else { 404 },
                body: body.unwrap_or(Value::Null),
                rate_remaining: None,
                rate_reset: None,
            })
        }
        async fn has_token(&self) -> bool {
            true
        }
    }

    struct FakeWrite {
        tokens: (bool, bool),
        status: u16,
        sent: Mutex<Vec<(String, Op, Option<String>)>>,
    }

    #[async_trait::async_trait]
    impl OpsApi for FakeWrite {
        async fn has_op_token(&self, kind: TokenKind, _repo: &str) -> bool {
            match kind {
                TokenKind::Actions => self.tokens.0,
                TokenKind::Pulls => self.tokens.1,
            }
        }
        async fn send_op(
            &self,
            repo: &str,
            op: &Op,
            git_ref: Option<&str>,
        ) -> Result<WriteResponse, SendError> {
            self.sent
                .lock()
                .unwrap()
                .push((repo.into(), op.clone(), git_ref.map(str::to_owned)));
            Ok(WriteResponse {
                status: self.status,
                body: if self.status < 300 {
                    Value::Null
                } else {
                    json!({ "message": "nope" })
                },
                request_id: Some("R:1".into()),
                rate_remaining: Some(4000),
                rate_reset: None,
                retry_after: None,
            })
        }
    }

    struct FakeApprover {
        answer: bool,
        touch: Result<(), String>,
        seen: Mutex<Vec<(String, String)>>,
    }

    #[async_trait::async_trait]
    impl OpApprover for FakeApprover {
        async fn approve(&self, title: &str, text: &str, _button: &str) -> bool {
            self.seen.lock().unwrap().push((title.into(), text.into()));
            self.answer
        }
        async fn confirm_owner(&self, _reason: &str) -> Result<(), String> {
            self.touch.clone()
        }
    }

    struct Rig {
        _dir: tempfile::TempDir,
        store: Arc<Store>,
        read: Arc<FakeRead>,
        write: Arc<FakeWrite>,
        approver: Arc<FakeApprover>,
        o: Operator,
    }

    fn fixtures(repo: &str) -> HashMap<String, Value> {
        let mut m = HashMap::new();
        m.insert(
            format!("/repos/{repo}/actions/runs/7"),
            json!({ "name": "Site CI", "run_number": 12, "status": "in_progress", "head_branch": "main",
                    "head_sha": "a1b2c3d4e5f6", "repository": { "full_name": repo } }),
        );
        m.insert(
            format!("/repos/{repo}/actions/runs/8"),
            json!({ "name": "Site CI", "status": "completed", "repository": { "full_name": repo } }),
        );
        m.insert(
            format!("/repos/{repo}/actions/workflows/site-ci.yml"),
            json!({ "name": "Site CI", "state": "active", "path": ".github/workflows/site-ci.yml" }),
        );
        m.insert(
            format!("/repos/{repo}/actions/workflows/nightly.yml"),
            json!({ "name": "Nightly", "state": "disabled_manually", "path": ".github/workflows/nightly.yml" }),
        );
        m.insert(
            format!("/repos/{repo}"),
            json!({ "default_branch": "main" }),
        );
        m.insert(
            format!("/repos/{repo}/contents/.github/workflows/site-ci.yml"),
            json!({ "content": b64("on:\n  push:\n  workflow_dispatch:\n") }),
        );
        m.insert(
            format!("/repos/{repo}/contents/.github/workflows/nightly.yml"),
            json!({ "content": b64("on:\n  schedule: [{cron: '0 0 * * *'}]\n  # workflow_dispatch later\n") }),
        );
        for (n, state, merged) in [
            (3, "open", false),
            (4, "closed", false),
            (5, "closed", true),
        ] {
            m.insert(
                format!("/repos/{repo}/pulls/{n}"),
                json!({ "title": "Fix footer", "state": state, "merged": merged, "user": { "login": "dependabot" },
                        "base": { "ref": "main", "repo": { "full_name": repo } },
                        "head": { "ref": "fix", "sha": "f00d" } }),
            );
        }
        m
    }

    fn rig_with(
        groups: &[Group],
        repos: &[&str],
        tokens: (bool, bool),
        status: u16,
        approve: bool,
        touch: Result<(), String>,
    ) -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(dir.path().to_path_buf()).unwrap());
        let mut c = ActionsConfig::default();
        for g in groups {
            let sw = c.switch_mut(*g);
            sw.enabled = true;
            sw.repos = repos.iter().map(|s| s.to_string()).collect();
        }
        c.token_login = Some("khaneilcampbell".into());
        store.save_config(&c).unwrap();
        let mut bodies = fixtures(REPO);
        bodies.extend(fixtures(SELF_REPO));
        let read = Arc::new(FakeRead {
            bodies: Mutex::new(bodies),
            calls: AtomicUsize::new(0),
        });
        let write = Arc::new(FakeWrite {
            tokens,
            status,
            sent: Mutex::new(vec![]),
        });
        let approver = Arc::new(FakeApprover {
            answer: approve,
            touch,
            seen: Mutex::new(vec![]),
        });
        let o = Operator::new(
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
            o,
        }
    }

    const ALL: [Group; 4] = [
        Group::CancelRuns,
        Group::RunWorkflows,
        Group::PauseWorkflows,
        Group::PullRequestChanges,
    ];

    fn rig() -> Rig {
        rig_with(&ALL, &[REPO, SELF_REPO], (true, true), 204, true, Ok(()))
    }

    fn sent(r: &Rig) -> usize {
        r.write.sent.lock().unwrap().len()
    }

    fn stages(r: &Rig) -> Vec<Stage> {
        r.store.audit().iter().map(|a| a.stage).collect()
    }

    #[tokio::test]
    async fn each_op_is_checked_approved_logged_and_sent_once() {
        let cases = [
            Op::CancelRun { run_id: 7 },
            Op::RunWorkflow {
                workflow: "site-ci.yml".into(),
            },
            Op::PauseWorkflow {
                workflow: "site-ci.yml".into(),
            },
            Op::ResumeWorkflow {
                workflow: "nightly.yml".into(),
            },
            Op::ClosePull { number: 3 },
            Op::ReopenPull { number: 4 },
            Op::CommentPull {
                number: 3,
                body: "Looks good, merging after lunch.".into(),
            },
        ];
        for op in cases {
            let r = rig();
            let o = r.o.run(REPO, op.clone()).await;
            assert_eq!(o.stage, Stage::Done, "{op:?}: {}", o.message);
            assert_eq!(sent(&r), 1, "{op:?}");
            assert_eq!(stages(&r), vec![Stage::Attempted, Stage::Done], "{op:?}");
            let log = r.store.audit();
            assert_eq!(log[0].id, log[1].id);
            assert_eq!(log[1].action, op.action());
            assert_eq!(log[1].http_status, Some(204));
            assert_eq!(r.approver.seen.lock().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn dispatch_runs_on_the_default_branch_and_comment_is_logged() {
        let r = rig();
        r.o.run(
            REPO,
            Op::RunWorkflow {
                workflow: "site-ci.yml".into(),
            },
        )
        .await;
        assert_eq!(r.write.sent.lock().unwrap()[0].2.as_deref(), Some("main"));
        assert_eq!(r.store.audit()[1].branch.as_deref(), Some("main"));

        let r = rig();
        r.o.run(
            REPO,
            Op::CommentPull {
                number: 3,
                body: "Ship it".into(),
            },
        )
        .await;
        let log = r.store.audit();
        assert_eq!(log[1].detail.as_deref(), Some("Ship it"));
        assert_eq!(log[1].pull_number, Some(3));
        assert_eq!(log[1].title.as_deref(), Some("Fix footer"));
        assert!(
            r.approver.seen.lock().unwrap()[0].1.contains("Ship it"),
            "the dialog shows the text"
        );
    }

    #[tokio::test]
    async fn switches_repos_and_tokens_stop_before_any_read() {
        let op = Op::CancelRun { run_id: 7 };
        for (groups, repos, tokens, reason) in [
            (vec![], vec![REPO], (true, true), "disabled"),
            (
                vec![Group::RunWorkflows],
                vec![REPO],
                (true, true),
                "disabled",
            ),
            (
                vec![Group::CancelRuns],
                vec!["o/other"],
                (true, true),
                "repo_not_enabled",
            ),
            (
                vec![Group::CancelRuns],
                vec![REPO],
                (false, true),
                "no_token",
            ),
        ] {
            let r = rig_with(&groups, &repos, tokens, 202, true, Ok(()));
            let o = r.o.run(REPO, op.clone()).await;
            assert_eq!(o.reason.as_deref(), Some(reason));
            assert_eq!(r.read.calls.load(Ordering::SeqCst), 0, "{reason}");
            assert_eq!(sent(&r), 0);
            assert_eq!(stages(&r), vec![Stage::Refused]);
        }
        // Pull request changes need the repository's own token, not the Actions one.
        let r = rig_with(&ALL, &[REPO], (true, false), 200, true, Ok(()));
        let o = r.o.run(REPO, Op::ClosePull { number: 3 }).await;
        assert_eq!(o.reason.as_deref(), Some("no_token"));
    }

    #[tokio::test]
    async fn preflight_refuses_what_cannot_be_done() {
        for (op, reason) in [
            (Op::CancelRun { run_id: 8 }, "not_running"),
            (Op::CancelRun { run_id: 99 }, "not_found"),
            (
                Op::RunWorkflow {
                    workflow: "nightly.yml".into(),
                },
                "workflow_paused",
            ),
            (
                Op::PauseWorkflow {
                    workflow: "nightly.yml".into(),
                },
                "already_paused",
            ),
            (
                Op::ResumeWorkflow {
                    workflow: "site-ci.yml".into(),
                },
                "already_active",
            ),
            (Op::ClosePull { number: 4 }, "not_open"),
            (Op::ReopenPull { number: 3 }, "not_closed"),
            (Op::ReopenPull { number: 5 }, "merged"),
            (
                Op::RunWorkflow {
                    workflow: "../x.yml".into(),
                },
                "invalid_workflow",
            ),
            (
                Op::CommentPull {
                    number: 3,
                    body: "  ".into(),
                },
                "empty_comment",
            ),
            (
                Op::CommentPull {
                    number: 3,
                    body: "x".repeat(MAX_COMMENT_CHARS + 1),
                },
                "comment_too_long",
            ),
        ] {
            let r = rig();
            let o = r.o.run(REPO, op.clone()).await;
            assert_eq!(
                (o.stage, o.reason.as_deref()),
                (Stage::Refused, Some(reason)),
                "{op:?}"
            );
            assert_eq!(sent(&r), 0);
            assert!(
                r.approver.seen.lock().unwrap().is_empty(),
                "{op:?}: no dialog"
            );
        }
    }

    #[tokio::test]
    async fn a_workflow_without_a_dispatch_trigger_is_not_started() {
        let r = rig();
        r.read.bodies.lock().unwrap().insert(
            format!("/repos/{REPO}/actions/workflows/nightly.yml"),
            json!({ "name": "Nightly", "state": "active", "path": ".github/workflows/nightly.yml" }),
        );
        let o =
            r.o.run(
                REPO,
                Op::RunWorkflow {
                    workflow: "nightly.yml".into(),
                },
            )
            .await;
        assert_eq!(o.reason.as_deref(), Some("not_dispatchable"));
        assert_eq!(sent(&r), 0);
    }

    #[tokio::test]
    async fn atlas_never_starts_its_own_workflows_but_can_cancel_and_pause_them() {
        let r = rig();
        let o =
            r.o.run(
                SELF_REPO,
                Op::RunWorkflow {
                    workflow: "site-ci.yml".into(),
                },
            )
            .await;
        assert_eq!(o.reason.as_deref(), Some("self_repo"));
        assert_eq!(r.read.calls.load(Ordering::SeqCst), 0);
        assert_eq!(
            r.o.run(SELF_REPO, Op::CancelRun { run_id: 7 }).await.stage,
            Stage::Done
        );
        assert_eq!(
            r.o.run(
                SELF_REPO,
                Op::PauseWorkflow {
                    workflow: "site-ci.yml".into()
                }
            )
            .await
            .stage,
            Stage::Done
        );
    }

    #[tokio::test]
    async fn cancelling_the_dialog_or_touch_id_sends_nothing() {
        let r = rig_with(&ALL, &[REPO], (true, true), 202, false, Ok(()));
        assert_eq!(
            r.o.run(REPO, Op::CancelRun { run_id: 7 }).await.stage,
            Stage::Cancelled
        );
        assert_eq!(sent(&r), 0);

        let r = rig_with(
            &ALL,
            &[REPO],
            (true, true),
            202,
            true,
            Err("Touch ID was cancelled.".into()),
        );
        let o = r.o.run(REPO, Op::CancelRun { run_id: 7 }).await;
        assert_eq!(
            (o.stage, o.reason.as_deref()),
            (Stage::Cancelled, Some("touch_id"))
        );
        assert_eq!(sent(&r), 0);
        assert_eq!(stages(&r), vec![Stage::Cancelled]);
    }

    #[tokio::test]
    async fn the_same_change_is_not_sent_twice_in_a_row() {
        let r = rig();
        assert_eq!(
            r.o.run(REPO, Op::ClosePull { number: 3 }).await.stage,
            Stage::Done
        );
        let o =
            r.o.run(
                REPO,
                Op::CommentPull {
                    number: 3,
                    body: "x".into(),
                },
            )
            .await;
        assert_eq!(
            o.stage,
            Stage::Done,
            "a different change to the same PR is fine"
        );
        let o = r.o.run(REPO, Op::ClosePull { number: 3 }).await;
        assert_eq!(o.reason.as_deref(), Some("rate_capped"));
        assert_eq!(sent(&r), 2);
    }

    #[tokio::test]
    async fn github_errors_are_reported_not_retried() {
        let r = rig_with(&ALL, &[REPO], (true, true), 403, true, Ok(()));
        let o =
            r.o.run(
                REPO,
                Op::PauseWorkflow {
                    workflow: "site-ci.yml".into(),
                },
            )
            .await;
        assert_eq!(
            (o.stage, o.reason.as_deref()),
            (Stage::Failed, Some("forbidden"))
        );
        assert!(
            o.message.contains("Actions: Read and write"),
            "{}",
            o.message
        );
        assert_eq!(sent(&r), 1);
        assert_eq!(stages(&r), vec![Stage::Attempted, Stage::Failed]);
    }

    #[test]
    fn workflow_names_and_refs_are_strict() {
        for ok in ["ci.yml", "site-ci.yaml", "codeql_v2.yml"] {
            assert!(valid_workflow(ok), "{ok}");
        }
        for bad in [
            "",
            "ci",
            ".yml",
            "../ci.yml",
            "a/ci.yml",
            "ci.yml?x=1",
            "ci.yml/disable",
        ] {
            assert!(!valid_workflow(bad), "{bad:?}");
        }
        assert!(valid_ref("main") && valid_ref("release/1.2"));
        for bad in ["", "-x", "a..b", "a b", "a?x"] {
            assert!(!valid_ref(bad), "{bad:?}");
        }
    }

    #[test]
    fn dispatch_trigger_ignores_comments() {
        assert!(has_dispatch_trigger(
            &json!({ "content": b64("on: [workflow_dispatch]") })
        ));
        assert!(!has_dispatch_trigger(
            &json!({ "content": b64("on: push # workflow_dispatch") })
        ));
        assert!(!has_dispatch_trigger(&json!({})));
    }
}
