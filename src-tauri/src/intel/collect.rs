//! Repository data collection. Only GET requests through the read-only GitHub client, and
//! only for the one repository being analyzed. Everything here is deterministic: facts that
//! code can establish (CI state, commit dates, alert counts, which files exist) are computed
//! here and never left for the model to work out.

use super::types::*;
use base64::Engine;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub struct GhResponse {
    pub status: u16,
    pub body: Value,
    pub rate_remaining: Option<u32>,
    pub rate_reset: Option<u64>,
}

/// The only GitHub surface the agent gets. It has no method that could write.
#[async_trait::async_trait]
pub trait GithubApi: Send + Sync {
    async fn get(&self, path: &str) -> Result<GhResponse, String>;
    async fn has_token(&self) -> bool;
}

#[derive(Debug, Clone, PartialEq)]
pub enum CollectError {
    InvalidRepo,
    Auth,
    NotFound,
    RateLimited { reset: Option<u64> },
    Network(String),
    Github { status: u16, message: String },
}

impl CollectError {
    pub fn to_run_error(&self) -> RunError {
        let (kind, message, retryable) = match self {
            CollectError::InvalidRepo => (
                "invalid_repo",
                "That isn't a valid owner/name repository.".to_string(),
                false,
            ),
            CollectError::Auth => (
                "github_auth",
                "GitHub rejected the saved token. Replace it in Settings.".to_string(),
                false,
            ),
            CollectError::NotFound => (
                "github_not_found",
                "GitHub says this repository doesn't exist or the token can't see it.".to_string(),
                false,
            ),
            CollectError::RateLimited { reset } => (
                "github_rate_limit",
                match reset.and_then(|r| DateTime::<Utc>::from_timestamp(r as i64, 0)) {
                    Some(t) => format!(
                        "GitHub's hourly request limit is used up. It resets at {} UTC.",
                        t.format("%H:%M")
                    ),
                    None => "GitHub's request limit is used up. Try again later.".to_string(),
                },
                true,
            ),
            CollectError::Network(m) => ("network", m.clone(), true),
            CollectError::Github { status, message } => (
                "github_error",
                format!("GitHub returned {status}: {message}"),
                *status >= 500,
            ),
        };
        RunError {
            kind: kind.into(),
            message,
            retryable,
        }
    }
}

/// What a single collection produced: the facts plus the bounded text excerpts the prompt
/// may include. Excerpts are untrusted repository content.
pub struct Collected {
    pub facts: Facts,
    pub readme: Option<Excerpt>,
    pub manifests: Vec<(String, Excerpt)>,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Excerpt {
    pub text: String,
    pub total_chars: usize,
}

/// `owner/name` with GitHub's allowed characters. Anything else is refused before a request.
pub fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let owner_ok = (1..=39).contains(&owner.len())
        && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    let name_ok = (1..=100).contains(&name.len())
        && name != "."
        && name != ".."
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    owner_ok && name_ok
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

enum Fetched {
    Ok(Value),
    /// GitHub answered but won't give this section (no permission, disabled, empty repo).
    Unavailable(u16, String),
}

struct Session<'a> {
    gh: &'a dyn GithubApi,
    requests: u32,
}

impl Session<'_> {
    async fn fetch(&mut self, path: &str) -> Result<Fetched, CollectError> {
        let mut tries = 0;
        loop {
            tries += 1;
            self.requests += 1;
            let res = self.gh.get(path).await.map_err(CollectError::Network)?;
            let msg = res
                .body
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let limited =
                res.rate_remaining == Some(0) || msg.to_lowercase().contains("rate limit");
            match res.status {
                200..=299 => return Ok(Fetched::Ok(res.body)),
                403 | 429 if limited => {
                    return Err(CollectError::RateLimited {
                        reset: res.rate_reset,
                    })
                }
                500..=599 if tries < 2 => continue,
                500..=599 => {
                    return Err(CollectError::Github {
                        status: res.status,
                        message: msg,
                    })
                }
                s => return Ok(Fetched::Unavailable(s, msg)),
            }
        }
    }

    /// For optional sections: a refusal becomes "not assessed" with GitHub's reason.
    async fn optional(&mut self, path: &str) -> Result<Result<Value, String>, CollectError> {
        Ok(match self.fetch(path).await? {
            Fetched::Ok(v) => Ok(v),
            Fetched::Unavailable(s, m) => Err(reason(s, &m)),
        })
    }
}

fn reason(status: u16, msg: &str) -> String {
    match status {
        401 => "GitHub requires authentication for this. Add a token in Settings.".into(),
        403 => format!(
            "The token isn't allowed to read this ({}).",
            if msg.is_empty() { "forbidden" } else { msg }
        ),
        404 => "Not available: the feature is off or the token can't see it.".into(),
        409 => "The repository is empty.".into(),
        _ => format!(
            "GitHub returned {status}{}",
            if msg.is_empty() {
                String::new()
            } else {
                format!(": {msg}")
            }
        ),
    }
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}

