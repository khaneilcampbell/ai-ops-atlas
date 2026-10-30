import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import merge_flow as mf  # noqa: E402

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
POLICY = mf.load_policy(Path(__file__).with_name("policy.json"))


def pr(number, lane_fields=None, rollup="SUCCESS", contexts=(), **extra):
    fields = {"isDraft": False, "mergeable": "MERGEABLE", "mergeStateStatus": "CLEAN", "reviewDecision": None}
    fields.update(lane_fields or {})
    return {
        "number": number, "title": f"PR {number}", "url": f"https://github.com/o/r/pull/{number}",
        "createdAt": "2026-10-29T12:00:00Z", "updatedAt": "2026-10-30T10:00:00Z", "author": {"login": "khancam15"},
        "headRefOid": f"sha{number}",
        "commits": {"nodes": [{"commit": {"statusCheckRollup": None if rollup is None else {"state": rollup, "contexts": {"nodes": list(contexts)}}}}]},
        **fields, **extra,
    }


def repo(name, prs, private=False, merged=()):
    return {"nameWithOwner": name, "isPrivate": private, "open": {"totalCount": len(prs), "nodes": prs}, "merged": {"nodes": list(merged)}}


class Lanes(unittest.TestCase):
    def test_each_lane(self):
        cases = {
            "draft": pr(1, {"isDraft": True}),
            "conflicts": pr(2, {"mergeable": "CONFLICTING", "mergeStateStatus": "DIRTY"}),
            "failing": pr(3, rollup="FAILURE"),
            "changes": pr(4, {"reviewDecision": "CHANGES_REQUESTED", "mergeStateStatus": "BLOCKED"}),
            "running": pr(5, rollup="PENDING", lane_fields={"mergeStateStatus": "BLOCKED"}),
            "behind": pr(6, {"mergeStateStatus": "BEHIND"}),
            "ready": pr(7),
            "review": pr(8, {"mergeStateStatus": "BLOCKED", "reviewDecision": "REVIEW_REQUIRED"}),
            "blocked": pr(9, {"mergeStateStatus": "BLOCKED"}),
            "unknown": pr(10, {"mergeable": "UNKNOWN", "mergeStateStatus": "UNKNOWN"}),
        }
        for want, p in cases.items():
            self.assertEqual(mf.lane(p), want, want)

    def test_unstable_counts_as_failing(self):
        self.assertEqual(mf.lane(pr(1, {"mergeStateStatus": "UNSTABLE"})), "failing")


class Triage(unittest.TestCase):
    def data(self):
        failing = pr(3, rollup="FAILURE", contexts=[{"__typename": "CheckRun", "name": "Frontend", "conclusion": "FAILURE"},
                                                    {"__typename": "CheckRun", "name": "Rust", "conclusion": "SUCCESS"}])
        return {
            "r0": repo("o/public", [pr(7), failing], merged=[{"createdAt": "2026-10-29T00:00:00Z", "mergedAt": "2026-10-29T04:00:00Z"}]),
            "r1": repo("o/secret", [pr(1, {"mergeStateStatus": "BEHIND"}, title="Secret launch plan")], private=True),
            "r2": None,
        }

    def test_report(self):
        report = mf.triage(self.data(), ["o/public", "o/secret", "o/gone"], POLICY, NOW)
        self.assertEqual(report["open"], 3)
        self.assertEqual(report["counts"]["ready"], 1)
        self.assertEqual(report["unavailable"], ["o/gone"])
        self.assertEqual(report["median_merge_hours"], 4.0)
        self.assertEqual([p["lane"] for p in report["prs"]], ["failing", "behind", "ready"])
        self.assertEqual(report["prs"][0]["failing"], ["Frontend"])

    def test_fingerprint_ignores_comment_churn(self):
        a = mf.triage(self.data(), ["o/public", "o/secret", "o/gone"], POLICY, NOW)
        d = self.data()
        d["r0"]["open"]["nodes"][0]["updatedAt"] = "2026-10-30T11:59:00Z"
        b = mf.triage(d, ["o/public", "o/secret", "o/gone"], POLICY, NOW)
        self.assertEqual(mf.fingerprint(a), mf.fingerprint(b))
        d["r0"]["open"]["nodes"][0]["headRefOid"] = "newsha"
        self.assertNotEqual(mf.fingerprint(a), mf.fingerprint(mf.triage(d, ["o/public", "o/secret", "o/gone"], POLICY, NOW)))

    def test_summary_keeps_private_titles_out(self):
        report = mf.triage(self.data(), ["o/public", "o/secret", "o/gone"], POLICY, NOW)
        text = mf.summary_markdown(report)
        self.assertIn("o/public#7", text)
        self.assertNotIn("Secret launch plan", text)
        self.assertNotIn("o/secret", text)
        self.assertIn("1 pull requests in private repositories", text)

    def test_query_has_one_alias_per_repository(self):
        q = mf.build_query(["a/b", "c/d"], 20, 10)
        self.assertIn('r0: repository(owner: "a", name: "b")', q)
        self.assertIn('r1: repository(owner: "c", name: "d")', q)
        self.assertIn("first: 20", q)


