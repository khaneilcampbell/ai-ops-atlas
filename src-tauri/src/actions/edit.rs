//! "Propose an edit": change one text file in a repository through a pull request. It follows
//! the merge action's order: every check that can stop the edit runs before the approval
//! dialog, the dialog runs before the audit record, and the audit record is written before
//! the first request is sent.
//!
//! The change never lands on the default branch. Atlas creates a new `atlas-edit/...` branch
//! from the default branch, commits the one file there and opens a pull request into the
//! default branch. Merging it is the separate "Merge from Atlas" action (or GitHub itself).
//! The file must still be the version the person edited: the commit names that blob, so a
//! change pushed in between makes GitHub refuse it.

use super::rerun::{SendError, WriteResponse};
use super::store::{edit_rate_block, AuditRecord, Stage, Store, ACTION_EDIT};
use crate::intel::collect::{valid_repo, GithubApi};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

/// Every branch Atlas creates starts with this, and the write client refuses any other.
pub const EDIT_BRANCH_PREFIX: &str = "atlas-edit/";
/// Large enough for any README or config file, small enough to review in the app.
pub const MAX_FILE_BYTES: usize = 512 * 1024;
const MAX_PATH: usize = 300;
const MAX_TITLE: usize = 120;
const MAX_NOTE: usize = 2000;

/// The three requests an edit sends, implemented by the Keychain-backed client in `client.rs`
/// with the repository's own merge token (Contents and Pull requests, that repository only).
#[async_trait::async_trait]
pub trait EditApi: Send + Sync {
    async fn has_edit_token(&self, repo: &str) -> bool;
    async fn create_branch(
        &self,
        repo: &str,
        branch: &str,
        from_sha: &str,
    ) -> Result<WriteResponse, SendError>;
    async fn put_file(
        &self,
        repo: &str,
        branch: &str,
        path: &str,
        content: &str,
        blob_sha: &str,
        message: &str,
    ) -> Result<WriteResponse, SendError>;
    async fn open_pull(
        &self,
        repo: &str,
        head: &str,
        base: &str,
        title: &str,
        body: &str,
    ) -> Result<WriteResponse, SendError>;
}

/// Asks the person at the Mac. The real one is a native dialog the web view can't answer.
#[async_trait::async_trait]
pub trait EditApprover: Send + Sync {
    async fn approve(&self, p: &EditPreview) -> bool;
}

/// What the web view asks for: the file, the version it showed, and the new text.
#[derive(Debug, Clone, Deserialize)]
pub struct EditRequest {
    pub repo: String,
    pub path: String,
    /// The blob sha of the file the person edited, as GitHub reported it.
    pub base_sha: String,
    pub content: String,
    pub title: Option<String>,
    pub note: Option<String>,
}

