import unittest
from datetime import timedelta
from engine import timestamp
from exit_audit import evaluate


class ExitAuditTests(unittest.TestCase):
    def fixture(self):
        s=dict(id='X',symbol='X',stop=9.,target=12.)
        w=dict(entry={'first_eligible':{'at':'2026-08-24T14:00:00Z','ask':10.}},quotes=[],limit=10000)
        return s,w
    def q(self,t,bid): return dict(timestamp=t,bid_price=bid,ask_price=bid+.02,bid_size=100,ask_size=100)
    def test_exit_uses_bid_not_ask(self):
        s,w=self.fixture(); w['quotes']=[self.q('2026-08-24T14:01:00Z',12.)]
        r=evaluate(w,s); self.assertEqual(r['exit_bid'],12.); self.assertLess(r['net_pct'],20.)
    def test_capped_prefix_resolves_earlier_stop(self):
        s,w=self.fixture(); w['limit']=1; w['quotes']=[self.q('2026-08-24T14:01:00Z',8.5)]
        self.assertEqual(evaluate(w,s)['outcome'],'STOP')
    def test_capped_prefix_cannot_fake_timeout(self):
        s,w=self.fixture(); w['limit']=1; w['quotes']=[self.q('2026-08-24T14:01:00Z',10.)]
        self.assertEqual(evaluate(w,s)['outcome'],'UNKNOWN_TRUNCATED')
    def test_stale_timeout_unknown(self):
        s,w=self.fixture(); w['quotes']=[self.q('2026-08-24T14:44:00Z',10.)]
        self.assertEqual(evaluate(w,s)['outcome'],'UNKNOWN_TIMEOUT_QUOTE')
    def test_late_target_not_applied_after_timeout(self):
        s,w=self.fixture(); w['quotes']=[self.q('2026-08-24T14:45:01Z',12.)]
        self.assertEqual(evaluate(w,s)['outcome'],'TIMEOUT')
    def test_invalid_quote_does_not_trigger_stop(self):
        s,w=self.fixture(); q=self.q('2026-08-24T14:01:00Z',8.); q['bid_size']=0; w['quotes']=[q]
        self.assertIsNone(evaluate(w,s)['net_pct'])

    def test_invalid_after_deadline_does_not_hide_next_valid_quote(self):
        s,w=self.fixture(); bad=self.q('2026-08-24T14:45:01Z',10.); bad['bid_size']=0
        w['quotes']=[bad,self.q('2026-08-24T14:45:02Z',10.1)]
        r=evaluate(w,s); self.assertEqual(r['outcome'],'TIMEOUT'); self.assertEqual(r['exit_bid'],10.1)

    def test_invalid_update_clears_fresh_fallback(self):
        s,w=self.fixture(); bad=self.q('2026-08-24T14:45:01Z',10.); bad['bid_size']=0
        w['quotes']=[self.q('2026-08-24T14:44:59Z',10.),bad]
        self.assertEqual(evaluate(w,s)['outcome'],'UNKNOWN_TIMEOUT_QUOTE')

    def test_invalid_update_does_not_extend_allowance(self):
        s,w=self.fixture(); bad=self.q('2026-08-24T14:45:01Z',10.); bad['bid_size']=0
        w['quotes']=[bad,self.q('2026-08-24T14:45:03.000001Z',10.1)]
        self.assertIsNone(evaluate(w,s)['net_pct'])

    def test_nonfinite_price_not_a_target_fill(self):
        s,w=self.fixture(); q=self.q('2026-08-24T14:01:00Z',float('inf')); w['quotes']=[q]
        self.assertIsNone(evaluate(w,s)['net_pct'])

    def test_nonfinite_size_not_a_valid_quote(self):
        s,w=self.fixture(); q=self.q('2026-08-24T14:01:00Z',12.); q['bid_size']=float('nan'); w['quotes']=[q]
        self.assertIsNone(evaluate(w,s)['net_pct'])

    def test_exact_timeout_boundary_allowed(self):
        s,w=self.fixture(); w['quotes']=[self.q('2026-08-24T14:45:03Z',10.)]
        self.assertEqual(evaluate(w,s)['outcome'],'TIMEOUT')
