//! The Output Library for the Mac app. The app has no Cloudflare Access session, so it reads the
//! site's read-only Library route (server/outputs.ts routeOutputsForApp) with the website sync key
//! it already keeps in the Keychain. Nothing here can change the Library: retry and reconcile stay
//! on the signed-in web page. Files are saved only where Khaneil picks in the save dialog, or opened
//! in their default Mac app from the app's own cache folder, and only for formats that are safe to open.

use base64::Engine;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::live::refused;
use crate::secrets;
use crate::usage_sync::UsageSync;

pub const LIBRARY_PATH: &str = "/api/hooks/library";
/// The site stores files up to 15 MB (src/library/model.ts MAX_FILE_BYTES); a little room above that.
const MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
/// List filters the page may send (src/library/model.ts listParams, plus projectAgents).
const LIST_KEYS: &[&str] = &[
    "q",
    "format",
    "agent",
    "project",
    "projectAgents",
    "approval",
    "storage",
    "page",
];
/// Formats opened in their default Mac app. HTML, SVG and anything else stay save-only, because
/// they could run scripts when opened from disk.
const OPENABLE: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "md", "csv", "tsv", "json", "docx", "xlsx",
    "pptx",
];

/// An output id as the site makes them (server/outputs.ts outputIdOf).
pub fn valid_output_id(id: &str) -> bool {
    id.len() == 24
        && id.starts_with("out_")
        && id[4..]
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The site path for one output, or one version's file; `None` for anything that isn't a real id.
pub fn output_path(id: &str, version: Option<u32>) -> Option<String> {
    if !valid_output_id(id) {
        return None;
    }
    match version {
        None => Some(format!("{LIBRARY_PATH}/{id}")),
        Some(v) if v >= 1 => Some(format!("{LIBRARY_PATH}/{id}/versions/{v}/file")),
        Some(_) => None,
    }
}

/// Only the known list filters, each bounded, so the page can't send anything else to the site.
pub fn list_query(query: Vec<(String, String)>) -> Vec<(String, String)> {
    query
        .into_iter()
        .filter(|(k, v)| LIST_KEYS.contains(&k.as_str()) && v.len() <= 4000)
        .take(LIST_KEYS.len())
        .collect()
}

/// A safe file name: letters, digits and `-_. `, at most 100 characters, never hidden.
pub fn clean_file_name(name: &str) -> String {
    let kept: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "-_. ".contains(*c))
        .take(100)
        .collect();
    let kept = kept.trim().trim_start_matches('.').trim().to_string();
    if kept.is_empty() {
        "output".into()
    } else {
        kept
    }
}

fn extension(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// True when a file with this (cleaned) name may be opened in its default app.
pub fn openable(name: &str) -> bool {
    OPENABLE.contains(&extension(name).as_str())
}

/// The name must match what the site actually served, so a title like "notes.pdf" on an HTML file
/// can't make Atlas open HTML: images and PDFs by their served type, text as text, and Office files
/// (served as attachments) only when the bytes are a zip, as .docx/.xlsx/.pptx always are.
pub fn matches_served(name: &str, served: &str, bytes: &[u8]) -> bool {
    let served = served
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match extension(name).as_str() {
        "pdf" => served == "application/pdf",
        "png" => served == "image/png",
        "jpg" | "jpeg" => served == "image/jpeg",
        "gif" => served == "image/gif",
        "webp" => served == "image/webp",
        "txt" | "md" | "csv" | "tsv" | "json" => served == "text/plain",
        "docx" | "xlsx" | "pptx" => {
            served == "application/octet-stream" && bytes.starts_with(b"PK\x03\x04")
        }
        _ => false,
    }
}

fn sync_of(sync: &UsageSync) -> Option<(String, String)> {
    Some((sync.url()?, secrets::read_usage_sync_key()?))
}

async fn get_json(
    sync: &UsageSync,
    path: &str,
    query: &[(String, String)],
) -> Result<Option<serde_json::Value>, String> {
    let Some((url, key)) = sync_of(sync) else {
        return Ok(None);
    };
    match sync
        .http()
        .get(format!("{url}{path}"))
        .bearer_auth(key)
        .query(query)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .map(Some)
            .map_err(|e| format!("The site's Library answer wasn't readable: {e}")),
        Ok(r) => Err(refused(r, "/api/hooks/*").await),
        Err(e) => Err(format!("Couldn't reach the site: {e}")),
    }
}

