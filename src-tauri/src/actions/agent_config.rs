//! Manage agents: change an allow-listed agent's schedule or monthly cap. Never a commit to
//! main: Atlas opens a pull request that changes exactly one line, the workflow's `cron:` or
//! the one cap key in the agent's policy JSON, and KC merges it like any other.
//!
//! The page sends an agent id, which field, and the new value. The file, the key and the
//! limits come from the allow-list compiled into the app. The value is checked here (cron
//! form, minimum interval, cap range), the file is read from main, the one-line edit is made
//! and re-checked, and the before and after lines are shown in a native dialog and confirmed
//! with Touch ID before the audit record and the three writes (branch, file, pull request).

use super::agents::{manifest, Manifest};
use super::rerun::{SendError, WriteResponse};
use super::store::{
    agent_rate_block, AuditRecord, Stage, Store, ACTION_AGENT_CAP, ACTION_AGENT_SCHEDULE,
};
use crate::intel::collect::{valid_repo, GithubApi};
use base64::Engine;
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::Arc;

pub const BASE_BRANCH: &str = "main";
/// Runs closer together than this are refused for any agent.
pub const MIN_INTERVAL_MINUTES: i64 = 15;
/// Agents that call a paid API run at most this often.
pub const PAID_MIN_INTERVAL_MINUTES: i64 = 240;
/// No agent's cap can go above this, whatever the allow-list says.
pub const HARD_MAX_CAP_USD: f64 = 5.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "field", content = "value", rename_all = "snake_case")]
pub enum ConfigChange {
    Schedule(String),
    Cap(f64),
}

// ---------------------------------------------------------------------------------------
// Schedules. The same rules as src/manage/cron.ts: numeric five-field cron only.

struct Cron {
    minute: BTreeSet<u32>,
    hour: BTreeSet<u32>,
    dom: BTreeSet<u32>,
    month: BTreeSet<u32>,
    dow: BTreeSet<u32>,
    dom_restricted: bool,
    dow_restricted: bool,
}

fn field(text: &str, name: &str, min: u32, max: u32) -> Result<BTreeSet<u32>, String> {
    let mut out = BTreeSet::new();
    for part in text.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((r, s)) => (r, Some(s)),
            None => (part, None),
        };
        let num = |s: &str| -> Result<u32, String> {
            if s.is_empty() || s.len() > 2 || !s.chars().all(|c| c.is_ascii_digit()) {
                return Err(format!("\"{part}\" isn't a valid {name}."));
            }
            Ok(s.parse().unwrap())
        };
        let step = match step {
            Some(s) => num(s)?,
            None => 1,
        };
        if step < 1 {
            return Err(format!("The {name} step must be at least 1."));
        }
        let (lo, hi) = if range == "*" {
            (min, max)
        } else if let Some((a, b)) = range.split_once('-') {
            (num(a)?, num(b)?)
        } else {
            let a = num(range)?;
            (
                a,
                if step > 1 || part.contains('/') {
                    max
                } else {
                    a
                },
            )
        };
        if lo < min || hi > max || lo > hi {
            return Err(format!("The {name} must be between {min} and {max}."));
        }
        let mut v = lo;
        while v <= hi {
            out.insert(if name == "day of week" && v == 7 {
                0
            } else {
                v
            });
            v += step;
        }
    }
    Ok(out)
}

fn parse_cron(text: &str) -> Result<Cron, String> {
    if text.len() > 64 {
        return Err("The schedule is too long.".into());
    }
    if !text
        .chars()
        .all(|c| c.is_ascii_digit() || " *,/-".contains(c))
    {
        return Err("Use numbers, *, ranges like 1-5 and steps like */4.".into());
    }
    let parts: Vec<&str> = text.split(' ').collect();
    if parts.len() != 5 || parts.iter().any(|p| p.is_empty()) {
        return Err("A schedule has five parts, separated by single spaces: minute, hour, day of month, month and day of week.".into());
    }
    Ok(Cron {
        minute: field(parts[0], "minute", 0, 59)?,
        hour: field(parts[1], "hour", 0, 23)?,
        dom: field(parts[2], "day of month", 1, 31)?,
        month: field(parts[3], "month", 1, 12)?,
        dow: field(parts[4], "day of week", 0, 7)?,
        dom_restricted: parts[2] != "*",
        dow_restricted: parts[4] != "*",
    })
}

fn day_matches(c: &Cron, d: DateTime<Utc>) -> bool {
    if !c.month.contains(&d.month()) {
        return false;
    }
    let dom = c.dom.contains(&d.day());
    let dow = c.dow.contains(&d.weekday().num_days_from_sunday());
    if c.dom_restricted && c.dow_restricted {
        dom || dow
    } else {
        dom && dow
    }
}

/// The shortest gap between two runs, in minutes, over a full year. None if it never runs.
fn min_interval_minutes(c: &Cron) -> Option<i64> {
    let start = Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap();
    let mut last: Option<DateTime<Utc>> = None;
    let mut gap: Option<i64> = None;
    let mut count = 0;
    for day in 0..367 {
        let d = start + Duration::days(day);
        if !day_matches(c, d) {
            continue;
        }
        for h in &c.hour {
            for m in &c.minute {
                let t = d.with_hour(*h).unwrap().with_minute(*m).unwrap();
                if let Some(l) = last {
                    let g = (t - l).num_minutes();
                    gap = Some(gap.map_or(g, |x: i64| x.min(g)));
                }
                last = Some(t);
                count += 1;
            }
        }
    }
    match count {
        0 => None,
        1 => Some(366 * 1440),
        _ => gap,
    }
}

