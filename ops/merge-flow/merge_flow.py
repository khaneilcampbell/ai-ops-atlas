"""Merge Flow: sort KC's open pull requests into lanes so ready work reaches production sooner.

One small GraphQL read per run covers every allowlisted repository. Nothing else happens when the
triage is unchanged: no Claude call, no report, no writes. Claude writes a short brief only when the
triage changed and something needs action, within a daily and monthly cap. It never writes to GitHub.

  python3 ops/merge-flow/merge_flow.py triage --state state.json --work work.json
  python3 ops/merge-flow/merge_flow.py brief --state state.json --work work.json   # needs `anthropic`
"""
import argparse
import hashlib
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).parent
GRAPHQL = "https://api.github.com/graphql"
REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
# Lanes in the order they are decided and shown. The first one that matches wins.
LANES = ["draft", "conflicts", "failing", "changes", "running", "behind", "ready", "review", "blocked", "unknown"]
LABELS = {
    "ready": "Ready to merge", "failing": "Checks failing", "conflicts": "Conflicts", "behind": "Behind base",
    "changes": "Changes requested", "running": "Checks running", "review": "Needs review",
    "blocked": "Blocked by a rule", "draft": "Draft", "unknown": "GitHub still computing",
}
ACTIONABLE = {"ready", "failing", "conflicts", "behind", "changes"}
FAILED = {"FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"}


def load_policy(path):
    policy = json.loads(Path(path).read_text())
    repos = policy.get("repositories", [])
    if not policy.get("enabled") or policy.get("mode") != "recommend":
        raise ValueError("Merge Flow needs enabled=true and mode=recommend")
    if not repos or len(repos) != len(set(repos)) or len(repos) > 25 or not all(REPO.match(r) for r in repos):
        raise ValueError("repositories must be 1 to 25 unique owner/name entries")
    return policy


def build_query(repos, open_limit, merged_limit):
    """One aliased query for every repository; only the fields the lanes need."""
    parts = []
    for i, repo in enumerate(repos):
        owner, name = repo.split("/")
        parts.append(
            f'r{i}: repository(owner: {json.dumps(owner)}, name: {json.dumps(name)}) {{ nameWithOwner isPrivate'
            f" open: pullRequests(states: OPEN, first: {open_limit}, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{ totalCount nodes {{"
            " number title url isDraft createdAt updatedAt author { login } headRefOid mergeable mergeStateStatus reviewDecision"
            " commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 25) { nodes { __typename"
            " ... on CheckRun { name conclusion } ... on StatusContext { context state } } } } } } } } }"
            f" merged: pullRequests(states: MERGED, first: {merged_limit}, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{ nodes {{ createdAt mergedAt }} }} }}"
        )
    return "query { rateLimit { cost remaining } " + " ".join(parts) + " }"


def fetch(query, token, timeout, attempts=2):
    """One request; GitHub's GraphQL gateway sometimes answers 502/503/504, so that gets one retry."""
    req = urllib.request.Request(
        GRAPHQL, data=json.dumps({"query": query}).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "atlas-merge-flow"},
    )
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                body = res.read()
            return json.loads(body), len(body)
        except urllib.error.HTTPError as e:
            if e.code not in {502, 503, 504} or attempt == attempts - 1:
                raise
            time.sleep(5)


def parse_time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def failing_checks(rollup):
    names = []
    for c in ((rollup or {}).get("contexts") or {}).get("nodes") or []:
        if not c:  # GraphQL nulls an item the token may not read, such as an app's check run on a private repo
            continue
        if c.get("__typename") == "CheckRun" and c.get("conclusion") in FAILED:
            names.append(c.get("name") or "check")
        elif c.get("__typename") == "StatusContext" and c.get("state") in {"FAILURE", "ERROR"}:
            names.append(c.get("context") or "status")
    return names[:3]


