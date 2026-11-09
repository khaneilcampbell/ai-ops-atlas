//! ChatGPT Codex usage, read from the session logs Codex already keeps on this Mac
//! (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`, `~/.codex` by default). Read on the API
//! Usage tab's open and Refresh only, never on a timer. Only numbers leave this module: token
//! counts, the model, the session's start time and its folder name. Prompts, replies and file
//! contents in the logs are never parsed, kept or sent.
//!
//! ChatGPT plan usage has no API and no price per token, so each row is marked `cost_type: "plan"`
//! (no cost). Chats on chatgpt.com don't write these logs and can't be counted.

use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Sessions older than this are left out; the tab shows 30 days at most.
const MAX_AGE: Duration = Duration::from_secs(35 * 86_400);
const MAX_FILES: usize = 3_000;
/// Token count and context lines are small; anything bigger is a message and is skipped unread.
const MAX_META_LINE: usize = 256 * 1024;
const AGENT: &str = "Codex (ChatGPT)";

fn codex_home() -> Option<PathBuf> {
    if let Some(h) = std::env::var_os("CODEX_HOME").filter(|h| !h.is_empty()) {
        return Some(PathBuf::from(h));
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".codex"))
}

/// Rollout files modified within MAX_AGE, newest layout first. Follows the YYYY/MM/DD folders only.
fn rollout_files(root: &Path, now: SystemTime) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0u8)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let path = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() && depth < 3 {
                stack.push((path, depth + 1));
            } else if ft.is_file()
                && path.extension().is_some_and(|x| x == "jsonl")
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("rollout-"))
            {
                let fresh = e
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|m| now.duration_since(m).ok())
                    .is_some_and(|age| age <= MAX_AGE);
                if fresh {
                    out.push(path);
                }
            }
            if out.len() >= MAX_FILES {
                return out;
            }
        }
    }
    out
}

fn num(v: &serde_json::Value, key: &str) -> u64 {
    v.get(key).and_then(|x| x.as_u64()).unwrap_or(0)
}

