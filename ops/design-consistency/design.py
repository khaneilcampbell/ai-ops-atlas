"""Design Consistency: keep Atlas's look on one set of design tokens.

The check is plain code and free. It reads src/styles/tokens.css (the single tokens file) and flags
hard-coded colors, off-scale spacing and type sizes, font stacks and radii in the other stylesheets,
literal colors in React inline styles, and building or agent names that break the naming scheme
(short Title Case, brand first, no domains or dashes). Findings already on main when the agent was
added are recorded in baseline.json, so only new drift is called new; the backlog shrinks one PR
at a time.

When there is something to fix and no fix PR is open, it prepares one batch:
- swaps that cannot change the picture (a literal that equals a token, or a token with an alpha)
  are made by code, with no model call;
- anything that needs judgment (a near-miss color, an off-scale size, a name) goes to Claude in
  one small call, within a daily and monthly cap. Claude answers with a closed schema, and every
  edit is checked again before it is kept.
It never merges. The workflow opens the PR with before and after screenshots; KC says "merge".

  python3 ops/design-consistency/design.py scan               # findings and what a fix run would do
  python3 ops/design-consistency/design.py fix                # edit the working tree (needs `anthropic` for judgment batches)
  python3 ops/design-consistency/design.py pr --branch NAME   # open the pull request for the pushed branch
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from fnmatch import fnmatch
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
API = "https://api.github.com"
BRANCH_PREFIX = "design-consistency/"
SETTINGS_URL = "https://github.com/khaneilcampbell/ai-ops-atlas/settings/actions"
PR_BLOCKED_RETRY = timedelta(days=1)
RULES = ["color", "spacing", "type", "font", "radius", "inline", "label"]
RULE_LABELS = {"color": "Hard-coded color", "spacing": "Off-scale spacing", "type": "Off-scale type size",
               "font": "Font stack outside tokens", "radius": "Radius that equals a token", "inline": "Inline style color",
               "label": "Name outside the naming scheme"}
SPACING_PROPS = re.compile(r"^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(row-|column-)?gap$")
SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"}
HEX = r"#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b"
COLOR_RE = re.compile(HEX + r"|\b(?:rgba?|hsla?)\([^()]*\)")
DECL_RE = re.compile(r"(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+)")
PX_RE = re.compile(r"(?<![\w.#-])-?(\d+(?:\.\d+)?)px\b")
EDIT_SCHEMA = {
    "type": "object",
    "properties": {
        "edits": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "action": {"type": "string", "enum": ["replace", "keep"]},
                "new": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["id", "action", "new", "reason"],
            "additionalProperties": False,
        }},
        "summary": {"type": "string"},
    },
    "required": ["edits", "summary"],
    "additionalProperties": False,
}


# ---- tokens -------------------------------------------------------------------------------------

def parse_color(text):
    """(r, g, b, a) for hex, rgb() and rgba() literals; None for anything else (hsl, keywords)."""
    t = text.strip().lower()
    if t.startswith("#"):
        h = t[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        if len(h) not in (6, 8):
            return None
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), round(a, 3))
    m = re.fullmatch(r"rgba?\(([^)]*)\)", t)
    if not m:
        return None
    parts = [p for p in re.split(r"[\s,/]+", m.group(1).strip()) if p]
    if len(parts) not in (3, 4):
        return None
    try:
        rgb = [round(float(p[:-1]) * 2.55) if p.endswith("%") else int(float(p)) for p in parts[:3]]
        a = 1.0 if len(parts) == 3 else (float(parts[3][:-1]) / 100 if parts[3].endswith("%") else float(parts[3]))
    except ValueError:
        return None
    return (*rgb, round(a, 3))


def px(value):
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)px\s*", value)
    return float(m.group(1)) if m else None


def load_tokens(path):
    """Everything the check needs from tokens.css: named colors, the spacing and type scales, radii, font names."""
    text = Path(path).read_text()
    tokens = {"colors": {}, "space": {}, "text": {}, "radius": {}, "fonts": set(), "names": set()}
    for name, value in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", text):
        tokens["names"].add(name)
        value = value.strip()
        c = parse_color(value)
        if c and c[3] == 1.0:
            tokens["colors"].setdefault(c[:3], name)
        elif name.startswith("--space-") and px(value) is not None:
            tokens["space"][px(value)] = name
        elif name.startswith("--text-") and px(value) is not None:
            tokens["text"][px(value)] = name
        elif name.startswith("--radius") and px(value) is not None:
            tokens["radius"][px(value)] = name
        elif name in ("--serif", "--sans", "--mono"):
            tokens["fonts"].add(name)
    return tokens


def distance(a, b):
    return sum((x - y) ** 2 for x, y in zip(a[:3], b[:3])) ** 0.5


def nearest(color, tokens):
    best = min(tokens["colors"].items(), key=lambda kv: distance(color, kv[0]))
    return best[1], round(distance(color, best[0]), 1)


def pct(a):
    return f"{round(a * 100, 1):g}%"


def token_color(color, tokens, near_limit):
    """How a literal relates to the palette: exact token, token with alpha, near miss, or off palette."""
    name, d = nearest(color, tokens)
    if d == 0 and color[3] == 1.0:
        return "exact", f"var({name})", name, d
    if d == 0:
        return "alpha", f"color-mix(in srgb, var({name}) {pct(color[3])}, transparent)", name, d
    return ("near" if d <= near_limit else "off"), None, name, d


# ---- scanning -----------------------------------------------------------------------------------

def strip_var_fallbacks(value):
    """Removes `var(--x, fallback)` fallbacks: they never render while the token exists."""
    out, i = [], 0
    while i < len(value):
        j = value.find("var(", i)
        if j < 0:
            out.append(value[i:])
            break
        out.append(value[i:j])
        depth, k = 0, j + 3
        while k < len(value):
            depth += value[k] == "("
            depth -= value[k] == ")"
            k += 1
            if depth == 0:
                break
        inner = value[j + 4:k - 1]
        out.append("var(" + inner.split(",")[0] + ")" + " " * (k - j - len(inner.split(",")[0]) - 5))
        i = k
    return "".join(out)


def finding(rule, file, line, prop, value, col, kind, fix=None, token=None, note="", context=""):
    return {"rule": rule, "file": file, "line": line, "prop": prop, "value": value, "col": col, "kind": kind,
            "fix": fix, "token": token, "note": note, "context": context.strip()[:200]}


def scan_css(rel, text, tokens, policy):
    found = []
    in_comment = False
    for n, raw in enumerate(text.splitlines(), 1):
        if "design-ok" in raw:
            continue
        line, buf, i = raw, [], 0
        while i < len(line):  # blank out comments, keeping columns
            if in_comment:
                j = line.find("*/", i)
                buf.append(" " * ((len(line) if j < 0 else j + 2) - i))
                i, in_comment = (len(line), True) if j < 0 else (j + 2, False)
            else:
                j = line.find("/*", i)
                if j < 0:
                    buf.append(line[i:])
                    break
                buf.append(line[i:j])
                i, in_comment = j, True
        code = "".join(buf)
        start = code.rfind("{") + 1 if "{" in code else 0
        for m in DECL_RE.finditer(code, start):
            prop, value = m.group(1), m.group(2)
            vstart = m.start(2)
            scan_value = strip_var_fallbacks(value)
            for c in COLOR_RE.finditer(scan_value):
                parsed = parse_color(c.group(0))
                if parsed is None:
                    found.append(finding("color", rel, n, prop, c.group(0), vstart + c.start(), "off", note="not a hex or rgb color", context=raw))
                    continue
                kind, fix, token, d = token_color(parsed, tokens, policy["nearColorDistance"])
                found.append(finding("color", rel, n, prop, c.group(0), vstart + c.start(), kind, fix, token,
                                     "" if d == 0 else f"nearest {token}, distance {d}", raw))
            if SPACING_PROPS.match(prop):
                for p in PX_RE.finditer(scan_value):
                    v = float(p.group(1))
                    if v and v not in tokens["space"]:
                        found.append(finding("spacing", rel, n, prop, p.group(0).lstrip("-"), vstart + p.start(1), "judgment",
                                             note=f"scale: {scale_hint(v, tokens['space'])}", context=raw))
            elif prop == "font-size":
                for p in PX_RE.finditer(scan_value):
                    v = float(p.group(1))
                    if v not in tokens["text"]:
                        found.append(finding("type", rel, n, prop, p.group(0), vstart + p.start(1), "judgment",
                                             note=f"scale: {scale_hint(v, tokens['text'])}", context=raw))
            elif prop == "font-family":
                v = scan_value.strip()
                if not (re.fullmatch(r"var\((--[\w-]+)\)", v) and v[4:-1] in tokens["fonts"]) and v not in ("inherit", "monospace"):
                    found.append(finding("font", rel, n, prop, value.strip(), vstart + (len(value) - len(value.lstrip())), "judgment",
                                         note="use var(--serif), var(--sans) or var(--mono)", context=raw))
            elif prop == "border-radius":
                v = px(scan_value)
                if v is not None and v in tokens["radius"]:
                    name = tokens["radius"][v]
                    found.append(finding("radius", rel, n, prop, value.strip(), vstart + (len(value) - len(value.lstrip())), "exact",
                                         f"var({name})", name, context=raw))
    return found


def scale_hint(v, scale):
    below = max((s for s in scale if s < v), default=None)
    above = min((s for s in scale if s > v), default=None)
    return " or ".join(f"{s:g}px ({scale[s]})" for s in (below, above) if s is not None)


INLINE_RE = re.compile(r"\b(color|background|backgroundColor|borderColor|fill|stroke|fontFamily)\s*:\s*\"([^\"]+)\"")


def scan_tsx(rel, text, tokens, policy):
    """Literal colors and font stacks inside React `style={{ ... }}` objects in UI components."""
    found = []
    for n, raw in enumerate(text.splitlines(), 1):
        if "style={{" not in raw or "design-ok" in raw:
            continue
        for m in INLINE_RE.finditer(raw, raw.find("style={{")):
            prop, value = m.group(1), m.group(2)
            if prop == "fontFamily":
                found.append(finding("inline", rel, n, prop, value, m.start(2), "judgment", note="use var(--sans) or a class", context=raw))
                continue
            for c in COLOR_RE.finditer(value):
                parsed = parse_color(c.group(0))
                kind, fix, token = "off", None, None
                if parsed:
                    kind, fix, token, _ = token_color(parsed, tokens, policy["nearColorDistance"])
                found.append(finding("inline", rel, n, prop, c.group(0), m.start(2) + c.start(), kind, fix, token, context=raw))
    return found


def label_problems(name, kind):
    problems = []
    if re.search(r"\.(com|net|org|io|dev|app|ai)\b", name, re.I):
        problems.append("contains a domain")
    if re.search(r"\s[-–—]\s|_|(?<=[a-z])-(?=[a-z]+-)", name) or (kind == "project" and "-" in name):
        problems.append("contains dashes or underscores")
    words = name.split()
    for i, w in enumerate(words):
        head = w.split("-")[0]
        if not head or (i and head in SMALL_WORDS):
            continue
        if not (head[0].isupper() or head[0].isdigit()):
            problems.append(f'"{w}" is not capitalized')
    if kind == "project" and len(words) > 3:
        problems.append("is longer than 3 words")
    if kind == "agent" and len(words) > 5:
        problems.append("is longer than 5 words")
    if name != name.strip() or "  " in name:
        problems.append("has extra spaces")
    return problems


def scan_labels(catalog_dir, root=ROOT):
    """Building (project) and agent names in catalog/*.yaml, against the scheme from the label cleanup."""
    found = []
    for path in sorted(Path(catalog_dir).glob("*.yaml")):
        rel = path.relative_to(root).as_posix() if path.is_relative_to(root) else path.name
        lines = path.read_text().splitlines()
        section, seen = None, Counter()
        for n, raw in enumerate(lines, 1):
            if re.match(r"^project:\s*$", raw):
                section = "project"
            elif re.match(r"^agents:\s*$", raw):
                section = "agent"
            elif re.match(r"^\S", raw):
                section = None
            m = re.match(r"^(  name|    name):\s*(.+?)\s*$", raw)
            if not m or section is None or "design-ok" in raw:
                continue
            if (section == "project") != (m.group(1) == "  name"):
                continue
            name = m.group(2).strip("'\"")
            seen[name] += 1
            problems = label_problems(name, section)
            if section == "agent" and seen[name] > 1:
                problems.append("repeats another agent's name in this building")
            if problems:
                found.append(finding("label", rel, n, f"{section} name", name, raw.index(m.group(2)), "judgment",
                                     note="; ".join(problems), context=raw))
    return found


def in_scope(rel, patterns):
    return any(fnmatch(rel, p) for p in patterns)


def scan(policy, root=ROOT):
    tokens_path = root / policy["tokens"]
    tokens = load_tokens(tokens_path)
    found = []
    for path in sorted(root.glob("src/**/*")):
        rel = path.relative_to(root).as_posix()
        if not path.is_file() or rel == policy["tokens"] or in_scope(rel, policy["exclude"]):
            continue
        if path.suffix == ".css" and in_scope(rel, policy["css"]):
            found += scan_css(rel, path.read_text(), tokens, policy)
        elif path.suffix == ".tsx" and in_scope(rel, policy["tsx"]):
            found += scan_tsx(rel, path.read_text(), tokens, policy)
    found += scan_labels(root / policy["catalog"], root)
    for i, f in enumerate(found):
        f["id"] = f"f{i + 1}"
    return found, tokens


