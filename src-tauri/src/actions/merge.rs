//! "Merge pull request": the whole decision path for one press of the button. It follows the
//! re-run action's order: every check that can stop the merge runs before the approval
//! dialog, the dialog and a fresh Touch ID check run before the audit record, and the audit
//! record is written before the single request is sent.
//!
//! There is no override. Atlas merges only what GitHub itself reports as ready: open, not a
//! draft, no outstanding "changes requested", mergeable with state `clean`, the base branch
//! protected by required checks, and every check and status on the head commit green. The
//! request pins the head commit, so a push after the dialog makes GitHub refuse it.

use super::rerun::{SendError, WriteResponse};
use super::store::{merge_rate_block, AuditRecord, Stage, Store, ACTION_MERGE};
use crate::intel::collect::{valid_repo, GithubApi};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// How Atlas merges: one squashed commit, the way KC merges by hand.
pub const MERGE_METHOD: &str = "squash";

/// The merge request, implemented by the Keychain-backed client in `client.rs`.
#[async_trait::async_trait]
pub trait MergeApi: Send + Sync {
    /// Whether a merge token is saved for this repository.
    async fn has_merge_token(&self, repo: &str) -> bool;
    async fn merge_pull(
        &self,
        repo: &str,
        number: u64,
        head_sha: &str,
    ) -> Result<WriteResponse, SendError>;
}

/// Asks the person at the Mac: a native dialog the web view can't answer, then Touch ID.
#[async_trait::async_trait]
pub trait MergeApprover: Send + Sync {
    async fn approve(&self, p: &MergePreview) -> bool;
    /// A fresh Touch ID (or password) check. `Err` carries why it didn't go through.
    async fn confirm_owner(&self, p: &MergePreview) -> Result<(), String>;
}

/// What the person approves: the pull request as GitHub reports it right before the request.
#[derive(Debug, Clone, Serialize)]
pub struct MergePreview {
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub author: Option<String>,
    pub head: String,
    pub base: String,
    pub head_sha: String,
    pub commits: Option<u64>,
    pub changed_files: Option<u64>,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    /// Names of the checks and statuses that passed on the head commit.
    pub checks: Vec<String>,
    /// The checks the base branch requires, all among `checks`.
    pub required: Vec<String>,
    pub approvals: Vec<String>,
    pub url: Option<String>,
}

