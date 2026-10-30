"""Shared plumbing for the Autopilot automations: config, saved state, HTTP and alert delivery.

Everything here is standard library only, so a run needs no install step. Each automation reads one
JSON config next to it, keeps a small state file between runs (the workflow saves it in the Actions
cache), and reports through whichever channels are configured:

  email    RESEND_API_KEY + NOTIFY_EMAIL_TO + NOTIFY_EMAIL_FROM   (Resend, https://resend.com)
  webhook  NOTIFY_WEBHOOK_URL                                     (Slack, Discord or any JSON hook)
  Atlas    ATLAS_FEED_URL + ATLAS_FEED_TOKEN                      (Atlas live feed, behind Access)

With none configured, a run that raises an alert fails its job, and GitHub's own failed-run email
is the alert.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
USER_AGENT = "atlas-autopilot"


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat(timespec="seconds")


def parse_time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load_config(path, required):
    """The automation's JSON config. Refuses to run when disabled or when a required key is missing."""
    config = json.loads(Path(path).read_text())
    if config.get("version") != 1:
        raise ValueError(f"{path}: version must be 1")
    if not config.get("enabled"):
        raise SystemExit(f"{Path(path).name}: enabled is false, nothing to do")
    missing = [k for k in required if k not in config]
    if missing:
        raise ValueError(f"{path}: missing {', '.join(missing)}")
    return config


def load_state(path):
    try:
        state = json.loads(Path(path).read_text())
        return state if state.get("version") == 1 else {"version": 1}
    except (OSError, ValueError):
        return {"version": 1}


def save_state(path, state):
    """Writes the state and reports whether it changed, so the workflow only saves a new cache entry then."""
    text = json.dumps(state, sort_keys=True, separators=(",", ":"))
    try:
        if Path(path).read_text() == text:
            return False
    except OSError:
        pass
    Path(path).write_text(text)
    return True


def request(url, *, method="GET", headers=None, body=None, timeout=20, attempts=2, follow_redirects=True):
    """One HTTP call. Returns (status, headers, body bytes) for any HTTP status; raises only on network errors.

    A 502, 503 or 504 gets one retry after a short pause, since gateways answer those transiently.
    """
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"User-Agent": USER_AGENT, **(headers or {})}
    if data is not None:
        hdrs.setdefault("Content-Type", "application/json")
    opener = urllib.request.build_opener() if follow_redirects else urllib.request.build_opener(_NoRedirect)
    for attempt in range(attempts):
        req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        try:
            with opener.open(req, timeout=timeout) as res:
                return res.status, dict(res.headers), res.read()
        except urllib.error.HTTPError as e:
            if e.code in {502, 503, 504} and attempt < attempts - 1:
                time.sleep(3)
                continue
            return e.code, dict(e.headers or {}), e.read() if e.fp else b""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def github_token(*names):
    for name in names:
        if os.environ.get(name):
            return os.environ[name]
    return None


def github(path, token, *, method="GET", body=None, timeout=20):
    """GitHub REST call. Returns (status, parsed JSON or None)."""
    status, _, raw = request(
        "https://api.github.com" + path, method=method, body=body, timeout=timeout,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    )
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, None


def graphql(query, token, timeout=20):
    status, _, raw = request(
        "https://api.github.com/graphql", method="POST", body={"query": query}, timeout=timeout,
        headers={"Authorization": f"Bearer {token}"},
    )
    if status != 200:
        raise RuntimeError(f"GitHub GraphQL answered {status}")
    return json.loads(raw), len(raw)


def paused_agents():
    """Agents the spend guard paused, from the repository variable the workflows pass in as ATLAS_PAUSED_AGENTS."""
    raw = os.environ.get("ATLAS_PAUSED_AGENTS", "")
    return {a.strip() for a in raw.split(",") if a.strip() and a.strip() != "none"}


def channels():
    """Which alert channels this run can use (names only, for logs)."""
    out = []
    if all(os.environ.get(k) for k in ("RESEND_API_KEY", "NOTIFY_EMAIL_TO", "NOTIFY_EMAIL_FROM")):
        out.append("email")
    if os.environ.get("NOTIFY_WEBHOOK_URL"):
        out.append("webhook")
    if os.environ.get("ATLAS_FEED_URL") and os.environ.get("ATLAS_FEED_TOKEN"):
        out.append("atlas")
    return out


def notify(subject, text):
    """Sends one message by email and webhook, when configured. Returns the channels that accepted it."""
    sent = []
    key, to, sender = os.environ.get("RESEND_API_KEY"), os.environ.get("NOTIFY_EMAIL_TO"), os.environ.get("NOTIFY_EMAIL_FROM")
    if key and to and sender:
        try:
            status, _, _ = request("https://api.resend.com/emails", method="POST", timeout=15, headers={"Authorization": f"Bearer {key}"},
                                   body={"from": sender, "to": [a.strip() for a in to.split(",") if a.strip()], "subject": subject[:150], "text": text})
            if status < 300:
                sent.append("email")
            else:
                print(f"Email not accepted ({status})", file=sys.stderr)
        except OSError as e:
            print(f"Email failed: {type(e).__name__}", file=sys.stderr)
    hook = os.environ.get("NOTIFY_WEBHOOK_URL")
    if hook:
        message = f"*{subject}*\n{text}"[:3800]
        try:
            # "text" is read by Slack and most chat hooks, "content" by Discord.
            status, _, _ = request(hook, method="POST", timeout=15, body={"text": message, "content": message[:1900]})
            if status < 300:
                sent.append("webhook")
            else:
                print(f"Webhook not accepted ({status})", file=sys.stderr)
        except OSError as e:
            print(f"Webhook failed: {type(e).__name__}", file=sys.stderr)
    return sent


def post_feed(agent, phase, status, detail, now):
    """One line to Atlas's agent feed. A `failed` report also triggers Atlas's own alert email when that is set up."""
    url, token = os.environ.get("ATLAS_FEED_URL"), os.environ.get("ATLAS_FEED_TOKEN")
    if not url or not token:
        return False
    body = {"project": agent["project"], "agents": [agent["id"]], "phase": phase, "status": status, "detail": detail[:300], "at": iso(now)}
    try:
        code, _, _ = request(url, method="POST", body=body, timeout=10, attempts=1, headers={"Authorization": f"Bearer {token}"})
        return code < 300
    except OSError:
        print("Atlas feed did not accept the report", file=sys.stderr)
        return False


def write_summary(text):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(text)


def set_output(name, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as f:
            f.write(f"{name}={value}\n")


def money(usd):
    return f"${usd:,.2f}"
