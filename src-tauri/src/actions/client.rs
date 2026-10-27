//! The only GitHub client that can write. It has no path parameter: the one request it
//! sends is built here from a validated repository and a numeric run id, and it uses the
//! separate Actions token, never the read-only one.

use super::rerun::{SendError, WriteApi, WriteResponse};
use crate::intel::collect::valid_repo;
use std::time::Duration;

pub struct WriteClient {
    http: reqwest::Client,
}

fn header(res: &reqwest::Response, name: &str) -> Option<String> {
    res.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

/// The re-run endpoint for one run. `None` for anything that isn't a plain owner/name.
pub fn rerun_url(repo: &str, run_id: u64) -> Option<String> {
    valid_repo(repo).then(|| {
        format!("https://api.github.com/repos/{repo}/actions/runs/{run_id}/rerun-failed-jobs")
    })
}

impl WriteClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("ai-ops-atlas/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("HTTP client");
        Self { http }
    }

    /// Checks a token before it is saved and returns the account it belongs to.
    pub async fn token_login(&self, token: &str) -> Result<String, String> {
        let res = self
            .http
            .get("https://api.github.com/user")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| {
                format!(
                    "Couldn't reach GitHub to check the token ({})",
                    e.without_url()
                )
            })?;
        match res.status().as_u16() {
            200 => {}
            401 => return Err("GitHub rejected that token. Check it hasn't expired.".into()),
            s => return Err(format!("GitHub returned {s} while checking the token.")),
        }
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        body.get("login")
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .ok_or_else(|| "GitHub didn't say which account the token belongs to.".into())
    }
}

#[async_trait::async_trait]
impl WriteApi for WriteClient {
    async fn has_token(&self) -> bool {
        crate::secrets::read_actions_token().is_some()
    }

    async fn rerun_failed_jobs(&self, repo: &str, run_id: u64) -> Result<WriteResponse, SendError> {
        let url = rerun_url(repo, run_id)
            .ok_or_else(|| SendError::NotSent("Invalid repository".into()))?;
        let token = crate::secrets::read_actions_token()
            .ok_or_else(|| SendError::NotSent("No Actions token is saved".into()))?;
        // Errors are mapped to text without the request, which would carry the auth header.
        let res = self
            .http
            .post(url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| {
                let sent = !(e.is_connect() || e.is_builder());
                let text = format!("Network error reaching GitHub ({})", e.without_url());
                if sent {
                    SendError::Unknown(text)
                } else {
                    SendError::NotSent(text)
                }
            })?;
        let num = |name: &str| header(&res, name).and_then(|v| v.parse::<u64>().ok());
        let status = res.status().as_u16();
        let request_id = header(&res, "x-github-request-id");
        let rate_remaining = num("x-ratelimit-remaining").map(|v| v as u32);
        let rate_reset = num("x-ratelimit-reset");
        let retry_after = num("retry-after");
        let body = res.json().await.unwrap_or(serde_json::Value::Null);
        Ok(WriteResponse {
            status,
            body,
            request_id,
            rate_remaining,
            rate_reset,
            retry_after,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::rerun_url;

    #[test]
    fn builds_only_the_rerun_endpoint() {
        assert_eq!(
            rerun_url("khaneilcampbell/benjaire.com", 42).as_deref(),
            Some("https://api.github.com/repos/khaneilcampbell/benjaire.com/actions/runs/42/rerun-failed-jobs")
        );
        for bad in [
            "", "a", "a/b/c", "../x", "a/..", "a/b?x=1", "a/b#f", "a b/c", "a/b\n",
        ] {
            assert!(rerun_url(bad, 1).is_none(), "{bad:?}");
        }
    }
}