/// Why a schedule isn't allowed, or None.
pub fn schedule_problem(text: &str, paid: bool) -> Option<String> {
    let c = match parse_cron(text) {
        Ok(c) => c,
        Err(e) => return Some(e),
    };
    let Some(gap) = min_interval_minutes(&c) else {
        return Some("That schedule never runs.".into());
    };
    let min = if paid {
        PAID_MIN_INTERVAL_MINUTES
    } else {
        MIN_INTERVAL_MINUTES
    };
    (gap < min).then(|| {
        let span = if min >= 60 {
            format!("{} hours", min / 60)
        } else {
            format!("{min} minutes")
        };
        format!(
            "Runs must be at least {span} apart{}.",
            if paid {
                " for an agent that calls a paid API"
            } else {
                ""
            }
        )
    })
}

/// Why a monthly cap isn't allowed, or None.
pub fn cap_problem(usd: f64, max_usd: f64) -> Option<String> {
    if !usd.is_finite() {
        return Some("The cap must be a number of dollars.".into());
    }
    if usd < 0.0 {
        return Some("The cap can't be negative.".into());
    }
    if ((usd * 100.0).round() - usd * 100.0).abs() > 1e-6 {
        return Some("Use whole cents, for example 1.50.".into());
    }
    let max = max_usd.min(HARD_MAX_CAP_USD);
    (usd > max + 1e-9).then(|| format!("The cap can be at most ${max:.2} a month."))
}

// ---------------------------------------------------------------------------------------
// The one-line edits.

#[derive(Debug, Clone, PartialEq)]
pub struct Edit {
    pub before: String,
    pub after: String,
    pub text: String,
}

fn cron_line(line: &str) -> Option<(&str, &str)> {
    let indent_len = line.len() - line.trim_start().len();
    let rest = line.trim_start().strip_prefix("- cron:")?.trim();
    let value = rest.strip_prefix('"')?.strip_suffix('"')?;
    Some((&line[..indent_len], value))
}

/// Replaces the workflow's only `- cron: "…"` line. Refuses a file with none or several.
pub fn edit_schedule(yaml: &str, new: &str) -> Result<Edit, String> {
    let lines: Vec<&str> = yaml.split('\n').collect();
    let found: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| l.trim_start().starts_with("- cron:"))
        .map(|(i, _)| i)
        .collect();
    let [i] = found.as_slice() else {
        return Err(format!(
            "The workflow has {} schedule lines; Atlas only changes a workflow with exactly one.",
            found.len()
        ));
    };
    let (indent, old) =
        cron_line(lines[*i]).ok_or("The schedule line isn't in the form - cron: \"…\".")?;
    if old == new {
        return Err("That's already the schedule.".into());
    }
    let after = format!("{indent}- cron: \"{new}\"");
    let before = lines[*i].to_string();
    let mut out = lines.clone();
    out[*i] = &after;
    Ok(Edit {
        before: before.trim().into(),
        after: after.trim().into(),
        text: out.join("\n"),
    })
}

fn format_usd(v: f64) -> String {
    let s = format!("{v:.2}");
    let s = s.trim_end_matches('0');
    if s.ends_with('.') {
        format!("{s}0")
    } else {
        s.to_string()
    }
}

fn dig<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    key.split('.').try_fold(v, |x, k| x.get(k))
}

fn dig_mut<'a>(v: &'a mut Value, key: &str) -> Option<&'a mut Value> {
    key.split('.').try_fold(v, |x, k| x.get_mut(k))
}

/// Replaces the number after the cap key's name, which must appear exactly once in the file,
/// then checks the result parses and differs from the original only at that key.
pub fn edit_cap(json: &str, key: &str, usd: f64) -> Result<Edit, String> {
    let original: Value =
        serde_json::from_str(json).map_err(|_| "The policy file isn't valid JSON.")?;
    let old = dig(&original, key)
        .and_then(Value::as_f64)
        .ok_or("The policy file has no cap at that key.")?;
    if (old - usd).abs() < 1e-9 {
        return Err("That's already the cap.".into());
    }
    let last = key.rsplit('.').next().unwrap();
    let needle = format!("\"{last}\"");
    let hits: Vec<usize> = json.match_indices(&needle).map(|(i, _)| i).collect();
    let [at] = hits.as_slice() else {
        return Err(format!("\"{last}\" appears {} times in the policy file; Atlas only changes a key that appears once.", hits.len()));
    };
    let after_key = at + needle.len();
    let rest = &json[after_key..];
    let colon = rest.find(':').ok_or("The cap key has no value.")?;
    if !rest[..colon].trim().is_empty() {
        return Err("The cap key has no value.".into());
    }
    let value_start =
        after_key + colon + 1 + (rest[colon + 1..].len() - rest[colon + 1..].trim_start().len());
    let value_len = json[value_start..]
        .find(|c: char| !(c.is_ascii_digit() || ".-+eE".contains(c)))
        .unwrap_or(json.len() - value_start);
    let new_num = format_usd(usd);
    let text = format!(
        "{}{}{}",
        &json[..value_start],
        new_num,
        &json[value_start + value_len..]
    );

    let mut expected = original.clone();
    *dig_mut(&mut expected, key).unwrap() = serde_json::json!(usd);
    let parsed: Value =
        serde_json::from_str(&text).map_err(|_| "The edit would break the policy file.")?;
    if parsed != expected {
        return Err("The edit would change more than the cap, so Atlas stopped.".into());
    }
    let line_of = |t: &str, pos: usize| -> String {
        let s = t[..pos].rfind('\n').map_or(0, |i| i + 1);
        let e = t[pos..].find('\n').map_or(t.len(), |i| pos + i);
        t[s..e].trim().trim_end_matches(',').to_string()
    };
    Ok(Edit {
        before: line_of(json, value_start),
        after: line_of(&text, value_start),
        text,
    })
}

