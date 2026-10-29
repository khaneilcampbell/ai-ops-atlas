//! Daily timing and change detection, ported from `src/steward/schedule.ts`.

use super::types::{Notice, Run, RunStatus, Schedule};
use chrono::{DateTime, Local, Timelike};

pub fn valid_time(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && t[..2].parse::<u32>().is_ok_and(|h| h < 24)
        && t[3..].parse::<u32>().is_ok_and(|m| m < 60)
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 2 || c.is_ascii_digit())
}

pub fn local_day(now: DateTime<Local>) -> String {
    now.format("%Y-%m-%d").to_string()
}

/// Due once per local calendar day, at or after the chosen time. No backlog of missed days.
pub fn due(s: &Schedule, now: DateTime<Local>) -> bool {
    if !s.enabled
        || !valid_time(&s.time)
        || s.last_attempt_day.as_deref() == Some(local_day(now).as_str())
    {
        return false;
    }
    let h: u32 = s.time[..2].parse().unwrap_or(0);
    let m: u32 = s.time[3..].parse().unwrap_or(0);
    now.hour() * 60 + now.minute() >= h * 60 + m
}

/// Labels of checks whose actionable state changed. Commit churn and healthy sample-size
/// changes stay quiet; coverage loss and recovery are reported.
pub fn changed(previous: Option<&Run>, next: &Run) -> Vec<String> {
    if !next.observed() {
        return vec![];
    }
    next.checks
        .iter()
        .filter(|c| c.id != "commit")
        .filter(
            |c| match previous.and_then(|p| p.checks.iter().find(|o| o.id == c.id)) {
                None => c.state != super::types::CheckState::Clear,
                Some(o) => {
                    o.state != c.state
                        || (c.state != super::types::CheckState::Clear
                            && (o.detail != c.detail || o.signature != c.signature))
                }
            },
        )
        .map(|c| c.label.clone())
        .collect()
}

/// The notice to show after `run`, given the history before it. Keeps the current notice
/// when nothing new happened, so a dismissed notice doesn't return on an identical run.
pub fn notice(
    history: &[Run],
    run: &Run,
    changes: &mut Vec<String>,
    current: Option<Notice>,
) -> Option<Notice> {
    let last_failed = history
        .first()
        .is_some_and(|r| matches!(r.status, RunStatus::Failed | RunStatus::Interrupted));
    if last_failed && run.observed() {
        changes.insert(0, "Check execution recovered".into());
    }
    if matches!(run.status, RunStatus::Failed | RunStatus::Interrupted) && !last_failed {
        return Some(Notice {
            run_id: run.id.clone(),
            message: "GitHub Steward could not finish its check. Review run history.".into(),
        });
    }
    if changes.is_empty() {
        return current;
    }
    let had_baseline = history.iter().any(Run::observed);
    let lead = if had_baseline {
        "GitHub Steward changed"
    } else {
        "GitHub Steward baseline needs review"
    };
    Some(Notice {
        run_id: run.id.clone(),
        message: format!("{lead}: {}.", changes.join(", ")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::steward::types::{Check, CheckState, Trigger};
    use chrono::TimeZone;

    fn at(day: u32, h: u32, m: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 10, day, h, m, 0).unwrap()
    }
    fn sample(state: CheckState, detail: &str, sig: Option<&str>) -> Run {
        let mut r = Run::new("run".into(), String::new(), Trigger::Manual);
        r.checks.push(Check {
            id: "ci".into(),
            label: "CI".into(),
            state,
            detail: detail.into(),
            url: "https://github.com".into(),
            signature: sig.map(Into::into),
        });
        r
    }

    #[test]
    fn one_attempt_per_local_day_after_the_time() {
        let s = Schedule {
            enabled: true,
            time: "09:00".into(),
            last_attempt_day: None,
        };
        assert!(!due(&s, at(28, 8, 59)));
        assert!(due(&s, at(28, 9, 0)));
        assert!(!due(
            &Schedule {
                last_attempt_day: Some("2026-10-28".into()),
                ..s.clone()
            },
            at(28, 23, 0)
        ));
        assert!(due(
            &Schedule {
                last_attempt_day: Some("2026-10-28".into()),
                ..s.clone()
            },
            at(29, 9, 0)
        ));
        assert!(!due(
            &Schedule {
                enabled: false,
                ..s.clone()
            },
            at(28, 10, 0)
        ));
        assert!(due(
            &Schedule {
                enabled: true,
                time: "00:00".into(),
                last_attempt_day: Some("2026-10-28".into())
            },
            at(29, 0, 0)
        ));
    }

    #[test]
    fn rejects_invalid_times() {
        for t in ["24:00", "09:60", "9:00", "", "0a:00", "09-00"] {
            assert!(!valid_time(t), "{t}");
        }
        assert!(valid_time("23:59"));
    }

    #[test]
    fn quiet_on_unchanged_and_healthy_churn_loud_on_coverage_change() {
        let clear = sample(CheckState::Clear, "10 workflows", None);
        let unknown = sample(CheckState::Unknown, "x", None);
        assert!(changed(None, &clear).is_empty());
        assert_eq!(changed(None, &unknown), ["CI"]);
        assert!(changed(Some(&unknown), &unknown).is_empty());
        assert_eq!(changed(Some(&clear), &unknown), ["CI"]);
        assert_eq!(changed(Some(&unknown), &clear), ["CI"]);
        assert!(changed(
            Some(&clear),
            &sample(CheckState::Clear, "11 workflows", None)
        )
        .is_empty());
        let a = sample(CheckState::Attention, "1 alert", Some("[1]"));
        assert_eq!(
            changed(
                Some(&a),
                &sample(CheckState::Attention, "1 alert", Some("[2]"))
            ),
            ["CI"]
        );
        let mut paused = unknown.clone();
        paused.status = RunStatus::Paused;
        assert!(changed(Some(&clear), &paused).is_empty());
    }

    #[test]
    fn dismissed_notices_stay_dismissed_and_recovery_is_announced() {
        let mut unknown = sample(CheckState::Unknown, "x", None);
        unknown.status = RunStatus::Partial;
        let mut ch = changed(Some(&unknown), &unknown);
        assert_eq!(notice(&[unknown.clone()], &unknown, &mut ch, None), None);
        let mut failed = Run::new("f".into(), String::new(), Trigger::Schedule);
        failed.status = RunStatus::Failed;
        let mut none = vec![];
        assert!(notice(&[unknown.clone()], &failed, &mut none, None)
            .unwrap()
            .message
            .contains("could not finish"));
        // A second failure in a row doesn't raise a new notice.
        assert_eq!(notice(&[failed.clone()], &failed, &mut vec![], None), None);
        let mut ch = vec![];
        assert!(notice(&[failed], &unknown, &mut ch, None)
            .unwrap()
            .message
            .contains("recovered"));
    }
}
