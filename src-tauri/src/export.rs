//! Saves files the app makes (today: agent report PDFs) where KC picks, through the native save
//! dialog. The page hands over the bytes; only a PDF of bounded size is written, and only to the
//! path the dialog returned.

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

/// Asks where to save, then writes the PDF. `false` when KC cancelled the dialog.
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

#[cfg(test)]
mod tests {
    use super::clean_name;

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
