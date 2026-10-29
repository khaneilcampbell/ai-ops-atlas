import unittest
from audit import alert_summary, environment_safe


class EvidenceTests(unittest.TestCase):
    def test_unavailable_is_not_zero(self):
        self.assertEqual(alert_summary(None), {'status': 'unavailable', 'open_count': None})
        self.assertEqual(alert_summary([])['open_count'], 0)
        self.assertTrue(alert_summary([{}] * 100)['possibly_truncated'])

    def test_solo_requires_explicit_policy_and_main_only(self):
        env = {'can_admins_bypass': False, 'protection_rules': [],
               'deployment_branch_policy': {'custom_branch_policies': True}}
        branches = {'branch_policies': [{'name': 'main', 'type': 'branch'}]}
        self.assertFalse(environment_safe(env, branches))
        self.assertTrue(environment_safe(env, branches, 'solo'))
        self.assertFalse(environment_safe(env, branches, 'unknown'))
        self.assertFalse(environment_safe(env, {'branch_policies': []}, 'solo'))
        env['can_admins_bypass'] = True
        self.assertFalse(environment_safe(env, branches, 'solo'))

    def test_environment_fails_closed(self):
        env = {'can_admins_bypass': False, 'protection_rules': [
            {'type': 'required_reviewers', 'prevent_self_review': True, 'reviewers': [{'id': 1}]}
        ], 'deployment_branch_policy': {'custom_branch_policies': True}}
        branches = {'branch_policies': [{'name': 'main', 'type': 'branch'}]}
        self.assertTrue(environment_safe(env, branches))
        self.assertFalse(environment_safe(None, branches))
        self.assertFalse(environment_safe(env, None))
        self.assertFalse(environment_safe(env, {'branch_policies': [{'name': '*'}]}))
        env['can_admins_bypass'] = True
        self.assertFalse(environment_safe(env, branches))
        env['can_admins_bypass'] = False
        env['protection_rules'][0]['prevent_self_review'] = False
        self.assertFalse(environment_safe(env, branches))


if __name__ == '__main__':
    unittest.main()
