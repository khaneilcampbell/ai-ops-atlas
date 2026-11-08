//! The Steward's observation: at most seven sequential GETs against `policy::REPO`, no
//! retries, a twenty-second request timeout and a three-minute run budget. Missing,
//! denied or malformed evidence is recorded as unknown, never as clear.

use super::policy::REPO;
use super::types::{Check, CheckState, Run, RunStatus, Trigger};
use serde_json::Value;
use std::time::Duration;

pub const MAX_REQUESTS: u32 = 7;
pub const RUN_BUDGET: Duration = Duration::from_secs(180);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

pub struct Reply {
    pub status: u16,
    pub body: Value,
    pub rate_remaining: Option<u32>,
}

/// The only network surface the check gets: GETs that `policy::allowed` already admits.
#[async_trait::async_trait]
pub trait Source: Send + Sync {
    async fn get(&self, path: &str) -> Result<Reply, String>;
}

/// What the runner lets the check observe about time and cancellation.
pub trait Control: Send + Sync {
    fn stopped(&self) -> bool;
    fn elapsed(&self) -> Duration;
}

fn root() -> String {
    format!("https://github.com/{REPO}")
}

/// Percent-encodes a branch the way the panel's `encodeURIComponent` did, for the safe subset.
fn encode(branch: &str) -> String {
    branch
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

type Assess = Box<dyn FnOnce(&Value) -> Result<(CheckState, String, Option<String>), ()> + Send>;

struct Collector<'a> {
    source: &'a dyn Source,
    control: &'a dyn Control,
    run: Run,
}

impl Collector<'_> {
    fn stopped(&self) -> bool {
        self.control.stopped() || self.control.elapsed() >= RUN_BUDGET
    }

    async fn read(&mut self, id: &str, label: &str, suffix: &str, url: String, assess: Assess) {
        if self.stopped() || self.run.requests >= MAX_REQUESTS {
            return;
        }
        self.run.requests += 1;
        let path = format!("/repos/{REPO}{suffix}");
        let left = RUN_BUDGET
            .saturating_sub(self.control.elapsed())
            .min(REQUEST_TIMEOUT);
        let reply = match tokio::time::timeout(left, self.source.get(&path)).await {
            Ok(r) => r,
            Err(_) => Err("timed out".into()),
        };
        if self.stopped() {
            return;
        }
        if let Ok(r) = &reply {
            if r.rate_remaining.is_some() {
                self.run.rate_remaining = r.rate_remaining;
            }
        }
        let missing_file = matches!(&reply, Ok(r) if r.status == 404)
            && (id == "readme" || id == "dependabot-config");
        let assessed = match &reply {
            Ok(r) if (200..300).contains(&r.status) => assess(&r.body).ok(),
            _ => None,
        };
        let (state, detail, signature) = match assessed {
            Some(v) => v,
            None if missing_file => (
                CheckState::Attention,
                "File not found or not accessible. Verify access before adding it.".into(),
                None,
            ),
            None => {
                if let Err(e) = &reply {
                    self.run.error_class.get_or_insert_with(|| classify(e));
                } else if let Ok(r) = &reply {
                    if r.status >= 400 {
                        self.run
                            .error_class
                            .get_or_insert_with(|| format!("http_{}", r.status));
                    }
                }
                (CheckState::Unknown, "Could not verify this check. Check connection, token permissions and GitHub availability.".into(), None)
            }
        };
        self.run.checks.push(Check {
            id: id.into(),
            label: label.into(),
            state,
            detail,
            url,
            signature,
        });
    }
}

/// A fixed, secret-free label for an error, so audit records never carry raw messages.
fn classify(e: &str) -> String {
    let e = e.to_lowercase();
    if e.contains("timed out") || e.contains("timeout") {
        "timeout".into()
    } else if e.contains("blocked") {
        "policy_blocked".into()
    } else if e.contains("network") {
        "network".into()
    } else {
        "other".into()
    }
}

fn alerts(v: &Value) -> Result<(CheckState, String, Option<String>), ()> {
    let list = v.as_array().ok_or(())?;
    if list.is_empty() {
        return Ok((CheckState::Clear, "No open alerts returned. This does not establish that scanning is enabled or comprehensive.".into(), None));
    }
    let mut numbers: Vec<i64> = list
        .iter()
        .filter_map(|a| a.get("number")?.as_i64())
        .collect();
    numbers.sort_unstable();
    let plus = if list.len() == 20 { "+" } else { "" };
    Ok((
        CheckState::Attention,
        format!("{}{plus} open alerts observed. Review privately in GitHub; exploitability has not been assessed.", list.len()),
        Some(serde_json::to_string(&numbers).unwrap_or_default()),
    ))
}

