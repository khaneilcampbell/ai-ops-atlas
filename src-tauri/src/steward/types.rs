//! Shapes shared with the panel. Field names match `src/steward/check.ts` (camelCase), so
//! history saved by the browser build can be imported unchanged.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CheckState {
    Clear,
    Attention,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Completed,
    Partial,
    Paused,
    Failed,
    /// Atlas quit or crashed while this run was collecting.
    Interrupted,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Trigger {
    #[default]
    Manual,
    Schedule,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Check {
    pub id: String,
    pub label: String,
    pub state: CheckState,
    pub detail: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub started_at: String,
    pub finished_at: String,
    pub status: RunStatus,
    #[serde(default)]
    pub trigger: Trigger,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    pub requests: u32,
    pub checks: Vec<Check>,
    /// GitHub's remaining hourly budget after the last answered request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_remaining: Option<u32>,
    /// A fixed label such as `timeout` or `http_403`, never a raw error message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_class: Option<String>,
}

impl Run {
    pub fn new(id: String, started_at: String, trigger: Trigger) -> Self {
        Self {
            id,
            started_at,
            finished_at: String::new(),
            status: RunStatus::Completed,
            trigger,
            changes: None,
            commit: None,
            requests: 0,
            checks: vec![],
            rate_remaining: None,
            error_class: None,
        }
    }

    /// Runs that observed something, as opposed to stopping or failing before they could.
    pub fn observed(&self) -> bool {
        matches!(self.status, RunStatus::Completed | RunStatus::Partial)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub enabled: bool,
    pub time: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_attempt_day: Option<String>,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            enabled: false,
            time: "09:00".into(),
            last_attempt_day: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub run_id: String,
    pub message: String,
}

/// A run that had started collecting when state was last saved. Found at launch, it means
/// Atlas stopped mid-run, and is recorded as interrupted.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Active {
    pub id: String,
    pub started_at: String,
    pub trigger: Trigger,
}

pub const STATE_VERSION: u32 = 2;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub version: u32,
    pub paused: bool,
    pub history: Vec<Run>,
    pub schedule: Schedule,
    pub notice: Option<Notice>,
    #[serde(default)]
    pub active: Option<Active>,
}

impl Default for Saved {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            paused: false,
            history: vec![],
            schedule: Schedule::default(),
            notice: None,
            active: None,
        }
    }
}
