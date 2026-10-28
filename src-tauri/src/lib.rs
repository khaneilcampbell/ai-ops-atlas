mod actions;
mod github;
mod intel;
mod secrets;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(github::Client::new())
        .setup(|app| {
            intel::setup(app)?;
            actions::setup(app)
        })
        .invoke_handler(tauri::generate_handler![
            github::github_get,
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
            actions::actions_status,
            actions::actions_audit,
            actions::actions_settings_set,
            actions::actions_token_set,
            actions::actions_token_clear,
            actions::action_rerun_failed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Ops Atlas");
}