fn ci(branch: String) -> Assess {
    Box::new(move |v| {
        let runs = v.get("workflow_runs").and_then(Value::as_array).ok_or(())?;
        // Only the newest run for each workflow counts, so an old failure cannot hide a recovery.
        let mut latest: std::collections::BTreeMap<i64, &Value> = Default::default();
        for r in runs {
            let (Some(wf), Some(b)) = (
                r.get("workflow_id").and_then(Value::as_i64),
                r.get("head_branch").and_then(Value::as_str),
            ) else {
                continue;
            };
            if b != branch {
                continue;
            }
            let key = |x: &Value| {
                (
                    x.get("created_at")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_owned(),
                    x.get("id").and_then(Value::as_i64).unwrap_or(0),
                )
            };
            if latest.get(&wf).map_or(true, |p| key(r) > key(p)) {
                latest.insert(wf, r);
            }
        }
        let sampled: Vec<&Value> = latest.into_values().collect();
        if sampled.is_empty() {
            return Ok((
                CheckState::Unknown,
                "No workflow runs observed on the default branch in this sample.".into(),
                None,
            ));
        }
        let conclusion = |r: &Value| {
            r.get("conclusion")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned()
        };
        let mut failed: Vec<(i64, String)> = sampled
            .iter()
            .filter(|r| {
                ["failure", "timed_out", "action_required", "startup_failure"]
                    .contains(&conclusion(r).as_str())
            })
            .map(|r| {
                (
                    r.get("workflow_id").and_then(Value::as_i64).unwrap_or(0),
                    conclusion(r),
                )
            })
            .collect();
        if !failed.is_empty() {
            failed.sort();
            return Ok((
                CheckState::Attention,
                format!("{} of {} sampled workflows have a failing latest run. Open Actions to investigate.", failed.len(), sampled.len()),
                Some(serde_json::to_string(&failed).unwrap_or_default()),
            ));
        }
        let pending = sampled
            .iter()
            .filter(|r| {
                r.get("status").and_then(Value::as_str) != Some("completed")
                    || !["success", "neutral", "skipped"].contains(&conclusion(r).as_str())
            })
            .count();
        Ok(if pending > 0 {
            (
                CheckState::Unknown,
                format!("{pending} sampled workflows are unfinished, cancelled or inconclusive."),
                None,
            )
        } else {
            (CheckState::Clear, format!("Latest runs for {} sampled workflows passed or were neutral/skipped. Sample: up to 30 runs; required checks and uptime are not assessed.", sampled.len()), None)
        })
    })
}

