import json
import unittest
from datetime import datetime, timedelta, timezone
from research.features import (END_OF_MINUTE, exchange_sessions, visible_bars,
                              session_position, momentum_atr, same_time_rvol)
from research.phase2 import ROOT, build, compare, describe, paired_bootstrap, dump, public_evidence


AT = datetime(2026, 9, 24, 14, tzinfo=timezone.utc)


def bar(start, volume=100, **kw):
    return dict(timestamp=start.isoformat(), available_at=(start + timedelta(minutes=1)).isoformat(),
                open=10, high=10.1, low=9.9, close=10, volume=volume, **kw)


def sample():
    rows = [bar(AT - timedelta(minutes=n)) for n in range(18, 0, -1)]
    rows[-1].update(high=12, close=12)
    return rows


class CausalFeatures(unittest.TestCase):
    def test_atr_excludes_expansion_and_requires_prior_close(self):
        feature = momentum_atr(visible_bars(sample(), AT), AT)
        self.assertEqual(feature['status'], 'OBSERVABLE')
        self.assertAlmostEqual(feature['atr_price'], .2)
        self.assertAlmostEqual(feature['value'], 10)
        self.assertEqual(feature['atr_end_at'], (AT - timedelta(minutes=3)).isoformat())
        self.assertEqual(momentum_atr(visible_bars(sample()[1:], AT), AT)['value'], None)

    def test_future_bar_and_late_revision_cannot_change_feature(self):
        rows = sample(); before = momentum_atr(visible_bars(rows, AT), AT)
        future = bar(AT); future.update(close=float('nan'), volume=-1)
        late = {**rows[5], 'available_at': (AT + timedelta(seconds=1)).isoformat(), 'high': 10000}
        after = momentum_atr(visible_bars(rows + [future, late], AT), AT)
        self.assertEqual(before, after)
        rows[-1]['available_at'] = (AT + timedelta(seconds=1)).isoformat()
        self.assertIsNone(momentum_atr(visible_bars(rows, AT), AT)['value'])
        self.assertIsNone(momentum_atr(visible_bars(rows, AT + timedelta(seconds=2)), AT)['value'])

    def test_thirty_second_tick_uses_same_completed_minutes(self):
        self.assertEqual(momentum_atr(visible_bars(sample(), AT), AT),
                         momentum_atr(visible_bars(sample(), AT + timedelta(seconds=30)), AT + timedelta(seconds=30)))

    def test_revisions_use_availability_and_sequence_not_input_order(self):
        row = sample()[0]; revised = {**row, 'high': 11, 'sequence': 1}
        self.assertEqual(visible_bars([revised, row], AT), visible_bars([row, revised], AT))
        self.assertEqual(next(iter(visible_bars([row, revised], AT).values()))['high'], 11)
        with self.assertRaises(ValueError): visible_bars([row, row], AT)

    def test_explicit_receipt_or_scenario_required_and_invalid_data_rejected(self):
        row = sample()[0]; del row['available_at']
        with self.assertRaises(ValueError): visible_bars([row], AT)
        self.assertEqual(len(visible_bars([row], AT, END_OF_MINUTE)), 1)
        for changes in ({'available_at': row['timestamp']}, {'high': 1}, {'volume': float('nan')}):
            with self.assertRaises(ValueError): visible_bars([{**row, **changes}], AT, END_OF_MINUTE)

    def test_calendar_dst_and_early_close(self):
        sessions = exchange_sessions([
            {'date': '2026-03-06', 'open': '2026-03-06T09:30:00', 'close': '2026-03-06T16:00:00'},
            {'date': '2026-03-09', 'open': '2026-03-09T09:30:00', 'close': '2026-03-09T13:00:00'}])
        self.assertEqual(sessions['2026-03-06'][0].hour, 14)
        self.assertEqual(sessions['2026-03-09'][0].hour, 13)
        f = session_position('2026-03-09T16:45:00Z', sessions['2026-03-09'])
        self.assertEqual(f['minutes_to_close'], 15)
        self.assertFalse(session_position('2026-03-09T17:00:00Z', sessions['2026-03-09'])['regular_session'])
        self.assertIsNone(session_position(AT, None)['value'])

    def make_rvol(self):
        # Synthetic session calendar: no claim these dates are actual exchange sessions.
        calendar = []; rows = []
        for i in range(21):
            date = (AT - timedelta(days=20 - i)).date().isoformat()
            calendar.append({'date': date, 'open': date + 'T09:30:00', 'close': date + 'T16:00:00'})
            for n in (3, 2, 1):
                rows.append(bar(AT - timedelta(days=20 - i, minutes=n), 200 if i == 20 else 100))
        return rows, exchange_sessions(calendar)

    def test_rvol_requires_twenty_exact_prior_sessions_and_verified_basis(self):
        rows, sessions = self.make_rvol(); bars = visible_bars(rows, AT)
        self.assertAlmostEqual(same_time_rvol(bars, AT, sessions, True)['value'], 2)
        self.assertIsNone(same_time_rvol(bars, AT, sessions)['value'])
        del sessions[min(sessions)]
        self.assertEqual(same_time_rvol(bars, AT, sessions, True)['status'], 'UNKNOWN_20_SESSION_HISTORY')

    def test_rvol_missing_minute_is_not_zero_volume_or_skipped_session(self):
        rows, sessions = self.make_rvol()
        self.assertEqual(same_time_rvol(visible_bars(rows[1:], AT), AT, sessions, True)['status'],
                         'UNKNOWN_SAME_TIME_VOLUME')
        rows[0]['volume'] = 0
        self.assertIsNotNone(same_time_rvol(visible_bars(rows, AT), AT, sessions, True)['value'])
        first = min(sessions); start, _ = sessions[first]
        sessions[first] = (start, start + timedelta(minutes=15))
        self.assertEqual(same_time_rvol(visible_bars(rows, AT), AT, sessions, True)['status'],
                         'UNKNOWN_SAME_TIME_VOLUME')