fn one_line(t: &str, max: usize) -> String {
    let line = t.lines().next().unwrap_or("").trim();
    truncate_chars(line, max)
}

pub fn truncate_chars(t: &str, max: usize) -> String {
    if t.chars().count() <= max {
        t.to_string()
    } else {
        let mut out: String = t.chars().take(max).collect();
        out.push('…');
        out
    }
}

fn decode_content(v: &Value) -> Option<String> {
    let raw = v.get("content")?.as_str()?.replace(['\n', '\r'], "");
    let bytes = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn excerpt(text: &str, max: usize) -> Excerpt {
    Excerpt {
        total_chars: text.chars().count(),
        text: text.chars().take(max).collect(),
    }
}

/// Root manifests worth reading, in priority order. A fixed list keeps paths predictable.
const MANIFESTS: [&str; 10] = [
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "Gemfile",
    "pom.xml",
    "build.gradle",
    "wrangler.toml",
    "Pipfile",
];

fn has(files: &BTreeSet<String>, name: &str) -> bool {
    files.contains(&name.to_lowercase())
}

/// Technologies and agent integrations visible from file names and manifest text.
pub fn detect_stack(
    root_files: &[String],
    manifests: &[(String, Excerpt)],
) -> (Vec<String>, Vec<String>) {
    let files: BTreeSet<String> = root_files.iter().map(|f| f.to_lowercase()).collect();
    let mut stack = BTreeSet::new();
    let mut agents = BTreeSet::new();
    let by_file = [
        ("package.json", "Node.js"),
        ("tsconfig.json", "TypeScript"),
        ("cargo.toml", "Rust"),
        ("pyproject.toml", "Python"),
        ("requirements.txt", "Python"),
        ("pipfile", "Python"),
        ("go.mod", "Go"),
        ("gemfile", "Ruby"),
        ("pom.xml", "Java (Maven)"),
        ("build.gradle", "Java (Gradle)"),
        ("dockerfile", "Docker"),
        ("docker-compose.yml", "Docker Compose"),
        ("wrangler.toml", "Cloudflare Workers"),
        ("cname", "GitHub Pages"),
        ("vite.config.ts", "Vite"),
        ("vite.config.js", "Vite"),
        ("next.config.js", "Next.js"),
        ("next.config.mjs", "Next.js"),
        ("tailwind.config.js", "Tailwind CSS"),
        ("tailwind.config.ts", "Tailwind CSS"),
    ];
    for (f, tech) in by_file {
        if has(&files, f) {
            stack.insert(tech.to_string());
        }
    }
    if has(&files, "index.html") && !has(&files, "package.json") {
        stack.insert("Static HTML site".to_string());
    }
    let by_text = [
        ("\"react\"", "React", false),
        ("\"vue\"", "Vue", false),
        ("\"svelte\"", "Svelte", false),
        ("\"express\"", "Express", false),
        ("@tauri-apps", "Tauri", false),
        ("tauri", "Tauri", false),
        ("fastapi", "FastAPI", false),
        ("flask", "Flask", false),
        ("django", "Django", false),
        ("streamlit", "Streamlit", false),
        ("anthropic", "Anthropic SDK", true),
        ("openai", "OpenAI SDK", true),
        ("crewai", "CrewAI", true),
        ("langchain", "LangChain", true),
        ("langgraph", "LangGraph", true),
        ("llama-index", "LlamaIndex", true),
        ("llama_index", "LlamaIndex", true),
        ("n8n", "n8n", true),
        ("splunk", "Splunk SDK", false),
        ("shopify", "Shopify API", false),
    ];
    for (_, ex) in manifests {
        let lower = ex.text.to_lowercase();
        for (needle, tech, agent) in by_text {
            if lower.contains(needle) {
                if agent {
                    agents.insert(tech.to_string());
                } else {
                    stack.insert(tech.to_string());
                }
            }
        }
    }
    (stack.into_iter().collect(), agents.into_iter().collect())
}

fn parse_time(t: &Option<String>) -> Option<DateTime<Utc>> {
    t.as_deref()
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .map(|t| t.with_timezone(&Utc))
}

fn alerts(v: &Value, code_scanning: bool) -> AlertsFact {
    let list = v.as_array().cloned().unwrap_or_default();
    let mut by_severity = BTreeMap::new();
    let mut top = Vec::new();
    for a in &list {
        let (severity, subject, summary) = if code_scanning {
            let rule = a.get("rule").cloned().unwrap_or(Value::Null);
            (
                s(&rule, "security_severity_level")
                    .or_else(|| s(&rule, "severity"))
                    .unwrap_or_else(|| "unknown".into()),
                a.pointer("/most_recent_instance/location/path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                s(&rule, "description").unwrap_or_default(),
            )
        } else {
            (
                a.pointer("/security_vulnerability/severity")
                    .or_else(|| a.pointer("/security_advisory/severity"))
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string(),
                a.pointer("/dependency/package/name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                a.pointer("/security_advisory/summary")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            )
        };
        *by_severity.entry(severity.clone()).or_insert(0) += 1;
        if top.len() < 10 {
            top.push(AlertFact {
                number: a.get("number").and_then(Value::as_u64).unwrap_or(0),
                severity,
                subject: one_line(&subject, 120),
                summary: one_line(&summary, 200),
                url: s(a, "html_url"),
            });
        }
    }
    AlertsFact {
        open: list.len() as u32,
        by_severity,
        top,
    }
}

fn items(v: &Value, max: usize, skip_prs: bool) -> Vec<ItemFact> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter(|i| !skip_prs || i.get("pull_request").is_none())
                .take(max)
                .map(|i| ItemFact {
                    number: i.get("number").and_then(Value::as_u64).unwrap_or(0),
                    title: one_line(&s(i, "title").unwrap_or_default(), 160),
                    labels: i
                        .get("labels")
                        .and_then(Value::as_array)
                        .map(|ls| ls.iter().filter_map(|l| s(l, "name")).take(5).collect())
                        .unwrap_or_default(),
                    created_at: s(i, "created_at"),
                    url: s(i, "html_url"),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The latest run of each workflow, preferring the default branch.
pub fn ci_from_runs(runs: &[Value], branch: &str) -> CiFact {
    let on_branch: Vec<&Value> = runs
        .iter()
        .filter(|r| r.get("head_branch").and_then(Value::as_str) == Some(branch))
        .collect();
    let (pool, note) = if on_branch.is_empty() && !runs.is_empty() {
        (
            runs.iter().collect::<Vec<_>>(),
            Some(format!(
                "No recent runs on {branch}; showing other branches."
            )),
        )
    } else {
        (on_branch, None)
    };
    let mut seen = BTreeSet::new();
    let mut workflows = Vec::new();
    for r in pool {
        let name = s(r, "name").unwrap_or_else(|| "workflow".into());
        let key = r
            .get("workflow_id")
            .and_then(Value::as_u64)
            .map(|i| i.to_string())
            .unwrap_or_else(|| name.clone());
        if !seen.insert(key) {
            continue;
        }
        workflows.push(WorkflowFact {
            run_id: r.get("id").and_then(Value::as_u64).unwrap_or(0),
            name: one_line(&name, 100),
            status: s(r, "status").unwrap_or_default(),
            conclusion: s(r, "conclusion"),
            branch: s(r, "head_branch").unwrap_or_default(),
            at: s(r, "created_at"),
            url: s(r, "html_url"),
        });
    }
    let failing = |w: &WorkflowFact| {
        matches!(
            w.conclusion.as_deref(),
            Some("failure" | "timed_out" | "startup_failure")
        )
    };
    let state = if workflows.is_empty() {
        CiState::NoRuns
    } else if workflows.iter().any(failing) {
        CiState::Failing
    } else if workflows.iter().all(|w| w.status != "completed") {
        CiState::Running
    } else {
        CiState::Passing
    };
    CiFact {
        state,
        workflows,
        note,
    }
}

/// Collects one repository. Fails only when the repository itself can't be read or a
/// limit stops collection; sections GitHub refuses are recorded as not assessed.
pub async fn collect(
    gh: &dyn GithubApi,
    repo: &str,
    limits: &DepthLimits,
    now: DateTime<Utc>,
) -> Result<Collected, CollectError> {
    if !valid_repo(repo) {
        return Err(CollectError::InvalidRepo);
    }
    let authed = gh.has_token().await;
    let mut sx = Session { gh, requests: 0 };
    let base = format!("/repos/{repo}");
    let meta = match sx.fetch(&base).await? {
        Fetched::Ok(v) => v,
        Fetched::Unavailable(401, _) => return Err(CollectError::Auth),
        Fetched::Unavailable(403 | 404 | 451, _) => return Err(CollectError::NotFound),
        Fetched::Unavailable(status, message) => {
            return Err(CollectError::Github { status, message })
        }
    };
    let mut notes = Vec::new();
    let branch = s(&meta, "default_branch").unwrap_or_else(|| "main".into());
    let empty = meta.get("size").and_then(Value::as_u64) == Some(0);

    let languages = match sx.optional(&format!("{base}/languages")).await? {
        Ok(v) => {
            let map = v.as_object().cloned().unwrap_or_default();
            let total: f64 = map.values().filter_map(Value::as_f64).sum();
            let mut l: Vec<LangShare> = map
                .iter()
                .filter_map(|(k, v)| {
                    v.as_f64().map(|b| LangShare {
                        name: k.clone(),
                        percent: if total > 0.0 {
                            (b / total * 1000.0).round() / 10.0
                        } else {
                            0.0
                        },
                    })
                })
                .collect();
            l.sort_by(|a, b| b.percent.total_cmp(&a.percent));
            l.truncate(8);
            l
        }
        Err(_) => vec![],
    };

    let mut activity = Activity::default();
    let mut head_sha = None;
    if !empty {
        match sx
            .optional(&format!(
                "{base}/commits?per_page={}&sha={}",
                limits.commits,
                enc(&branch)
            ))
            .await?
        {
            Ok(v) => {
                let cs = v.as_array().cloned().unwrap_or_default();
                head_sha = cs.first().and_then(|c| s(c, "sha"));
                let cutoff = now - ChronoDuration::days(30);
                let mut authors = BTreeSet::new();
                for c in &cs {
                    let date = c
                        .pointer("/commit/author/date")
                        .or_else(|| c.pointer("/commit/committer/date"))
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    let author = c
                        .pointer("/author/login")
                        .or_else(|| c.pointer("/commit/author/name"))
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string();
                    if parse_time(&date).is_some_and(|d| d >= cutoff) {
                        activity.commits_last_30d += 1;
                    }
                    authors.insert(author.clone());
                    activity.recent.push(CommitFact {
                        sha: s(c, "sha").unwrap_or_default(),
                        message: one_line(
                            c.pointer("/commit/message")
                                .and_then(Value::as_str)
                                .unwrap_or(""),
                            160,
                        ),
                        author,
                        date,
                        url: s(c, "html_url"),
                    });
                }
                activity.commits_sampled = cs.len() as u32;
                activity.last_commit_at = activity.recent.first().and_then(|c| c.date.clone());
                activity.authors = authors.into_iter().take(10).collect();
            }
            Err(r) => notes.push(format!("Commits: {r}")),
        }
    }
    if let Ok(v) = sx
        .optional(&format!("{base}/branches?per_page=100"))
        .await?
    {
        activity.branches = v.as_array().map(|a| a.len() as u32);
    }
    if let Ok(v) = sx
        .optional(&format!("{base}/pulls?state=open&per_page=30"))
        .await?
    {
        activity.open_prs = v.as_array().map(|a| a.len() as u32);
        activity.pr_titles = items(&v, 10, false);
    }

    let issues = match sx
        .optional(&format!(
            "{base}/issues?state=open&per_page={}",
            limits.issues
        ))
        .await?
    {
        Ok(v) => {
            let listed = items(&v, limits.issues as usize, true);
            // open_issues_count includes pull requests.
            let total = meta
                .get("open_issues_count")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let open = total
                .saturating_sub(activity.open_prs.unwrap_or(0))
                .max(listed.len() as u32);
            Assessed::Assessed {
                data: IssuesFact {
                    open,
                    recent: listed,
                },
            }
        }
        Err(r) => Assessed::NotAssessed { reason: r },
    };

    let releases = match sx.optional(&format!("{base}/releases?per_page=5")).await? {
        Ok(v) => Assessed::Assessed {
            data: v
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|r| ReleaseFact {
                            tag: one_line(&s(r, "tag_name").unwrap_or_default(), 60),
                            name: s(r, "name").map(|n| one_line(&n, 120)),
                            published_at: s(r, "published_at"),
                            url: s(r, "html_url"),
                        })
                        .collect()
                })
                .unwrap_or_default(),
        },
        Err(r) => Assessed::NotAssessed { reason: r },
    };

    let ci = match sx
        .optional(&format!("{base}/actions/runs?per_page=30"))
        .await?
    {
        Ok(v) => ci_from_runs(
            v.get("workflow_runs")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            &branch,
        ),
        Err(r) => CiFact {
            state: CiState::NotAssessed,
            workflows: vec![],
            note: Some(r),
        },
    };

    let mut root_files = Vec::new();
    let mut dirs = BTreeSet::new();
    if !empty {
        match sx.optional(&format!("{base}/contents")).await? {
            Ok(v) => {
                for f in v.as_array().cloned().unwrap_or_default() {
                    let name = s(&f, "name").unwrap_or_default();
                    if s(&f, "type").as_deref() == Some("dir") {
                        dirs.insert(name.to_lowercase());
                        root_files.push(format!("{name}/"));
                    } else {
                        root_files.push(name);
                    }
                }
                root_files.truncate(80);
            }
            Err(r) => notes.push(format!("File listing: {r}")),
        }
    }
    let lower: BTreeSet<String> = root_files.iter().map(|f| f.to_lowercase()).collect();
    let starts = |p: &str| lower.iter().any(|f| f.starts_with(p));

    let mut readme = None;
    if !empty {
        match sx.optional(&format!("{base}/readme")).await? {
            Ok(v) => readme = decode_content(&v).map(|t| excerpt(&t, limits.readme_chars)),
            Err(_) => notes.push("No README found.".into()),
        }
    }

    let mut manifests = Vec::new();
    for name in MANIFESTS
        .iter()
        .filter(|m| lower.contains(&m.to_lowercase()))
        .take(limits.manifests)
    {
        if let Ok(v) = sx.optional(&format!("{base}/contents/{name}")).await? {
            if let Some(t) = decode_content(&v) {
                manifests.push((name.to_string(), excerpt(&t, limits.manifest_chars)));
            }
        }
    }

    let security = if authed {
        let dependabot = match sx
            .optional(&format!("{base}/dependabot/alerts?state=open&per_page=50"))
            .await?
        {
            Ok(v) => Assessed::Assessed {
                data: alerts(&v, false),
            },
            Err(r) => Assessed::NotAssessed { reason: r },
        };
        let code_scanning = match sx
            .optional(&format!(
                "{base}/code-scanning/alerts?state=open&per_page=50"
            ))
            .await?
        {
            Ok(v) => Assessed::Assessed {
                data: alerts(&v, true),
            },
            Err(r) => Assessed::NotAssessed { reason: r },
        };
        SecurityFact {
            dependabot,
            code_scanning,
        }
    } else {
        let reason = "Needs a GitHub token with read access to security alerts.".to_string();
        SecurityFact {
            dependabot: Assessed::NotAssessed {
                reason: reason.clone(),
            },
            code_scanning: Assessed::NotAssessed { reason },
        }
    };

    let (stack, agent_signals) = detect_stack(&root_files, &manifests);
    let docs = DocsFact {
        readme: readme.is_some(),
        readme_chars: readme.as_ref().map(|r| r.total_chars as u32).unwrap_or(0),
        license: meta
            .pointer("/license/spdx_id")
            .and_then(Value::as_str)
            .filter(|l| *l != "NOASSERTION")
            .map(str::to_owned)
            .or_else(|| {
                meta.pointer("/license/name")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }),
        contributing: starts("contributing"),
        changelog: starts("changelog") || starts("changes"),
        docs_dir: dirs.contains("docs"),
        security_policy: starts("security.md"),
    };

    let facts = Facts {
        full_name: s(&meta, "full_name").unwrap_or_else(|| repo.to_string()),
        url: s(&meta, "html_url").unwrap_or_else(|| format!("https://github.com/{repo}")),
        description: s(&meta, "description").map(|d| one_line(&d, 300)),
        homepage: s(&meta, "homepage").filter(|h| !h.is_empty()),
        visibility: s(&meta, "visibility").unwrap_or_else(|| {
            if meta.get("private").and_then(Value::as_bool) == Some(true) {
                "private".into()
            } else {
                "public".into()
            }
        }),
        default_branch: branch,
        archived: meta
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        fork: meta.get("fork").and_then(Value::as_bool).unwrap_or(false),
        empty: empty || (activity.commits_sampled == 0 && head_sha.is_none()),
        head_sha,
        created_at: s(&meta, "created_at"),
        pushed_at: s(&meta, "pushed_at"),
        languages,
        stack,
        agent_signals,
        root_files,
        activity,
        releases,
        issues,
        ci,
        docs,
        security,
        collected_at: now.to_rfc3339(),
        github_requests: sx.requests,
    };
    Ok(Collected {
        facts,
        readme,
        manifests,
        notes,
    })
}

/// Findings that code can state as fact. Claude's assessment is reported separately.
pub fn findings(f: &Facts, now: DateTime<Utc>) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut add = |id: String,
                   category: &str,
                   severity: Severity,
                   title: String,
                   detail: String,
                   url: Option<String>| {
        out.push(Finding {
            id,
            category: category.into(),
            severity,
            title,
            detail,
            url,
        })
    };
    if f.archived {
        add(
            "repo:archived".into(),
            "maintenance",
            Severity::Info,
            "Repository is archived".into(),
            "GitHub marks it read-only.".into(),
            Some(f.url.clone()),
        );
    }
    if f.empty {
        add(
            "repo:empty".into(),
            "activity",
            Severity::Info,
            "Repository has no commits".into(),
            "There is nothing to analyze yet.".into(),
            Some(f.url.clone()),
        );
    }
    for w in &f.ci.workflows {
        if matches!(
            w.conclusion.as_deref(),
            Some("failure" | "timed_out" | "startup_failure")
        ) {
            add(
                format!("ci:{}", w.run_id),
                "ci",
                Severity::High,
                format!("CI failing: {}", w.name),
                format!(
                    "Latest run on {} ended with {}{}.",
                    w.branch,
                    w.conclusion.as_deref().unwrap_or("failure"),
                    w.at.as_deref()
                        .map(|t| format!(" ({})", &t[..t.len().min(10)]))
                        .unwrap_or_default()
                ),
                w.url.clone(),
            );
        }
    }
    for (label, sec) in [
        ("Dependabot", &f.security.dependabot),
        ("Code scanning", &f.security.code_scanning),
    ] {
        if let Assessed::Assessed { data } = sec {
            for a in &data.top {
                let sev = match a.severity.to_lowercase().as_str() {
                    "critical" => Severity::Critical,
                    "high" | "error" => Severity::High,
                    "medium" | "moderate" | "warning" => Severity::Medium,
                    "low" | "note" => Severity::Low,
                    _ => Severity::Medium,
                };
                add(
                    format!(
                        "alert:{}:{}",
                        label.to_lowercase().replace(' ', "_"),
                        a.number
                    ),
                    "security",
                    sev,
                    format!(
                        "{label} alert #{}: {}",
                        a.number,
                        if a.subject.is_empty() {
                            &a.summary
                        } else {
                            &a.subject
                        }
                    ),
                    a.summary.clone(),
                    a.url.clone(),
                );
            }
            if data.open as usize > data.top.len() {
                add(
                    format!("alert:{}:more", label.to_lowercase().replace(' ', "_")),
                    "security",
                    Severity::Info,
                    format!(
                        "{} more open {label} alerts",
                        data.open as usize - data.top.len()
                    ),
                    "Open GitHub to see all of them.".into(),
                    Some(format!("{}/security", f.url)),
                );
            }
        }
    }
    if !f.empty && !f.docs.readme {
        add(
            "docs:readme".into(),
            "documentation",
            Severity::Medium,
            "No README".into(),
            "GitHub found no README in the repository.".into(),
            None,
        );
    } else if f.docs.readme && f.docs.readme_chars < 300 {
        add(
            "docs:readme_short".into(),
            "documentation",
            Severity::Low,
            "README is very short".into(),
            format!("{} characters.", f.docs.readme_chars),
            None,
        );
    }
    if !f.empty && f.docs.license.is_none() {
        add(
            "docs:license".into(),
            "documentation",
            Severity::Low,
            "No license detected".into(),
            "GitHub found no license file.".into(),
            None,
        );
    }
    if let Some(last) = parse_time(&f.activity.last_commit_at) {
        let days = (now - last).num_days();
        if days >= 180 && !f.archived {
            add(
                "activity:stale".into(),
                "activity",
                Severity::Low,
                format!("No commits in {days} days"),
                format!(
                    "Last commit on the default branch was {}.",
                    last.format("%Y-%m-%d")
                ),
                None,
            );
        }
    }
    out.sort_by_key(|f| std::cmp::Reverse(f.severity));
    out
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// A scripted GitHub. Unknown paths answer 404. Records every path asked for.
    pub struct FakeGithub {
        pub routes: HashMap<String, (u16, Value)>,
        pub calls: Mutex<Vec<String>>,
        pub token: bool,
        pub rate_remaining: Option<u32>,
    }

    impl FakeGithub {
        pub fn new() -> Self {
            Self {
                routes: HashMap::new(),
                calls: Mutex::new(vec![]),
                token: true,
                rate_remaining: Some(4000),
            }
        }
        pub fn route(mut self, path: &str, status: u16, body: Value) -> Self {
            self.routes.insert(path.to_string(), (status, body));
            self
        }
        /// A small but complete public repository.
        pub fn healthy(repo: &str) -> Self {
            let b = format!("/repos/{repo}");
            let readme = base64::engine::general_purpose::STANDARD.encode("# Demo\nA demo repository used in tests. It renders a dashboard of things and has enough words to not count as a short readme. ".repeat(4));
            let pkg = base64::engine::general_purpose::STANDARD
                .encode(r#"{"dependencies":{"react":"18","@anthropic-ai/sdk":"1"}}"#);
            Self::new()
                .route(&b, 200, json!({"full_name": repo, "html_url": format!("https://github.com/{repo}"), "description": "Demo", "default_branch": "main", "visibility": "public", "size": 10, "open_issues_count": 3, "license": {"spdx_id": "MIT"}, "pushed_at": "2026-10-20T00:00:00Z"}))
                .route(&format!("{b}/languages"), 200, json!({"TypeScript": 900, "CSS": 100}))
                .route(&format!("{b}/commits?per_page=20&sha=main"), 200, json!([
                    {"sha": "abc1234def", "commit": {"message": "Add feature\n\nbody", "author": {"name": "KC", "date": "2026-10-20T00:00:00Z"}}, "author": {"login": "kc"}, "html_url": "https://github.com/x/c/abc"},
                    {"sha": "0001111222", "commit": {"message": "Initial", "author": {"name": "KC", "date": "2026-01-01T00:00:00Z"}}, "author": {"login": "kc"}}
                ]))
                .route(&format!("{b}/branches?per_page=100"), 200, json!([{"name": "main"}, {"name": "dev"}]))
                .route(&format!("{b}/pulls?state=open&per_page=30"), 200, json!([{"number": 7, "title": "WIP"}]))
                .route(&format!("{b}/issues?state=open&per_page=20"), 200, json!([{"number": 5, "title": "Bug in map", "labels": [{"name": "bug"}]}, {"number": 7, "title": "WIP", "pull_request": {}}]))
                .route(&format!("{b}/releases?per_page=5"), 200, json!([{"tag_name": "v1.0.0", "published_at": "2026-09-01T00:00:00Z"}]))
                .route(&format!("{b}/actions/runs?per_page=30"), 200, json!({"workflow_runs": [
                    {"id": 900, "workflow_id": 1, "name": "CI", "status": "completed", "conclusion": "failure", "head_branch": "main", "created_at": "2026-10-20T00:00:00Z", "html_url": "https://github.com/x/r/900"},
                    {"id": 800, "workflow_id": 1, "name": "CI", "status": "completed", "conclusion": "success", "head_branch": "main"},
                    {"id": 850, "workflow_id": 2, "name": "Pages", "status": "completed", "conclusion": "success", "head_branch": "main"}
                ]}))
                .route(&format!("{b}/contents"), 200, json!([{"name": "README.md", "type": "file"}, {"name": "package.json", "type": "file"}, {"name": "src", "type": "dir"}]))
                .route(&format!("{b}/readme"), 200, json!({"content": readme}))
                .route(&format!("{b}/contents/package.json"), 200, json!({"content": pkg}))
                .route(&format!("{b}/dependabot/alerts?state=open&per_page=50"), 200, json!([
                    {"number": 3, "security_vulnerability": {"severity": "high"}, "dependency": {"package": {"name": "lodash"}}, "security_advisory": {"summary": "Prototype pollution"}, "html_url": "https://github.com/x/r/security/3"}
                ]))
                .route(&format!("{b}/code-scanning/alerts?state=open&per_page=50"), 403, json!({"message": "Resource not accessible by personal access token"}))
        }
        pub fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl GithubApi for FakeGithub {
        async fn get(&self, path: &str) -> Result<GhResponse, String> {
            self.calls.lock().unwrap().push(path.to_string());
            // Mirror the production guard so tests fail if the agent builds a path it would block.
            assert!(
                crate::github::allowed_path(path),
                "agent built a disallowed path: {path}"
            );
            let (status, body) = self
                .routes
                .get(path)
                .cloned()
                .unwrap_or((404, json!({"message": "Not Found"})));
            Ok(GhResponse {
                status,
                body,
                rate_remaining: self.rate_remaining,
                rate_reset: Some(1_800_000_000),
            })
        }
        async fn has_token(&self) -> bool {
            self.token
        }
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-27T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn repo_names() {
        assert!(valid_repo("khaneilcampbell/khaneilcampbell.com"));
        assert!(valid_repo("a-b/c_d.e"));
        assert!(!valid_repo("a/b/c"));
        assert!(!valid_repo("a/.."));
        assert!(!valid_repo("../x"));
        assert!(!valid_repo("a/b?x=1"));
        assert!(!valid_repo("a/b%2F..%2Fuser"));
        assert!(!valid_repo("/b"));
    }

    #[tokio::test]
    async fn collects_facts_without_guessing() {
        let gh = FakeGithub::healthy("o/r");
        let c = collect(&gh, "o/r", &Depth::Standard.limits(), now())
            .await
            .unwrap();
        let f = &c.facts;
        assert_eq!(f.head_sha.as_deref(), Some("abc1234def"));
        assert_eq!(f.activity.commits_last_30d, 1);
        assert_eq!(f.activity.branches, Some(2));
        assert_eq!(f.ci.state, CiState::Failing);
        assert_eq!(f.ci.workflows.len(), 2, "one entry per workflow");
        match &f.issues {
            Assessed::Assessed { data } => {
                assert_eq!(data.recent.len(), 1, "pull requests aren't issues");
                assert_eq!(data.open, 2);
            }
            _ => panic!("issues should be assessed"),
        }
        assert!(f.stack.contains(&"React".to_string()));
        assert!(f.agent_signals.contains(&"Anthropic SDK".to_string()));
        assert!(matches!(
            f.security.code_scanning,
            Assessed::NotAssessed { .. }
        ));
        assert!(matches!(&f.security.dependabot, Assessed::Assessed { data } if data.open == 1));
        assert_eq!(f.github_requests as usize, gh.calls().len());
        let fs = findings(f, now());
        assert!(fs.iter().any(|x| x.id == "ci:900"));
        assert!(fs
            .iter()
            .any(|x| x.id == "alert:dependabot:3" && x.severity == Severity::High));
    }

    #[tokio::test]
    async fn only_reads_the_selected_repository() {
        let gh = FakeGithub::healthy("o/r");
        collect(&gh, "o/r", &Depth::Deep.limits(), now()).await.ok();
        for p in gh.calls() {
            assert!(
                p == "/repos/o/r" || p.starts_with("/repos/o/r/"),
                "unexpected path {p}"
            );
        }
    }

    #[tokio::test]
    async fn auth_failure_is_reported() {
        let gh = FakeGithub::new().route("/repos/o/r", 401, json!({"message": "Bad credentials"}));
        assert_eq!(
            collect(&gh, "o/r", &Depth::Quick.limits(), now())
                .await
                .err(),
            Some(CollectError::Auth)
        );
    }

    #[tokio::test]
    async fn missing_repository_is_reported() {
        let gh = FakeGithub::new();
        assert_eq!(
            collect(&gh, "o/missing", &Depth::Quick.limits(), now())
                .await
                .err(),
            Some(CollectError::NotFound)
        );
    }

    #[tokio::test]
    async fn rate_limit_stops_collection() {
        let mut gh = FakeGithub::new().route(
            "/repos/o/r",
            403,
            json!({"message": "API rate limit exceeded"}),
        );
        gh.rate_remaining = Some(0);
        let e = collect(&gh, "o/r", &Depth::Quick.limits(), now())
            .await
            .err()
            .unwrap();
        assert!(matches!(e, CollectError::RateLimited { reset: Some(_) }));
        assert!(e.to_run_error().message.contains("resets"));
        assert_eq!(gh.calls().len(), 1, "no further requests after the limit");
    }

    #[tokio::test]
    async fn invalid_names_make_no_requests() {
        let gh = FakeGithub::new();
        assert_eq!(
            collect(&gh, "o/../user", &Depth::Quick.limits(), now())
                .await
                .err(),
            Some(CollectError::InvalidRepo)
        );
        assert!(gh.calls().is_empty());
    }

    #[tokio::test]
    async fn empty_repository() {
        let gh = FakeGithub::new()
            .route("/repos/o/e", 200, json!({"full_name": "o/e", "default_branch": "main", "size": 0, "open_issues_count": 0}))
            .route("/repos/o/e/issues?state=open&per_page=10", 200, json!([]))
            .route("/repos/o/e/actions/runs?per_page=30", 200, json!({"workflow_runs": []}));
        let c = collect(&gh, "o/e", &Depth::Quick.limits(), now())
            .await
            .unwrap();
        assert!(c.facts.empty);
        assert!(c.readme.is_none());
        assert_eq!(c.facts.ci.state, CiState::NoRuns);
        assert!(
            !gh.calls()
                .iter()
                .any(|p| p.contains("/commits") || p.contains("/readme")),
            "empty repos skip content requests"
        );
        assert!(findings(&c.facts, now())
            .iter()
            .any(|f| f.id == "repo:empty"));
    }

    #[tokio::test]
    async fn security_alerts_need_a_token() {
        let mut gh = FakeGithub::healthy("o/r");
        gh.token = false;
        let c = collect(&gh, "o/r", &Depth::Standard.limits(), now())
            .await
            .unwrap();
        assert!(matches!(
            c.facts.security.dependabot,
            Assessed::NotAssessed { .. }
        ));
        assert!(!gh.calls().iter().any(|p| p.contains("alerts")));
    }

    #[test]
    fn ci_states() {
        assert_eq!(ci_from_runs(&[], "main").state, CiState::NoRuns);
        let ok = [
            json!({"id": 1, "name": "CI", "status": "completed", "conclusion": "success", "head_branch": "main"}),
        ];
        assert_eq!(ci_from_runs(&ok, "main").state, CiState::Passing);
        let running = [
            json!({"id": 1, "name": "CI", "status": "in_progress", "conclusion": null, "head_branch": "main"}),
        ];
        assert_eq!(ci_from_runs(&running, "main").state, CiState::Running);
        let other = ci_from_runs(&ok, "trunk");
        assert!(other.note.is_some());
    }
}