struct Fetched {
    mime: String,
    truncated_from: Option<u64>,
    bytes: Vec<u8>,
}

async fn get_file(
    sync: &UsageSync,
    id: &str,
    version: u32,
    preview: bool,
) -> Result<Option<Fetched>, String> {
    let path = output_path(id, Some(version)).ok_or("Unknown output.")?;
    let Some((url, key)) = sync_of(sync) else {
        return Ok(None);
    };
    let mut req = sync.http().get(format!("{url}{path}")).bearer_auth(key);
    if preview {
        req = req.query(&[("preview", "1")]);
    }
    let r = req
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the site: {e}"))?;
    if !r.status().is_success() {
        return Err(refused(r, "/api/hooks/*").await);
    }
    if r.content_length()
        .is_some_and(|n| n as usize > MAX_FILE_BYTES)
    {
        return Err("That file is larger than the Library keeps.".into());
    }
    let header = |name: &str| {
        r.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let mime = header("content-type").unwrap_or_else(|| "application/octet-stream".into());
    let truncated_from = header("x-atlas-truncated").and_then(|v| v.parse().ok());
    let bytes = r
        .bytes()
        .await
        .map_err(|e| format!("The file didn't finish downloading: {e}"))?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err("That file is larger than the Library keeps.".into());
    }
    Ok(Some(Fetched {
        mime,
        truncated_from,
        bytes: bytes.to_vec(),
    }))
}

/// One page of outputs (the same answer as the web page's /api/outputs), or `None` when website sync is off.
#[tauri::command]
pub async fn library_list(
    query: Vec<(String, String)>,
    sync: tauri::State<'_, UsageSync>,
) -> Result<Option<serde_json::Value>, String> {
    get_json(&sync, LIBRARY_PATH, &list_query(query)).await
}

/// One output with every version, or `None` when website sync is off.
#[tauri::command]
pub async fn library_output(
    id: String,
    sync: tauri::State<'_, UsageSync>,
) -> Result<Option<serde_json::Value>, String> {
    let path = output_path(&id, None).ok_or("Unknown output.")?;
    get_json(&sync, &path, &[]).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    /// The type the site served the file as (text is always text/plain; risky types are octet-stream).
    mime: String,
    base64: String,
    /// The whole file's size when the site sent only the start of a text file.
    truncated_from: Option<u64>,
}

/// A version's file for the in-app preview (text previews are the first 256 KB), or `None` when website sync is off.
#[tauri::command]
pub async fn library_file(
    id: String,
    version: u32,
    preview: bool,
    sync: tauri::State<'_, UsageSync>,
) -> Result<Option<LibraryFile>, String> {
    Ok(get_file(&sync, &id, version, preview)
        .await?
        .map(|f| LibraryFile {
            mime: f.mime,
            base64: base64::engine::general_purpose::STANDARD.encode(&f.bytes),
            truncated_from: f.truncated_from,
        }))
}

/// Asks where to save, then writes the whole file there. `false` when Khaneil cancelled.
#[tauri::command]
pub async fn library_save(
    app: AppHandle,
    id: String,
    version: u32,
    name: String,
    sync: tauri::State<'_, UsageSync>,
) -> Result<bool, String> {
    let file = get_file(&sync, &id, version, false)
        .await?
        .ok_or(WEBSITE_SYNC_OFF)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save from the Library")
        .set_file_name(clean_file_name(&name));
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
    std::fs::write(&path, &file.bytes).map_err(|e| format!("Couldn't save the file: {e}"))?;
    Ok(true)
}

