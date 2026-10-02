import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import forward

DAY = dt.date(2026, 9, 25)


def point(wall, price):
    """A Nasdaq.com chart point for New York wall-clock `wall` ("HH:MM")."""
    h, m = map(int, wall.split(':'))
    x = int(dt.datetime(2026, 9, 25, h, m, tzinfo=dt.timezone.utc).timestamp() * 1000)
    printed = dt.datetime(2026, 9, 25, h, m).strftime('%-I:%M %p') + ' ET'
    return {'x': x, 'y': price, 'z': {'dateTime': printed, 'value': str(price)}}


class ChartPoints(unittest.TestCase):
    def test_real_probe_sample_maps_new_york_wall_clock_to_utc(self):
        sample = [{'z': {'dateTime': '7:00 AM ET', 'value': '10.2687'}, 'x': 1790319600000, 'y': 10.2687},
                  {'z': {'dateTime': '2:39 PM ET', 'value': '10.185'}, 'x': 1790347140000, 'y': 10.185}]
        points = forward.chart_points(sample, DAY)
        self.assertEqual(points[0][0].isoformat(), '2026-09-25T11:00:00+00:00')  # 07:00 EDT
        self.assertEqual(points[1][0].isoformat(), '2026-09-25T18:39:00+00:00')

    def test_inconsistent_or_other_day_points_are_dropped(self):
        bad = point('10:00', 2.0)
        bad['z']['dateTime'] = '10:05 AM ET'
        self.assertEqual(forward.chart_points([bad, point('10:01', 0)], DAY), [])
        self.assertEqual(forward.chart_points([point('10:00', 2.0)], dt.date(2026, 9, 24)), [])


class Label(unittest.TestCase):
    close = dt.datetime(2026, 9, 25, 20, 0, tzinfo=dt.timezone.utc)  # 16:00 EDT

    def alert(self, wall, plan=None):
        h, m = map(int, wall.split(':'))
        at = dt.datetime(2026, 9, 25, h, m, tzinfo=forward.NY).astimezone(dt.timezone.utc)
        return {'symbol': 'AAA', 'detected_at': at.isoformat().replace('+00:00', 'Z'), 'plan': plan}

    def test_minutes_without_trades_carry_the_last_price(self):
        points = forward.chart_points([point('10:00', 2.00), point('10:05', 2.20), point('10:29', 2.10), point('10:40', 9.0)], DAY)
        out = forward.label(self.alert('10:00'), points, self.close)
        self.assertEqual(out['status'], 'RESOLVED')
        self.assertEqual(out['exit'], 2.10)  # last trade before 10:30, the 11:40 print is outside
        self.assertAlmostEqual(out['return_after_cost_pct'], 4.5)
        self.assertAlmostEqual(out['max_up_pct'], 10.0)

    def test_no_trade_within_two_minutes_is_no_entry(self):
        points = forward.chart_points([point('10:03', 2.0), point('10:10', 2.2)], DAY)
        self.assertEqual(forward.label(self.alert('10:00'), points, self.close), {'status': 'NO_ENTRY'})

    def test_session_close_caps_the_horizon_and_plan_stop_wins(self):
        points = forward.chart_points([point('15:45', 2.0), point('15:50', 1.89), point('15:55', 2.5)], DAY)
        out = forward.label(self.alert('15:45', {'entry': 2.0, 'stop': 1.9, 'targets': [2.1, 2.2]}), points, self.close)
        self.assertEqual(out['exit_kind'], 'SESSION_END')
        # The first sampled price at/below the stop was 1.89, 0.01 under it: the loss is -1.1R, not
        # a clean -1R; after the 0.5 pp cost (0.01 per share on a 0.10 risk) it is -1.2R.
        self.assertEqual(out['plan']['status'], 'STOP')
        self.assertAlmostEqual(out['plan']['r'], -1.1)
        self.assertAlmostEqual(out['plan']['r_after_cost'], -1.2)

    def test_target_fills_at_the_target_and_cost_is_charged_in_r(self):
        points = forward.chart_points([point('10:00', 2.0), point('10:05', 2.5)], DAY)
        out = forward.label(self.alert('10:00', {'entry': 2.0, 'stop': 1.9, 'targets': [2.1, 2.2]}), points, self.close)
        self.assertEqual(out['plan']['status'], 'TARGET_2R')
        self.assertAlmostEqual(out['plan']['r'], 2.0)
        self.assertAlmostEqual(out['plan']['r_after_cost'], 1.9)


