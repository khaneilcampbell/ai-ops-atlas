//! Repository Intelligence Agent: collects read-only GitHub data for one repository, asks
//! Claude for a structured assessment, validates it and saves it locally.
//!
//! Modules, in pipeline order:
//! - `collect`: GitHub reads and deterministic facts and findings
//! - `prompt`: sanitized, fenced prompt and the output schema
//! - `claude`: Messages API client with timeouts, retries and backoff
//! - `validate`: strict parsing and citation checks of the model output
//! - `cost`: pricing, estimates, per-run and monthly limits
//! - `store`: JSON files in the app data folder
//! - `jobs`: queueing, de-duplication, cancellation, the pipeline and the scheduler

pub mod claude;
pub mod collect;
pub mod cost;
pub mod jobs;
pub mod prompt;
pub mod store;
pub mod types;
pub mod validate;

use jobs::{Agent, AgentStatus, EnqueueResult};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use types::*;

pub type AgentState = Arc<Agent>;

/// Builds the agent with the real GitHub and Anthropic clients and starts the
/// app-local scheduler. The scheduler only acts when scheduling is turned on.
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?.join("intelligence");
    let store = store::Store::new(dir)?;
    let handle = app.handle().clone();
    let agent = Agent::new(
        store,
        Arc::new(crate::github::Client::new()),
        Arc::new(claude::Anthropic::new()),
        Box::new(|f| drop(tauri::async_runtime::spawn(f))),
        Box::new(crate::secrets::anthropic_key_present),
        Box::new(move || {
            handle.emit("intel-changed", ()).ok();
        }),
    );
    app.manage(agent.clone());
    tauri::async_runtime::spawn(async move {
        // Give the window time to load, then check every ten minutes.
        tokio::time::sleep(Duration::from_secs(90)).await;
        loop {
            agent.schedule_tick(chrono::Utc::now());
            tokio::time::sleep(Duration::from_secs(600)).await;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn intel_status(agent: tauri::State<'_, AgentState>) -> AgentStatus {
    agent.status()
}

#[tauri::command]
pub fn intel_report(repo: String, agent: tauri::State<'_, AgentState>) -> Option<Report> {
    agent.report(&repo)
}

#[tauri::command]
pub fn intel_reports(agent: tauri::State<'_, AgentState>) -> Vec<Report> {
    agent.reports()
}

#[tauri::command]
pub fn intel_analyze(
    repo: String,
    force: bool,
    depth: Option<Depth>,
    context: Option<RepoContext>,
    agent: tauri::State<'_, AgentState>,
) -> Result<EnqueueResult, String> {
    agent.enqueue(
        &repo,
        Trigger::Manual,
        depth,
        force,
        context.unwrap_or_default(),
    )
}

#[tauri::command]
pub fn intel_cancel(run_id: String, agent: tauri::State<'_, AgentState>) -> bool {
    agent.cancel(&run_id)
}

#[tauri::command]
pub fn intel_config_set(
    config: AgentConfig,
    agent: tauri::State<'_, AgentState>,
) -> Result<AgentConfig, String> {
    agent.set_config(config)
}

#[tauri::command]
pub fn intel_estimate(
    depth: Option<Depth>,
    agent: tauri::State<'_, AgentState>,
) -> Result<CostEstimate, String> {
    agent.estimate(depth)
}
