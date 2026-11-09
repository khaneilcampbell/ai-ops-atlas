import argparse
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import design  # noqa: E402

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
POLICY = design.load_policy(design.HERE / "policy.json")
TOKENS_CSS = """:root {
  --ink: #20372c;
  --gold: #d0ad69;
  --good: #4f7a52;
  --white: #ffffff;
  --sans: system-ui, sans-serif;
  --serif: Georgia, serif;
  --mono: monospace;
  --text-sm: 12px;
  --text-md: 13px;
  --space-2: 4px;
  --space-4: 8px;
  --space-6: 12px;
  --radius: 14px;
  --radius-pill: 999px;
}
"""


def tokens():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "tokens.css"
        p.write_text(TOKENS_CSS)
        return design.load_tokens(p)


def css(text):
    return design.scan_css("src/styles/x.css", text, tokens(), POLICY)


class Repo:
    """A throwaway repository with tokens, one stylesheet and one catalog file."""

    def __init__(self, sheet, catalog="project:\n  id: demo\n  name: Demo HQ\nagents:\n  - id: a\n    name: Site CI\n"):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        (self.root / "src/styles").mkdir(parents=True)
        (self.root / "catalog").mkdir()
        (self.root / "ops/design-consistency").mkdir(parents=True)
        (self.root / POLICY["tokens"]).write_text(TOKENS_CSS)
        (self.root / "src/styles/app.css").write_text(sheet)
        (self.root / "catalog/demo.yaml").write_text(catalog)

    def scan(self):
        found, _ = design.scan(POLICY, self.root)
        return design.mark_new(found, {})


class Colors(unittest.TestCase):
    def test_parses_hex_rgb_and_alpha(self):
        self.assertEqual(design.parse_color("#fff"), (255, 255, 255, 1.0))
        self.assertEqual(design.parse_color("#20372c12"), (32, 55, 44, 0.071))
        self.assertEqual(design.parse_color("rgba(79, 122, 82, 0.14)"), (79, 122, 82, 0.14))
        self.assertEqual(design.parse_color("rgb(0 0 0 / 50%)"), (0, 0, 0, 0.5))
        self.assertIsNone(design.parse_color("hsl(10, 20%, 30%)"))

    def test_classifies_against_the_palette(self):
        t = tokens()
        self.assertEqual(design.token_color((32, 55, 44, 1.0), t, 24)[:2], ("exact", "var(--ink)"))
        self.assertEqual(design.token_color((79, 122, 82, 0.14), t, 24)[:2],
                         ("alpha", "color-mix(in srgb, var(--good) 14%, transparent)"))
        self.assertEqual(design.token_color((201, 163, 90, 1.0), t, 24)[0], "near")  # the old gold
        self.assertEqual(design.token_color((74, 111, 176, 1.0), t, 24)[0], "off")


class Scanning(unittest.TestCase):
    def test_flags_literals_but_not_tokens_fallbacks_comments_or_marked_lines(self):
        found = css(".a { color: var(--ink); font-family: var(--mono, ui-monospace, monospace); }\n"
                    "/* color: #123456 */\n"
                    ".b { background: #abcdef; } /* design-ok: brand */\n"
                    ".c { border: 1px solid #20372c; }\n")
        self.assertEqual([(f["line"], f["value"], f["kind"]) for f in found], [(4, "#20372c", "exact")])

    def test_spacing_type_font_and_radius(self):
        found = css(".a { padding: 4px 5px; margin: -12px 0; gap: 0; font-size: 12.5px; }\n"
                    ".b { font-family: Arial, sans-serif; border-radius: 999px; }\n"
                    ".c { border-radius: 10px; font-size: 13px; }\n")
        got = [(f["rule"], f["value"]) for f in found]
        self.assertEqual(got, [("spacing", "5px"), ("type", "12.5px"), ("font", "Arial, sans-serif"), ("radius", "999px")])
        self.assertIn("4px (--space-2) or 8px (--space-4)", found[0]["note"])

    def test_selectors_with_pseudo_classes_are_not_declarations(self):
        self.assertEqual(css(".a:hover,\n.b:focus { color: var(--gold); }\n"), [])

    def test_inline_styles_in_components(self):
        found = design.scan_tsx("src/components/X.tsx", '<div style={{ color: "#ffffff", margin: "4px" }} />\nconst c = "#123456";\n',
                                tokens(), POLICY)
        self.assertEqual([(f["rule"], f["value"], f["fix"]) for f in found], [("inline", "#ffffff", "var(--white)")])


