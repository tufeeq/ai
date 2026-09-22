"""Regression fixtures, not market observations or performance evidence."""
import unittest
from datetime import timedelta
from engine import timestamp
from quote_audit import audit
import test_quote_audit as fixtures


class EntryCausalityTests(unittest.TestCase):
    def window(self):
        return fixtures.QuoteAuditTests().window()

    def test_stop_during_latency_prevents_later_entry(self):
        for latency in (1, 3):
            with self.subTest(latency=latency):
                w=self.window()
                w['quotes'][0]['bid_price']=w['setup']['stop']*.99
                w['quotes'][2]['timestamp']=(timestamp(w['setup']['at'])+timedelta(seconds=latency+1)).isoformat()
                r=audit(w,latency_seconds=latency)
                self.assertIsNone(r['first_eligible'])
                self.assertEqual(r['invalidated_at'],w['quotes'][0]['timestamp'])

    def test_stop_at_setup_timestamp_also_invalidates(self):
        w=self.window();w['quotes'][0].update(timestamp=w['setup']['at'],bid_price=w['setup']['stop'])
        self.assertIsNone(audit(w)['first_eligible'])

    def test_stop_before_setup_is_not_retroactive(self):
        w=self.window();w['quotes'][0].update(
            timestamp=(timestamp(w['setup']['at'])-timedelta(seconds=1)).isoformat(),
            bid_price=w['setup']['stop']*.99)
        self.assertIsNotNone(audit(w)['first_eligible'])

    def test_invalid_zero_size_quote_cannot_invalidate(self):
        w=self.window();w['quotes'][0].update(bid_price=w['setup']['stop']*.99,bid_size=0)
        self.assertIsNotNone(audit(w)['first_eligible'])

    def test_pre_latency_eligible_quote_is_not_an_entry(self):
        w=self.window();w['quotes']=w['quotes'][:1]
        self.assertIsNone(audit(w)['first_eligible'])

    def test_post_entry_stop_preserves_observed_first_entry(self):
        w=self.window();w['quotes'][2]['bid_price']=w['setup']['stop']*.99
        r=audit(w)
        self.assertEqual(r['first_eligible']['at'],w['quotes'][1]['timestamp'])
        self.assertEqual(r['invalidated_at'],w['quotes'][2]['timestamp'])

    def test_stop_after_expiry_does_not_rewrite_entry_audit(self):
        w=self.window();w['quotes'][2].update(
            timestamp=(timestamp(w['setup']['expires_at'])+timedelta(seconds=1)).isoformat(),
            bid_price=w['setup']['stop']*.99)
        r=audit(w)
        self.assertIsNotNone(r['first_eligible']);self.assertIsNone(r['invalidated_at'])
