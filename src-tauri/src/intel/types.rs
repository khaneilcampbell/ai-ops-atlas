//! Data shapes shared by the intelligence agent's modules and sent to the web view.
//! Deterministic facts (`Facts`, `Finding`) and Claude's assessment (`AiAnalysis`) are kept
//! in separate types so the interface can never mix verified data with model output.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const AGENT_ID: &str = "repo-intelligence";
pub const AGENT_NAME: &str = "Repository Intelligence Agent";
pub const AGENT_VERSION: &str = "1.0.0";
/// Bumped whenever the system prompt or output schema changes, which invalidates cached analyses.
pub const PROMPT_VERSION: &str = "2026-10-27.1";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "snake_case")]
pub enum Depth {
    Quick,
    #[default]
    Standard,
    Deep,
}

/// How much is collected and how much Claude may spend, per depth.
#[derive(Clone, Copy, Debug)]
pub struct DepthLimits {
    /// Ceiling on the estimated prompt size; larger data is trimmed to fit.
    pub input_tokens: u32,
    pub max_tokens: u32,
    pub effort: &'static str,
    pub readme_chars: usize,
    pub manifest_chars: usize,
    pub manifests: usize,
    pub commits: u32,
    pub issues: u32,
}

impl Depth {
    pub fn limits(self) -> DepthLimits {
        match self {
            Depth::Quick => DepthLimits {
                input_tokens: 6_000,
                max_tokens: 4_000,
                effort: "low",
                readme_chars: 3_000,
                manifest_chars: 2_000,
                manifests: 2,
                commits: 10,
                issues: 10,
            },
            Depth::Standard => DepthLimits {
                input_tokens: 12_000,
                max_tokens: 8_000,
                effort: "low",
                readme_chars: 6_000,
                manifest_chars: 3_000,
                manifests: 4,
                commits: 20,
                issues: 20,
            },
            Depth::Deep => DepthLimits {
                input_tokens: 24_000,
                max_tokens: 12_000,
                effort: "medium",
                readme_chars: 12_000,
                manifest_chars: 6_000,
                manifests: 6,
                commits: 30,
                issues: 30,
            },
        }
    }
}

/// US dollars per million tokens.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    /// Cache reads; defaults to 10% of input when not set.
    #[serde(default)]
    pub cache_read: Option<f64>,
    /// Cache writes; defaults to 125% of input when not set.
    #[serde(default)]
    pub cache_write: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Models {
    pub quick: String,
    pub standard: String,
    pub deep: String,
}

impl Models {
    pub fn for_depth(&self, d: Depth) -> &str {
        match d {
            Depth::Quick => &self.quick,
            Depth::Standard => &self.standard,
            Depth::Deep => &self.deep,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Schedule {
    pub enabled: bool,
    /// Days to run on, 0 = Monday to 6 = Sunday, in the Mac's local time.
    pub days: Vec<u8>,
    /// Local time of day to run, "HH:MM".
    pub at: String,
    /// When the user confirmed unattended runs. Enabling without consent is refused.
    pub consent_at: Option<String>,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            enabled: false,
            days: vec![0, 2, 4],
            at: "08:00".into(),
            consent_at: None,
        }
    }
}

impl Schedule {
    pub fn time_of_day(&self) -> Option<chrono::NaiveTime> {
        chrono::NaiveTime::parse_from_str(&self.at, "%H:%M").ok()
    }

