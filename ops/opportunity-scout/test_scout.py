import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import scout as sc  # noqa: E402

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
POLICY = sc.load_policy(Path(__file__).with_name("policy.json"))
CATALOG = Path(__file__).resolve().parents[2] / "catalog"


def idea(title, revenue=3, effort=3, cost=3, risk=3, reuses=("site-ci",)):
    return {"title": title, "mechanism": "service", "customer": "Small shops", "reuses": list(reuses),
            "days_to_first_dollar": 14, "monthly_cost_usd": 2.5, "risks": "Low demand",
            "scores": {"revenue": revenue, "effort": effort, "cost": cost, "risk": risk}}


def spec(**extra):
    return {"idea": "Audit service", "name": "Audit Seller", "purpose": "Drafts site audit offers", "trigger": "Weekly",
            "schedule": "Mon 09:00 UTC", "inputs": ["Site audit report"], "outputs": ["Draft offer"],
            "monthly_cap_usd": 2.0, "building": "portfolio-site", "approval_point": "KC approves every offer before it is sent", **extra}


DIGEST = {
    "projects": [{"id": "portfolio-site"}, {"id": "skyline"}],
    "agents": [{"id": "site-ci", "status": "active"}, {"id": "site-audit", "status": "active"}, {"id": "niche-scout", "status": "paused"}],
}


class Registry(unittest.TestCase):
    def test_reads_the_real_catalog_without_run_data(self):
        d = sc.digest(CATALOG, POLICY)
        ids = {a["id"] for a in d["agents"]}
        self.assertIn("github-opportunity-scout", ids)
        self.assertIn("github-merge-flow", ids)
        self.assertGreaterEqual(len(d["projects"]), 11)
        for a in d["agents"]:
            self.assertEqual(set(a), {"id", "project", "name", "status", "type", "category", "framework", "purpose"})
            self.assertLessEqual(len(a["purpose"] or ""), POLICY["purposeChars"])
        # Small enough that the worst-case input reserved in the budget really is the worst case.
        self.assertLess(len(sc.model_input(d, {"last_ideas": ["x" * 80] * 3})), POLICY["model"]["worstCaseInputTokens"] * 3)

    def test_fingerprint_follows_the_registry_and_the_prompt(self):
        d = sc.digest(CATALOG, POLICY)
        self.assertEqual(sc.fingerprint(d, "p"), sc.fingerprint(json.loads(json.dumps(d)), "p"))
        self.assertNotEqual(sc.fingerprint(d, "p"), sc.fingerprint(d, "p2"))
        d["agents"][0]["status"] = "paused"
        self.assertNotEqual(sc.fingerprint(sc.digest(CATALOG, POLICY), "p"), sc.fingerprint(d, "p"))


class Decide(unittest.TestCase):
    def test_unchanged_registry_makes_no_call(self):
        state = {"version": 1, "fingerprint": "abc", "last_report_at": NOW.isoformat()}
        d = sc.decide(state, "abc", POLICY, NOW, True)
        self.assertFalse(d["ideas"])
        self.assertFalse(d["report"])
        self.assertEqual(d["skipped"], "registry unchanged")

    def test_fresh_overrides_unchanged_but_not_the_caps(self):
        state = {"version": 1, "fingerprint": "abc", "calls": {"day": "2026-10-30", "count": 4}}
        self.assertTrue(sc.decide({"version": 1, "fingerprint": "abc"}, "abc", POLICY, NOW, True, fresh=True)["ideas"])
        self.assertIn("daily cap", sc.decide(state, "abc", POLICY, NOW, True, fresh=True)["skipped"])

    def test_caps(self):
        monthly = {"version": 1, "spend": {"month": "2026-10", "usd": 0.95}}
        self.assertIn("monthly budget", sc.decide(monthly, "new", POLICY, NOW, True)["skipped"])
        last_month = {"version": 1, "spend": {"month": "2026-09", "usd": 0.95}}
        self.assertTrue(sc.decide(last_month, "new", POLICY, NOW, True)["ideas"])

    def test_no_key_no_call(self):
        self.assertEqual(sc.decide({"version": 1}, "new", POLICY, NOW, False)["skipped"], "no ANTHROPIC_API_KEY")

    def test_weekly_heartbeat(self):
        state = {"version": 1, "fingerprint": "abc", "last_report_at": "2026-10-20T00:00:00+00:00"}
        d = sc.decide(state, "abc", POLICY, NOW, True)
        self.assertTrue(d["report"])
        self.assertFalse(d["ideas"])


