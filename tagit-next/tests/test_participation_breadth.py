from datetime import timedelta
import unittest

from research.events import time
from research.participation_breadth import build, persistent_participation, wilson95


class ParticipationBreadth(unittest.TestCase):
    at = time('2026-08-24T14:00:00+00:00')

    def bars(self, recent=(11, 12, 13)):
        values = [10] * 10 + list(recent)
        output = {}
        for index, volume in enumerate(values):
            stamp = self.at - timedelta(minutes=13 - index)
            output[stamp] = {'volume': volume, '_available': stamp + timedelta(minutes=1)}
        return output

    def test_all_three_recent_minutes_must_clear_reference(self):
        selected = persistent_participation(self.bars(), self.at)
        rejected = persistent_participation(self.bars((20, 9, 20)), self.at)
        self.assertTrue(selected['selected'])
        self.assertFalse(rejected['selected'])

    def test_missing_or_zero_volume_is_unknown(self):
        missing = self.bars()
        missing.pop(next(iter(missing)))
        zero = self.bars((11, 0, 13))
        self.assertIsNone(persistent_participation(missing, self.at)['selected'])
        self.assertIsNone(persistent_participation(zero, self.at)['selected'])

    def test_interval_handles_empty_and_is_bounded(self):
        self.assertIsNone(wilson95(0, 0))
        interval = wilson95(1, 3)
        self.assertGreaterEqual(interval[0], 0)
        self.assertLessEqual(interval[1], 1)

    def test_reproduction_excludes_final_test_and_keeps_denominators(self):
        report = build()
        self.assertEqual(report['development_signals'], 155)
        self.assertEqual(report['validation_signals'], 59)
        self.assertEqual(report['sample_signals'], 214)
        self.assertEqual(report['new_market_requests'], 0)
        self.assertEqual(report['holdout_opens'], 0)
        self.assertFalse(report['profitability_claim_allowed'])
        self.assertTrue(all(row['session'] < '2026-09-02' for row in report['rows']))


if __name__ == '__main__':
    unittest.main()
