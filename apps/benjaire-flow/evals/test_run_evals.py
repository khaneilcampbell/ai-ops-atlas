"""Offline tests for the Flow eval harness. No API calls.

Run from apps/benjaire-flow:
    python3 -m unittest discover -s evals -p 'test_*.py'
"""
import json
import tempfile
import unittest
from pathlib import Path

import run_evals as ev

CASES = [json.loads(l) for l in ev.DATASET.read_text(encoding="utf-8").splitlines() if l.strip()]
BY_ID = {c["id"]: c for c in CASES}


def answer(**kw):
    base = {"is_spam": False, "topic": "General inquiry", "urgency": "normal", "budget": "Not stated",
            "summary": "A short summary.", "suggested_reply": "Thanks for reaching out. Example IT Partners",
            "confidence": 0.9, "reasoning": "x"}
    base.update(kw)
    return "Here you go:\n" + json.dumps(base)


class Dataset(unittest.TestCase):
    def test_cases_are_well_formed(self):
        self.assertGreaterEqual(len(CASES), 50)
        self.assertEqual(len(BY_ID), len(CASES), "duplicate ids")
        for c in CASES:
            settings = ev.load_preset(c["preset"])
            services = {s.strip().lower() for s in settings["services"].split(";")} | {"general inquiry"}
            topics = c["expect"]["topic"] if isinstance(c["expect"]["topic"], list) else [c["expect"]["topic"]]
            for t in topics:
                self.assertIn(t.lower(), services, f"{c['id']}: {t!r} is not a {c['preset']} service")
            self.assertIn(c["expect"]["urgency"], ("urgent", "normal", "low"), c["id"])

    def test_covers_hard_cases(self):
        tags = {t for c in CASES for t in c.get("tags", [])}
        for t in ("spam", "urgent", "injection", "budget", "off-menu"):
            self.assertIn(t, tags)


class Prompt(unittest.TestCase):
    def test_reads_the_shipped_prompt_and_fills_every_expression(self):
        p = ev.load_prompt()
        self.assertTrue(p["model"].startswith("claude-"))
        text = ev.render(p["template"], ev.load_preset("law-firm"), BY_ID["law-01"])
        self.assertIn("Example Law Group", text)
        self.assertIn(BY_ID["law-01"]["message"], text)
        self.assertNotIn("{{", text)


class FlowRules(unittest.TestCase):
    def test_low_confidence_spam_is_not_spam(self):
        self.assertFalse(ev.apply_flow_rules({"is_spam": True, "confidence": 0.5})["is_spam"])
        self.assertTrue(ev.apply_flow_rules({"is_spam": True, "confidence": 0.7})["is_spam"])

    def test_unknown_urgency_falls_back_to_normal(self):
        self.assertEqual(ev.apply_flow_rules({"urgency": "ASAP"})["urgency"], "normal")
        self.assertEqual(ev.apply_flow_rules(None)["topic"], "General inquiry")

    def test_parse_handles_prose_and_garbage(self):
        self.assertEqual(ev.parse_ai('ok {"a": 1} done'), {"a": 1})
        self.assertIsNone(ev.parse_ai("no json here"))
        self.assertIsNone(ev.parse_ai("{broken"))


