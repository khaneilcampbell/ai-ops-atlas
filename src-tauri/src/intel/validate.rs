//! Checks Claude's structured output before anything is saved. The API constrains the
//! response to the schema, but the response is still treated as untrusted: it is parsed
//! strictly, sizes are bounded, and every citation must point at data the model was given.

use super::types::{AiAnalysis, Observation, ValidationSummary};
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq)]
pub struct ValidationError(pub String);

const MAX_TEXT: usize = 1_500;
const MAX_ITEMS: usize = 8;

fn clip(s: &mut String, trimmed: &mut u32) {
    if s.chars().count() > MAX_TEXT {
        *s = s.chars().take(MAX_TEXT).collect::<String>() + "…";
        *trimmed += 1;
    }
}

fn clip_list<T>(v: &mut Vec<T>, max: usize, trimmed: &mut u32) {
    if v.len() > max {
        v.truncate(max);
        *trimmed += 1;
    }
}

/// Keeps only references that exist; returns whether any remain.
fn check_refs(evidence: &mut Vec<String>, known: &BTreeSet<String>, dropped: &mut u32) -> bool {
    let before = evidence.len();
    let mut seen = BTreeSet::new();
    evidence.retain_mut(|e| {
        *e = e.trim().trim_matches(|c| c == '[' || c == ']').to_string();
        known.contains(e.as_str()) && seen.insert(e.clone())
    });
    *dropped += (before - evidence.len()) as u32;
    evidence.truncate(6);
    !evidence.is_empty()
}

