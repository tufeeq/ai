import unittest
from research import feature_vector,outcome
class ResearchTests(unittest.TestCase):
 def bars(self,n):return [dict(t=i*300,o=100,h=101,l=99,c=100,v=1000) for i in range(n)]
 def test_missing_bar_rejected(self):
  b=self.bars(12);b[4]['t']+=60;self.assertIsNone(feature_vector(b))
 def test_features_and_zero_volume(self):
  b=self.bars(12);v=feature_vector(b);self.assertEqual(len(v),8);self.assertEqual(v[:3],[0,0,0]);self.assertEqual(v[4],1)
  for x in b:x['v']=0
  self.assertIsNone(feature_vector(b))
 def test_ambiguous_bar_stops_first(self):
  b=self.bars(6);b[0].update(h=104,l=97);r=outcome(b);self.assertEqual(r['y'],0);self.assertAlmostEqual(r['returnPct'],-2.4)
 def test_gap_and_target(self):
  b=self.bars(6);b[1].update(o=95,l=94,h=96,c=95);self.assertAlmostEqual(outcome(b)['returnPct'],-5.4)
  b=self.bars(6);b[1]['h']=104;self.assertEqual(outcome(b)['returnPct'],2.6)
if __name__=='__main__':unittest.main()