class Labels(unittest.TestCase):
    def test_scheme_from_the_label_cleanup(self):
        self.assertEqual(design.label_problems("Benjaire HQ", "project"), [])
        self.assertEqual(design.label_problems("Copywriter and SEO Strategist", "agent"), [])
        self.assertEqual(design.label_problems("Re-run Failed Jobs", "agent"), [])
        self.assertIn("contains a domain", design.label_problems("benjaire.com", "project"))
        self.assertIn("contains dashes or underscores", design.label_problems("Multi-Agent Commerce", "project"))
        self.assertIn('"pipeline" is not capitalized', design.label_problems("Commerce pipeline", "project"))
        self.assertIn("is longer than 3 words", design.label_problems("The Big Commerce Pipeline", "project"))

    def test_reads_names_and_repeats_from_the_catalog(self):
        repo = Repo("", "project:\n  id: d\n  name: multi-agent-commerce-pipeline\n  links:\n    - name: ignored\nagents:\n"
                        "  - id: a\n    name: Site CI\n  - id: b\n    name: Site CI\n")
        labels = [f for f in repo.scan() if f["rule"] == "label"]
        self.assertEqual([(f["line"], f["value"]) for f in labels], [(3, "multi-agent-commerce-pipeline"), (10, "Site CI")])
        self.assertIn("repeats", labels[1]["note"])

    def test_the_real_catalog_follows_the_scheme(self):
        self.assertEqual(design.scan_labels(design.ROOT / "catalog"), [])


class Baseline(unittest.TestCase):
    def test_only_drift_above_the_baseline_is_new(self):
        found = css(".a { color: #20372c; }\n.b { color: #20372c; }\n.c { padding: 5px; }\n")
        design.mark_new(found, {"color|src/styles/x.css|color|#20372c": 1, "spacing|src/styles/x.css|padding|5px": 1})
        self.assertEqual([f["new"] for f in found], [False, True, False])

    def test_repository_tokens_keep_the_current_look(self):
        t = design.load_tokens(design.ROOT / POLICY["tokens"])
        self.assertEqual(t["colors"][(0x20, 0x37, 0x2c)], "--ink")
        self.assertEqual(t["colors"][(0xd0, 0xad, 0x69)], "--gold")
        self.assertEqual(t["radius"][14], "--radius")
        self.assertTrue({4, 8, 12, 16}.issubset(t["space"]) and {10, 12, 13}.issubset(t["text"]))
        self.assertEqual(t["fonts"], {"--serif", "--sans", "--mono"})
        baseline = json.loads((design.ROOT / POLICY["baseline"]).read_text())
        self.assertTrue(all(isinstance(v, int) and v > 0 for v in baseline.values()))