def key(f):
    return f'{f["rule"]}|{f["file"]}|{f["prop"]}|{f["value"].lower()}'


def baseline_counts(found):
    return dict(sorted(Counter(key(f) for f in found).items()))


def mark_new(found, baseline):
    left = Counter(baseline)
    for f in found:
        k = key(f)
        f["new"] = left[k] <= 0
        left[k] -= 1
    return found


# ---- deciding and batching ----------------------------------------------------------------------

def load_policy(path):
    policy = json.loads(Path(path).read_text())
    if not policy.get("enabled") or policy.get("mode") != "propose":
        raise ValueError("Design Consistency needs enabled=true and mode=propose")
    return policy


def load_state(path):
    try:
        state = json.loads(Path(path).read_text())
        return state if state.get("version") == 1 else {"version": 1}
    except (OSError, ValueError):
        return {"version": 1}


def budget(state, policy, now, needs_model):
    """None when a fix run may go ahead, else why not. Runs count per day; spend only matters for model calls."""
    m = policy["model"]
    day, month = now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")
    runs = state.get("runs", {})
    if (runs.get("count", 0) if runs.get("day") == day else 0) >= policy["maxRunsPerDay"]:
        return f"daily cap of {policy['maxRunsPerDay']} fix runs reached"
    if needs_model:
        spend = state.get("spend", {})
        spent = spend.get("usd", 0.0) if spend.get("month") == month else 0.0
        worst = (m["worstCaseInputTokens"] * m["inputUsdPerMTok"] + m["maxTokens"] * m["outputUsdPerMTok"]) / 1e6
        if spent + worst > m["monthlyBudgetUsd"]:
            return f"monthly budget ${m['monthlyBudgetUsd']:.2f} would be exceeded (${spent:.3f} spent)"
    return None