def lane(pr):
    """The one thing holding this pull request up, from GitHub's own merge state."""
    commits = (pr.get("commits") or {}).get("nodes") or []
    rollup = ((commits[0] or {}).get("commit") or {}).get("statusCheckRollup") if commits else None
    checks = (rollup or {}).get("state")
    merge_state = pr.get("mergeStateStatus")
    if pr.get("isDraft"):
        return "draft"
    if pr.get("mergeable") == "CONFLICTING" or merge_state == "DIRTY":
        return "conflicts"
    if checks in {"FAILURE", "ERROR"} or merge_state == "UNSTABLE":
        return "failing"
    if pr.get("reviewDecision") == "CHANGES_REQUESTED":
        return "changes"
    if checks in {"PENDING", "EXPECTED"}:
        return "running"
    if merge_state == "BEHIND":
        return "behind"
    if pr.get("mergeable") == "MERGEABLE" and merge_state in {"CLEAN", "HAS_HOOKS"}:
        return "ready"
    if merge_state == "BLOCKED":
        return "review" if pr.get("reviewDecision") == "REVIEW_REQUIRED" else "blocked"
    return "unknown"


def triage(data, repos, policy, now):
    stale_before = now - timedelta(days=policy["staleAfterDays"])
    prs, unavailable, merge_hours, seen = [], [], [], 0
    for i, repo in enumerate(repos):
        node = (data or {}).get(f"r{i}")
        if not node:
            unavailable.append(repo)
            continue
        private = bool(node.get("isPrivate"))
        seen += 1
        for pr in (node.get("open") or {}).get("nodes") or []:
            if not pr:
                continue
            commits = (pr.get("commits") or {}).get("nodes") or []
            rollup = ((commits[0] or {}).get("commit") or {}).get("statusCheckRollup") if commits else None
            the_lane = lane(pr)
            prs.append({
                "repo": node["nameWithOwner"], "private": private, "number": pr["number"],
                "title": (pr.get("title") or "")[:100], "url": pr.get("url"), "lane": the_lane,
                "author": ((pr.get("author") or {}).get("login") or "ghost"), "head": pr.get("headRefOid"),
                "review": pr.get("reviewDecision"), "age_hours": round((now - parse_time(pr["createdAt"])).total_seconds() / 3600, 1),
                "stale": parse_time(pr["updatedAt"]) < stale_before, "failing": failing_checks(rollup) if the_lane == "failing" else [],
                "no_checks": rollup is None,
            })
        for m in (node.get("merged") or {}).get("nodes") or []:
            merged = parse_time(m["mergedAt"]) if m and m.get("mergedAt") else None
            if merged and merged > now - timedelta(days=30):
                merge_hours.append((merged - parse_time(m["createdAt"])).total_seconds() / 3600)
    prs.sort(key=lambda p: (LANES.index(p["lane"]), -p["age_hours"]))
    counts = {k: sum(p["lane"] == k for p in prs) for k in LANES}
    ready = [p["age_hours"] for p in prs if p["lane"] == "ready"]
    return {
        "at": now.isoformat(timespec="seconds"), "repositories": seen, "unavailable": unavailable,
        "open": len(prs), "counts": counts, "stale": sum(p["stale"] for p in prs),
        "median_merge_hours": round(statistics.median(merge_hours), 1) if merge_hours else None,
        "merged_last_30d_sampled": len(merge_hours), "oldest_ready_hours": max(ready) if ready else None,
        "prs": prs,
    }


def fingerprint(report):
    """What matters for a decision: which pull request at which commit sits in which lane."""
    keys = sorted(f'{p["repo"]}#{p["number"]}@{p["head"]}:{p["lane"]}:{p["stale"]}:{",".join(p["failing"])}' for p in report["prs"])
    keys += [f"unavailable:{r}" for r in report["unavailable"]]
    return hashlib.sha256("\n".join(keys).encode()).hexdigest()


def load_state(path):
    try:
        state = json.loads(Path(path).read_text())
        return state if state.get("version") == 1 else {"version": 1}
    except (OSError, ValueError):
        return {"version": 1}


def brief_budget(state, policy, now):
    """None when a brief may run, else why not. Reserves the worst case before any call."""
    b = policy["brief"]
    month, day = now.strftime("%Y-%m"), now.strftime("%Y-%m-%d")
    spend = state.get("spend", {})
    spent = spend.get("usd", 0.0) if spend.get("month") == month else 0.0
    calls = state.get("briefs", {})
    today = calls.get("count", 0) if calls.get("day") == day else 0
    worst = (6000 * b["inputUsdPerMTok"] + b["maxTokens"] * b["outputUsdPerMTok"]) / 1e6
    if today >= b["maxPerDay"]:
        return f"daily cap of {b['maxPerDay']} briefs reached"
    if spent + worst > b["monthlyBudgetUsd"]:
        return f"monthly budget ${b['monthlyBudgetUsd']:.2f} would be exceeded (${spent:.3f} spent)"
    return None


