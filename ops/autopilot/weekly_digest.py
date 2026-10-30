"""Weekly digest: one Monday message with last week's merged pull requests, agent runs, spend, uptime
and the short list of things that need you.

Plain code, no model calls. One GitHub GraphQL request covers merged and open pull requests across
every repository in digest.json, then one REST request per repository lists the week's workflow runs.
Spend and uptime come from the spend guard's and uptime checker's saved state, so the digest makes
no paid calls of its own.

The email (or webhook) gets the full digest. The job summary is public on a public repository, so it
names public repositories only and counts private ones.

  python3 ops/autopilot/weekly_digest.py --spend spend-guard-state.json --uptime uptime-state.json
"""
import argparse
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "merge-flow"))
import common  # noqa: E402
from merge_flow import lane  # noqa: E402  (same lanes as Merge Flow, so both agree on what is "ready")

NEEDS_YOU = {"ready": "ready to merge", "failing": "checks failing", "conflicts": "has conflicts", "changes": "changes requested", "behind": "behind its base"}
FAILED = {"failure", "timed_out", "startup_failure"}

PR_FIELDS = (
    "... on PullRequest { number title url isDraft createdAt updatedAt mergedAt mergeable mergeStateStatus reviewDecision"
    " repository { nameWithOwner isPrivate }"
    " commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }"
)


def build_query(repos, since):
    scope = " ".join(f"repo:{r}" for r in repos)
    return (
        "query { rateLimit { cost remaining } "
        f"merged: search(type: ISSUE, first: 100, query: {json.dumps(f'is:pr is:merged merged:>={since} {scope}')}) {{ issueCount nodes {{ {PR_FIELDS} }} }} "
        f"open: search(type: ISSUE, first: 100, query: {json.dumps(f'is:pr is:open {scope}')}) {{ issueCount nodes {{ {PR_FIELDS} }} }} }}"
    )


def pull_requests(data, now, stale_days):
    def rows(key):
        return [n for n in ((data.get(key) or {}).get("nodes") or []) if n and n.get("number")]

    merged = [{"repo": n["repository"]["nameWithOwner"], "private": n["repository"]["isPrivate"], "number": n["number"],
               "title": (n.get("title") or "")[:100], "url": n["url"]} for n in rows("merged")]
    stale_before = now - timedelta(days=stale_days)
    open_prs = []
    for n in rows("open"):
        open_prs.append({"repo": n["repository"]["nameWithOwner"], "private": n["repository"]["isPrivate"], "number": n["number"],
                         "title": (n.get("title") or "")[:100], "url": n["url"], "lane": lane(n),
                         "stale": common.parse_time(n["updatedAt"]) < stale_before})
    return merged, open_prs, (data.get("merged") or {}).get("issueCount", len(merged))


def workflow_runs(repos, token, since, fetch=common.github):
    """Per repository and workflow: runs, failures and the latest non-PR conclusion. Pull request runs are counted, not judged."""
    out, unreadable = [], []
    for repo in repos:
        status, body = fetch(f"/repos/{repo}/actions/runs?created=%3E%3D{since}&per_page=100&exclude_pull_requests=true", token)
        if status != 200 or not body:
            unreadable.append(repo)
            continue
        flows = {}
        for run in body.get("workflow_runs") or []:
            f = flows.setdefault(run.get("name") or "workflow", {"repo": repo, "workflow": run.get("name") or "workflow",
                                                                  "runs": 0, "failed": 0, "latest": None, "url": None})
            f["runs"] += 1
            f["private"] = bool((run.get("repository") or {}).get("private"))
            f["failed"] += run.get("conclusion") in FAILED
            # Runs arrive newest first; the first finished non-PR run is the one that says if it works now.
            if f["latest"] is None and run.get("event") != "pull_request" and run.get("status") == "completed":
                f["latest"], f["url"] = run.get("conclusion"), run.get("html_url")
        out += sorted(flows.values(), key=lambda f: f["workflow"])
    return out, unreadable


def weekly_incidents(uptime, since_dt):
    out = []
    for inc in (uptime or {}).get("incidents") or []:
        if common.parse_time(inc["down_at"]) >= since_dt or not inc.get("up_at") or common.parse_time(inc["up_at"]) >= since_dt:
            out.append(inc)
    return out


def needs_you(open_prs, flows, spend, uptime):
    """Each item is {"text", "private"} so the public summary can leave private repositories out."""
    items = []
    for p in open_prs:
        if p["lane"] in NEEDS_YOU:
            items.append({"text": f"{p['repo']}#{p['number']} {NEEDS_YOU[p['lane']]}: {p['title']}", "private": p["private"]})
    for p in open_prs:
        if p["stale"] and p["lane"] not in NEEDS_YOU and p["lane"] != "draft":
            items.append({"text": f"{p['repo']}#{p['number']} has been quiet for a week: finish or close it", "private": p["private"]})
    for f in flows:
        if f["latest"] in FAILED:
            items.append({"text": f"{f['repo']} workflow \"{f['workflow']}\" failed on its latest run", "private": f.get("private", False)})
    last = (spend or {}).get("last") or {}
    for b in last.get("budgets") or []:
        if b.get("over"):
            items.append({"text": f"{b['label']} is at {b['percent']}% of its {common.money(b['cap'])} cap", "private": False})
    if last.get("paused"):
        items.append({"text": f"Paused by the spend guard: {', '.join(last['paused'])}", "private": False})
    for name, s in ((uptime or {}).get("checks") or {}).items():
        if s.get("alerted_at"):
            items.append({"text": f"{name} is down ({s.get('reason', 'failing')})", "private": False})
    return items