class Deciding(unittest.TestCase):
    def found(self):
        return design.mark_new(css(".a { color: #20372c; padding: 5px; }\n.b { font-size: 12.5px; }\n"), {})

    def test_code_swaps_go_first_and_need_no_model(self):
        dec = design.decide(self.found(), POLICY, {}, NOW, open_pr=None, has_key=False)
        self.assertTrue(dec["fix"])
        self.assertEqual(dec["batch"]["mode"], "code")

    def test_judgment_batches_are_one_rule_and_need_a_key(self):
        found = [f for f in self.found() if f["kind"] == "judgment"]
        dec = design.decide(found, POLICY, {}, NOW, open_pr=None, has_key=False)
        self.assertEqual((dec["fix"], dec["skipped"]), (False, "no ANTHROPIC_API_KEY for the judgment batch"))
        dec = design.decide(found, POLICY, {}, NOW, open_pr=None, has_key=True)
        self.assertEqual([f["rule"] for f in dec["batch"]["findings"]], ["spacing"])

    def test_new_drift_comes_before_backlog(self):
        found = design.mark_new(css(".a { padding: 5px; font-size: 12.5px; }\n"), {"spacing|src/styles/x.css|padding|5px": 1})
        self.assertEqual(design.pick_batch(found, POLICY, {})["findings"][0]["rule"], "type")

    def test_one_open_pr_at_a_time_and_dry_runs_do_nothing(self):
        self.assertEqual(design.decide(self.found(), POLICY, {}, NOW, 12, True)["skipped"], "fix PR #12 is still open")
        self.assertEqual(design.decide(self.found(), POLICY, {}, NOW, None, True, dry_run=True)["skipped"], "dry run")
        self.assertEqual(design.decide([], POLICY, {}, NOW, None, True)["skipped"], "nothing to fix")

    def test_daily_and_monthly_caps(self):
        full_day = {"runs": {"day": "2026-10-30", "count": 4}}
        self.assertIn("daily cap of 4", design.budget(full_day, POLICY, NOW, False))
        self.assertIsNone(design.budget({"runs": {"day": "2026-10-29", "count": 4}}, POLICY, NOW, False))
        spent = {"spend": {"month": "2026-10", "usd": 0.95}}
        self.assertIn("monthly budget $1.00", design.budget(spent, POLICY, NOW, True))
        self.assertIsNone(design.budget(spent, POLICY, NOW, False))  # code-only swaps cost nothing
        self.assertIsNone(design.budget({"spend": {"month": "2026-09", "usd": 0.95}}, POLICY, NOW, True))

    def test_worst_case_call_fits_the_cap_several_times(self):
        m = POLICY["model"]
        worst = (m["worstCaseInputTokens"] * m["inputUsdPerMTok"] + m["maxTokens"] * m["outputUsdPerMTok"]) / 1e6
        self.assertLess(worst * 5, m["monthlyBudgetUsd"])
        self.assertEqual(POLICY["maxRunsPerDay"], 4)


class Editing(unittest.TestCase):
    def test_code_swaps_apply_and_clear_the_findings(self):
        repo = Repo(".a { color: #20372c; background: rgba(79, 122, 82, 0.14); border-radius: 999px; }\n")
        batch = design.pick_batch(repo.scan(), POLICY, {})
        applied, kept, refused = design.apply_edits(batch, design.code_answers(batch), POLICY, repo.root)
        self.assertEqual((len(applied), kept, refused), (3, [], []))
        self.assertEqual((repo.root / "src/styles/app.css").read_text(),
                         ".a { color: var(--ink); background: color-mix(in srgb, var(--good) 14%, transparent); border-radius: var(--radius-pill); }\n")
        self.assertEqual(repo.scan(), [])

    def test_model_edits_must_be_tokens_and_must_clear_the_check(self):
        repo = Repo(".a { padding: 5px; color: #c9a35a; font-size: 12.5px; }\n.b { color: #4a6fb0; }\n")
        found = repo.scan()
        ids = {f["value"]: f["id"] for f in found}
        batch = {"mode": "model", "findings": found}
        answers = [
            {"id": ids["5px"], "action": "replace", "new": "var(--space-2)", "reason": "nearest step"},
            {"id": ids["#c9a35a"], "action": "replace", "new": "var(--made-up)", "reason": "invented"},
            {"id": ids["12.5px"], "action": "replace", "new": "12.5px", "reason": "no change"},
            {"id": ids["#4a6fb0"], "action": "keep", "new": "", "reason": "chart series color"},
        ]
        applied, kept, refused = design.apply_edits(batch, answers, POLICY, repo.root)
        self.assertEqual([f["value"] for f in applied], ["5px"])
        self.assertEqual([f["value"] for f in kept], ["#4a6fb0"])
        self.assertEqual(sorted(f["value"] for f in refused), ["#c9a35a", "12.5px"])
        text = (repo.root / "src/styles/app.css").read_text()
        self.assertIn("padding: var(--space-2);", text)
        self.assertIn("#4a6fb0; } /* design-ok: chart series color */", text)
        self.assertIn("#c9a35a", text)

    def test_label_renames_follow_the_scheme(self):
        repo = Repo("", "project:\n  id: d\n  name: benjaire.com\n")
        f = repo.scan()[0]
        batch = {"mode": "model", "findings": [f]}
        self.assertEqual(design.apply_edits(batch, [{"id": f["id"], "action": "replace", "new": "benjaire-hq", "reason": ""}], POLICY, repo.root)[2][0]["value"], "benjaire.com")
        applied = design.apply_edits(batch, [{"id": f["id"], "action": "replace", "new": "Benjaire HQ", "reason": "brand first"}], POLICY, repo.root)[0]
        self.assertEqual(len(applied), 1)
        self.assertIn("  name: Benjaire HQ\n", (repo.root / "catalog/demo.yaml").read_text())

    def test_stale_lines_are_refused(self):
        repo = Repo(".a { color: #20372c; }\n")
        batch = design.pick_batch(repo.scan(), POLICY, {})
        (repo.root / "src/styles/app.css").write_text(".a { color: var(--ink); }\n")
        self.assertEqual(design.apply_edits(batch, design.code_answers(batch), POLICY, repo.root)[2][0]["reason"], "the line changed since the scan")


