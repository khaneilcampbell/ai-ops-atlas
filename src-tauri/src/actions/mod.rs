//! Approval-required actions (autonomy level 2). Atlas can make exactly two changes on
//! GitHub, each on a repository the person has switched on and only after they approve that
//! one change in a native dialog: re-run the failed jobs of a failed workflow run, and merge
//! a pull request GitHub reports as ready (which also asks for Touch ID). Every press is
//! audited. Nothing proposes or approves a merge on its own.
//!
//! - `store`: the off switches (`actions.json`) and the audit log (`audit.jsonl`)
//! - `rerun`: pre-flight checks, approval, audit and the single re-run request
//! - `merge`: readiness checks, approval, Touch ID, audit and the single merge request
//! - `client`: the write-scoped HTTP client; the only code that sends a GitHub write
//!
//! Reads, including the pre-flight check of the run, still go through the read-only
//! client in `github.rs` and its GET allowlist, which this module leaves untouched.

pub mod client;
pub mod merge;
pub mod rerun;
pub mod store;

use merge::{MergeApprover, MergeCheck, MergeOutcome, MergePreview, Merger};
use rerun::{Approver, Outcome, Preview, Rerunner};
use serde::Serialize;
use std::sync::Arc;
use store::{clean_repos, ActionsConfig, AuditRecord, Store};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub struct Actions {
    store: Arc<Store>,
    client: Arc<client::WriteClient>,
    rerunner: Rerunner,
    merger: Merger,
}

/// Native confirmation, drawn by macOS rather than the web view, so nothing running in the
/// page can answer it.
struct NativeApprover {
    app: AppHandle,
}

#[async_trait::async_trait]
impl Approver for NativeApprover {
    async fn approve(&self, p: &Preview) -> bool {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let mut dialog = self
            .app
            .dialog()
            .message(rerun::dialog_text(p, chrono::Utc::now()))
            .title("Re-run failed jobs?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Re-run failed jobs".into(),
                "Cancel".into(),
            ));
        if let Some(w) = self.app.get_webview_window("main") {
            dialog = dialog.parent(&w);
        }
        dialog.show(move |ok| {
            let _ = tx.send(ok);
        });
        rx.await.unwrap_or(false)
    }
}

#[async_trait::async_trait]
impl MergeApprover for NativeApprover {
    async fn approve(&self, p: &MergePreview) -> bool {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let mut dialog = self
            .app
            .dialog()
            .message(merge::dialog_text(p))
            .title(format!("Merge pull request #{}?", p.number))
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Merge".into(),
                "Cancel".into(),
            ));
        if let Some(w) = self.app.get_webview_window("main") {
            dialog = dialog.parent(&w);
        }
        dialog.show(move |ok| {
            let _ = tx.send(ok);
        });
        rx.await.unwrap_or(false)
    }

    async fn confirm_owner(&self, p: &MergePreview) -> Result<(), String> {
        let reason = format!(
            "merge pull request #{} into {} on {}",
            p.number, p.base, p.repo
        );
        tauri::async_runtime::spawn_blocking(move || crate::secrets::confirm_owner(&reason))
            .await
            .map_err(|e| e.to_string())?
    }
}

fn actor() -> String {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".into());
    format!("{user} (Atlas desktop)")
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let store = Arc::new(Store::new(app.path().app_data_dir()?.join("actions"))?);
    let client = Arc::new(client::WriteClient::new());
    let approver = Arc::new(NativeApprover {
        app: app.handle().clone(),
    });
    let rerunner = Rerunner::new(
        store.clone(),
        Arc::new(crate::github::Client::new()),
        client.clone(),
        approver.clone(),
        actor(),
        Box::new(chrono::Utc::now),
    );
    let merger = Merger::new(
        store.clone(),
        Arc::new(crate::github::Client::new()),
        client.clone(),
        approver,
        actor(),
        Box::new(chrono::Utc::now),
    );
    app.manage(Actions {
        store,
        client,
        rerunner,
        merger,
    });
    Ok(())
}

#[derive(Serialize)]
pub struct ActionsStatus {
    config: ActionsConfig,
    token: bool,
    /// Repositories (lowercase owner/name) with a merge token saved. Never the tokens.
    merge_tokens: Vec<String>,
}

fn status(a: &Actions) -> ActionsStatus {
    ActionsStatus {
        config: a.store.load_config(),
        token: crate::secrets::read_actions_token().is_some(),
        merge_tokens: crate::secrets::merge_token_repos(),
    }
}

#[tauri::command]
pub fn actions_status(actions: tauri::State<'_, Actions>) -> ActionsStatus {
    status(&actions)
}

/// The newest audit records first, at most `limit` (default 200).
#[tauri::command]
pub fn actions_audit(limit: Option<usize>, actions: tauri::State<'_, Actions>) -> Vec<AuditRecord> {
    let mut log = actions.store.audit();
    log.reverse();
    log.truncate(limit.unwrap_or(200).min(2000));
    log
}