def pick_batch(found, policy, state):
    """One PR's worth. Swaps that cannot change the picture first, all at once; then one judgment batch,
    new drift before backlog, one rule at a time, skipping findings Claude already chose to keep."""
    exact = [f for f in found if f["kind"] in ("exact", "alpha")][: policy["maxCodeEditsPerPR"]]
    if exact:
        return {"mode": "code", "findings": exact}
    skipped = set(state.get("skip", []))
    judgment = [f for f in found if f["kind"] not in ("exact", "alpha") and key(f) not in skipped]
    if not judgment:
        return {"mode": "none", "findings": []}
    judgment.sort(key=lambda f: (not f["new"], RULES.index(f["rule"]), f["file"], f["line"]))
    rule = judgment[0]["rule"]
    return {"mode": "model", "findings": [f for f in judgment if f["rule"] == rule][: policy["maxFindingsPerCall"]]}


def fingerprint(batch):
    return hashlib.sha256(json.dumps(sorted(key(f) + f'@{f["line"]}' for f in batch["findings"])).encode()).hexdigest()


def decide(found, policy, state, now, open_pr, has_key, dry_run=False):
    batch = pick_batch(found, policy, state)
    why_not = None
    if batch["mode"] == "none":
        why_not = "nothing to fix"
    elif open_pr:
        why_not = f"fix PR #{open_pr} is still open"
    elif state.get("pr_blocked") and now - datetime.fromisoformat(state["pr_blocked"]) < PR_BLOCKED_RETRY:
        why_not = "GitHub would not let Actions open a pull request; trying again tomorrow"
    elif batch["mode"] == "model" and not has_key:
        why_not = "no ANTHROPIC_API_KEY for the judgment batch"
    elif dry_run:
        why_not = "dry run"
    else:
        why_not = budget(state, policy, now, batch["mode"] == "model")
    return {"batch": batch, "fix": why_not is None, "skipped": why_not, "fingerprint": fingerprint(batch)}