class Review(unittest.TestCase):
    def test_ranks_by_the_fixed_formula(self):
        result = {"ideas": [idea("Cheap", 2, 5, 5, 5), idea("Audit service", 5, 3, 4, 4)], "spec": spec()}
        r = sc.review(result, DIGEST, POLICY)
        self.assertEqual([i["title"] for i in r["ideas"]], ["Audit service", "Cheap"])
        self.assertEqual(r["ideas"][0]["score"], 4.2)
        self.assertEqual(r["notes"], [])

    def test_checks_claims_against_the_registry(self):
        result = {"ideas": [idea("Audit service", reuses=("site-audit", "made-up-agent", "niche-scout"))],
                  "spec": spec(building="nowhere", monthly_cap_usd=50, approval_point=" ")}
        r = sc.review(result, DIGEST, POLICY)
        self.assertEqual(r["ideas"][0]["reuses"], ["site-audit", "niche-scout"])
        self.assertEqual(r["spec"]["monthly_cap_usd"], POLICY["spec"]["maxMonthlyCapUsd"])
        notes = " ".join(r["notes"])
        for want in ("not in the registry", "niche-scout, which is not active", '"nowhere" is not an Atlas project', "lowered", "no human approval"):
            self.assertIn(want, notes)

    def test_flags_a_spec_for_a_lower_ranked_idea(self):
        result = {"ideas": [idea("Audit service", 2), idea("Better", 5)], "spec": spec()}
        self.assertIn('not the top-ranked idea "Better"', " ".join(sc.review(result, DIGEST, POLICY)["notes"]))

    def test_keeps_at_most_max_ideas(self):
        result = {"ideas": [idea(f"I{n}") for n in range(5)], "spec": spec()}
        self.assertEqual(len(sc.review(result, DIGEST, POLICY)["ideas"]), POLICY["maxIdeas"])

    def test_schema_is_closed(self):
        def walk(node):
            if node.get("type") == "object":
                self.assertIs(node["additionalProperties"], False)
                self.assertEqual(set(node["required"]), set(node["properties"]))
                for child in node["properties"].values():
                    walk(child)
            if node.get("type") == "array":
                walk(node["items"])
        walk(sc.SCHEMA)


class Report(unittest.TestCase):
    def test_markdown_and_headline(self):
        r = sc.review({"ideas": [idea("Audit service", 5, 3, 4, 4)], "spec": spec()}, DIGEST, POLICY)
        text = sc.report_markdown(r, DIGEST)
        self.assertIn("| 1 | Audit service | Service | Small shops | ~14d | $2.50 | 5 | 3 | 4 | 4 | 4.2 |", text)
        self.assertIn("### Agent spec: Audit Seller", text)
        self.assertIn("KC approves every offer", text)
        hidden = sc.report_markdown(r, DIGEST, publish_details=False)
        self.assertNotIn("Audit Seller", hidden)
        self.assertNotIn("Small shops", hidden)
        line = sc.headline(r)
        self.assertLessEqual(len(line), 300)
        self.assertIn("Top: Audit service (score 4.2", line)


class Commands(unittest.TestCase):
    def args(self, tmp, **extra):
        return SimpleNamespace(policy=Path(__file__).with_name("policy.json"), catalog=CATALOG, state=tmp / "s.json",
                               work=tmp / "w.json", dry_run=False, fresh=False, **extra)

    def test_second_identical_scan_is_quiet(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.dict("os.environ", {}, clear=True):
            args = self.args(Path(t))
            _, first = sc.cmd_scan(args, NOW)
            self.assertEqual(first["skipped"], "no ANTHROPIC_API_KEY")
            # Without a key the change is kept pending, so the first run with a key still gets ideas.
            self.assertNotIn("fingerprint", json.loads(args.state.read_text()))
            with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}):
                _, second = sc.cmd_scan(args, NOW)
            self.assertTrue(second["ideas"])

    def test_ideas_record_spend_and_last_ideas(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}, clear=True):
            args = self.args(Path(t))
            _, dec = sc.cmd_scan(args, NOW)
            self.assertTrue(dec["ideas"])
            reply = ({"ideas": [idea("Audit service", reuses=("site-audit",))], "spec": spec()}, 0.04, None)
            with mock.patch.object(sc, "ask_claude", return_value=reply):
                sc.cmd_ideas(args, NOW)
            state = json.loads(args.state.read_text())
            self.assertEqual(state["spend"], {"month": "2026-10", "usd": 0.04})
            self.assertEqual(state["calls"], {"day": "2026-10-30", "count": 1})
            self.assertEqual(state["last_ideas"], ["Audit service"])
            self.assertEqual(state["fingerprint"], dec["fingerprint"])
            _, again = sc.cmd_scan(args, NOW)
            self.assertEqual(again["skipped"], "registry unchanged")

    def test_failed_call_keeps_the_change_pending(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}, clear=True):
            args = self.args(Path(t))
            sc.cmd_scan(args, NOW)
            with mock.patch.object(sc, "ask_claude", side_effect=RuntimeError("boom")):
                sc.cmd_ideas(args, NOW)
            state = json.loads(args.state.read_text())
            self.assertNotIn("fingerprint", state)
            self.assertEqual(state["calls"]["count"], 1)

    def test_dry_run_saves_nothing(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}, clear=True):
            args = self.args(Path(t))
            args.dry_run = True
            _, dec = sc.cmd_scan(args, NOW)
            self.assertFalse(dec["ideas"])
            self.assertFalse(args.state.exists())


if __name__ == "__main__":
    unittest.main()