/// The answer to "is this pull request ready to merge from Atlas?", without merging it.
#[derive(Debug, Clone, Serialize)]
pub struct MergeCheck {
    pub ready: bool,
    pub reason: Option<String>,
    pub message: String,
    pub preview: Option<MergePreview>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergeOutcome {
    pub stage: Stage,
    pub reason: Option<String>,
    pub message: String,
    pub audit_id: String,
}

pub struct Merger {
    pub store: Arc<Store>,
    pub read: Arc<dyn GithubApi>,
    pub write: Arc<dyn MergeApi>,
    pub approver: Arc<dyn MergeApprover>,
    pub actor: String,
    pub clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    in_flight: tokio::sync::Mutex<()>,
}

/// A stop before anything is sent: a short machine reason and the words for the person.
type Refusal = (String, String);

fn refuse(reason: &str, message: impl Into<String>) -> Refusal {
    (reason.to_string(), message.into())
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}

fn u(v: &Value, k: &str) -> Option<u64> {
    v.get(k).and_then(Value::as_u64)
}

fn list(names: &[String]) -> String {
    let shown: Vec<&str> = names.iter().take(5).map(String::as_str).collect();
    let more = names.len().saturating_sub(shown.len());
    format!(
        "{}{}",
        shown.join(", "),
        if more > 0 {
            format!(" and {more} more")
        } else {
            String::new()
        }
    )
}

/// What `mergeable_state` means when it isn't `clean`.
fn state_refusal(state: &str) -> Refusal {
    match state {
        "blocked" => refuse(
            "blocked",
            "GitHub says this pull request is blocked: a required check or review isn't satisfied yet.",
        ),
        "behind" => refuse(
            "behind",
            "The branch is behind its base. Update it on GitHub and wait for the checks to pass again.",
        ),
        "dirty" => refuse("conflicts", "This pull request has merge conflicts."),
        "unstable" => refuse(
            "checks_failing",
            "Some checks on this pull request are failing or still running.",
        ),
        "draft" => refuse("draft", "This is a draft pull request."),
        "unknown" | "" => refuse(
            "computing",
            "GitHub is still working out whether this can merge. Try again in a moment.",
        ),
        other => refuse(
            "not_clean",
            format!("GitHub reports this pull request as \"{other}\", not ready to merge."),
        ),
    }
}

/// The latest review state of each reviewer: refuses on any outstanding "changes requested".
/// Returns the reviewers whose latest review is an approval.
pub fn review_verdict(reviews: &[Value]) -> Result<Vec<String>, Refusal> {
    let mut latest: BTreeMap<String, String> = BTreeMap::new();
    for r in reviews {
        let Some(login) = r.pointer("/user/login").and_then(Value::as_str) else {
            continue;
        };
        let state = s(r, "state").unwrap_or_default();
        // Comments don't change a reviewer's verdict; a dismissal clears it.
        match state.as_str() {
            "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED" => {
                latest.insert(login.to_string(), state);
            }
            _ => {}
        }
    }
    let blocking: Vec<String> = latest
        .iter()
        .filter(|(_, st)| *st == "CHANGES_REQUESTED")
        .map(|(l, _)| l.clone())
        .collect();
    if !blocking.is_empty() {
        return Err(refuse(
            "changes_requested",
            format!("Changes were requested by {}.", list(&blocking)),
        ));
    }
    Ok(latest
        .into_iter()
        .filter(|(_, st)| st == "APPROVED")
        .map(|(l, _)| l)
        .collect())
}

/// Every check run and commit status on the head must be finished and green, and there must
/// be at least one. Returns the names that passed.
pub fn checks_verdict(check_runs: &Value, status: &Value) -> Result<Vec<String>, Refusal> {
    let runs = check_runs
        .get("check_runs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let total = u(check_runs, "total_count").unwrap_or(runs.len() as u64);
    if total as usize > runs.len() {
        return Err(refuse(
            "too_many_checks",
            "This commit has more checks than Atlas can verify in one read, so it won't merge it. Merge on GitHub instead.",
        ));
    }
    let mut passed = BTreeSet::new();
    let mut pending = vec![];
    let mut failing = vec![];
    for r in &runs {
        let name = s(r, "name").unwrap_or_else(|| "check".into());
        if s(r, "status").as_deref() != Some("completed") {
            pending.push(name);
            continue;
        }
        match s(r, "conclusion").as_deref() {
            Some("success" | "neutral" | "skipped") => {
                passed.insert(name);
            }
            _ => failing.push(name),
        }
    }
    let statuses = status
        .get("statuses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // The combined status lists the latest status per context.
    for st in &statuses {
        let name = s(st, "context").unwrap_or_else(|| "status".into());
        match s(st, "state").as_deref() {
            Some("success") => {
                passed.insert(name);
            }
            Some("pending") => pending.push(name),
            _ => failing.push(name),
        }
    }
    if !failing.is_empty() {
        return Err(refuse(
            "checks_failing",
            format!("Checks aren't green: {}.", list(&failing)),
        ));
    }
    if !pending.is_empty() {
        return Err(refuse(
            "checks_pending",
            format!("Checks are still running: {}.", list(&pending)),
        ));
    }
    if passed.is_empty() {
        return Err(refuse(
            "no_checks",
            "No checks have reported on this commit, so there is nothing to show it's safe to merge.",
        ));
    }
    Ok(passed.into_iter().collect())
}

/// The check names the base branch requires, from classic branch protection and from rulesets.
pub fn required_checks(branch: &Value, rules: &Value) -> Vec<String> {
    let mut out = BTreeSet::new();
    if let Some(rsc) = branch.pointer("/protection/required_status_checks") {
        for c in rsc
            .get("contexts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(c) = c.as_str() {
                out.insert(c.to_string());
            }
        }
        for c in rsc
            .get("checks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(c) = s(c, "context") {
                out.insert(c);
            }
        }
    }
    for rule in rules.as_array().into_iter().flatten() {
        if s(rule, "type").as_deref() != Some("required_status_checks") {
            continue;
        }
        for c in rule
            .pointer("/parameters/required_status_checks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(c) = s(c, "context") {
                out.insert(c);
            }
        }
    }
    out.into_iter().collect()
}

/// The text of the approval dialog.
pub fn dialog_text(p: &MergePreview) -> String {
    let mut lines = vec![
        format!("#{} {}", p.number, p.title),
        format!(
            "{} · {} into {}{}",
            p.repo,
            p.head,
            p.base,
            p.author
                .as_deref()
                .map(|a| format!(" · by {a}"))
                .unwrap_or_default()
        ),
    ];
    let mut size = vec![];
    if let Some(c) = p.commits {
        size.push(format!("{c} commit{}", if c == 1 { "" } else { "s" }));
    }
    if let Some(f) = p.changed_files {
        size.push(format!("{f} file{}", if f == 1 { "" } else { "s" }));
    }
    if let (Some(a), Some(d)) = (p.additions, p.deletions) {
        size.push(format!("+{a} −{d}"));
    }
    if !size.is_empty() {
        lines.push(size.join(", "));
    }
    lines.push(format!(
        "Head commit {}. Required checks passed: {}.",
        &p.head_sha[..p.head_sha.len().min(7)],
        list(&p.required)
    ));
    if !p.approvals.is_empty() {
        lines.push(format!("Approved by {}.", list(&p.approvals)));
    }
    lines.push(String::new());
    lines.push(format!(
        "This squashes the pull request into one commit on {} on GitHub. It can't be undone from Atlas. After you confirm, Touch ID is asked for once more.",
        p.base
    ));
    lines.join("\n")
}

