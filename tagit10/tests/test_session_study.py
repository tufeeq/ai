import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
try:
    from study_session_signals import select, summarize
except ImportError:
    select=summarize=None

@unittest.skipIf(select is None,'Training dependencies are optional in runtime CI')
class StudyIntegrityTests(unittest.TestCase):
    def row(self,symbol,t,outcome=None):
        return {'symbol':symbol,'date':'2026-09-11','decisionAt':t,'families':['OPENING_IMPULSE'],
            'volumeBaseline':True,'outcome':outcome,'largeOutcomes':{'10':None,'20':None}}

    def test_capacity_is_temporal_and_unknowns_cannot_be_removed(self):
        rows=[self.row('A',1),self.row('B',2),self.row('C',3)]
        chosen=select(rows,[1,2,99],0,cap=2)
        self.assertEqual([r['symbol'] for r in chosen],['A','B'])
        self.assertEqual(summarize(chosen,['2026-09-11'])['unscorable'],2)

    def test_repeated_ticker_cannot_take_multiple_slots(self):
        rows=[self.row('A',1),self.row('A',2),self.row('B',2)]
        self.assertEqual([r['symbol'] for r in select(rows,[1,9,1],0)],['A','B'])

    def test_missing_outcomes_cannot_inflate_target_precision(self):
        win={'label':'TARGET_FIRST','grossReturnPct':3}
        s=summarize([self.row('A',1,win),self.row('B',2)],['2026-09-11'])
        self.assertEqual(s['target3PrecisionAllAlertsPct'],50)
        self.assertEqual(s['meanNetPct'],2.6)
        self.assertEqual(s['unscorable'],1)

    def test_zero_alerts_does_not_claim_active_sessions(self):
        result=summarize([],['2026-09-10','2026-09-11'])
        self.assertEqual(result['sessionsWithAlerts'],0)
        self.assertEqual(result['evaluationSessions'],2)

if __name__=='__main__':unittest.main()