/// What the person approves: the change as Atlas will send it.
#[derive(Debug, Clone, Serialize)]
pub struct EditPreview {
    pub repo: String,
    pub path: String,
    /// The default branch the pull request targets.
    pub base: String,
    pub base_commit: String,
    pub branch: String,
    pub title: String,
    pub added: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditOutcome {
    pub stage: Stage,
    pub reason: Option<String>,
    pub message: String,
    pub audit_id: String,
    pub pull_number: Option<u64>,
    pub pull_url: Option<String>,
    pub branch: Option<String>,
}

pub struct Editor {
    pub store: Arc<Store>,
    pub read: Arc<dyn GithubApi>,
    pub write: Arc<dyn EditApi>,
    pub approver: Arc<dyn EditApprover>,
    pub actor: String,
    pub clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    in_flight: tokio::sync::Mutex<()>,
}

type Refusal = (String, String);

fn refuse(reason: &str, message: impl Into<String>) -> Refusal {
    (reason.to_string(), message.into())
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}

/// A repository-relative file path Atlas may edit. Plain segments only, nothing inside `.git`,
/// and no workflow files: those run with the repository's secrets and need a broader token.
pub fn valid_path(path: &str) -> bool {
    if path.is_empty() || path.len() > MAX_PATH || path.starts_with('/') || path.ends_with('/') {
        return false;
    }
    let segments_ok = path.split('/').all(|seg| {
        !seg.is_empty()
            && seg != "."
            && seg != ".."
            && !seg.eq_ignore_ascii_case(".git")
            && seg
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.@+ ".contains(c))
    });
    segments_ok && !path.to_ascii_lowercase().starts_with(".github/workflows/")
}

/// Percent-encodes a valid path for a URL, segment by segment.
pub fn encode_path(path: &str) -> String {
    path.split('/')
        .map(|seg| {
            seg.chars()
                .map(|c| match c {
                    ' ' => "%20".to_string(),
                    '@' => "%40".to_string(),
                    '+' => "%2B".to_string(),
                    c => c.to_string(),
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn valid_branch(b: &str) -> bool {
    !b.is_empty()
        && b.len() <= 200
        && !b.contains("..")
        && !b.starts_with('/')
        && !b.ends_with('/')
        && b.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c))
}

fn valid_sha(sha: &str) -> bool {
    sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit())
}

/// `atlas-edit/<file-name>-<UTC time>`, unique per second and per file.
pub fn branch_name(path: &str, now: DateTime<Utc>) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    let slug: String = file
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() { "file".into() } else { slug };
    let slug: String = slug.chars().take(40).collect();
    format!("{EDIT_BRANCH_PREFIX}{slug}-{}", now.format("%Y%m%d-%H%M%S"))
}

/// Lines added and removed, the way a diff counts them: the common lines at the start and
/// end are trimmed, then the longest common subsequence of the rest is kept.
pub fn line_changes(old: &str, new: &str) -> (usize, usize) {
    let a: Vec<&str> = old.lines().collect();
    let b: Vec<&str> = new.lines().collect();
    let mut start = 0;
    while start < a.len() && start < b.len() && a[start] == b[start] {
        start += 1;
    }
    let mut end = 0;
    while end < a.len() - start
        && end < b.len() - start
        && a[a.len() - 1 - end] == b[b.len() - 1 - end]
    {
        end += 1;
    }
    let a = &a[start..a.len() - end];
    let b = &b[start..b.len() - end];
    // A whole-file rewrite of a big file isn't worth a quadratic table: count it as replaced.
    if a.len().saturating_mul(b.len()) > 4_000_000 {
        return (b.len(), a.len());
    }
    let mut prev = vec![0usize; b.len() + 1];
    for x in a {
        let mut cur = vec![0usize; b.len() + 1];
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = if x == y {
                prev[j] + 1
            } else {
                cur[j].max(prev[j + 1])
            };
        }
        prev = cur;
    }
    let common = prev[b.len()];
    (b.len() - common, a.len() - common)
}

fn one_line(text: &str, max: usize) -> String {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    t.chars().take(max).collect()
}

/// The text of the approval dialog.
pub fn dialog_text(p: &EditPreview) -> String {
    [
        format!("{} · {}", p.path, p.repo),
        format!(
            "{} line{} added, {} removed.",
            p.added,
            if p.added == 1 { "" } else { "s" },
            p.removed
        ),
        String::new(),
        format!(
            "Atlas creates the branch {} from {} at {}, commits this one file there and opens a pull request into {}.",
            p.branch,
            p.base,
            &p.base_commit[..7],
            p.base
        ),
        format!("Nothing is merged and {} is not changed.", p.base),
    ]
    .join("\n")
}

fn pull_body(note: &str) -> String {
    let mut body = String::new();
    if !note.is_empty() {
        body.push_str(note);
        body.push_str("\n\n");
    }
    body.push_str("Opened from the AI Ops Atlas editor. One file changed; nothing was merged.");
    body
}

/// Maps GitHub's answer to one of the three requests to a failure, or `None` on success.
fn failed(step: &str, r: &WriteResponse) -> Option<(&'static str, String)> {
    if (200..300).contains(&r.status) {
        return None;
    }
    let gh = s(&r.body, "message").unwrap_or_default();
    let detail = if gh.is_empty() {
        String::new()
    } else {
        format!(": {gh}")
    };
    Some(match r.status {
        401 => (
            "token_rejected",
            "GitHub rejected this repository's token. It may have expired; replace it in Settings.".into(),
        ),
        403 if r.rate_remaining == Some(0) || r.retry_after.is_some() => (
            "rate_limited",
            "GitHub is limiting requests. Try again later.".into(),
        ),
        403 | 404 => (
            "forbidden",
            format!("GitHub refused to {step}{detail}. Check that the token has Contents and Pull requests: read and write on this repository."),
        ),
        409 => (
            "stale_file",
            format!("GitHub refused to {step}{detail}. The file changed on GitHub while you were editing; reload it and try again."),
        ),
        422 => ("github_refused", format!("GitHub refused to {step}{detail}.")),
        st => ("github_error", format!("GitHub returned {st} when asked to {step}{detail}.")),
    })
}

impl Editor {
    pub fn new(
        store: Arc<Store>,
        read: Arc<dyn GithubApi>,
        write: Arc<dyn EditApi>,
        approver: Arc<dyn EditApprover>,
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
                format!("GitHub can't find the {what}."),
            )),
            st => Err(refuse(
                "preflight_failed",
                format!("Couldn't read the {what} from GitHub (status {st})."),
            )),
        }
    }

    /// The switch, the repository list, the token and the request itself.
    async fn gate(&self, req: &EditRequest) -> Result<(), Refusal> {
        if !valid_repo(&req.repo) {
            return Err(refuse(
                "invalid_repo",
                "That isn't a valid owner/name repository.",
            ));
        }
        let config = self.store.load_config();
        if !config.edit_files.enabled {
            return Err(refuse(
                "disabled",
                "Editing from Atlas is off. Turn it on in Settings.",
            ));
        }
        if !config.allows_edit(&req.repo) {
            return Err(refuse(
                "repo_not_enabled",
                "This repository isn't enabled for edits. Add it in Settings.",
            ));
        }
        if !self.write.has_edit_token(&req.repo).await {
            return Err(refuse(
                "no_token",
                "Save a token for this repository in Settings first.",
            ));
        }
        if !valid_path(&req.path) {
            return Err(refuse(
                "invalid_path",
                "Atlas can't edit that path. Workflow files and anything inside .git stay out of the editor.",
            ));
        }
        if !valid_sha(&req.base_sha) {
            return Err(refuse(
                "invalid_request",
                "The editor didn't say which version of the file it changed.",
            ));
        }
        if req.content.len() > MAX_FILE_BYTES {
            return Err(refuse(
                "too_large",
                format!(
                    "Files over {} KB can't be edited in Atlas.",
                    MAX_FILE_BYTES / 1024
                ),
            ));
        }
        if req.content.contains('\0') {
            return Err(refuse("binary", "Only text files can be edited in Atlas."));
        }
        Ok(())
    }

    /// Reads the repository, its default branch and the file, and refuses unless the file is
    /// still the version the person edited and the new text differs. Read-only.
    async fn preflight(&self, req: &EditRequest) -> Result<EditPreview, Refusal> {
        let repo = &req.repo;
        let meta = self.get(&format!("/repos/{repo}"), "repository").await?;
        if !s(&meta, "full_name").is_some_and(|n| n.eq_ignore_ascii_case(repo)) {
            return Err(refuse(
                "repo_mismatch",
                "GitHub returned a different repository. It may have been renamed; refresh Atlas.",
            ));
        }
        if meta.get("archived").and_then(Value::as_bool) == Some(true) {
            return Err(refuse("archived", "This repository is archived."));
        }
        let base = s(&meta, "default_branch").unwrap_or_default();
        if !valid_branch(&base) {
            return Err(refuse(
                "preflight_failed",
                "GitHub didn't report a usable default branch.",
            ));
        }
        let head = self
            .get(
                &format!("/repos/{repo}/git/ref/heads/{base}"),
                "default branch",
            )
            .await?;
        let base_commit = head
            .pointer("/object/sha")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if !valid_sha(&base_commit) {
            return Err(refuse(
                "preflight_failed",
                "GitHub didn't report the default branch's commit.",
            ));
        }
        let file = self
            .get(
                &format!(
                    "/repos/{repo}/contents/{}?ref={base}",
                    encode_path(&req.path)
                ),
                "file",
            )
            .await?;
        if s(&file, "type").as_deref() != Some("file") {
            return Err(refuse("not_a_file", "That path isn't a file."));
        }
        let sha = s(&file, "sha").unwrap_or_default();
        if !sha.eq_ignore_ascii_case(&req.base_sha) {
            return Err(refuse(
                "stale_file",
                format!("{} changed on {base} since you opened it. Reload it to start from the current version.", req.path),
            ));
        }
        let raw: String = s(&file, "content")
            .unwrap_or_default()
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        let old = base64::engine::general_purpose::STANDARD
            .decode(raw)
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .ok_or_else(|| refuse("binary", "Only text files can be edited in Atlas."))?;
        if old == req.content {
            return Err(refuse(
                "no_change",
                "Nothing changed, so there's nothing to send.",
            ));
        }
        let (added, removed) = line_changes(&old, &req.content);
        let title = req
            .title
            .as_deref()
            .map(|t| one_line(t, MAX_TITLE))
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| format!("Edit {} from Atlas", req.path));
        Ok(EditPreview {
            repo: repo.clone(),
            path: req.path.clone(),
            base,
            base_commit,
            branch: branch_name(&req.path, (self.clock)()),
            title,
            added,
            removed,
        })
    }

    fn record(
        &self,
        id: &str,
        req: &EditRequest,
        p: Option<&EditPreview>,
        stage: Stage,
    ) -> AuditRecord {
        AuditRecord {
            id: id.to_string(),
            at: (self.clock)(),
            action: ACTION_EDIT.into(),
            actor: self.actor.clone(),
            github_login: self
                .store
                .load_config()
                .merge_pull_requests
                .token_logins
                .get(&req.repo.to_ascii_lowercase())
                .cloned(),
            repo: req.repo.clone(),
            run_id: 0,
            pull_number: None,
            title: p.map(|p| p.title.clone()),
            base: p.map(|p| p.base.clone()),
            path: Some(req.path.chars().take(MAX_PATH).collect()),
            workflow: None,
            run_number: None,
            attempt_before: None,
            head_sha: None,
            branch: p.map(|p| p.branch.clone()),
            stage,
            reason: None,
            http_status: None,
            request_id: None,
            message: None,
        }
    }

    fn stop(&self, mut r: AuditRecord, reason: &str, message: String) -> EditOutcome {
        let stage = r.stage;
        r.reason = Some(reason.into());
        r.message = Some(message.clone());
        // A refusal sends nothing, so a failed log write doesn't change the outcome.
        let _ = self.store.append(&r);
        EditOutcome {
            stage,
            reason: Some(reason.into()),
            message,
            audit_id: r.id,
            pull_number: None,
            pull_url: None,
            branch: None,
        }
    }

    pub async fn run(&self, req: &EditRequest) -> EditOutcome {
        let id = uuid::Uuid::new_v4().to_string();
        let stop = |p: Option<&EditPreview>, (reason, msg): Refusal| {
            self.stop(self.record(&id, req, p, Stage::Refused), &reason, msg)
        };

        let Ok(_guard) = self.in_flight.try_lock() else {
            return stop(
                None,
                refuse("busy", "Another edit is being sent. Wait for it to finish."),
            );
        };
        if let Err(e) = self.gate(req).await {
            return stop(None, e);
        }
        let preview = match self.preflight(req).await {
            Ok(p) => p,
            Err(e) => return stop(None, e),
        };
        let p = Some(&preview);
        if let Some(msg) = edit_rate_block(&self.store.audit(), (self.clock)()) {
            return stop(p, refuse("rate_capped", msg));
        }
        if !self.approver.approve(&preview).await {
            return self.stop(
                self.record(&id, req, p, Stage::Cancelled),
                "cancelled",
                "Cancelled. Nothing was sent to GitHub.".into(),
            );
        }
        // Fail closed: no audit record, no request.
        if let Err(e) = self
            .store
            .append(&self.record(&id, req, p, Stage::Attempted))
        {
            return EditOutcome {
                stage: Stage::Failed,
                reason: Some("audit_unavailable".into()),
                message: format!("{e}. Nothing was sent to GitHub."),
                audit_id: id,
                pull_number: None,
                pull_url: None,
                branch: None,
            };
        }

        let mut result = self.record(&id, req, p, Stage::Failed);
        let mut outcome = EditOutcome {
            stage: Stage::Failed,
            reason: None,
            message: String::new(),
            audit_id: id.clone(),
            pull_number: None,
            pull_url: None,
            branch: None,
        };
        let note: String = req
            .note
            .as_deref()
            .unwrap_or("")
            .trim()
            .chars()
            .take(MAX_NOTE)
            .collect();
        let steps = self
            .send(&preview, req, &note, &mut result, &mut outcome)
            .await;
        let (stage, reason, message) = match steps {
            Ok(number) => (
                Stage::Opened,
                None,
                format!(
                    "Opened pull request #{number} on {} into {}. Nothing is merged until you merge it.",
                    preview.repo, preview.base
                ),
            ),
            Err((stage, reason, message)) => (stage, Some(reason), message),
        };
        result.stage = stage;
        result.reason = reason.map(str::to_owned);
        result.message = Some(message.clone());
        result.at = (self.clock)();
        outcome.stage = stage;
        outcome.reason = reason.map(str::to_owned);
        outcome.message = match self.store.append(&result) {
            Ok(()) => message,
            Err(e) => format!("{message} (The result couldn't be added to the audit log: {e}.)"),
        };
        outcome
    }

    /// The three requests, in order, stopping at the first that doesn't succeed. Nothing is
    /// retried: a timeout leaves the outcome unknown and says what to check.
    async fn send(
        &self,
        p: &EditPreview,
        req: &EditRequest,
        note: &str,
        result: &mut AuditRecord,
        outcome: &mut EditOutcome,
    ) -> Result<u64, (Stage, &'static str, String)> {
        let unknown = |e: String, what: &str| {
            (
                Stage::Unknown,
                "unknown",
                format!("{e}. GitHub may or may not have {what}; check the repository's branches and pull requests before trying again."),
            )
        };
        let not_sent = |e: String| {
            (
                Stage::Failed,
                "network",
                format!("{e}. Nothing reached GitHub."),
            )
        };
        let left = |msg: String| {
            format!(
                "{msg} The branch {} was created and can be deleted on GitHub.",
                p.branch
            )
        };

        let r = match self
            .write
            .create_branch(&p.repo, &p.branch, &p.base_commit)
            .await
        {
            Ok(r) => r,
            Err(SendError::NotSent(e)) => return Err(not_sent(e)),
            Err(SendError::Unknown(e)) => return Err(unknown(e, "created the branch")),
        };
        result.http_status = Some(r.status);
        result.request_id = r.request_id.clone();
        if let Some((reason, msg)) = failed("create the branch", &r) {
            return Err((Stage::Failed, reason, msg));
        }
        outcome.branch = Some(p.branch.clone());

        let r = match self
            .write
            .put_file(
                &p.repo,
                &p.branch,
                &p.path,
                &req.content,
                &req.base_sha,
                &p.title,
            )
            .await
        {
            Ok(r) => r,
            Err(SendError::NotSent(e)) => {
                return Err((Stage::Failed, "network", left(format!("{e}."))))
            }
            Err(SendError::Unknown(e)) => return Err(unknown(e, "committed the file")),
        };
        result.http_status = Some(r.status);
        result.request_id = r.request_id.clone();
        if let Some((reason, msg)) = failed("commit the file", &r) {
            return Err((Stage::Failed, reason, left(msg)));
        }
        result.head_sha = r
            .body
            .pointer("/commit/sha")
            .and_then(Value::as_str)
            .map(str::to_owned);

        let r = match self
            .write
            .open_pull(&p.repo, &p.branch, &p.base, &p.title, &pull_body(note))
            .await
        {
            Ok(r) => r,
            Err(SendError::NotSent(e)) => {
                return Err((
                    Stage::Failed,
                    "network",
                    left(format!(
                    "{e}. The change is committed on the branch; open the pull request on GitHub."
                )),
                ))
            }
            Err(SendError::Unknown(e)) => return Err(unknown(e, "opened the pull request")),
        };
        result.http_status = Some(r.status);
        result.request_id = r.request_id.clone();
        if let Some((reason, msg)) = failed("open the pull request", &r) {
            return Err((Stage::Failed, reason, left(msg)));
        }
        let number = r.body.get("number").and_then(Value::as_u64).unwrap_or(0);
        result.pull_number = Some(number);
        outcome.pull_number = Some(number);
        outcome.pull_url = s(&r.body, "html_url");
        Ok(number)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::store::ActionsConfig;
    use crate::intel::collect::GhResponse;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    const REPO: &str = "khaneilcampbell/benjaire.com";
    const HEAD: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
    const BLOB: &str = "0123456789abcdef0123456789abcdef01234567";

    fn now() -> DateTime<Utc> {
        "2026-10-28T22:00:00Z".parse().unwrap()
    }

    fn b64(t: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(t)
    }

    struct FakeRead {
        bodies: Mutex<BTreeMap<String, Value>>,
        paths: Mutex<Vec<String>>,
    }

    #[async_trait::async_trait]
    impl GithubApi for FakeRead {
        async fn get(&self, path: &str) -> Result<GhResponse, String> {
            self.paths.lock().unwrap().push(path.into());
            let key = if path.contains("/contents/") {
                "file"
            } else if path.contains("/git/ref/") {
                "ref"
            } else {
                "repo"
            };
            let body = self.bodies.lock().unwrap().get(key).cloned();
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

    #[derive(Default)]
    struct FakeWrite {
        sent: Mutex<Vec<String>>,
        replies: Mutex<BTreeMap<&'static str, u16>>,
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

    impl FakeWrite {
        fn reply(
            &self,
            step: &'static str,
            ok: u16,
            body: Value,
        ) -> Result<WriteResponse, SendError> {
            let status = self
                .replies
                .lock()
                .unwrap()
                .get(step)
                .copied()
                .unwrap_or(ok);
            Ok(resp(status, body))
        }
    }

    #[async_trait::async_trait]
    impl EditApi for FakeWrite {
        async fn has_edit_token(&self, _repo: &str) -> bool {
            true
        }
        async fn create_branch(
            &self,
            repo: &str,
            branch: &str,
            sha: &str,
        ) -> Result<WriteResponse, SendError> {
            self.sent
                .lock()
                .unwrap()
                .push(format!("branch {repo} {branch} {sha}"));
            self.reply("branch", 201, json!({}))
        }
        async fn put_file(
            &self,
            _repo: &str,
            branch: &str,
            path: &str,
            content: &str,
            blob: &str,
            msg: &str,
        ) -> Result<WriteResponse, SendError> {
            self.sent
                .lock()
                .unwrap()
                .push(format!("put {branch} {path} {blob} {msg} {content}"));
            self.reply("put", 200, json!({ "commit": { "sha": "c0ffee" } }))
        }
        async fn open_pull(
            &self,
            _repo: &str,
            head: &str,
            base: &str,
            title: &str,
            body: &str,
        ) -> Result<WriteResponse, SendError> {
            self.sent
                .lock()
                .unwrap()
                .push(format!("pull {head} {base} {title} {body}"));
            self.reply(
                "pull",
                201,
                json!({ "number": 91, "html_url": "https://github.com/x/y/pull/91" }),
            )
        }
    }

    struct FakeApprover {
        answer: bool,
        seen: Mutex<Option<EditPreview>>,
    }

    #[async_trait::async_trait]
    impl EditApprover for FakeApprover {
        async fn approve(&self, p: &EditPreview) -> bool {
            *self.seen.lock().unwrap() = Some(p.clone());
            self.answer
        }
    }

    struct Rig {
        _dir: tempfile::TempDir,
        store: Arc<Store>,
        read: Arc<FakeRead>,
        write: Arc<FakeWrite>,
        approver: Arc<FakeApprover>,
        e: Editor,
    }

    fn rig_with(enabled: bool, approve: bool) -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(dir.path().to_path_buf()).unwrap());
        let mut c = ActionsConfig::default();
        c.edit_files.enabled = enabled;
        c.edit_files.repos = vec![REPO.into()];
        // The merge switch must not stand in for the edit switch.
        c.merge_pull_requests.enabled = true;
        c.merge_pull_requests.repos = vec![REPO.into()];
        store.save_config(&c).unwrap();
        let read = Arc::new(FakeRead {
            bodies: Mutex::new(BTreeMap::new()),
            paths: Mutex::new(vec![]),
        });
        {
            let mut b = read.bodies.lock().unwrap();
            b.insert(
                "repo".into(),
                json!({ "full_name": REPO, "default_branch": "main", "archived": false }),
            );
            b.insert("ref".into(), json!({ "object": { "sha": HEAD } }));
            b.insert("file".into(), json!({ "type": "file", "sha": BLOB, "encoding": "base64", "content": b64("# Title\nold line\nend\n") }));
        }
        let write = Arc::new(FakeWrite::default());
        let approver = Arc::new(FakeApprover {
            answer: approve,
            seen: Mutex::new(None),
        });
        let e = Editor::new(
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
            e,
        }
    }

    fn req(content: &str) -> EditRequest {
        EditRequest {
            repo: REPO.into(),
            path: "docs/READ ME.md".into(),
            base_sha: BLOB.into(),
            content: content.into(),
            title: Some("Fix the  README\n wording".into()),
            note: None,
        }
    }

    fn stages(r: &Rig) -> Vec<Stage> {
        r.store.audit().iter().map(|a| a.stage).collect()
    }

    #[tokio::test]
    async fn an_approved_edit_opens_a_pull_request_on_a_new_branch() {
        let r = rig_with(true, true);
        let o = r.e.run(&req("# Title\nnew line\nend\n")).await;
        assert_eq!(o.stage, Stage::Opened, "{}", o.message);
        assert_eq!(o.pull_number, Some(91));
        assert_eq!(
            o.branch.as_deref(),
            Some("atlas-edit/read-me-md-20261028-220000")
        );
        let sent = r.write.sent.lock().unwrap().clone();
        assert_eq!(sent.len(), 3);
        assert_eq!(
            sent[0],
            format!("branch {REPO} atlas-edit/read-me-md-20261028-220000 {HEAD}")
        );
        assert!(sent[1].starts_with(&format!("put atlas-edit/read-me-md-20261028-220000 docs/READ ME.md {BLOB} Fix the README wording")));
        assert!(sent[2]
            .starts_with("pull atlas-edit/read-me-md-20261028-220000 main Fix the README wording"));
        assert_eq!(stages(&r), vec![Stage::Attempted, Stage::Opened]);
        let last = r.store.audit().pop().unwrap();
        assert_eq!(
            (
                last.pull_number,
                last.head_sha.as_deref(),
                last.path.as_deref()
            ),
            (Some(91), Some("c0ffee"), Some("docs/READ ME.md"))
        );
        let seen = r.approver.seen.lock().unwrap().clone().unwrap();
        assert_eq!((seen.added, seen.removed), (1, 1));
        assert!(r.read.paths.lock().unwrap().iter().any(
            |p| p == "/repos/khaneilcampbell/benjaire.com/contents/docs/READ%20ME.md?ref=main"
        ));
    }

    #[tokio::test]
    async fn switch_cancel_and_unchanged_text_send_nothing() {
        let r = rig_with(false, true);
        assert_eq!(r.e.run(&req("x")).await.reason.as_deref(), Some("disabled"));
        let r = rig_with(true, false);
        let o = r.e.run(&req("x")).await;
        assert_eq!(o.stage, Stage::Cancelled);
        let r = rig_with(true, true);
        let o = r.e.run(&req("# Title\nold line\nend\n")).await;
        assert_eq!(o.reason.as_deref(), Some("no_change"));
        assert!(r.write.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_file_changed_on_github_since_it_was_opened_is_refused() {
        let r = rig_with(true, true);
        let mut q = req("new");
        q.base_sha = "f".repeat(40);
        let o = r.e.run(&q).await;
        assert_eq!(o.reason.as_deref(), Some("stale_file"));
        assert!(r.write.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn unsafe_paths_are_refused_before_any_read() {
        let r = rig_with(true, true);
        for path in [
            ".github/workflows/ci.yml",
            "../x",
            "a/.git/config",
            "/etc/passwd",
            "a//b",
            "a/b/",
            "a\\b",
            "a?b",
        ] {
            let mut q = req("x");
            q.path = path.into();
            assert_eq!(
                r.e.run(&q).await.reason.as_deref(),
                Some("invalid_path"),
                "{path}"
            );
        }
        assert!(r.read.paths.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_failed_commit_names_the_branch_left_behind() {
        let r = rig_with(true, true);
        r.write.replies.lock().unwrap().insert("put", 409);
        let o = r.e.run(&req("changed")).await;
        assert_eq!(o.stage, Stage::Failed);
        assert_eq!(o.reason.as_deref(), Some("stale_file"));
        assert!(o.message.contains("atlas-edit/"), "{}", o.message);
        assert_eq!(
            r.write.sent.lock().unwrap().len(),
            2,
            "no pull request after a failed commit"
        );
    }

    #[test]
    fn counts_changed_lines() {
        assert_eq!(line_changes("a\nb\nc\n", "a\nB\nc\n"), (1, 1));
        assert_eq!(line_changes("a\nb\n", "a\nb\nc\n"), (1, 0));
        assert_eq!(line_changes("a\nb\nc\n", "c\n"), (0, 2));
        assert_eq!(line_changes("", "x\ny"), (2, 0));
    }

    #[test]
    fn dialog_says_nothing_is_merged() {
        let t = dialog_text(&EditPreview {
            repo: REPO.into(),
            path: "README.md".into(),
            base: "main".into(),
            base_commit: HEAD.into(),
            branch: "atlas-edit/readme-md-20261028-220000".into(),
            title: "t".into(),
            added: 2,
            removed: 1,
        });
        assert!(t.contains("2 lines added, 1 removed"));
        assert!(t.contains("Nothing is merged and main is not changed."));
    }
}
