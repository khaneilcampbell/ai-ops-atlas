//! Cost estimates and budget enforcement. Anthropic reports token counts, not dollars, so
//! every dollar figure here is an estimate: reported tokens times the configured prices.

use super::types::{AgentConfig, CostEstimate, Price, Run, Usage};
use chrono::{DateTime, Datelike, Utc};

pub fn price_for<'a>(config: &'a AgentConfig, model: &str) -> Option<&'a Price> {
    config.pricing.get(model)
}

/// Dollars for the given usage at the given price.
pub fn cost_of(u: &Usage, p: &Price) -> f64 {
    let m = 1_000_000.0;
    (u.input_tokens as f64 * p.input
        + u.output_tokens as f64 * p.output
        + u.cache_read_input_tokens as f64 * p.cache_read.unwrap_or(p.input * 0.1)
        + u.cache_creation_input_tokens as f64 * p.cache_write.unwrap_or(p.input * 1.25))
        / m
}

/// Cost for a response, pricing each attempt by the model that ran it when the server
/// reports per-attempt usage (a fallback). Unknown models are priced as the requested one.
pub fn cost_of_response(
    config: &AgentConfig,
    requested: &str,
    usage: &Usage,
    iterations: &[(Option<String>, Usage)],
) -> Option<f64> {
    let base = price_for(config, requested)?;
    if iterations.is_empty() {
        let p = usage
            .served_by
            .as_deref()
            .and_then(|m| price_for(config, m))
            .unwrap_or(base);
        return Some(cost_of(usage, p));
    }
    Some(
        iterations
            .iter()
            .map(|(m, u)| {
                cost_of(
                    u,
                    m.as_deref()
                        .and_then(|m| price_for(config, m))
                        .unwrap_or(base),
                )
            })
            .sum(),
    )
}

pub fn same_month(a: DateTime<Utc>, b: DateTime<Utc>) -> bool {
    a.year() == b.year() && a.month() == b.month()
}

/// Estimated spend this calendar month (UTC), from recorded runs.
pub fn month_spend(runs: &[Run], now: DateTime<Utc>) -> f64 {
    runs.iter()
        .filter(|r| {
            r.started_at
                .as_deref()
                .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                .is_some_and(|t| same_month(t.with_timezone(&Utc), now))
        })
        .filter_map(|r| r.cost_usd)
        .sum()
}

/// The worst case for one call, checked against the per-run cap and the monthly budget
/// before anything is sent.
pub fn check(
    config: &AgentConfig,
    model: &str,
    input_tokens_est: u32,
    max_tokens: u32,
    month_spent: f64,
) -> Result<CostEstimate, (String, Option<CostEstimate>)> {
    let Some(p) = price_for(config, model) else {
        return Err((format!("No price is configured for {model}. Add it under Settings → Repository intelligence before running."), None));
    };
    let worst = (input_tokens_est as f64 * p.input + max_tokens as f64 * p.output) / 1_000_000.0;
    let est = CostEstimate {
        model: model.to_string(),
        input_tokens_est,
        max_output_tokens: max_tokens,
        worst_case_usd: worst,
        month_spent_usd: month_spent,
        max_run_usd: config.max_run_usd,
        monthly_budget_usd: config.monthly_budget_usd,
    };
    if worst > config.max_run_usd {
        return Err((format!("This run could cost up to ${worst:.3}, above the ${:.2} per-run limit. Raise the limit or use a lighter depth.", config.max_run_usd), Some(est)));
    }
    if month_spent + worst > config.monthly_budget_usd {
        return Err((
            format!("The monthly budget of ${:.2} would be exceeded (${month_spent:.3} spent so far, this run could cost up to ${worst:.3}).", config.monthly_budget_usd),
            Some(est),
        ));
    }
    Ok(est)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intel::types::*;

    fn run_at(at: &str, cost: f64) -> Run {
        Run {
            id: "r".into(),
            kind: RunKind::Repository,
            repo: "o/r".into(),
            trigger: Trigger::Manual,
            depth: Depth::Standard,
            model: "m".into(),
            force: false,
            status: RunStatus::Succeeded,
            queued_at: at.into(),
            started_at: Some(at.into()),
            finished_at: None,
            duration_ms: None,
            error: None,
            attempts: 1,
            github_requests: 0,
            usage: None,
            estimate: None,
            cost_usd: Some(cost),
            trace: vec![],
        }
    }

    #[test]
    fn prices_reported_usage() {
        let p = Price {
            input: 2.0,
            output: 10.0,
            cache_read: Some(0.2),
            cache_write: None,
        };
        let u = Usage {
            input_tokens: 10_000,
            output_tokens: 2_000,
            cache_read_input_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
            ..Default::default()
        };
        assert!((cost_of(&u, &p) - (0.02 + 0.02 + 0.2)).abs() < 1e-9);
    }

    #[test]
    fn fallback_attempts_are_priced_by_their_model() {
        let c = AgentConfig::default();
        let u = |o| Usage {
            input_tokens: 1_000_000,
            output_tokens: o,
            ..Default::default()
        };
        let its = vec![
            (Some("claude-sonnet-5-5".to_string()), u(0)),
            (Some("claude-opus-4-8".to_string()), u(0)),
        ];
        let total = cost_of_response(&c, "claude-sonnet-5-5", &u(0), &its).unwrap();
        assert!((total - (2.0 + 5.0)).abs() < 1e-9);
        assert!(cost_of_response(&c, "unpriced-model", &u(0), &[]).is_none());
    }

    #[test]
    fn month_spend_counts_this_month_only() {
        let now = DateTime::parse_from_rfc3339("2026-10-27T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let runs = vec![
            run_at("2026-10-01T00:00:00Z", 0.10),
            run_at("2026-10-26T00:00:00Z", 0.05),
            run_at("2026-09-30T23:59:59Z", 9.0),
        ];
        assert!((month_spend(&runs, now) - 0.15).abs() < 1e-9);
    }

    #[test]
    fn enforces_run_and_monthly_limits() {
        let mut c = AgentConfig::default();
        // Standard on Sonnet 5.5: 12k in + 8k out is $0.104 worst case.
        assert!(check(&c, "claude-sonnet-5-5", 12_000, 8_000, 0.0).is_ok());
        c.max_run_usd = 0.05;
        assert!(check(&c, "claude-sonnet-5-5", 12_000, 8_000, 0.0)
            .unwrap_err()
            .0
            .contains("per-run"));
        c.max_run_usd = 1.0;
        assert!(check(&c, "claude-sonnet-5-5", 12_000, 8_000, 4.95)
            .unwrap_err()
            .0
            .contains("monthly"));
        assert!(check(&c, "no-such-model", 1, 1, 0.0)
            .unwrap_err()
            .0
            .contains("No price"));
    }

    #[test]
    fn defaults_fit_their_own_limits() {
        let c = AgentConfig::default();
        for d in [Depth::Quick, Depth::Standard, Depth::Deep] {
            let l = d.limits();
            assert!(
                check(&c, c.models.for_depth(d), l.input_tokens, l.max_tokens, 0.0).is_ok(),
                "{d:?} must run with default limits"
            );
        }
    }
}
