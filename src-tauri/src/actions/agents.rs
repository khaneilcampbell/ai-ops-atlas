//! Manage agents: enable, disable or start one of the agents on the allow-list in
//! `src/manage/agents.json`, which is compiled into the app. The web view sends only an agent
//! id and one of three operations; the repository and workflow file come from the allow-list,
//! never from the page. Every press reads the workflow's state again, shows the before and
//! after in a native dialog, asks for Touch ID, and is written to the audit log before the
//! single request is sent.

use super::rerun::{SendError, WriteResponse};
use super::store::{
    agent_rate_block, AuditRecord, Stage, Store, ACTION_AGENT_DISABLE, ACTION_AGENT_ENABLE,
    ACTION_AGENT_RUN,
};
use crate::intel::collect::{valid_repo, GithubApi};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

/// The allow-list, shared with the web view's Manage agents tab.
const MANIFEST_JSON: &str = include_str!("../../../src/manage/agents.json");
/// Runs started from Atlas always use the default branch.
pub const RUN_BRANCH: &str = "main";

#[derive(Debug, Clone, Deserialize)]
pub struct ManagedCap {
    pub usd: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManagedAgent {
    pub id: String,
    pub workflow: String,
    #[serde(default)]
    pub paid: bool,
    pub cap: Option<ManagedCap>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub repository: String,
    pub agents: Vec<ManagedAgent>,
}

pub fn manifest() -> Manifest {
    serde_json::from_str(MANIFEST_JSON).expect("src/manage/agents.json is valid")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentOp {
    Enable,
    Disable,
    RunNow,
}

impl AgentOp {
    fn action(self) -> &'static str {
        match self {
            AgentOp::Enable => ACTION_AGENT_ENABLE,
            AgentOp::Disable => ACTION_AGENT_DISABLE,
            AgentOp::RunNow => ACTION_AGENT_RUN,
        }
    }
}

/// The three writes Manage agents can make. Implemented by the Keychain-backed client.
#[async_trait::async_trait]
pub trait AgentWriteApi: Send + Sync {
    async fn has_token(&self) -> bool;
    async fn workflow_op(
        &self,
        repo: &str,
        workflow: &str,
        op: AgentOp,
        branch: &str,
    ) -> Result<WriteResponse, SendError>;
}

/// Asks the person at the Mac: a native dialog, then Touch ID.
#[async_trait::async_trait]
pub trait AgentApprover: Send + Sync {
    async fn approve(&self, p: &AgentPreview) -> bool;
    async fn confirm_owner(&self, p: &AgentPreview) -> Result<(), String>;
}

/// What the person approves: the workflow as GitHub reports it right before the request.
#[derive(Debug, Clone, Serialize)]
pub struct AgentPreview {
    pub agent: String,
    pub op: AgentOp,
    pub repo: String,
    pub workflow: String,
    /// GitHub's state now: `active`, `disabled_manually` or `disabled_inactivity`.
    pub state: String,
    pub before: String,
    pub after: String,
    pub paid: bool,
    pub cap_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentOutcome {
    pub stage: Stage,
    pub reason: Option<String>,
    pub message: String,
    pub audit_id: String,
}

fn enabled(state: &str) -> bool {
    state == "active"
}

fn state_words(state: &str) -> &'static str {
    match state {
        "active" => "Enabled",
        "disabled_manually" => "Disabled",
        "disabled_inactivity" => "Disabled by GitHub after 60 days without activity",
        _ => "Unknown",
    }
}

/// Before and after, in words, for the dialog and the audit log.
pub fn diff(op: AgentOp, state: &str) -> (String, String) {
    let before = state_words(state).to_string();
    let after = match op {
        AgentOp::Enable => "Enabled: runs on its schedule and its other triggers again".to_string(),
        AgentOp::Disable => {
            "Disabled: no scheduled, triggered or manual runs until it is enabled again".to_string()
        }
        AgentOp::RunNow => format!("{before}, plus one run starting now on {RUN_BRANCH}"),
    };
    (before, after)
}

pub fn dialog_text(p: &AgentPreview) -> String {
    let mut lines = vec![
        format!("{} · {}", p.repo, p.workflow),
        String::new(),
        format!("Before: {}", p.before),
        format!("After: {}", p.after),
        String::new(),
    ];
    lines.push(match p.op {
        AgentOp::Enable => "Undo: Disable it again from Manage agents.".to_string(),
        AgentOp::Disable => "Undo: Enable it again from Manage agents.".to_string(),
        AgentOp::RunNow => {
            let cost = match (p.paid, p.cap_usd) {
                (true, Some(cap)) => format!(
                    " It may call a paid API, within its ${cap:.2} monthly cap."
                ),
                (true, None) => " It may call a paid API.".to_string(),
                _ => String::new(),
            };
            format!("Uses its default inputs and GitHub runner minutes.{cost} Cancel the run on GitHub to stop it.")
        }
    });
    lines.join("\n")
}

/// Turns GitHub's answer into a stage, a reason and a message for the person.
pub fn classify(r: &WriteResponse, p: &AgentPreview) -> (Stage, Option<&'static str>, String) {
    let gh = r
        .body
        .get("message")
        .and_then(Value::as_str)
        .map(|m| format!(": {m}"))
        .unwrap_or_default();
    let limited = r.status == 429
        || (r.status == 403 && (r.rate_remaining == Some(0) || r.retry_after.is_some()));
    match (r.status, p.op) {
        (200 | 204, AgentOp::RunNow) => (
            Stage::Started,
            None,
            format!("Started a run of {} on {RUN_BRANCH}. It shows up under recent runs in a few seconds.", p.workflow),
        ),
        (200 | 204, AgentOp::Enable) => (Stage::Changed, None, format!("Enabled {}.", p.workflow)),
        (200 | 204, AgentOp::Disable) => (Stage::Changed, None, format!("Disabled {}.", p.workflow)),
        _ if limited => (
            Stage::Failed,
            Some("rate_limited"),
            "GitHub is limiting requests. Try again later.".into(),
        ),
        (401, _) => (
            Stage::Failed,
            Some("token_rejected"),
            "GitHub rejected the Manage agents token. It may have expired; replace it in Settings.".into(),
        ),
        (403, _) => (
            Stage::Failed,
            Some("forbidden"),
            format!("GitHub refused{gh}. Check the token has Actions: Read and write on {}.", p.repo),
        ),
        (404, _) => (
            Stage::Failed,
            Some("not_found"),
            format!("The token can't see {} or {}. Add the repository to the token on GitHub.", p.repo, p.workflow),
        ),
        (422, _) => (
            Stage::Failed,
            Some("not_allowed"),
            format!("GitHub can't do that right now{gh}."),
        ),
        (status, _) => (
            Stage::Failed,
            Some("github_error"),
            format!("GitHub returned {status}{gh}. Refresh to check the agent."),
        ),
    }
}

pub struct AgentManager {
    pub store: Arc<Store>,
    pub read: Arc<dyn GithubApi>,
    pub write: Arc<dyn AgentWriteApi>,
    pub approver: Arc<dyn AgentApprover>,
    pub actor: String,
    pub clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    pub manifest: Manifest,
    in_flight: tokio::sync::Mutex<()>,
}

impl AgentManager {
    pub fn new(
        store: Arc<Store>,
        read: Arc<dyn GithubApi>,
        write: Arc<dyn AgentWriteApi>,
        approver: Arc<dyn AgentApprover>,
        actor: String,
        clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
        manifest: Manifest,
    ) -> Self {
        Self {
            store,
            read,
            write,
            approver,
            actor,
            clock,
            manifest,
            in_flight: tokio::sync::Mutex::new(()),
        }
    }

