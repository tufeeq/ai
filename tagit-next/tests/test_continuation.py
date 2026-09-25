import unittest
from copy import deepcopy
from datetime import timedelta

from research.continuation import (label_path, three_rising_closes, summary,
                                   repair_manifest, comparison)
from research.events import time
from research.features import END_OF_MINUTE, visible_bars
from research.continuation_probe import observe

AT = time('2026-08-24T14:00:00Z')
M = timedelta(minutes=1)
SESSION = (time('2026-08-24T13:30:00Z'), time('2026-08-24T20:00:00Z'))


def bar(t, o=100, h=101, l=99, c=100, v=1000, **extra):
    return {'timestamp': t.isoformat(), 'open': o, 'high': h, 'low': l, 'close': c, 'volume': v, **extra}


def path(rows, at=AT, session=SESSION, **kwargs):
    return label_path({time(r['timestamp']): r for r in rows}, at, session, **kwargs)


class BarrierOrderTests(unittest.TestCase):
    def test_entry_after_latency_not_signal_minute_open(self):
        # A spike during the decision minute is unavailable as a next-open entry.
        rows = [bar(AT, h=150), bar(AT + M, o=110, h=122, l=109, c=120)]
        r = path(rows)
        self.assertEqual(r['entry_at'], (AT + M).isoformat())
        self.assertEqual(r['entry_price_proxy'], 110)
        self.assertEqual(r['status'], 'TARGET')

    def test_same_minute_both_never_forced_success_or_stop(self):
        r = path([bar(AT + M, h=112, l=95)])
        self.assertEqual(r['status'], 'AMBIGUOUS_BOTH')
        self.assertIsNone(r['gross_return_proxy_pct'])
        self.assertIsNone(r['target_first'])

    def test_exact_decimal_threshold_is_a_touch(self):
        self.assertEqual(path([bar(AT + M, h=110)])['status'], 'TARGET')
        self.assertEqual(path([bar(AT + M, l=97)])['status'], 'STOP')

    def test_stop_first_is_not_resurrected_by_later_target(self):
        rows = [bar(AT + M, l=96), bar(AT + 2 * M, h=140)]
        self.assertEqual(path(rows)['status'], 'STOP')
        self.assertEqual(path(rows), path(rows[:1]))

    def test_open_gap_order_and_gap_loss(self):
        r = path([bar(AT + M), bar(AT + 2 * M, o=90, h=120, l=89, c=100)])
        self.assertEqual(r['status'], 'STOP')
        self.assertAlmostEqual(r['gross_return_proxy_pct'], -10)
        self.assertEqual(r['exit_interval']['kind'], 'OPEN')
        r = path([bar(AT + M), bar(AT + 2 * M, o=112, h=115, l=95, c=100)])
        self.assertEqual(r['status'], 'TARGET')

    def test_gap_before_target_stays_unknown(self):
        r = path([bar(AT + M), bar(AT + 3 * M, h=112)])
        self.assertEqual(r['status'], 'UNKNOWN_PATH_GAP')
        self.assertEqual(r['first_missing_at'], (AT + 2 * M).isoformat())

    def test_target_before_future_gap_remains_known(self):
        self.assertEqual(path([bar(AT + M, h=112)])['status'], 'TARGET')

    def test_missing_exact_entry_not_replaced_by_later_entry(self):
        self.assertEqual(path([bar(AT + 2 * M, h=112)])['status'], 'UNKNOWN_ENTRY_BAR')

    def test_timeout_requires_full_path_and_ignores_post_deadline_spike(self):
        rows = [bar(AT + i * M) for i in range(1, 61)]
        rows.append(bar(AT + 61 * M, h=150))
        r = path(rows)
        self.assertEqual(r['status'], 'TIMEOUT')
        self.assertEqual(r['gross_return_proxy_pct'], 0)
        self.assertEqual(r['exit_interval']['end'], (AT + 61 * M).isoformat())
        self.assertEqual(path(rows[:59])['status'], 'UNKNOWN_PATH_GAP')

    def test_short_session_and_no_after_close_entry(self):
        session = (AT - 30 * M, AT + 4 * M)
        r = path([bar(AT + i * M) for i in range(1, 4)], session=session)
        self.assertEqual(r['status'], 'SESSION_END')
        self.assertEqual(r['effective_horizon_minutes'], 3)
        self.assertEqual(path([], at=AT + 3 * M, session=session)['status'], 'NO_SESSION_ENTRY')

    def test_invalid_and_zero_volume_are_unknown(self):
        for bad in [bar(AT + M, v=0), bar(AT + M, h=float('nan')), bar(AT + M, c=150)]:
            self.assertEqual(path([bad])['status'], 'UNKNOWN_ENTRY_BAR_INVALID')
        r = path([bar(AT + M), bar(AT + 2 * M, v=0)])
        self.assertEqual(r['status'], 'UNKNOWN_PATH_BAR_INVALID')

    def test_invalid_policy_rejected(self):
        for kw in [{'stop_pct': 100}, {'horizon_minutes': 1.5}, {'latency_seconds': -1},
                   {'target_pct': float('nan')}, {'horizon_minutes': True}]:
            with self.assertRaises(ValueError): path([], **kw)