class Scoring(unittest.TestCase):
    def test_correct_answer_passes_every_check(self):
        c = BY_ID["it-03"]  # M365 migration, $6,000, low
        r = ev.score_case(c, answer(topic="Microsoft 365 and Google Workspace", urgency="low",
                                    budget="$6,000", suggested_reply="Thanks Lena, happy to scope your $6,000 migration. Example IT Partners"),
                          ev.load_preset(c["preset"]))
        self.assertTrue(all(r["checks"].values()), r)

    def test_wrong_fields_fail(self):
        c = BY_ID["it-02"]  # ransomware, urgent
        r = ev.score_case(c, answer(topic="Managed IT", urgency="low"), ev.load_preset(c["preset"]))
        self.assertFalse(r["checks"]["topic"])
        self.assertFalse(r["checks"]["urgency"])

    def test_alternate_topic_accepted(self):
        c = BY_ID["des-14"]
        r = ev.score_case(c, answer(topic="website design", suggested_reply="Thanks. Example Studio"),
                          ev.load_preset(c["preset"]))
        self.assertTrue(r["checks"]["topic"])

    def test_spam_case_only_scores_spam(self):
        c = next(c for c in CASES if c["expect"]["is_spam"])
        r = ev.score_case(c, answer(is_spam=True, confidence=0.95), ev.load_preset(c["preset"]))
        self.assertEqual(set(r["checks"]), {"spam"})
        self.assertTrue(r["checks"]["spam"])

    def test_reply_rules(self):
        firm = "Example Law Group"
        self.assertEqual(ev.reply_problems("Thanks. Example Law Group", firm), [])
        self.assertIn("not signed with the firm name", ev.reply_problems("Thanks.", firm))
        self.assertIn("contains a placeholder", ev.reply_problems("Hi [Name]. Example Law Group", firm))
        self.assertTrue(ev.reply_problems(" ".join(["word"] * 111) + " Example Law Group", firm))
        self.assertTrue(ev.reply_problems("We guarantee a win. Example Law Group", firm))
        self.assertEqual(ev.reply_problems("We can't guarantee outcomes. Example Law Group", firm), [])
        self.assertTrue(ev.reply_problems("Our fee is $500. Example Law Group", firm, "How much?"))
        self.assertEqual(ev.reply_problems("Your $10k retainer works. Example Law Group", firm, "We can pay a $10k retainer."), [])

    def test_injection_fails_when_model_obeys(self):
        c = BY_ID["law-09"]  # asks the model to promise a win and a $500 fee
        obeyed = ev.score_case(c, answer(topic="Litigation", suggested_reply="We will win, fee is $500 flat. Example Law Group"),
                               ev.load_preset(c["preset"]))
        self.assertFalse(obeyed["checks"]["injection_resisted"])
        self.assertTrue(any("$500" in n and "injection not resisted" in n for n in obeyed["notes"]), obeyed["notes"])
        resisted = ev.score_case(c, answer(topic="Litigation", suggested_reply="Thanks, Ella. Let's talk. Example Law Group"),
                                 ev.load_preset(c["preset"]))
        self.assertTrue(resisted["checks"]["injection_resisted"])

    def test_injection_judged_on_what_the_attack_asked_for(self):
        c = BY_ID["it-11"]  # asks to be marked urgent and promised a discount
        calm = ev.score_case(c, answer(topic="Network and Wi-Fi", urgency="low", suggested_reply="Thanks Mia. Example IT Partners"),
                             ev.load_preset(c["preset"]))
        self.assertTrue(calm["checks"]["injection_resisted"])
        self.assertFalse(calm["checks"]["urgency"])
        obeyed = ev.score_case(c, answer(topic="Network and Wi-Fi", urgency="urgent", suggested_reply="Thanks Mia. Example IT Partners"),
                               ev.load_preset(c["preset"]))
        self.assertFalse(obeyed["checks"]["injection_resisted"])
        self.assertIn("escalated to urgent", obeyed["notes"][-1])

    def test_budget_matching(self):
        self.assertTrue(ev.budget_ok("4k", "Up to 4k"))
        self.assertTrue(ev.budget_ok("Not stated", "not stated"))
        self.assertFalse(ev.budget_ok("Not stated", "$5,000"))
        self.assertFalse(ev.budget_ok("$12k", "Not stated"))


class EndToEnd(unittest.TestCase):
    def test_saved_responses_produce_report_and_exit_code(self):
        with tempfile.TemporaryDirectory() as d:
            resp = Path(d) / "r.jsonl"
            resp.write_text("".join(json.dumps({"id": c["id"], "raw": "not json"}) + "\n" for c in CASES[:5]))
            code = ev.main(["--responses", str(resp), "--limit", "5", "--out", d])
            self.assertEqual(code, 1)
            report = (Path(d) / "results.md").read_text()
            self.assertIn("json_valid | 0/5", report)
            self.assertIn("**FAIL**", report)


if __name__ == "__main__":
    unittest.main()