/// One session's usage in the import format (docs/api-usage.md), or None when it made no model call.
pub fn summarize_rollout(reader: impl BufRead) -> Option<serde_json::Value> {
    let mut started: Option<String> = None;
    let mut first_seen: Option<String> = None;
    let mut folder: Option<String> = None;
    let mut model: Option<String> = None;
    let mut total: Option<serde_json::Value> = None;
    let mut calls = 0u64;
    for line in reader.split(b'\n').map_while(Result::ok) {
        if line.len() > MAX_META_LINE {
            continue;
        }
        // Cheap filter before parsing: only these three line kinds carry what we count.
        let head = &line[..line.len().min(160)];
        let has = |needle: &[u8]| head.windows(needle.len()).any(|w| w == needle);
        let token = line.windows(13).any(|w| w == b"\"token_count\"");
        let ctx = has(b"\"turn_context\"");
        let meta = has(b"\"session_meta\"");
        if !(token || ctx || meta) {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<serde_json::Value>(&line) else {
            continue;
        };
        if first_seen.is_none() {
            first_seen = v
                .get("timestamp")
                .and_then(|t| t.as_str())
                .map(str::to_owned);
        }
        let payload = v.get("payload").unwrap_or(&serde_json::Value::Null);
        match v.get("type").and_then(|t| t.as_str()) {
            Some("session_meta") => {
                started = payload
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .map(str::to_owned)
                    .or(started);
                // The folder's name only, never the full path.
                folder = payload
                    .get("cwd")
                    .and_then(|c| c.as_str())
                    .and_then(|c| Path::new(c).file_name())
                    .and_then(|n| n.to_str())
                    .map(str::to_owned)
                    .or(folder);
            }
            Some("turn_context") => {
                if let Some(m) = payload.get("model").and_then(|m| m.as_str()) {
                    model = Some(m.to_owned());
                }
                if folder.is_none() {
                    folder = payload
                        .get("cwd")
                        .and_then(|c| c.as_str())
                        .and_then(|c| Path::new(c).file_name())
                        .and_then(|n| n.to_str())
                        .map(str::to_owned);
                }
            }
            Some("event_msg")
                if payload.get("type").and_then(|t| t.as_str()) == Some("token_count") =>
            {
                if let Some(info) = payload.get("info").filter(|i| !i.is_null()) {
                    calls += 1;
                    // Cumulative for the session, so the last one is the session's total.
                    if let Some(t) = info.get("total_token_usage") {
                        total = Some(t.clone());
                    }
                }
            }
            _ => {}
        }
    }
    let t = total?;
    let input = num(&t, "input_tokens");
    // OpenAI counts cached input inside input_tokens; Atlas keeps uncached input and cache reads apart.
    let cached = num(&t, "cached_input_tokens").min(input);
    let output = num(&t, "output_tokens");
    if input == 0 && output == 0 {
        return None;
    }
    Some(serde_json::json!({
        "at": started.or(first_seen)?,
        "provider": "openai",
        "model": model,
        "agent": AGENT,
        "project": folder,
        "requests": calls.max(1),
        "input_tokens": input - cached,
        "output_tokens": output,
        "cache_read_tokens": cached,
        "cache_write_tokens": num(&t, "cache_write_input_tokens"),
        "cost_type": "plan",
    }))
}

fn read_all(root: &Path, now: SystemTime) -> Vec<serde_json::Value> {
    rollout_files(root, now)
        .into_iter()
        .filter_map(|p| File::open(p).ok())
        // A guard against an unexpectedly huge file: Codex logs are a few MB at most.
        .filter_map(|f| summarize_rollout(BufReader::new(f.take(200 * 1024 * 1024))))
        .collect()
}

/// Codex sessions of the last 35 days, one usage row each. `None` when Codex isn't on this Mac.
#[tauri::command]
pub async fn codex_usage() -> Result<Option<Vec<serde_json::Value>>, String> {
    let Some(home) = codex_home() else {
        return Ok(None);
    };
    let roots: Vec<PathBuf> = ["sessions", "archived_sessions"]
        .iter()
        .map(|d| home.join(d))
        .filter(|p| p.is_dir())
        .collect();
    if roots.is_empty() {
        return Ok(None);
    }
    let now = SystemTime::now();
    tauri::async_runtime::spawn_blocking(move || {
        roots
            .iter()
            .flat_map(|r| read_all(r, now))
            .collect::<Vec<_>>()
    })
    .await
    .map(Some)
    .map_err(|e| format!("Couldn't read Codex's session logs: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"timestamp":"2026-11-08T10:00:00.000Z","type":"session_meta","payload":{"id":"x","timestamp":"2026-11-08T10:00:00.000Z","cwd":"/Users/k/Documents/ai-ops-atlas","originator":"codex_cli_rs","cli_version":"1.0.0","instructions":"secret instructions"}}
{"timestamp":"2026-11-08T10:00:01.000Z","type":"turn_context","payload":{"cwd":"/Users/k/Documents/ai-ops-atlas","model":"gpt-5.1-codex"}}
{"timestamp":"2026-11-08T10:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"private prompt mentioning \"token_count\""}]}}
{"timestamp":"2026-11-08T10:00:05.000Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":null}}
{"timestamp":"2026-11-08T10:00:06.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":200,"reasoning_output_tokens":50,"total_tokens":1200},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":200,"reasoning_output_tokens":50,"total_tokens":1200}}}}
{"timestamp":"2026-11-08T10:01:06.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":5000,"cached_input_tokens":3000,"output_tokens":700,"reasoning_output_tokens":90,"total_tokens":5700},"last_token_usage":{"input_tokens":4000,"cached_input_tokens":2600,"output_tokens":500,"reasoning_output_tokens":40,"total_tokens":4500}}}}
"#;

    #[test]
    fn totals_one_session_with_numbers_only() {
        let row = summarize_rollout(SAMPLE.as_bytes()).expect("a row");
        assert_eq!(row["at"], "2026-11-08T10:00:00.000Z");
        assert_eq!(row["provider"], "openai");
        assert_eq!(row["model"], "gpt-5.1-codex");
        assert_eq!(row["project"], "ai-ops-atlas");
        assert_eq!(row["requests"], 2);
        assert_eq!(row["input_tokens"], 2000);
        assert_eq!(row["cache_read_tokens"], 3000);
        assert_eq!(row["output_tokens"], 700);
        assert_eq!(row["cost_type"], "plan");
        let text = row.to_string();
        assert!(!text.contains("private"));
        assert!(!text.contains("secret"));
        assert!(!text.contains("/Users"));
    }

    #[test]
    fn a_session_without_model_calls_has_no_row() {
        let first_two: String = SAMPLE.lines().take(3).collect::<Vec<_>>().join("\n");
        assert!(summarize_rollout(first_two.as_bytes()).is_none());
        assert!(summarize_rollout("not json\n".as_bytes()).is_none());
    }
}
