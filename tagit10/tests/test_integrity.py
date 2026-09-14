import sys, unittest, copy
from pathlib import Path
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import engine as e
from screening import closed_points, structure, screen
from quality import freeze_signals,evaluate_signals,quality_summary,merge_evidence,VERSION

class BarIntegrityTests(unittest.TestCase):
 def test_unfinished_and_terminal_quotes_removed(self):
  r={'timestamp':[60,120,181,240],'indicators':{'quote':[{'open':[10]*4,'high':[11]*4,'low':[9]*4,'close':[10]*4,'volume':[1]*4}]}}
  self.assertEqual([x[0] for x in closed_points(r,250)],[60,120])
 def test_invalid_ohlc_removed_and_missing_volume_remains_unknown(self):
  r={'timestamp':[60,120],'indicators':{'quote':[{'open':[10,10],'high':[9,11],'low':[8,9],'close':[10,10],'volume':[100,None]}]}}
  pts=closed_points(r,180);self.assertEqual(len(pts),1);self.assertIsNone(pts[0][2])
 def points(self,falling=False,thin=False):
  start=datetime(2026,9,14,14,0,tzinfo=timezone.utc).timestamp()
  return [(start+i*60,10.6-i*.01 if falling else 10+i*.01,
           (1 if thin else (10000 if i<16 else 25000)),
           10.6-i*.01 if falling else 10+i*.01,
           (10.6-i*.01 if falling else 10+i*.01)+.005,
           (10.6-i*.01 if falling else 10+i*.01)-.005) for i in range(31)]
 def feature(self,falling=False,thin=False,instrument='EQUITY'):
  at=datetime(2026,9,14,14,31,tzinfo=timezone.utc)
  with patch.object(e,'chart',return_value=(self.points(falling,thin),{'instrumentType':instrument},10)),patch.object(e,'now',return_value=at):
   return e.features('TEST',{'Relative Volume':'3'},'regular')
 def test_falling_price_cannot_be_early(self):
  x=self.feature(falling=True);self.assertEqual(x['stage'],'WATCH');self.assertIn('FALLING_PRICE',x['riskBlocks'])
 def test_tiny_volume_cannot_be_actionable(self):
  x=self.feature(thin=True);self.assertEqual(x['stage'],'WATCH');self.assertIn('LOW_LIQUIDITY',x['riskBlocks'])
 def test_healthy_candidate_still_discovered_but_not_trade_approved(self):
  x=self.feature();self.assertEqual(x['stage'],'ACTIONABLE');self.assertTrue(x['screeningPassed']);self.assertFalse(x['tradeEligible'])
 def test_etf_not_promoted(self):
  x=self.feature(instrument='ETF');self.assertEqual(x['stage'],'WATCH')
 def test_missing_window_minute_blocks(self):
  pts=self.points();pts.pop(20);self.assertFalse(structure(pts)['windowsComplete'])
 def test_previous_session_cannot_publish_fresh_signal(self):
  at=datetime(2026,9,14,20,0,tzinfo=timezone.utc)
  pts=[(at.timestamp()-60*(31-i),10+i*.01,25000,10+i*.01,10+i*.01+.005,10+i*.01-.005) for i in range(31)]
  with patch.object(e,'chart',return_value=(pts,{'instrumentType':'EQUITY'},10)),patch.object(e,'now',return_value=at):
   x=e.features('TEST',{'Relative Volume':'3'},'regular')
  self.assertFalse(x['quoteFresh']);self.assertEqual(x['stage'],'WATCH')
 def test_labor_day_closed(self):
  self.assertEqual(e.session(datetime(2026,9,7,10,tzinfo=e.ET)),'closed')
 def test_early_close_and_unknown_calendar(self):
  self.assertEqual(e.session(datetime(2026,11,27,13,30,tzinfo=e.ET)),'after-hours')
  self.assertEqual(e.session(datetime(2026,11,27,17,tzinfo=e.ET)),'closed')
  self.assertEqual(e.session(datetime(2030,9,9,10,tzinfo=e.ET)),'closed')
 def test_confirmation_price_drop_and_new_session_reset(self):
  base={'stage':'ACTIONABLE','quoteFresh':True,'screeningPassed':True,'barClosed':True,'price':100,'ret5mPct':1,'session':'regular','sessionDateET':'2026-09-14'}
  t=datetime(2026,9,14,14,tzinfo=timezone.utc);rec={}
  for i,price,sess in [(0,100,'regular'),(1,99,'regular'),(2,99,'after-hours')]:
   x={**base,'price':price,'session':sess,'quoteTimestampUTC':(t+timedelta(minutes=i)).isoformat()}
   e.confirm_row(x,rec);self.assertEqual(x['confirmationCount'],1)
 def test_finviz_missing_key_visible(self):
  with patch.object(e,'TOKEN',''):self.assertEqual(e.finviz_rows(),[])
  self.assertEqual(e.PROVIDER_HEALTH['finviz']['reason'],'CREDENTIAL_NOT_CONFIGURED')