class RecordAndEvaluate(unittest.TestCase):
    def test_record_dedupes_alerts_and_logs_unreachable_service(self):
        payload = {'status': 'OK', 'server_time': '2026-09-25T14:00:00Z', 'coverage': {'fresh_prices': 5, 'with_prices': 800},
                   'alerts': [{'symbol': 'AAA', 'detected_at': '2026-09-25T14:00:00Z', 'price': 2.0}]}
        with tempfile.TemporaryDirectory() as d:
            ledger = Path(d) / 'l.json'
            with mock.patch.object(forward, 'get_json', return_value=payload):
                forward.record(ledger)
                forward.record(ledger)
            with mock.patch.object(forward, 'get_json', side_effect=TimeoutError('slow')):
                forward.record(ledger)
            data = json.loads(ledger.read_text())
        self.assertEqual(len(data['alerts']), 1)
        self.assertEqual([h['status'] for h in data['health']], ['OK', 'OK', 'UNREACHABLE'])

    def test_evaluate_writes_day_summary_with_denominators(self):
        ledger = {'alerts': {
            'AAA|1': {'symbol': 'AAA', 'detected_at': '2026-09-25T14:00:00Z', 'plan': {'entry': 2.0, 'stop': 1.9, 'targets': [2.1, 2.2]}},
            'BBB|1': {'symbol': 'BBB', 'detected_at': '2026-09-25T14:00:00Z', 'plan': None},
        }, 'health': [{'at': '2026-09-25T14:00:00+00:00', 'status': 'OK', 'seconds': 3.0}]}
        charts = {'AAA': [point('10:00', 2.0), point('10:20', 2.2)], 'BBB': [point('11:00', 5.0)]}
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'l.json'
            path.write_text(json.dumps(ledger))
            with mock.patch.object(forward, 'OUTCOMES', Path(d) / 'out.json'), \
                 mock.patch.object(forward, 'get_json', side_effect=lambda url, **k: {'data': {'chart': charts[url.split('/')[-2]]}}), \
                 mock.patch.object(forward.time, 'sleep'):
                report = forward.evaluate(path, DAY)
        s = report['days'][0]['summary']
        self.assertEqual((s['alerts'], s['resolved'], s['no_entry']), (2, 1, 1))
        self.assertAlmostEqual(s['mean_return_after_cost_pct'], 9.5)
        self.assertEqual(report['totals']['resolved'], 1)
        self.assertFalse(report['profitability_claim_allowed'])
        # Plan levels travel with the event for the paper ledger; a missing plan stays None.
        events = {e['symbol']: e for e in report['days'][0]['events']}
        self.assertEqual(events['AAA']['plan_levels']['stop'], 1.9)
        self.assertIsNone(events['BBB']['plan_levels'])


def utc(s):
    return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc)


class SessionDay(unittest.TestCase):
    def test_a_run_delayed_past_midnight_evaluates_the_session_not_the_new_date(self):
        # Published 2026-09-29T05:52Z (01:52 New York, Tuesday): the old code evaluated 09-29 and lost Monday.
        self.assertEqual(forward.session_day(utc('2026-09-29T05:52:16')), dt.date(2026, 9, 28))
        self.assertEqual(forward.session_day(utc('2026-09-29T00:20:00')), dt.date(2026, 9, 28))  # 20:20 EDT
        # Saturday 02:11 New York (the published 2026-09-26 row) belongs to Friday.
        self.assertEqual(forward.session_day(utc('2026-09-26T06:11:58')), dt.date(2026, 9, 25))
        # During a session the latest closed session is the previous one; holidays are skipped.
        self.assertEqual(forward.session_day(utc('2026-09-28T15:00:00')), dt.date(2026, 9, 25))
        self.assertEqual(forward.session_day(utc('2026-09-08T12:00:00')), dt.date(2026, 9, 4))  # Labor Day 09-07
        # EST: 16:00 EST is 21:00Z.
        self.assertEqual(forward.session_day(utc('2026-12-01T20:59:00')), dt.date(2026, 11, 30))
        self.assertEqual(forward.session_day(utc('2026-12-01T21:00:00')), dt.date(2026, 12, 1))

    def test_early_close_ends_the_regular_session_at_13(self):
        _, close, _ = forward.session_bounds(dt.date(2026, 11, 27))
        self.assertEqual(close, utc('2026-11-27T18:00:00'))  # 13:00 EST
        self.assertEqual(forward.session_day(utc('2026-11-27T18:30:00')), dt.date(2026, 11, 27))


def chart_for(charts):
    return lambda symbol, day: forward.chart_points(charts.get(symbol, []), day)


