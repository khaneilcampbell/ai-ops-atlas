mod github;
mod secrets;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(github::Client::new())
        .invoke_handler(tauri::generate_handler![
            github::github_get,
            secrets::github_token_status,
            secrets::github_token_set,
            secrets::github_token_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Ops Atlas");
}