/// Turns GitHub's answer to the merge request into a stage, a reason and a message.
pub fn classify(r: &WriteResponse, p: &MergePreview) -> (Stage, Option<&'static str>, String) {
    let gh = s(&r.body, "message").unwrap_or_default();
    let said = if gh.is_empty() {
        String::new()
    } else {
        format!(": {gh}")
    };
    let limited = r.status == 429
        || (r.status == 403 && (r.rate_remaining == Some(0) || r.retry_after.is_some()));
    match r.status {
        200 if r.body.get("merged").and_then(Value::as_bool) != Some(false) => (
            Stage::Merged,
            None,
            format!("Merged #{} into {} on {}.", p.number, p.base, p.repo),
        ),
        _ if limited => (
            Stage::Failed,
            Some("rate_limited"),
            "GitHub is limiting requests. Try again later.".into(),
        ),
        401 => (
            Stage::Failed,
            Some("token_rejected"),
            "GitHub rejected this repository's merge token. It may have expired or been revoked; replace it in Settings.".into(),
        ),
        403 => (
            Stage::Failed,
            Some("forbidden"),
            format!("GitHub refused the merge{said}. Check that the merge token has Pull requests and Contents: Read and write on this repository."),
        ),
        404 => (
            Stage::Failed,
            Some("not_found"),
            "The merge token can't see this repository or pull request.".into(),
        ),
        405 => (
            Stage::Failed,
            Some("not_mergeable"),
            format!("GitHub won't merge this pull request{said}."),
        ),
        409 => (
            Stage::Failed,
            Some("head_changed"),
            "The branch changed after you approved, so GitHub refused the merge. Nothing was merged; refresh and check it again.".into(),
        ),
        status => (
            Stage::Failed,
            Some("github_error"),
            format!("GitHub returned {status}{said}. Nothing was retried; refresh to check the pull request."),
        ),
    }
}

