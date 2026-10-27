//! The job runner: one pipeline per run (collect → prompt → reuse check → budget → infer →
//! validate → save), at most one Claude request in flight, one job per repository at a
//! time, cancellation at every step, and an opt-in scheduler that only runs while the app
//! is open.

use super::claude::{self, cancelled, step, InferError, ModelApi, RetryPolicy};
use super::collect::{self, valid_repo, GithubApi};
use super::cost;
use super::prompt;
use super::store::{recover_interrupted, Store};
use super::types::*;
use super::validate;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{watch, Semaphore};

pub type Spawner = Box<dyn Fn(Pin<Box<dyn Future<Output = ()> + Send>>) + Send + Sync>;

struct Active {
    repo: String,
    run_id: String,
    cancel: watch::Sender<bool>,
}

struct Inner {
    config: AgentConfig,
    runs: Vec<Run>,
    active: Vec<Active>,
}

pub struct Agent {
    store: Store,
    gh: Arc<dyn GithubApi>,
    model: Arc<dyn ModelApi>,
    inner: Mutex<Inner>,
    /// One Claude-bound job at a time keeps spend predictable and avoids rate limits.
    permit: Semaphore,
    spawner: Spawner,
    key_present: Box<dyn Fn() -> bool + Send + Sync>,
    notify: Box<dyn Fn() + Send + Sync>,
    pub base_delay: Duration,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct EnqueueResult {
    pub run_id: String,
    /// True when the repository already had a job queued or running; no new job was made.
    pub duplicate: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct AgentStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub version: &'static str,
    pub prompt_version: &'static str,
    pub config: AgentConfig,
    pub key_present: bool,
    pub active: Vec<String>,
    /// Newest first.
    pub runs: Vec<Run>,
    pub month_spent_usd: f64,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub fn validate_config(c: &AgentConfig) -> Result<(), String> {
    let model_ok = |m: &str| {
        m.starts_with("claude-")
            && m.len() <= 64
            && m.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "-.".contains(c))
    };
    for m in [&c.models.quick, &c.models.standard, &c.models.deep] {
        if !model_ok(m) {
            return Err(format!("\"{m}\" isn't a valid Claude model id."));
        }
        if !c.pricing.contains_key(m.as_str()) {
            return Err(format!("Add a price for {m} so its cost can be estimated."));
        }
    }
    for (m, p) in &c.pricing {
        let ok = |v: f64| v.is_finite() && (0.0..=1000.0).contains(&v);
        if !model_ok(m)
            || !ok(p.input)
            || !ok(p.output)
            || !p.cache_read.map_or(true, ok)
            || !p.cache_write.map_or(true, ok)
        {
            return Err(format!("The price for {m} isn't valid."));
        }
    }
    if !(c.max_run_usd.is_finite() && c.max_run_usd > 0.0 && c.max_run_usd <= 50.0) {
        return Err("The per-run limit must be between $0 and $50.".into());
    }
    if !(c.monthly_budget_usd.is_finite() && (0.0..=1000.0).contains(&c.monthly_budget_usd)) {
        return Err("The monthly budget must be between $0 and $1,000.".into());
    }
    if !(10..=600).contains(&c.timeout_secs) {
        return Err("The timeout must be between 10 and 600 seconds.".into());
    }
    if !(1..=6).contains(&c.max_attempts) {
        return Err("Attempts must be between 1 and 6.".into());
    }
    let s = &c.schedule;
    if s.days.iter().any(|d| *d > 6) || s.time_of_day().is_none() {
        return Err("The schedule needs valid days and a time like 08:00.".into());
    }
    if s.enabled && s.days.is_empty() {
        return Err("Choose at least one day for scheduled analysis.".into());
    }
    if c.schedule.enabled && c.schedule.consent_at.is_none() {
        return Err(
            "Scheduled analysis needs your explicit confirmation before it can be turned on."
                .into(),
        );
    }
    if c.assigned.len() > 50 || c.assigned.iter().any(|r| !valid_repo(r)) {
        return Err("The assigned repositories list is invalid.".into());
    }
    Ok(())
}

fn clean_context(ctx: RepoContext) -> RepoContext {
    let tidy = |s: &str| collect::truncate_chars(s.trim(), 120);
    RepoContext {
        project: ctx.project.as_deref().map(tidy).filter(|p| !p.is_empty()),
        agents: ctx
            .agents
            .iter()
            .map(|a| tidy(a))
            .filter(|a| !a.is_empty())
            .take(20)
            .collect(),
    }
}

struct Outcome {
    status: RunStatus,
    error: Option<RunError>,
    attempts: u32,
    github_requests: u32,
    usage: Option<Usage>,
    cost: Option<f64>,
    estimate: Option<CostEstimate>,
}

impl Outcome {
    fn new(status: RunStatus) -> Self {
        Self {
            status,
            error: None,
            attempts: 0,
            github_requests: 0,
            usage: None,
            cost: None,
            estimate: None,
        }
    }
    fn fail(mut self, status: RunStatus, kind: &str, message: String, retryable: bool) -> Self {
        self.status = status;
        self.error = Some(RunError {
            kind: kind.into(),
            message,
            retryable,
        });
        self
    }
}

struct Job {
    run_id: String,
    repo: String,
    depth: Depth,
    model: String,
    force: bool,
    ctx: RepoContext,
}

impl Agent {
    pub fn new(
        store: Store,
        gh: Arc<dyn GithubApi>,
        model: Arc<dyn ModelApi>,
        spawner: Spawner,
        key_present: Box<dyn Fn() -> bool + Send + Sync>,
        notify: Box<dyn Fn() + Send + Sync>,
    ) -> Arc<Self> {
        let config = store.load_config();
        let mut runs = store.load_runs();
        if recover_interrupted(&mut runs, &now_iso()) > 0 {
            store.save_runs(&runs).ok();
        }
        Arc::new(Self {
            store,
            gh,
            model,
            inner: Mutex::new(Inner {
                config,
                runs,
                active: vec![],
            }),
            permit: Semaphore::new(1),
            spawner,
            key_present,
            notify,
            base_delay: Duration::from_secs(2),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn status(&self) -> AgentStatus {
        let g = self.lock();
        AgentStatus {
            id: AGENT_ID,
            name: AGENT_NAME,
            version: AGENT_VERSION,
            prompt_version: PROMPT_VERSION,
            config: g.config.clone(),
            key_present: (self.key_present)(),
            active: g.active.iter().map(|a| a.run_id.clone()).collect(),
            runs: g.runs.iter().rev().take(150).cloned().collect(),
            month_spent_usd: cost::month_spend(&g.runs, Utc::now()),
        }
    }

    pub fn report(&self, repo: &str) -> Option<Report> {
        self.store.load_report(repo)
    }

    pub fn reports(&self) -> Vec<Report> {
        self.store.list_reports()
    }

    pub fn set_config(&self, mut next: AgentConfig) -> Result<AgentConfig, String> {
        next.assigned.dedup();
        validate_config(&next)?;
        self.store.save_config(&next)?;
        self.lock().config = next.clone();
        (self.notify)();
        Ok(next)
    }

    /// Worst-case cost of one run at the given depth, from configuration alone.
    pub fn estimate(&self, depth: Option<Depth>) -> Result<CostEstimate, String> {
        let g = self.lock();
        let d = depth.unwrap_or(g.config.depth);
        let l = d.limits();
        let spent = cost::month_spend(&g.runs, Utc::now());
        match cost::check(
            &g.config,
            g.config.models.for_depth(d),
            l.input_tokens,
            l.max_tokens,
            spent,
        ) {
            Ok(e) | Err((_, Some(e))) => Ok(e),
            Err((m, None)) => Err(m),
        }
    }

    pub fn enqueue(
        self: &Arc<Self>,
        repo: &str,
        trigger: Trigger,
        depth: Option<Depth>,
        force: bool,
        ctx: RepoContext,
    ) -> Result<EnqueueResult, String> {
        if !valid_repo(repo) {
            return Err("That isn't a valid owner/name repository.".into());
        }
        let (rx, run, job) = {
            let mut g = self.lock();
            if let Some(a) = g.active.iter().find(|a| a.repo.eq_ignore_ascii_case(repo)) {
                return Ok(EnqueueResult {
                    run_id: a.run_id.clone(),
                    duplicate: true,
                });
            }
            // Selecting a repository for a manual run is what assigns it to the agent.
            if trigger == Trigger::Manual
                && !g
                    .config
                    .assigned
                    .iter()
                    .any(|r| r.eq_ignore_ascii_case(repo))
                && g.config.assigned.len() < 50
            {
                g.config.assigned.push(repo.to_string());
                self.store.save_config(&g.config).ok();
            }
            let depth = depth.unwrap_or(g.config.depth);
            let model = g.config.models.for_depth(depth).to_string();
            let run_id = format!("run_{}", uuid::Uuid::new_v4().simple());
            let run = Run {
                id: run_id.clone(),
                repo: repo.to_string(),
                trigger,
                depth,
                model: model.clone(),
                force,
                status: RunStatus::Queued,
                queued_at: now_iso(),
                started_at: None,
                finished_at: None,
                duration_ms: None,
                error: None,
                attempts: 0,
                github_requests: 0,
                usage: None,
                estimate: None,
                cost_usd: None,
                trace: vec![],
            };
            let (tx, rx) = watch::channel(false);
            g.active.push(Active {
                repo: repo.to_string(),
                run_id: run_id.clone(),
                cancel: tx,
            });
            g.runs.push(run.clone());
            let excess = g.runs.len().saturating_sub(2 * super::store::MAX_RUNS);
            g.runs.drain(..excess);
            self.store.save_runs(&g.runs).ok();
            let ctx = clean_context(ctx);
            let job = Job {
                run_id,
                repo: repo.to_string(),
                depth,
                model,
                force,
                ctx,
            };
            (rx, run, job)
        };
        (self.notify)();
        let me = self.clone();
        (self.spawner)(Box::pin(async move { me.execute(job, rx).await }));
        Ok(EnqueueResult {
            run_id: run.id,
            duplicate: false,
        })
    }

    pub fn cancel(&self, run_id: &str) -> bool {
        let g = self.lock();
        match g.active.iter().find(|a| a.run_id == run_id) {
            Some(a) => a.cancel.send(true).is_ok(),
            None => false,
        }
    }

    fn update_run(&self, run_id: &str, f: impl FnOnce(&mut Run)) {
        let mut g = self.lock();
        if let Some(r) = g.runs.iter_mut().find(|r| r.id == run_id) {
            f(r);
        }
        self.store.save_runs(&g.runs).ok();
    }

    async fn execute(self: Arc<Self>, job: Job, mut rx: watch::Receiver<bool>) {
        let permit = tokio::select! {
            p = self.permit.acquire() => p.ok(),
            _ = cancelled(&mut rx) => None,
        };
        let started = Instant::now();
        let mut trace = Vec::new();
        let outcome = if permit.is_none() {
            step(
                &mut trace,
                "queue",
                false,
                "Cancelled while waiting to start.".into(),
                None,
            );
            Outcome::new(RunStatus::Cancelled).fail(
                RunStatus::Cancelled,
                "cancelled",
                "Cancelled before it started.".into(),
                false,
            )
        } else {
            self.update_run(&job.run_id, |r| {
                r.status = RunStatus::Running;
                r.started_at = Some(now_iso());
            });
            (self.notify)();
            self.pipeline(&job, &mut rx, &mut trace).await
        };
        drop(permit);
        {
            let mut g = self.lock();
            if let Some(r) = g.runs.iter_mut().find(|r| r.id == job.run_id) {
                r.status = outcome.status;
                r.error = outcome.error;
                r.attempts = outcome.attempts;
                r.github_requests = outcome.github_requests;
                r.usage = outcome.usage;
                r.cost_usd = outcome.cost;
                r.estimate = outcome.estimate;
                r.finished_at = Some(now_iso());
                r.duration_ms = Some(started.elapsed().as_millis() as u64);
                r.trace = trace;
            }
            g.active.retain(|a| a.run_id != job.run_id);
            self.store.save_runs(&g.runs).ok();
        }
        (self.notify)();
    }

    /// Saves fresh facts while keeping the last good analysis, clearly marked as not current.
    fn save_facts_only(
        &self,
        job: &Job,
        prev: Option<Report>,
        facts: Facts,
        findings: Vec<Finding>,
        fingerprint: String,
        note: String,
    ) {
        let (ai, state, analyzed_at, analysis_run_id, model, validation) = match prev {
            Some(p) if p.ai.is_some() => (
                p.ai,
                AiState::Stale,
                p.analyzed_at,
                p.analysis_run_id,
                p.model,
                p.validation,
            ),
            _ => (None, AiState::NotAssessed, None, None, None, None),
        };
        let r = Report {
            repo: job.repo.clone(),
            facts,
            findings,
            ai,
            ai_state: state,
            analyzed_at,
            analysis_run_id,
            model,
            depth: job.depth,
            fingerprint,
            validation,
            updated_at: now_iso(),
            run_id: job.run_id.clone(),
            context: job.ctx.clone(),
            note: Some(note),
        };
        self.store.save_report(&r).ok();
    }

    async fn pipeline(
        &self,
        job: &Job,
        rx: &mut watch::Receiver<bool>,
        trace: &mut Vec<TraceStep>,
    ) -> Outcome {
        let limits = job.depth.limits();
        let now = Utc::now();
        let mut out = Outcome::new(RunStatus::Failed);
        let cancel_out = |mut o: Outcome, trace: &mut Vec<TraceStep>, at: &str| {
            step(trace, at, false, "Cancelled.".into(), None);
            o = o.fail(
                RunStatus::Cancelled,
                "cancelled",
                "Cancelled by you.".into(),
                false,
            );
            o
        };

        // 1. Collect from GitHub (read-only).
        let t = Instant::now();
        let collected = tokio::select! {
            r = collect::collect(&*self.gh, &job.repo, &limits, now) => r,
            _ = cancelled(rx) => return cancel_out(out, trace, "collect"),
        };
        let collected = match collected {
            Ok(c) => c,
            Err(e) => {
                let err = e.to_run_error();
                step(
                    trace,
                    "collect",
                    false,
                    err.message.clone(),
                    Some(t.elapsed().as_millis() as u64),
                );
                out.error = Some(err);
                return out;
            }
        };
        out.github_requests = collected.facts.github_requests;
        let mut detail = format!(
            "{} GitHub requests (GET only)",
            collected.facts.github_requests
        );
        if !collected.notes.is_empty() {
            detail += &format!(". {}", collected.notes.join(" "));
        }
        step(
            trace,
            "collect",
            true,
            detail,
            Some(t.elapsed().as_millis() as u64),
        );
        let findings = collect::findings(&collected.facts, now);
        step(
            trace,
            "facts",
            true,
            format!(
                "{} verified findings computed from GitHub data",
                findings.len()
            ),
            None,
        );
        let prev = self.store.load_report(&job.repo);

        // 2. Not enough to analyze: say so instead of asking the model to guess.
        let f = &collected.facts;
        if f.empty
            || (collected.readme.is_none()
                && f.root_files.is_empty()
                && f.activity.commits_sampled == 0)
        {
            let r = Report {
                repo: job.repo.clone(),
                facts: collected.facts.clone(),
                findings,
                ai: None,
                ai_state: AiState::InsufficientData,
                analyzed_at: None,
                analysis_run_id: None,
                model: None,
                depth: job.depth,
                fingerprint: String::new(),
                validation: None,
                updated_at: now_iso(),
                run_id: job.run_id.clone(),
                context: job.ctx.clone(),
                note: Some("The repository has no commits, files or README to analyze.".into()),
            };
            self.store.save_report(&r).ok();
            step(
                trace,
                "assess",
                true,
                "Not enough data to analyze; no Claude request made.".into(),
                None,
            );
            out.status = RunStatus::InsufficientData;
            return out;
        }

        // 3. Prompt.
        let p = prompt::build(
            &collected,
            &job.ctx,
            &limits,
            &job.model,
            job.depth,
            &now.format("%Y-%m-%d").to_string(),
        );
        step(
            trace,
            "prompt",
            true,
            format!(
                "About {} input tokens estimated, {} citable references{}",
                p.input_tokens_est,
                p.refs.len(),
                if p.trimmed {
                    ", excerpts shortened to fit"
                } else {
                    ""
                }
            ),
            None,
        );

        // 4. Reuse when nothing that feeds the analysis changed.
        if let Some(prev) = prev
            .as_ref()
            .filter(|r| !job.force && r.ai.is_some() && r.fingerprint == p.fingerprint)
        {
            let mut r = prev.clone();
            r.facts = collected.facts.clone();
            r.findings = findings;
            r.ai_state = AiState::Reused;
            r.updated_at = now_iso();
            r.run_id = job.run_id.clone();
            r.note = None;
            self.store.save_report(&r).ok();
            step(
                trace,
                "cache",
                true,
                format!(
                    "Nothing changed since the analysis of {}; reused it without calling Claude.",
                    prev.analyzed_at.as_deref().unwrap_or("earlier")
                ),
                None,
            );
            out.status = RunStatus::Reused;
            return out;
        }
        if *rx.borrow() {
            return cancel_out(out, trace, "prompt");
        }

        // 5. Credentials and budget, before anything is sent.
        if !(self.key_present)() {
            let e = InferError::NoKey;
            step(trace, "credentials", false, e.message(), None);
            self.save_facts_only(
                job,
                prev,
                collected.facts,
                findings,
                p.fingerprint,
                e.message(),
            );
            return out.fail(RunStatus::Blocked, e.kind(), e.message(), false);
        }
        let (config, spent) = {
            let g = self.lock();
            (g.config.clone(), cost::month_spend(&g.runs, now))
        };
        match cost::check(
            &config,
            &job.model,
            p.input_tokens_est,
            limits.max_tokens,
            spent,
        ) {
            Ok(est) => {
                step(
                    trace,
                    "budget",
                    true,
                    format!(
                        "Worst case ${:.3} (limit ${:.2}); ${:.3} of ${:.2} used this month",
                        est.worst_case_usd,
                        est.max_run_usd,
                        est.month_spent_usd,
                        est.monthly_budget_usd
                    ),
                    None,
                );
                out.estimate = Some(est);
            }
            Err((msg, est)) => {
                step(trace, "budget", false, msg.clone(), None);
                out.estimate = est;
                self.save_facts_only(
                    job,
                    prev,
                    collected.facts,
                    findings,
                    p.fingerprint,
                    msg.clone(),
                );
                return out.fail(RunStatus::Blocked, "budget", msg, false);
            }
        }

        // 6. One Claude request, with bounded retries.
        let fallback = config.refusal_fallback && prompt::supports_fallback(&job.model);
        let body = prompt::request_body(&p, &job.model, &limits, fallback);
        let betas: Vec<&str> = if fallback {
            vec![prompt::FALLBACK_BETA]
        } else {
            vec![]
        };
        let policy = RetryPolicy {
            max_attempts: config.max_attempts,
            base_delay: self.base_delay,
            max_delay: Duration::from_secs(60),
            timeout: Duration::from_secs(config.timeout_secs),
        };
        self.update_run(&job.run_id, |r| r.estimate = out.estimate.clone());
        let inf = match claude::infer(&*self.model, &body, &betas, policy, rx, trace).await {
            Ok(i) => i,
            Err((e, attempts, usage)) => {
                out.attempts = attempts;
                if let Some(u) = usage {
                    out.cost = cost::cost_of_response(&config, &job.model, &u, &[]);
                    out.usage = Some(u);
                }
                let status = if e == InferError::Cancelled {
                    RunStatus::Cancelled
                } else {
                    RunStatus::Failed
                };
                if status == RunStatus::Failed {
                    self.save_facts_only(
                        job,
                        prev,
                        collected.facts,
                        findings,
                        p.fingerprint,
                        format!("The latest analysis failed: {}", e.message()),
                    );
                }
                return out.fail(status, e.kind(), e.message(), e.retryable());
            }
        };
        out.attempts = inf.attempts;
        out.cost = cost::cost_of_response(&config, &job.model, &inf.usage, &inf.iterations);
        out.usage = Some(inf.usage.clone());
        if inf.usage.fallback {
            step(
                trace,
                "inference",
                true,
                format!(
                    "A safety fallback ran; the answer came from {}.",
                    inf.usage.served_by.as_deref().unwrap_or("another model")
                ),
                None,
            );
        }

        // 7. Validate.
        let (ai, summary) = match validate::validate(&inf.text, &p.refs) {
            Ok(v) => v,
            Err(e) => {
                step(trace, "validate", false, e.0.clone(), None);
                self.save_facts_only(
                    job,
                    prev,
                    collected.facts,
                    findings,
                    p.fingerprint,
                    "The latest analysis returned an invalid report and was discarded.".into(),
                );
                return out.fail(RunStatus::Failed, "invalid_response", e.0, false);
            }
        };
        step(
            trace,
            "validate",
            true,
            format!(
                "Schema valid. {} unknown citations removed, {} items without supporting references, {} fields shortened",
                summary.dropped_refs, summary.ungrounded_items, summary.trimmed_fields
            ),
            None,
        );

        // 8. Save.
        let analyzed_at = now_iso();
        let report = Report {
            repo: job.repo.clone(),
            facts: collected.facts,
            findings,
            ai: Some(ai),
            ai_state: AiState::Analyzed,
            analyzed_at: Some(analyzed_at.clone()),
            analysis_run_id: Some(job.run_id.clone()),
            model: inf.usage.served_by.clone().or(Some(job.model.clone())),
            depth: job.depth,
            fingerprint: p.fingerprint,
            validation: Some(summary),
            updated_at: analyzed_at,
            run_id: job.run_id.clone(),
            context: job.ctx.clone(),
            note: None,
        };
        if let Err(e) = self.store.save_report(&report) {
            step(trace, "save", false, e.clone(), None);
            return out.fail(RunStatus::Failed, "storage", e, true);
        }
        step(
            trace,
            "save",
            true,
            "Report saved on this Mac.".into(),
            None,
        );
        out.status = RunStatus::Succeeded;
        out
    }

    /// Repositories due for an unattended run. Nothing is due unless scheduling was turned
    /// on with consent, and nothing is started once the monthly budget is used up.
    pub fn due(&self, now: DateTime<Utc>) -> Vec<String> {
        let g = self.lock();
        let s = &g.config.schedule;
        if !s.enabled
            || s.consent_at.is_none()
            || cost::month_spend(&g.runs, now) >= g.config.monthly_budget_usd
        {
            return vec![];
        }
        let Some(slot) = s.latest_slot(&now.with_timezone(&chrono::Local)) else {
            return vec![];
        };
        g.config
            .assigned
            .iter()
            .filter(|repo| !g.active.iter().any(|a| a.repo.eq_ignore_ascii_case(repo)))
            .filter(|repo| {
                // Any attempt since the latest slot counts, so a failing repository waits for
                // the next slot. A slot missed while the app was closed runs once on launch.
                let last = g
                    .runs
                    .iter()
                    .filter(|r| r.repo.eq_ignore_ascii_case(repo))
                    .filter_map(|r| DateTime::parse_from_rfc3339(&r.queued_at).ok())
                    .max();
                last.map_or(true, |t| t.with_timezone(&Utc) < slot)
            })
            .cloned()
            .collect()
    }

    pub fn schedule_tick(self: &Arc<Self>, now: DateTime<Utc>) -> Vec<String> {
        let mut started = vec![];
        for repo in self.due(now) {
            let ctx = self
                .store
                .load_report(&repo)
                .map(|r| r.context)
                .unwrap_or_default();
            if let Ok(r) = self.enqueue(&repo, Trigger::Scheduled, None, false, ctx) {
                if !r.duplicate {
                    started.push(r.run_id);
                }
            }
        }
        started
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::intel::claude::tests::{ok_reply, status_reply, FakeModel};
    use crate::intel::claude::NetError;
    use crate::intel::collect::tests::FakeGithub;
    use crate::intel::validate::tests::sample;
    use serde_json::json;

    struct Rig {
        agent: Arc<Agent>,
        model: Arc<FakeModel>,
        gh: Arc<FakeGithub>,
        _dir: tempfile::TempDir,
    }

    fn rig_with(
        gh: FakeGithub,
        model: FakeModel,
        key: bool,
        dir: Option<tempfile::TempDir>,
    ) -> Rig {
        let dir = dir.unwrap_or_else(|| tempfile::tempdir().unwrap());
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        let model = Arc::new(model);
        let gh = Arc::new(gh);
        let agent = Agent::new(
            store,
            gh.clone(),
            model.clone(),
            Box::new(|f| drop(tokio::spawn(f))),
            Box::new(move || key),
            Box::new(|| {}),
        );
        let mut a = Arc::try_unwrap(agent).ok().unwrap();
        a.base_delay = Duration::from_millis(1);
        Rig {
            agent: Arc::new(a),
            model,
            gh,
            _dir: dir,
        }
    }

    fn rig(model: FakeModel) -> Rig {
        rig_with(FakeGithub::healthy("o/r"), model, true, None)
    }

    async fn idle(a: &Agent) {
        for _ in 0..2000 {
            if a.lock().active.is_empty() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        panic!("jobs didn't finish");
    }

    fn last(a: &Agent) -> Run {
        a.lock().runs.last().unwrap().clone()
    }

    fn good() -> Result<claude::HttpReply, NetError> {
        ok_reply(&sample().to_string())
    }

    async fn analyze(r: &Rig, force: bool) -> Run {
        r.agent
            .enqueue("o/r", Trigger::Manual, None, force, RepoContext::default())
            .unwrap();
        idle(&r.agent).await;
        last(&r.agent)
    }

    #[tokio::test]
    async fn vertical_slice_succeeds_and_is_traceable() {
        let r = rig(FakeModel::new(vec![good()]));
        let run = analyze(&r, false).await;
        assert_eq!(run.status, RunStatus::Succeeded, "{:?}", run.error);
        assert!(run.id.starts_with("run_"));
        assert_eq!(run.attempts, 1);
        // 3,000 in at $2/M + 1,000 out at $10/M.
        assert!((run.cost_usd.unwrap() - 0.016).abs() < 1e-9);
        assert!(run.estimate.as_ref().unwrap().worst_case_usd >= run.cost_usd.unwrap());
        let steps: Vec<&str> = run.trace.iter().map(|s| s.step.as_str()).collect();
        for s in [
            "collect",
            "facts",
            "prompt",
            "budget",
            "inference",
            "validate",
            "save",
        ] {
            assert!(steps.contains(&s), "trace lacks {s}: {steps:?}");
        }
        let report = r.agent.report("o/r").unwrap();
        assert_eq!(report.ai_state, AiState::Analyzed);
        assert!(report.analyzed_at.is_some());
        assert!(
            report.findings.iter().any(|f| f.id == "ci:900"),
            "verified CI failure"
        );
        assert_eq!(
            r.agent.status().config.assigned,
            vec!["o/r"],
            "a manual run assigns the repository"
        );
        // The request carried the structured-output schema and no tools.
        let body = &r.model.bodies.lock().unwrap()[0];
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        assert!(body.get("tools").is_none());
        assert_eq!(
            r.model.betas.lock().unwrap()[0],
            vec![prompt::FALLBACK_BETA.to_string()]
        );
    }

    #[tokio::test]
    async fn unchanged_repository_reuses_the_analysis() {
        let r = rig(FakeModel::new(vec![good(), good()]));
        analyze(&r, false).await;
        let second = analyze(&r, false).await;
        assert_eq!(second.status, RunStatus::Reused);
        assert_eq!(r.model.calls(), 1, "no second Claude call");
        assert_eq!(second.cost_usd, None);
        assert_eq!(r.agent.report("o/r").unwrap().ai_state, AiState::Reused);
        let forced = analyze(&r, true).await;
        assert_eq!(forced.status, RunStatus::Succeeded);
        assert_eq!(r.model.calls(), 2);
    }

    #[tokio::test]
    async fn invalid_model_output_is_a_failure_not_a_report() {
        let r = rig(FakeModel::new(vec![ok_reply(
            "I think this repo is great!",
        )]));
        let run = analyze(&r, false).await;
        assert_eq!(run.status, RunStatus::Failed);
        assert_eq!(run.error.unwrap().kind, "invalid_response");
        assert!(
            run.cost_usd.unwrap() > 0.0,
            "the call still cost money and is counted"
        );
        let rep = r.agent.report("o/r").unwrap();
        assert_eq!(rep.ai_state, AiState::NotAssessed);
        assert!(rep.ai.is_none());
    }

    #[tokio::test]
    async fn failure_after_success_marks_the_old_analysis_stale() {
        let r = rig(FakeModel::new(vec![
            good(),
            status_reply(400, "invalid_request_error"),
        ]));
        analyze(&r, false).await;
        let run = analyze(&r, true).await;
        assert_eq!(run.status, RunStatus::Failed);
        let rep = r.agent.report("o/r").unwrap();
        assert_eq!(rep.ai_state, AiState::Stale);
        assert!(rep.note.unwrap().contains("failed"));
    }

    #[tokio::test]
    async fn duplicate_jobs_are_not_created() {
        let mut m = FakeModel::new(vec![good()]);
        m.delay = Duration::from_millis(150);
        let r = rig(m);
        let a = r
            .agent
            .enqueue("o/r", Trigger::Manual, None, false, RepoContext::default())
            .unwrap();
        let b = r
            .agent
            .enqueue("O/R", Trigger::Manual, None, false, RepoContext::default())
            .unwrap();
        assert!(!a.duplicate);
        assert!(b.duplicate);
        assert_eq!(a.run_id, b.run_id);
        idle(&r.agent).await;
        assert_eq!(r.model.calls(), 1);
        assert_eq!(r.agent.lock().runs.len(), 1);
    }

    #[tokio::test]
    async fn pending_job_can_be_cancelled() {
        let mut m = FakeModel::new(vec![good()]);
        m.delay = Duration::from_millis(150);
        let gh = FakeGithub::healthy("o/r");
        let mut routes = FakeGithub::healthy("o/s").routes;
        routes.extend(gh.routes);
        let mut gh = FakeGithub::new();
        gh.routes = routes;
        let r = rig_with(gh, m, true, None);
        r.agent
            .enqueue("o/r", Trigger::Manual, None, false, RepoContext::default())
            .unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        let b = r
            .agent
            .enqueue("o/s", Trigger::Manual, None, false, RepoContext::default())
            .unwrap();
        assert!(r.agent.cancel(&b.run_id));
        idle(&r.agent).await;
        let runs = r.agent.lock().runs.clone();
        let cancelled = runs.iter().find(|x| x.id == b.run_id).unwrap();
        assert_eq!(cancelled.status, RunStatus::Cancelled);
        assert_eq!(cancelled.attempts, 0);
        assert_eq!(r.model.calls(), 1, "the cancelled job never called Claude");
        assert!(
            !r.agent.cancel(&b.run_id),
            "finished runs can't be cancelled again"
        );
    }

    #[tokio::test]
    async fn running_inference_can_be_cancelled() {
        let mut m = FakeModel::new(vec![good()]);
        m.delay = Duration::from_secs(5);
        let r = rig(m);
        let a = r
            .agent
            .enqueue("o/r", Trigger::Manual, None, false, RepoContext::default())
            .unwrap();
        for _ in 0..500 {
            if r.model.calls() > 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        assert!(r.agent.cancel(&a.run_id));
        idle(&r.agent).await;
        let run = last(&r.agent);
        assert_eq!(run.status, RunStatus::Cancelled);
        assert!(run
            .trace
            .iter()
            .any(|s| s.detail.contains("may still bill")));
    }

    #[tokio::test]
    async fn interrupted_runs_are_closed_on_startup() {
        let dir = tempfile::tempdir().unwrap();
        {
            let r = rig_with(
                FakeGithub::healthy("o/r"),
                FakeModel::new(vec![]),
                true,
                Some(tempfile::tempdir().unwrap()),
            );
            drop(r);
        }
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        let mut run = Run {
            id: "run_x".into(),
            repo: "o/r".into(),
            trigger: Trigger::Manual,
            depth: Depth::Standard,
            model: "m".into(),
            force: false,
            status: RunStatus::Running,
            queued_at: now_iso(),
            started_at: Some(now_iso()),
            finished_at: None,
            duration_ms: None,
            error: None,
            attempts: 1,
            github_requests: 3,
            usage: None,
            estimate: None,
            cost_usd: None,
            trace: vec![],
        };
        let mut queued = run.clone();
        queued.id = "run_y".into();
        queued.status = RunStatus::Queued;
        run.attempts = 1;
        store.save_runs(&[run, queued]).unwrap();
        let r = rig_with(
            FakeGithub::healthy("o/r"),
            FakeModel::new(vec![]),
            true,
            Some(dir),
        );
        let runs = r.agent.lock().runs.clone();
        assert!(runs.iter().all(|x| x.status == RunStatus::Interrupted));
        assert!(runs[0].error.as_ref().unwrap().message.contains("billed"));
        // And a new run for the same repository isn't blocked by the stale record.
        r.agent
            .enqueue("o/r", Trigger::Manual, None, false, RepoContext::default())
            .unwrap();
        idle(&r.agent).await;
    }

    #[tokio::test]
    async fn budget_blocks_before_any_call() {
        let r = rig(FakeModel::new(vec![good()]));
        let mut c = r.agent.status().config;
        c.monthly_budget_usd = 0.01;
        r.agent.set_config(c).unwrap();
        let run = analyze(&r, false).await;
        assert_eq!(run.status, RunStatus::Blocked);
        assert_eq!(run.error.unwrap().kind, "budget");
        assert_eq!(r.model.calls(), 0);
        assert_eq!(
            r.agent.report("o/r").unwrap().ai_state,
            AiState::NotAssessed,
            "facts are still saved"
        );
    }

    #[tokio::test]
    async fn missing_key_blocks_without_a_call() {
        let r = rig_with(
            FakeGithub::healthy("o/r"),
            FakeModel::new(vec![good()]),
            false,
            None,
        );
        let run = analyze(&r, false).await;
        assert_eq!(run.status, RunStatus::Blocked);
        assert_eq!(run.error.unwrap().kind, "anthropic_no_key");
        assert_eq!(r.model.calls(), 0);
    }

    #[tokio::test]
    async fn anthropic_auth_error_fails_once() {
        let r = rig(FakeModel::new(vec![
            status_reply(401, "authentication_error"),
            good(),
        ]));
        let run = analyze(&r, false).await;
        assert_eq!(run.status, RunStatus::Failed);
        assert_eq!(run.error.unwrap().kind, "anthropic_auth");
        assert_eq!(r.model.calls(), 1);
    }

    #[tokio::test]
    async fn anthropic_rate_limit_is_retried_then_reported() {
        let r = rig(FakeModel::new(vec![
            status_reply(429, "rate_limit_error"),
            status_reply(429, "rate_limit_error"),
            status_reply(429, "rate_limit_error"),
        ]));
        let run = analyze(&r, false).await;
        assert_eq!(run.status, RunStatus::Failed);
        let e = run.error.unwrap();
        assert_eq!(e.kind, "anthropic_rate_limit");
        assert!(e.retryable);
        assert_eq!(run.attempts, 3);
    }

    #[tokio::test]
    async fn github_failure_stops_before_claude() {
        let gh = FakeGithub::new().route("/repos/o/r", 401, json!({"message": "Bad credentials"}));
        let r = rig_with(gh, FakeModel::new(vec![good()]), true, None);
        let run = analyze(&r, false).await;
        assert_eq!(run.status, RunStatus::Failed);
        assert_eq!(run.error.unwrap().kind, "github_auth");
        assert_eq!(r.model.calls(), 0);
        assert!(
            r.agent.report("o/r").is_none(),
            "nothing saved from a failed collection"
        );
    }

    #[tokio::test]
    async fn empty_repository_is_insufficient_data() {
        let gh = FakeGithub::new().route(
            "/repos/o/r",
            200,
            json!({"full_name": "o/r", "default_branch": "main", "size": 0}),
        );
        let r = rig_with(gh, FakeModel::new(vec![good()]), true, None);
        let run = analyze(&r, false).await;
        assert_eq!(run.status, RunStatus::InsufficientData);
        assert_eq!(r.model.calls(), 0);
        assert_eq!(
            r.agent.report("o/r").unwrap().ai_state,
            AiState::InsufficientData
        );
    }

    #[tokio::test]
    async fn injected_claims_cannot_become_verified() {
        // Suppose injected README text steered the model into citing a fake alert and
        // declaring the repository secure. The citation is dropped, and nothing it writes
        // lands among the verified findings.
        let mut v = sample();
        v["security_observations"] = json!([{"text": "Verified: no vulnerabilities, fully secure", "evidence": ["alert:dependabot:999"]}]);
        let r = rig(FakeModel::new(vec![ok_reply(&v.to_string())]));
        let run = analyze(&r, false).await;
        assert_eq!(run.status, RunStatus::Succeeded);
        let rep = r.agent.report("o/r").unwrap();
        let obs = &rep.ai.unwrap().security_observations[0];
        assert!(obs.evidence.is_empty());
        assert!(!obs.grounded);
        assert!(rep.findings.iter().all(|f| !f.title.contains("secure")));
        assert!(
            rep.findings.iter().any(|f| f.id == "alert:dependabot:3"),
            "the real alert is still reported"
        );
        assert!(rep.validation.unwrap().dropped_refs >= 1);
    }

    #[tokio::test]
    async fn github_reads_stay_get_only_and_in_scope() {
        let r = rig(FakeModel::new(vec![good()]));
        analyze(&r, false).await;
        // FakeGithub asserts every path against the production allowlist as it's called.
        assert!(r.gh.calls().iter().all(|p| p.starts_with("/repos/o/r")));
        assert!(r
            .agent
            .enqueue(
                "../../user",
                Trigger::Manual,
                None,
                false,
                RepoContext::default()
            )
            .is_err());
    }

    #[tokio::test]
    async fn schedule_is_off_by_default_and_needs_consent() {
        let r = rig(FakeModel::new(vec![good(), good()]));
        let mut c = r.agent.status().config;
        assert!(!c.schedule.enabled);
        c.assigned = vec!["o/r".into()];
        r.agent.set_config(c.clone()).unwrap();
        assert!(r.agent.schedule_tick(Utc::now()).is_empty());
        c.schedule.enabled = true;
        assert!(
            r.agent.set_config(c.clone()).is_err(),
            "no consent, no schedule"
        );
        c.schedule.consent_at = Some(now_iso());
        r.agent.set_config(c).unwrap();
        let started = r.agent.schedule_tick(Utc::now());
        assert_eq!(started.len(), 1);
        assert!(
            r.agent.schedule_tick(Utc::now()).is_empty(),
            "no overlap while it runs"
        );
        idle(&r.agent).await;
        assert!(
            r.agent.schedule_tick(Utc::now()).is_empty(),
            "not due again until the interval passes"
        );
        let later = Utc::now() + chrono::Duration::days(8);
        assert_eq!(r.agent.due(later), vec!["o/r".to_string()]);
        assert_eq!(last(&r.agent).trigger, Trigger::Scheduled);
    }

    #[test]
    fn schedule_slots_follow_days_and_time() {
        use chrono::TimeZone;
        let s = Schedule::default(); // Mon, Wed, Fri at 08:00
        let tz = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
        let at = |d, h, m| tz.with_ymd_and_hms(2026, 10, d, h, m, 0).unwrap();
        let utc = |t: chrono::DateTime<chrono::FixedOffset>| t.with_timezone(&Utc);
        // 2026-10-26 is a Monday.
        assert_eq!(s.latest_slot(&at(26, 8, 5)), Some(utc(at(26, 8, 0))));
        assert_eq!(
            s.latest_slot(&at(26, 7, 59)),
            Some(utc(at(23, 8, 0))),
            "Friday before"
        );
        assert_eq!(
            s.latest_slot(&at(27, 12, 0)),
            Some(utc(at(26, 8, 0))),
            "Tuesday"
        );
        assert_eq!(
            s.latest_slot(&at(28, 8, 0)),
            Some(utc(at(28, 8, 0))),
            "Wednesday"
        );
        let none = Schedule {
            days: vec![],
            ..Schedule::default()
        };
        assert_eq!(none.latest_slot(&at(26, 9, 0)), None);
        let mut c = AgentConfig::default();
        c.schedule.at = "8am".into();
        assert!(validate_config(&c).is_err());
        c.schedule.at = "08:00".into();
        c.schedule.days = vec![7];
        assert!(validate_config(&c).is_err());
    }

    #[test]
    fn config_validation() {
        let mut c = AgentConfig::default();
        assert!(validate_config(&c).is_ok());
        c.models.standard = "gpt-4o".into();
        assert!(validate_config(&c).is_err());
        let mut c = AgentConfig::default();
        c.models.standard = "claude-unpriced-9".into();
        assert!(validate_config(&c).unwrap_err().contains("price"));
        let c = AgentConfig {
            max_run_usd: f64::NAN,
            ..Default::default()
        };
        assert!(validate_config(&c).is_err());
    }
}