    fn record(
        &self,
        id: &str,
        agent: &str,
        op: AgentOp,
        workflow: Option<&str>,
        stage: Stage,
    ) -> AuditRecord {
        AuditRecord {
            id: id.to_string(),
            at: (self.clock)(),
            action: op.action().into(),
            actor: self.actor.clone(),
            github_login: self.store.load_config().agents_token_login,
            repo: self.manifest.repository.clone(),
            run_id: 0,
            pull_number: None,
            agent: Some(agent.to_string()),
            title: None,
            base: None,
            workflow: workflow.map(str::to_owned),
            run_number: None,
            attempt_before: None,
            head_sha: None,
            branch: (op == AgentOp::RunNow).then(|| RUN_BRANCH.to_string()),
            stage,
            reason: None,
            http_status: None,
            request_id: None,
            message: None,
        }
    }

    fn stop(&self, mut r: AuditRecord, reason: &str, message: String) -> AgentOutcome {
        r.reason = Some(reason.into());
        r.message = Some(message.clone());
        // A refusal sends nothing, so a failed log write doesn't change the outcome.
        let _ = self.store.append(&r);
        AgentOutcome {
            stage: r.stage,
            reason: Some(reason.into()),
            message,
            audit_id: r.id,
        }
    }

    async fn workflow_state(&self, workflow: &str) -> Result<String, (String, String)> {
        let r = self
            .read
            .get(&format!(
                "/repos/{}/actions/workflows/{workflow}",
                self.manifest.repository
            ))
            .await
            .map_err(|e| {
                (
                    "preflight_failed".to_string(),
                    format!("Couldn't check the agent on GitHub: {e}"),
                )
            })?;
        match r.status {
            200 => r
                .body
                .get("state")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| {
                    (
                        "preflight_failed".into(),
                        "GitHub didn't say whether the agent is enabled.".into(),
                    )
                }),
            404 => Err((
                "workflow_not_found".into(),
                format!(
                    "GitHub can't find {workflow} on {}.",
                    self.manifest.repository
                ),
            )),
            s => Err((
                "preflight_failed".into(),
                format!("Couldn't check the agent on GitHub (status {s})."),
            )),
        }
    }

