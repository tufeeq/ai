import math, sys, unittest
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from explosive import ET, vector, reference, label, aggregate_minutes, shadow, predict, FEATURES, SCHEMA


def bars(day='2026-09-11', count=78):
    t = int(datetime.fromisoformat(day+'T09:30:00').replace(tzinfo=ET).timestamp())
    return [{'t': t+i*300, 'o': 10., 'h': 10.1, 'l': 9.9, 'c': 10., 'v': 20000.} for i in range(count)]


class CausalTests(unittest.TestCase):
    def test_missing_future_does_not_remove_a_known_candidate(self):
        try:
            import train_explosive as train
        except ImportError:
            self.skipTest('Training dependencies not installed on scanner')
        import tempfile, gzip, json
        from unittest.mock import patch
        history = []
        for day in ['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-08']:
            history.extend(bars(day))
        history.extend(bars('2026-09-09', count=6))
        with tempfile.TemporaryDirectory() as d, patch.object(train, 'DATA', Path(d)):
            with gzip.open(Path(d)/'bars-0.jsonl.gz', 'wt') as f:
                f.write(json.dumps({'symbol':'TEST','bars':history,'splitEvents':{}})+'\n')
            rows, _, refs, _ = train.examples()
        last = [r for r in rows if r['date']=='2026-09-09']
        self.assertEqual(len(last), 1)
        self.assertIsNone(last[0]['y'])
        self.assertEqual(refs['TEST']['asOfDate'], '2026-09-08')

    def test_unknown_outcome_consumes_capacity_and_is_json_serializable(self):
        try:
            from train_explosive import alerts, summarize
        except ImportError:
            self.skipTest('Training dependencies not installed on scanner')
        import json
        unknown = {'symbol': 'A', 'date': '2026-09-11', 'decisionAt': 1, 'y': None,
                   'y50': None, 'grossReturnPct': None, 'maePct': None, 'leadMinutes': None, 'reason': 'UNSCORABLE_GAP'}
        known = {**unknown, 'symbol': 'B', 'decisionAt': 2, 'y': 1, 'grossReturnPct': 20, 'maePct': -2, 'leadMinutes': 30, 'reason': 'TARGET_FIRST'}
        chosen = alerts([unknown, known], [.9, .9], .5, cap=1)
        result = summarize(chosen, ['2026-09-11'])
        self.assertEqual(result['alerts'], 1)
        self.assertEqual(result['unscorableAlerts'], 1)
        self.assertEqual(result['precision20Pct'], 0)
        json.dumps(result)

    def test_real_observations_freeze_before_entry_and_do_not_repeat(self):
        from explosive import record_observations
        from datetime import timezone
        at = int(datetime.fromisoformat('2026-09-14T10:00:00').replace(tzinfo=ET).timestamp())
        row = {'symbol': 'TEST', 'quoteFresh': True, 'explosive': {'status': 'SHADOW', 'aboveResearchThreshold': True,
               'score': 20, 'modelId': 'fixture', 'patterns': [], 'decisionAtUTC': datetime.fromtimestamp(at, timezone.utc).isoformat()}}
        state = {}
        record_observations(state, [row], at+10)
        record_observations(state, [row], at+40)
        record_observations(state, [{**row, 'symbol': 'LATE'}], at+300)
        self.assertEqual(len(state['explosiveObservations']), 1)
        self.assertEqual(next(iter(state['explosiveObservations'].values()))['score'], 20)

    def test_prefix_is_independent_of_future(self):
        b = bars(); ref = reference([bars() for _ in range(5)])
        before = vector(b[:6], ref)
        b[6]['c'] = b[6]['h'] = 1000
        self.assertEqual(before, vector(b[:6], ref))
        self.assertEqual(len(before), len(FEATURES))

    def test_sparse_feature_window_and_bad_ohlc_rejected(self):
        ref = reference([bars() for _ in range(5)])
        b = bars(count=7); b.pop(3)
        self.assertIsNone(vector(b, ref))
        b = bars(count=6); b[-1]['h'] = 9
        self.assertIsNone(vector(b, ref))

    def test_no_same_bar_entry_and_stop_first(self):
        b = bars(count=12); decision = b[5]['t']+300
        self.assertIsNone(label(b[6:], decision, b[-1]['t']+300))
        b[7].update(h=13, l=9)
        result = label(b[7:], decision, b[-1]['t']+300)
        self.assertEqual(result['reason'], 'STOP_FIRST')
        self.assertEqual(result['y'], 0)
        self.assertAlmostEqual(result['grossReturnPct'], -5)

    def test_barrier_before_gap_can_score_but_gap_before_barrier_cannot(self):
        b = bars(count=12); decision = b[5]['t']+300
        future = b[7:]; future.pop(1)
        future[-1]['h'] = 13
        self.assertIsNone(label(future, decision, b[-1]['t']+300))
        future[0]['h'] = 13
        self.assertEqual(label(future, decision, b[-1]['t']+300)['y'], 1)

    def test_delayed_entry_gap_is_real_price_not_signal_close(self):
        b = bars(count=12); decision = b[5]['t']+300
        for x in b[7:]:
            x.update(o=15, h=15.1, l=14.9, c=15)
        r = label(b[7:], decision, b[-1]['t']+300)
        self.assertEqual(r['y'], 0)
        self.assertEqual(r['grossReturnPct'], 0)

    def test_minute_aggregation_drops_unfinished_or_missing_bucket(self):
        t = bars()[0]['t']
        p = [(t+i*60, 10+i*.01, 100, 10, 11, 9) for i in range(9)]
        a = aggregate_minutes(p)
        self.assertEqual(len(a), 1)
        self.assertEqual(a[0]['v'], 500)
        self.assertAlmostEqual(a[0]['c'], 10.04)
        self.assertEqual(aggregate_minutes(p[:2]+p[3:5]), [])

    def test_model_never_grants_permission_and_rejects_future_reference(self):
        b = {'schema': SCHEMA, 'trainingCutoff': '2026-09-11', 'id': 'fixture',
             'model': {'kind': 'logistic', 'intercept': 0, 'weights': [0]*20, 'mean': [0]*20, 'scale': [1]*20}, 'threshold': .1}
        at = int(datetime.fromisoformat('2026-09-14T11:00:00').replace(tzinfo=ET).timestamp())
        r = shadow('TEST', [], 'regular', b, {'symbols': {'TEST': {'asOfDate': '2026-09-14'}}}, at)
        self.assertFalse(r['tradeEligible'])
        self.assertEqual(r['reason'], 'BASELINE_DATE_INVALID')

    def test_threshold_alerts_are_first_in_time_and_daily_capped(self):
        try:
            from train_explosive import alerts
        except ImportError:
            self.skipTest('Training dependencies not installed on scanner')
        rows = [{'symbol': 'A', 'date': '2026-09-11', 'decisionAt': 1},
                {'symbol': 'A', 'date': '2026-09-11', 'decisionAt': 2},
                {'symbol': 'B', 'date': '2026-09-11', 'decisionAt': 3}]
        got = alerts(rows, [.6, .99, .9], .5, cap=1)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]['decisionAt'], 1)

    def test_exported_nonlinear_inference_matches_sklearn(self):
        try:
            import numpy as np
            from sklearn.ensemble import HistGradientBoostingClassifier
            from train_explosive import portable
        except ImportError:
            self.skipTest('Training dependencies not installed on scanner')
        rng = np.random.default_rng(10); x = rng.normal(size=(250, 20))
        y = (x[:, 0]*x[:, 1] > .3).astype(int)
        fit = HistGradientBoostingClassifier(max_iter=5, min_samples_leaf=10, early_stopping=False).fit(x, y)
        model = portable(fit)
        for row, expected in zip(x[:20], fit.predict_proba(x[:20])[:, 1]):
            self.assertAlmostEqual(predict(model, row), expected, places=10)


if __name__ == '__main__':
    unittest.main()
