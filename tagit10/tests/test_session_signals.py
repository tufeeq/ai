import copy, sys, unittest
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from session_signals import vector,domain,families,outcome,predict_net,observe,SCHEMA

START=int(datetime(2026,9,14,13,30,tzinfo=timezone.utc).timestamp())
REF={'previousClose':10,'priorDayReturn':1,'priorDayRange':3,'asOfDate':'2026-09-11',
    'cumulativeVolume':{str(570+i*5):10000*(i+1) for i in range(78)}}

def bar(t=START,o=10,c=10.1,h=10.11,l=9.99,v=20000):return dict(t=t,o=o,c=c,h=h,l=l,v=v)

class SessionSetupTests(unittest.TestCase):
    def test_closed_opening_bar_can_be_observed_before_30_minutes(self):
        x=vector([bar()],REF)
        self.assertTrue(domain(x,10.1));self.assertEqual(x[13],5)
        self.assertIn('OPENING_IMPULSE',families(x))

    def test_volume_without_price_progress_or_with_rejection_is_not_setup(self):
        for b in [bar(c=10,h=10.1,v=1000000),bar(c=9.9,h=10.6,l=9.8,v=1000000),bar(c=10.1,h=11,v=1000000)]:
            self.assertEqual(families(vector([b],REF)),[])

    def test_missing_open_or_gap_cannot_invent_opening_context(self):
        self.assertIsNone(vector([bar(t=START+300)],REF))
        self.assertIsNone(vector([bar(),bar(t=START+600)],REF))

    def test_future_bars_cannot_change_frozen_prefix_features(self):
        prefix=[bar()];before=vector(prefix,REF)
        allbars=prefix+[bar(t=START+300,o=100,c=110,h=120,l=90)]
        self.assertEqual(before,vector(allbars[:1],REF))

    def test_next_full_5m_entry_and_same_bar_stop_priority(self):
        decision=START+300;future=[bar(t=decision+300,o=20,c=20,h=21,l=19)]
        x=outcome(future,decision,START+23400)
        self.assertEqual(x['entryPrice'],20);self.assertEqual(x['label'],'STOP_FIRST')
        self.assertTrue(x['ambiguous']);self.assertAlmostEqual(x['grossReturnPct'],-2)
        self.assertIsNone(outcome([bar(t=decision)],decision,START+23400))

    def test_stop_gap_uses_worse_open(self):
        decision=START+300
        future=[bar(t=decision+300,o=10,c=10,h=10.1,l=9.9),bar(t=decision+600,o=9,c=9,h=9.1,l=8.9)]
        self.assertAlmostEqual(outcome(future,decision,START+23400)['grossReturnPct'],-10)

    def test_unresolved_gap_stays_unknown_and_early_resolved_target_is_known(self):
        decision=START+300
        self.assertIsNone(outcome([bar(t=decision+300),bar(t=decision+900)],decision,START+23400))
        x=outcome([bar(t=decision+300,h=10.4)],decision,START+23400)
        self.assertEqual(x['label'],'TARGET_FIRST')

    def test_full_30m_timeout_and_invalid_ohlc(self):
        decision=START+300;future=[bar(t=decision+300+i*300) for i in range(6)]
        self.assertEqual(outcome(future,decision,START+23400)['label'],'TIMEOUT')
        future[0]['h']=9;self.assertIsNone(outcome(future,decision,START+23400))

    def test_live_requires_actual_complete_minutes_and_prior_baseline(self):
        pts=[(START+i*60,10.02*(1+i*.001),4000,10,10.11,9.99) for i in range(5)]
        pts[-1]=(START+240,10.1,4000,10,10.11,9.99)
        x=observe('TEST',pts,'regular',{'symbols':{'TEST':REF}},None,START+305)
        self.assertEqual(x['status'],'RESEARCH_SETUP');self.assertFalse(x['tradeEligible'])
        self.assertEqual(observe('TEST',pts[:-1],'regular',{'symbols':{'TEST':REF}},None,START+305)['status'],'UNAVAILABLE')
        self.assertEqual(observe('TEST',pts,'regular',{'symbols':{'TEST':{**REF,'asOfDate':'2026-09-14'}}},None,START+305)['status'],'UNAVAILABLE')

    def test_return_model_is_not_a_sigmoid_probability(self):
        self.assertEqual(predict_net({'intercept':-.2,'trees':[[{'leaf':True,'value':-.5}]]},[]),-.7)

if __name__=='__main__':unittest.main()
