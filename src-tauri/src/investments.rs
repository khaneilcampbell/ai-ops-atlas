//! Investment Operations Center: the files Atlas reads in its app data folder. Claude Code on
//! this Mac writes `investments/snapshot.json` on Khaneil's "sync my investments" (read tools
//! only), and the Trade Desk (a Claude Code session Khaneil runs) writes the trade journal
//! `investments/journal.json`. Atlas only reads them and, on Disconnect, deletes both. The contents
//! are checked against the allowlists in `src/finance/investments.ts` and `tradingDesk.ts` before
//! anything is shown. Nothing here talks to a brokerage or sends a file anywhere.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;

/// A minimized snapshot is a few kilobytes; anything far bigger isn't one and is left unread.
const MAX_BYTES: u64 = 256 * 1024;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct SnapshotFile {
    /// Where the sync writes, shown in the panel so the setup is never a guess.
    path: String,
    /// The file's text, or `None` when there is no snapshot yet.
    contents: Option<String>,
    /// Last write, in milliseconds since 1970.
    modified_ms: Option<u64>,
}

fn investments_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("investments").join(name))
}

fn snapshot_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    investments_file(app, "snapshot.json")
}

/// The trade journal the Trade Desk (a Claude Code session Khaneil runs) writes next to the
/// snapshot. Atlas only reads it; the contents are checked in `src/finance/tradingDesk.ts`.
fn journal_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    investments_file(app, "journal.json")
}

pub fn read_snapshot(path: &Path) -> Result<SnapshotFile, String> {
    let shown = path.display().to_string();
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == ErrorKind::NotFound => {
            return Ok(SnapshotFile {
                path: shown,
                contents: None,
                modified_ms: None,
            })
        }
        Err(e) => return Err(format!("Couldn't read the snapshot: {e}")),
    };
    if !meta.is_file() {
        return Err("The snapshot isn't a plain file, so Atlas left it unread".into());
    }
    if meta.len() > MAX_BYTES {
        return Err("The snapshot is too large to be a summary, so Atlas left it unread".into());
    }
    let contents =
        std::fs::read_to_string(path).map_err(|e| format!("Couldn't read the snapshot: {e}"))?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Ok(SnapshotFile {
        path: shown,
        contents: Some(contents),
        modified_ms,
    })
}

pub fn delete_snapshot(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Couldn't delete the snapshot: {e}")),
    }
}

#[tauri::command]
pub fn investments_snapshot(app: tauri::AppHandle) -> Result<SnapshotFile, String> {
    read_snapshot(&snapshot_path(&app)?)
}

/// Reads the trade journal, with the same limits as the snapshot.
#[tauri::command]
pub fn investments_journal(app: tauri::AppHandle) -> Result<SnapshotFile, String> {
    read_snapshot(&journal_path(&app)?)
}

/// Disconnect: deletes the snapshot and the trade journal so no account data is left in Atlas's folder.
#[tauri::command]
pub fn investments_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    delete_snapshot(&snapshot_path(&app)?)?;
    delete_snapshot(&journal_path(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("atlas-invest-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn missing_file_is_no_snapshot_not_an_error() {
        let p = temp_dir("missing").join("snapshot.json");
        let r = read_snapshot(&p).unwrap();
        assert_eq!(r.contents, None);
        assert_eq!(r.modified_ms, None);
    }

    #[test]
    fn reads_then_disconnect_deletes() {
        let p = temp_dir("roundtrip").join("snapshot.json");
        std::fs::write(&p, r#"{"source":"synthetic"}"#).unwrap();
        let r = read_snapshot(&p).unwrap();
        assert_eq!(r.contents.as_deref(), Some(r#"{"source":"synthetic"}"#));
        assert!(r.modified_ms.is_some());
        delete_snapshot(&p).unwrap();
        assert!(!p.exists());
        delete_snapshot(&p).unwrap(); // already gone is fine
    }

    #[test]
    fn refuses_oversized_files_and_folders() {
        let d = temp_dir("big");
        let p = d.join("snapshot.json");
        std::fs::write(&p, vec![b' '; (MAX_BYTES + 1) as usize]).unwrap();
        assert!(read_snapshot(&p).is_err());
        assert!(read_snapshot(&d).is_err());
    }
}
