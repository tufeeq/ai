from datetime import timedelta
import unittest

from research.events import time
from research.execution import Policy
from research.quote_anchored_order import (inverse_order_invariant, possible_entry,
                                            prepare_order_invariant, simulate_order_invariant)


class QuoteAnchoredOrder(unittest.TestCase):
    at = '2026-08-24T14:00:00+00:00'

    def raw(self, bid=9.99, ask=10, bid_size=1000, ask_size=1000, sec=0):
        stamp = (time(self.at) + timedelta(seconds=sec)).isoformat()
        return dict(timestamp=stamp, bid_price=bid, ask_price=ask,
                    bid_size=bid_size, ask_size=ask_size)

    def quote(self, sec, bid=9.99, ask=10, bid_max=None, ask_min=None,
              bid_size=1000, ask_size=1000, volume=100000):
        stamp = (time(self.at) + timedelta(seconds=sec)).isoformat()
        return dict(sequence=sec, event_at=stamp, available_at=stamp,
                    bid=bid, bid_min=bid, bid_max=bid if bid_max is None else bid_max,
                    ask=ask, ask_min=ask if ask_min is None else ask_min, ask_max=ask,
                    bid_size=bid_size, ask_size=ask_size, same_time_states=1,
                    lagged_volume=volume, volume_available_at=self.at, volume_end_at=self.at)

    def setup(self):
        return dict(id='x', symbol='X', decision_at=self.at, decision_ask=10,
                    expires_at='2026-08-24T14:00:30+00:00', quantity=100,
                    entry=9.95, max_entry=10.05, stop=9.7, target=11)

    def test_same_timestamp_is_order_invariant_and_adverse(self):
        a = self.raw(bid=9.99, ask=10, bid_size=900, ask_size=800)
        b = self.raw(bid=9.98, ask=10.01, bid_size=700, ask_size=600)
        first = prepare_order_invariant([a, b], [], self.at, time(self.at)+timedelta(seconds=1))[0][0]
        second = prepare_order_invariant([b, a], [], self.at, time(self.at)+timedelta(seconds=1))[0][0]
        self.assertEqual(first, second)
        self.assertEqual((first['bid'], first['ask'], first['bid_size'], first['ask_size']),
                         (9.98, 10.01, 700, 600))

    def test_exact_duplicates_are_not_summed(self):
        rows, _, quality = prepare_order_invariant([self.raw(), self.raw()], [], self.at,
                                                    time(self.at)+timedelta(seconds=1))
        self.assertEqual(rows[0]['ask_size'], 1000)
        self.assertEqual(quality['exact_duplicate_updates_removed'], 1)

    def test_invalid_group_stops_coverage(self):
        rows, end, quality = prepare_order_invariant([self.raw(), self.raw(bid=11, ask=10, sec=1)], [],
                                                      self.at, time(self.at)+timedelta(seconds=2))
        self.assertEqual(len(rows), 1)
        self.assertEqual(end, time(self.at)+timedelta(seconds=1))
        self.assertIsNotNone(quality['invalid_group_at'])

    def test_all_possible_asks_must_be_in_band(self):
        q = self.quote(1, ask=10.02, ask_min=9.98)
        self.assertEqual(possible_entry(q, self.setup(), Policy()), 'ALL')
        q['ask'] = q['ask_max'] = 10.10
        self.assertEqual(possible_entry(q, self.setup(), Policy()), 'MIXED')

    def test_mixed_entry_is_unknown(self):
        q = self.quote(1, ask=10.10, ask_min=10)
        result = simulate_order_invariant(self.setup(), [q], Policy(),
                                          time(self.at)+timedelta(minutes=46), 3)
        self.assertEqual(result['status'], 'UNKNOWN_SAME_TIME_ENTRY_ORDER')

    def test_worst_ask_and_bid_are_used(self):
        entry = self.quote(1, ask=10.02, ask_min=10)
        exit_quote = self.quote(2, bid=11.01, ask=11.02, bid_max=11.2)
        result = simulate_order_invariant(self.setup(), [entry, exit_quote], Policy(),
                                          time(self.at)+timedelta(minutes=46), 3)
        self.assertEqual(result['status'], 'TARGET')
        self.assertEqual(result['entry_ask'], 10.02)
        self.assertEqual(result['exit_bid'], 11.01)

    def test_any_stop_invalidates_before_entry(self):
        q = self.quote(1, bid=9.6, bid_max=10)
        result = simulate_order_invariant(self.setup(), [q], Policy(),
                                          time(self.at)+timedelta(minutes=46), 3)
        self.assertEqual(result['status'], 'INVALIDATED_BEFORE_ENTRY')

    def test_opposing_barriers_same_timestamp_are_unknown(self):
        rows = [self.quote(1), self.quote(2, bid=9.6, ask=11.2, bid_max=11.1)]
        result = simulate_order_invariant(self.setup(), rows, Policy(),
                                          time(self.at)+timedelta(minutes=46), 3)
        self.assertEqual(result['status'], 'UNKNOWN_SAME_TIME_BARRIER_ORDER')

    def test_partial_target_is_not_promoted(self):
        rows = [self.quote(1), self.quote(2, bid=10.9, ask=11.2, bid_max=11.1),
                self.quote(2701, bid=10, ask=10.01)]
        result = simulate_order_invariant(self.setup(), rows, Policy(horizon_seconds=2700),
                                          time(self.at)+timedelta(minutes=46), 3)
        self.assertEqual(result['status'], 'TIMEOUT')

    def test_stop_exit_wait_is_measured_from_trigger_not_horizon(self):
        rows = [self.quote(1), self.quote(2, bid=9.6, ask=9.7, bid_size=99),
                self.quote(6, bid=10.5, ask=10.51)]
        result = simulate_order_invariant(self.setup(), rows, Policy(exit_wait_seconds=3),
                                          time(self.at)+timedelta(minutes=46), 3)
        self.assertEqual(result['status'], 'UNKNOWN_EXIT_COVERAGE')
        self.assertEqual(result['trigger'], 'STOP')

    def test_inverse_uses_same_conservative_barrier_rule(self):
        rows = [self.quote(1, bid=10.9, bid_max=11.2), self.quote(2, bid=9.6, bid_max=9.7)]
        result = inverse_order_invariant(rows, self.setup(), time(self.at)+timedelta(minutes=46), 3)
        self.assertEqual(result['status'], 'STOP_FIRST_INDICATION')


if __name__ == '__main__':
    unittest.main()
