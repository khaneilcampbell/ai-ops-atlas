mod actions;
mod github;
mod handoff;
mod intel;
mod live;
mod power;
mod secrets;
mod steward;
mod usage_sync;

pub fn run() {
    // Right after an update: take over the previous copy's unlocked keys before anything asks.
    handoff::receive();
    handoff::remember_identity();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(github::Client::new())
        .setup(|app| {
            intel::setup(app)?;
            usage_sync::setup(app)?;
            steward::setup(app)?;
            actions::setup(app)?;
            handoff::window_ready(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            github::github_get,
            steward::steward_state,
            steward::steward_run,
            steward::steward_pause,
            steward::steward_configure,
            steward::steward_dismiss,
            steward::steward_import,
            secrets::vault_status,
            secrets::vault_unlock,
            handoff::update_relaunch,
            handoff::take_resume,
            secrets::github_token_status,
            secrets::github_token_set,
            secrets::github_token_clear,
            secrets::anthropic_key_status,
            secrets::anthropic_key_set,
            secrets::anthropic_key_clear,
            intel::intel_status,
            intel::intel_runs,
            intel::intel_report,
            intel::intel_reports,
            intel::intel_analyze,
            intel::intel_cancel,
            intel::intel_config_set,
            intel::intel_estimate,
            intel::review_report,
            intel::review_run,
            intel::review_estimate,
            actions::actions_status,
            actions::actions_audit,
            actions::actions_settings_set,
            actions::actions_token_set,
            actions::actions_token_clear,
            actions::action_rerun_failed,
            actions::actions_merge_settings_set,
            actions::merge_token_set,
            actions::merge_token_clear,
            actions::action_merge_check,
            actions::action_merge_pr,
            usage_sync::usage_sync_status,
            usage_sync::usage_sync_set_url,
            usage_sync::usage_sync_new_key,
            usage_sync::usage_sync_clear,
            usage_sync::usage_sync_push,
            live::live_feed,
            live::live_publish,
            power::power_on_battery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Ops Atlas");
}