# ---- editing ------------------------------------------------------------------------------------

def replace_at(text, f, new):
    """Replaces the literal at the finding's line and column; None when the file moved on."""
    lines = text.split("\n")
    if f["line"] > len(lines):
        return None
    line = lines[f["line"] - 1]
    col = f["col"]
    if line[col:col + len(f["value"])] != f["value"]:
        col = line.find(f["value"])
        if col < 0:
            return None
    lines[f["line"] - 1] = line[:col] + new + line[col + len(f["value"]):]
    return "\n".join(lines)


def keep_at(text, f, reason, suffix):
    lines = text.split("\n")
    note = re.sub(r"[^\w .,'()/-]", "", reason)[:80].strip() or "intentional"
    comment = f" # design-ok: {note}" if suffix == ".yaml" else f" /* design-ok: {note} */"
    lines[f["line"] - 1] = lines[f["line"] - 1].rstrip() + comment
    return "\n".join(lines)


def valid_new(f, new, tokens):
    """What Claude may write for each rule. Anything else is refused, never applied."""
    refs = re.findall(r"var\((--[\w-]+)", new)
    if any(r not in tokens["names"] for r in refs):
        return False
    if f["rule"] in ("color", "inline"):
        return bool(re.fullmatch(r"var\(--[\w-]+\)|color-mix\(in srgb, var\(--[\w-]+\) \d{1,3}(\.\d)?%, transparent\)", new))
    if f["rule"] == "spacing":
        return bool(re.fullmatch(r"var\(--space-\d+\)", new)) or px(new) in tokens["space"]
    if f["rule"] == "type":
        return bool(re.fullmatch(r"var\(--text-[\w-]+\)", new)) or px(new) in tokens["text"]
    if f["rule"] == "radius":
        return bool(re.fullmatch(r"var\(--radius[\w-]*\)", new))
    if f["rule"] == "font":
        return new in ("var(--serif)", "var(--sans)", "var(--mono)")
    if f["rule"] == "label":
        kind = "project" if f["prop"].startswith("project") else "agent"
        return 0 < len(new) <= 40 and not label_problems(new, kind) and "\n" not in new and ":" not in new
    return False


