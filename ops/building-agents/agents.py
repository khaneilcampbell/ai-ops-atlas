#!/usr/bin/env python3
"""Building operators for Atlas: one model-free check per building, reported to the live feed.

  marketplace  Product Marketplace     the main-build release and its latest.json
  signals      Observability Center    the latest main run of each workflow, and the site answering
  census       Data Intelligence Center the catalog's projects, agents and repositories on GitHub

GET requests only. Each run posts one report to ATLAS_FEED_URL (/api/hooks/agents) with the
add-only ATLAS_FEED_TOKEN; without them (or with --dry-run) it prints the report instead.
Standard library only. See docs/live-updates.md, "Pipeline runs".
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "khaneilcampbell/ai-ops-atlas")
API = "https://api.github.com"
AGENT = {"marketplace": "marketplace-steward", "signals": "signal-watch", "census": "dataset-census"}
PHASE = {"marketplace": "Product publishing check", "signals": "Signal check", "census": "Dataset census"}
FRESH_DAYS = 30
# Workflows whose latest main run failing means Atlas itself is broken, not just one check.
REQUIRED_WORKFLOWS = {"ci.yml"}


class CheckFailed(Exception):
    """The check ran and found a problem worth a red building."""


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def get(url: str, raw: bool = False):
    headers = {"user-agent": "atlas-building-agents", "accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token and url.startswith(API):
        headers["authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as r:
        body = r.read()
    return body if raw else json.loads(body)


def ago(iso: str) -> str:
    secs = (now() - dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))).total_seconds()
    for unit, size in (("d", 86400), ("h", 3600), ("min", 60)):
        if secs >= size:
            return f"{int(secs // size)} {unit} ago"
    return "just now"


def marketplace() -> str:
    rel = get(f"{API}/repos/{REPO}/releases/tags/main-build")
    assets = {a["name"]: a for a in rel.get("assets", [])}
    if "latest.json" not in assets:
        raise CheckFailed("main-build has no latest.json, so installed Macs can't update")
    latest = json.loads(get(assets["latest.json"]["browser_download_url"], raw=True))
    version, date = latest.get("version"), latest.get("pub_date")
    signed = sorted(k for k, v in (latest.get("platforms") or {}).items() if isinstance(v, dict) and v.get("signature") and v.get("url"))
    if not version or not signed:
        raise CheckFailed(f"latest.json is incomplete (version {version or 'missing'}, {len(signed)} signed platforms)")
    when = f" published {ago(date)}" if date else ""
    return f"Atlas {version}{when} · signed update for {', '.join(signed)} · {len(assets)} release files"


def signals() -> str:
    workflows = [w for w in get(f"{API}/repos/{REPO}/actions/workflows?per_page=100")["workflows"] if w.get("state") == "active"]
    passing, failing, newest, broken = 0, [], None, []
    for w in workflows:
        runs = get(f"{API}/repos/{REPO}/actions/workflows/{w['id']}/runs?branch=main&status=completed&per_page=1")["workflow_runs"]
        if not runs:
            continue
        r = runs[0]
        newest = max(newest or r["created_at"], r["created_at"])
        name = w["path"].rsplit("/", 1)[-1]
        if r["conclusion"] in ("failure", "timed_out"):
            failing.append(name)
            if name in REQUIRED_WORKFLOWS:
                broken.append(name)
        elif r["conclusion"] == "success":
            passing += 1
    site = os.environ.get("ATLAS_SITE_URL") or re.sub(r"/api/hooks/agents/?$", "/", os.environ.get("ATLAS_FEED_URL", ""))
    answered = "not checked"
    if site:
        try:
            get(site, raw=True)
            answered = "answering"
        except urllib.error.HTTPError as e:
            # Cloudflare Access answers a signed-out visit with 302/401/403: the site is up.
            answered = "answering" if e.code < 500 else f"down ({e.code})"
        except OSError as e:
            answered = f"down ({e.__class__.__name__})"
    checked = passing + len(failing)
    detail = f"{passing} of {checked} workflows passing on main" + (f", failing: {', '.join(failing)}" if failing else "") + f" · site {answered}" + (f" · newest run {ago(newest)}" if newest else "")
    if broken or answered.startswith("down"):
        raise CheckFailed(detail)
    return detail


def census() -> str:
    files = sorted(glob.glob("catalog/*.yaml"))
    projects, agents, repos = 0, 0, set()
    for f in files:
        text = open(f, encoding="utf-8").read()
        projects += len(re.findall(r"^project:\s*$", text, re.M))
        agents += len(re.findall(r"^  - id:\s*\S", text, re.M))
        repos.update(re.findall(r"^\s*repository:\s*['\"]?([\w.-]+/[\w.-]+)", text, re.M))
    if not projects:
        raise CheckFailed("No catalog projects found")
    fresh, stale, archived, unreadable = 0, 0, 0, 0
    for repo in sorted(repos):
        try:
            info = get(f"{API}/repos/{repo}")
        except urllib.error.HTTPError:
            unreadable += 1
            continue
        if info.get("archived"):
            archived += 1
        elif info.get("pushed_at") and (now() - dt.datetime.fromisoformat(info["pushed_at"].replace("Z", "+00:00"))).days <= FRESH_DAYS:
            fresh += 1
        else:
            stale += 1
    if repos and unreadable == len(repos):
        raise CheckFailed(f"GitHub returned none of the {len(repos)} catalog repositories")
    parts = [f"{fresh} fresh", stale and f"{stale} stale (no push in {FRESH_DAYS} d)", archived and f"{archived} archived", unreadable and f"{unreadable} not readable"]
    return f"{projects} projects, {agents} agents, {len(repos)} repositories: " + ", ".join(p for p in parts if p)


def report(check: str, status: str, detail: str, dry: bool) -> None:
    body = {"project": "ai-ops-atlas", "agents": [AGENT[check]], "phase": PHASE[check], "status": status, "detail": detail[:300], "at": now().isoformat()}
    url, token = os.environ.get("ATLAS_FEED_URL"), os.environ.get("ATLAS_FEED_TOKEN")
    print(json.dumps(body))
    if dry or not url or not token:
        print("Not sent: dry run or ATLAS_FEED_URL / ATLAS_FEED_TOKEN not set.", file=sys.stderr)
        return
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={"content-type": "application/json", "authorization": f"Bearer {token}", "user-agent": "atlas-building-agents"})
    with urllib.request.urlopen(req, timeout=20) as r:
        print(f"Atlas accepted the report ({r.status}).")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("check", choices=[*AGENT, "all"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    failed = False
    for check in AGENT if args.check == "all" else [args.check]:
        try:
            status, detail = "ok", {"marketplace": marketplace, "signals": signals, "census": census}[check]()
        except CheckFailed as e:
            status, detail, failed = "failed", str(e), True
        except Exception as e:  # the check itself broke: still tell Atlas, so the building goes red
            status, detail, failed = "failed", f"Check could not run: {e.__class__.__name__}: {e}"[:300], True
        report(check, status, detail, args.dry_run)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