    /// One press of Enable, Disable or Run now. `seen_state` is the state the page showed;
    /// if GitHub now says otherwise, nothing is sent and the person is asked to refresh.
    pub async fn run(&self, agent_id: &str, op: AgentOp, seen_state: Option<&str>) -> AgentOutcome {
        let id = uuid::Uuid::new_v4().to_string();
        // Ids in the log are allow-listed, or replaced, so the page can't write arbitrary text.
        let entry = self
            .manifest
            .agents
            .iter()
            .find(|a| a.id == agent_id)
            .cloned();
        let logged_id = if entry.is_some() {
            agent_id
        } else {
            "(not on the allow-list)"
        };
        let wf = entry.as_ref().map(|a| a.workflow.clone());
        let stop = |stage: Stage, reason: &str, msg: String| {
            self.stop(
                self.record(&id, logged_id, op, wf.as_deref(), stage),
                reason,
                msg,
            )
        };

        let Some(agent) = entry else {
            return stop(
                Stage::Refused,
                "not_allowed",
                "That agent isn't on Atlas's Manage agents allow-list.".into(),
            );
        };
        if !valid_repo(&self.manifest.repository) {
            return stop(
                Stage::Refused,
                "invalid_repo",
                "The allow-list names an invalid repository.".into(),
            );
        }
        let Ok(_guard) = self.in_flight.try_lock() else {
            return stop(
                Stage::Refused,
                "busy",
                "Another agent change is already running. Wait for it to finish.".into(),
            );
        };
        if !self.write.has_token().await {
            return stop(
                Stage::Refused,
                "no_token",
                "Save a Manage agents token in Settings first.".into(),
            );
        }
        if let Some(why) = agent_rate_block(&self.store.audit(), &agent.id, (self.clock)()) {
            return stop(Stage::Refused, "rate_limited", why);
        }
        let state = match self.workflow_state(&agent.workflow).await {
            Ok(s) => s,
            Err((reason, msg)) => return stop(Stage::Refused, &reason, msg),
        };
        if let Some(seen) = seen_state {
            if seen != state {
                return stop(
                    Stage::Refused,
                    "changed",
                    format!(
                        "{} changed since this page loaded (now {}). Refresh and try again.",
                        agent.workflow,
                        state_words(&state).to_lowercase()
                    ),
                );
            }
        }
        match (op, enabled(&state)) {
            (AgentOp::Enable, true) => {
                return stop(
                    Stage::Refused,
                    "already_enabled",
                    "This agent is already enabled.".into(),
                )
            }
            (AgentOp::Disable, false) => {
                return stop(
                    Stage::Refused,
                    "already_disabled",
                    "This agent is already disabled.".into(),
                )
            }
            (AgentOp::RunNow, false) => {
                return stop(
                    Stage::Refused,
                    "disabled",
                    "Enable this agent before running it.".into(),
                )
            }
            _ => {}
        }

        let (before, after) = diff(op, &state);
        let preview = AgentPreview {
            agent: agent.id.clone(),
            op,
            repo: self.manifest.repository.clone(),
            workflow: agent.workflow.clone(),
            state,
            before,
            after,
            paid: agent.paid,
            cap_usd: agent.cap.as_ref().map(|c| c.usd),
        };
        let detail = format!("{} → {}", preview.before, preview.after);
        if !self.approver.approve(&preview).await {
            let mut r = self.record(&id, &agent.id, op, Some(&agent.workflow), Stage::Cancelled);
            r.message = Some(detail);
            let _ = self.store.append(&r);
            return AgentOutcome {
                stage: Stage::Cancelled,
                reason: None,
                message: "Cancelled. Nothing was changed.".into(),
                audit_id: id,
            };
        }
        if let Err(e) = self.approver.confirm_owner(&preview).await {
            return stop(
                Stage::Cancelled,
                "not_confirmed",
                format!("Touch ID didn't confirm it, so nothing was changed ({e})."),
            );
        }

        let mut attempted =
            self.record(&id, &agent.id, op, Some(&agent.workflow), Stage::Attempted);
        attempted.message = Some(detail);
        if let Err(e) = self.store.append(&attempted) {
            return AgentOutcome {
                stage: Stage::Refused,
                reason: Some("audit_failed".into()),
                message: format!("Nothing was sent because the audit log couldn't be written: {e}"),
                audit_id: id,
            };
        }

        let (stage, reason, message, status, request_id) = match self
            .write
            .workflow_op(&preview.repo, &preview.workflow, op, RUN_BRANCH)
            .await
        {
            Ok(r) => {
                let (stage, reason, message) = classify(&r, &preview);
                (
                    stage,
                    reason.map(str::to_owned),
                    message,
                    Some(r.status),
                    r.request_id,
                )
            }
            Err(SendError::NotSent(m)) => (
                Stage::Failed,
                Some("not_sent".into()),
                format!("Nothing reached GitHub: {m}"),
                None,
                None,
            ),
            Err(SendError::Unknown(m)) => (
                Stage::Unknown,
                Some("unknown".into()),
                format!("{m}. It may or may not have reached GitHub; refresh to check."),
                None,
                None,
            ),
        };
        let mut done = self.record(&id, &agent.id, op, Some(&agent.workflow), stage);
        done.reason = reason.clone();
        done.message = Some(message.clone());
        done.http_status = status;
        done.request_id = request_id;
        let _ = self.store.append(&done);
        AgentOutcome {
            stage,
            reason,
            message,
            audit_id: id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intel::collect::GhResponse;
    use std::sync::Mutex;

    struct FakeRead {
        state: Mutex<String>,
        status: u16,
    }

    #[async_trait::async_trait]
    impl GithubApi for FakeRead {
        async fn get(&self, path: &str) -> Result<GhResponse, String> {
            assert!(
                path.starts_with("/repos/khaneilcampbell/ai-ops-atlas/actions/workflows/"),
                "{path}"
            );
            Ok(GhResponse {
                status: self.status,
                body: serde_json::json!({ "state": *self.state.lock().unwrap() }),
                rate_remaining: None,
                rate_reset: None,
            })
        }
        async fn has_token(&self) -> bool {
            true
        }
    }

    #[derive(Default)]
    struct FakeWrite {
        sent: Mutex<Vec<(String, String, AgentOp, String)>>,
        token: bool,
        status: u16,
    }

    #[async_trait::async_trait]
    impl AgentWriteApi for FakeWrite {
        async fn has_token(&self) -> bool {
            self.token
        }
        async fn workflow_op(
            &self,
            repo: &str,
            workflow: &str,
            op: AgentOp,
            branch: &str,
        ) -> Result<WriteResponse, SendError> {
            self.sent
                .lock()
                .unwrap()
                .push((repo.into(), workflow.into(), op, branch.into()));
            Ok(WriteResponse {
                status: self.status,
                body: Value::Null,
                request_id: Some("req-1".into()),
                rate_remaining: None,
                rate_reset: None,
                retry_after: None,
            })
        }
    }

    struct FakeApprover {
        ok: bool,
        touch: bool,
        seen: Mutex<Vec<String>>,
    }

    #[async_trait::async_trait]
    impl AgentApprover for FakeApprover {
        async fn approve(&self, p: &AgentPreview) -> bool {
            self.seen.lock().unwrap().push(dialog_text(p));
            self.ok
        }
        async fn confirm_owner(&self, _p: &AgentPreview) -> Result<(), String> {
            if self.touch {
                Ok(())
            } else {
                Err("cancelled".into())
            }
        }
    }

    struct Setup {
        m: AgentManager,
        write: Arc<FakeWrite>,
        approver: Arc<FakeApprover>,
        _dir: tempfile::TempDir,
    }

    fn setup(state: &str, token: bool, ok: bool, touch: bool) -> Setup {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(dir.path().to_path_buf()).unwrap());
        let write = Arc::new(FakeWrite {
            token,
            status: 204,
            ..Default::default()
        });
        let approver = Arc::new(FakeApprover {
            ok,
            touch,
            seen: Mutex::new(vec![]),
        });
        let m = AgentManager::new(
            store,
            Arc::new(FakeRead {
                state: Mutex::new(state.into()),
                status: 200,
            }),
            write.clone(),
            approver.clone(),
            "kc (test)".into(),
            Box::new(|| {
                DateTime::parse_from_rfc3339("2026-10-30T12:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc)
            }),
            manifest(),
        );
        Setup {
            m,
            write,
            approver,
            _dir: dir,
        }
    }

    #[test]
    fn the_shipped_allow_list_parses_and_names_plain_workflows() {
        let m = manifest();
        assert_eq!(m.repository, "khaneilcampbell/ai-ops-atlas");
        assert!(!m.agents.is_empty());
        for a in &m.agents {
            assert!(
                super::super::client::workflow_url(&m.repository, &a.workflow, AgentOp::Enable)
                    .is_some(),
                "{}",
                a.workflow
            );
            assert!(!["ci.yml", "release.yml", "codeql.yml", "visual.yml"]
                .contains(&a.workflow.as_str()));
        }
    }

    #[tokio::test]
    async fn disables_after_approval_and_touch_id_and_audits_both_sides() {
        let s = setup("active", true, true, true);
        let out =
            s.m.run("github-merge-flow", AgentOp::Disable, Some("active"))
                .await;
        assert_eq!(out.stage, Stage::Changed, "{}", out.message);
        assert_eq!(
            *s.write.sent.lock().unwrap(),
            vec![(
                "khaneilcampbell/ai-ops-atlas".to_string(),
                "merge-flow.yml".to_string(),
                AgentOp::Disable,
                "main".to_string()
            )]
        );
        let dialog = &s.approver.seen.lock().unwrap()[0];
        assert!(dialog.contains("Before: Enabled"), "{dialog}");
        assert!(dialog.contains("After: Disabled"), "{dialog}");
        let log = s.m.store.audit();
        assert_eq!(
            log.iter().map(|r| r.stage).collect::<Vec<_>>(),
            vec![Stage::Attempted, Stage::Changed]
        );
        assert!(log
            .iter()
            .all(|r| r.agent.as_deref() == Some("github-merge-flow")
                && r.action == ACTION_AGENT_DISABLE));
        assert!(log[0].message.as_deref().unwrap().contains("→"));
    }

    #[tokio::test]
    async fn runs_on_main_with_default_inputs() {
        let s = setup("active", true, true, true);
        let out =
            s.m.run("github-opportunity-scout", AgentOp::RunNow, None)
                .await;
        assert_eq!(out.stage, Stage::Started, "{}", out.message);
        let sent = s.write.sent.lock().unwrap();
        assert_eq!(sent[0].1, "opportunity-scout.yml");
        assert_eq!(sent[0].3, "main");
        assert!(s.approver.seen.lock().unwrap()[0].contains("monthly cap"));
    }

    #[tokio::test]
    async fn refuses_anything_off_the_allow_list_without_sending() {
        let s = setup("active", true, true, true);
        for id in ["", "ci", "../ci.yml", "github-merge-flow\nx"] {
            let out = s.m.run(id, AgentOp::RunNow, None).await;
            assert_eq!(out.reason.as_deref(), Some("not_allowed"), "{id:?}");
        }
        assert!(s.write.sent.lock().unwrap().is_empty());
        assert!(s.approver.seen.lock().unwrap().is_empty());
        // The page's text never reaches the log as an agent id.
        assert!(s
            .m
            .store
            .audit()
            .iter()
            .all(|r| r.agent.as_deref() == Some("(not on the allow-list)")));
    }

    #[tokio::test]
    async fn refuses_without_a_token_on_cancel_without_touch_id_and_when_stale() {
        let s = setup("active", false, true, true);
        assert_eq!(
            s.m.run("github-merge-flow", AgentOp::Disable, None)
                .await
                .reason
                .as_deref(),
            Some("no_token")
        );

        let s = setup("active", true, false, true);
        assert_eq!(
            s.m.run("github-merge-flow", AgentOp::Disable, None)
                .await
                .stage,
            Stage::Cancelled
        );
        assert!(s.write.sent.lock().unwrap().is_empty());

        let s = setup("active", true, true, false);
        assert_eq!(
            s.m.run("github-merge-flow", AgentOp::Disable, None)
                .await
                .reason
                .as_deref(),
            Some("not_confirmed")
        );
        assert!(s.write.sent.lock().unwrap().is_empty());

        let s = setup("disabled_manually", true, true, true);
        assert_eq!(
            s.m.run("github-merge-flow", AgentOp::Disable, Some("active"))
                .await
                .reason
                .as_deref(),
            Some("changed")
        );
        assert_eq!(
            s.m.run("github-merge-flow", AgentOp::Disable, None)
                .await
                .reason
                .as_deref(),
            Some("already_disabled")
        );
        assert_eq!(
            s.m.run("github-merge-flow", AgentOp::RunNow, None)
                .await
                .reason
                .as_deref(),
            Some("disabled")
        );
        assert!(s.write.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn cools_down_per_agent() {
        let s = setup("active", true, true, true);
        assert_eq!(
            s.m.run("github-merge-flow", AgentOp::RunNow, None)
                .await
                .stage,
            Stage::Started
        );
        assert_eq!(
            s.m.run("github-merge-flow", AgentOp::RunNow, None)
                .await
                .reason
                .as_deref(),
            Some("rate_limited")
        );
        // Another agent isn't held up.
        assert_eq!(
            s.m.run("github-opportunity-scout", AgentOp::RunNow, None)
                .await
                .stage,
            Stage::Started
        );
    }

    #[test]
    fn classifies_github_answers() {
        let p = AgentPreview {
            agent: "a".into(),
            op: AgentOp::Enable,
            repo: "o/r".into(),
            workflow: "a.yml".into(),
            state: "disabled_manually".into(),
            before: "".into(),
            after: "".into(),
            paid: false,
            cap_usd: None,
        };
        let r = |status| WriteResponse {
            status,
            body: Value::Null,
            request_id: None,
            rate_remaining: None,
            rate_reset: None,
            retry_after: None,
        };
        assert_eq!(classify(&r(204), &p).0, Stage::Changed);
        assert_eq!(classify(&r(401), &p).1, Some("token_rejected"));
        assert_eq!(classify(&r(403), &p).1, Some("forbidden"));
        assert_eq!(classify(&r(404), &p).1, Some("not_found"));
        assert_eq!(classify(&r(500), &p).1, Some("github_error"));
    }
}
