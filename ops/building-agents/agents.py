#!/usr/bin/env python3
"""Building operators for Atlas: one model-free check per building, reported to the live feed.

  marketplace  Product Marketplace     the main-build release and its latest.json
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
AGENT = {"marketplace": "marketplace-steward", "census": "dataset-census"}
PHASE = {"marketplace": "Product publishing check", "census": "Dataset census"}
FRESH_DAYS = 30


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


def report(check: str, status: str, detail: str, dry: bool) -> bool:
    """Prints the report and sends it. False only when sending was tried and failed."""
    body = {"project": "ai-ops-atlas", "agents": [AGENT[check]], "phase": PHASE[check], "status": status, "detail": detail[:300], "at": now().isoformat()}
    url, token = os.environ.get("ATLAS_FEED_URL"), os.environ.get("ATLAS_FEED_TOKEN")
    print(json.dumps(body))
    if dry or not url or not token:
        print("Not sent: dry run or ATLAS_FEED_URL / ATLAS_FEED_TOKEN not set.", file=sys.stderr)
        return True
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={"content-type": "application/json", "authorization": f"Bearer {token}", "user-agent": "atlas-building-agents"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"Atlas accepted the report ({r.status}).")
        return True
    except urllib.error.HTTPError as e:
        hint = " ATLAS_FEED_TOKEN doesn't match the site's AGENT_FEED_TOKEN." if e.code == 401 else ""
        print(f"::error::Atlas refused the {check} report ({e.code}).{hint}", file=sys.stderr)
    except OSError as e:
        print(f"::error::Couldn't reach Atlas to send the {check} report: {e}", file=sys.stderr)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("check", choices=[*AGENT, "all"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    failed = False
    for check in AGENT if args.check == "all" else [args.check]:
        try:
            status, detail = "ok", {"marketplace": marketplace, "census": census}[check]()
        except CheckFailed as e:
            status, detail, failed = "failed", str(e), True
        except Exception as e:  # the check itself broke: still tell Atlas, so the building goes red
            status, detail, failed = "failed", f"Check could not run: {e.__class__.__name__}: {e}"[:300], True
        # A report Atlas refused fails the run too, so a broken feed never looks fine.
        if not report(check, status, detail, args.dry_run):
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
