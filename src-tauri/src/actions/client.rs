//! The only GitHub client that can write. It has no path parameter: the requests it can send
//! are built here from a validated repository, a number, and for edits a validated file path
//! and an `atlas-edit/` branch. A re-run uses the separate Actions token; a merge and an edit
//! use that repository's own merge token. Never the read-only one.

use super::edit::{encode_path, valid_path, EditApi, EDIT_BRANCH_PREFIX};
use super::merge::{MergeApi, MERGE_METHOD};
use super::rerun::{SendError, WriteApi, WriteResponse};
use crate::intel::collect::valid_repo;
use base64::Engine;
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

/// Where an edit creates its branch. `None` for anything that isn't a plain owner/name.
pub fn refs_url(repo: &str) -> Option<String> {
    valid_repo(repo).then(|| format!("https://api.github.com/repos/{repo}/git/refs"))
}

/// Where an edit commits its one file. `None` unless both the repository and path are valid.
pub fn contents_url(repo: &str, path: &str) -> Option<String> {
    (valid_repo(repo) && valid_path(path)).then(|| {
        format!(
            "https://api.github.com/repos/{repo}/contents/{}",
            encode_path(path)
        )
    })
}

/// Where an edit opens its pull request.
pub fn pulls_url(repo: &str) -> Option<String> {
    valid_repo(repo).then(|| format!("https://api.github.com/repos/{repo}/pulls"))
}

/// Edits only ever write to a branch Atlas created for them, never the default branch.
pub fn edit_branch_ok(branch: &str) -> bool {
    branch.len() > EDIT_BRANCH_PREFIX.len()
        && branch.starts_with(EDIT_BRANCH_PREFIX)
        && branch.len() <= 120
        && !branch.contains("..")
        && branch[EDIT_BRANCH_PREFIX.len()..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
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

impl WriteClient {
    async fn edit_send(
        &self,
        req: reqwest::RequestBuilder,
        repo: &str,
        body: serde_json::Value,
    ) -> Result<WriteResponse, SendError> {
        let token = crate::secrets::read_merge_token(repo)
            .ok_or_else(|| SendError::NotSent("No token is saved for this repository".into()))?;
        let res = req
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(send_error)?;
        Ok(write_response(res).await)
    }
}

#[async_trait::async_trait]
impl EditApi for WriteClient {
    async fn has_edit_token(&self, repo: &str) -> bool {
        crate::secrets::read_merge_token(repo).is_some()
    }

    async fn create_branch(
        &self,
        repo: &str,
        branch: &str,
        from_sha: &str,
    ) -> Result<WriteResponse, SendError> {
        let url = refs_url(repo).ok_or_else(|| SendError::NotSent("Invalid repository".into()))?;
        if !edit_branch_ok(branch) {
            return Err(SendError::NotSent(
                "Atlas only creates atlas-edit/ branches".into(),
            ));
        }
        if !(from_sha.len() == 40 && from_sha.chars().all(|c| c.is_ascii_hexdigit())) {
            return Err(SendError::NotSent("Invalid base commit".into()));
        }
        let body = serde_json::json!({ "ref": format!("refs/heads/{branch}"), "sha": from_sha });
        self.edit_send(self.http.post(url), repo, body).await
    }

    async fn put_file(
        &self,
        repo: &str,
        branch: &str,
        path: &str,
        content: &str,
        blob_sha: &str,
        message: &str,
    ) -> Result<WriteResponse, SendError> {
        let url = contents_url(repo, path)
            .ok_or_else(|| SendError::NotSent("Invalid repository or path".into()))?;
        // The branch parameter is what keeps this off the default branch: without it GitHub
        // would commit to the default branch.
        if !edit_branch_ok(branch) {
            return Err(SendError::NotSent(
                "Atlas only commits to atlas-edit/ branches".into(),
            ));
        }
        // `sha` names the version that was edited: GitHub refuses with 409 if it moved.
        let body = serde_json::json!({
            "message": message,
            "content": base64::engine::general_purpose::STANDARD.encode(content),
            "sha": blob_sha,
            "branch": branch,
        });
        self.edit_send(self.http.put(url), repo, body).await
    }

    async fn open_pull(
        &self,
        repo: &str,
        head: &str,
        base: &str,
        title: &str,
        body: &str,
    ) -> Result<WriteResponse, SendError> {
        let url = pulls_url(repo).ok_or_else(|| SendError::NotSent("Invalid repository".into()))?;
        if !edit_branch_ok(head) {
            return Err(SendError::NotSent(
                "Atlas only opens pull requests from atlas-edit/ branches".into(),
            ));
        }
        let body = serde_json::json!({ "title": title, "head": head, "base": base, "body": body, "maintainer_can_modify": true });
        self.edit_send(self.http.post(url), repo, body).await
    }
}

#[cfg(test)]
mod tests {
    use super::{contents_url, edit_branch_ok, merge_url, rerun_url};

    #[test]
    fn edits_write_only_to_atlas_branches_and_valid_paths() {
        assert!(edit_branch_ok("atlas-edit/readme-md-20261028-220000"));
        for bad in [
            "main",
            "atlas-edit/",
            "atlas-edit/../main",
            "atlas-edit/a/b",
            "refs/heads/atlas-edit/x",
            "Atlas-edit/x",
        ] {
            assert!(!edit_branch_ok(bad), "{bad:?}");
        }
        assert_eq!(
            contents_url("khaneilcampbell/benjaire.com", "docs/READ ME.md").as_deref(),
            Some("https://api.github.com/repos/khaneilcampbell/benjaire.com/contents/docs/READ%20ME.md")
        );
        for bad in [
            "",
            "../x",
            ".github/workflows/ci.yml",
            "a/.git/HEAD",
            "a?b",
            "a#b",
        ] {
            assert!(contents_url("o/r", bad).is_none(), "{bad:?}");
        }
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