def apply_edits(batch, answers, policy, root=ROOT):
    """Applies each edit on its own and keeps it only if the finding is gone and nothing new appeared."""
    by_id = {f["id"]: f for f in batch["findings"]}
    tokens = load_tokens(root / policy["tokens"])
    applied, refused, kept = [], [], []
    # Bottom-up within a file, so earlier columns and lines stay valid.
    order = sorted(answers, key=lambda a: (by_id.get(a["id"], {}).get("file", ""), -by_id.get(a["id"], {}).get("line", 0),
                                           -by_id.get(a["id"], {}).get("col", 0)))
    for a in order:
        f = by_id.get(a["id"])
        if not f:
            continue
        path = root / f["file"]
        before = path.read_text()
        if a["action"] == "keep":
            after = keep_at(before, f, a["reason"], path.suffix)
        elif valid_new(f, a["new"], tokens):
            after = replace_at(before, f, a["new"])
        else:
            refused.append({**f, "proposed": a["new"], "reason": "not a token or scale value"})
            continue
        if after is None:
            refused.append({**f, "proposed": a["new"], "reason": "the line changed since the scan"})
            continue
        flagged = count_in_file(root, f, policy)
        path.write_text(after)
        if count_in_file(root, f, policy) >= flagged:
            path.write_text(before)
            refused.append({**f, "proposed": a["new"], "reason": "the check still flagged it"})
            continue
        (kept if a["action"] == "keep" else applied).append({**f, "new": a["new"], "reason": a["reason"]})
    return applied, kept, refused


def count_in_file(root, f, policy):
    """Findings in the finding's file as it is on disk now."""
    path = root / f["file"]
    if f["rule"] == "label":
        return len([x for x in scan_labels(root / policy["catalog"], root) if x["file"] == f["file"]])
    scanner = scan_css if path.suffix == ".css" else scan_tsx
    return len(scanner(f["file"], path.read_text(), load_tokens(root / policy["tokens"]), policy))


def code_answers(batch):
    return [{"id": f["id"], "action": "replace", "new": f["fix"], "reason": f"equals {f['token']}"} for f in batch["findings"]]


def model_input(batch, tokens):
    palette = {name: "#%02x%02x%02x" % rgb for rgb, name in tokens["colors"].items()}
    return json.dumps({
        "palette": palette,
        "space": {f"{k:g}px": v for k, v in sorted(tokens["space"].items())},
        "text": {f"{k:g}px": v for k, v in sorted(tokens["text"].items())},
        "fonts": sorted(tokens["fonts"]),
        "findings": [{k: f[k] for k in ("id", "rule", "file", "line", "prop", "value", "note", "context")} for f in batch["findings"]],
    }, separators=(",", ":"))


def ask_claude(batch, tokens, policy):
    import anthropic  # installed by the workflow only when a judgment batch is due

    m = policy["model"]
    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=m["name"], max_tokens=m["maxTokens"],
        output_config={"effort": m["effort"], "format": {"type": "json_schema", "schema": EDIT_SCHEMA}},
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        system=(HERE / "prompt.md").read_text(),
        messages=[{"role": "user", "content": model_input(batch, tokens)}],
    )
    cost = (response.usage.input_tokens * m["inputUsdPerMTok"] + response.usage.output_tokens * m["outputUsdPerMTok"]) / 1e6
    if response.stop_reason in {"refusal", "max_tokens"}:
        return None, cost, response.stop_reason
    text = "".join(block.text for block in response.content if block.type == "text")
    return json.loads(text), cost, None


