import gzip
import hashlib
import json
import unittest
from datetime import datetime,timedelta
from pathlib import Path

from presignal_liquidity import run


ROOT=Path(__file__).resolve().parents[1]


class PresignalValidationIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol=json.loads((ROOT/'data/presignal-liquidity-validation-protocol.json').read_text())
        cls.raw=json.loads((ROOT/'data/presignal-liquidity-validation-quotes.json').read_text())

    def test_sample_is_deterministic_and_outcome_independent(self):
        selection=json.loads(gzip.decompress((ROOT/'data/study-selection.json.gz').read_bytes()))
        signals=selection['results']['BASE']['validation']['signals']
        seed=self.protocol['selection']['seed']
        ranked=sorted((hashlib.sha256(f'{seed}|{s["id"]}'.encode()).hexdigest(),s['id']) for s in signals)
        cases=self.protocol['selection']['cases']
        self.assertEqual([c['id'] for c in cases],[signal_id for _,signal_id in ranked[:12]])
        self.assertEqual([c['selection_sha256'] for c in cases],[digest for digest,_ in ranked[:12]])

    def test_controls_are_same_symbol_pre_signal_non_signals(self):
        all_ids={c['id'] for c in self.protocol['selection']['cases']}
        selection=json.loads(gzip.decompress((ROOT/'data/study-selection.json.gz').read_bytes()))
        validation_ids={s['id'] for s in selection['results']['BASE']['validation']['signals']}
        for c in self.protocol['selection']['cases']:
            signal=datetime.fromisoformat(c['signal_at'])
            control=datetime.fromisoformat(c['control_at'])
            self.assertGreaterEqual(signal-control,timedelta(minutes=10))
            self.assertNotIn(f"{c['symbol']}:{c['control_at']}",validation_ids)
            self.assertIn(c['id'],all_ids)

    def test_raw_windows_are_complete_and_uncapped(self):
        self.assertEqual(self.raw['market_requests'],12)
        self.assertEqual(self.raw['errors'],[])
        self.assertEqual(self.raw['quotes'],sum(len(w['quotes']) for w in self.raw['windows']))
        self.assertEqual({w['id'] for w in self.raw['windows']},
                         {c['id'] for c in self.protocol['selection']['cases']})
        self.assertTrue(all(not w['truncated'] and len(w['quotes'])<w['limit'] for w in self.raw['windows']))

    def test_saved_report_is_exact_replay(self):
        expected=json.loads((ROOT/'data/presignal-liquidity-validation-report.json').read_text())
        self.assertEqual(run(self.protocol,self.raw),expected)
