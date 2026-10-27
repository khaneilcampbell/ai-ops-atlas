//! Read-only GitHub access. Only GET requests to api.github.com/repos/... are allowed,
//! and the Keychain token is attached here so it never crosses into JavaScript.

use serde::Serialize;
use std::time::Duration;

pub struct Client {
    http: reqwest::Client,
}

impl Client {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("ai-ops-atlas/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .expect("HTTP client");
        Self { http }
    }
}

#[derive(Serialize)]
pub struct GithubResponse {
    status: u16,
    body: serde_json::Value,
}

/// Limits requests to repository read endpoints with a conservative character set.
pub fn allowed_path(path: &str) -> bool {
    path.starts_with("/repos/")
        && path.len() < 512
        && !path.contains("..")
        && !path.contains("//")
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/-_.?=&%".contains(c))
}

#[tauri::command]
pub async fn github_get(
    path: String,
    client: tauri::State<'_, Client>,
) -> Result<GithubResponse, String> {
    if !allowed_path(&path) {
        return Err("Blocked: only read-only repository requests are allowed".into());
    }
    let mut req = client
        .http
        .get(format!("https://api.github.com{path}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = crate::secrets::read_token() {
        req = req.bearer_auth(token);
    }
    // Map errors to plain text without the request, which would carry the auth header.
    let res = req
        .send()
        .await
        .map_err(|e| format!("Network error reaching GitHub ({})", e.without_url()))?;
    let status = res.status().as_u16();
    let body = res.json().await.unwrap_or(serde_json::Value::Null);
    Ok(GithubResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::allowed_path;

    #[test]
    fn allows_repo_reads() {
        assert!(allowed_path("/repos/khaneilcampbell/khaneilcampbell.com"));
        assert!(allowed_path("/repos/a/b/commits?per_page=10&sha=main"));
        assert!(allowed_path("/repos/a/b/actions/workflows/security-check.yml/runs?per_page=5"));
    }

    #[test]
    fn blocks_everything_else() {
        assert!(!allowed_path("/user"));
        assert!(!allowed_path("/repos/a/../../user"));
        assert!(!allowed_path("/repos/a/b#frag"));
        assert!(!allowed_path("/repos/a/b\nHost: evil"));
        assert!(!allowed_path("https://evil.example/repos/a"));
    }
}