/// Where the allow-list lives in the repository. The pull request updates it too, so the
/// value Atlas shows and the check in src/manage/manifest.test.ts stay in step with the file.
pub const MANIFEST_PATH: &str = "src/manage/agents.json";

/// Replaces one agent's `schedule` or `cap.usd` in the allow-list: the first such key after
/// that agent's `"id"` and before the next agent's. The result must parse and differ from the
/// original only there.
pub fn edit_manifest(json: &str, agent: &str, change: &ConfigChange) -> Result<Edit, String> {
    let original: Value =
        serde_json::from_str(json).map_err(|_| "The allow-list isn't valid JSON.")?;
    let idx = original["agents"]
        .as_array()
        .and_then(|a| a.iter().position(|x| x["id"] == agent))
        .ok_or("The allow-list on main doesn't have this agent.")?;
    let (key, new_text, new_value) = match change {
        ConfigChange::Schedule(s) => ("\"schedule\"", format!("\"{s}\""), Value::from(s.clone())),
        ConfigChange::Cap(usd) => ("\"usd\"", format_usd(*usd), serde_json::json!(usd)),
    };
    let id_text = format!("\"id\": \"{agent}\"");
    let hits: Vec<usize> = json.match_indices(&id_text).map(|(i, _)| i).collect();
    let [at] = hits.as_slice() else {
        return Err("Atlas couldn't find this agent's entry in the allow-list.".into());
    };
    let end = json[at + 1..]
        .find("\"id\"")
        .map_or(json.len(), |i| at + 1 + i);
    let key_at = json[*at..end]
        .find(key)
        .map(|i| at + i)
        .ok_or("The allow-list entry has no value to change.")?;
    let rest = &json[key_at + key.len()..];
    let gap = rest.len() - rest.trim_start().len();
    if !rest.trim_start().starts_with(':') {
        return Err("The allow-list entry has no value to change.".into());
    }
    let after_colon = &rest[gap + 1..];
    let value_start =
        key_at + key.len() + gap + 1 + (after_colon.len() - after_colon.trim_start().len());
    let value = &json[value_start..];
    let value_len = if let Some(inner) = value.strip_prefix('"') {
        inner
            .find('"')
            .map(|i| i + 2)
            .ok_or("The allow-list entry is malformed.")?
    } else {
        value
            .find(|c: char| !(c.is_ascii_digit() || ".-+eE".contains(c)))
            .unwrap_or(value.len())
    };
    let text = format!(
        "{}{}{}",
        &json[..value_start],
        new_text,
        &json[value_start + value_len..]
    );

    let mut expected = original.clone();
    match change {
        ConfigChange::Schedule(_) => expected["agents"][idx]["schedule"] = new_value,
        ConfigChange::Cap(_) => expected["agents"][idx]["cap"]["usd"] = new_value,
    }
    let parsed: Value =
        serde_json::from_str(&text).map_err(|_| "The edit would break the allow-list.")?;
    if parsed != expected {
        return Err(
            "The allow-list edit would change more than this agent's value, so Atlas stopped."
                .into(),
        );
    }
    let line_of = |t: &str, pos: usize| -> String {
        let s = t[..pos].rfind('\n').map_or(0, |i| i + 1);
        let e = t[pos..].find('\n').map_or(t.len(), |i| pos + i);
        t[s..e].trim().trim_end_matches(',').to_string()
    };
    Ok(Edit {
        before: line_of(json, value_start),
        after: line_of(&text, value_start),
        text,
    })
}

// ---------------------------------------------------------------------------------------
// The pull request.

/// The three writes a config change makes. Implemented by the Keychain-backed client.
#[async_trait::async_trait]
pub trait ConfigWriteApi: Send + Sync {
    async fn has_token(&self) -> bool;
    async fn create_branch(
        &self,
        repo: &str,
        branch: &str,
        sha: &str,
    ) -> Result<WriteResponse, SendError>;
    async fn put_file(
        &self,
        repo: &str,
        path: &str,
        branch: &str,
        blob_sha: &str,
        message: &str,
        content: &str,
    ) -> Result<WriteResponse, SendError>;
    async fn open_pull(
        &self,
        repo: &str,
        branch: &str,
        title: &str,
        body: &str,
    ) -> Result<WriteResponse, SendError>;
}

#[async_trait::async_trait]
pub trait ConfigApprover: Send + Sync {
    async fn approve(&self, p: &ConfigPreview) -> bool;
    async fn confirm_owner(&self, p: &ConfigPreview) -> Result<(), String>;
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigPreview {
    pub agent: String,
    pub repo: String,
    pub path: String,
    pub what: String,
    pub before: String,
    pub after: String,
    /// The matching line of the allow-list, which the pull request updates too.
    pub list_before: String,
    pub list_after: String,
    pub branch: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigOutcome {
    pub stage: Stage,
    pub reason: Option<String>,
    pub message: String,
    pub audit_id: String,
    pub pull_number: Option<u64>,
    pub url: Option<String>,
    /// The lines the person approved, for the page to show next to the link.
    pub before: Option<String>,
    pub after: Option<String>,
}

pub fn dialog_text(p: &ConfigPreview) -> String {
    [
        format!("Opens a pull request on {} that changes the {} in {}:", p.repo, p.what, p.path),
        String::new(),
        format!("− {}", p.before),
        format!("+ {}", p.after),
        String::new(),
        format!("and the matching line of Atlas's allow-list, {MANIFEST_PATH}:"),
        format!("− {}", p.list_before),
        format!("+ {}", p.list_after),
        String::new(),
        format!("Branch: {} → {BASE_BRANCH}", p.branch),
        "Nothing changes until you merge the pull request. Undo: close it, or revert it after merging.".into(),
    ]
    .join("\n")
}

/// Plain branch names only, so nothing from outside the allow-list ends up in a ref.
pub fn valid_branch(b: &str) -> bool {
    (1..=100).contains(&b.len())
        && b.starts_with("atlas/")
        && b.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "-/".contains(c))
        && !b.contains("//")
        && !b.ends_with('/')
}

/// Repository-relative file paths the allow-list may name: the workflows folder or ops/.
pub fn valid_path(p: &str) -> bool {
    p == MANIFEST_PATH
        || (p.starts_with(".github/workflows/") || p.starts_with("ops/"))
            && p.len() <= 120
            && !p.contains("..")
            && !p.contains("//")
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c))
            && (p.ends_with(".yml") || p.ends_with(".yaml") || p.ends_with(".json"))
}