pub fn validate(
    text: &str,
    known: &BTreeSet<String>,
) -> Result<(AiAnalysis, ValidationSummary), ValidationError> {
    let trimmed_text = text.trim();
    let json = trimmed_text
        .strip_prefix("```json")
        .or_else(|| trimmed_text.strip_prefix("```"))
        .and_then(|t| t.strip_suffix("```"))
        .unwrap_or(trimmed_text);
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| ValidationError(format!("Response isn't valid JSON: {e}")))?;
    let mut a: AiAnalysis = serde_json::from_value(value)
        .map_err(|e| ValidationError(format!("Response doesn't match the report schema: {e}")))?;

    if a.summary.trim().is_empty() {
        return Err(ValidationError("The summary is empty.".into()));
    }
    if a.purpose.trim().is_empty() && !a.insufficient_data {
        return Err(ValidationError(
            "The purpose is empty but the data wasn't marked insufficient.".into(),
        ));
    }

    let mut sum = ValidationSummary::default();
    let t = &mut sum.trimmed_fields;
    for s in [
        &mut a.summary,
        &mut a.purpose,
        &mut a.architecture,
        &mut a.implementation_status,
    ] {
        clip(s, t);
    }
    clip_list(&mut a.technologies, 20, t);
    clip_list(&mut a.agent_integrations, 12, t);
    clip_list(&mut a.data_gaps, MAX_ITEMS, t);
    for s in a
        .technologies
        .iter_mut()
        .chain(a.agent_integrations.iter_mut())
        .chain(a.data_gaps.iter_mut())
    {
        clip(s, t);
    }
    clip_list(&mut a.health, 6, t);
    clip_list(&mut a.recommendations, MAX_ITEMS, t);

    let dropped = &mut sum.dropped_refs;
    let mut ungrounded = 0;
    for h in &mut a.health {
        clip(&mut h.rationale, t);
        h.grounded = check_refs(&mut h.evidence, known, dropped);
        ungrounded += u32::from(!h.grounded);
    }
    let lists: [&mut Vec<Observation>; 4] = [
        &mut a.maintenance_issues,
        &mut a.documentation_gaps,
        &mut a.technical_debt,
        &mut a.security_observations,
    ];
    for list in lists {
        clip_list(list, MAX_ITEMS, t);
        list.retain(|o| !o.text.trim().is_empty());
        for o in list.iter_mut() {
            clip(&mut o.text, t);
            o.grounded = check_refs(&mut o.evidence, known, dropped);
            ungrounded += u32::from(!o.grounded);
        }
    }
    a.recommendations.retain(|r| !r.title.trim().is_empty());
    for r in &mut a.recommendations {
        clip(&mut r.title, t);
        clip(&mut r.rationale, t);
        r.grounded = check_refs(&mut r.evidence, known, dropped);
        ungrounded += u32::from(!r.grounded);
    }
    // Highest priority first, whatever order the model used.
    a.recommendations.sort_by_key(|r| r.priority as u8);
    sum.ungrounded_items = ungrounded;
    Ok((a, sum))
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::intel::types::Priority;
    use serde_json::json;

    pub fn sample() -> serde_json::Value {
        json!({
            "summary": "A dashboard.", "purpose": "Shows things.", "architecture": "React app.",
            "maturity": "active_development", "implementation_status": "Core views done.",
            "technologies": ["React"], "agent_integrations": [],
            "health": [{"area": "ci", "rating": "poor", "rationale": "Latest CI failed.", "evidence": ["run:900"]}],
            "maintenance_issues": [{"text": "Failing CI", "evidence": ["run:900", "run:404404"]}],
            "documentation_gaps": [], "technical_debt": [],
            "security_observations": [{"text": "Check token handling", "evidence": []}],
            "recommendations": [
                {"priority": "low", "title": "Add docs", "rationale": "Helps.", "evidence": ["readme"]},
                {"priority": "high", "title": "Fix CI", "rationale": "Broken.", "evidence": ["[run:900]"]}
            ],
            "insufficient_data": false, "data_gaps": []
        })
    }

    fn known() -> BTreeSet<String> {
        ["run:900", "readme", "meta"]
            .into_iter()
            .map(String::from)
            .collect()
    }

    #[test]
    fn accepts_valid_output_and_drops_invented_refs() {
        let (a, sum) = validate(&sample().to_string(), &known()).unwrap();
        assert_eq!(a.maintenance_issues[0].evidence, vec!["run:900"]);
        assert_eq!(sum.dropped_refs, 1);
        assert!(!a.security_observations[0].grounded);
        assert_eq!(sum.ungrounded_items, 1);
        assert_eq!(
            a.recommendations[0].priority,
            Priority::High,
            "sorted by priority"
        );
        assert_eq!(
            a.recommendations[0].evidence,
            vec!["run:900"],
            "brackets stripped"
        );
    }

    #[test]
    fn rejects_non_json_and_wrong_shapes() {
        assert!(validate("Sure! Here's the analysis: ...", &known()).is_err());
        let mut v = sample();
        v["maturity"] = json!("legendary");
        assert!(validate(&v.to_string(), &known()).is_err());
        let mut v = sample();
        v.as_object_mut().unwrap().remove("recommendations");
        assert!(validate(&v.to_string(), &known()).is_err());
        let mut v = sample();
        v["summary"] = json!("   ");
        assert!(validate(&v.to_string(), &known()).is_err());
    }

    #[test]
    fn rejects_fields_outside_the_schema() {
        // A model steered by injected text might try to add its own verdicts.
        let mut v = sample();
        v["verified_security_status"] = json!("fully secure");
        let e = validate(&v.to_string(), &known()).unwrap_err();
        assert!(e.0.contains("schema"));
        let mut v = sample();
        v["recommendations"][0]["action"] = json!({"tool": "merge_pull_request"});
        assert!(validate(&v.to_string(), &known()).is_err());
    }

    #[test]
    fn bounds_sizes() {
        let mut v = sample();
        v["summary"] = json!("x".repeat(10_000));
        v["recommendations"] = json!((0..30).map(|i| json!({"priority": "low", "title": format!("r{i}"), "rationale": "", "evidence": []})).collect::<Vec<_>>());
        let (a, sum) = validate(&v.to_string(), &known()).unwrap();
        assert!(a.summary.chars().count() <= MAX_TEXT + 1);
        assert_eq!(a.recommendations.len(), MAX_ITEMS);
        assert!(sum.trimmed_fields >= 2);
    }

    #[test]
    fn tolerates_a_code_fence() {
        let fenced = format!("```json\n{}\n```", sample());
        assert!(validate(&fenced, &known()).is_ok());
    }
}
