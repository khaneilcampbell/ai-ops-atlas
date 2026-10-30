"""Offline tests for the Autopilot automations: no network, fake HTTP everywhere.

  python3 -m unittest discover -s ops/autopilot -p 'test_*.py'
"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import common  # noqa: E402
import spend_guard  # noqa: E402
import uptime  # noqa: E402
import weekly_digest  # noqa: E402

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
CLEAN_ENV = {k: "" for k in ("RESEND_API_KEY", "NOTIFY_EMAIL_TO", "NOTIFY_EMAIL_FROM", "NOTIFY_WEBHOOK_URL", "ATLAS_FEED_URL",
                             "ATLAS_FEED_TOKEN", "ANTHROPIC_ADMIN_KEY", "SPEND_GUARD_TOKEN", "ATLAS_PAUSED_AGENTS", "GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT")}


def quiet(fn, *a, **kw):
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        return fn(*a, **kw)


class ShippedConfigs(unittest.TestCase):
    def test_configs_load(self):
        common.load_config(HERE / "uptime.json", ["checks"])
        common.load_config(HERE / "spend-guard.json", ["budgets"])
        common.load_config(HERE / "digest.json", ["repositories"])

    def test_no_check_posts_or_submits(self):
        for c in json.loads((HERE / "uptime.json").read_text())["checks"]:
            self.assertIn(c.get("method", "GET"), {"GET", "HEAD"}, c["name"])

    def test_paused_agents_exist_in_the_catalog(self):
        catalog = "\n".join(p.read_text() for p in (HERE.parent.parent / "catalog").glob("*.yaml"))
        for b in json.loads((HERE / "spend-guard.json").read_text())["budgets"]:
            for agent in b.get("pauses", []):
                self.assertIn(f"id: {agent}", catalog)


# ---- uptime -------------------------------------------------------------------------------------

CONFIG = {"checks": [{"name": "Site", "url": "https://x.test/"}, {"name": "Form", "url": "https://x.test/api", "expectStatus": [405]}],
          "timeoutSeconds": 5, "slowMs": 1000, "failAfter": 2, "remindHours": 12, "heartbeatHours": 24, "agent": {"project": "p", "id": "u"}}


def fake_site(answers):
    """answers: url -> (status, headers, body) or an exception to raise."""
    def fetch(url, **kw):
        a = answers[url]
        if isinstance(a, Exception):
            raise a
        return a
    return fetch


UP = {"https://x.test/": (200, {}, b"hello"), "https://x.test/api": (405, {}, b"")}
DOWN = {**UP, "https://x.test/": (503, {}, b"")}


class Uptime(unittest.TestCase):
    def test_expectations(self):
        c = {"url": "u", "expectStatus": [302], "expectText": None, "expectHeaders": {"Location": "cloudflareaccess.com"}}
        ok = fake_site({"u": (302, {"location": "https://kc.cloudflareaccess.com/login"}, b"")})
        self.assertTrue(uptime.check_once(c, 5, ok)[0])
        moved = fake_site({"u": (302, {"location": "https://elsewhere.test"}, b"")})
        self.assertIn("header", uptime.check_once(c, 5, moved)[1])
        text = {"url": "u", "expectText": 'id="inquiry"'}
        self.assertIn("text missing", uptime.check_once(text, 5, fake_site({"u": (200, {}, b"<form>")}))[1])
        self.assertIn("no response", uptime.check_once({"url": "u"}, 5, fake_site({"u": OSError("boom")}))[1])

    def test_retries_once_before_failing(self):
        calls = []

        def flaky(url, **kw):
            calls.append(url)
            return (503, {}, b"") if len(calls) == 1 else (200, {}, b"")
        r = uptime.run_checks({**CONFIG, "checks": CONFIG["checks"][:1]}, flaky, sleep=lambda s: None)
        self.assertTrue(r[0]["ok"])
        self.assertEqual(len(calls), 2)

    def run_once(self, state, answers, now):
        results = uptime.run_checks(CONFIG, fake_site(answers), sleep=lambda s: None)
        return uptime.evaluate(state, results, CONFIG, now)

    def test_alert_after_two_failures_then_reminder_then_recovery(self):
        state = {"version": 1}
        self.assertEqual(self.run_once(state, DOWN, NOW), [])  # one bad run never alerts
        down = self.run_once(state, DOWN, NOW + timedelta(minutes=15))
        self.assertEqual([(a["kind"], a["name"]) for a in down], [("down", "Site")])
        self.assertEqual(self.run_once(state, DOWN, NOW + timedelta(hours=2)), [])  # no repeat inside 12 hours
        remind = self.run_once(state, DOWN, NOW + timedelta(hours=13))
        self.assertEqual(remind[0]["kind"], "still down")
        up = self.run_once(state, UP, NOW + timedelta(hours=14))
        self.assertEqual(up[0]["kind"], "recovered")
        self.assertEqual(state["checks"]["Site"], {"failures": 0})
        self.assertEqual(len(state["incidents"]), 1)
        self.assertTrue(state["incidents"][0]["up_at"])

    def test_single_blip_resets(self):
        state = {"version": 1}
        self.run_once(state, DOWN, NOW)
        self.assertEqual(self.run_once(state, UP, NOW + timedelta(minutes=15)), [])
        self.assertEqual(self.run_once(state, DOWN, NOW + timedelta(minutes=30)), [])

    def test_main_fails_job_on_new_alert_and_saves_state(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, CLEAN_ENV):
            cfg, st = Path(tmp) / "c.json", Path(tmp) / "s.json"
            cfg.write_text(json.dumps({"version": 1, "enabled": True, **CONFIG}))
            args = ["--config", str(cfg), "--state", str(st)]
            self.assertEqual(quiet(uptime.main, args, NOW, fake_site(DOWN), lambda s: None), 0)
            self.assertEqual(quiet(uptime.main, args, NOW + timedelta(minutes=15), fake_site(DOWN), lambda s: None), 1)
            self.assertEqual(quiet(uptime.main, args, NOW + timedelta(minutes=30), fake_site(UP), lambda s: None), 0)
            self.assertEqual(json.loads(st.read_text())["checks"]["Site"], {"failures": 0})


# ---- spend guard --------------------------------------------------------------------------------

GUARD = {"agent": {"project": "p", "id": "g"}, "repository": "o/r", "pauseVariable": "PAUSED", "pauseAtPercent": 80,
         "budgets": [{"id": "org", "label": "Org", "monthlyCapUsd": 20, "source": {"type": "anthropic_cost_report"}, "pauses": ["a1"]},
                     {"id": "ws", "label": "Flow", "monthlyCapUsd": 5, "source": {"type": "anthropic_cost_report", "workspaceId": "wrkspc_1"}, "pauses": ["a2"]},
                     {"id": "led", "label": "Ledger", "monthlyCapUsd": 1, "source": {"type": "ledger", "file": "LEDGER", "key": "spend"}, "pauses": ["a1"]}]}


def cost_report(days):
    """days: {"2026-10-29": {"wrkspc_1": cents, None: cents}}"""
    def fetch(url, **kw):
        assert kw["headers"]["x-api-key"] == "admin"
        data = [{"starting_at": f"{d}T00:00:00Z", "results": [{"amount": str(c), "currency": "USD", "workspace_id": ws} for ws, c in r.items()]}
                for d, r in days.items()]
        return 200, {}, json.dumps({"data": data, "has_more": False}).encode()
    return fetch


class SpendGuard(unittest.TestCase):
    def guard(self, tmp, ledger_usd=0.1):
        ledger = Path(tmp) / "ledger.json"
        ledger.write_text(json.dumps({"spend": {"month": "2026-10", "usd": ledger_usd}}))
        cfg = json.loads(json.dumps(GUARD))
        cfg["budgets"][2]["source"]["file"] = str(ledger)
        return cfg

    def test_totals_by_workspace_and_today(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self.guard(tmp)
            fetch = cost_report({"2026-10-29": {"wrkspc_1": 150, None: 1000}, "2026-10-30": {"wrkspc_1": 300, None: 50}})
            spend, errors = spend_guard.measure(cfg, NOW, "admin", fetch)
        self.assertEqual(errors, [])
        self.assertEqual(spend["org"]["month"], 15.0)
        self.assertEqual(spend["org"]["today"], 3.5)
        self.assertEqual(spend["ws"]["month"], 4.5)
        self.assertEqual(spend["led"]["month"], 0.1)

    def test_pauses_at_80_percent(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self.guard(tmp, ledger_usd=0.5)
            spend, _ = spend_guard.measure(cfg, NOW, "admin", cost_report({"2026-10-30": {"wrkspc_1": 400, None: 100}}))
        rows = spend_guard.assess(cfg, spend, NOW)
        self.assertEqual({r["id"]: r["over"] for r in rows}, {"org": False, "ws": True, "led": False})
        self.assertEqual(spend_guard.wanted_pauses(rows), ["a2"])

    def test_old_ledger_counts_as_zero_and_missing_sources_are_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self.guard(tmp)
            Path(cfg["budgets"][2]["source"]["file"]).write_text(json.dumps({"spend": {"month": "2026-09", "usd": 0.99}}))
            spend, errors = spend_guard.measure(cfg, NOW, None)
        self.assertEqual(spend["led"]["month"], 0.0)
        self.assertEqual(len(errors), 2)  # both cost report budgets, no admin key

    def test_alerts_only_on_crossing(self):
        state = {"version": 1}
        over = [{"id": "ws", "label": "Flow", "cap": 5, "month": 4.5, "percent": 90.0, "over": True}]
        self.assertEqual(len(spend_guard.transitions(state, over, NOW)), 1)
        self.assertEqual(spend_guard.transitions(state, over, NOW), [])
        under = [{**over[0], "month": 0.1, "percent": 2.0, "over": False}]
        self.assertIn("back under", spend_guard.transitions(state, under, NOW)[0])

    def test_variable_is_written_only_when_it_changes(self):
        calls = []

        def gh(path, token, method="GET", body=None, timeout=20):
            calls.append((method, path, body))
            return (200, {"value": "a2"}) if method == "GET" else (204, None)
        with mock.patch.object(common, "github", gh):
            spend_guard.apply_pauses(GUARD, ["a2"], "t")
            self.assertEqual([c[0] for c in calls], ["GET"])
            spend_guard.apply_pauses(GUARD, [], "t")
        self.assertEqual(calls[-1], ("PATCH", "/repos/o/r/actions/variables/PAUSED", {"name": "PAUSED", "value": "none"}))

    def test_without_token_it_only_recommends(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {**CLEAN_ENV, "ANTHROPIC_ADMIN_KEY": "admin"}):
            cfg = self.guard(tmp)
            cfg_path, st = Path(tmp) / "c.json", Path(tmp) / "s.json"
            cfg_path.write_text(json.dumps({"version": 1, "enabled": True, **cfg}))

            def never(*a):
                raise AssertionError("must not pause without a token")
            quiet(spend_guard.main, ["--config", str(cfg_path), "--state", str(st)], NOW,
                  cost_report({"2026-10-30": {"wrkspc_1": 450}}), never)
            last = json.loads(st.read_text())["last"]
        self.assertEqual(last["mode"], "recommend")
        self.assertEqual(last["paused"], ["a2"])


# ---- weekly digest ------------------------------------------------------------------------------

def pr_node(n, repo="o/pub", private=False, merge_state="CLEAN", mergeable="MERGEABLE", updated="2026-10-29T00:00:00Z", rollup="SUCCESS"):
    return {"number": n, "title": f"PR {n}", "url": f"https://github.com/{repo}/pull/{n}", "isDraft": False,
            "createdAt": "2026-10-20T00:00:00Z", "updatedAt": updated, "mergedAt": None, "mergeable": mergeable,
            "mergeStateStatus": merge_state, "reviewDecision": None, "repository": {"nameWithOwner": repo, "isPrivate": private},
            "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": rollup}}}]}}


def gql_answer(query, token):
    data = {"merged": {"issueCount": 2, "nodes": [pr_node(1), pr_node(2, repo="o/secret", private=True)]},
            "open": {"issueCount": 3, "nodes": [pr_node(10), pr_node(11, repo="o/secret", private=True),
                                                 pr_node(12, merge_state="BLOCKED", updated="2026-10-01T00:00:00Z"), None]}}
    return {"data": data}, 1234


def runs_answer(path, token):
    repo = path.split("/")[2] + "/" + path.split("/")[3]
    private = repo == "o/secret"
    runs = [{"name": "CI", "conclusion": "failure", "status": "completed", "event": "push", "html_url": "u", "repository": {"private": private}},
            {"name": "CI", "conclusion": "success", "status": "completed", "event": "push", "html_url": "u", "repository": {"private": private}}]
    return 200, {"workflow_runs": runs}


class Digest(unittest.TestCase):
    def test_query_is_one_request_scoped_to_the_repositories(self):
        q = weekly_digest.build_query(["o/a", "o/b"], "2026-10-23")
        self.assertIn("is:pr is:merged merged:>=2026-10-23 repo:o/a repo:o/b", q)
        self.assertEqual(q.count("search("), 2)

    def test_digest_content_and_privacy(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {**CLEAN_ENV, "GITHUB_TOKEN": "t"}):
            cfg, summary = Path(tmp) / "d.json", Path(tmp) / "summary.md"
            cfg.write_text(json.dumps({"version": 1, "enabled": True, "agent": {"project": "p", "id": "d"}, "days": 7, "staleAfterDays": 7,
                                       "repositories": ["o/pub", "o/secret"]}))
            spend = Path(tmp) / "spend.json"
            spend.write_text(json.dumps({"version": 1, "last": {"at": "2026-10-30T06:00:00+00:00", "paused": [], "errors": [],
                                                                "budgets": [{"label": "Org", "cap": 20, "month": 17, "percent": 85.0, "projected": 18, "over": True}]}}))
            os.environ["GITHUB_STEP_SUMMARY"] = str(summary)
            out = io.StringIO()
            with redirect_stdout(out):
                weekly_digest.main(["--config", str(cfg), "--spend", str(spend), "--uptime", str(Path(tmp) / "none.json"), "--dry-run"],
                                   NOW, gql_answer, runs_answer)
            public, full = summary.read_text(), out.getvalue()
        self.assertIn("o/pub#10 ready to merge", full)
        self.assertIn("o/secret#11 ready to merge", full)
        self.assertIn("o/pub#12 has been quiet for a week", full)
        self.assertIn("Org is at 85.0%", full)
        self.assertIn('workflow "CI" failed on its latest run', full)
        self.assertIn("No uptime report yet", full)
        self.assertNotIn("o/secret", public)
        self.assertIn("plus 1 in private repositories", public)
        self.assertIn("o/pub#10 ready to merge", public)


class Notify(unittest.TestCase):
    def test_email_and_webhook(self):
        sent = []

        def fake(url, **kw):
            sent.append((url, kw["body"]))
            return 200, {}, b"{}"
        env = {**CLEAN_ENV, "RESEND_API_KEY": "k", "NOTIFY_EMAIL_TO": "a@x.test, b@x.test", "NOTIFY_EMAIL_FROM": "Atlas <ops@x.test>",
               "NOTIFY_WEBHOOK_URL": "https://hook.test/1"}
        with mock.patch.dict(os.environ, env), mock.patch.object(common, "request", fake):
            self.assertEqual(common.notify("Down: Site", "details"), ["email", "webhook"])
        self.assertEqual(sent[0][1]["to"], ["a@x.test", "b@x.test"])
        self.assertIn("Down: Site", sent[1][1]["text"])

    def test_paused_agents(self):
        with mock.patch.dict(os.environ, {"ATLAS_PAUSED_AGENTS": "a, b,none,"}):
            self.assertEqual(common.paused_agents(), {"a", "b"})


if __name__ == "__main__":
    unittest.main()