/// Downloads the file into the app's cache folder and opens it in its default Mac app (Preview for
/// a PDF). Only for formats in OPENABLE; anything else is saved instead.
#[tauri::command]
pub async fn library_open(
    app: AppHandle,
    id: String,
    version: u32,
    name: String,
    sync: tauri::State<'_, UsageSync>,
) -> Result<(), String> {
    let name = clean_file_name(&name);
    if !openable(&name) {
        return Err("This format can't be opened from Atlas. Save it instead.".into());
    }
    let file = get_file(&sync, &id, version, false)
        .await?
        .ok_or(WEBSITE_SYNC_OFF)?;
    if !matches_served(&name, &file.mime, &file.bytes) {
        return Err(
            "This file isn't what its name says, so Atlas won't open it. Save it instead.".into(),
        );
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Couldn't find the app's cache folder: {e}"))?
        .join("library")
        .join(format!("{id}-v{version}"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make the cache folder: {e}"))?;
    let path = dir.join(&name);
    std::fs::write(&path, &file.bytes).map_err(|e| format!("Couldn't write the file: {e}"))?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Couldn't open the file: {e}"))
}

const WEBSITE_SYNC_OFF: &str =
    "The Mac app reads the Library through website sync. Turn it on in Settings → Website sync.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_paths() {
        let id = "out_0123456789abcdef0123";
        assert!(valid_output_id(id));
        assert_eq!(
            output_path(id, None).unwrap(),
            "/api/hooks/library/out_0123456789abcdef0123"
        );
        assert_eq!(
            output_path(id, Some(2)).unwrap(),
            "/api/hooks/library/out_0123456789abcdef0123/versions/2/file"
        );
        assert_eq!(output_path(id, Some(0)), None);
        for bad in [
            "out_0123456789ABCDEF0123",
            "out_../../reconcile/xxxxx",
            "out_0123",
            "reconcile",
            "",
        ] {
            assert!(!valid_output_id(bad), "{bad}");
            assert_eq!(output_path(bad, None), None);
        }
    }

    #[test]
    fn list_query_keeps_only_filters() {
        let q = list_query(vec![
            ("q".into(), "brief".into()),
            ("page".into(), "2".into()),
            ("method".into(), "POST".into()),
            ("format".into(), "x".repeat(5000)),
        ]);
        assert_eq!(
            q,
            vec![
                ("q".to_string(), "brief".to_string()),
                ("page".to_string(), "2".to_string())
            ]
        );
    }

    #[test]
    fn names_and_what_opens() {
        assert_eq!(
            clean_file_name("../../Product scores.csv"),
            "Product scores.csv"
        );
        assert_eq!(clean_file_name("/etc/passwd"), "etcpasswd");
        assert_eq!(clean_file_name("..."), "output");
        assert!(openable("Brief.PDF"));
        assert!(openable("Product scores.csv"));
        assert!(!openable("Page.html"));
        assert!(!openable("Logo.svg"));
        assert!(!openable("run.command"));
        assert!(!openable("noextension"));
    }

    #[test]
    fn opens_only_what_the_site_served() {
        assert!(matches_served("Brief.pdf", "application/pdf", b"%PDF-1.7"));
        assert!(matches_served(
            "Scores.csv",
            "text/plain; charset=utf-8",
            b"a,b"
        ));
        assert!(matches_served("Cover.png", "image/png", b"\x89PNG"));
        assert!(matches_served(
            "Plan.docx",
            "application/octet-stream",
            b"PK\x03\x04rest"
        ));
        // An HTML file titled like a PDF or a Word file is refused.
        assert!(!matches_served(
            "notes.pdf",
            "application/octet-stream",
            b"<script>"
        ));
        assert!(!matches_served(
            "Plan.docx",
            "application/octet-stream",
            b"<html>"
        ));
        assert!(!matches_served("Cover.png", "text/plain", b"x"));
    }
}
