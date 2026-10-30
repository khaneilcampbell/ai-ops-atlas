"""Spend guard: totals API spend against each monthly cap and pauses the paid agents behind it at 80%.

Plain code, no model calls. Each budget in spend-guard.json reads one source:

  anthropic_cost_report  Anthropic's cost report (needs ANTHROPIC_ADMIN_KEY), the whole organization
                         or one workspace. Report reads cost nothing.
  ledger                 A JSON file an agent keeps itself, such as Merge Flow's {"spend": {"month", "usd"}}.

When a budget reaches `pauseAtPercent` of its cap, the agents it lists are added to the repository
variable `pauseVariable`. Agents read that variable and skip their paid step while listed; free work
(reading, sorting, reporting) keeps running. The next month, or a raised cap, takes them off again.
Writing the variable needs SPEND_GUARD_TOKEN (fine-grained, Variables read and write on one
repository). Without it the guard only recommends: it reports what it would pause and alerts.

  python3 ops/autopilot/spend_guard.py --state spend-guard-state.json
"""
import argparse
import calendar
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402

HERE = Path(__file__).parent
COST_REPORT = "https://api.anthropic.com/v1/organizations/cost_report"


def month_start(now):
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def anthropic_daily(key, now, fetch=common.request):
    """Month-to-date daily cost per workspace from the cost report: {day: {workspace_id or "default": usd}}."""
    start, end = month_start(now), (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    days, page = {}, None
    for _ in range(5):  # 31 daily buckets fit in one page; the cap only guards a runaway pager
        url = (f"{COST_REPORT}?starting_at={common.iso(start).replace('+00:00', 'Z')}&ending_at={common.iso(end).replace('+00:00', 'Z')}"
               f"&group_by[]=workspace_id&bucket_width=1d&limit=31" + (f"&page={page}" if page else ""))
        status, _, raw = fetch(url, timeout=20, headers={"x-api-key": key, "anthropic-version": "2023-06-01"})
        if status != 200:
            raise RuntimeError(f"Anthropic cost report answered {status}")
        body = json.loads(raw)
        for bucket in body.get("data") or []:
            day = (bucket.get("starting_at") or "")[:10]
            for r in bucket.get("results") or []:
                ws = r.get("workspace_id") or "default"
                # Amounts are decimal strings in cents.
                days.setdefault(day, {})
                days[day][ws] = days[day].get(ws, 0.0) + float(r.get("amount") or 0) / 100
        if not body.get("has_more"):
            break
        page = body.get("next_page")
    return days


def ledger_spend(path, key, now):
    """Spend an agent recorded itself. Counts only when the ledger is for this month."""
    try:
        entry = json.loads(Path(path).read_text()).get(key) or {}
    except (OSError, ValueError):
        return None
    if entry.get("month") != now.strftime("%Y-%m"):
        return 0.0
    return float(entry.get("usd") or 0.0)


def measure(config, now, admin_key, fetch=common.request):
    """Spend per budget: {budget id: {"month": usd, "today": usd or None, "source": text}} plus errors."""
    out, errors, daily = {}, [], None
    today = now.strftime("%Y-%m-%d")
    for b in config["budgets"]:
        src = b["source"]
        if src["type"] == "anthropic_cost_report":
            if not admin_key:
                errors.append(f"{b['label']}: no ANTHROPIC_ADMIN_KEY")
                continue
            if daily is None:
                try:
                    daily = anthropic_daily(admin_key, now, fetch)
                except (OSError, RuntimeError, ValueError) as e:
                    daily = {}
                    errors.append(f"Anthropic cost report: {e}")
            ws = src.get("workspaceId")
            pick = (lambda d: sum(d.values())) if not ws else (lambda d: d.get(ws, 0.0))
            out[b["id"]] = {"month": round(sum(pick(d) for d in daily.values()), 4),
                            "today": round(pick(daily.get(today, {})), 4), "source": "Anthropic cost report"}
        elif src["type"] == "ledger":
            usd = ledger_spend(src["file"], src.get("key", "spend"), now)
            if usd is None:
                errors.append(f"{b['label']}: ledger {src['file']} not found")
                continue
            out[b["id"]] = {"month": round(usd, 4), "today": None, "source": f"ledger {src['file']}"}
        else:
            errors.append(f"{b['label']}: unknown source type {src['type']}")
    return out, errors


def assess(config, spend, now):
    """Per budget: percent used, projected month end, and whether its agents should be paused."""
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    elapsed = max((now - month_start(now)).total_seconds() / 86400, 0.5)
    rows = []
    for b in config["budgets"]:
        s = spend.get(b["id"])
        if s is None:
            continue
        cap = b["monthlyCapUsd"]
        pct = 100 * s["month"] / cap if cap else 100
        rows.append({
            "id": b["id"], "label": b["label"], "cap": cap, "month": s["month"], "today": s["today"], "source": s["source"],
            "percent": round(pct, 1), "projected": round(s["month"] / elapsed * days_in_month, 2),
            "over": pct >= config["pauseAtPercent"], "pauses": b.get("pauses", []),
        })
    return rows


def wanted_pauses(rows):
    return sorted({a for r in rows if r["over"] for a in r["pauses"]})


def read_variable(repo, name, token):
    status, body = common.github(f"/repos/{repo}/actions/variables/{name}", token)
    if status == 404:
        return None
    if status != 200:
        raise RuntimeError(f"reading {name} answered {status}")
    return body.get("value", "")


def write_variable(repo, name, value, token, exists):
    if exists:
        status, _ = common.github(f"/repos/{repo}/actions/variables/{name}", token, method="PATCH", body={"name": name, "value": value})
    else:
        status, _ = common.github(f"/repos/{repo}/actions/variables", token, method="POST", body={"name": name, "value": value})
    if status >= 300:
        raise RuntimeError(f"writing {name} answered {status}")


def apply_pauses(config, wanted, token):
    """Sets the pause variable to exactly the agents over budget. Returns (applied, previous set)."""
    repo, name = config["repository"], config["pauseVariable"]
    current = read_variable(repo, name, token)
    before = {a.strip() for a in (current or "").split(",") if a.strip() and a.strip() != "none"}
    if before != set(wanted):
        # GitHub refuses an empty variable, so "none" stands for no pauses.
        write_variable(repo, name, ",".join(wanted) or "none", token, current is not None)
    return True, before


def transitions(state, rows, now):
    """Alerts only when a budget crosses the line in either direction, not on every run."""
    seen = state.setdefault("over", {})
    alerts = []
    for r in rows:
        was = seen.get(r["id"], False)
        if r["over"] and not was:
            alerts.append(f"{r['label']} is at {r['percent']}% of its {common.money(r['cap'])} monthly cap ({common.money(r['month'])} spent).")
        elif was and not r["over"]:
            alerts.append(f"{r['label']} is back under the line ({r['percent']}% of {common.money(r['cap'])}).")
        seen[r["id"]] = r["over"]
    month = now.strftime("%Y-%m")
    if state.get("month") != month:
        state["month"] = month
    return alerts


def report_lines(rows, paused, mode, errors):
    lines = []
    for r in rows:
        today = f", today {common.money(r['today'])}" if r["today"] is not None else ""
        lines.append(f"- {r['label']}: {common.money(r['month'])} of {common.money(r['cap'])} ({r['percent']}%){today}, "
                     f"heading for {common.money(r['projected'])}" + (", over the line" if r["over"] else ""))
    if paused:
        verb = "Paused" if mode == "pause" else "Would pause (no SPEND_GUARD_TOKEN, recommend only)"
        lines.append(f"{verb}: {', '.join(paused)}")
    lines += [f"Not measured: {e}" for e in errors]
    return lines


def main(argv=None, now=None, fetch=common.request, pauser=apply_pauses):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=HERE / "spend-guard.json")
    parser.add_argument("--state", type=Path, default=Path("spend-guard-state.json"))
    parser.add_argument("--dry-run", action="store_true", help="measure and print; no pausing, alerts or saved state")
    args = parser.parse_args(argv)
    now = now or datetime.now(timezone.utc)
    config = common.load_config(args.config, ["agent", "budgets", "pauseAtPercent", "repository", "pauseVariable"])
    if not common.REPO.match(config["repository"]):
        raise ValueError("repository must be owner/name")

    spend, errors = measure(config, now, os.environ.get("ANTHROPIC_ADMIN_KEY"), fetch)
    rows = assess(config, spend, now)
    wanted = wanted_pauses(rows)
    token = os.environ.get("SPEND_GUARD_TOKEN")
    mode = "pause" if token and config.get("action", "pause") == "pause" and not args.dry_run else "recommend"
    print(f"{len(rows)} of {len(config['budgets'])} budgets measured, {sum(r['over'] for r in rows)} over {config['pauseAtPercent']}%. "
          f"Mode: {mode}. Pausing: {', '.join(wanted) or 'nothing'}.")

    state = common.load_state(args.state)
    changed_pauses = False
    if mode == "pause":
        try:
            _, before = pauser(config, wanted, token)
            changed_pauses = before != set(wanted)
        except (OSError, RuntimeError) as e:
            errors.append(f"pause variable: {e}")
            mode = "recommend"
    lines = report_lines(rows, wanted, mode, errors)
    common.write_summary("## Spend guard\n\n" + "\n".join(lines or ["No budgets measured."]) + "\n")
    if args.dry_run:
        return 0

    alerts = transitions(state, rows, now)
    if changed_pauses:
        alerts.append(f"Paused agents now: {', '.join(wanted) or 'none'}.")
    if alerts:
        common.notify("Spend guard: " + alerts[0][:100], "\n".join(alerts + [""] + lines))
    over = [r for r in rows if r["over"]]
    common.post_feed(config["agent"], "Spend check", "failed" if over or errors else "ok",
                     "; ".join(f"{r['label']} {r['percent']}% of {common.money(r['cap'])}" for r in rows) or "no budgets measured", now)
    state["last"] = {"at": common.iso(now), "budgets": rows, "paused": wanted, "mode": mode, "errors": errors}
    common.save_state(args.state, state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