class Reporting(unittest.TestCase):
    def test_pr_body_shows_screenshots_changes_and_never_promises_a_merge(self):
        f = {"file": "src/styles/app.css", "line": 3, "value": "#20372c", "new": "var(--ink)", "reason": "equals --ink", "rule": "color"}
        body = design.pr_body({"mode": "code", "applied": [f], "kept": [], "refused": [], "cost": 0.0},
                              [{"name": "agents", "before": "b.png", "after": "a.png", "changed": "none"}], "https://run")
        self.assertIn("| agents | ![before](b.png) | ![after](a.png) | none |", body)
        self.assertIn("| `src/styles/app.css:3` | `#20372c` | `var(--ink)` |", body)
        self.assertIn('say "merge"', body)
        self.assertIn("No model was called", body)

    def test_scan_summary_counts_backlog_and_new(self):
        found = design.mark_new(css(".a { padding: 5px; }\n"), {})
        dec = design.decide(found, POLICY, {}, NOW, None, False)
        md = design.scan_markdown(found, dec)
        self.assertIn("| Off-scale spacing | 0 | 1 |", md)
        self.assertIn("Not this run: no ANTHROPIC_API_KEY", md)

    def test_never_merges_or_approves(self):
        source = (design.HERE / "design.py").read_text()
        for forbidden in ("/merge", "APPROVE", "git push", "auto_merge"):
            self.assertNotIn(forbidden, source)
        self.assertEqual(POLICY["mode"], "propose")


    def test_pr_refused_by_actions_setting_explains_the_fix_and_removes_the_branch(self):
        calls = []

        def fake_gh(method, path, body=None):
            calls.append((method, path))
            if method == "POST":
                raise design.GitHubError(403, "GitHub Actions is not permitted to create or approve pull requests.")
            return None

        with tempfile.TemporaryDirectory() as d:
            result = Path(d) / "result.json"
            result.write_text(json.dumps({"mode": "code", "cost": 0.0, "applied": [
                {"file": "src/a.css", "line": 1, "rule": "color", "value": "#fff", "new": "var(--white)",
                 "reason": "equals --white"}],
                "kept": [], "refused": [], "summary": ""}))
            args = argparse.Namespace(
                result=result, shots=None, work=Path(d) / "none.json", branch="design-consistency/run-1", base="main")
            old_gh, old_env = design.gh, dict(design.os.environ)
            design.gh = fake_gh
            design.os.environ["GITHUB_REPOSITORY"] = "kc/atlas"
            design.os.environ.pop("GITHUB_STEP_SUMMARY", None)
            try:
                with self.assertRaises(SystemExit):
                    design.cmd_pr(args, NOW)
            finally:
                design.gh = old_gh
                design.os.environ.clear()
                design.os.environ.update(old_env)
        self.assertEqual(calls[-1], ("DELETE", "/repos/kc/atlas/git/refs/heads/design-consistency/run-1"))
        help_text = design.pr_refused_help(
            design.GitHubError(403, "GitHub Actions is not permitted to create or approve pull requests."), "kc/atlas")
        self.assertIn("https://github.com/kc/atlas/settings/actions", help_text)
        self.assertIn("Allow GitHub Actions to create and approve pull requests", help_text)

    def test_github_errors_keep_githubs_message(self):
        self.assertEqual(design.error_message(b'{"message": "Not Found"}'), "Not Found")
        self.assertEqual(design.error_message(b"<html>"), "<html>")
        self.assertIsInstance(design.GitHubError(502, "x"), OSError)

if __name__ == "__main__":
    unittest.main()
