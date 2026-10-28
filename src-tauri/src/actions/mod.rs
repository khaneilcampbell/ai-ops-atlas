//! Approval-required actions (autonomy level 2). Each change Atlas can make on GitHub works
//! only on a repository the person has switched on for it, and only after they approve that
//! one change in a native dialog: re-run failed jobs, merge a ready pull request, cancel a
//! run, start a workflow by hand, pause or resume a workflow, and close, reopen or comment on a
//! pull request. Everything except re-runs also asks for Touch ID. Every press is audited.
//! Nothing proposes or approves a change on its own.
//!
//! - `store`: the off switches (`actions.json`) and the audit log (`audit.jsonl`)
//! - `rerun`: pre-flight checks, approval, audit and the single re-run request
//! - `merge`: readiness checks, approval, Touch ID, audit and the single merge request
//! - `ops`: the same path for the everyday workflow and pull request changes
//! - `catalog`: local edits to how an agent is shown, never sent anywhere
//! - `client`: the write-scoped HTTP client; the only code that sends a GitHub write
//!
//! Reads, including the pre-flight check of the run, still go through the read-only
//! client in `github.rs` and its GET allowlist, which this module leaves untouched.

pub mod catalog;
pub mod client;
pub mod merge;
pub mod ops;
pub mod rerun;
pub mod store;

use catalog::{CatalogEdit, Overrides};
use merge::{MergeApprover, MergeCheck, MergeOutcome, MergePreview, Merger};
use ops::{Op, OpApprover, OpOutcome, Operator, WorkflowInfo};
use rerun::{Approver, Outcome, Preview, Rerunner};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Arc;
use store::{clean_repos, ActionsConfig, AuditRecord, Group, Store};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub struct Actions {
    store: Arc<Store>,
    client: Arc<client::WriteClient>,
    rerunner: Rerunner,
    merger: Merger,
    operator: Operator,
    overrides: Overrides,
    actor: String,
    app: AppHandle,
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

/// A native warning dialog with a custom confirm button. `true` only if that button was pressed.
async fn ask(app: &AppHandle, title: &str, text: &str, button: &str) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .message(text)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            button.into(),
            "Cancel".into(),
        ));
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.parent(&w);
    }
    dialog.show(move |ok| {
        let _ = tx.send(ok);
    });
    rx.await.unwrap_or(false)
}

#[async_trait::async_trait]
impl OpApprover for NativeApprover {
    async fn approve(&self, title: &str, text: &str, button: &str) -> bool {
        ask(&self.app, title, text, button).await
    }

    async fn confirm_owner(&self, reason: &str) -> Result<(), String> {
        let reason = reason.to_string();
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
    let dir = app.path().app_data_dir()?.join("actions");
    let store = Arc::new(Store::new(dir.clone())?);
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
        approver.clone(),
        actor(),
        Box::new(chrono::Utc::now),
    );
    let operator = Operator::new(
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
        operator,
        overrides: Overrides::new(dir),
        actor: actor(),
        app: app.handle().clone(),
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

/// Turns one of the everyday actions on or off and sets its repositories. Pull request changes
/// use each repository's pull request token, so only repositories with one can be listed.
#[tauri::command]
pub fn actions_op_settings_set(
    group: Group,
    enabled: bool,
    repos: Vec<String>,
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<ActionsStatus, String> {
    let repos = clean_repos(&repos)?;
    match group {
        Group::PullRequestChanges => {
            let saved = crate::secrets::merge_token_repos();
            if let Some(r) = repos
                .iter()
                .find(|r| !saved.contains(&r.to_ascii_lowercase()))
            {
                return Err(format!(
                    "Save a pull request token for {r} before enabling it."
                ));
            }
        }
        _ => {
            if enabled && crate::secrets::read_actions_token().is_none() {
                return Err("Save an Actions token before turning this on.".into());
            }
        }
    }
    let mut c = actions.store.load_config();
    let sw = c.switch_mut(group);
    sw.enabled = enabled;
    sw.repos = repos;
    actions.store.save_config(&c)?;
    app.emit("actions-changed", ()).ok();
    Ok(status(&actions))
}

/// Cancel a run, start, pause or resume a workflow, or close, reopen or comment on a pull request.
#[tauri::command]
pub async fn action_op(
    repo: String,
    op: Op,
    actions: tauri::State<'_, Actions>,
    app: AppHandle,
) -> Result<OpOutcome, String> {
    let outcome = actions.operator.run(&repo, op).await;
    app.emit("actions-changed", ()).ok();
    Ok(outcome)
}

/// A workflow's state and whether it can be started by hand. Read-only; nothing is logged.
#[tauri::command]
pub async fn action_workflow_info(
    repo: String,
    workflow: String,
    actions: tauri::State<'_, Actions>,
) -> Result<WorkflowInfo, String> {
    actions.operator.workflow_info(&repo, &workflow).await
}

#[tauri::command]
pub fn catalog_overrides(actions: tauri::State<'_, Actions>) -> BTreeMap<String, CatalogEdit> {
    actions.overrides.load()
}

/// Saves a local edit to how an agent is shown, after a native confirmation. `false` when
/// nothing changed or the dialog was cancelled.
#[tauri::command]
pub async fn catalog_override_set(
    agent: String,
    edit: CatalogEdit,
    actions: tauri::State<'_, Actions>,
) -> Result<bool, String> {
    let Some((edit, lines)) = actions.overrides.preview(&agent, edit)? else {
        return Ok(false);
    };
    let text = format!(
        "{}\n\nThis changes how Atlas shows {agent} on this Mac only. No manifest, repository or agent is changed.",
        lines.join("\n")
    );
    if !ask(&actions.app, "Save catalog edit?", &text, "Save").await {
        actions
            .overrides
            .log_cancel(&actions.store, &actions.actor, &agent, &lines);
        return Ok(false);
    }
    actions
        .overrides
        .apply(&actions.store, &actions.actor, &agent, edit, &lines)?;
    actions.app.emit("actions-changed", ()).ok();
    Ok(true)
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