class FinvizContractTests(unittest.TestCase):
 def test_custom_export_supplies_actual_relative_volume(self):
  calls=[]
  def get(url,timeout):
   calls.append(url);return b'Ticker,Price,Relative Volume\\nTEST,10,3.5\\n'
  with patch.object(e,'TOKEN','unit-test-placeholder'),patch.object(e,'get',side_effect=get),patch.object(e.time,'sleep'):
   rows=e.finviz_rows()
  self.assertTrue(all('/export.ashx?' in u and '&c=' in u for u in calls))
  self.assertEqual(e.pick(rows[0],'Relative Volume'),3.5)
  self.assertEqual(e.PROVIDER_HEALTH['finviz']['rvolCoveragePct'],100)
  self.assertEqual(e.PROVIDER_HEALTH['finviz']['status'],'OK')
 def test_http_success_without_required_fields_is_degraded(self):
  with patch.object(e,'TOKEN','unit-test-placeholder'),patch.object(e,'get',return_value=b'Ticker,Price\\nTEST,10\\n'),patch.object(e.time,'sleep'):
   e.finviz_rows()
  self.assertEqual(e.PROVIDER_HEALTH['finviz']['successfulScans'],3)
  self.assertEqual(e.PROVIDER_HEALTH['finviz']['status'],'DEGRADED')

class OutcomeIntegrityTests(unittest.TestCase):
 def setUp(self):
  self.at=datetime(2026,9,14,14,0,30,tzinfo=timezone.utc)
  self.state={'sessionDateET':'2026-09-14'}
  self.row={'symbol':'TEST','stage':'EARLY','quoteFresh':True,'screeningPassed':True,'barClosed':True,'price':80,'quoteTimestampUTC':self.at.isoformat(),'score':55}
  freeze_signals(self.state,[self.row],self.at.isoformat())
  self.sig=next(iter(self.state['signalLedger'].values()))
  first=(int(self.at.timestamp())//60+1)*60
  self.row['_points']=[(first+i*60,100,100,100,100.1,99.9) for i in range(30)]
 def evaluate(self):
  evaluate_signals(self.state,[self.row],(self.at+timedelta(minutes=47)).isoformat())
 def test_next_open_not_stale_reference(self):
  self.evaluate();self.assertEqual(self.sig['entryObservedPrice'],100)
  self.assertEqual(self.sig['label'],'TIMEOUT');self.assertEqual(self.sig['netReturnPct'],-.4)
 def test_intrabar_stop_before_close_rebound(self):
  t=self.row['_points'][1][0];self.row['_points'][1]=(t,101,100,100,101,97)
  self.evaluate();self.assertEqual(self.sig['label'],'STOP_FIRST')
 def test_ambiguous_both_barriers_count_stop(self):
  t=self.row['_points'][1][0];self.row['_points'][1]=(t,104,100,100,104,97)
  self.evaluate();self.assertEqual(self.sig['label'],'STOP_FIRST');self.assertTrue(self.sig['ambiguousBarStopFirst'])
 def test_gap_through_stop_is_not_capped_loss(self):
  t=self.row['_points'][1][0];self.row['_points'][1]=(t,95,100,94,96,93)
  self.evaluate();self.assertAlmostEqual(self.sig['netReturnPct'],-6.4)
 def test_target_success_after_assumed_cost(self):
  t=self.row['_points'][1][0];self.row['_points'][1]=(t,104,100,100,104,99)
  self.evaluate();self.assertEqual(self.sig['label'],'TARGET_FIRST');self.assertEqual(self.sig['netReturnPct'],2.6)
 def test_missing_one_bar_unscorable(self):
  self.row['_points'].pop(2);self.evaluate();self.assertEqual(self.sig['label'],'UNSCORABLE')
 def test_legacy_version_not_mixed(self):
  self.sig['version']='10.2';self.evaluate()
  self.assertEqual(quality_summary(self.state)['byStage']['EARLY']['signals'],0)
 def test_cross_day_evidence_retained(self):
  nextday={'sessionDateET':'2026-09-15','symbols':{},'signalLedger':{}}
  merged=merge_evidence(self.state,nextday)
  self.assertEqual(merged['sessionDateET'],'2026-09-15');self.assertEqual(len(merged['signalLedger']),1)
 def test_closed_bar_and_gate_required_to_freeze(self):
  before=len(self.state['signalLedger']);self.row.update(symbol='BAD',screeningPassed=False)
  freeze_signals(self.state,[self.row],self.at.isoformat())
  self.assertEqual(len(self.state['signalLedger']),before)

if __name__=='__main__':unittest.main()
