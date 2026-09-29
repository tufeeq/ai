from datetime import timedelta
import unittest

from research.events import time
from research.execution import Policy
from research.exit_capacity_sensitivity import build, transition_counts
from research.quote_anchored_order import simulate_order_invariant


class ExitCapacitySensitivity(unittest.TestCase):
    at = '2026-08-24T14:00:00+00:00'

    def quote(self, sec, bid=9.99, ask=10, bid_size=1000, ask_size=1000):
        stamp = (time(self.at) + timedelta(seconds=sec)).isoformat()
        return {'sequence': sec, 'event_at': stamp, 'available_at': stamp,
                'bid': bid, 'bid_min': bid, 'bid_max': bid,
                'ask': ask, 'ask_min': ask, 'ask_max': ask,
                'bid_size': bid_size, 'ask_size': ask_size,
                'lagged_volume': 100000, 'volume_available_at': self.at,
                'volume_end_at': self.at}

    def setup(self):
        return {'id': 'x', 'symbol': 'X', 'decision_at': self.at, 'decision_ask': 10,
                'expires_at': '2026-08-24T14:00:30+00:00', 'quantity': 100,
                'entry': 9.95, 'max_entry': 10.05, 'stop': 9.7, 'target': 11}

    def test_longer_allowance_preserves_latched_stop(self):
        rows = [self.quote(1), self.quote(2, bid=9.6, ask=9.7, bid_size=99),
                self.quote(6, bid=10.5, ask=10.51, bid_size=1000)]
        short = simulate_order_invariant(self.setup(), rows, Policy(exit_wait_seconds=3),
                                         time(self.at) + timedelta(minutes=46), 3)
        long = simulate_order_invariant(self.setup(), rows, Policy(exit_wait_seconds=30),
                                        time(self.at) + timedelta(minutes=46), 3)
        self.assertEqual(short['status'], 'UNKNOWN_EXIT_COVERAGE')
        self.assertEqual(long['status'], 'STOP')
        self.assertEqual(long['trigger_at'], rows[1]['available_at'])

    def test_transition_counts_are_paired(self):
        pairs = [({'status': 'UNKNOWN_EXIT_COVERAGE'}, {'status': 'STOP'}),
                 ({'status': 'NO_ENTRY'}, {'status': 'NO_ENTRY'})]
        self.assertEqual(transition_counts(pairs),
                         {'NO_ENTRY -> NO_ENTRY': 1, 'UNKNOWN_EXIT_COVERAGE -> STOP': 1})

    def test_frozen_reproduction_uses_all_twenty_without_requests(self):
        report = build()
        self.assertEqual(report['sample_cases'], 20)
        self.assertEqual(report['new_market_requests'], 0)
        self.assertEqual(report['holdout_opens'], 0)
        self.assertFalse(report['profitability_claim_allowed'])
        self.assertTrue(all(row['cases'] == 20 for row in report['summary']))
        self.assertTrue(all(row['cases'] == 20 for row in report['paired_transitions']))


if __name__ == '__main__':
    unittest.main()