    /// The most recent scheduled moment at or before `now`, in `now`'s time zone.
    pub fn latest_slot<Tz: chrono::TimeZone>(
        &self,
        now: &chrono::DateTime<Tz>,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        use chrono::Datelike;
        let at = self.time_of_day()?;
        let today = now.date_naive();
        (0..8i64).find_map(|back| {
            let day = today - chrono::Duration::days(back);
            if !self
                .days
                .contains(&(day.weekday().num_days_from_monday() as u8))
            {
                return None;
            }
            let slot = day
                .and_time(at)
                .and_local_timezone(now.timezone())
                .earliest()?;
            (slot <= *now).then(|| slot.with_timezone(&chrono::Utc))
        })
    }
}

/// Everything about the agent that can change without a code change. Saved as JSON in the
/// app's data folder and edited from Settings.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct AgentConfig {
    pub depth: Depth,
    pub models: Models,
    pub pricing: BTreeMap<String, Price>,
    pub max_run_usd: f64,
    pub monthly_budget_usd: f64,
    pub timeout_secs: u64,
    /// Total tries for one Claude request, including the first.
    pub max_attempts: u32,
    /// Send `fallbacks: "default"` so a safety decline is retried on another model server-side.
    pub refusal_fallback: bool,
    pub schedule: Schedule,
    /// Repositories the agent may analyze. Only these are ever scheduled.
    pub assigned: Vec<String>,
    /// The Senior Engineering Reviewer, which shares models, prices and the monthly budget.
    pub review: ReviewConfig,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct ReviewConfig {
    pub depth: Depth,
    /// Its own per-run cap: a review covers every repository, so it is larger than one analysis.
    pub max_run_usd: f64,
    pub schedule: Schedule,
}

impl Default for ReviewConfig {
    fn default() -> Self {
        Self {
            depth: Depth::Standard,
            max_run_usd: 0.60,
            // Weekly, Monday 08:00, off until KC turns it on.
            schedule: Schedule {
                days: vec![0],
                ..Schedule::default()
            },
        }
    }
}

impl Default for AgentConfig {
    fn default() -> Self {
        // Anthropic list prices, checked 2026-10-06. Editable in Settings.
        let p = |input: f64, output: f64, cache_read: f64| Price {
            input,
            output,
            cache_read: Some(cache_read),
            cache_write: None,
        };
        let pricing = BTreeMap::from([
            ("claude-haiku-5-5".to_string(), p(0.10, 0.50, 0.01)),
            ("claude-sonnet-5-5".to_string(), p(2.00, 10.00, 0.20)),
            ("claude-opus-5-5".to_string(), p(4.00, 20.00, 0.20)),
            ("claude-fable-5-1".to_string(), p(10.00, 50.00, 0.25)),
            // Fallback targets the server may route a declined request to.
            ("claude-opus-4-8".to_string(), p(5.00, 25.00, 0.50)),
            ("claude-opus-5".to_string(), p(5.00, 25.00, 0.50)),
        ]);
        Self {
            depth: Depth::Standard,
            models: Models {
                quick: "claude-haiku-5-5".into(),
                standard: "claude-sonnet-5-5".into(),
                deep: "claude-opus-5-5".into(),
            },
            pricing,
            max_run_usd: 0.40,
            monthly_budget_usd: 5.00,
            timeout_secs: 120,
            max_attempts: 3,
            refusal_fallback: true,
            schedule: Schedule::default(),
            assigned: Vec::new(),
            review: ReviewConfig::default(),
        }
    }
}

// ---------- Deterministic facts ----------

/// A section GitHub may refuse (no permission, feature disabled). Never guessed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Assessed<T> {
    Assessed { data: T },
    NotAssessed { reason: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LangShare {
    pub name: String,
    pub percent: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CommitFact {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub date: Option<String>,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Activity {
    pub commits_sampled: u32,
    pub commits_last_30d: u32,
    pub last_commit_at: Option<String>,
    pub authors: Vec<String>,
    pub recent: Vec<CommitFact>,
    /// None when GitHub didn't answer; capped at 100 (the page size).
    pub branches: Option<u32>,
    pub open_prs: Option<u32>,
    pub pr_titles: Vec<ItemFact>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ItemFact {
    pub number: u64,
    pub title: String,
    pub labels: Vec<String>,
    pub created_at: Option<String>,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct IssuesFact {
    pub open: u32,
    pub recent: Vec<ItemFact>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ReleaseFact {
    pub tag: String,
    pub name: Option<String>,
    pub published_at: Option<String>,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CiState {
    Passing,
    Failing,
    Running,
    NoRuns,
    NotAssessed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WorkflowFact {
    pub run_id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub branch: String,
    pub at: Option<String>,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CiFact {
    pub state: CiState,
    /// Latest run of each workflow, on the default branch when it has any.
    pub workflows: Vec<WorkflowFact>,
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct DocsFact {
    pub readme: bool,
    pub readme_chars: u32,
    pub license: Option<String>,
    pub contributing: bool,
    pub changelog: bool,
    pub docs_dir: bool,
    pub security_policy: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AlertFact {
    pub number: u64,
    pub severity: String,
    pub subject: String,
    pub summary: String,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AlertsFact {
    pub open: u32,
    pub by_severity: BTreeMap<String, u32>,
    pub top: Vec<AlertFact>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SecurityFact {
    pub dependabot: Assessed<AlertsFact>,
    pub code_scanning: Assessed<AlertsFact>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Facts {
    pub full_name: String,
    pub url: String,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub visibility: String,
    pub default_branch: String,
    pub archived: bool,
    pub fork: bool,
    pub empty: bool,
    pub head_sha: Option<String>,
    pub created_at: Option<String>,
    pub pushed_at: Option<String>,
    pub languages: Vec<LangShare>,
    /// Technologies detected from file names and manifest contents, not by the model.
    pub stack: Vec<String>,
    /// AI and agent SDKs or platforms found in manifests.
    pub agent_signals: Vec<String>,
    pub root_files: Vec<String>,
    pub activity: Activity,
    pub releases: Assessed<Vec<ReleaseFact>>,
    pub issues: Assessed<IssuesFact>,
    pub ci: CiFact,
    pub docs: DocsFact,
    pub security: SecurityFact,
    pub collected_at: String,
    pub github_requests: u32,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

/// A finding computed in code from GitHub data. These are the only "verified" items.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Finding {
    pub id: String,
    pub category: String,
    pub severity: Severity,
    pub title: String,
    pub detail: String,
    pub url: Option<String>,
}

// ---------- Claude's assessment (validated structured output) ----------

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Maturity {
    Prototype,
    EarlyDevelopment,
    ActiveDevelopment,
    Maintained,
    Stale,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HealthArea {
    Activity,
    Ci,
    Documentation,
    Dependencies,
    Security,
    CodeQuality,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Rating {
    Good,
    Fair,
    Poor,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    High,
    Medium,
    Low,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HealthRating {
    pub area: HealthArea,
    pub rating: Rating,
    pub rationale: String,
    pub evidence: Vec<String>,
    /// Set by validation: true when at least one cited reference exists in the data.
    #[serde(default)]
    pub grounded: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Observation {
    pub text: String,
    pub evidence: Vec<String>,
    #[serde(default)]
    pub grounded: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Recommendation {
    pub priority: Priority,
    pub title: String,
    pub rationale: String,
    pub evidence: Vec<String>,
    #[serde(default)]
    pub grounded: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AiAnalysis {
    pub summary: String,
    pub purpose: String,
    pub architecture: String,
    pub maturity: Maturity,
    pub implementation_status: String,
    pub technologies: Vec<String>,
    pub agent_integrations: Vec<String>,
    pub health: Vec<HealthRating>,
    pub maintenance_issues: Vec<Observation>,
    pub documentation_gaps: Vec<Observation>,
    pub technical_debt: Vec<Observation>,
    /// Hypotheses only. Confirmed alerts come from `Facts::security`.
    pub security_observations: Vec<Observation>,
    pub recommendations: Vec<Recommendation>,
    pub insufficient_data: bool,
    pub data_gaps: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct ValidationSummary {
    /// Evidence references the model cited that don't exist in the data it was given.
    pub dropped_refs: u32,
    pub ungrounded_items: u32,
    pub trimmed_fields: u32,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiState {
    /// Claude analyzed this exact data.
    Analyzed,
    /// Nothing relevant changed since the last analysis, so it was reused without a call.
    Reused,
    /// Too little data to analyze; no call was made.
    InsufficientData,
    /// The data changed but the latest analysis attempt didn't finish; the older analysis is shown.
    Stale,
    /// No analysis has succeeded yet; only verified facts are available.
    NotAssessed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Report {
    pub repo: String,
    pub facts: Facts,
    pub findings: Vec<Finding>,
    pub ai: Option<AiAnalysis>,
    pub ai_state: AiState,
    /// When Claude last produced the analysis shown, which may be older than the facts.
    pub analyzed_at: Option<String>,
    pub analysis_run_id: Option<String>,
    pub model: Option<String>,
    pub depth: Depth,
    pub fingerprint: String,
    pub validation: Option<ValidationSummary>,
    pub updated_at: String,
    pub run_id: String,
    #[serde(default)]
    pub context: RepoContext,
    /// Why the analysis shown isn't current, when it isn't.
    #[serde(default)]
    pub note: Option<String>,
}

// ---------- Runs ----------

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    Manual,
    Scheduled,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Running,
    Succeeded,
    Reused,
    InsufficientData,
    Blocked,
    Failed,
    Cancelled,
    Interrupted,
}

impl RunStatus {
    pub fn is_active(self) -> bool {
        matches!(self, RunStatus::Queued | RunStatus::Running)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RunError {
    pub kind: String,
    pub message: String,
    pub retryable: bool,
}

/// Token counts as reported by the Anthropic API.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
    /// The model that produced the response (differs from the request when a fallback ran).
    pub served_by: Option<String>,
    pub fallback: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CostEstimate {
    pub model: String,
    pub input_tokens_est: u32,
    pub max_output_tokens: u32,
    /// Upper bound before the call: estimated input plus the full output allowance.
    pub worst_case_usd: f64,
    pub month_spent_usd: f64,
    pub max_run_usd: f64,
    pub monthly_budget_usd: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TraceStep {
    pub at: String,
    pub step: String,
    pub ok: bool,
    pub detail: String,
    pub ms: Option<u64>,
}

/// Which pipeline a run went through. Older run records have no kind and are repository runs.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RunKind {
    #[default]
    Repository,
    Ecosystem,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Run {
    pub id: String,
    #[serde(default)]
    pub kind: RunKind,
    /// `owner/name`, or "ecosystem" for a Senior Engineering Review.
    pub repo: String,
    pub trigger: Trigger,
    pub depth: Depth,
    pub model: String,
    pub force: bool,
    pub status: RunStatus,
    pub queued_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub error: Option<RunError>,
    /// Claude requests made, including retries.
    pub attempts: u32,
    pub github_requests: u32,
    pub usage: Option<Usage>,
    pub estimate: Option<CostEstimate>,
    /// Estimated from the reported token usage and the configured prices.
    pub cost_usd: Option<f64>,
    pub trace: Vec<TraceStep>,
}

/// Catalog context the web view passes along: which Atlas project and agents use the repo.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct RepoContext {
    pub project: Option<String>,
    pub agents: Vec<String>,
}
