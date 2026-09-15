import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from study import choose, heldout, protocol_hash, freeze, remaining_move
from engine import Config
from test_engine import detect


def result(train_n=20,train_mean=1,val_n=10,val_mean=1):
    return dict(training={'summary':dict(resolved=train_n,mean_net_pct=train_mean)},
                validation={'summary':dict(resolved=val_n,mean_net_pct=val_mean)})


class StudyIntegrity(unittest.TestCase):
    def test_negative_training_rejected_even_if_validation_positive(self):
        self.assertIsNone(choose({'A':result(train_mean=-.1,val_mean=10)}))

    def test_small_validation_sample_rejected(self):
        self.assertIsNone(choose({'A':result(val_n=9,val_mean=10)}))

    def test_no_candidate_in_current_frozen_study(self):
        path=Path(__file__).resolve().parents[1]/'data/study-freeze.json'
        if not path.exists(): self.skipTest('Study not collected')
        frozen=json.loads(path.read_text())
        self.assertIsNone(frozen['selected'])
        self.assertFalse(frozen['approved_for_live'])

    def test_selection_uses_validation_only_after_training_gate(self):
        self.assertEqual(choose({'A':result(train_mean=10,val_mean=.5),
                                 'B':result(train_mean=.1,val_mean=.6)}),'B')

    def test_test_cannot_change_selection(self):
        protocol=dict(test=['2026-09-02'],hypotheses=[{'name':'BASE','overrides':{}},{'name':'A','overrides':{}}],limits=[])
        frozen=dict(protocol_sha256=protocol_hash(protocol),selected='A',status='CANDIDATE_SELECTED_FOR_TEST')
        with patch('study.evaluate',return_value={'summary':{'mean_net_pct':-10}}):
            outcome=heldout(protocol,frozen)
        self.assertEqual(outcome['selected'],'A')
        self.assertFalse(outcome['approved_for_live'])

    def test_protocol_change_fails_closed(self):
        with self.assertRaises(ValueError):
            heldout({},dict(protocol_sha256='different'))

    def test_cannot_overwrite_frozen_selection(self):
        class Existing:
            def exists(self): return True
        with self.assertRaises(ValueError): freeze({},Existing())

    def test_explosive_label_respects_stop(self):
        s=detect()[1][0]
        bar=dict(timestamp=s['at'],open=s['entry'],low=s['stop']*.99,high=s['entry']*1.3,close=s['entry'])
        self.assertEqual(remaining_move(s,[bar],.2,Config()),'AMBIGUOUS')