class Decide(unittest.TestCase):
    def report(self, *prs_):
        return mf.triage({"r0": repo("o/r", list(prs_))}, ["o/r"], POLICY, NOW)

    def test_unchanged_triage_makes_no_call(self):
        r = self.report(pr(7))
        state = {"version": 1, "fingerprint": mf.fingerprint(r), "last_report_at": NOW.isoformat()}
        d = mf.decide(state, r, POLICY, NOW, True)
        self.assertFalse(d["brief"])
        self.assertFalse(d["report"])
        self.assertEqual(d["brief_skipped"], "triage unchanged")

    def test_change_with_ready_work_asks_for_a_brief(self):
        d = mf.decide({"version": 1}, self.report(pr(7)), POLICY, NOW, True)
        self.assertTrue(d["brief"])
        self.assertTrue(d["report"])

    def test_nothing_actionable_skips_the_brief(self):
        d = mf.decide({"version": 1}, self.report(pr(5, rollup="PENDING")), POLICY, NOW, True)
        self.assertEqual(d["brief_skipped"], "nothing needs action")

    def test_caps(self):
        r = self.report(pr(7))
        daily = {"version": 1, "briefs": {"day": "2026-10-30", "count": 4}}
        self.assertIn("daily cap", mf.decide(daily, r, POLICY, NOW, True)["brief_skipped"])
        monthly = {"version": 1, "spend": {"month": "2026-10", "usd": 0.99}}
        self.assertIn("monthly budget", mf.decide(monthly, r, POLICY, NOW, True)["brief_skipped"])
        last_month = {"version": 1, "spend": {"month": "2026-09", "usd": 0.99}}
        self.assertTrue(mf.decide(last_month, r, POLICY, NOW, True)["brief"])

    def test_no_key_no_brief(self):
        self.assertEqual(mf.decide({"version": 1}, self.report(pr(7)), POLICY, NOW, False)["brief_skipped"], "no ANTHROPIC_API_KEY")


class Commands(unittest.TestCase):
    def run_triage(self, tmp, data):
        args = SimpleNamespace(policy=Path(__file__).with_name("policy.json"), state=tmp / "s.json", work=tmp / "w.json", dry_run=False)
        reply = ({"data": {"rateLimit": {"cost": 1, "remaining": 4999}, **data}}, 1234)
        with mock.patch.object(mf, "fetch", return_value=reply), mock.patch.dict("os.environ", {"GITHUB_TOKEN": "t"}, clear=True):
            return args, mf.cmd_triage(args, NOW)

    def test_second_identical_run_is_quiet(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            _, (_, first) = self.run_triage(tmp, {"r0": repo("khaneilcampbell/ai-ops-atlas", [pr(7)])})
            self.assertTrue(first["changed"])
            _, (_, second) = self.run_triage(tmp, {"r0": repo("khaneilcampbell/ai-ops-atlas", [pr(7)])})
            self.assertFalse(second["changed"])
            self.assertFalse(second["report"])

    def test_brief_records_spend(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            args, _ = self.run_triage(tmp, {"r0": repo("khaneilcampbell/ai-ops-atlas", [pr(7)])})
            with mock.patch.object(mf, "write_brief", return_value=("o/r#7: merge it", 0.02)), mock.patch.dict("os.environ", {}, clear=True):
                mf.cmd_brief(args, NOW)
            state = json.loads(args.state.read_text())
            self.assertEqual(state["spend"], {"month": "2026-10", "usd": 0.02})
            self.assertEqual(state["briefs"], {"day": "2026-10-30", "count": 1})


if __name__ == "__main__":
    unittest.main()