pub struct AgentConfigurer {
    pub store: Arc<Store>,
    pub read: Arc<dyn GithubApi>,
    pub write: Arc<dyn ConfigWriteApi>,
    pub approver: Arc<dyn ConfigApprover>,
    pub actor: String,
    pub clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    pub manifest: Manifest,
    in_flight: tokio::sync::Mutex<()>,
}

fn gh_message(r: &WriteResponse) -> String {
    r.body
        .get("message")
        .and_then(Value::as_str)
        .map(|m| format!(": {m}"))
        .unwrap_or_default()
}

impl AgentConfigurer {
    pub fn new(
        store: Arc<Store>,
        read: Arc<dyn GithubApi>,
        write: Arc<dyn ConfigWriteApi>,
        approver: Arc<dyn ConfigApprover>,
        actor: String,
        clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    ) -> Self {
        Self {
            store,
            read,
            write,
            approver,
            actor,
            clock,
            manifest: manifest(),
            in_flight: tokio::sync::Mutex::new(()),
        }
    }

    fn record(
        &self,
        id: &str,
        agent: &str,
        action: &str,
        path: Option<&str>,
        stage: Stage,
    ) -> AuditRecord {
        AuditRecord {
            id: id.to_string(),
            at: (self.clock)(),
            action: action.into(),
            actor: self.actor.clone(),
            github_login: self.store.load_config().agents_token_login,
            repo: self.manifest.repository.clone(),
            run_id: 0,
            pull_number: None,
            agent: Some(agent.to_string()),
            title: None,
            base: Some(BASE_BRANCH.into()),
            workflow: path.map(str::to_owned),
            run_number: None,
            attempt_before: None,
            head_sha: None,
            branch: None,
            stage,
            reason: None,
            http_status: None,
            request_id: None,
            message: None,
        }
    }

    fn outcome(&self, mut r: AuditRecord, reason: Option<&str>, message: String) -> ConfigOutcome {
        r.reason = reason.map(str::to_owned);
        r.message = Some(message.clone());
        let _ = self.store.append(&r);
        ConfigOutcome {
            stage: r.stage,
            reason: r.reason,
            message,
            audit_id: r.id,
            pull_number: r.pull_number,
            url: None,
            before: None,
            after: None,
        }
    }

    async fn read_json(&self, path: &str) -> Result<Value, String> {
        let r = self
            .read
            .get(path)
            .await
            .map_err(|e| format!("Couldn't read from GitHub: {e}"))?;
        match r.status {
            200 => Ok(r.body),
            s => Err(format!("Couldn't read from GitHub (status {s}).")),
        }
    }

    /// A text file at one commit, with its blob sha for the update.
    async fn read_file(
        &self,
        repo: &str,
        path: &str,
        sha: &str,
    ) -> Result<(String, String), String> {
        let file = self
            .read_json(&format!("/repos/{repo}/contents/{path}?ref={sha}"))
            .await?;
        let (Some(blob), Some(b64)) = (
            file.get("sha").and_then(Value::as_str),
            file.get("content").and_then(Value::as_str),
        ) else {
            return Err(format!("GitHub didn't return {path}."));
        };
        let text = base64::engine::general_purpose::STANDARD
            .decode(b64.replace(['\n', '\r'], ""))
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .ok_or_else(|| format!("{path} on GitHub isn't plain text."))?;
        Ok((blob.to_string(), text))
    }

