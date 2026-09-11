import sys,unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import engine as e
class EngineTests(unittest.TestCase):
 def test_sparse_ticks_are_not_five_minutes(self):
  pts=[(i*600,10+i,100) for i in range(7)]
  self.assertIsNone(e.window_metrics(pts)['ret5'])
  self.assertIsNone(e.window_metrics(pts)['va'])
 def test_exact_time_windows(self):
  pts=[(i*60,10+i/100,100 if i<16 else 200) for i in range(31)]
  m=e.window_metrics(pts)
  self.assertAlmostEqual(m['ret5'],(10.3/10.25-1)*100)
  self.assertEqual(m['v5'],1000)
  self.assertEqual(m['va'],2)
 def test_missing_volume_is_unknown(self):
  pts=[(i*60,10,None) for i in range(31)]
  self.assertIsNone(e.window_metrics(pts)['v5'])
  self.assertIsNone(e.window_metrics(pts)['va'])
 def test_distinct_confirmation(self):
  rec={};t=datetime.now(timezone.utc)
  def row(t):return {'stage':'ACTIONABLE','quoteFresh':True,'quoteTimestampUTC':t.isoformat()}
  a=row(t);e.confirm_row(a,rec);self.assertEqual(a['confirmationCount'],1)
  a=row(t);e.confirm_row(a,rec);self.assertEqual(a['confirmationCount'],1)
  a=row(t+timedelta(seconds=60));e.confirm_row(a,rec);self.assertEqual(a['stage'],'CONFIRMED')
  a=row(t+timedelta(seconds=900));e.confirm_row(a,rec);self.assertEqual(a['confirmationCount'],1)
 def test_stale_cannot_confirm(self):
  a={'stage':'ACTIONABLE','quoteFresh':False,'quoteTimestampUTC':datetime.now(timezone.utc).isoformat()};r={'confirmationCount':5}
  e.confirm_row(a,r);self.assertEqual(a['confirmationCount'],0);self.assertNotEqual(a['stage'],'CONFIRMED')
unittest.main()
