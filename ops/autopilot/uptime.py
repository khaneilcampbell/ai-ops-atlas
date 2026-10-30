"""Uptime: checks each URL in uptime.json and alerts when one stays down.

Plain code, no model calls. Each check is one request (plus one retry when it fails), compared with
an expected status, an optional text in the body and optional response headers. A check must fail on
`failAfter` runs in a row before it alerts, so one slow answer never pages anyone. While it stays down,
a reminder goes out every `remindHours`; the first passing run sends a "recovered" note.

Checks never submit forms. The contact endpoint check sends a GET, which the Worker answers with 405:
that proves the route and the Worker are live without creating an inquiry.

  python3 ops/autopilot/uptime.py --state uptime-state.json
"""
import argparse
import sys
import time
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402

HERE = Path(__file__).parent


def check_once(check, timeout, fetch=common.request):
    """One attempt. Returns (ok, reason, milliseconds)."""
    started = time.monotonic()
    try:
        status, headers, body = fetch(check["url"], method=check.get("method", "GET"), timeout=timeout, attempts=1,
                                      follow_redirects=check.get("followRedirects", True))
    except OSError as e:
        return False, f"no response ({type(e).__name__})", round((time.monotonic() - started) * 1000)
    ms = round((time.monotonic() - started) * 1000)
    expected = check.get("expectStatus", [200])
    if status not in expected:
        return False, f"status {status}, expected {'/'.join(map(str, expected))}", ms
    text = check.get("expectText")
    if text and text not in body.decode("utf-8", "replace"):
        return False, "expected text missing from the page", ms
    lower = {k.lower(): v for k, v in headers.items()}
    for name, want in (check.get("expectHeaders") or {}).items():
        if want not in (lower.get(name.lower()) or ""):
            return False, f"header {name} does not contain {want!r}", ms
    return True, "ok", ms


def run_checks(config, fetch=common.request, sleep=time.sleep):
    results = []
    for check in config["checks"]:
        ok, reason, ms = check_once(check, config["timeoutSeconds"], fetch)
        if not ok:  # one retry absorbs a dropped connection or a cold start
            sleep(config.get("retryDelaySeconds", 5))
            ok, reason, ms = check_once(check, config["timeoutSeconds"], fetch)
        slow = ok and ms > config["slowMs"]
        results.append({"name": check["name"], "url": check["url"], "ok": ok, "reason": reason, "ms": ms, "slow": slow})
    return results


def evaluate(state, results, config, now):
    """Updates per-check state and returns the alerts this run must send."""
    checks = state.setdefault("checks", {})
    incidents = state.setdefault("incidents", [])
    alerts = []
    for r in results:
        s = checks.setdefault(r["name"], {"failures": 0})
        if r["ok"]:
            if s.get("alerted_at"):
                down_for = now - common.parse_time(s["down_since"])
                alerts.append({"kind": "recovered", "name": r["name"], "url": r["url"], "detail": f"back after {_duration(down_for)}"})
                for inc in reversed(incidents):
                    if inc["name"] == r["name"] and not inc.get("up_at"):
                        inc["up_at"] = common.iso(now)
                        break
            checks[r["name"]] = {"failures": 0}
            continue
        s["failures"] = s.get("failures", 0) + 1
        s.setdefault("down_since", common.iso(now))
        s["reason"] = r["reason"]
        if s["failures"] >= config["failAfter"] and not s.get("alerted_at"):
            s["alerted_at"] = common.iso(now)
            alerts.append({"kind": "down", "name": r["name"], "url": r["url"], "detail": r["reason"]})
            incidents.append({"name": r["name"], "down_at": s["down_since"], "reason": r["reason"]})
        elif s.get("alerted_at") and now - common.parse_time(s["alerted_at"]) >= timedelta(hours=config["remindHours"]):
            s["alerted_at"] = common.iso(now)
            alerts.append({"kind": "still down", "name": r["name"], "url": r["url"],
                           "detail": f"{r['reason']}, down {_duration(now - common.parse_time(s['down_since']))}"})
    # Forget checks removed from the config, and keep the incident log short.
    for name in set(checks) - {r["name"] for r in results}:
        del checks[name]
    del incidents[:-50]
    return alerts


def _duration(delta):
    minutes = int(delta.total_seconds() // 60)
    return f"{minutes} min" if minutes < 120 else f"{minutes // 60} h {minutes % 60} min"


def message(alerts, results):
    down = [a for a in alerts if a["kind"] != "recovered"]
    subject = (f"Down: {', '.join(a['name'] for a in down)}" if down
               else f"Recovered: {', '.join(a['name'] for a in alerts)}")
    lines = [f"{a['kind'].upper()}: {a['name']} ({a['url']}) {a['detail']}" for a in alerts]
    lines += ["", "All checks this run:"]
    lines += [f"- {r['name']}: {'ok' if r['ok'] else r['reason']} in {r['ms']} ms" for r in results]
    return subject, "\n".join(lines)


def summary_markdown(results, alerts):
    lines = ["## Uptime", "", "| Check | Result | Time |", "|---|---|---|"]
    for r in results:
        result = "ok" + (" (slow)" if r["slow"] else "") if r["ok"] else r["reason"]
        lines.append(f"| [{r['name']}]({r['url']}) | {result} | {r['ms']} ms |")
    if alerts:
        lines += ["", "Alerts this run: " + "; ".join(f"{a['name']} {a['kind']}" for a in alerts)]
    return "\n".join(lines) + "\n"


def main(argv=None, now=None, fetch=common.request, sleep=time.sleep):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=HERE / "uptime.json")
    parser.add_argument("--state", type=Path, default=Path("uptime-state.json"))
    parser.add_argument("--dry-run", action="store_true", help="check and print; no alerts and no saved state")
    args = parser.parse_args(argv)
    now = now or common.now_utc()
    config = common.load_config(args.config, ["agent", "checks", "timeoutSeconds", "slowMs", "failAfter", "remindHours", "heartbeatHours"])

    results = run_checks(config, fetch, sleep)
    state = common.load_state(args.state)
    alerts = evaluate(state, results, config, now)
    failing = [r for r in results if not r["ok"]]
    print(f"{len(results)} checks, {len(failing)} failing, {len(alerts)} alerts. Channels: {', '.join(common.channels()) or 'none (job failure only)'}.")
    common.write_summary(summary_markdown(results, alerts))
    if args.dry_run:
        return 0

    sent = []
    if alerts:
        subject, text = message(alerts, results)
        sent = common.notify(subject, text)
    # Atlas hears about changes, plus a daily heartbeat so a quiet checker is distinguishable from a dead one.
    last = state.get("last_feed_at")
    heartbeat = not last or now - common.parse_time(last) >= timedelta(hours=config["heartbeatHours"])
    if alerts or heartbeat:
        down = [n for n, s in state["checks"].items() if s.get("alerted_at")]
        detail = f"{len(results) - len(failing)} of {len(results)} checks passing." + (f" Down: {', '.join(down)}." if down else "")
        if common.post_feed(config["agent"], "Uptime check", "failed" if down else "ok", detail, now):
            sent.append("atlas")
        state["last_feed_at"] = common.iso(now)
    changed = common.save_state(args.state, state)
    common.set_output("state_changed", "true" if changed else "false")

    new_trouble = [a for a in alerts if a["kind"] != "recovered"]
    if new_trouble and config.get("failJobOnAlert", True):
        # A red run is the alert of last resort: GitHub emails the workflow's owner about it.
        print(f"Alert raised ({', '.join(a['name'] for a in new_trouble)}); sent via {', '.join(sent) or 'no channel'}.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