# ---- reporting ----------------------------------------------------------------------------------

def cell(text):
    return str(text).replace("|", "/").replace("\n", " ").replace("`", "'")


def counts_table(found):
    by = Counter((f["rule"], f["new"]) for f in found)
    lines = ["| Check | Backlog | New since baseline |", "|---|---|---|"]
    for r in RULES:
        lines.append(f"| {RULE_LABELS[r]} | {by[(r, False)]} | {by[(r, True)]} |")
    return lines


def scan_markdown(found, dec):
    new = sum(f["new"] for f in found)
    lines = ["## Design Consistency", "", f"{len(found)} findings against `src/styles/tokens.css`, {new} new since the baseline.", ""]
    lines += counts_table(found)
    fresh = [f for f in found if f["new"]][:15]
    if fresh:
        lines += ["", "### New drift", ""] + [f'- `{f["file"]}:{f["line"]}` {RULE_LABELS[f["rule"]].lower()}: `{cell(f["value"])}`'
                                              + (f' (use `{f["fix"]}`)' if f["fix"] else f' ({cell(f["note"])})' if f["note"] else "") for f in fresh]
    b = dec["batch"]
    lines += ["", f'Next fix: {len(b["findings"])} {"code-only swaps" if b["mode"] == "code" else "judgment findings for Claude" if b["mode"] == "model" else "findings"}. '
              + ("Preparing a pull request." if dec["fix"] else f'Not this run: {dec["skipped"]}.'), ""]
    return "\n".join(lines)


def pr_body(result, shots=None, run_url=None):
    applied, kept, refused = result["applied"], result["kept"], result["refused"]
    mode = result["mode"]
    lines = ["Design Consistency found drift from the Atlas design tokens (`src/styles/tokens.css`) and prepared this fix. "
             "It does not merge on its own: review the screenshots and say \"merge\" when it looks right.", ""]
    if mode == "code":
        lines += ["Every change below swaps a literal for the token it already equals, so the screenshots should match exactly. No model was called.", ""]
    else:
        lines += [f'These needed judgment, so Claude proposed them in one call (about ${result["cost"]:.3f}). Each edit was checked: only tokens or scale values are allowed, and the check must stop flagging the line.', ""]
        if result.get("summary"):
            lines += [f'> {cell(result["summary"])}', ""]
    if shots:
        lines += ["### Before and after", "", "| View | Before | After | Pixels changed |", "|---|---|---|---|"]
        for s in shots:
            lines.append(f'| {s["name"]} | ![before]({s["before"]}) | ![after]({s["after"]}) | {s["changed"]} |')
        lines.append("")
    if applied:
        lines += [f"### Changes ({len(applied)})", "", "| Where | Was | Now | Why |", "|---|---|---|---|"]
        lines += [f'| `{f["file"]}:{f["line"]}` | `{cell(f["value"])}` | `{cell(f["new"])}` | {cell(f["reason"])} |' for f in applied[:80]]
        if len(applied) > 80:
            lines.append(f"| … | {len(applied) - 80} more | | |")
        lines.append("")
    if kept:
        lines += [f"### Kept on purpose ({len(kept)})", "", "Marked `design-ok` so the check stops flagging them:", ""]
        lines += [f'- `{f["file"]}:{f["line"]}` `{cell(f["value"])}`: {cell(f["reason"])}' for f in kept]
        lines.append("")
    if refused:
        lines += [f"### Not applied ({len(refused)})", ""]
        lines += [f'- `{f["file"]}:{f["line"]}` `{cell(f["value"])}` -> `{cell(f.get("proposed", ""))}`: {f["reason"]}' for f in refused]
        lines.append("")
    lines += ["`ops/design-consistency/baseline.json` is updated to match, so these do not come back as backlog.", ""]
    if run_url:
        lines += [f"Run: {run_url}", ""]
    return "\n".join(lines)


def headline(found, dec, result=None):
    new = sum(f["new"] for f in found)
    text = f"{len(found)} design findings, {new} new."
    if result and result.get("pr"):
        text += f' Fix PR #{result["pr"]}: {len(result["applied"])} changes, {len(result["kept"])} kept.'
    elif not dec["fix"]:
        text += f' No fix this run: {dec["skipped"]}.'
    return text[:300]


def post_feed(detail, status, now):
    """Optional: one line to Atlas's agent feed (behind Access), when ATLAS_FEED_URL and ATLAS_FEED_TOKEN are set."""
    url, token = os.environ.get("ATLAS_FEED_URL"), os.environ.get("ATLAS_FEED_TOKEN")
    if not url or not token:
        return False
    body = {"project": "github-profile", "agents": ["github-design-consistency"], "phase": "Design check",
            "status": status, "detail": detail[:300], "at": now.isoformat(timespec="seconds")}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10):
            return True
    except OSError:
        print("Atlas feed did not accept the report", file=sys.stderr)
        return False


