//! Claude Messages API client. There is no official Anthropic SDK for Rust, so this is a
//! small raw-HTTP client on the app's existing reqwest stack. The key is read from the
//! Keychain for each request and never leaves this module.
//!
//! One analysis is one request: no agent loop, no tools. Retries are bounded, back off
//! exponentially, honor `retry-after`, and stop at once when the run is cancelled.

use super::types::{TraceStep, Usage};
use serde_json::Value;
use std::time::{Duration, Instant};
use tokio::sync::watch;

pub const API_URL: &str = "https://api.anthropic.com/v1/messages";
pub const API_VERSION: &str = "2026-10-21";

pub struct HttpReply {
    pub status: u16,
    pub body: Value,
    pub retry_after: Option<Duration>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum NetError {
    Timeout,
    Network(String),
    NoKey,
}

#[async_trait::async_trait]
pub trait ModelApi: Send + Sync {
    async fn send(
        &self,
        body: &Value,
        betas: &[&str],
        timeout: Duration,
    ) -> Result<HttpReply, NetError>;
}

pub struct Anthropic {
    http: reqwest::Client,
}

impl Anthropic {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("ai-ops-atlas/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client");
        Self { http }
    }
}

#[async_trait::async_trait]
impl ModelApi for Anthropic {
    async fn send(
        &self,
        body: &Value,
        betas: &[&str],
        timeout: Duration,
    ) -> Result<HttpReply, NetError> {
        let key = crate::secrets::read_anthropic_key().ok_or(NetError::NoKey)?;
        let mut req = self
            .http
            .post(API_URL)
            .timeout(timeout)
            .header("x-api-key", key)
            .header("anthropic-version", API_VERSION)
            .json(body);
        if !betas.is_empty() {
            req = req.header("anthropic-beta", betas.join(","));
        }
        // Errors are reported without the request, which carries the key header.
        let res = req.send().await.map_err(|e| {
            if e.is_timeout() {
                NetError::Timeout
            } else {
                NetError::Network(format!(
                    "Network error reaching Anthropic ({})",
                    e.without_url()
                ))
            }
        })?;
        let status = res.status().as_u16();
        let retry_after = res
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<f64>().ok())
            .map(|s| Duration::from_secs_f64(s.clamp(0.0, 600.0)));
        let body = res.json().await.map_err(|e| {
            if e.is_timeout() {
                NetError::Timeout
            } else {
                NetError::Network("Anthropic sent a response that wasn't JSON".into())
            }
        })?;
        Ok(HttpReply {
            status,
            body,
            retry_after,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum InferError {
    NoKey,
    Auth,
    Permission(String),
    Billing(String),
    BadRequest(String),
    NotFound(String),
    RateLimited,
    Overloaded,
    Server(u16, String),
    Timeout,
    Network(String),
    Refusal(Option<String>),
    Truncated,
    NoText,
    Cancelled,
}

impl InferError {
    pub fn kind(&self) -> &'static str {
        match self {
            InferError::NoKey => "anthropic_no_key",
            InferError::Auth => "anthropic_auth",
            InferError::Permission(_) => "anthropic_permission",
            InferError::Billing(_) => "anthropic_billing",
            InferError::BadRequest(_) => "anthropic_bad_request",
            InferError::NotFound(_) => "anthropic_model_not_found",
            InferError::RateLimited => "anthropic_rate_limit",
            InferError::Overloaded => "anthropic_overloaded",
            InferError::Server(..) => "anthropic_server_error",
            InferError::Timeout => "timeout",
            InferError::Network(_) => "network",
            InferError::Refusal(_) => "refusal",
            InferError::Truncated => "truncated",
            InferError::NoText => "invalid_response",
            InferError::Cancelled => "cancelled",
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self,
            InferError::RateLimited
                | InferError::Overloaded
                | InferError::Server(..)
                | InferError::Timeout
                | InferError::Network(_)
        )
    }

    pub fn message(&self) -> String {
        match self {
            InferError::NoKey => "No Anthropic API key is saved. Add one in Settings → Repository intelligence.".into(),
            InferError::Auth => "Anthropic rejected the saved API key. Replace it in Settings.".into(),
            InferError::Permission(m) => format!("The API key isn't allowed to do this: {m}"),
            InferError::Billing(m) => format!("Anthropic billing problem (check your credit balance): {m}"),
            InferError::BadRequest(m) => format!("Anthropic rejected the request: {m}"),
            InferError::NotFound(m) => format!("Model not found. Check the model name in Settings. ({m})"),
            InferError::RateLimited => "Anthropic rate limit reached; gave up after retrying.".into(),
            InferError::Overloaded => "Anthropic is overloaded; gave up after retrying.".into(),
            InferError::Server(s, m) => format!("Anthropic server error {s}: {m}"),
            InferError::Timeout => "The request to Anthropic timed out.".into(),
            InferError::Network(m) => m.clone(),
            InferError::Refusal(c) => format!("Claude declined to analyze this repository{}.", c.as_deref().map(|c| format!(" (category: {c})")).unwrap_or_default()),
            InferError::Truncated => "Claude's answer hit the output limit before it finished. Try the deep setting, which allows a longer answer.".into(),
            InferError::NoText => "Claude's response had no text to read.".into(),
            InferError::Cancelled => "Cancelled.".into(),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
    pub timeout: Duration,
}

impl RetryPolicy {
    /// Delay before the given retry (1-based), honoring the server's hint when it gives one.
    pub fn delay(&self, retry: u32, hint: Option<Duration>, jitter_ms: u64) -> Duration {
        let exp = self.base_delay.saturating_mul(1u32 << (retry - 1).min(10));
        hint.unwrap_or(exp).min(self.max_delay) + Duration::from_millis(jitter_ms)
    }
}

#[derive(Debug, Clone)]
pub struct Inference {
    pub text: String,
    pub usage: Usage,
    /// Per-attempt token usage when the server reports it (fallbacks); else the top level.
    pub iterations: Iterations,
    pub attempts: u32,
}

fn u(v: &Value, k: &str) -> u64 {
    v.get(k).and_then(Value::as_u64).unwrap_or(0)
}

fn usage_of(v: &Value) -> Usage {
    Usage {
        input_tokens: u(v, "input_tokens"),
        output_tokens: u(v, "output_tokens"),
        cache_creation_input_tokens: u(v, "cache_creation_input_tokens"),
        cache_read_input_tokens: u(v, "cache_read_input_tokens"),
        served_by: None,
        fallback: false,
    }
}

/// Per-attempt usage, labeled with the model that ran the attempt when reported.
pub type Iterations = Vec<(Option<String>, Usage)>;

/// Reads a 200 response. Token usage is returned even when the content is unusable,
/// because those tokens were still billed.
pub fn parse_success(body: &Value) -> (Result<String, InferError>, Usage, Iterations) {
    let raw = body.get("usage").cloned().unwrap_or(Value::Null);
    let mut usage = usage_of(&raw);
    usage.served_by = body.get("model").and_then(Value::as_str).map(str::to_owned);
    let mut iterations = Vec::new();
    if let Some(its) = raw.get("iterations").and_then(Value::as_array) {
        for it in its {
            if it.get("type").and_then(Value::as_str) == Some("fallback_message") {
                usage.fallback = true;
            }
            iterations.push((
                it.get("model").and_then(Value::as_str).map(str::to_owned),
                usage_of(it),
            ));
        }
    }
    let stop = body
        .get("stop_reason")
        .and_then(Value::as_str)
        .unwrap_or("");
    let text: String = body
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default();
    let result = match stop {
        "refusal" => Err(InferError::Refusal(
            body.pointer("/stop_details/category")
                .and_then(Value::as_str)
                .map(str::to_owned),
        )),
        "max_tokens" => Err(InferError::Truncated),
        _ if text.trim().is_empty() => Err(InferError::NoText),
        _ => Ok(text),
    };
    (result, usage, iterations)
}

fn classify(status: u16, body: &Value) -> InferError {
    let msg = body
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(300)
        .collect::<String>();
    match status {
        400 => InferError::BadRequest(msg),
        401 => InferError::Auth,
        402 => InferError::Billing(msg),
        403 => InferError::Permission(msg),
        404 => InferError::NotFound(msg),
        408 => InferError::Timeout,
        413 => InferError::BadRequest(msg),
        429 => InferError::RateLimited,
        529 => InferError::Overloaded,
        s => InferError::Server(s, msg),
    }
}

pub fn step(trace: &mut Vec<TraceStep>, name: &str, ok: bool, detail: String, ms: Option<u64>) {
    trace.push(TraceStep {
        at: chrono::Utc::now().to_rfc3339(),
        step: name.into(),
        ok,
        detail,
        ms,
    });
}

/// Waits for cancellation; never resolves if the run isn't cancelled.
pub async fn cancelled(rx: &mut watch::Receiver<bool>) {
    if rx.wait_for(|c| *c).await.is_err() {
        std::future::pending::<()>().await;
    }
}

/// Sends one analysis request with bounded retries. Returns the parsed text and usage, or
/// the error with the number of attempts and any usage billed on the way.
pub async fn infer(
    api: &dyn ModelApi,
    body: &Value,
    betas: &[&str],
    policy: RetryPolicy,
    cancel: &mut watch::Receiver<bool>,
    trace: &mut Vec<TraceStep>,
) -> Result<Inference, (InferError, u32, Option<Usage>)> {
    let max = policy.max_attempts.clamp(1, 6);
    let mut attempt = 0;
    loop {
        attempt += 1;
        if *cancel.borrow() {
            return Err((InferError::Cancelled, attempt - 1, None));
        }
        let started = Instant::now();
        let sent = tokio::select! {
            r = api.send(body, betas, policy.timeout) => r,
            _ = cancelled(cancel) => {
                step(trace, "inference", false, format!("Attempt {attempt} abandoned on cancel. Anthropic may still bill tokens for it."), Some(started.elapsed().as_millis() as u64));
                return Err((InferError::Cancelled, attempt, None));
            }
        };
        let ms = Some(started.elapsed().as_millis() as u64);
        let (err, hint) = match sent {
            Ok(r) if (200..300).contains(&r.status) => {
                let (result, usage, iterations) = parse_success(&r.body);
                return match result {
                    Ok(text) => {
                        step(
                            trace,
                            "inference",
                            true,
                            format!(
                                "Attempt {attempt}: {} input and {} output tokens reported",
                                usage.input_tokens, usage.output_tokens
                            ),
                            ms,
                        );
                        Ok(Inference {
                            text,
                            usage,
                            iterations,
                            attempts: attempt,
                        })
                    }
                    Err(e) => {
                        step(
                            trace,
                            "inference",
                            false,
                            format!("Attempt {attempt}: {}", e.message()),
                            ms,
                        );
                        Err((e, attempt, Some(usage)))
                    }
                };
            }
            Ok(r) => (classify(r.status, &r.body), r.retry_after),
            Err(NetError::NoKey) => return Err((InferError::NoKey, attempt - 1, None)),
            Err(NetError::Timeout) => (InferError::Timeout, None),
            Err(NetError::Network(m)) => (InferError::Network(m), None),
        };
        let note = if matches!(err, InferError::Timeout) {
            " Tokens may have been billed for the timed-out attempt."
        } else {
            ""
        };
        step(
            trace,
            "inference",
            false,
            format!("Attempt {attempt}: {}{note}", err.message()),
            ms,
        );
        if !err.retryable() || attempt >= max {
            return Err((err, attempt, None));
        }
        let wait = policy.delay(attempt, hint, rand::random::<u64>() % 250);
        step(
            trace,
            "backoff",
            true,
            format!(
                "Waiting {:.1}s before attempt {}",
                wait.as_secs_f64(),
                attempt + 1
            ),
            None,
        );
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = cancelled(cancel) => return Err((InferError::Cancelled, attempt, None)),
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Plays back scripted replies; records each request body.
    pub struct FakeModel {
        pub replies: Mutex<VecDeque<Result<HttpReply, NetError>>>,
        pub bodies: Mutex<Vec<Value>>,
        pub betas: Mutex<Vec<Vec<String>>>,
        pub delay: Duration,
    }

    impl FakeModel {
        pub fn new(replies: Vec<Result<HttpReply, NetError>>) -> Self {
            Self {
                replies: Mutex::new(replies.into()),
                bodies: Mutex::new(vec![]),
                betas: Mutex::new(vec![]),
                delay: Duration::ZERO,
            }
        }
        pub fn calls(&self) -> usize {
            self.bodies.lock().unwrap().len()
        }
    }

    pub fn ok_reply(text: &str) -> Result<HttpReply, NetError> {
        Ok(HttpReply {
            status: 200,
            body: json!({"model": "claude-sonnet-5-5", "stop_reason": "end_turn", "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": text}], "usage": {"input_tokens": 3000, "output_tokens": 1000}}),
            retry_after: None,
        })
    }

    pub fn status_reply(status: u16, kind: &str) -> Result<HttpReply, NetError> {
        Ok(HttpReply {
            status,
            body: json!({"type": "error", "error": {"type": kind, "message": kind}}),
            retry_after: None,
        })
    }

    #[async_trait::async_trait]
    impl ModelApi for FakeModel {
        async fn send(
            &self,
            body: &Value,
            betas: &[&str],
            _timeout: Duration,
        ) -> Result<HttpReply, NetError> {
            self.bodies.lock().unwrap().push(body.clone());
            self.betas
                .lock()
                .unwrap()
                .push(betas.iter().map(|b| b.to_string()).collect());
            if !self.delay.is_zero() {
                tokio::time::sleep(self.delay).await;
            }
            self.replies
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Err(NetError::Network("no scripted reply".into())))
        }
    }

    fn policy() -> RetryPolicy {
        RetryPolicy {
            max_attempts: 3,
            base_delay: Duration::from_millis(1),
            max_delay: Duration::from_millis(5),
            timeout: Duration::from_secs(1),
        }
    }

    async fn run(
        model: &FakeModel,
    ) -> (
        Result<Inference, (InferError, u32, Option<Usage>)>,
        Vec<TraceStep>,
    ) {
        let (_tx, mut rx) = watch::channel(false);
        let mut trace = vec![];
        let r = infer(model, &json!({}), &[], policy(), &mut rx, &mut trace).await;
        (r, trace)
    }

    #[tokio::test]
    async fn retries_rate_limits_and_overload_then_succeeds() {
        let m = FakeModel::new(vec![
            status_reply(429, "rate_limit_error"),
            status_reply(529, "overloaded_error"),
            ok_reply("{}"),
        ]);
        let (r, trace) = run(&m).await;
        let inf = r.unwrap();
        assert_eq!(inf.attempts, 3);
        assert_eq!(inf.usage.output_tokens, 1000);
        assert_eq!(trace.iter().filter(|s| s.step == "backoff").count(), 2);
    }

    #[tokio::test]
    async fn gives_up_after_max_attempts() {
        let m = FakeModel::new(vec![
            status_reply(500, "api_error"),
            status_reply(500, "api_error"),
            status_reply(500, "api_error"),
            ok_reply("{}"),
        ]);
        let (r, _) = run(&m).await;
        let (e, attempts, _) = r.unwrap_err();
        assert!(matches!(e, InferError::Server(500, _)));
        assert_eq!(attempts, 3);
        assert_eq!(m.calls(), 3, "bounded: never a fourth call");
    }

    #[tokio::test]
    async fn does_not_retry_client_errors() {
        for (status, kind) in [
            (400, "invalid_request_error"),
            (401, "authentication_error"),
            (402, "billing_error"),
            (404, "not_found_error"),
        ] {
            let m = FakeModel::new(vec![status_reply(status, kind), ok_reply("{}")]);
            let (r, _) = run(&m).await;
            assert!(!r.unwrap_err().0.retryable());
            assert_eq!(m.calls(), 1, "{status} is not retried");
        }
    }

    #[tokio::test]
    async fn refusal_and_truncation_are_errors_with_usage() {
        let refusal = Ok(HttpReply {
            status: 200,
            body: json!({"stop_reason": "refusal", "stop_details": {"type": "refusal", "category": "cyber"}, "content": [], "usage": {"input_tokens": 10, "output_tokens": 0}}),
            retry_after: None,
        });
        let m = FakeModel::new(vec![refusal]);
        let (e, _, usage) = run(&m).await.0.unwrap_err();
        assert_eq!(e, InferError::Refusal(Some("cyber".into())));
        assert_eq!(usage.unwrap().input_tokens, 10);
        let cut = Ok(HttpReply {
            status: 200,
            body: json!({"stop_reason": "max_tokens", "content": [{"type": "text", "text": "{\"summ"}], "usage": {"input_tokens": 10, "output_tokens": 8000}}),
            retry_after: None,
        });
        let m = FakeModel::new(vec![cut]);
        let (e, _, usage) = run(&m).await.0.unwrap_err();
        assert_eq!(e, InferError::Truncated);
        assert_eq!(
            usage.unwrap().output_tokens,
            8000,
            "billed tokens are kept for cost tracking"
        );
    }

    #[tokio::test]
    async fn missing_key_makes_no_request_attempt() {
        let m = FakeModel::new(vec![Err(NetError::NoKey)]);
        let (e, attempts, _) = run(&m).await.0.unwrap_err();
        assert_eq!(e, InferError::NoKey);
        assert_eq!(attempts, 0);
    }

    #[test]
    fn backoff_grows_and_honors_hints() {
        let p = RetryPolicy {
            max_attempts: 5,
            base_delay: Duration::from_secs(2),
            max_delay: Duration::from_secs(30),
            timeout: Duration::from_secs(1),
        };
        assert_eq!(p.delay(1, None, 0), Duration::from_secs(2));
        assert_eq!(p.delay(2, None, 0), Duration::from_secs(4));
        assert_eq!(p.delay(3, None, 0), Duration::from_secs(8));
        assert_eq!(p.delay(9, None, 0), Duration::from_secs(30), "capped");
        assert_eq!(
            p.delay(1, Some(Duration::from_secs(7)), 0),
            Duration::from_secs(7)
        );
        assert_eq!(
            p.delay(1, Some(Duration::from_secs(300)), 0),
            Duration::from_secs(30)
        );
    }

    #[test]
    fn fallback_usage_is_read_per_iteration() {
        let body = json!({
            "model": "claude-opus-4-8", "stop_reason": "end_turn",
            "content": [{"type": "fallback", "from": {"model": "claude-sonnet-5-5"}, "to": {"model": "claude-opus-4-8"}}, {"type": "text", "text": "{}"}],
            "usage": {"input_tokens": 100, "output_tokens": 50, "iterations": [
                {"type": "message", "model": "claude-sonnet-5-5", "input_tokens": 100, "output_tokens": 0},
                {"type": "fallback_message", "model": "claude-opus-4-8", "input_tokens": 100, "output_tokens": 50}
            ]}
        });
        let (r, usage, its) = parse_success(&body);
        assert!(r.is_ok());
        assert!(usage.fallback);
        assert_eq!(usage.served_by.as_deref(), Some("claude-opus-4-8"));
        assert_eq!(its.len(), 2);
    }
}
