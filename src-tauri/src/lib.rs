mod actions;
mod github;
mod intel;
mod secrets;
mod usage_sync;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(github::Client::new())
        .setup(|app| {
            intel::setup(app)?;
            usage_sync::setup(app)?;
            actions::setup(app)
        })
        .invoke_handler(tauri::generate_handler![
            github::github_get,
            secrets::vault_status,
            secrets::vault_unlock,
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
            actions::actions_op_settings_set,
            actions::action_op,
            actions::action_workflow_info,
            actions::catalog_overrides,
            actions::catalog_override_set,
            usage_sync::usage_sync_status,
            usage_sync::usage_sync_set_url,
            usage_sync::usage_sync_new_key,
            usage_sync::usage_sync_clear,
            usage_sync::usage_sync_push,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Ops Atlas");
}
