import unittest
from unittest.mock import patch
from continuous_learning import update,probability,pattern_report
class LearningTests(unittest.TestCase):
 def model(self):return dict(id='frozen',mean=[0]*8,scale=[1]*8,weights=[0]*8,intercept=2,threshold=.5,cutoff='2026-09-01',frozenAtUTC='2026-09-02T00:00:00+00:00',symbols=['TEST'])
 def rows(self):
  return [dict(symbol='TEST',date=f'2026-09-{day:02}',decisionAt=1788393600+(day-3)*86400+i,x=[0]*8,y=0,returnPct=-2.4) for day in range(3,8) for i in range(30)]
 def test_frozen_model_never_scores_seen_dates(self):
  rows=self.rows();state={'pending':self.model(),'lastFitDate':rows[-1]['date']};state['pending']['cutoff']='2026-09-10';s,r=update(state,rows);self.assertEqual(r['prospectiveEvaluation']['selected'],0);self.assertEqual(s['pending']['id'],'frozen')
 def test_bad_model_rejected_once_without_promotion(self):
  rows=self.rows();state={'pending':self.model(),'lastFitDate':rows[-1]['date']}
  with patch('continuous_learning.build_candidate') as fit:
   s,r=update(state,rows);self.assertIsNone(s['pending']);self.assertNotIn('champion',s);self.assertEqual(s['lessons'][-1]['decision'],'REJECTED');fit.assert_not_called()
   n=len(s['lessons']);s,_=update(s,rows);self.assertEqual(len(s['lessons']),n)
 def test_pre_freeze_and_unknown_symbols_excluded(self):
  rows=self.rows();rows[0]['symbol']='NEW';rows[1]['decisionAt']=0;state={'pending':self.model(),'lastFitDate':rows[-1]['date']};rows=rows[:30]
  _,r=update(state,rows);self.assertEqual(r['prospectiveEvaluation']['selected'],28)
 def test_positive_selective_model_can_become_shadow_champion(self):
  rows=self.rows();m=self.model();m['weights'][0]=1;m['intercept']=0
  for i,r in enumerate(rows):
   good=i%30<20;r['x'][0]=10 if good else -10;r['y']=int(good);r['returnPct']=2.6 if good else -2.4
  s,report=update({'pending':m,'lastFitDate':rows[-1]['date']},rows)
  self.assertEqual(s['champion']['id'],'frozen');self.assertFalse(report['productionRankingChanged']);self.assertEqual(s['lessons'][-1]['decision'],'SHADOW_ACCEPTED')
 def test_probabilities_and_patterns(self):
  rows=self.rows();self.assertTrue(all(0<p<1 for p in probability(self.model(),rows)));p=pattern_report(rows);self.assertEqual(p[0]['selected'],150);self.assertEqual(p[0]['sessions'],5)
if __name__=='__main__':unittest.main()
