//! Sends the usage records Atlas logged to the hosted web build, so the website and iPhone can
//! show them. Off until a site URL and a sync key are both set. Only usage records go out
//! (time, provider, model, agent, repository, token counts, estimated cost); no credential
//! does. The key is a random shared secret kept in the Keychain and in the site's
//! `USAGE_SYNC_TOKEN` secret; it can replace the usage snapshot and do nothing else.
//! Pushes happen when the web view asks (after a run finishes, or on Refresh), never on a timer.

use crate::secrets;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

pub const PUSH_PATH: &str = "/api/usage/push";
const MAX_RECORDS: usize = 5_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Saved {
    url: Option<String>,
    last_push_at: Option<String>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    url: Option<String>,
    key_present: bool,
    last_push_at: Option<String>,
    last_error: Option<String>,
}

pub struct UsageSync {
    file: PathBuf,
    saved: Mutex<Saved>,
    http: reqwest::Client,
}

impl UsageSync {
    fn new(dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        std::fs::create_dir_all(&dir)?;
        let file = dir.join("usage-sync.json");
        let saved = std::fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let http = reqwest::Client::builder()
            .user_agent(concat!("ai-ops-atlas/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            file,
            saved: Mutex::new(saved),
            http,
        })
    }

    fn status(&self) -> SyncStatus {
        let s = self.saved.lock().unwrap();
        SyncStatus {
            url: s.url.clone(),
            key_present: secrets::read_usage_sync_key().is_some(),
            last_push_at: s.last_push_at.clone(),
            last_error: s.last_error.clone(),
        }
    }

    fn update(&self, f: impl FnOnce(&mut Saved)) {
        let mut s = self.saved.lock().unwrap();
        f(&mut s);
        if let Ok(json) = serde_json::to_string_pretty(&*s) {
            std::fs::write(&self.file, json).ok();
        }
    }
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(UsageSync::new(app.path().app_data_dir()?.join("usage"))?);
    Ok(())
}

/// The site's origin, e.g. `https://ai-ops-atlas.pages.dev`. HTTPS only, no path or credentials.
pub fn normalize_url(input: &str) -> Result<String, String> {
    let bad = || "Enter the site's address, like https://ai-ops-atlas.pages.dev".to_string();
    let url = reqwest::Url::parse(input.trim()).map_err(|_| bad())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(bad());
    }
    Ok(url.origin().ascii_serialization())
}

/// 32 random bytes, URL-safe base64 (43 characters).
pub fn new_key() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[tauri::command]
pub fn usage_sync_status(sync: tauri::State<'_, UsageSync>) -> SyncStatus {
    sync.status()
}

#[tauri::command]
pub fn usage_sync_set_url(
    url: String,
    sync: tauri::State<'_, UsageSync>,
) -> Result<SyncStatus, String> {
    let url = normalize_url(&url)?;
    sync.update(|s| {
        s.url = Some(url);
        s.last_error = None;
    });
    Ok(sync.status())
}

/// Makes a new key, saves it to the Keychain and returns it this once, so it can be pasted
/// into the site's `USAGE_SYNC_TOKEN` secret. It is never returned again.
#[tauri::command]
pub fn usage_sync_new_key(sync: tauri::State<'_, UsageSync>) -> Result<String, String> {
    let key = new_key();
    secrets::set_usage_sync_key(&key)?;
    sync.update(|s| s.last_error = None);
    Ok(key)
}

/// Turns sync off: forgets the URL and removes the key. The site keeps its last snapshot.
#[tauri::command]
pub fn usage_sync_clear(sync: tauri::State<'_, UsageSync>) -> Result<SyncStatus, String> {
    secrets::clear_usage_sync_key()?;
    sync.update(|s| *s = Saved::default());
    Ok(sync.status())
}

/// Replaces the site's snapshot with these records. Does nothing until sync is set up.
#[tauri::command]
pub async fn usage_sync_push(
    records: Vec<serde_json::Value>,
    sync: tauri::State<'_, UsageSync>,
) -> Result<SyncStatus, String> {
    let url = sync.saved.lock().unwrap().url.clone();
    let (Some(url), Some(key)) = (url, secrets::read_usage_sync_key()) else {
        return Ok(sync.status());
    };
    if records.len() > MAX_RECORDS {
        return Err(format!("At most {MAX_RECORDS} records can be synced."));
    }
    let res = sync
        .http
        .put(format!("{url}{PUSH_PATH}"))
        .bearer_auth(key)
        .json(&serde_json::json!({ "records": records }))
        .send()
        .await;
    let outcome = match res {
        Ok(r) if r.status().is_success() => Ok(()),
        Ok(r) => {
            let code = r.status().as_u16();
            let msg = r
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_owned));
            Err(match (code, msg) {
                (_, Some(m)) => format!("The site refused the sync ({code}): {m}"),
                (403 | 302, None) => {
                    "The site's login blocked the sync. Add the Access bypass for /api/usage/push."
                        .into()
                }
                _ => format!("The site refused the sync ({code})."),
            })
        }
        Err(e) => Err(format!("Couldn't reach the site: {e}")),
    };
    match &outcome {
        Ok(()) => sync.update(|s| {
            s.last_push_at = Some(chrono::Utc::now().to_rfc3339());
            s.last_error = None;
        }),
        Err(e) => sync.update(|s| s.last_error = Some(e.clone())),
    }
    outcome.map(|_| sync.status())
}

#[cfg(test)]
mod tests {
    use super::{new_key, normalize_url};

    #[test]
    fn site_url_is_an_https_origin() {
        assert_eq!(
            normalize_url(" https://ai-ops-atlas.pages.dev/ ").unwrap(),
            "https://ai-ops-atlas.pages.dev"
        );
        assert!(normalize_url("http://ai-ops-atlas.pages.dev").is_err());
        assert!(normalize_url("https://ai-ops-atlas.pages.dev/api").is_err());
        assert!(normalize_url("https://user:pw@ai-ops-atlas.pages.dev").is_err());
        assert!(normalize_url("ai-ops-atlas.pages.dev").is_err());
    }

    #[test]
    fn keys_are_long_and_unique() {
        let a = new_key();
        assert_eq!(a.len(), 43);
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(a, new_key());
    }
}
