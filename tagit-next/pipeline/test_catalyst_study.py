import datetime as dt
import random
import unittest

import catalyst_study as cs


def bars_for(days, start=10.0, drift=0.0, vol=200_000):
    out, p = [], start
    for d in days:
        o = p
        p = p * (1 + drift)
        out.append([d, o, max(o, p) * 1.01, min(o, p) * 0.99, p, vol])
    return out


def weekdays(start, n):
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


class Timing(unittest.TestCase):
    def test_acceptance_parses_new_york_wall_clock(self):
        self.assertEqual(cs.parse_acceptance('2024-03-01T16:05:23.000Z'), ('2024-03-01', 965))
        self.assertIsNone(cs.parse_acceptance(''))

    def test_form4_dates(self):
        self.assertEqual(cs.parse_date('31-JAN-2024'), '2024-01-31')
        self.assertEqual(cs.parse_date('2024-01-31'), '2024-01-31')
        self.assertIsNone(cs.parse_date('junk'))

    def test_entry_is_same_open_only_before_cutoff(self):
        dates = ['2024-03-01', '2024-03-04', '2024-03-05']
        self.assertEqual(cs.entry_index(dates, '2024-03-01', 8 * 60), 0)
        self.assertEqual(cs.entry_index(dates, '2024-03-01', 9 * 60 + 20), 1)  # after 09:15 -> next session
        self.assertEqual(cs.entry_index(dates, '2024-03-01', 16 * 60 + 5), 1)
        self.assertEqual(cs.entry_index(dates, '2024-03-01', None), 1)  # date only -> strictly after
        self.assertEqual(cs.entry_index(dates, '2024-03-02', 10 * 60), 1)  # weekend filing
        self.assertIsNone(cs.entry_index(dates, '2024-03-05', 17 * 60))  # no later bar
        self.assertIsNone(cs.entry_index(['2024-03-01', '2024-03-20'], '2024-03-01', 17 * 60))  # halted > 7 days

    def test_returns_start_at_entry_open_and_charge_costs(self):
        b = [['d0', 10, 10, 10, 10, 1], ['d1', 10, 11, 9, 11, 1], ['d2', 11, 12, 10, 12, 1]]
        g = cs.gross_returns(b, 1)
        self.assertAlmostEqual(g[1], 10.0)
        self.assertIsNone(g[3])  # needs bar 3
        self.assertIsNone(g[5])
        self.assertAlmostEqual(cs.net(10.0, 1, 5), 9.5)
        self.assertAlmostEqual(cs.net(10.0, -1, 5), -10.0 - 0.5 - 0.5)

    def test_eligibility_uses_only_past_bars(self):
        days = weekdays('2024-01-01', 30)
        b = bars_for(days, start=5, vol=100_000)  # $500K a day
        self.assertTrue(cs.eligible(b, 25))
        self.assertFalse(cs.eligible(b, 10))  # warm-up
        cheap = bars_for(days, start=0.3, vol=10_000_000)
        self.assertFalse(cs.eligible(cheap, 25))


class Events(unittest.TestCase):
    def test_filing_events(self):
        fs = [
            {'form': 'S-3', 'acc': '2024-01-02T16:00', 'items': ''},
            {'form': '8-K', 'acc': '2024-01-20T08:00', 'items': '1.01,9.01'},  # financing 18 days before -> excluded
            {'form': '8-K', 'acc': '2024-03-01T17:00', 'items': '1.01'},  # clean
            {'form': '8-K', 'acc': '2024-03-05T17:00', 'items': '1.01,3.02'},  # financing in itself
            {'form': '8-K', 'acc': '2024-03-10T17:00', 'items': '3.01'},
            {'form': '8-K', 'acc': '2024-03-11T16:05', 'items': '2.02,9.01'},
            {'form': '424B5', 'acc': '2024-03-12T07:00', 'items': ''},
            {'form': '424B3', 'acc': '2024-03-13T07:00', 'items': ''},
        ]
        ev = cs.filing_events(fs)
        kinds = [(e[0], e[1]) for e in ev]
        self.assertIn(('agreement', '2024-03-01'), kinds)
        self.assertNotIn(('agreement', '2024-01-20'), kinds)
        self.assertNotIn(('agreement', '2024-03-05'), kinds)
        self.assertIn(('delisting', '2024-03-10'), kinds)
        self.assertIn(('earnings', '2024-03-11'), kinds)
        self.assertIn(('offering', '2024-03-12'), kinds)
        self.assertEqual(sum(1 for k in kinds if k[0] == 'offering'), 1)  # 424B3 resale is not an offering

    def test_insider_cluster_needs_two_owners_and_value(self):
        p = [('2024-01-02', 'A', 30_000), ('2024-01-05', 'A', 30_000)]
        self.assertEqual(cs.insider_clusters(p), [])  # one owner
        p = [('2024-01-02', 'A', 30_000), ('2024-01-08', 'B', 25_000), ('2024-01-09', 'C', 5_000), ('2024-02-01', 'D', 90_000)]
        self.assertEqual(cs.insider_clusters(p), ['2024-01-08'])  # 30-day cool-down, D alone later
        p = [('2024-01-02', 'A', 30_000), ('2024-01-15', 'B', 30_000)]
        self.assertEqual(cs.insider_clusters(p), [])  # outside 10 days

    def test_dilution_flag_is_point_in_time(self):
        regs = ['2024-01-10']
        cash = cs.cash_index([('2023-11-10', '2023-09-30', 4_000_000), ('2024-05-10', '2024-03-31', 50_000_000)])
        self.assertTrue(cs.dilution_flag('2024-02-01', regs, cash))
        self.assertFalse(cs.dilution_flag('2024-06-01', regs, cash))  # new cash filed before the day
        self.assertFalse(cs.dilution_flag('2024-01-10', regs, cash))  # shelf filed that same day is not yet known
        self.assertFalse(cs.dilution_flag('2025-02-01', regs, cash))  # shelf older than a year
        self.assertIsNone(cs.dilution_flag('2024-02-01', regs, cs.cash_index([])))

    def test_ownership_handles_ticker_reuse(self):
        own = cs.Ownership({('XYZ', 1): ('2022-01-01', '2023-06-30'), ('XYZ', 2): ('2025-01-01', '2026-06-30')}, {'XYZ': 2})
        self.assertEqual(own.owner('XYZ', '2023-03-01'), 1)
        self.assertEqual(own.owner('XYZ', '2025-06-01'), 2)
        self.assertEqual(own.owner('XYZ', '2023-12-01'), 1)  # nearest
        self.assertEqual(own.owner('ABC', '2023-12-01'), None)
        self.assertEqual(own.symbols_of(2), {'XYZ'})


