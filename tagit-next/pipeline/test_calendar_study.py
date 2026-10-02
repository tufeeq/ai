import unittest

import calendar_study as cal
from test_catalyst_study import bars_for, weekdays


class Parsing(unittest.TestCase):
    def test_pdufa_date_after_the_mention(self):
        t = cal.text_of('<p>The FDA assigned a Prescription Drug User Fee Act (PDUFA) target action date of&nbsp;March 15, 2024.</p>')
        self.assertEqual(cal.parse_pdufa(t, '2023-09-20'), {'date': '2024-03-15', 'decision': False, 'extension': False})

    def test_dates_outside_the_window_are_ignored(self):
        t = 'Filed on January 3, 2023. PDUFA date of Jan. 10, 2023 was met; new PDUFA goal date Sept 1, 2023.'
        self.assertEqual(cal.parse_pdufa(t, '2023-01-05')['date'], '2023-09-01')

    def test_decision_notices_and_extensions(self):
        p = cal.parse_pdufa('The U.S. Food and Drug Administration has approved DrugX ahead of its PDUFA date of June 2, 2025.', '2025-05-01')
        self.assertTrue(p['decision'])
        p = cal.parse_pdufa('The FDA extended the PDUFA date to August 30, 2025 to review a major amendment.', '2025-05-01')
        self.assertEqual(p['date'], '2025-08-30')
        self.assertTrue(p['extension'])

    def test_no_date(self):
        self.assertIsNone(cal.parse_pdufa('PDUFA target in the first half of 2025.', '2024-11-01')['date'])


class Events(unittest.TestCase):
    def test_pdufa_events_first_announcement_and_cancellation(self):
        mentions = [('2024-01-10', '2024-06-01', False, False), ('2024-03-01', '2024-06-01', False, False),
                    ('2024-05-01', '2024-09-01', False, True), ('2024-09-03', None, True, False)]
        ev = cal.pdufa_events(mentions)
        self.assertEqual(ev[0][:3], ('2024-06-01', '2024-01-10', '2024-05-01'))  # extended on 05-01
        self.assertEqual(ev[1][:3], ('2024-09-01', '2024-05-01', None))
        self.assertEqual(ev[1][3], ['2024-09-03'])

    def test_earnings_days_dedupe_and_prediction(self):
        fs = [{'form': '8-K', 'acc': '2024-03-01T16:05', 'items': '2.02,9.01'},
              {'form': '8-K', 'acc': '2024-03-05T08:00', 'items': '2.02'},
              {'form': '8-K', 'acc': '2024-05-01T08:00', 'items': '1.01'},
              {'form': '8-K', 'acc': '2024-05-10T07:30', 'items': '2.02'}]
        days = cal.earnings_days(fs)
        self.assertEqual(days, [('2024-03-01', 965), ('2024-05-10', 450)])
        self.assertEqual(cal.predicted_dates(days)[0], ('2025-02-28', '2024-03-01'))  # same weekday
        self.assertTrue(cal.reported_recently(days, '2024-06-01'))
        self.assertFalse(cal.reported_recently(days, '2024-08-01'))

    def test_runup_trade_buys_k_sessions_before_and_sells_the_session_before(self):
        days = weekdays('2024-01-01', 60)
        b = bars_for(days, start=5, drift=0.01, vol=200_000)
        dates = [x[0] for x in b]
        i, g = cal.runup_trade(b, dates, days[40], 5)
        self.assertEqual(i, 35)
        self.assertAlmostEqual(g, (b[39][4] / b[35][1] - 1) * 100)
        self.assertEqual(cal.runup_trade(b, dates, '2024-01-06', 5), None)  # too early (warm-up)
        self.assertIsNone(cal.runup_trade(b, dates, '2025-01-01', 5))  # no session near the date


class Study(unittest.TestCase):
    def test_end_to_end_synthetic(self):
        days = weekdays('2022-11-15', 260)
        rising = bars_for(days, start=5, drift=0.002, vol=200_000)
        data = {'pairs': [['AAA', 1, '2022-01-01', '2026-12-31']], 'current': {'AAA': 1},
                'filings': {'1': [{'form': '8-K', 'acc': f'{d}T16:05', 'items': '2.02'} for d in (days[10], days[75], days[140], days[205])]}}
        pdufa = {1: [(days[120], days[200], False, False)]}
        diag = {}
        out = cal.run_study(data, {'AAA': rising}, pdufa, diag)
        self.assertIn('primary', out)
        self.assertGreater(diag['events']['EO']['kept'], 0)
        self.assertEqual(diag['events']['B']['kept'], 1)
        self.assertGreater(out['grid']['B']['H10']['development']['trades'] + out['grid']['B']['H10']['holdout']['trades'], 0)


class AfterNews(unittest.TestCase):
    def test_runup_and_warning_window(self):
        import datetime as dt
        import catalyst_calendar as cc
        closes = [(f'2026-09-{d:02d}', p) for d, p in [(21, 10), (22, 10.2), (23, 10.5), (24, 10.8), (25, 11.2), (28, 11.5), (29, 12.0)]]
        e = cc.after_news_entry(dt.date(2026, 9, 29), 'AFTER_HOURS', closes)
        self.assertEqual(e['runup_pct'], round((11.5 / 10 - 1) * 100, 2))  # close before the report over 5 sessions earlier
        self.assertEqual(e['reaction_day'], '2026-09-30')
        self.assertEqual(e['warn_until'], '2026-10-02')
        e = cc.after_news_entry(dt.date(2026, 10, 2), 'PRE_MARKET', closes + [('2026-09-30', 12), ('2026-10-01', 12)])
        self.assertEqual(e['reaction_day'], '2026-10-02')
        self.assertEqual(e['warn_until'], '2026-10-06')  # over the weekend
        self.assertIsNone(cc.after_news_entry(dt.date(2026, 9, 23), 'PRE_MARKET', closes))


if __name__ == '__main__':
    unittest.main()