pub async fn check(
    source: &dyn Source,
    control: &dyn Control,
    id: String,
    started_at: String,
    trigger: Trigger,
) -> Run {
    let root = root();
    let mut c = Collector {
        source,
        control,
        run: Run::new(id, started_at, trigger),
    };
    let branch = std::sync::Arc::new(std::sync::Mutex::new(None::<String>));
    let found = branch.clone();
    c.read(
        "repository",
        "Repository",
        "",
        root.clone(),
        Box::new(move |v| {
            let b = v
                .get("default_branch")
                .and_then(Value::as_str)
                .filter(|b| !b.is_empty())
                .ok_or(())?;
            if v.get("full_name").and_then(Value::as_str) != Some(REPO) {
                return Err(());
            }
            *found.lock().unwrap() = Some(b.to_owned());
            Ok(
                if v.get("archived").and_then(Value::as_bool) == Some(true) {
                    (
                        CheckState::Attention,
                        "Repository is archived.".into(),
                        None,
                    )
                } else {
                    (CheckState::Clear, format!("Default branch: {b}."), None)
                },
            )
        }),
    )
    .await;
    let branch = branch.lock().unwrap().clone();
    if let Some(b) = branch.clone() {
        let e = encode(&b);
        let sha = std::sync::Arc::new(std::sync::Mutex::new(None::<String>));
        let seen = sha.clone();
        c.read(
            "commit",
            "Examined commit",
            &format!("/commits/{e}"),
            format!("{root}/commits/{e}"),
            Box::new(move |v| {
                let s = v
                    .get("sha")
                    .and_then(Value::as_str)
                    .filter(|s| s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit()))
                    .ok_or(())?;
                *seen.lock().unwrap() = Some(s.to_owned());
                Ok((CheckState::Clear, s[..12].to_owned(), None))
            }),
        )
        .await;
        if let Some(s) = sha.lock().unwrap().clone() {
            if let Some(check) = c.run.checks.iter_mut().find(|x| x.id == "commit") {
                check.url = format!("{root}/commit/{s}");
            }
            c.run.commit = Some(s);
        }
        c.read(
            "ci",
            "CI on default branch",
            &format!("/actions/runs?per_page=30&branch={e}"),
            format!("{root}/actions"),
            ci(b),
        )
        .await;
    } else if !c.stopped() {
        for (id, label) in [
            ("commit", "Examined commit"),
            ("ci", "CI on default branch"),
        ] {
            c.run.checks.push(Check {
                id: id.into(),
                label: label.into(),
                state: CheckState::Unknown,
                detail: "Default branch could not be verified.".into(),
                url: root.clone(),
                signature: None,
            });
        }
    }
    c.read(
        "dependabot",
        "Dependency security",
        "/dependabot/alerts?state=open&per_page=20",
        format!("{root}/security/dependabot"),
        Box::new(alerts),
    )
    .await;
    c.read(
        "code-scanning",
        "Code scanning",
        "/code-scanning/alerts?state=open&per_page=20",
        format!("{root}/security/code-scanning"),
        Box::new(alerts),
    )
    .await;
    let file = |v: &Value| -> Result<(CheckState, String, Option<String>), ()> {
        if v.get("type").and_then(Value::as_str) != Some("file") {
            return Err(());
        }
        Ok((
            CheckState::Clear,
            "File is present. Content quality and configuration behavior have not been assessed."
                .into(),
            None,
        ))
    };
    c.read(
        "readme",
        "Setup documentation",
        "/readme",
        format!("{root}#readme"),
        Box::new(file),
    )
    .await;
    let blob = encode(branch.as_deref().unwrap_or("HEAD"));
    c.read(
        "dependabot-config",
        "Dependency update configuration",
        "/contents/.github/dependabot.yml",
        format!("{root}/blob/{blob}/.github/dependabot.yml"),
        Box::new(file),
    )
    .await;
    c.run.status = if c.stopped() {
        RunStatus::Paused
    } else if c.run.checks.iter().any(|x| x.state == CheckState::Unknown) {
        RunStatus::Partial
    } else {
        RunStatus::Completed
    };
    c.run
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Mutex;

    struct Fake {
        answers: HashMap<String, Result<(u16, Value), String>>,
        calls: Mutex<Vec<String>>,
        /// Stop after this many calls, as a pause or the clock would.
        stop_after: Option<usize>,
        stop: AtomicBool,
        hang: Option<String>,
    }

    type Answer = Result<(u16, Value), String>;

    fn fake(over: &[(&str, Answer)]) -> Fake {
        let wf = |id: i64, c: &str, at: &str| json!({"id": id, "workflow_id": 1, "head_branch": "main", "status": "completed", "conclusion": c, "created_at": at});
        let mut answers: HashMap<String, Result<(u16, Value), String>> = [
            ("", Ok((200, json!({"full_name": REPO, "default_branch": "main"})))),
            ("/commits/main", Ok((200, json!({"sha": "a".repeat(40)})))),
            ("/actions/runs?per_page=30&branch=main", Ok((200, json!({"workflow_runs": [wf(2, "success", "2026-10-28"), wf(1, "failure", "2026-10-27")]})))),
            ("/dependabot/alerts?state=open&per_page=20", Ok((200, json!([])))),
            ("/code-scanning/alerts?state=open&per_page=20", Ok((200, json!([])))),
            ("/readme", Ok((200, json!({"type": "file"})))),
            ("/contents/.github/dependabot.yml", Ok((200, json!({"type": "file"})))),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect();
        for (k, v) in over {
            answers.insert((*k).to_owned(), v.clone());
        }
        Fake {
            answers,
            calls: Mutex::new(vec![]),
            stop_after: None,
            stop: AtomicBool::new(false),
            hang: None,
        }
    }

    #[async_trait::async_trait]
    impl Source for Fake {
        async fn get(&self, path: &str) -> Result<Reply, String> {
            assert!(
                super::super::policy::allowed(path),
                "check issued a path the policy refuses: {path}"
            );
            let suffix = path
                .trim_start_matches(&format!("/repos/{REPO}"))
                .to_owned();
            let n = {
                let mut c = self.calls.lock().unwrap();
                c.push(suffix.clone());
                c.len()
            };
            if self.stop_after == Some(n) {
                self.stop.store(true, Ordering::SeqCst);
            }
            if self.hang.as_deref() == Some(suffix.as_str()) {
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
            let (status, body) = self
                .answers
                .get(&suffix)
                .cloned()
                .unwrap_or(Ok((404, Value::Null)))?;
            Ok(Reply {
                status,
                body,
                rate_remaining: Some(4000),
            })
        }
    }

    struct Clock<'a>(&'a Fake, AtomicU64);
    impl Control for Clock<'_> {
        fn stopped(&self) -> bool {
            self.0.stop.load(Ordering::SeqCst)
        }
        fn elapsed(&self) -> Duration {
            Duration::from_millis(self.1.load(Ordering::SeqCst))
        }
    }

    async fn go(f: &Fake) -> Run {
        check(
            f,
            &Clock(f, AtomicU64::new(0)),
            "r".into(),
            "t".into(),
            Trigger::Manual,
        )
        .await
    }

    fn state(r: &Run, id: &str) -> CheckState {
        r.checks
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.state)
            .unwrap()
    }

    #[tokio::test]
    async fn bounded_reads_recognize_ci_recovery() {
        let f = fake(&[]);
        let r = go(&f).await;
        assert_eq!(r.status, RunStatus::Completed);
        assert_eq!(r.requests, 7);
        assert_eq!(f.calls.lock().unwrap().len(), 7);
        assert_eq!(state(&r, "ci"), CheckState::Clear);
        assert_eq!(r.commit.as_deref(), Some("a".repeat(40).as_str()));
        assert_eq!(r.rate_remaining, Some(4000));
    }

    #[tokio::test]
    async fn denied_and_malformed_alerts_are_unknown_not_zero() {
        let f = fake(&[
            (
                "/dependabot/alerts?state=open&per_page=20",
                Ok((
                    403,
                    json!({"message": "Resource not accessible by personal access token"}),
                )),
            ),
            (
                "/code-scanning/alerts?state=open&per_page=20",
                Ok((200, json!({"message": "not available"}))),
            ),
        ]);
        let r = go(&f).await;
        assert_eq!(r.status, RunStatus::Partial);
        assert_eq!(state(&r, "dependabot"), CheckState::Unknown);
        assert_eq!(state(&r, "code-scanning"), CheckState::Unknown);
        assert_eq!(r.error_class.as_deref(), Some("http_403"));
        assert!(!serde_json::to_string(&r)
            .unwrap()
            .contains("personal access token"));
    }

    #[tokio::test]
    async fn alert_content_is_not_kept() {
        let many: Vec<Value> = (1..=20).map(|n| json!({"number": n, "security_advisory": {"summary": "private advisory detail"}})).collect();
        let f = fake(&[(
            "/dependabot/alerts?state=open&per_page=20",
            Ok((200, Value::Array(many))),
        )]);
        let r = go(&f).await;
        let d = r.checks.iter().find(|c| c.id == "dependabot").unwrap();
        assert_eq!(d.state, CheckState::Attention);
        assert!(d.detail.starts_with("20+"));
        assert!(!serde_json::to_string(&r)
            .unwrap()
            .contains("private advisory detail"));
    }

    #[tokio::test]
    async fn missing_metadata_does_not_guess_a_branch() {
        let f = fake(&[("", Ok((404, Value::Null)))]);
        let r = go(&f).await;
        assert_eq!(r.status, RunStatus::Partial);
        assert!(f
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|p| !p.starts_with("/commits") && !p.starts_with("/actions")));
        assert_eq!(state(&r, "ci"), CheckState::Unknown);
    }

    #[tokio::test]
    async fn pause_mid_run_issues_no_further_request() {
        let mut f = fake(&[]);
        f.stop_after = Some(2);
        let r = go(&f).await;
        assert_eq!(r.status, RunStatus::Paused);
        assert_eq!(f.calls.lock().unwrap().len(), 2);
        assert_eq!(r.checks.len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_hung_request_times_out_as_unknown() {
        let mut f = fake(&[]);
        f.hang = Some("/readme".into());
        let r = go(&f).await;
        assert_eq!(state(&r, "readme"), CheckState::Unknown);
        assert_eq!(r.error_class.as_deref(), Some("timeout"));
        assert_eq!(r.requests, 7);
    }

    #[tokio::test]
    async fn network_errors_are_classified_without_their_text() {
        let f = fake(&[(
            "/readme",
            Err("Network error reaching GitHub (token ghp_secret)".into()),
        )]);
        let r = go(&f).await;
        assert_eq!(r.error_class.as_deref(), Some("network"));
        assert!(!serde_json::to_string(&r).unwrap().contains("ghp_secret"));
    }

    #[tokio::test]
    async fn current_failures_flag_and_cancelled_is_inconclusive() {
        for (c, want) in [
            ("failure", CheckState::Attention),
            ("cancelled", CheckState::Unknown),
        ] {
            let runs = json!({"workflow_runs": [{"id": 1, "workflow_id": 1, "head_branch": "main", "status": "completed", "conclusion": c, "created_at": "2026-10-28"}]});
            let f = fake(&[("/actions/runs?per_page=30&branch=main", Ok((200, runs)))]);
            assert_eq!(state(&go(&f).await, "ci"), want);
        }
    }

    #[test]
    fn encodes_branches_like_the_panel() {
        assert_eq!(encode("release/1.0"), "release%2F1.0");
        assert!(super::super::policy::allowed(&format!(
            "/repos/{REPO}/commits/{}",
            encode("release/1.0")
        )));
    }
}
