from datetime import timedelta
import unittest

from research.events import time
from research.quote_anchored_later import (bar_discovery, build, first_decision,
                                           quote_discovery)


class QuoteAnchoredLater(unittest.TestCase):
    at = '2026-08-25T14:00:00+00:00'

    def quote(self, seconds, bid=9.99, ask=10, bid_min=None, bid_max=None):
        stamp = (time(self.at) + timedelta(seconds=seconds)).isoformat()
        return {'sequence': seconds, 'event_at': stamp, 'available_at': stamp,
                'bid': bid, 'bid_min': bid if bid_min is None else bid_min,
                'bid_max': bid if bid_max is None else bid_max, 'ask': ask,
                'ask_min': ask, 'ask_max': ask, 'bid_size': 1000, 'ask_size': 1000}

    def test_decision_is_limited_to_two_minutes(self):
        wide = self.quote(1, bid=9, ask=10)
        late = self.quote(121)
        self.assertIsNone(first_decision([wide, late], self.at, .8))
        good = self.quote(119)
        self.assertEqual(first_decision([wide, good], self.at, .8), good)

    def test_quote_target_requires_every_same_time_bid_state(self):
        partial = self.quote(2, bid=10.5, bid_min=10.5, bid_max=11.1, ask=11.2)
        fresh = self.quote(2700, bid=10.5, ask=10.6)
        result = quote_discovery([partial, fresh], self.at,
                                 time(self.at) + timedelta(minutes=46), 10, 10)
        self.assertEqual(result['status'], 'NOT_REACHED_FRESH_TIMEOUT')

    def test_quote_same_time_opposing_barriers_are_unknown(self):
        row = self.quote(2, bid=9.6, ask=11.2, bid_min=9.6, bid_max=11.1)
        result = quote_discovery([row], self.at, time(self.at) + timedelta(minutes=46), 10, 10)
        self.assertEqual(result['status'], 'UNKNOWN_SAME_TIME_BARRIER_ORDER')

    def test_bar_same_minute_order_is_unknown(self):
        result = bar_discovery([{'timestamp': '2026-08-25T14:01:00+00:00',
                                 'low': 9.6, 'high': 11.1}], self.at, 10, 10)
        self.assertEqual(result['status'], 'UNKNOWN_SAME_MINUTE_BARRIER_ORDER')

    def test_frozen_reproduction_keeps_full_denominator(self):
        report = build()
        self.assertEqual(report['sample_cases'], 8)
        self.assertEqual(report['new_market_requests'], 9)
        self.assertEqual(report['new_quote_records'], 34718)
        self.assertFalse(report['profitability_claim_allowed'])
        self.assertTrue(all(row['cases'] == 8 for row in report['scenario_summary']))


if __name__ == '__main__':
    unittest.main()
