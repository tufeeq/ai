import unittest
from timeout_timing import run


class TimingIntegrity(unittest.TestCase):
    def fixture(self):
        return {'protocol':{'purpose':'timing only','source_commit':'frozen','limit':10000,
                            'query_offset_start_seconds':3,'query_offset_end_seconds':63,
                            'selected':[{'id':'X'}]},
                'windows':[{'id':'X','symbol':'X','deadline':'2026-08-24T14:00:00Z',
                            'quotes':[],'error':None,'original_outcome':'UNKNOWN_TIMEOUT_QUOTE'}]}

    def test_no_case_can_be_silently_dropped(self):
        d=self.fixture(); d['windows']=[]
        with self.assertRaises(ValueError): run(d)

    def test_late_quote_does_not_reclassify_exit(self):
        d=self.fixture(); d['windows'][0]['quotes']=[dict(timestamp='2026-08-24T14:00:10Z',
            bid_price=10,ask_price=10.01,bid_size=100,ask_size=100)]
        r=run(d); self.assertEqual(r['observed_later_quote'],1)
        self.assertEqual(r['policy_outcomes_reclassified'],0)
        self.assertFalse(r['approved_for_live'])

    def test_quote_outside_predeclared_range_excluded(self):
        d=self.fixture(); d['windows'][0]['quotes']=[dict(timestamp='2026-08-24T14:01:04Z',
            bid_price=10,ask_price=10.01,bid_size=100,ask_size=100)]
        self.assertEqual(run(d)['observed_later_quote'],0)