def decide(state, report, policy, now, has_key, paused=False):
    """Whether this run reports, and whether it asks Claude for a brief."""
    fp = fingerprint(report)
    changed = fp != state.get("fingerprint")
    last = state.get("last_report_at")
    heartbeat = not last or now - parse_time(last) >= timedelta(hours=policy["heartbeatHours"])
    actionable = [p for p in report["prs"] if p["lane"] in ACTIONABLE or p["stale"]]
    why_not = None
    if not changed:
        why_not = "triage unchanged"
    elif not actionable:
        why_not = "nothing needs action"
    elif not has_key:
        why_not = "no ANTHROPIC_API_KEY"
    elif paused:
        why_not = "paused by the spend guard"
    else:
        why_not = brief_budget(state, policy, now)
    return {"fingerprint": fp, "changed": changed, "report": changed or heartbeat, "brief": why_not is None, "brief_skipped": why_not}


def headline(report):
    c = report["counts"]
    bits = [f'{c[k]} {LABELS[k].lower()}' for k in ("ready", "failing", "behind", "conflicts", "changes") if c[k]]
    text = f'{report["open"]} open PRs' + (": " + ", ".join(bits) if bits else ", none blocked")
    if report["stale"]:
        text += f', {report["stale"]} stale'
    if report["median_merge_hours"] is not None:
        text += f'. Median time to merge {report["median_merge_hours"]}h'
    return text + "."


def summary_markdown(report, brief_text=None, brief_note=None):
    """Job summary for a public repository's Actions page: private repositories appear as counts only."""
    lines = ["## Merge Flow", "", headline(report), ""]
    public = [p for p in report["prs"] if not p["private"] and p["lane"] not in {"draft"}]
    hidden = sum(p["private"] for p in report["prs"])
    if public:
        lines += ["| Lane | Pull request | Age | Note |", "|---|---|---|---|"]
        for p in public:
            note = ", ".join(p["failing"]) or ("stale" if p["stale"] else "") or ("no checks" if p["no_checks"] else "")
            title = p["title"].replace("|", "/")
            lines.append(f'| {LABELS[p["lane"]]} | [{p["repo"]}#{p["number"]}]({p["url"]}) {title} | {p["age_hours"]:.0f}h | {note} |')
        lines.append("")
    if hidden:
        lines.append(f"{hidden} pull requests in private repositories are counted above and listed only in Atlas.")
    if report["unavailable"]:
        lines.append(f'{len(report["unavailable"])} repositories were not readable with this token.')
    if brief_text:
        lines += ["", "### Next moves", "", brief_text]
    elif brief_note:
        lines += ["", f"No brief: {brief_note}."]
    return "\n".join(lines) + "\n"


def brief_input(report, policy):
    rows = [
        {k: p[k] for k in ("repo", "number", "title", "lane", "age_hours", "stale", "failing", "author")}
        for p in report["prs"] if p["lane"] in ACTIONABLE or p["stale"]
    ][: policy["brief"]["maxPullRequests"]]
    return json.dumps({"summary": headline(report), "pull_requests": rows}, separators=(",", ":"))


def write_brief(report, policy):
    import anthropic  # installed by the workflow only when a brief is due

    b = policy["brief"]
    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=b["model"], max_tokens=b["maxTokens"], output_config={"effort": b["effort"]},
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        system=(HERE / "prompt.md").read_text(),
        messages=[{"role": "user", "content": brief_input(report, policy)}],
    )
    cost = (response.usage.input_tokens * b["inputUsdPerMTok"] + response.usage.output_tokens * b["outputUsdPerMTok"]) / 1e6
    if response.stop_reason == "refusal":
        return None, cost
    text = "\n".join(block.text for block in response.content if block.type == "text").strip()
    return text[:600] or None, cost


def post_feed(detail, status, now):
    """Optional: one line to Atlas's agent feed (behind Access), when ATLAS_FEED_URL and ATLAS_FEED_TOKEN are set."""
    url, token = os.environ.get("ATLAS_FEED_URL"), os.environ.get("ATLAS_FEED_TOKEN")
    if not url or not token:
        return False
    body = {"project": "github-profile", "agents": ["github-merge-flow"], "phase": "Merge flow triage",
            "status": status, "detail": detail[:300], "at": now.isoformat(timespec="seconds")}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10):
            return True
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