#[tauri::command]
pub fn actions_settings_set(
    enabled: bool,
    repos: Vec<String>,
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<ActionsStatus, String> {
    if enabled && crate::secrets::read_actions_token().is_none() {
        return Err("Save an Actions token before turning this on.".into());
    }
    let mut c = actions.store.load_config();
    c.rerun_failed_jobs.enabled = enabled;
    c.rerun_failed_jobs.repos = clean_repos(&repos)?;
    actions.store.save_config(&c)?;
    app.emit("actions-changed", ()).ok();
    Ok(status(&actions))
}

#[tauri::command]
pub async fn actions_token_set(
    token: String,
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<ActionsStatus, String> {
    let token = token.trim();
    crate::secrets::check_actions_token(token, crate::secrets::read_token().as_deref())?;
    let login = actions.client.token_login(token).await?;
    crate::secrets::set_actions_token(token)?;
    let mut c = actions.store.load_config();
    c.token_login = Some(login);
    actions.store.save_config(&c)?;
    app.emit("actions-changed", ()).ok();
    Ok(status(&actions))
}

/// Removing the token also turns the action off.
#[tauri::command]
pub fn actions_token_clear(
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<ActionsStatus, String> {
    crate::secrets::clear_actions_token()?;
    let mut c = actions.store.load_config();
    c.token_login = None;
    c.rerun_failed_jobs.enabled = false;
    actions.store.save_config(&c)?;
    app.emit("actions-changed", ()).ok();
    Ok(status(&actions))
}

#[tauri::command]
pub async fn action_rerun_failed(
    repo: String,
    run_id: u64,
    seen_attempt: Option<u32>,
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<Outcome, String> {
    let outcome = actions.rerunner.run(&repo, run_id, seen_attempt).await;
    app.emit("actions-changed", ()).ok();
    Ok(outcome)
}

/// Merging needs a token per repository, so only repositories with one can be listed.
#[tauri::command]
pub fn actions_merge_settings_set(
    enabled: bool,
    repos: Vec<String>,
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<ActionsStatus, String> {
    let repos = clean_repos(&repos)?;
    let saved = crate::secrets::merge_token_repos();
    if let Some(r) = repos
        .iter()
        .find(|r| !saved.contains(&r.to_ascii_lowercase()))
    {
        return Err(format!("Save a merge token for {r} before enabling it."));
    }
    let mut c = actions.store.load_config();
    c.merge_pull_requests.enabled = enabled;
    c.merge_pull_requests.repos = repos;
    actions.store.save_config(&c)?;
    app.emit("actions-changed", ()).ok();
    Ok(status(&actions))
}

#[tauri::command]
pub async fn merge_token_set(
    repo: String,
    token: String,
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<ActionsStatus, String> {
    let repo = clean_repos(std::slice::from_ref(&repo))?
        .pop()
        .ok_or("Choose a repository.")?;
    let token = token.trim();
    crate::secrets::check_merge_token(token, &[])?;
    let login = actions.client.token_login(token).await?;
    actions.client.token_sees_repo(token, &repo).await?;
    crate::secrets::set_merge_token(&repo, token)?;
    let mut c = actions.store.load_config();
    c.merge_pull_requests
        .token_logins
        .insert(repo.to_ascii_lowercase(), login);
    actions.store.save_config(&c)?;
    app.emit("actions-changed", ()).ok();
    Ok(status(&actions))
}

/// Removing a repository's merge token also takes it off the merge list.
#[tauri::command]
pub fn merge_token_clear(
    repo: String,
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<ActionsStatus, String> {
    crate::secrets::clear_merge_token(&repo)?;
    let mut c = actions.store.load_config();
    c.merge_pull_requests
        .token_logins
        .remove(&repo.to_ascii_lowercase());
    c.merge_pull_requests
        .repos
        .retain(|r| !r.eq_ignore_ascii_case(&repo));
    actions.store.save_config(&c)?;
    app.emit("actions-changed", ()).ok();
    Ok(status(&actions))
}

/// Whether a pull request is ready to merge from Atlas. Read-only; nothing is logged.
#[tauri::command]
pub async fn action_merge_check(
    repo: String,
    number: u64,
    actions: tauri::State<'_, Actions>,
) -> Result<MergeCheck, String> {
    Ok(actions.merger.check(&repo, number).await)
}

#[tauri::command]
pub async fn action_merge_pr(
    repo: String,
    number: u64,
    seen_sha: Option<String>,
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<MergeOutcome, String> {
    let outcome = actions.merger.run(&repo, number, seen_sha.as_deref()).await;
    app.emit("actions-changed", ()).ok();
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
        for e in fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                sources(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }

    /// Keeps the write surface where reviewers expect it: GitHub writes only in
    /// `actions/client.rs`, the Actions token read only there, and the one other POST in
    /// the app (the Anthropic Messages API) nowhere near GitHub.
    #[test]
    fn writes_and_the_write_token_stay_in_the_actions_client() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = vec![];
        sources(&root, &mut files);
        assert!(files.len() > 10);
        for f in files {
            let rel = f
                .strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let code = fs::read_to_string(&f).unwrap();
            // Ignore this test's own source text.
            let code = code.split("#[cfg(test)]").next().unwrap();
            let writes = [
                ".post(",
                ".put(",
                ".patch(",
                ".delete(",
                "Method::POST",
                "Method::PUT",
                "Method::PATCH",
                "Method::DELETE",
            ]
            .iter()
            .any(|m| code.contains(m));
            match rel.as_str() {
                "actions/client.rs" => {}
                "intel/claude.rs" => assert!(
                    !code.contains("github.com"),
                    "the Anthropic client must not talk to GitHub"
                ),
                // Writes only the usage snapshot to the user's own site, never to GitHub.
                "usage_sync.rs" => assert!(
                    !code.contains("github.com") && !code.contains("read_token"),
                    "the usage sync must not talk to GitHub or read a GitHub token"
                ),
                _ => assert!(
                    !writes,
                    "{rel} sends a write request; GitHub writes belong in actions/client.rs"
                ),
            }
            if code.contains("read_merge_token") {
                assert!(
                    matches!(rel.as_str(), "actions/client.rs" | "secrets.rs"),
                    "{rel} reads a merge token"
                );
            }
            if code.contains("read_actions_token") {
                assert!(
                    matches!(
                        rel.as_str(),
                        "actions/client.rs" | "actions/mod.rs" | "secrets.rs"
                    ),
                    "{rel} reads the Actions token"
                );
            }
        }
    }
}
