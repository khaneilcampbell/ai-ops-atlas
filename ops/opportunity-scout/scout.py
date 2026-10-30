"""Opportunity Scout: turn what Atlas already runs into ranked money ideas and one build-ready agent spec.

It reads only the agent registry in catalog/*.yaml (already in the checkout, so no API reads) and the
fingerprint of the last run. Nothing else happens when the registry is unchanged: no Claude call, no
report, no writes. When it changed, Claude proposes up to 3 scored ideas and a spec for the top one,
within a daily and monthly cap. It only recommends: it never spends, messages, publishes or merges.

  python3 ops/opportunity-scout/scout.py scan --state state.json --work work.json
  python3 ops/opportunity-scout/scout.py ideas --state state.json --work work.json   # needs `anthropic`
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
MECHANISMS = ["service", "product", "lead_generation", "client_automation", "other"]
MECHANISM_LABELS = {"service": "Service", "product": "Product", "lead_generation": "Lead generation",
                    "client_automation": "Automation for clients", "other": "Other"}
SCALES = ["revenue", "effort", "cost", "risk"]
SCORE = {"type": "integer", "enum": [1, 2, 3, 4, 5]}
TEXT_LIST = {"type": "array", "items": {"type": "string"}}
SCHEMA = {
    "type": "object",
    "properties": {
        "ideas": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "mechanism": {"type": "string", "enum": MECHANISMS},
                "customer": {"type": "string"},
                "reuses": TEXT_LIST,
                "days_to_first_dollar": {"type": "integer"},
                "monthly_cost_usd": {"type": "number"},
                "risks": {"type": "string"},
                "scores": {"type": "object", "properties": {k: SCORE for k in SCALES},
                           "required": SCALES, "additionalProperties": False},
            },
            "required": ["title", "mechanism", "customer", "reuses", "days_to_first_dollar", "monthly_cost_usd", "risks", "scores"],
            "additionalProperties": False,
        }},
        "spec": {
            "type": "object",
            "properties": {
                "idea": {"type": "string"}, "name": {"type": "string"}, "purpose": {"type": "string"},
                "trigger": {"type": "string"}, "schedule": {"type": "string"}, "inputs": TEXT_LIST, "outputs": TEXT_LIST,
                "monthly_cap_usd": {"type": "number"}, "building": {"type": "string"}, "approval_point": {"type": "string"},
            },
            "required": ["idea", "name", "purpose", "trigger", "schedule", "inputs", "outputs", "monthly_cap_usd", "building", "approval_point"],
            "additionalProperties": False,
        },
    },
    "required": ["ideas", "spec"],
    "additionalProperties": False,
}


def load_policy(path):
    policy = json.loads(Path(path).read_text())
    if not policy.get("enabled") or policy.get("mode") != "recommend":
        raise ValueError("Opportunity Scout needs enabled=true and mode=recommend")
    if not 1 <= policy.get("maxIdeas", 0) <= 3:
        raise ValueError("maxIdeas must be 1 to 3")
    return policy


def clip(text, n):
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def digest(catalog_dir, policy):
    """The registry as Claude sees it: identity, purpose and status only. No run data, links or secrets."""
    n = policy["purposeChars"]
    projects, agents = [], []
    for path in sorted(Path(catalog_dir).glob("*.yaml")):
        doc = yaml.safe_load(path.read_text()) or {}
        p = doc.get("project") or {}
        if not p.get("id"):
            continue
        projects.append({"id": p["id"], "name": p.get("name"), "status": p.get("status"), "repository": p.get("repository"),
                         "summary": clip(p.get("summary"), n), "tags": p.get("tags") or []})
        for a in doc.get("agents") or []:
            reg = a.get("registry") or {}
            agents.append({"id": a["id"], "project": p["id"], "name": a.get("name"), "status": a.get("status"),
                           "type": (reg.get("classification") or {}).get("type"), "category": reg.get("category"),
                           "framework": a.get("framework"), "purpose": clip(a.get("purpose"), n)})
    projects.sort(key=lambda x: x["id"])
    agents.sort(key=lambda x: x["id"])
    return {"projects": projects, "agents": agents}


def fingerprint(d, prompt_text):
    """Changes when the registry or the instructions change, never with time."""
    blob = json.dumps(d, sort_keys=True, separators=(",", ":")) + "\n" + prompt_text
    return hashlib.sha256(blob.encode()).hexdigest()


def load_state(path):
    try:
        state = json.loads(Path(path).read_text())
        return state if state.get("version") == 1 else {"version": 1}
    except (OSError, ValueError):
        return {"version": 1}


def parse_time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def budget(state, policy, now):
    """None when a model call may run, else why not. Reserves the worst case before any call."""
    m = policy["model"]
    month, day = now.strftime("%Y-%m"), now.strftime("%Y-%m-%d")
    spend = state.get("spend", {})
    spent = spend.get("usd", 0.0) if spend.get("month") == month else 0.0
    calls = state.get("calls", {})
    today = calls.get("count", 0) if calls.get("day") == day else 0
    worst = (m["worstCaseInputTokens"] * m["inputUsdPerMTok"] + m["maxTokens"] * m["outputUsdPerMTok"]) / 1e6
    if today >= m["maxPerDay"]:
        return f"daily cap of {m['maxPerDay']} runs reached"
    if spent + worst > m["monthlyBudgetUsd"]:
        return f"monthly budget ${m['monthlyBudgetUsd']:.2f} would be exceeded (${spent:.3f} spent)"
    return None


def decide(state, fp, policy, now, has_key, fresh=False):
    """Whether this run asks Claude for ideas, and whether it reports at all."""
    changed = fp != state.get("fingerprint")
    last = state.get("last_report_at")
    heartbeat = not last or now - parse_time(last) >= timedelta(days=policy["heartbeatDays"])
    if not (changed or fresh):
        why_not = "registry unchanged"
    elif not has_key:
        why_not = "no ANTHROPIC_API_KEY"
    else:
        why_not = budget(state, policy, now)
    return {"fingerprint": fp, "changed": changed, "fresh": fresh, "report": changed or fresh or heartbeat,
            "ideas": why_not is None, "skipped": why_not}


def total(scores):
    return round((2 * scores["revenue"] + scores["effort"] + scores["cost"] + scores["risk"]) / 5, 1)


def review(result, d, policy):
    """Rank by the fixed formula and check every claim against the registry. Notes are shown, never hidden."""
    agents = {a["id"]: a for a in d["agents"]}
    projects = {p["id"] for p in d["projects"]}
    ideas, notes = [], []
    for idea in (result.get("ideas") or [])[: policy["maxIdeas"]]:
        idea = dict(idea)
        idea["score"] = total(idea["scores"])
        known = [r for r in idea["reuses"] if r in agents or r in projects]
        unknown = [r for r in idea["reuses"] if r not in known]
        idle = [r for r in known if r in agents and agents[r]["status"] not in {"active", None}]
        idea["reuses"] = known
        if unknown:
            notes.append(f'"{idea["title"]}" named {len(unknown)} item(s) that are not in the registry; they were dropped.')
        if idle:
            notes.append(f'"{idea["title"]}" depends on {", ".join(idle)}, which is not active today.')
        ideas.append(idea)
    ideas.sort(key=lambda i: (-i["score"], -i["scores"]["revenue"], i["title"]))
    spec = dict(result.get("spec") or {})
    if spec:
        if ideas and spec.get("idea") != ideas[0]["title"]:
            notes.append(f'The spec is for "{spec.get("idea")}", not the top-ranked idea "{ideas[0]["title"]}".')
        if spec.get("building") not in projects:
            notes.append(f'The spec\'s building "{spec.get("building")}" is not an Atlas project.')
        cap = policy["spec"]["maxMonthlyCapUsd"]
        if not isinstance(spec.get("monthly_cap_usd"), (int, float)) or spec["monthly_cap_usd"] > cap:
            notes.append(f"The spec's cap was above ${cap:.0f} a month and was lowered to ${cap:.0f}.")
            spec["monthly_cap_usd"] = cap
        if not str(spec.get("approval_point") or "").strip():
            notes.append("The spec had no human approval point; do not build it until one is added.")
    return {"ideas": ideas, "spec": spec, "notes": notes}


def cell(text):
    return str(text).replace("|", "/").replace("\n", " ")


def report_markdown(r, d, publish_details=True):
    lines = ["## Opportunity Scout", "", f'Read {len(d["projects"])} projects and {len(d["agents"])} agents from the registry.', ""]
    if not r["ideas"]:
        return "\n".join(lines + ["No ideas this run.", ""])
    lines += ["| # | Idea | How it earns | Customer | First $ | Cost/mo | Rev | Effort | Cost | Risk | Score |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
    for n, i in enumerate(r["ideas"], 1):
        s = i["scores"]
        lines.append(f'| {n} | {cell(i["title"])} | {MECHANISM_LABELS[i["mechanism"]]} | {cell(i["customer"]) if publish_details else "…"} | '
                     f'~{i["days_to_first_dollar"]}d | ${i["monthly_cost_usd"]:.2f} | {s["revenue"]} | {s["effort"]} | {s["cost"]} | {s["risk"]} | {i["score"]} |')
    lines += ["", "Score = (2 x revenue + effort + cost + risk) / 5, where 5 is always best.", ""]
    if publish_details:
        for n, i in enumerate(r["ideas"], 1):
            lines.append(f'{n}. **{cell(i["title"])}** reuses {", ".join(f"`{x}`" for x in i["reuses"]) or "nothing listed"}. Risks: {cell(i["risks"])}')
        spec = r["spec"]
        if spec:
            lines += ["", f'### Agent spec: {cell(spec["name"])}', "",
                      f'- **Purpose:** {cell(spec["purpose"])}', f'- **Trigger:** {cell(spec["trigger"])}',
                      f'- **Schedule:** {cell(spec["schedule"])}', f'- **Inputs:** {cell("; ".join(spec["inputs"]))}',
                      f'- **Outputs:** {cell("; ".join(spec["outputs"]))}', f'- **Monthly cap:** ${spec["monthly_cap_usd"]:.2f}',
                      f'- **Building:** `{cell(spec["building"])}`', f'- **Human approval:** {cell(spec["approval_point"])}']
    else:
        lines.append("Details are kept out of this public page (`publishDetails` is off); they are in Atlas's feed.")
    if r["notes"]:
        lines += ["", "### Checks", ""] + [f"- {cell(n)}" for n in r["notes"]]
    return "\n".join(lines) + "\n"


def headline(r):
    if not r["ideas"]:
        return "No ideas this run."
    top = r["ideas"][0]
    text = f'{len(r["ideas"])} ideas. Top: {top["title"]} (score {top["score"]}, first dollar in ~{top["days_to_first_dollar"]} days).'
    if r["spec"]:
        text += f' Spec: {r["spec"]["name"]}, cap ${r["spec"]["monthly_cap_usd"]:.2f}/month, building {r["spec"]["building"]}.'
    return clip(text, 300)


def model_input(d, state):
    return json.dumps({"registry": d, "previous_ideas": state.get("last_ideas", [])}, separators=(",", ":"))


def ask_claude(d, state, policy):
    import anthropic  # installed by the workflow only when ideas are due

    m = policy["model"]
    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=m["name"], max_tokens=m["maxTokens"],
        output_config={"effort": m["effort"], "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        system=(HERE / "prompt.md").read_text(),
        messages=[{"role": "user", "content": model_input(d, state)}],
    )
    cost = (response.usage.input_tokens * m["inputUsdPerMTok"] + response.usage.output_tokens * m["outputUsdPerMTok"]) / 1e6
    if response.stop_reason in {"refusal", "max_tokens"}:
        return None, cost, response.stop_reason
    text = "".join(block.text for block in response.content if block.type == "text")
    return json.loads(text), cost, None


def post_feed(detail, status, now):
    """Optional: one line to Atlas's agent feed (behind Access), when ATLAS_FEED_URL and ATLAS_FEED_TOKEN are set."""
    url, token = os.environ.get("ATLAS_FEED_URL"), os.environ.get("ATLAS_FEED_TOKEN")
    if not url or not token:
        return False
    body = {"project": "github-profile", "agents": ["github-opportunity-scout"], "phase": "Opportunity scan",
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


def cmd_scan(args, now=None):
    now = now or datetime.now(timezone.utc)
    policy = load_policy(args.policy)
    d = digest(args.catalog or ROOT / policy["catalog"], policy)
    fp = fingerprint(d, (HERE / "prompt.md").read_text())
    state = load_state(args.state)
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY")) and not args.dry_run
    dec = decide(state, fp, policy, now, has_key, fresh=args.fresh)
    size = len(model_input(d, state))
    print(f'{len(d["projects"])} projects, {len(d["agents"])} agents, {size} bytes of input. '
          f'Changed: {dec["changed"]}. Ideas: {dec["ideas"] or dec["skipped"]}.')
    Path(args.work).write_text(json.dumps({"digest": d, "decision": dec}))
    if args.dry_run:
        write_summary(f'## Opportunity Scout\n\nDry run: read {len(d["projects"])} projects and {len(d["agents"])} agents '
                      f'({size} bytes). No model call.\n')
    elif not dec["ideas"]:
        finish(args, state, dec, None, now)
    set_output("ideas", "true" if dec["ideas"] else "false")
    return d, dec


def finish(args, state, dec, r, now, cost=0.0, attempted=False):
    policy = load_policy(args.policy)
    if r is not None:
        work = json.loads(Path(args.work).read_text())
        write_summary(report_markdown(r, work["digest"], policy["publishDetails"]))
        post_feed(headline(r), "ok", now)
        state["last_ideas"] = [i["title"] for i in r["ideas"]]
        state["last_report_at"] = now.isoformat(timespec="seconds")
    elif dec["report"]:
        write_summary(f'## Opportunity Scout\n\nNo new ideas: {dec["skipped"]}.\n')
        post_feed(f'No new ideas: {dec["skipped"]}.', "skipped", now)
        state["last_report_at"] = now.isoformat(timespec="seconds")
    if r is not None or dec["skipped"] == "registry unchanged":
        state["fingerprint"] = dec["fingerprint"]  # a skipped call keeps the old one so the change is retried
    if attempted:  # a failed call still counts toward the daily cap, so errors cannot loop
        month, day = now.strftime("%Y-%m"), now.strftime("%Y-%m-%d")
        spend = state.get("spend", {})
        state["spend"] = {"month": month, "usd": round((spend.get("usd", 0.0) if spend.get("month") == month else 0.0) + cost, 6)}
        calls = state.get("calls", {})
        state["calls"] = {"day": day, "count": (calls.get("count", 0) if calls.get("day") == day else 0) + 1}
    Path(args.state).write_text(json.dumps(state))


def cmd_ideas(args, now=None):
    now = now or datetime.now(timezone.utc)
    policy = load_policy(args.policy)
    work = json.loads(Path(args.work).read_text())
    state = load_state(args.state)
    d, dec = work["digest"], work["decision"]
    r = None
    try:
        result, cost, stopped = ask_claude(d, state, policy)
        if result is not None:
            r = review(result, d, policy)
        else:
            dec["skipped"] = f"the model stopped early ({stopped})"
    except Exception as e:  # the scan still counts; ideas are retried on the next change
        print(f"Ideas failed: {type(e).__name__}", file=sys.stderr)
        cost = 0.0
        dec["skipped"] = "the Claude call failed"
    print(f"Ideas: {len(r['ideas']) if r else 0}, about ${cost:.4f}.")
    finish(args, state, dec, r, now, cost, attempted=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["scan", "ideas"])
    parser.add_argument("--policy", type=Path, default=HERE / "policy.json")
    parser.add_argument("--catalog", type=Path, default=None)
    parser.add_argument("--state", type=Path, default=Path("opportunity-scout-state.json"))
    parser.add_argument("--work", type=Path, default=Path("opportunity-scout-work.json"))
    parser.add_argument("--dry-run", action="store_true", help="read and count only; no model call, no feed, no saved state")
    parser.add_argument("--fresh", action="store_true", help="ask for ideas even when the registry is unchanged (caps still apply)")
    args = parser.parse_args(argv)
    (cmd_scan if args.command == "scan" else cmd_ideas)(args)


if __name__ == "__main__":
    main()
