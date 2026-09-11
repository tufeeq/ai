import unittest,sys
from pathlib import Path
from datetime import datetime,timezone,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from quality import freeze_signals,evaluate_signals,quality_summary,VERSION,merge_evidence
from post_session import build_report
class QualityTests(unittest.TestCase):
 def setUp(self):
  self.at=datetime(2026,9,11,14,0,tzinfo=timezone.utc)
  self.state={'sessionDateET':'2026-09-11','signalLedger':{}}
  self.row={'symbol':'TEST','stage':'EARLY','quoteFresh':True,'price':100,'changePct':2,'score':55,'quoteTimestampUTC':self.at.isoformat()}
 def freeze(self):freeze_signals(self.state,[self.row],self.at.isoformat());return next(iter(self.state['signalLedger'].values()))
 def test_two_writers_preserve_earliest_signals(self):
  self.freeze();import copy
  other=copy.deepcopy(self.state);key=next(iter(other['signalLedger']))
  other['signalLedger'][key]['signalAtUTC']=(self.at+timedelta(minutes=1)).isoformat()
  other['signalLedger'][key]['entryReference']=110
  merged=merge_evidence(self.state,other)
  self.assertEqual(merged['signalLedger'][key]['entryReference'],100)
 def test_signal_is_immutable(self):
  sig=self.freeze();self.row['price']=120;freeze_signals(self.state,[self.row],(self.at+timedelta(minutes=5)).isoformat());self.assertEqual(sig['entryReference'],100)
 def test_missing_price_change_not_recalled(self):
  self.row['changePct']=None;self.freeze();report=build_report(self.state,[('TEST',30)]+[(str(i),20) for i in range(49)],self.at.replace(hour=20,minute=25));self.assertEqual(report['captured'],0)
 def test_no_cross_day_recall(self):
  self.freeze();report=build_report(self.state,[('TEST',30)]+[(str(i),20) for i in range(49)],self.at.replace(day=14,hour=20,minute=25));self.assertIsNone(report['earlyRecallPct'])
 def test_partial_winner_set_not_95(self):
  self.freeze();report=build_report(self.state,[('TEST',30)],self.at.replace(hour=20,minute=25));self.assertIsNone(report['earlyRecallPct']);self.assertFalse(report['achieved'])
 def test_stop_before_target_is_failure(self):
  sig=self.freeze();self.row['_points']=[(self.at.timestamp()+i*60,97 if i==3 else 104,100) for i in range(1,31)]
  # First two closes must not already hit target.
  self.row['_points'][0]=(self.at.timestamp()+60,100,100);self.row['_points'][1]=(self.at.timestamp()+120,100,100)
  evaluate_signals(self.state,[self.row],(self.at+timedelta(minutes=32)).isoformat());self.assertEqual(sig['label'],'STOP_FIRST');self.assertEqual(quality_summary(self.state)['byStage']['EARLY']['precisionPct'],0)
 def test_target_before_stop(self):
  sig=self.freeze();self.row['_points']=[(self.at.timestamp()+i*60,104 if i==3 else 100,100) for i in range(1,31)];evaluate_signals(self.state,[self.row],(self.at+timedelta(minutes=32)).isoformat());self.assertEqual(sig['label'],'TARGET_FIRST')
 def test_missing_future_bars_not_win(self):
  sig=self.freeze();self.row['_points']=[(self.at.timestamp()+60,110,100)];evaluate_signals(self.state,[self.row],(self.at+timedelta(minutes=46)).isoformat());self.assertEqual(sig['label'],'UNSCORABLE');self.assertIsNone(quality_summary(self.state)['byStage']['EARLY']['precisionPct'])
 def test_future_cannot_score_early(self):
  sig=self.freeze();self.row['_points']=[(self.at.timestamp()+i*60,110,100) for i in range(1,31)];evaluate_signals(self.state,[self.row],(self.at+timedelta(minutes=10)).isoformat());self.assertEqual(sig['label'],'PENDING')
class IntegrationTests(unittest.TestCase):
 def test_main_writes_forward_evidence_and_preserves_state(self):
  import engine as e,json,tempfile
  from unittest.mock import patch
  at=datetime(2026,9,11,14,10,tzinfo=timezone.utc)
  row={'symbol':'TEST','stage':'EARLY','quoteFresh':True,'price':10,'changePct':2,'score':40,'quoteTimestampUTC':at.isoformat(),'relativeVolume':None,'volumeAcceleration15m':2,'_points':[]}
  state={'sessionDateET':'2026-09-11','symbols':{str(i):{'maxScore':0} for i in range(2501)},'events':[]}
  with tempfile.TemporaryDirectory() as d, patch.object(e,'now',return_value=at),patch.object(e,'load_state',return_value=state),patch.object(e,'finviz_rows',return_value=[]),patch.object(e,'symbol_directory',return_value=['TEST']),patch.object(e,'features',return_value=row),patch.object(e,'OUT_PATH',Path(d)/'live.json'),patch.object(e,'STATE_PATH',Path(d)/'state.json'):
   e.main();out=json.loads(e.OUT_PATH.read_text());saved=json.loads(e.STATE_PATH.read_text())
   self.assertEqual(len(saved['symbols']),2502)
   self.assertEqual(out['quality']['byStage']['EARLY']['signals'],1)
   self.assertNotIn('_points',out['early'][0])
   self.assertFalse(out['quality']['achieved'])
if __name__=='__main__':unittest.main()