    pub async fn propose(&self, agent_id: &str, change: ConfigChange) -> ConfigOutcome {
        let id = uuid::Uuid::new_v4().to_string();
        let action = match change {
            ConfigChange::Schedule(_) => ACTION_AGENT_SCHEDULE,
            ConfigChange::Cap(_) => ACTION_AGENT_CAP,
        };
        let entry = self
            .manifest
            .agents
            .iter()
            .find(|a| a.id == agent_id)
            .cloned();
        let logged = if entry.is_some() {
            agent_id
        } else {
            "(not on the allow-list)"
        };
        let refuse = |path: Option<&str>, reason: &str, msg: String| {
            self.outcome(
                self.record(&id, logged, action, path, Stage::Refused),
                Some(reason),
                msg,
            )
        };
        let Some(agent) = entry else {
            return refuse(
                None,
                "not_allowed",
                "That agent isn't on Atlas's Manage agents allow-list.".into(),
            );
        };
        let repo = self.manifest.repository.clone();
        let (path, what) = match &change {
            ConfigChange::Schedule(_) => (
                format!(".github/workflows/{}", agent.workflow),
                "schedule".to_string(),
            ),
            ConfigChange::Cap(_) => match &agent.cap {
                Some(c) => (c.file.clone(), format!("monthly cap ({})", c.key)),
                None => return refuse(None, "no_cap", "This agent has no cap to change.".into()),
            },
        };
        if !valid_repo(&repo) || !valid_path(&path) {
            return refuse(
                Some(&path),
                "invalid_target",
                "The allow-list names a file Atlas won't change.".into(),
            );
        }
        // Check the value before anything else touches GitHub.
        let problem = match &change {
            ConfigChange::Schedule(s) => schedule_problem(s, agent.paid),
            ConfigChange::Cap(usd) => {
                cap_problem(*usd, agent.cap.as_ref().map_or(0.0, |c| c.max_usd))
            }
        };
        if let Some(p) = problem {
            return refuse(Some(&path), "invalid_value", p);
        }
        let Ok(_guard) = self.in_flight.try_lock() else {
            return refuse(
                Some(&path),
                "busy",
                "Another agent change is already running. Wait for it to finish.".into(),
            );
        };
        if !self.write.has_token().await {
            return refuse(
                Some(&path),
                "no_token",
                "Save a Manage agents token in Settings first.".into(),
            );
        }
        let now = (self.clock)();
        if let Some(why) = agent_rate_block(&self.store.audit(), &agent.id, now) {
            return refuse(Some(&path), "rate_limited", why);
        }

        // Read main and the file at that commit, then make the edit.
        let main = match self
            .read_json(&format!("/repos/{repo}/git/ref/heads/{BASE_BRANCH}"))
            .await
        {
            Ok(v) => v,
            Err(e) => return refuse(Some(&path), "preflight_failed", e),
        };
        let Some(main_sha) = main
            .pointer("/object/sha")
            .and_then(Value::as_str)
            .filter(|s| s.len() == 40)
            .map(str::to_owned)
        else {
            return refuse(
                Some(&path),
                "preflight_failed",
                "GitHub didn't say which commit main is on.".into(),
            );
        };
        let (blob_sha, text) = match self.read_file(&repo, &path, &main_sha).await {
            Ok(f) => f,
            Err(e) => return refuse(Some(&path), "preflight_failed", e),
        };
        let (list_sha, list_text) = match self.read_file(&repo, MANIFEST_PATH, &main_sha).await {
            Ok(f) => f,
            Err(e) => return refuse(Some(&path), "preflight_failed", e),
        };
        let edit = match &change {
            ConfigChange::Schedule(s) => edit_schedule(&text, s),
            ConfigChange::Cap(usd) => edit_cap(&text, &agent.cap.as_ref().unwrap().key, *usd),
        };
        let edit = match edit {
            Ok(e) => e,
            Err(e) => return refuse(Some(&path), "cannot_edit", e),
        };
        let list_edit = match edit_manifest(&list_text, &agent.id, &change) {
            Ok(e) => e,
            Err(e) => return refuse(Some(&path), "cannot_edit", e),
        };

        let stamp = now.format("%Y%m%d-%H%M%S");
        let field = if matches!(change, ConfigChange::Schedule(_)) {
            "schedule"
        } else {
            "cap"
        };
        let branch = format!("atlas/{}-{field}-{stamp}", agent.id);
        if !valid_branch(&branch) {
            return refuse(
                Some(&path),
                "invalid_target",
                "Atlas couldn't name a safe branch.".into(),
            );
        }
        let title = match &change {
            ConfigChange::Schedule(s) => {
                format!("Manage agents: change {}'s schedule to {s}", agent.id)
            }
            ConfigChange::Cap(usd) => {
                format!("Manage agents: set {}'s monthly cap to ${usd:.2}", agent.id)
            }
        };
        let preview = ConfigPreview {
            agent: agent.id.clone(),
            repo: repo.clone(),
            path: path.clone(),
            what,
            before: edit.before.clone(),
            after: edit.after.clone(),
            list_before: list_edit.before.clone(),
            list_after: list_edit.after.clone(),
            branch: branch.clone(),
            title: title.clone(),
        };
        let diff = format!("{} → {}", edit.before, edit.after);

        if !self.approver.approve(&preview).await {
            let mut r = self.record(&id, &agent.id, action, Some(&path), Stage::Cancelled);
            r.message = Some(diff);
            let _ = self.store.append(&r);
            return ConfigOutcome {
                stage: Stage::Cancelled,
                reason: None,
                message: "Cancelled. Nothing was changed.".into(),
                audit_id: id,
                pull_number: None,
                url: None,
                before: None,
                after: None,
            };
        }
        if let Err(e) = self.approver.confirm_owner(&preview).await {
            return self.outcome(
                self.record(&id, &agent.id, action, Some(&path), Stage::Cancelled),
                Some("not_confirmed"),
                format!("Touch ID didn't confirm it, so nothing was changed ({e})."),
            );
        }

        let mut attempted = self.record(&id, &agent.id, action, Some(&path), Stage::Attempted);
        attempted.branch = Some(branch.clone());
        attempted.head_sha = Some(main_sha.clone());
        attempted.title = Some(title.clone());
        attempted.message = Some(diff.clone());
        if let Err(e) = self.store.append(&attempted) {
            return ConfigOutcome {
                stage: Stage::Refused,
                reason: Some("audit_failed".into()),
                message: format!("Nothing was sent because the audit log couldn't be written: {e}"),
                audit_id: id,
                pull_number: None,
                url: None,
                before: None,
                after: None,
            };
        }

        let fail = |stage: Stage, reason: &str, msg: String, status: Option<u16>| {
            let mut r = self.record(&id, &agent.id, action, Some(&path), stage);
            r.branch = Some(branch.clone());
            r.http_status = status;
            self.outcome(r, Some(reason), msg)
        };
        let send = |res: Result<WriteResponse, SendError>,
                    step: &str,
                    ok: &[u16]|
         -> Result<WriteResponse, Box<ConfigOutcome>> {
            match res {
                Ok(r) if ok.contains(&r.status) => Ok(r),
                Ok(r) if r.status == 401 => Err(Box::new(fail(Stage::Failed, "token_rejected", format!("GitHub rejected the Manage agents token while {step}. Replace it in Settings."), Some(r.status)))),
                Ok(r) if r.status == 403 || r.status == 404 => Err(Box::new(fail(Stage::Failed, "forbidden", format!("GitHub refused {step}{}. The token needs Contents, Pull requests and Workflows: Read and write on {repo}.", gh_message(&r)), Some(r.status)))),
                Ok(r) => Err(Box::new(fail(Stage::Failed, "github_error", format!("GitHub returned {} while {step}{}.", r.status, gh_message(&r)), Some(r.status)))),
                Err(SendError::NotSent(m)) => Err(Box::new(fail(Stage::Failed, "not_sent", format!("Nothing reached GitHub while {step}: {m}"), None))),
                Err(SendError::Unknown(m)) => Err(Box::new(fail(Stage::Unknown, "unknown", format!("{m} while {step}. Check {repo} for a branch named {branch}."), None))),
            }
        };

        if let Err(o) = send(
            self.write.create_branch(&repo, &branch, &main_sha).await,
            "creating the branch",
            &[201],
        ) {
            return *o;
        }
        let message = format!(
            "{title}\n\nOpened from Atlas Manage agents.\n\n- {}\n+ {}",
            edit.before, edit.after
        );
        if let Err(o) = send(
            self.write
                .put_file(&repo, &path, &branch, &blob_sha, &message, &edit.text)
                .await,
            "committing the change to the new branch",
            &[200, 201],
        ) {
            return *o;
        }
        if let Err(o) = send(
            self.write
                .put_file(
                    &repo,
                    MANIFEST_PATH,
                    &branch,
                    &list_sha,
                    &message,
                    &list_edit.text,
                )
                .await,
            "updating the allow-list on the new branch",
            &[200, 201],
        ) {
            return *o;
        }
        let body = format!(
            "Opened from **Atlas → Agents → Manage agents** by {} after a confirm dialog and Touch ID.\n\nChanges the {} in `{path}`:\n\n```diff\n- {}\n+ {}\n```\n\nand the matching line of Atlas's allow-list, `{MANIFEST_PATH}`, so the app and its tests agree with the file:\n\n```diff\n- {}\n+ {}\n```\n\nNothing changes until this is merged. Rollback: close this pull request, or revert it after merging.",
            self.actor, preview.what, edit.before, edit.after, list_edit.before, list_edit.after
        );
        let pr = match send(
            self.write.open_pull(&repo, &branch, &title, &body).await,
            "opening the pull request",
            &[201],
        ) {
            Ok(r) => r,
            Err(o) => return *o,
        };
        let number = pr.body.get("number").and_then(Value::as_u64);
        let url = pr
            .body
            .get("html_url")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let mut r = self.record(&id, &agent.id, action, Some(&path), Stage::Opened);
        r.branch = Some(branch);
        r.pull_number = number;
        r.title = Some(title);
        r.http_status = Some(pr.status);
        r.request_id = pr.request_id.clone();
        let msg = format!(
            "Opened pull request #{}. Merge it to apply the change.",
            number.unwrap_or(0)
        );
        let mut out = self.outcome(r, None, msg);
        out.url = url;
        out.before = Some(edit.before);
        out.after = Some(edit.after);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intel::collect::GhResponse;
    use std::sync::Mutex;

    const WF: &str = "name: Merge flow\n\non:\n  schedule:\n    - cron: \"23 */4 * * *\"\n  workflow_dispatch:\n";
    const POLICY: &str = "{\n  \"version\": 1,\n  \"brief\": {\n    \"model\": \"x\",\n    \"monthlyBudgetUsd\": 1.0,\n    \"maxPerDay\": 4\n  }\n}\n";

    const LIST: &str = include_str!("../../../src/manage/agents.json");

    #[test]
    fn allow_list_edit_changes_only_that_agent() {
        let e = edit_manifest(
            LIST,
            "github-opportunity-scout",
            &ConfigChange::Schedule("41 13 * * 1".into()),
        )
        .unwrap();
        assert_eq!(e.before, "\"schedule\": \"41 13 * * 1,4\"");
        assert_eq!(e.after, "\"schedule\": \"41 13 * * 1\"");
        assert_eq!(e.text.matches("41 13 * * 1,4").count(), 0);
        assert!(e.text.contains("\"23 */4 * * *\""));
        let e = edit_manifest(LIST, "github-merge-flow", &ConfigChange::Cap(2.5)).unwrap();
        let v: Value = serde_json::from_str(&e.text).unwrap();
        assert_eq!(v["agents"][0]["cap"]["usd"], 2.5);
        assert_eq!(v["agents"][1]["cap"]["usd"], 1);
        assert!(edit_manifest(LIST, "nope", &ConfigChange::Cap(2.0)).is_err());
    }

    #[test]
    fn schedules_follow_the_same_rules_as_the_page() {
        assert_eq!(schedule_problem("23 */4 * * *", true), None);
        assert_eq!(schedule_problem("41 13 * * 1,4", true), None);
        assert_eq!(schedule_problem("*/15 * * * *", false), None);
        assert!(schedule_problem("*/10 * * * *", false)
            .unwrap()
            .contains("15 minutes"));
        assert!(schedule_problem("0 */2 * * *", true)
            .unwrap()
            .contains("4 hours"));
        assert!(schedule_problem("0 0 31 2 *", false)
            .unwrap()
            .contains("never runs"));
        for bad in [
            "",
            "* * * *",
            "0 0 * JAN *",
            "0 0 * * MON",
            "60 * * * *",
            "0  0 * * *",
            "0 0 * * 1\"",
            "0 0 * * 1\n- cron: x",
            "@daily",
        ] {
            assert!(schedule_problem(bad, false).is_some(), "{bad:?}");
        }
    }

    #[test]
    fn caps_are_whole_cents_up_to_the_hard_maximum() {
        assert_eq!(cap_problem(0.0, 5.0), None);
        assert_eq!(cap_problem(1.5, 5.0), None);
        assert_eq!(cap_problem(5.0, 5.0), None);
        assert!(cap_problem(5.01, 5.0).is_some());
        assert!(cap_problem(-1.0, 5.0).is_some());
        assert!(cap_problem(1.234, 5.0).is_some());
        assert!(cap_problem(f64::NAN, 5.0).is_some());
        assert!(cap_problem(50.0, 100.0).unwrap().contains("$5.00"));
    }

    #[test]
    fn schedule_edit_changes_exactly_one_line() {
        let e = edit_schedule(WF, "23 */6 * * *").unwrap();
        assert_eq!(e.before, "- cron: \"23 */4 * * *\"");
        assert_eq!(e.after, "- cron: \"23 */6 * * *\"");
        assert_eq!(e.text, WF.replace("*/4", "*/6"));
        assert!(edit_schedule(WF, "23 */4 * * *").is_err());
        let two = WF.replace(
            "    - cron: \"23 */4 * * *\"\n",
            "    - cron: \"1 * * * *\"\n    - cron: \"2 * * * *\"\n",
        );
        assert!(edit_schedule(&two, "0 0 * * *")
            .unwrap_err()
            .contains("2 schedule lines"));
    }

    #[test]
    fn cap_edit_changes_only_the_cap() {
        let e = edit_cap(POLICY, "brief.monthlyBudgetUsd", 2.5).unwrap();
        assert_eq!(e.before, "\"monthlyBudgetUsd\": 1.0");
        assert_eq!(e.after, "\"monthlyBudgetUsd\": 2.5");
        assert_eq!(e.text, POLICY.replace("1.0,", "2.5,"));
        assert_eq!(
            edit_cap(POLICY, "brief.monthlyBudgetUsd", 2.0)
                .unwrap()
                .after,
            "\"monthlyBudgetUsd\": 2.0"
        );
        assert!(edit_cap(POLICY, "brief.monthlyBudgetUsd", 1.0).is_err());
        assert!(edit_cap(POLICY, "brief.nope", 1.0).is_err());
        let dup = POLICY.replace("\"version\": 1", "\"monthlyBudgetUsd\": 9");
        assert!(edit_cap(&dup, "brief.monthlyBudgetUsd", 2.0)
            .unwrap_err()
            .contains("appears 2 times"));
    }

    #[test]
    fn branch_and_path_shapes() {
        assert!(valid_branch(
            "atlas/github-merge-flow-schedule-20261030-120000"
        ));
        for bad in [
            "main",
            "atlas/",
            "atlas/../main",
            "atlas/A",
            "atlas/a b",
            "refs/heads/x",
        ] {
            assert!(!valid_branch(bad), "{bad}");
        }
        assert!(valid_path(".github/workflows/merge-flow.yml"));
        assert!(valid_path("ops/merge-flow/policy.json"));
        assert!(valid_path("src/manage/agents.json"));
        for bad in [
            "src/main.rs",
            "ops/../x.json",
            ".github/workflows/x.sh",
            "/etc/passwd",
            "ops/a b.json",
        ] {
            assert!(!valid_path(bad), "{bad}");
        }
    }

    struct FakeRead;
    #[async_trait::async_trait]
    impl GithubApi for FakeRead {
        async fn get(&self, path: &str) -> Result<GhResponse, String> {
            let body = if path.ends_with("/git/ref/heads/main") {
                serde_json::json!({ "object": { "sha": "a".repeat(40) } })
            } else if path.contains("/contents/.github/workflows/merge-flow.yml?ref=") {
                serde_json::json!({ "sha": "blob1", "content": base64::engine::general_purpose::STANDARD.encode(WF) })
            } else if path.contains("/contents/src/manage/agents.json?ref=") {
                serde_json::json!({ "sha": "blob3", "content": base64::engine::general_purpose::STANDARD.encode(LIST) })
            } else if path.contains("/contents/ops/merge-flow/policy.json?ref=") {
                serde_json::json!({ "sha": "blob2", "content": base64::engine::general_purpose::STANDARD.encode(POLICY) })
            } else {
                panic!("unexpected read {path}");
            };
            Ok(GhResponse {
                status: 200,
                body,
                rate_remaining: None,
                rate_reset: None,
            })
        }
        async fn has_token(&self) -> bool {
            true
        }
    }

    #[derive(Default)]
    struct FakeWrite {
        calls: Mutex<Vec<String>>,
        files: Mutex<Vec<(String, String)>>,
    }
    fn ok(status: u16, body: Value) -> Result<WriteResponse, SendError> {
        Ok(WriteResponse {
            status,
            body,
            request_id: None,
            rate_remaining: None,
            rate_reset: None,
            retry_after: None,
        })
    }
    #[async_trait::async_trait]
    impl ConfigWriteApi for FakeWrite {
        async fn has_token(&self) -> bool {
            true
        }
        async fn create_branch(
            &self,
            _repo: &str,
            branch: &str,
            sha: &str,
        ) -> Result<WriteResponse, SendError> {
            assert!(valid_branch(branch));
            assert_eq!(sha.len(), 40);
            self.calls.lock().unwrap().push(format!("branch {branch}"));
            ok(201, Value::Null)
        }
        async fn put_file(
            &self,
            _repo: &str,
            path: &str,
            branch: &str,
            _blob: &str,
            _msg: &str,
            content: &str,
        ) -> Result<WriteResponse, SendError> {
            assert_ne!(branch, "main");
            self.calls.lock().unwrap().push(format!("file {path}"));
            self.files
                .lock()
                .unwrap()
                .push((path.into(), content.into()));
            ok(201, Value::Null)
        }
        async fn open_pull(
            &self,
            _repo: &str,
            _branch: &str,
            title: &str,
            _body: &str,
        ) -> Result<WriteResponse, SendError> {
            self.calls.lock().unwrap().push(format!("pull {title}"));
            ok(
                201,
                serde_json::json!({ "number": 140, "html_url": "https://github.com/khaneilcampbell/ai-ops-atlas/pull/140" }),
            )
        }
    }

    struct Yes(bool);
    #[async_trait::async_trait]
    impl ConfigApprover for Yes {
        async fn approve(&self, p: &ConfigPreview) -> bool {
            assert!(dialog_text(p).contains("− "));
            self.0
        }
        async fn confirm_owner(&self, _p: &ConfigPreview) -> Result<(), String> {
            Ok(())
        }
    }

    fn configurer(approve: bool) -> (AgentConfigurer, Arc<FakeWrite>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let write = Arc::new(FakeWrite::default());
        let c = AgentConfigurer::new(
            Arc::new(Store::new(dir.path().to_path_buf()).unwrap()),
            Arc::new(FakeRead),
            write.clone(),
            Arc::new(Yes(approve)),
            "kc (test)".into(),
            Box::new(|| Utc.with_ymd_and_hms(2026, 10, 30, 12, 0, 0).unwrap()),
        );
        (c, write, dir)
    }

    #[tokio::test]
    async fn a_schedule_change_opens_a_pull_request_never_a_commit_to_main() {
        let (c, w, _d) = configurer(true);
        let out = c
            .propose(
                "github-merge-flow",
                ConfigChange::Schedule("23 */6 * * *".into()),
            )
            .await;
        assert_eq!(out.stage, Stage::Opened, "{}", out.message);
        assert_eq!(out.pull_number, Some(140));
        let calls = w.calls.lock().unwrap();
        assert_eq!(calls.len(), 4);
        assert_eq!(calls[2], "file src/manage/agents.json");
        assert!(calls[0].starts_with("branch atlas/github-merge-flow-schedule-20261030-120000"));
        assert_eq!(calls[1], "file .github/workflows/merge-flow.yml");
        assert_eq!(w.files.lock().unwrap()[0].1, WF.replace("*/4", "*/6"));
        let log = c.store.audit();
        assert_eq!(
            log.iter().map(|r| r.stage).collect::<Vec<_>>(),
            vec![Stage::Attempted, Stage::Opened]
        );
        assert_eq!(log[1].pull_number, Some(140));
    }

    #[tokio::test]
    async fn a_cap_change_edits_only_the_cap() {
        let (c, w, _d) = configurer(true);
        let out = c.propose("github-merge-flow", ConfigChange::Cap(2.0)).await;
        assert_eq!(out.stage, Stage::Opened, "{}", out.message);
        assert_eq!(
            w.files.lock().unwrap()[0],
            (
                "ops/merge-flow/policy.json".to_string(),
                POLICY.replace("1.0,", "2.0,")
            )
        );
    }

    #[tokio::test]
    async fn bad_values_unknown_agents_and_cancel_send_nothing() {
        let (c, w, _d) = configurer(true);
        assert_eq!(
            c.propose(
                "github-merge-flow",
                ConfigChange::Schedule("*/5 * * * *".into())
            )
            .await
            .reason
            .as_deref(),
            Some("invalid_value")
        );
        assert_eq!(
            c.propose("github-merge-flow", ConfigChange::Cap(6.0))
                .await
                .reason
                .as_deref(),
            Some("invalid_value")
        );
        assert_eq!(
            c.propose("ci", ConfigChange::Cap(1.0))
                .await
                .reason
                .as_deref(),
            Some("not_allowed")
        );
        assert_eq!(
            c.propose("github-merge-flow", ConfigChange::Cap(1.0))
                .await
                .reason
                .as_deref(),
            Some("cannot_edit")
        );
        assert!(w.calls.lock().unwrap().is_empty());
        let (c, w, _d) = configurer(false);
        assert_eq!(
            c.propose("github-merge-flow", ConfigChange::Cap(2.0))
                .await
                .stage,
            Stage::Cancelled
        );
        assert!(w.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn change_payload_shape() {
        let c: ConfigChange =
            serde_json::from_str(r#"{"field":"schedule","value":"0 * * * *"}"#).unwrap();
        assert!(matches!(c, ConfigChange::Schedule(s) if s == "0 * * * *"));
        let c: ConfigChange = serde_json::from_str(r#"{"field":"cap","value":2.5}"#).unwrap();
        assert!(matches!(c, ConfigChange::Cap(v) if v == 2.5));
        assert!(serde_json::from_str::<ConfigChange>(r#"{"field":"file","value":"x"}"#).is_err());
    }
}
