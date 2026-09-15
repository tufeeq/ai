import unittest
from datetime import timedelta
from engine import timestamp
from test_engine import detect
from quote_audit import audit
from news_context import prior_news


class QuoteAuditTests(unittest.TestCase):
    def window(self):
        s=detect()[1][0]; s['outcome']='ENTRY_NOT_AVAILABLE'
        def q(seconds):
            return dict(timestamp=(timestamp(s['at'])+timedelta(seconds=seconds)).isoformat(),
                        bid_price=s['entry'],ask_price=s['entry']*1.001,bid_size=100,ask_size=100)
        return dict(setup=s,quotes=[q(.1),q(1),q(1.6)],feed='sip',limit=10000,error=None)

    def test_quotes_can_correct_bar_entry_rejection_without_claiming_profit(self):
        r=audit(self.window()); self.assertIsNotNone(r['sustained_eligible']); self.assertFalse(r['approved_for_live'])

    def test_latency_excludes_immediate_quote(self):
        w=self.window(); w['quotes']=w['quotes'][:1]
        self.assertIsNone(audit(w)['first_eligible'])

    def test_capped_empty_qualification_remains_unknown(self):
        w=self.window(); w['quotes']=w['quotes'][:1]; w['limit']=1
        self.assertEqual(audit(w)['status'],'UNKNOWN_TRUNCATED')

    def test_stop_invalidates_before_later_recovery(self):
        w=self.window(); w['quotes'][1]['bid_price']=w['setup']['stop']*.99
        self.assertIsNone(audit(w)['first_eligible'])

    def test_uncovered_news_is_unknown(self):
        self.assertEqual(prior_news('X','2026-08-24T14:00:00Z',[])['status'],'UNKNOWN_COVERAGE')

    def test_late_discovered_news_not_used_as_early_information(self):
        r=dict(id='1',symbols=['X'],published_at='2026-08-24T13:00:00Z',first_seen_at='2026-08-24T15:00:00Z',version_at='2026-08-24T13:00:00Z')
        self.assertEqual(prior_news('X','2026-08-24T14:00:00Z',[r])['records'],[])

    def test_later_revision_not_used(self):
        r=dict(id='1',symbols=['X'],published_at='2026-08-24T13:00:00Z',first_seen_at='2026-08-24T13:01:00Z',version_at='2026-08-24T15:00:00Z')
        self.assertEqual(prior_news('X','2026-08-24T14:00:00Z',[r])['records'],[])