impl Merger {
    pub fn new(
        store: Arc<Store>,
        read: Arc<dyn GithubApi>,
        write: Arc<dyn MergeApi>,
        approver: Arc<dyn MergeApprover>,
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

    async fn get(&self, path: &str, what: &str) -> Result<Value, Refusal> {
        let r = self.read.get(path).await.map_err(|e| {
            refuse(
                "preflight_failed",
                format!("Couldn't read the {what} from GitHub: {e}"),
            )
        })?;
        match r.status {
            200 => Ok(r.body),
            404 => Err(refuse(
                "not_found",
                format!("GitHub can't find the {what}. Refresh and try again."),
            )),
            st => Err(refuse(
                "preflight_failed",
                format!("Couldn't read the {what} from GitHub (status {st})."),
            )),
        }
    }

    /// The switch, the repository list and the token: nothing is read from GitHub without them.
    async fn gate(&self, repo: &str) -> Result<(), Refusal> {
        if !valid_repo(repo) {
            return Err(refuse(
                "invalid_repo",
                "That isn't a valid owner/name repository.",
            ));
        }
        let config = self.store.load_config();
        if !config.merge_pull_requests.enabled {
            return Err(refuse(
                "disabled",
                "Merging from Atlas is off. Turn it on in Settings.",
            ));
        }
        if !config.allows_merge(repo) {
            return Err(refuse(
                "repo_not_enabled",
                "This repository isn't enabled for merges. Add it in Settings.",
            ));
        }
        if !self.write.has_merge_token(repo).await {
            return Err(refuse(
                "no_token",
                "Save a merge token for this repository in Settings first.",
            ));
        }
        Ok(())
    }

    /// Reads the pull request, its reviews, its checks and the base branch's rules, and
    /// refuses unless GitHub reports everything ready. Read-only.
    pub async fn preflight(
        &self,
        repo: &str,
        number: u64,
        seen_sha: Option<&str>,
    ) -> Result<MergePreview, Refusal> {
        let pr = self
            .get(&format!("/repos/{repo}/pulls/{number}"), "pull request")
            .await?;
        let base_repo = pr
            .pointer("/base/repo/full_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !base_repo.eq_ignore_ascii_case(repo) || u(&pr, "number") != Some(number) {
            return Err(refuse(
                "repo_mismatch",
                "GitHub returned a pull request from a different repository.",
            ));
        }
        if pr.get("merged").and_then(Value::as_bool) == Some(true) {
            return Err(refuse(
                "already_merged",
                "This pull request is already merged.",
            ));
        }
        if s(&pr, "state").as_deref() != Some("open") {
            return Err(refuse("closed", "This pull request is closed."));
        }
        if pr.get("draft").and_then(Value::as_bool) == Some(true) {
            return Err(refuse("draft", "This is a draft pull request."));
        }
        let head_sha = pr
            .pointer("/head/sha")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if head_sha.len() < 7 || !head_sha.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(refuse(
                "preflight_failed",
                "GitHub didn't report the pull request's head commit.",
            ));
        }
        if seen_sha.is_some_and(|seen| !seen.eq_ignore_ascii_case(&head_sha)) {
            return Err(refuse(
                "stale_head",
                "New commits were pushed since Atlas last checked. Check the pull request again.",
            ));
        }
        match pr.get("mergeable").and_then(Value::as_bool) {
            Some(true) => {}
            Some(false) => {
                return Err(refuse(
                    "conflicts",
                    "GitHub says this pull request can't be merged.",
                ))
            }
            None => return Err(state_refusal("unknown")),
        }
        let state = s(&pr, "mergeable_state").unwrap_or_default();
        if state != "clean" {
            return Err(state_refusal(&state));
        }
        let base = pr
            .pointer("/base/ref")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        let reviews = self
            .get(
                &format!("/repos/{repo}/pulls/{number}/reviews?per_page=100"),
                "reviews",
            )
            .await?;
        let approvals = review_verdict(reviews.as_array().map(Vec::as_slice).unwrap_or(&[]))?;

        let runs = self
            .get(
                &format!("/repos/{repo}/commits/{head_sha}/check-runs?per_page=100"),
                "checks",
            )
            .await?;
        let status = self
            .get(
                &format!("/repos/{repo}/commits/{head_sha}/status"),
                "commit status",
            )
            .await?;
        let checks = checks_verdict(&runs, &status)?;

        let branch = self
            .get(&format!("/repos/{repo}/branches/{base}"), "base branch")
            .await?;
        // Rulesets are optional; a repository without any answers with an empty list.
        let rules = match self
            .read
            .get(&format!("/repos/{repo}/rules/branches/{base}"))
            .await
        {
            Ok(r) if r.status == 200 => r.body,
            _ => Value::Null,
        };
        let required = required_checks(&branch, &rules);
        if required.is_empty() {
            return Err(refuse(
                "no_required_checks",
                format!("{base} doesn't require any checks, so GitHub wouldn't stop a bad merge. Add required status checks to {base} before merging from Atlas."),
            ));
        }
        let missing: Vec<String> = required
            .iter()
            .filter(|r| !checks.contains(r))
            .cloned()
            .collect();
        if !missing.is_empty() {
            return Err(refuse(
                "required_missing",
                format!("Required checks haven't passed: {}.", list(&missing)),
            ));
        }

        Ok(MergePreview {
            repo: repo.to_string(),
            number,
            title: s(&pr, "title").unwrap_or_else(|| format!("Pull request #{number}")),
            author: pr
                .pointer("/user/login")
                .and_then(Value::as_str)
                .map(str::to_owned),
            head: pr
                .pointer("/head/ref")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            base,
            head_sha,
            commits: u(&pr, "commits"),
            changed_files: u(&pr, "changed_files"),
            additions: u(&pr, "additions"),
            deletions: u(&pr, "deletions"),
            checks,
            required,
            approvals,
            url: s(&pr, "html_url"),
        })
    }

    /// The readiness check behind the Merge button. Read-only and not audited.
    pub async fn check(&self, repo: &str, number: u64) -> MergeCheck {
        let result = match self.gate(repo).await {
            Ok(()) => self.preflight(repo, number, None).await,
            Err(e) => Err(e),
        };
        match result {
            Ok(p) => MergeCheck {
                ready: true,
                reason: None,
                message: format!(
                    "Ready: {} required check{} passed.",
                    p.required.len(),
                    if p.required.len() == 1 { "" } else { "s" }
                ),
                preview: Some(p),
            },
            Err((reason, message)) => MergeCheck {
                ready: false,
                reason: Some(reason),
                message,
                preview: None,
            },
        }
    }

    fn record(
        &self,
        id: &str,
        repo: &str,
        number: u64,
        p: Option<&MergePreview>,
        stage: Stage,
    ) -> AuditRecord {
        AuditRecord {
            id: id.to_string(),
            at: (self.clock)(),
            action: ACTION_MERGE.into(),
            actor: self.actor.clone(),
            github_login: self
                .store
                .load_config()
                .merge_pull_requests
                .token_logins
                .get(&repo.to_ascii_lowercase())
                .cloned(),
            repo: repo.to_string(),
            run_id: 0,
            pull_number: Some(number),
            title: p.map(|p| p.title.clone()),
            base: p.map(|p| p.base.clone()),
            workflow: None,
            run_number: None,
            attempt_before: None,
            head_sha: p.map(|p| p.head_sha.clone()),
            branch: p.map(|p| p.head.clone()),
            stage,
            reason: None,
            http_status: None,
            request_id: None,
            message: None,
        }
    }