# ---- GitHub -------------------------------------------------------------------------------------

def gh(method, path, body=None):
    token = os.environ.get("GITHUB_TOKEN")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read() or b"null")


def open_fix_pr(repo):
    """Number of an open design-consistency PR, or None. One API read."""
    if not repo:
        return None
    try:
        pulls = gh("GET", f"/repos/{repo}/pulls?state=open&per_page=100")
    except OSError as e:
        print(f"Could not list pull requests ({type(e).__name__}); assuming one is open", file=sys.stderr)
        return "unknown"
    for p in pulls or []:
        if p["head"]["ref"].startswith(BRANCH_PREFIX):
            return p["number"]
    return None


# ---- commands -----------------------------------------------------------------------------------

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


def bump(state, now, cost=None):
    day, month = now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")
    runs = state.get("runs", {})
    state["runs"] = {"day": day, "count": (runs.get("count", 0) if runs.get("day") == day else 0) + 1}
    if cost is not None:
        spend = state.get("spend", {})
        state["spend"] = {"month": month, "usd": round((spend.get("usd", 0.0) if spend.get("month") == month else 0.0) + cost, 6)}


def cmd_scan(args, now=None):
    now = now or datetime.now(timezone.utc)
    policy = load_policy(args.policy)
    found, _ = scan(policy, args.root)
    baseline = json.loads((args.root / policy["baseline"]).read_text()) if (args.root / policy["baseline"]).exists() else {}
    mark_new(found, baseline)
    if args.write_baseline:
        (args.root / policy["baseline"]).write_text(json.dumps(baseline_counts(found), indent=1) + "\n")
        print(f"Baseline written: {len(found)} findings.")
        return found, None
    state = load_state(args.state)
    open_pr = None if args.dry_run else open_fix_pr(os.environ.get("GITHUB_REPOSITORY"))
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    dec = decide(found, policy, state, now, open_pr, has_key, args.dry_run)
    new = sum(f["new"] for f in found)
    print(f'{len(found)} findings, {new} new. Next batch: {dec["batch"]["mode"]} x{len(dec["batch"]["findings"])}. '
          f'Fix: {"yes" if dec["fix"] else dec["skipped"]}.')
    for f in [f for f in found if f["new"]][:20]:
        print(f'::warning file={f["file"]},line={f["line"]}::{RULE_LABELS[f["rule"]]}: {f["value"]}' if os.environ.get("GITHUB_ACTIONS")
              else f'  new: {f["file"]}:{f["line"]} {f["rule"]} {f["value"]}')
    write_summary(scan_markdown(found, dec))
    Path(args.work).write_text(json.dumps({"decision": dec, "counts": {"total": len(found), "new": new}}))
    if not args.dry_run and not dec["fix"] and new and state.get("last_new") != new:
        post_feed(headline(found, dec), "warning", now)
    if not args.dry_run:
        state["last_new"] = new
        Path(args.state).write_text(json.dumps(state))
    set_output("fix", "true" if dec["fix"] else "false")
    set_output("model", "true" if dec["fix"] and dec["batch"]["mode"] == "model" else "false")
    return found, dec


def cmd_fix(args, now=None):
    now = now or datetime.now(timezone.utc)
    policy = load_policy(args.policy)
    work = json.loads(Path(args.work).read_text())
    state = load_state(args.state)
    batch = work["decision"]["batch"]
    result = {"mode": batch["mode"], "cost": 0.0, "applied": [], "kept": [], "refused": [], "summary": ""}
    cost = None
    if batch["mode"] == "code":
        answers = code_answers(batch)
    else:
        tokens = load_tokens(args.root / policy["tokens"])
        try:
            reply, cost, stopped = ask_claude(batch, tokens, policy)
        except Exception as e:  # a failed call still counts toward the caps, so errors cannot loop
            print(f"Claude call failed: {type(e).__name__}", file=sys.stderr)
            reply, cost, stopped = None, 0.0, "error"
        result["cost"] = cost
        if reply is None:
            print(f"No edits: the model stopped ({stopped}).")
            bump(state, now, cost)
            Path(args.state).write_text(json.dumps(state))
            set_output("changed", "false")
            return result
        answers, result["summary"] = reply["edits"], reply.get("summary", "")
    result["applied"], result["kept"], result["refused"] = apply_edits(batch, answers, policy, args.root)
    # Findings Claude chose to keep get a design-ok comment; refused ones are remembered so the next batch moves on.
    state["skip"] = sorted(set(state.get("skip", [])) | {key(f) for f in result["refused"]})[-500:]
    bump(state, now, cost)
    Path(args.state).write_text(json.dumps(state))
    changed = bool(result["applied"] or result["kept"])
    if changed:  # only what this PR fixed leaves the backlog; drift that landed meanwhile stays new
        path = args.root / policy["baseline"]
        old = Counter(json.loads(path.read_text()) if path.exists() else {})
        old.subtract(Counter(key(f) for f in result["applied"] + result["kept"]))
        path.write_text(json.dumps(dict(sorted((k, v) for k, v in old.items() if v > 0)), indent=1) + "\n")
    Path(args.result).write_text(json.dumps(result))
    print(f'Applied {len(result["applied"])}, kept {len(result["kept"])}, refused {len(result["refused"])}, about ${result["cost"]:.4f}.')
    set_output("changed", "true" if changed else "false")
    return result


