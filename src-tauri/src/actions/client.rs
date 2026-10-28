//! The only GitHub client that can write. It has no path parameter: every request it can
//! send is built here from a validated repository and a number or workflow file name. Re-runs
//! and workflow changes use the separate Actions token; merges and pull request changes use
//! that repository's own pull request token. Never the read-only one.

use super::merge::{MergeApi, MERGE_METHOD};
use super::ops::{valid_ref, valid_workflow, Op, OpsApi, TokenKind};
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

/// The method, URL and JSON body for one op. `None` for anything that doesn't validate.
pub fn op_request(
    repo: &str,
    op: &Op,
    git_ref: Option<&str>,
) -> Option<(reqwest::Method, String, Option<serde_json::Value>)> {
    use reqwest::Method;
    if !valid_repo(repo) {
        return None;
    }
    let base = format!("https://api.github.com/repos/{repo}");
    let wf = |w: &str| valid_workflow(w).then(|| format!("{base}/actions/workflows/{w}"));
    Some(match op {
        Op::CancelRun { run_id } => (
            Method::POST,
            format!("{base}/actions/runs/{run_id}/cancel"),
            None,
        ),
        Op::RunWorkflow { workflow } => {
            let r = git_ref.filter(|r| valid_ref(r))?;
            (
                Method::POST,
                format!("{}/dispatches", wf(workflow)?),
                Some(serde_json::json!({ "ref": r })),
            )
        }
        Op::PauseWorkflow { workflow } => (Method::PUT, format!("{}/disable", wf(workflow)?), None),
        Op::ResumeWorkflow { workflow } => (Method::PUT, format!("{}/enable", wf(workflow)?), None),
        Op::ClosePull { number } => (
            Method::PATCH,
            format!("{base}/pulls/{number}"),
            Some(serde_json::json!({ "state": "closed" })),
        ),
        Op::ReopenPull { number } => (
            Method::PATCH,
            format!("{base}/pulls/{number}"),
            Some(serde_json::json!({ "state": "open" })),
        ),
        Op::CommentPull { number, body } => (
            Method::POST,
            format!("{base}/issues/{number}/comments"),
            Some(serde_json::json!({ "body": body })),
        ),
    })
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
impl OpsApi for WriteClient {
    async fn has_op_token(&self, kind: TokenKind, repo: &str) -> bool {
        match kind {
            TokenKind::Actions => crate::secrets::read_actions_token().is_some(),
            TokenKind::Pulls => crate::secrets::read_merge_token(repo).is_some(),
        }
    }

    async fn send_op(
        &self,
        repo: &str,
        op: &Op,
        git_ref: Option<&str>,
    ) -> Result<WriteResponse, SendError> {
        let (method, url, body) = op_request(repo, op, git_ref)
            .ok_or_else(|| SendError::NotSent("Invalid request".into()))?;
        let token = match op.token() {
            TokenKind::Actions => crate::secrets::read_actions_token()
                .ok_or_else(|| SendError::NotSent("No Actions token is saved".into()))?,
            TokenKind::Pulls => crate::secrets::read_merge_token(repo).ok_or_else(|| {
                SendError::NotSent("No pull request token is saved for this repository".into())
            })?,
        };
        let mut req = self
            .http
            .request(method, url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await.map_err(send_error)?;
        Ok(write_response(res).await)
    }
}

#[cfg(test)]
mod tests {
    use super::{merge_url, op_request, rerun_url};
    use crate::actions::ops::Op;
    use reqwest::Method;

    #[test]
    fn builds_only_the_op_endpoints() {
        let r = "khaneilcampbell/benjaire.com";
        let base = "https://api.github.com/repos/khaneilcampbell/benjaire.com";
        let url = |op: Op, git_ref: Option<&str>| op_request(r, &op, git_ref);
        assert_eq!(
            url(Op::CancelRun { run_id: 9 }, None).unwrap().1,
            format!("{base}/actions/runs/9/cancel")
        );
        let (m, u, b) = url(
            Op::RunWorkflow {
                workflow: "ci.yml".into(),
            },
            Some("main"),
        )
        .unwrap();
        assert_eq!(
            (m, u),
            (
                Method::POST,
                format!("{base}/actions/workflows/ci.yml/dispatches")
            )
        );
        assert_eq!(b.unwrap()["ref"], "main");
        assert!(
            url(
                Op::RunWorkflow {
                    workflow: "ci.yml".into()
                },
                None
            )
            .is_none(),
            "dispatch needs a ref"
        );
        assert!(url(
            Op::RunWorkflow {
                workflow: "ci.yml".into()
            },
            Some("a b")
        )
        .is_none());
        assert_eq!(
            url(
                Op::PauseWorkflow {
                    workflow: "ci.yml".into()
                },
                None
            )
            .unwrap()
            .1,
            format!("{base}/actions/workflows/ci.yml/disable")
        );
        assert_eq!(
            url(
                Op::ResumeWorkflow {
                    workflow: "ci.yml".into()
                },
                None
            )
            .unwrap()
            .1,
            format!("{base}/actions/workflows/ci.yml/enable")
        );
        let (m, u, b) = url(Op::ClosePull { number: 3 }, None).unwrap();
        assert_eq!(
            (m, u, b.unwrap()["state"].clone()),
            (Method::PATCH, format!("{base}/pulls/3"), "closed".into())
        );
        let (m, u, b) = url(
            Op::CommentPull {
                number: 3,
                body: "hi".into(),
            },
            None,
        )
        .unwrap();
        assert_eq!(
            (m, u, b.unwrap()["body"].clone()),
            (
                Method::POST,
                format!("{base}/issues/3/comments"),
                "hi".into()
            )
        );
        for bad in ["../ci.yml", "ci.yml/../../x.yml", "a/b.yml"] {
            assert!(
                url(
                    Op::PauseWorkflow {
                        workflow: bad.into()
                    },
                    None
                )
                .is_none(),
                "{bad}"
            );
        }
        assert!(op_request("a/b/c", &Op::CancelRun { run_id: 1 }, None).is_none());
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