def cmd_triage(args, now=None):
    now = now or datetime.now(timezone.utc)
    policy = load_policy(args.policy)
    token = os.environ.get("MERGE_FLOW_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("Set MERGE_FLOW_TOKEN or GITHUB_TOKEN")
    repos = policy["repositories"]
    result, size = fetch(build_query(repos, policy["openPullRequestsPerRepository"], policy["mergedPullRequestsPerRepository"]), token, policy["requestTimeoutSeconds"])
    if not result.get("data"):
        post_feed("GitHub returned no data for the triage query.", "failed", now)
        raise SystemExit("GitHub returned no data: " + "; ".join(e.get("type", "error") for e in result.get("errors", [])))
    report = triage(result["data"], repos, policy, now)
    state = load_state(args.state)
    # The spend guard (ops/autopilot) lists agents over budget in the SPEND_GUARD_PAUSED variable.
    paused = "github-merge-flow" in {a.strip() for a in os.environ.get("ATLAS_PAUSED_AGENTS", "").split(",")}
    d = decide(state, report, policy, now, bool(os.environ.get("ANTHROPIC_API_KEY")) and not args.dry_run, paused)
    rate = result["data"].get("rateLimit") or {}
    # Counts only: this log is public. Titles of private repositories never reach it.
    print(f'1 request, {size} bytes, cost {rate.get("cost")}, {rate.get("remaining")} left. {report["repositories"]} repositories, '
          f'{report["open"]} open PRs, {report["counts"]["ready"]} ready. Changed: {d["changed"]}. Brief: {d["brief"] or d["brief_skipped"]}.')
    Path(args.work).write_text(json.dumps({"report": report, "decision": d}))
    if not d["brief"] and not args.dry_run:
        finish(args, state, report, d, None, now)
    elif args.dry_run:
        write_summary(summary_markdown(report, brief_note="dry run"))
    set_output("brief", "true" if d["brief"] else "false")
    return report, d


def finish(args, state, report, d, brief_text, now, cost=0.0):
    if d["report"]:
        all_public = all(not p["private"] for p in report["prs"])
        write_summary(summary_markdown(report, brief_text if all_public else None,
                                       None if brief_text else d["brief_skipped"]) +
                      ("" if all_public or not brief_text else "\nThe brief mentions private repositories, so it is in Atlas only.\n"))
        post_feed(headline(report) + (" " + brief_text.replace("\n", " ") if brief_text else ""), "ok", now)
        state["last_report_at"] = now.isoformat(timespec="seconds")
    state["fingerprint"] = d["fingerprint"]
    if cost:
        month, day = now.strftime("%Y-%m"), now.strftime("%Y-%m-%d")
        spend = state.get("spend", {})
        state["spend"] = {"month": month, "usd": round((spend.get("usd", 0.0) if spend.get("month") == month else 0.0) + cost, 6)}
        calls = state.get("briefs", {})
        state["briefs"] = {"day": day, "count": (calls.get("count", 0) if calls.get("day") == day else 0) + 1}
    Path(args.state).write_text(json.dumps(state))


def cmd_brief(args, now=None):
    now = now or datetime.now(timezone.utc)
    policy = load_policy(args.policy)
    work = json.loads(Path(args.work).read_text())
    state = load_state(args.state)
    report, d = work["report"], work["decision"]
    try:
        text, cost = write_brief(report, policy)
    except Exception as e:  # the triage still counts; the brief is optional
        print(f"Brief failed: {type(e).__name__}", file=sys.stderr)
        text, cost = None, 0.0
        d["brief_skipped"] = "the Claude call failed"
    print(f"Brief: {'written' if text else 'none'}, about ${cost:.4f}.")
    finish(args, state, report, d, text, now, cost)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["triage", "brief"])
    parser.add_argument("--policy", type=Path, default=HERE / "policy.json")
    parser.add_argument("--state", type=Path, default=Path("merge-flow-state.json"))
    parser.add_argument("--work", type=Path, default=Path("merge-flow-work.json"))
    parser.add_argument("--dry-run", action="store_true", help="read and print counts; no brief, no feed, no saved state")
    args = parser.parse_args(argv)
    (cmd_triage if args.command == "triage" else cmd_brief)(args)


if __name__ == "__main__":
    main()
