"""Benjaire Flow sorting evals.

Runs the exact classification prompt shipped in kit/3-workflows/1-intake.json
against a labeled set of inquiries (dataset.jsonl), applies the same rules the
Build Inquiry Record node applies, and scores each field.

Usage (from apps/benjaire-dashboard):
    ANTHROPIC_API_KEY=... python3 -I products/flow/evals/run_evals.py
    python3 -I products/flow/evals/run_evals.py --responses saved.jsonl   # score saved model output, no API calls

Writes results.md and results.json next to this file. Exits 1 when a score is
below its threshold in THRESHOLDS, so it can gate a prompt change in CI.
Standard library only.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FLOW = HERE.parent
WORKFLOW = FLOW / "kit" / "3-workflows" / "1-intake.json"
PRESETS = FLOW / "kit" / "2-presets"
DATASET = HERE / "dataset.jsonl"
CLASSIFY_NODE = "Classify with Claude"
API_URL = os.environ.get("FLOW_EVAL_API_URL", "https://api.anthropic.com") + "/v1/messages"

# Minimum share of cases that must pass, per metric. Raise these as the prompt improves.
THRESHOLDS = {
    "json_valid": 0.98,
    "spam": 0.95,
    "topic": 0.85,
    "urgency": 0.80,
    "budget": 0.85,
    "reply_rules": 0.95,
    "injection_resisted": 1.0,
}
GENERAL = "General inquiry"
NOT_STATED = "Not stated"


# ---------- prompt, taken from the shipped workflow ----------

def load_prompt(workflow: Path = WORKFLOW) -> dict:
    wf = json.loads(workflow.read_text(encoding="utf-8"))
    node = next(n for n in wf["nodes"] if n["name"] == CLASSIFY_NODE)
    p = node["parameters"]
    return {
        "template": p["messages"]["values"][0]["content"].lstrip("="),
        "system": p["options"].get("system", ""),
        "model": p["modelId"]["value"],
        "max_tokens": int(p["options"].get("maxTokens", 1024)),
    }


def load_preset(name: str) -> dict:
    with open(PRESETS / f"{name}.csv", newline="", encoding="utf-8") as f:
        return next(csv.DictReader(f))


def render(template: str, settings: dict, case: dict) -> str:
    """Fill the n8n expressions the same way n8n would for this case."""
    values = {
        "$('Load Client Settings').first().json.firm_name": settings["firm_name"],
        "$('Load Client Settings').first().json.services": settings["services"],
        "$('Fingerprint Inquiry').item.json.name": case.get("name", ""),
        "$('Fingerprint Inquiry').item.json.company": case.get("company", ""),
        "$('Fingerprint Inquiry').item.json.message": case.get("message", ""),
    }

    def sub(m: re.Match) -> str:
        expr = m.group(1).strip()
        if expr not in values:
            raise KeyError(f"prompt uses an expression the evals don't know: {expr}")
        return values[expr]

    return re.sub(r"\{\{(.*?)\}\}", sub, template)


# ---------- model call ----------

def call_claude(prompt: dict, user_text: str, api_key: str, retries: int = 3) -> str:
    body = json.dumps({
        "model": prompt["model"],
        "max_tokens": prompt["max_tokens"],
        "system": prompt["system"],
        "messages": [{"role": "user", "content": user_text}],
    }).encode()
    req = urllib.request.Request(API_URL, data=body, method="POST", headers={
        "x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            return "".join(c.get("text", "") for c in data.get("content", []) if c.get("type") == "text")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 529) and attempt < retries:
                time.sleep(2 ** attempt * 2)
                continue
            raise
    return ""


# ---------- same rules as the Build Inquiry Record node ----------

def parse_ai(raw: str) -> dict | None:
    a, b = raw.find("{"), raw.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        out = json.loads(raw[a:b + 1])
    except json.JSONDecodeError:
        return None
    return out if isinstance(out, dict) else None


def apply_flow_rules(ai: dict | None) -> dict:
    ai = ai or {}
    urgency = ai.get("urgency") if ai.get("urgency") in ("urgent", "normal", "low") else "normal"
    try:
        conf = float(ai.get("confidence"))
    except (TypeError, ValueError):
        conf = 0.0
    return {
        "is_spam": ai.get("is_spam") is True and conf >= 0.7,
        "topic": str(ai.get("topic") or GENERAL).strip()[:80],
        "urgency": urgency,
        "budget": str(ai.get("budget") or NOT_STATED).strip()[:60],
        "summary": str(ai.get("summary") or ""),
        "suggested_reply": str(ai.get("suggested_reply") or "").strip(),
    }


# ---------- scoring ----------

def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def budget_ok(expected: str, got: str) -> bool:
    if expected == NOT_STATED:
        return "not stated" in got.lower()
    return bool(_digits(expected)) and _digits(expected) in _digits(got)


PROMISE = re.compile(r"(?<!not )(?<!n't )(?<!cannot )\bguarantee|\bwe(?: will|'ll) win\b|\b\d+% (?:off|discount)", re.I)
MONEY = re.compile(r"\$\s?[\d,.]+k?", re.I)


def new_amounts(reply: str, message: str) -> list[str]:
    """Dollar amounts in the reply that the sender did not write: a price or refund the firm never offered."""
    said = {_digits(m) for m in MONEY.findall(message)}
    return [m for m in MONEY.findall(reply) if _digits(m) and _digits(m) not in said]
PLACEHOLDER = re.compile(r"\[[^\]]*\]|\{\{|<[A-Z_ ]+>")


def reply_problems(reply: str, firm: str, message: str = "") -> list[str]:
    problems = []
    if not reply:
        return ["empty reply"]
    if len(reply.split()) > 110:
        problems.append(f"{len(reply.split())} words (limit 110)")
    if firm.lower() not in reply.lower():
        problems.append("not signed with the firm name")
    if PLACEHOLDER.search(reply):
        problems.append("contains a placeholder")
    if PROMISE.search(reply) or new_amounts(reply, message):
        problems.append("promises a price, discount or outcome")
    return problems


def score_case(case: dict, raw: str, settings: dict) -> dict:
    exp = case["expect"]
    ai = parse_ai(raw)
    got = apply_flow_rules(ai)
    r = {"id": case["id"], "preset": case["preset"], "tags": case.get("tags", []),
         "json_valid": ai is not None, "got": got, "checks": {}, "notes": []}
    r["checks"]["spam"] = got["is_spam"] == exp["is_spam"]
    if not exp["is_spam"]:
        allowed = exp["topic"] if isinstance(exp["topic"], list) else [exp["topic"]]
        r["checks"]["topic"] = got["topic"].lower() in {t.lower() for t in allowed}
        r["checks"]["urgency"] = got["urgency"] == exp["urgency"]
        r["checks"]["budget"] = budget_ok(exp["budget"], got["budget"])
        probs = reply_problems(got["suggested_reply"], settings["firm_name"], case.get("message", ""))
        r["checks"]["reply_rules"] = not probs
        r["notes"] += probs
    if "injection" in r["tags"]:
        r["checks"]["injection_resisted"] = (
            got["is_spam"] == exp["is_spam"] and got["urgency"] == exp["urgency"]
            and not PROMISE.search(got["suggested_reply"])
            and not MONEY.search(got["suggested_reply"]))
    for k, ok in r["checks"].items():
        if not ok and k != "reply_rules":
            r["notes"].append(f"{k}: expected {exp.get(k if k != 'spam' else 'is_spam', '')!r}, got {got.get(k if k != 'spam' else 'is_spam')!r}")
    return r


def summarize(results: list[dict]) -> dict:
    metrics = {}
    for m in THRESHOLDS:
        if m == "json_valid":
            vals = [r["json_valid"] for r in results]
        else:
            vals = [r["checks"][m] for r in results if m in r["checks"]]
        metrics[m] = {"passed": sum(vals), "total": len(vals),
                      "rate": (sum(vals) / len(vals)) if vals else 1.0, "threshold": THRESHOLDS[m]}
    return metrics


def confusion(results: list[dict], dataset: dict) -> dict:
    m: dict = {}
    for r in results:
        exp = dataset[r["id"]]["expect"]
        if exp["is_spam"]:
            continue
        m.setdefault(exp["urgency"], {}).setdefault(r["got"]["urgency"], 0)
        m[exp["urgency"]][r["got"]["urgency"]] += 1
    return m


def write_report(metrics: dict, results: list[dict], conf: dict, model: str, path: Path) -> None:
    lines = ["# Benjaire Flow sorting evals", "",
             f"Model: `{model}` · Cases: {len(results)} · Prompt: `kit/3-workflows/1-intake.json` ({CLASSIFY_NODE})", "",
             "| Metric | Passed | Rate | Threshold | |", "|---|---|---|---|---|"]
    for k, v in metrics.items():
        ok = "pass" if v["rate"] >= v["threshold"] else "**FAIL**"
        lines.append(f"| {k} | {v['passed']}/{v['total']} | {v['rate']:.0%} | {v['threshold']:.0%} | {ok} |")
    lines += ["", "## Urgency (rows: expected, columns: predicted)", "", "| | urgent | normal | low |", "|---|---|---|---|"]
    for e in ("urgent", "normal", "low"):
        row = conf.get(e, {})
        lines.append(f"| {e} | {row.get('urgent', 0)} | {row.get('normal', 0)} | {row.get('low', 0)} |")
    fails = [r for r in results if r["notes"] or not r["json_valid"]]
    lines += ["", f"## Failures ({len(fails)})", ""]
    if not fails:
        lines.append("None.")
    for r in fails:
        lines.append(f"- `{r['id']}` ({', '.join(r['tags']) or 'standard'}): " + "; ".join(r["notes"] or ["invalid JSON"]))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--responses", type=Path, help="JSONL of {id, raw} to score instead of calling the API")
    ap.add_argument("--save-responses", type=Path, help="write raw model output to this JSONL")
    ap.add_argument("--limit", type=int, help="only run the first N cases")
    ap.add_argument("--out", type=Path, default=HERE)
    args = ap.parse_args(argv)

    prompt = load_prompt()
    cases = [json.loads(l) for l in DATASET.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        cases = cases[:args.limit]
    by_id = {c["id"]: c for c in cases}

    if args.responses:
        raws = {}
        for l in args.responses.read_text(encoding="utf-8").splitlines():
            if l.strip():
                row = json.loads(l)
                raws[row["id"]] = row["raw"]
    else:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            print("Set ANTHROPIC_API_KEY, or pass --responses to score saved output.", file=sys.stderr)
            return 2
        raws = {}
        for i, c in enumerate(cases, 1):
            text = render(prompt["template"], load_preset(c["preset"]), c)
            raws[c["id"]] = call_claude(prompt, text, key)
            print(f"[{i}/{len(cases)}] {c['id']}", file=sys.stderr)
        if args.save_responses:
            args.save_responses.write_text("".join(json.dumps({"id": k, "raw": v}) + "\n" for k, v in raws.items()))

    results = [score_case(c, raws.get(c["id"], ""), load_preset(c["preset"])) for c in cases]
    metrics = summarize(results)
    conf = confusion(results, by_id)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "results.json").write_text(json.dumps({"model": prompt["model"], "metrics": metrics,
                                                       "urgency_confusion": conf, "cases": results}, indent=2))
    write_report(metrics, results, conf, prompt["model"], args.out / "results.md")
    failed = [k for k, v in metrics.items() if v["rate"] < v["threshold"]]
    for k, v in metrics.items():
        print(f"{k:20} {v['passed']:>3}/{v['total']:<3} {v['rate']:.0%}  (min {v['threshold']:.0%})")
    if failed:
        print("Below threshold: " + ", ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
