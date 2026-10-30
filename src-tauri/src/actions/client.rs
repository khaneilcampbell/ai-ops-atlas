//! The only GitHub client that can write. It has no path parameter: the requests it can send
//! are built here from a validated repository and a number or an allow-listed workflow. A
//! re-run uses the separate Actions token; a merge uses that repository's own merge token;
//! Manage agents uses its own agents token. Never the read-only one.

use super::agents::{AgentOp, AgentWriteApi};
use super::merge::{MergeApi, MERGE_METHOD};
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

/// The merge endpoint for one pull request. `None` for anything that isn't a plain owner/name.
pub fn merge_url(repo: &str, number: u64) -> Option<String> {
    valid_repo(repo).then(|| format!("https://api.github.com/repos/{repo}/pulls/{number}/merge"))
}

/// The enable, disable or dispatch endpoint for one workflow file. `None` unless the
/// repository is a plain owner/name and the file a plain `name.yml`.
pub fn workflow_url(repo: &str, workflow: &str, op: AgentOp) -> Option<String> {
    let file_ok = (workflow.ends_with(".yml") || workflow.ends_with(".yaml"))
        && workflow.len() <= 80
        && workflow
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
        && !workflow.starts_with('.')
        && !workflow.contains("..");
    let tail = match op {
        AgentOp::Enable => "enable",
        AgentOp::Disable => "disable",
        AgentOp::RunNow => "dispatches",
    };
    (valid_repo(repo) && file_ok)
        .then(|| format!("https://api.github.com/repos/{repo}/actions/workflows/{workflow}/{tail}"))
}

/// Maps a send error to text without the request, which would carry the auth header.
fn send_error(e: reqwest::Error) -> SendError {
    let sent = !(e.is_connect() || e.is_builder());
    let text = format!("Network error reaching GitHub ({})", e.without_url());
    if sent {
        SendError::Unknown(text)
    } else {
        SendError::NotSent(text)
    }
}

async fn write_response(res: reqwest::Response) -> WriteResponse {
    let num = |name: &str| header(&res, name).and_then(|v| v.parse::<u64>().ok());
    let status = res.status().as_u16();
    let request_id = header(&res, "x-github-request-id");
    let rate_remaining = num("x-ratelimit-remaining").map(|v| v as u32);
    let rate_reset = num("x-ratelimit-reset");
    let retry_after = num("retry-after");
    let body = res.json().await.unwrap_or(serde_json::Value::Null);
    WriteResponse {
        status,
        body,
        request_id,
        rate_remaining,
        rate_reset,
        retry_after,
    }
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

    /// Checks that a merge token can see its repository before it is saved.
    pub async fn token_sees_repo(&self, token: &str, repo: &str) -> Result<(), String> {
        if !valid_repo(repo) {
            return Err("That isn't a valid owner/name repository.".into());
        }
        let res = self
            .http
            .get(format!("https://api.github.com/repos/{repo}"))
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
            200 => Ok(()),
            401 => Err("GitHub rejected that token. Check it hasn't expired.".into()),
            404 => Err(format!(
                "That token can't see {repo}. Give it access to this repository only."
            )),
            s => Err(format!("GitHub returned {s} while checking the token.")),
        }
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
        let res = self
            .http
            .post(url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token)
            .send()
            .await
            .map_err(send_error)?;
        Ok(write_response(res).await)
    }
}

#[async_trait::async_trait]
impl MergeApi for WriteClient {
    async fn has_merge_token(&self, repo: &str) -> bool {
        crate::secrets::read_merge_token(repo).is_some()
    }

    async fn merge_pull(
        &self,
        repo: &str,
        number: u64,
        head_sha: &str,
    ) -> Result<WriteResponse, SendError> {
        let url = merge_url(repo, number)
            .ok_or_else(|| SendError::NotSent("Invalid repository".into()))?;
        if !(head_sha.len() == 40 && head_sha.chars().all(|c| c.is_ascii_hexdigit())) {
            return Err(SendError::NotSent("Invalid head commit".into()));
        }
        let token = crate::secrets::read_merge_token(repo).ok_or_else(|| {
            SendError::NotSent("No merge token is saved for this repository".into())
        })?;
        // `sha` pins the commit KC approved: GitHub refuses with 409 if the branch moved.
        let res = self
            .http
            .put(url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token)
            .json(&serde_json::json!({ "sha": head_sha, "merge_method": MERGE_METHOD }))
            .send()
            .await
            .map_err(send_error)?;
        Ok(write_response(res).await)
    }
}

#[async_trait::async_trait]
impl AgentWriteApi for WriteClient {
    async fn has_token(&self) -> bool {
        crate::secrets::read_agents_token().is_some()
    }

    async fn workflow_op(
        &self,
        repo: &str,
        workflow: &str,
        op: AgentOp,
        branch: &str,
    ) -> Result<WriteResponse, SendError> {
        let url = workflow_url(repo, workflow, op)
            .ok_or_else(|| SendError::NotSent("Invalid repository or workflow".into()))?;
        let token = crate::secrets::read_agents_token()
            .ok_or_else(|| SendError::NotSent("No Manage agents token is saved".into()))?;
        let req = match op {
            AgentOp::Enable | AgentOp::Disable => self.http.put(url),
            // Default inputs only: nothing from the web view reaches the workflow.
            AgentOp::RunNow => self
                .http
                .post(url)
                .json(&serde_json::json!({ "ref": branch })),
        };
        let res = req
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token)
            .send()
            .await
            .map_err(send_error)?;
        Ok(write_response(res).await)
    }
}

#[cfg(test)]
mod tests {
    use super::{merge_url, rerun_url, workflow_url};
    use crate::actions::agents::AgentOp;

    #[test]
    fn builds_only_the_workflow_endpoints() {
        let repo = "khaneilcampbell/ai-ops-atlas";
        assert_eq!(
            workflow_url(repo, "merge-flow.yml", AgentOp::Disable).as_deref(),
            Some("https://api.github.com/repos/khaneilcampbell/ai-ops-atlas/actions/workflows/merge-flow.yml/disable")
        );
        assert_eq!(
            workflow_url(repo, "merge-flow.yml", AgentOp::RunNow).as_deref(),
            Some("https://api.github.com/repos/khaneilcampbell/ai-ops-atlas/actions/workflows/merge-flow.yml/dispatches")
        );
        for bad in [
            "",
            "ci",
            "../ci.yml",
            "a/ci.yml",
            "CI.yml",
            "x.yml?a=1",
            ".yml",
            "a b.yml",
        ] {
            assert!(
                workflow_url(repo, bad, AgentOp::Enable).is_none(),
                "{bad:?}"
            );
        }
        assert!(workflow_url("a/b/c", "x.yml", AgentOp::Enable).is_none());
    }

    #[test]
    fn builds_only_the_merge_endpoint() {
        assert_eq!(
            merge_url("khaneilcampbell/benjaire.com", 7).as_deref(),
            Some("https://api.github.com/repos/khaneilcampbell/benjaire.com/pulls/7/merge")
        );
        for bad in ["", "a/b/c", "../x", "a/b?x=1", "a b/c"] {
            assert!(merge_url(bad, 1).is_none(), "{bad:?}");
        }
    }

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