    fn stop(&self, mut r: AuditRecord, reason: &str, message: String) -> MergeOutcome {
        let stage = r.stage;
        r.reason = Some(reason.into());
        r.message = Some(message.clone());
        // A refusal sends nothing, so a failed log write doesn't change the outcome.
        let _ = self.store.append(&r);
        MergeOutcome {
            stage,
            reason: Some(reason.into()),
            message,
            audit_id: r.id,
        }
    }

    pub async fn run(&self, repo: &str, number: u64, seen_sha: Option<&str>) -> MergeOutcome {
        let id = uuid::Uuid::new_v4().to_string();
        let stop = |p: Option<&MergePreview>, (reason, msg): Refusal| {
            self.stop(
                self.record(&id, repo, number, p, Stage::Refused),
                &reason,
                msg,
            )
        };

        let Ok(_guard) = self.in_flight.try_lock() else {
            return stop(
                None,
                refuse(
                    "busy",
                    "Another merge is already in progress. Wait for it to finish.",
                ),
            );
        };
        if let Err(e) = self.gate(repo).await {
            return stop(None, e);
        }
        let preview = match self.preflight(repo, number, seen_sha).await {
            Ok(p) => p,
            Err(e) => return stop(None, e),
        };
        let p = Some(&preview);
        if let Some(msg) = merge_rate_block(&self.store.audit(), repo, number, (self.clock)()) {
            return stop(p, refuse("rate_capped", msg));
        }

        if !self.approver.approve(&preview).await {
            return self.stop(
                self.record(&id, repo, number, p, Stage::Cancelled),
                "cancelled",
                "Cancelled. Nothing was sent to GitHub.".into(),
            );
        }
        if let Err(e) = self.approver.confirm_owner(&preview).await {
            return self.stop(
                self.record(&id, repo, number, p, Stage::Cancelled),
                "touch_id",
                format!("{e} Nothing was sent to GitHub."),
            );
        }

        // Fail closed: no audit record, no request.
        if let Err(e) = self
            .store
            .append(&self.record(&id, repo, number, p, Stage::Attempted))
        {
            return MergeOutcome {
                stage: Stage::Failed,
                reason: Some("audit_unavailable".into()),
                message: format!("{e}. Nothing was sent to GitHub."),
                audit_id: id,
            };
        }

        let mut result = self.record(&id, repo, number, p, Stage::Failed);
        let (stage, reason, message) = match self
            .write
            .merge_pull(repo, number, &preview.head_sha)
            .await
        {
            Ok(resp) => {
                result.http_status = Some(resp.status);
                result.request_id = resp.request_id.clone();
                classify(&resp, &preview)
            }
            Err(SendError::NotSent(e)) => (
                Stage::Failed,
                Some("network"),
                format!("{e}. Nothing reached GitHub."),
            ),
            Err(SendError::Unknown(e)) => {
                // The request may have landed: read the pull request again.
                let merged = self
                    .read
                    .get(&format!("/repos/{repo}/pulls/{number}"))
                    .await
                    .ok()
                    .filter(|r| r.status == 200)
                    .and_then(|r| r.body.get("merged").and_then(Value::as_bool));
                if merged == Some(true) {
                    (
                        Stage::Merged,
                        None,
                        format!("Merged #{} into {} on {}.", number, preview.base, repo),
                    )
                } else {
                    (
                        Stage::Unknown,
                        Some("unknown"),
                        format!("{e}. GitHub may or may not have merged it; refresh in a minute to check before trying again."),
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
        MergeOutcome {
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    const REPO: &str = "khaneilcampbell/benjaire.com";
    const SHA: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

    fn now() -> DateTime<Utc> {
        "2026-10-28T09:00:00Z".parse().unwrap()
    }

    fn pr() -> Value {
        json!({
            "number": 7, "title": "Fix the footer", "state": "open", "draft": false, "merged": false,
            "mergeable": true, "mergeable_state": "clean", "user": { "login": "khancam15" },
            "head": { "ref": "fix-footer", "sha": SHA }, "base": { "ref": "main", "repo": { "full_name": REPO } },
            "commits": 2, "changed_files": 3, "additions": 10, "deletions": 4,
            "html_url": "https://github.com/khaneilcampbell/benjaire.com/pull/7"
        })
    }

    fn green() -> Value {
        json!({ "total_count": 2, "check_runs": [
            { "name": "build", "status": "completed", "conclusion": "success" },
            { "name": "lint", "status": "completed", "conclusion": "skipped" }
        ]})
    }

    fn protected() -> Value {
        json!({ "name": "main", "protected": true, "protection": { "required_status_checks": { "contexts": ["build"], "checks": [{ "context": "build" }] } } })
    }

    /// Answers by path; anything not set is a 404.
    struct FakeRead {
        bodies: Mutex<BTreeMap<String, Value>>,
        calls: AtomicUsize,
        pr_reads: AtomicUsize,
    }

    impl FakeRead {
        fn set(&self, key: &str, v: Value) {
            self.bodies.lock().unwrap().insert(key.into(), v);
        }
    }

    fn key(path: &str) -> &'static str {
        if path.contains("/reviews") {
            "reviews"
        } else if path.contains("/check-runs") {
            "checks"
        } else if path.ends_with("/status") {
            "status"
        } else if path.contains("/rules/branches/") {
            "rules"
        } else if path.contains("/branches/") {
            "branch"
        } else {
            "pr"
        }
    }

    #[async_trait::async_trait]
    impl GithubApi for FakeRead {
        async fn get(&self, path: &str) -> Result<GhResponse, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let mut k = key(path).to_string();
            // "pr_later" answers every read of the pull request after the first.
            if k == "pr"
                && self.pr_reads.fetch_add(1, Ordering::SeqCst) > 0
                && self.bodies.lock().unwrap().contains_key("pr_later")
            {
                k = "pr_later".into();
            }
            let body = self.bodies.lock().unwrap().get(&k).cloned();
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
        token: bool,
        reply: Mutex<Option<Result<WriteResponse, SendError>>>,
        sent: Mutex<Vec<(String, u64, String)>>,
    }

    #[async_trait::async_trait]
    impl MergeApi for FakeWrite {
        async fn has_merge_token(&self, _repo: &str) -> bool {
            self.token
        }
        async fn merge_pull(
            &self,
            repo: &str,
            number: u64,
            head_sha: &str,
        ) -> Result<WriteResponse, SendError> {
            self.sent
                .lock()
                .unwrap()
                .push((repo.into(), number, head_sha.into()));
            self.reply
                .lock()
                .unwrap()
                .take()
                .unwrap_or_else(|| Ok(resp(200, json!({ "merged": true, "sha": "f00" }))))
        }
    }

    struct FakeApprover {
        answer: bool,
        touch: Result<(), String>,
        seen: Mutex<Option<MergePreview>>,
    }

    #[async_trait::async_trait]
    impl MergeApprover for FakeApprover {
        async fn approve(&self, p: &MergePreview) -> bool {
            *self.seen.lock().unwrap() = Some(p.clone());
            self.answer
        }
        async fn confirm_owner(&self, _p: &MergePreview) -> Result<(), String> {
            self.touch.clone()
        }
    }

    fn resp(status: u16, body: Value) -> WriteResponse {
        WriteResponse {
            status,
            body,
            request_id: Some("ABCD:1".into()),
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
        m: Merger,
    }

    fn rig_with(enabled: bool, repos: &[&str], token: bool, approve: bool) -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(dir.path().to_path_buf()).unwrap());
        let mut c = ActionsConfig::default();
        c.merge_pull_requests.enabled = enabled;
        c.merge_pull_requests.repos = repos.iter().map(|s| s.to_string()).collect();
        c.merge_pull_requests
            .token_logins
            .insert(REPO.into(), "khaneilcampbell".into());
        // The re-run switch must not stand in for the merge switch.
        c.rerun_failed_jobs.enabled = true;
        c.rerun_failed_jobs.repos = vec![REPO.into()];
        store.save_config(&c).unwrap();
        let read = Arc::new(FakeRead {
            bodies: Mutex::new(BTreeMap::new()),
            calls: AtomicUsize::new(0),
            pr_reads: AtomicUsize::new(0),
        });
        read.set("pr", pr());
        read.set("reviews", json!([]));
        read.set("checks", green());
        read.set("status", json!({ "state": "pending", "statuses": [] }));
        read.set("branch", protected());
        let write = Arc::new(FakeWrite {
            token,
            reply: Mutex::new(None),
            sent: Mutex::new(vec![]),
        });
        let approver = Arc::new(FakeApprover {
            answer: approve,
            touch: Ok(()),
            seen: Mutex::new(None),
        });
        let m = Merger::new(
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
            m,
        }
    }

    fn rig() -> Rig {
        rig_with(true, &[REPO], true, true)
    }

    fn stages(r: &Rig) -> Vec<Stage> {
        r.store.audit().iter().map(|a| a.stage).collect()
    }

    fn sent(r: &Rig) -> usize {
        r.write.sent.lock().unwrap().len()
    }

    #[tokio::test]
    async fn approved_merge_pins_the_head_and_is_logged_twice() {
        let r = rig();
        let o = r.m.run(REPO, 7, Some(SHA)).await;
        assert_eq!(o.stage, Stage::Merged, "{}", o.message);
        assert_eq!(
            r.write.sent.lock().unwrap().clone(),
            vec![(REPO.to_string(), 7, SHA.to_string())]
        );
        assert_eq!(stages(&r), vec![Stage::Attempted, Stage::Merged]);
        let log = r.store.audit();
        assert_eq!(log[1].pull_number, Some(7));
        assert_eq!(log[1].action, ACTION_MERGE);
        assert_eq!(log[1].title.as_deref(), Some("Fix the footer"));
        assert_eq!(log[1].base.as_deref(), Some("main"));
        assert_eq!(log[1].github_login.as_deref(), Some("khaneilcampbell"));
        let seen = r.approver.seen.lock().unwrap().clone().unwrap();
        assert_eq!(seen.required, vec!["build".to_string()]);
    }

    #[tokio::test]
    async fn switch_repo_and_token_stop_before_any_read() {
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
            let r = rig_with(enabled, &repos, token, true);
            let o = r.m.run(REPO, 7, None).await;
            assert_eq!(o.reason.as_deref(), Some(reason));
            assert_eq!(r.read.calls.load(Ordering::SeqCst), 0, "{reason}");
            assert_eq!(sent(&r), 0);
            assert!(
                r.approver.seen.lock().unwrap().is_none(),
                "{reason}: no dialog"
            );
            assert_eq!(stages(&r), vec![Stage::Refused]);
            assert!(!r.m.check(REPO, 7).await.ready);
        }
        let r = rig();
        assert_eq!(
            r.m.run("../../user", 7, None).await.reason.as_deref(),
            Some("invalid_repo")
        );
    }

    #[tokio::test]
    async fn only_what_github_reports_ready_is_offered() {
        let cases: Vec<(&str, Value, &str)> = vec![
            ("pr", json!({ "draft": true }), "draft"),
            ("pr", json!({ "state": "closed" }), "closed"),
            ("pr", json!({ "merged": true }), "already_merged"),
            ("pr", json!({ "mergeable": null }), "computing"),
            ("pr", json!({ "mergeable": false }), "conflicts"),
            ("pr", json!({ "mergeable_state": "blocked" }), "blocked"),
            ("pr", json!({ "mergeable_state": "behind" }), "behind"),
            (
                "pr",
                json!({ "mergeable_state": "unstable" }),
                "checks_failing",
            ),
            ("pr", json!({ "mergeable_state": "has_hooks" }), "not_clean"),
            (
                "pr",
                json!({ "base": { "ref": "main", "repo": { "full_name": "evil/repo" } } }),
                "repo_mismatch",
            ),
            (
                "reviews",
                json!([
                    { "user": { "login": "a" }, "state": "APPROVED" },
                    { "user": { "login": "b" }, "state": "CHANGES_REQUESTED" },
                    { "user": { "login": "b" }, "state": "COMMENTED" }
                ]),
                "changes_requested",
            ),
            (
                "checks",
                json!({ "total_count": 1, "check_runs": [{ "name": "build", "status": "completed", "conclusion": "failure" }] }),
                "checks_failing",
            ),
            (
                "checks",
                json!({ "total_count": 1, "check_runs": [{ "name": "build", "status": "in_progress", "conclusion": null }] }),
                "checks_pending",
            ),
            (
                "checks",
                json!({ "total_count": 1, "check_runs": [{ "name": "build", "status": "completed", "conclusion": "action_required" }] }),
                "checks_failing",
            ),
            (
                "checks",
                json!({ "total_count": 150, "check_runs": [{ "name": "build", "status": "completed", "conclusion": "success" }] }),
                "too_many_checks",
            ),
            (
                "checks",
                json!({ "total_count": 0, "check_runs": [] }),
                "no_checks",
            ),
            (
                "status",
                json!({ "state": "failure", "statuses": [{ "context": "ci/legacy", "state": "failure" }] }),
                "checks_failing",
            ),
            (
                "branch",
                json!({ "name": "main", "protected": false }),
                "no_required_checks",
            ),
            (
                "branch",
                json!({ "protection": { "required_status_checks": { "contexts": ["build", "e2e"] } } }),
                "required_missing",
            ),
        ];
        for (k, patch, reason) in cases {
            let r = rig();
            let mut v = r.read.bodies.lock().unwrap().get(k).cloned().unwrap();
            match (&mut v, patch) {
                (Value::Object(o), Value::Object(p)) if k == "pr" => o.extend(p),
                (_, p) => v = p,
            }
            r.read.set(k, v);
            let c = r.m.check(REPO, 7).await;
            assert!(!c.ready, "{reason}");
            assert_eq!(c.reason.as_deref(), Some(reason), "{}", c.message);
            let o = r.m.run(REPO, 7, None).await;
            assert_eq!(o.reason.as_deref(), Some(reason));
            assert_eq!(sent(&r), 0, "{reason}: nothing sent");
            assert!(
                r.approver.seen.lock().unwrap().is_none(),
                "{reason}: no dialog"
            );
        }
    }

    #[tokio::test]
    async fn rulesets_count_as_required_checks() {
        let r = rig();
        r.read
            .set("branch", json!({ "name": "main", "protected": true }));
        r.read.set(
            "rules",
            json!([{ "type": "required_status_checks", "parameters": { "required_status_checks": [{ "context": "build" }] } }]),
        );
        assert!(r.m.check(REPO, 7).await.ready);
    }

    #[tokio::test]
    async fn a_push_after_the_last_check_is_refused() {
        let r = rig();
        let o = r.m.run(REPO, 7, Some("0000000deadbeef")).await;
        assert_eq!(o.reason.as_deref(), Some("stale_head"));
        assert_eq!(sent(&r), 0);
    }

    #[tokio::test]
    async fn cancelling_the_dialog_or_touch_id_sends_nothing() {
        let r = rig_with(true, &[REPO], true, false);
        assert_eq!(r.m.run(REPO, 7, None).await.stage, Stage::Cancelled);
        assert_eq!(sent(&r), 0);

        let mut r = rig();
        r.approver = Arc::new(FakeApprover {
            answer: true,
            touch: Err("Touch ID was cancelled.".into()),
            seen: Mutex::new(None),
        });
        r.m.approver = r.approver.clone();
        let o = r.m.run(REPO, 7, None).await;
        assert_eq!(
            (o.stage, o.reason.as_deref()),
            (Stage::Cancelled, Some("touch_id"))
        );
        assert_eq!(sent(&r), 0);
        assert_eq!(stages(&r), vec![Stage::Cancelled]);
    }

    #[tokio::test]
    async fn the_same_pull_request_is_not_sent_twice() {
        let r = rig();
        assert_eq!(r.m.run(REPO, 7, None).await.stage, Stage::Merged);
        let again = r.m.run(REPO, 7, None).await;
        assert_eq!(again.reason.as_deref(), Some("rate_capped"));
        assert_eq!(sent(&r), 1);
    }

    #[tokio::test]
    async fn github_answers_are_mapped_and_never_retried() {
        for (reply, reason) in [
            (resp(401, json!({})), "token_rejected"),
            (
                resp(403, json!({ "message": "Resource not accessible" })),
                "forbidden",
            ),
            (resp(404, json!({})), "not_found"),
            (
                resp(
                    405,
                    json!({ "message": "Required status check is expected" }),
                ),
                "not_mergeable",
            ),
            (
                resp(409, json!({ "message": "Head branch was modified" })),
                "head_changed",
            ),
            (resp(429, json!({})), "rate_limited"),
            (resp(502, json!({})), "github_error"),
        ] {
            let r = rig();
            *r.write.reply.lock().unwrap() = Some(Ok(reply));
            let o = r.m.run(REPO, 7, None).await;
            assert_eq!(
                (o.stage, o.reason.as_deref()),
                (Stage::Failed, Some(reason))
            );
            assert_eq!(sent(&r), 1, "{reason}: one request, no retry");
            assert_eq!(stages(&r), vec![Stage::Attempted, Stage::Failed]);
        }
    }

    #[tokio::test]
    async fn an_ambiguous_timeout_reads_the_pull_request_again() {
        let r = rig();
        *r.write.reply.lock().unwrap() = Some(Err(SendError::Unknown("Timed out".into())));
        assert_eq!(r.m.run(REPO, 7, None).await.stage, Stage::Unknown);

        let r = rig();
        *r.write.reply.lock().unwrap() = Some(Err(SendError::Unknown("Timed out".into())));
        let mut merged = pr();
        merged["merged"] = json!(true);
        r.read.set("pr_later", merged);
        let o = r.m.run(REPO, 7, None).await;
        assert_eq!(o.stage, Stage::Merged, "{}", o.message);
        assert_eq!(stages(&r), vec![Stage::Attempted, Stage::Merged]);
    }

    #[test]
    fn dialog_names_the_pull_request() {
        let p = MergePreview {
            repo: REPO.into(),
            number: 7,
            title: "Fix the footer".into(),
            author: Some("khancam15".into()),
            head: "fix-footer".into(),
            base: "main".into(),
            head_sha: SHA.into(),
            commits: Some(2),
            changed_files: Some(3),
            additions: Some(10),
            deletions: Some(4),
            checks: vec!["build".into()],
            required: vec!["build".into()],
            approvals: vec![],
            url: None,
        };
        let t = dialog_text(&p);
        assert!(t.contains("#7 Fix the footer"));
        assert!(t.contains("khaneilcampbell/benjaire.com · fix-footer into main · by khancam15"));
        assert!(t.contains("2 commits, 3 files, +10 −4"));
        assert!(t.contains("Head commit a1b2c3d. Required checks passed: build."));
        assert!(t.contains("can't be undone"));
    }
}
