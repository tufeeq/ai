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
        self.assertEqual(out['plan'], {'status': 'STOP', 'r': -1.0})


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
            'AAA|1': {'symbol': 'AAA', 'detected_at': '2026-09-25T14:00:00Z', 'plan': None},
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


if __name__ == '__main__':
    unittest.main()
