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
pub struct RateLimit {
    limit: u32,
    pub(crate) remaining: u32,
    reset: u64,
}

#[derive(Serialize)]
pub struct GithubResponse {
    pub(crate) status: u16,
    pub(crate) body: serde_json::Value,
    etag: Option<String>,
    /// Whether a token was attached; GitHub only waives 304s for authenticated requests.
    authed: bool,
    pub(crate) rate: Option<RateLimit>,
}

fn rate_limit(headers: &reqwest::header::HeaderMap) -> Option<RateLimit> {
    let num = |name: &str| headers.get(name)?.to_str().ok()?.parse::<u64>().ok();
    Some(RateLimit {
        limit: num("x-ratelimit-limit")? as u32,
        remaining: num("x-ratelimit-remaining")? as u32,
        reset: num("x-ratelimit-reset")?,
    })
}

/// True for `/users/{name}/repos`, the public repository list of one account.
fn is_user_repos(path: &str) -> bool {
    let route = path.split('?').next().unwrap_or("");
    let parts: Vec<&str> = route.split('/').collect();
    matches!(parts.as_slice(), ["", "users", name, "repos"] if !name.is_empty())
}

/// Limits requests to repository read endpoints with a conservative character set:
/// a single repository's data, or a list of repositories to discover.
pub fn allowed_path(path: &str) -> bool {
    let route_ok = path.starts_with("/repos/")
        || path == "/user/repos"
        || path.starts_with("/user/repos?")
        || is_user_repos(path);
    route_ok
        && path.len() < 512
        && !path.contains("..")
        && !path.contains("//")
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/-_.?=&%".contains(c))
}

/// One read-only GET. Every caller (the web view's proxy and the intelligence agent) goes
/// through here, so the path allowlist and the GET-only rule apply to both.
pub(crate) async fn get(
    client: &Client,
    path: &str,
    etag: Option<String>,
) -> Result<GithubResponse, String> {
    if !allowed_path(path) {
        return Err("Blocked: only read-only repository requests are allowed".into());
    }
    let mut req = client
        .http
        .get(format!("https://api.github.com{path}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(tag) = etag.filter(|t| t.len() < 200 && t.is_ascii()) {
        req = req.header("If-None-Match", tag);
    }
    let token = crate::secrets::read_token();
    let authed = token.is_some();
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    // Map errors to plain text without the request, which would carry the auth header.
    let res = req
        .send()
        .await
        .map_err(|e| format!("Network error reaching GitHub ({})", e.without_url()))?;
    let status = res.status().as_u16();
    let etag = res
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let rate = rate_limit(res.headers());
    let body = res.json().await.unwrap_or(serde_json::Value::Null);
    Ok(GithubResponse {
        status,
        body,
        etag,
        authed,
        rate,
    })
}

#[tauri::command]
pub async fn github_get(
    path: String,
    etag: Option<String>,
    client: tauri::State<'_, Client>,
) -> Result<GithubResponse, String> {
    get(&client, &path, etag).await
}

#[async_trait::async_trait]
impl crate::intel::collect::GithubApi for Client {
    async fn get(&self, path: &str) -> Result<crate::intel::collect::GhResponse, String> {
        let r = get(self, path, None).await?;
        Ok(crate::intel::collect::GhResponse {
            status: r.status,
            body: r.body,
            rate_remaining: r.rate.as_ref().map(|x| x.remaining),
            rate_reset: r.rate.as_ref().map(|x| x.reset),
        })
    }

    async fn has_token(&self) -> bool {
        crate::secrets::read_token().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::allowed_path;

    #[test]
    fn allows_repo_reads() {
        assert!(allowed_path("/repos/khaneilcampbell/khaneilcampbell.com"));
        assert!(allowed_path("/repos/a/b/commits?per_page=10&sha=main"));
        assert!(allowed_path(
            "/repos/a/b/actions/workflows/security-check.yml/runs?per_page=5"
        ));
        assert!(allowed_path("/user/repos?affiliation=owner&per_page=100"));
        assert!(allowed_path(
            "/users/khaneilcampbell/repos?per_page=100&type=owner"
        ));
    }

    #[test]
    fn blocks_everything_else() {
        assert!(!allowed_path("/user"));
        assert!(!allowed_path("/user/emails"));
        assert!(!allowed_path("/users/a/followers"));
        assert!(!allowed_path("/users//repos"));
        assert!(!allowed_path("/user/repos/extra"));
        assert!(!allowed_path("/repos/a/../../user"));
        assert!(!allowed_path("/repos/a/b#frag"));
        assert!(!allowed_path("/repos/a/b\nHost: evil"));
        assert!(!allowed_path("https://evil.example/repos/a"));
    }
}