class EvaluateGuards(unittest.TestCase):
    def run_eval(self, ledger, day, now, charts, existing=None):
        with tempfile.TemporaryDirectory() as d:
            path, out = Path(d) / 'l.json', Path(d) / 'out.json'
            path.write_text(json.dumps(ledger))
            if existing is not None:
                out.write_text(json.dumps(existing))
            with mock.patch.object(forward, 'OUTCOMES', out), mock.patch.object(forward.time, 'sleep'):
                report = forward.evaluate(path, day, now=now, fetch=chart_for(charts))
            return report, (json.loads(out.read_text()) if out.exists() else None)

    ledger = {'alerts': {
        'AAA|1': {'symbol': 'AAA', 'detected_at': '2026-09-25T14:00:00Z', 'plan': None},       # 10:00 regular
        'CCC|1': {'symbol': 'CCC', 'detected_at': '2026-09-25T11:00:00Z', 'plan': None},       # 07:00 pre-market
        'DDD|1': {'symbol': 'DDD', 'detected_at': '2026-09-25T15:00:00Z', 'plan': None},       # no chart at all
    }, 'health': [{'at': '2026-09-25T14:00:00+00:00', 'status': 'OK', 'seconds': 3.0},
                  {'at': '2026-09-25T15:00:00+00:00', 'status': 'OK', 'seconds': 5.0}]}
    charts = {'AAA': [point('10:00', 2.0), point('10:20', 2.2)], 'CCC': [point('7:00', 1.0), point('7:10', 3.0)]}

    def test_weekend_and_open_session_are_not_evaluated(self):
        report, written = self.run_eval(self.ledger, dt.date(2026, 9, 26), utc('2026-09-26T06:00:00'), self.charts)
        self.assertIsNone(report)
        self.assertIsNone(written)
        report, written = self.run_eval(self.ledger, dt.date(2026, 9, 25), utc('2026-09-25T15:00:00'), self.charts)
        self.assertIsNone(written)

    def test_headline_is_regular_session_and_missing_chart_is_unavailable_not_no_entry(self):
        _, out = self.run_eval(self.ledger, None, utc('2026-09-26T00:30:00'), self.charts)
        s = out['days'][0]['summary']
        self.assertEqual(s['date'], '2026-09-25')
        self.assertTrue(s['complete'] and s['recorded'])
        self.assertEqual((s['alerts'], s['regular_alerts'], s['resolved'], s['no_entry'], s['source_unavailable']), (3, 2, 1, 0, 1))
        self.assertAlmostEqual(s['mean_return_after_cost_pct'], 9.5)  # the +200% pre-market alert is not in it
        self.assertEqual((s['extended_session_alerts'], s['extended_resolved']), (1, 1))
        self.assertAlmostEqual(s['extended_mean_return_after_cost_pct'], 199.5)
        self.assertEqual(s['health']['median_response_seconds'], 4.0)
        self.assertEqual((out['totals']['days'], out['totals']['resolved']), (1, 1))

    def test_a_poorer_later_pass_never_overwrites_and_non_sessions_are_dropped(self):
        _, first = self.run_eval(self.ledger, None, utc('2026-09-26T00:30:00'), self.charts)
        weekend = {'summary': {'date': '2026-09-26', 'alerts': 0, 'resolved': 0, 'health': {'samples': 0}}, 'events': []}
        first['days'].append(weekend)
        # Next morning the chart has rolled to another date and the recorder cache is gone.
        _, second = self.run_eval({'alerts': {}, 'health': []}, dt.date(2026, 9, 25), utc('2026-09-26T13:00:00'), {}, existing=first)
        self.assertEqual([d['summary']['date'] for d in second['days']], ['2026-09-25'])
        self.assertEqual(second['days'][0], first['days'][0])

    def test_unrecorded_days_are_kept_but_not_counted(self):
        _, out = self.run_eval({'alerts': {}, 'health': []}, dt.date(2026, 9, 24), utc('2026-09-25T01:00:00'), {})
        self.assertFalse(out['days'][0]['summary']['recorded'])
        self.assertEqual((out['totals']['days'], out['totals']['days_not_recorded']), (0, 1))

    def test_an_unchanged_re_run_does_not_rewrite_the_file(self):
        _, first = self.run_eval(self.ledger, None, utc('2026-09-26T00:30:00'), self.charts)
        report, second = self.run_eval(self.ledger, None, utc('2026-09-26T00:30:00'), self.charts, existing=first)
        self.assertEqual(second['updated_at'], first['updated_at'])


if __name__ == '__main__':
    unittest.main()