class Comparisons(unittest.TestCase):
    def rows(self):
        return [{'session': day, 'net_pct': value, 'features': {'x':
                {'value': 1 if select else 0 if select is False else None,
                 'selected': select, 'status': 'OBSERVABLE' if select is not None else 'UNKNOWN'}}}
                for day, value, select in [('a', 2, True), ('a', -2, False), ('b', -4, True),
                                           ('b', None, True), ('c', 100, None)]]

    def test_fair_population_denominators_and_conditional_effect(self):
        protocol = {'statistics': {'iterations': 200, 'seed': 1, 'family_size': 2,
                                   'minimum_complete_bootstrap_fraction': .99},
                    'cost_sensitivity_round_trip_percentage_points': [.5, 1, 2]}
        r = compare(self.rows(), 'x', protocol)
        self.assertEqual((r['selected']['signals'], r['excluded']['signals'], r['unknown_feature']['signals']), (3, 1, 1))
        self.assertEqual(r['selected']['evaluable'], 2)
        self.assertIsNone(r['selected']['all_signal_expectancy_pct'])
        self.assertAlmostEqual(r['effect_percentage_points'], -1 + 4 / 3)
        self.assertEqual(r['cost_sensitivity'][-1]['conditional_selected_mean_pct'], -2.5)
        self.assertIsNone(r['bootstrap']['p_adjusted'])

    def test_paired_identity_and_family_interval(self):
        rows = [{'session': str(i), 'net_pct': i - 5, 'selected': True} for i in range(10)]
        result = paired_bootstrap(rows, 300, 1, 2)
        self.assertEqual(result['effect_ci95_percentage_points'], [0, 0])
        self.assertEqual(result['effect_family_adjusted_ci_percentage_points'], [0, 0])
        self.assertEqual(result, paired_bootstrap(rows, 300, 1, 2))
        self.assertEqual(result['per_interval_confidence'], .975)

    def test_missing_sessions_and_empty_replicates_are_counted(self):
        rows = [{'session': 'a', 'net_pct': 1, 'selected': True},
                {'session': 'b', 'net_pct': None, 'selected': False}]
        r = paired_bootstrap(rows, 1000, 1, 2)
        self.assertLess(r['valid_replicates'], 990)
        self.assertIsNone(r['effect_ci95_percentage_points'])
        self.assertEqual(describe(rows)['missing_outcomes'], 1)

    def test_frozen_study_reproduces_and_keeps_all_322_cases(self):
        report = build()
        self.assertEqual(report['full_baseline']['signals'], 322)
        self.assertEqual(report['full_baseline']['evaluable'], 84)
        self.assertEqual(report['full_baseline']['missing_outcomes'], 238)
        self.assertEqual(report['holdout_opens'], 0)
        self.assertFalse(report['live_rules_changed'])
        registry = {r['id']: r for r in json.loads((ROOT / 'research/feature-registry.json').read_text())['configurations']}
        for r in report['comparisons']:
            self.assertEqual(sum(r[k]['signals'] for k in ('selected', 'excluded', 'unknown_feature')), 322)
            self.assertEqual(registry[r['id']]['effect'], r['effect_percentage_points'])
            self.assertEqual(registry[r['id']]['ci95'], r['bootstrap']['effect_ci95_percentage_points'])
        self.assertEqual((ROOT / 'data/phase2-development.json').read_text(), dump(report))
        self.assertEqual((ROOT / 'web/phase2-evidence.json').read_text(), dump(public_evidence(report)))


if __name__ == '__main__': unittest.main()
