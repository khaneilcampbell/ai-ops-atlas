//! Live updates. The hosted site collects GitHub webhook events and the app's own agent runs
//! (server/live.ts); the app reads that feed every few seconds while its window is visible, and
//! tells the site when one of its own agents' runs changes, so the website sees it too. Both use
//! the website sync URL and key, so live updates are off until website sync is set up. Only the
//! feed's compact summaries come back; nothing here can change a repository.

use crate::secrets;
use crate::usage_sync::UsageSync;

pub const FEED_PATH: &str = "/api/hooks/feed";
pub const PUBLISH_PATH: &str = "/api/hooks/atlas";
const MAX_EVENTS: usize = 50;

async fn refused(r: reqwest::Response, path: &str) -> String {
    let code = r.status().as_u16();
    let msg = r
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_owned));
    match (code, msg) {
        (_, Some(m)) => format!("The site refused live updates ({code}): {m}"),
        (403 | 302, None) => {
            format!("The site's login blocked live updates. Add the Access bypass for {path}.")
        }
        (404, None) => {
            "The site doesn't have live updates yet. Update the site, then try again.".into()
        }
        _ => format!("The site refused live updates ({code})."),
    }
}

/// New events after `after`, or `None` when website sync isn't set up.
#[tauri::command]
pub async fn live_feed(
    after: Option<i64>,
    sync: tauri::State<'_, UsageSync>,
) -> Result<Option<serde_json::Value>, String> {
    // The URL is an https origin (usage_sync::normalize_url); the key only goes in the header.
    let (Some(url), Some(key)) = (sync.url(), secrets::read_usage_sync_key()) else {
        return Ok(None);
    };
    let mut req = sync
        .http()
        .get(format!("{url}{FEED_PATH}"))
        .bearer_auth(key);
    if let Some(a) = after {
        req = req.query(&[("after", a)]);
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .map(Some)
            .map_err(|e| format!("The site's live feed wasn't readable: {e}")),
        Ok(r) => Err(refused(r, "/api/hooks/*").await),
        Err(e) => Err(format!("Couldn't reach the site: {e}")),
    }
}

/// Tells the site about runs of the app's own agents. Does nothing until website sync is set up.
#[tauri::command]
pub async fn live_publish(
    events: Vec<serde_json::Value>,
    sync: tauri::State<'_, UsageSync>,
) -> Result<(), String> {
    // The URL is an https origin (usage_sync::normalize_url); the key only goes in the header.
    let (Some(url), Some(key)) = (sync.url(), secrets::read_usage_sync_key()) else {
        return Ok(());
    };
    if events.is_empty() {
        return Ok(());
    }
    if events.len() > MAX_EVENTS {
        return Err(format!("At most {MAX_EVENTS} events at a time."));
    }
    match sync
        .http()
        .post(format!("{url}{PUBLISH_PATH}"))
        .bearer_auth(key)
        .json(&serde_json::json!({ "events": events }))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => Ok(()),
        Ok(r) => Err(refused(r, "/api/hooks/*").await),
        Err(e) => Err(format!("Couldn't reach the site: {e}")),
    }
}
