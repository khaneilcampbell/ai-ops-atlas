//! Saves files the app makes (agent report PDFs and device backups) where Khaneil picks, through the native save
//! dialog. The page hands over the bytes; only a PDF, or an Atlas backup JSON, of bounded size is
//! written, and only to the path the dialog returned.

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const MAX_BYTES: usize = 5_000_000;

/// A safe default file name: letters, digits and `-_. `, ending in `.pdf`.
pub fn clean_name(name: &str) -> String {
    let kept: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "-_. ".contains(*c))
        .take(80)
        .collect();
    let kept = kept.trim().trim_start_matches('.').to_string();
    if kept.is_empty() {
        "report.pdf".into()
    } else if kept.to_ascii_lowercase().ends_with(".pdf") {
        kept
    } else {
        format!("{kept}.pdf")
    }
}

/// Asks where to save, then writes the PDF. `false` when Khaneil cancelled the dialog.
#[tauri::command]
pub async fn save_pdf(app: AppHandle, name: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() > MAX_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err("That isn't a PDF the app made.".into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save report as PDF")
        .set_file_name(clean_name(&name))
        .add_filter("PDF", &["pdf"]);
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    dialog.save_file(move |path| {
        let _ = tx.send(path);
    });
    let Some(path) = rx.await.ok().flatten() else {
        return Ok(false);
    };
    let path = path
        .into_path()
        .map_err(|e| format!("Couldn't use that location: {e}"))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("Couldn't save the PDF: {e}"))?;
    Ok(true)
}

const MAX_BACKUP_BYTES: usize = 4_000_000;

/// A safe default backup file name: letters, digits and `-_. `, ending in `.json`.
pub fn clean_backup_name(name: &str) -> String {
    let kept: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "-_. ".contains(*c))
        .take(80)
        .collect();
    let kept = kept.trim().trim_start_matches('.').to_string();
    if kept.is_empty() {
        "atlas-backup.json".into()
    } else if kept.to_ascii_lowercase().ends_with(".json") {
        kept
    } else {
        format!("{kept}.json")
    }
}

/// True only for the JSON document src/lib/backup.ts makes.
pub fn is_backup(text: &str) -> bool {
    text.len() <= MAX_BACKUP_BYTES
        && serde_json::from_str::<serde_json::Value>(text)
            .ok()
            .and_then(|v| {
                v.get("format")
                    .and_then(|f| f.as_str())
                    .map(|f| f == "atlas-device-backup")
            })
            .unwrap_or(false)
}

/// Asks where to save, then writes the device backup. `false` when Khaneil cancelled the dialog.
#[tauri::command]
pub async fn save_backup(app: AppHandle, name: String, text: String) -> Result<bool, String> {
    if !is_backup(&text) {
        return Err("That isn't a backup the app made.".into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save Atlas backup")
        .set_file_name(clean_backup_name(&name))
        .add_filter("JSON", &["json"]);
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    dialog.save_file(move |path| {
        let _ = tx.send(path);
    });
    let Some(path) = rx.await.ok().flatten() else {
        return Ok(false);
    };
    let path = path
        .into_path()
        .map_err(|e| format!("Couldn't use that location: {e}"))?;
    std::fs::write(&path, text.as_bytes()).map_err(|e| format!("Couldn't save the backup: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{clean_backup_name, clean_name, is_backup};

    #[test]
    fn backups_are_checked() {
        assert!(is_backup(
            r#"{"format":"atlas-device-backup","version":1,"entries":{}}"#
        ));
        assert!(!is_backup(r#"{"format":"other"}"#));
        assert!(!is_backup("not json"));
        assert_eq!(clean_backup_name("../x"), "x.json");
        assert_eq!(clean_backup_name(""), "atlas-backup.json");
        assert_eq!(clean_backup_name("a.JSON"), "a.JSON");
    }

    #[test]
    fn names_are_safe_pdfs() {
        assert_eq!(
            clean_name("opportunity-scout-2026-10-30"),
            "opportunity-scout-2026-10-30.pdf"
        );
        assert_eq!(clean_name("../../etc/passwd"), "etcpasswd.pdf");
        assert_eq!(clean_name("Report.PDF"), "Report.PDF");
        assert_eq!(clean_name("///"), "report.pdf");
    }
}