class CausalAndDenominatorTests(unittest.TestCase):
    def input(self):
        return [bar(AT - 3 * M, c=99.5), bar(AT - 2 * M, c=100), bar(AT - M, c=100.5)]

    def feature(self, rows, at=AT):
        return three_rising_closes(visible_bars(rows, at, END_OF_MINUTE), at)

    def test_future_prices_and_late_revisions_cannot_change_feature(self):
        rows = self.input(); before = self.feature(rows)
        rows += [bar(AT, h=900, c=800), bar(AT - M, c=99,
                 available_at=(AT + M).isoformat(), sequence=1)]
        self.assertTrue(before['selected'])
        self.assertEqual(before, self.feature(rows))

    def test_incomplete_missing_flat_or_falling_minutes(self):
        rows = self.input()
        self.assertIsNone(self.feature(rows[:2])['selected'])
        rows[-1]['close'] = 100
        self.assertFalse(self.feature(rows)['selected'])
        rows[-1]['close'] = 99
        self.assertFalse(self.feature(rows)['selected'])
        # 30-second scan uses only completed minutes, even with a future spike.
        rows[-1]['close'] = 100.5
        self.assertEqual(self.feature(rows)['selected'], self.feature(rows + [bar(AT, h=150)], AT + M / 2)['selected'])

    def test_unknowns_remain_in_bounds_and_no_executable_claim(self):
        labels = [path([bar(AT + M, h=112)]), path([bar(AT + M, l=96)]), path([])]
        s = summary([{'label': l} for l in labels], [.5, 1, 2])
        self.assertEqual(s['signals'], 3)
        self.assertEqual(s['bar_outcomes_resolved'], 2)
        self.assertEqual(s['unknown_or_ambiguous'], 1)
        self.assertEqual(s['target_rate_identification_bounds_not_ci'], [1/3, 2/3])
        self.assertIsNone(s['executable_expectancy_pct'])
        self.assertFalse(s['profitability_claim_allowed'])
        self.assertAlmostEqual(s['cost_scenarios'][0]['conditional_mean_return_proxy_pct'], 3)

    def test_repair_selection_independent_of_input_order_and_returns(self):
        rows = [{'id': str(i), 'symbol': 'TEST', 'at': AT.isoformat(), 'label': path([])} for i in range(10)]
        original = repair_manifest({'protocol_commit': 'fixed', 'rows': rows})
        changed = deepcopy(rows[::-1])
        for i, row in enumerate(changed): row['irrelevant_return'] = i * 100
        self.assertEqual(original, repair_manifest({'protocol_commit': 'fixed', 'rows': changed}))
        self.assertEqual(len(original['cases']), 6)

    def test_comparison_observable_baseline_and_empty_subset(self):
        rows = [{'id': str(i), 'session': '2026-08-24', 'feature': {'selected': sel}, 'label': path([bar(AT + M, h=112)])}
                for i, sel in enumerate([False, None])]
        p = {'hypothesis': {'id': 'test'}, 'statistics': {'iterations': 10, 'seed': 1, 'family_size': 1,
              'minimum_complete_bootstrap_fraction': .99}, 'cost_sensitivity_round_trip_percentage_points': [.5]}
        c = comparison(rows, p)
        self.assertEqual(c['same_observable_population_baseline']['signals'], 1)
        self.assertEqual(c['unknown_feature']['signals'], 1)
        self.assertIsNone(c['conditional_target_rate_effect_pp'])
        self.assertIsNone(c['target_rate_bootstrap']['effect_ci95_pp'])


class QuoteProbeTests(unittest.TestCase):
    def quote(self, **kw):
        return {'symbol': 'TEST', 'timestamp': AT.isoformat(), 'bid_price': 100,
                'ask_price': 101, 'bid_size': 1, 'ask_size': 1, **kw}

    def test_presence_is_not_execution_and_invalid_quotes_are_counted(self):
        rows = [self.quote(), self.quote(bid_price=102), self.quote(ask_size=0)]
        r = observe(rows, 'TEST', AT, AT + M, capped=True)
        self.assertEqual(r['valid_quotes'], 1)
        self.assertEqual(r['invalid_quotes'], 2)
        self.assertTrue(r['source_capped_or_partial'])
        self.assertFalse(r['executable_fill_verified'])
        self.assertFalse(r['bar_label_changed'])

    def test_empty_and_provider_error_stay_unknown(self):
        self.assertEqual(observe([], 'TEST', AT, AT + M)['status'], 'UNKNOWN_NO_VALID_QUOTES')
        self.assertEqual(observe([], 'TEST', AT, AT + M, error='failure')['status'], 'UNKNOWN_PROVIDER_ERROR')

    def test_probe_bounds_and_symbol(self):
        rows = [self.quote(timestamp=(AT - M).isoformat()), self.quote(timestamp=(AT + M).isoformat())]
        self.assertEqual(observe(rows, 'TEST', AT, AT + M)['valid_quotes'], 0)
        with self.assertRaises(ValueError): observe([self.quote(symbol='OTHER')], 'TEST', AT, AT + M)


if __name__ == '__main__': unittest.main()