class Stats(unittest.TestCase):
    def test_bootstrap_brackets_the_mean(self):
        rnd = random.Random(1)
        c = cs.Cells(300)
        for k in range(300):
            for _ in range(3):
                c.add(k, rnd.gauss(2.0, 5.0), 5)
        s = cs.summarize(c, 0, 300, 1, 5)
        self.assertLess(s['ci95'][0], s['mean_pct'])
        self.assertGreater(s['ci95'][1], s['mean_pct'])
        self.assertAlmostEqual(s['mean_pct'], sum(c.s) / sum(c.n) - 0.5, places=3)
        short = cs.summarize(c, 0, 300, -1, 5)
        self.assertAlmostEqual(short['mean_pct'], -sum(c.s) / sum(c.n) - 0.5 - 0.5, places=3)

    def test_verdict_requires_holdout_and_baseline(self):
        good = {'mean_pct': 1.0, 'ci95': [0.2, 1.8], 'trades': 100}
        self.assertTrue(cs.verdict(good, good, {'mean_pct': -0.3}))
        self.assertFalse(cs.verdict(good, {**good, 'ci95': [-0.1, 2]}, {'mean_pct': -0.3}))
        self.assertFalse(cs.verdict(good, good, {'mean_pct': 1.5}))
        self.assertFalse(cs.verdict({**good, 'mean_pct': -0.1}, good, {'mean_pct': -0.3}))
        self.assertFalse(cs.verdict(good, {**good, 'trades': 10}, {'mean_pct': -0.3}))


class EndToEnd(unittest.TestCase):
    def test_study_on_synthetic_data_finds_a_planted_offering_decline(self):
        days = weekdays('2022-12-01', 460)
        bars, filings, pairs = {}, {}, []
        rnd = random.Random(3)
        for n in range(40):
            s = f'S{chr(65 + n // 26)}{chr(65 + n % 26)}'
            b = []
            p = 5.0
            for d in days:
                o = p
                p = max(0.6, p * (1 + rnd.gauss(0, 0.02)))
                b.append([d, o, max(o, p), min(o, p), p, 200_000])
            bars[s] = b
            cik = 1000 + n
            pairs.append([s, cik, days[0], days[-1]])
            fs = []
            for k in range(60, len(days) - 12, 25):
                fs.append({'form': '424B5', 'acc': f'{days[k]}T07:00', 'items': ''})
                for j in range(k, k + 5):  # planted decline after each offering
                    o = b[j][4] if j == k else b[j - 1][4]
                    c = o * 0.97
                    b[j] = [b[j][0], b[j][1] if j == k else o, max(o, c), min(o, c), c, 200_000]
            filings[str(cik)] = fs
        data = {'current': {}, 'pairs': pairs, 'purchases': {}, 'filings': filings, 'cash': {}}
        report = cs.run_study(data, bars, {})
        self.assertIn('offering_short', report['primary'])
        dev = report['primary']['offering_short']['development']
        self.assertGreater(dev['trades'], 100)
        self.assertGreater(dev['mean_pct'], 5)
        self.assertIn('grid', report)
        self.assertEqual(report['diagnostics']['events_kept']['offering'], report['diagnostics']['event_counts']['eligible']['offering'])


if __name__ == '__main__':
    unittest.main()
