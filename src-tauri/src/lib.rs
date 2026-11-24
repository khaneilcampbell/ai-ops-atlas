mod actions;
mod export;
mod github;
mod handoff;
mod intel;
mod library;
mod live;
mod local_usage;
mod power;
mod secrets;
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
            actions::setup(app)?;
            handoff::window_ready(app);
            // A developer build runs as a bare binary next to the installed app, with its own
            // Dock icon. Name its window so it can't be mistaken for the installed Atlas.
            #[cfg(debug_assertions)]
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                let _ = window.set_title("Atlas (developer preview)");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            github::github_get,
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
            actions::agents_token_set,
            actions::agents_token_clear,
            actions::agent_action,
            actions::agent_config_change,
            usage_sync::usage_sync_status,
            usage_sync::usage_sync_set_url,
            usage_sync::usage_sync_new_key,
            usage_sync::usage_sync_clear,
            usage_sync::usage_sync_push,
            live::live_feed,
            live::live_publish,
            live::live_reports,
            live::live_inquiries,
            live::live_agent_usage,
            local_usage::codex_usage,
            local_usage::claude_code_usage,
            live::live_properties,
            live::live_n8n,
            live::live_n8n_steps,
            live::live_n8n_step_send,
            live::live_n8n_start_status,
            live::live_n8n_start,
            live::live_stripe_sales,
            live::registry_refresh,
            live::live_security,
            live::live_health,
            live::live_data_overview,
            library::library_list,
            library::library_output,
            library::library_file,
            library::library_save,
            library::library_open,
            live::live_inquiry_reply,
            export::save_pdf,
            export::save_backup,
            power::power_on_battery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Atlas");
}