def compose(d, public_only=False):
    """The digest as plain text. public_only drops anything from a private repository (for the public job summary)."""
    hide = (lambda x: x.get("private")) if public_only else (lambda x: False)
    lines = [f"Week of {d['since']} to {d['until']}", ""]
    lines.append(f"NEEDS YOU ({len(d['needs'])})" if d["needs"] else "NEEDS YOU: nothing this week.")
    needs = [n for n in d["needs"] if not hide(n)]
    lines += [f"- {n['text']}" for n in needs]
    if len(needs) < len(d["needs"]):
        lines.append(f"- plus {len(d['needs']) - len(needs)} in private repositories (in the email and Atlas only)")
    shown = [m for m in d["merged"] if not hide(m)]
    lines += ["", f"MERGED: {d['merged_total']} pull requests"]
    lines += [f"- {m['repo']}#{m['number']} {m['title']}" for m in shown[:25]]
    if len(d["merged"]) - len(shown):
        lines.append(f"- plus {len(d['merged']) - len(shown)} in private repositories")
    flows = [f for f in d["flows"] if f["runs"]]
    runs, failed = sum(f["runs"] for f in flows), sum(f["failed"] for f in flows)
    lines += ["", f"AGENT AND WORKFLOW RUNS: {runs} runs, {failed} failed"]
    lines += [f"- {f['repo'].split('/')[1]} / {f['workflow']}: {f['runs']} runs, {f['failed']} failed, latest {f['latest'] or 'n/a'}"
              for f in sorted(flows, key=lambda f: (-f["failed"], -f["runs"]))[:15] if not (public_only and f.get("private"))]
    if d["unreadable"]:
        lines.append(f"- {len(d['unreadable'])} repositories could not be read with this token")
    spend = (d["spend"] or {}).get("last")
    lines += ["", "SPEND"]
    if spend:
        lines += [f"- {b['label']}: {common.money(b['month'])} of {common.money(b['cap'])} ({b['percent']}%), heading for {common.money(b['projected'])}"
                  for b in spend.get("budgets") or []]
        lines += [f"- Not measured: {e}" for e in spend.get("errors") or []]
        lines.append(f"- As of {spend['at'][:16].replace('T', ' ')} UTC")
    else:
        lines.append("- No spend guard report yet.")
    lines += ["", "UPTIME"]
    if d["uptime"] is None:
        lines.append("- No uptime report yet.")
    elif d["incidents"]:
        lines += [f"- {i['name']} down at {i['down_at'][:16].replace('T', ' ')} UTC ({i.get('reason', '')}), "
                  + (f"back at {i['up_at'][:16].replace('T', ' ')}" if i.get("up_at") else "still down") for i in d["incidents"]]
    else:
        lines.append("- No outages this week.")
    return "\n".join(lines) + "\n"


def main(argv=None, now=None, gql=common.graphql, rest=common.github):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=HERE / "digest.json")
    parser.add_argument("--spend", type=Path, default=Path("spend-guard-state.json"))
    parser.add_argument("--uptime", type=Path, default=Path("uptime-state.json"))
    parser.add_argument("--dry-run", action="store_true", help="build and print the digest; send nothing")
    args = parser.parse_args(argv)
    now = now or common.now_utc()
    config = common.load_config(args.config, ["agent", "repositories", "days", "staleAfterDays"])
    repos = config["repositories"]
    if not repos or len(repos) > 25 or not all(common.REPO.match(r) for r in repos):
        raise ValueError("repositories must be 1 to 25 owner/name entries")
    token = common.github_token("DIGEST_TOKEN", "GITHUB_TOKEN")
    if not token:
        raise SystemExit("Set DIGEST_TOKEN or GITHUB_TOKEN")

    since_dt = now - timedelta(days=config["days"])
    since = since_dt.strftime("%Y-%m-%d")
    result, size = gql(build_query(repos, since), token)
    if not result.get("data"):
        raise SystemExit("GitHub returned no data: " + "; ".join(e.get("type", "error") for e in result.get("errors", [])))
    merged, open_prs, merged_total = pull_requests(result["data"], now, config["staleAfterDays"])
    flows, unreadable = workflow_runs(config.get("runRepositories", repos), token, since, rest)
    spend = common.load_state(args.spend) if args.spend.exists() else None
    uptime = common.load_state(args.uptime) if args.uptime.exists() else None
    paused = common.paused_agents()
    if spend is not None and paused:
        spend.setdefault("last", {}).setdefault("paused", sorted(paused))

    d = {"since": since, "until": now.strftime("%Y-%m-%d"), "merged": merged, "merged_total": merged_total, "open": open_prs,
         "flows": flows, "unreadable": unreadable, "spend": spend, "uptime": uptime, "incidents": weekly_incidents(uptime, since_dt)}
    d["needs"] = needs_you(open_prs, flows, spend, uptime)
    print(f"1 GraphQL request ({size} bytes), {len(config.get('runRepositories', repos))} run lists. "
          f"{merged_total} merged, {len(open_prs)} open, {len(d['needs'])} need you. Channels: {', '.join(common.channels()) or 'none'}.")
    common.write_summary("## Weekly digest\n\n```\n" + compose(d, public_only=True) + "```\n")
    if args.dry_run:
        print(compose(d))
        return 0

    subject = f"Weekly digest: {merged_total} merged, {len(d['needs'])} need you"
    sent = common.notify(subject, compose(d))
    headline = f"{merged_total} merged, {len(open_prs)} open, {len(d['needs'])} need you" + (f": {d['needs'][0]['text']}" if d["needs"] else ".")
    if common.post_feed(config["agent"], "Weekly digest", "ok", headline, now):
        sent.append("atlas")
    print(f"Digest sent via {', '.join(sent) or 'no channel (job summary only)'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