def cmd_pr(args, now=None):
    now = now or datetime.now(timezone.utc)
    repo = os.environ["GITHUB_REPOSITORY"]
    result = json.loads(Path(args.result).read_text())
    shots = json.loads(Path(args.shots).read_text()) if args.shots and Path(args.shots).exists() else None
    run_url = f'{os.environ.get("GITHUB_SERVER_URL", "https://github.com")}/{repo}/actions/runs/{os.environ.get("GITHUB_RUN_ID", "")}'
    n = len(result["applied"]) + len(result["kept"])
    title = (f"Design: swap {n} literals for the tokens they equal" if result["mode"] == "code"
             else f'Design: bring {n} {RULE_LABELS[(result["applied"] + result["kept"])[0]["rule"]].lower()} findings onto the tokens')
    try:
        pr = gh("POST", f"/repos/{repo}/pulls", {"title": title, "head": args.branch, "base": args.base,
                                                 "body": pr_body(result, shots, run_url), "maintainer_can_modify": True})
    except urllib.error.HTTPError as e:
        if e.code != 403:
            raise
        return pr_blocked(args, repo, now)
    state = load_state(args.state)
    if state.pop("pr_blocked", None):
        Path(args.state).write_text(json.dumps(state))
    result["pr"] = pr["number"]
    print(f'Opened {pr["html_url"]}')
    write_summary(f'\nOpened fix pull request #{pr["number"]}: {pr["html_url"]}\n')
    work = json.loads(Path(args.work).read_text()) if Path(args.work).exists() else {"counts": {"total": 0, "new": 0}}
    post_feed(f'{work["counts"]["total"]} design findings, {work["counts"]["new"]} new. Fix PR #{pr["number"]}: '
              f'{len(result["applied"])} changes, {len(result["kept"])} kept. Waiting for KC.', "ok", now)
    return pr


def pr_blocked(args, repo, now):
    """403 on opening the PR: the repository does not allow Actions to create pull requests. That is a
    setting, not a broken run, so warn instead of failing (a failure only emails KC), remove the branch
    nobody can open, and wait a day before preparing another fix."""
    try:
        gh("DELETE", f"/repos/{repo}/git/refs/heads/{args.branch}")
    except OSError as e:
        print(f"Could not delete {args.branch} ({type(e).__name__})", file=sys.stderr)
    state = load_state(args.state)
    state["pr_blocked"] = now.isoformat()
    Path(args.state).write_text(json.dumps(state))
    note = ("GitHub would not let this workflow open the fix pull request (403). Turn on "
            f'"Allow GitHub Actions to create and approve pull requests" at {SETTINGS_URL}, or add DESIGN_FIX_TOKEN.')
    print(f"::warning::{note}")
    write_summary(f"\n{note} Trying again tomorrow.\n")
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["scan", "fix", "pr"])
    parser.add_argument("--policy", type=Path, default=HERE / "policy.json")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--state", type=Path, default=Path("design-consistency-state.json"))
    parser.add_argument("--work", type=Path, default=Path("design-consistency-work.json"))
    parser.add_argument("--result", type=Path, default=Path("design-consistency-result.json"))
    parser.add_argument("--shots", type=Path, default=None, help="JSON list of before/after screenshot links for the PR")
    parser.add_argument("--branch", default=None)
    parser.add_argument("--base", default="main")
    parser.add_argument("--dry-run", action="store_true", help="scan and report only; no API reads, feed or saved state")
    parser.add_argument("--write-baseline", action="store_true", help="record today's findings as the accepted backlog")
    args = parser.parse_args(argv)
    {"scan": cmd_scan, "fix": cmd_fix, "pr": cmd_pr}[args.command](args)


if __name__ == "__main__":
    main()
