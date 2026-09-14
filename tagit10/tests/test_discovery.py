import copy, sys, unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import engine
from discovery import close_age, state_of, order_key, coverage_health
from quality import freeze_signals, VERSION
from audit_live import build

class DiscoveryTests(unittest.TestCase):
    def test_clock_correction_does_not_extend_eligibility(self):
        row={'quoteTimestampUTC':'2026-09-14T14:00:00+00:00','barCloseTimestampUTC':'2026-09-14T14:01:00+00:00'}
        self.assertEqual(close_age(row,datetime(2026,9,14,14,2,tzinfo=timezone.utc).timestamp()),60)
        self.assertEqual(close_age(row,datetime(2026,9,14,14,2,1,tzinfo=timezone.utc).timestamp()),61)
        row['barCloseTimestampUTC']='2026-09-14T14:02:00+00:00'
        self.assertIsNone(close_age(row,0))

    def test_declining_high_activity_cannot_outrank_developing_price(self):
        up={'quoteFresh':True,'stage':'WATCH','riskBlocks':[],'score':20,'ret5mPct':.4,'ret15mPct':1}
        down={**up,'score':99,'ret5mPct':-1,'riskBlocks':['FALLING_PRICE']}
        self.assertEqual(state_of(down),'INVALIDATED')
        self.assertGreater(order_key(up),order_key(down))
        self.assertEqual(state_of({**up,'riskBlocks':['INCOMPLETE_WINDOWS']}),'UNAVAILABLE')

    def test_high_activity_does_not_monopolize_retained_slots(self):
        at=datetime(2026,9,14,15,tzinfo=timezone.utc)
        state={'symbols':{f'OLD{i}':{'lastStage':'WATCH','lastScore':99,'lastSeenUTC':at.isoformat()} for i in range(200)}}
        seen=set()
        with patch.object(engine,'now',return_value=at):
            for i in range(4):
                hot,_=engine.scan_lanes(state,[f'NEW{i}' for i in range(500)],[],True);seen.update(hot)
        self.assertEqual(len(seen),500)
        self.assertFalse(any(s.startswith('OLD') for s in seen))

    def test_pending_flood_preserves_new_discovery_and_rotates(self):
        state={'signalLedger':{str(i):{'symbol':f'P{i}','version':VERSION,'label':'PENDING'} for i in range(300)}}
        seen=set()
        for i in range(3):
            hot,_=engine.scan_lanes(state,[f'H{i}' for i in range(500)],[],True)
            self.assertEqual(sum(s.startswith('H') for s in hot),50)
            seen.update(s for s in hot if s.startswith('P'))
        self.assertEqual(len(seen),300)

    def test_missing_quotes_not_reported_as_full_coverage(self):
        at=datetime(2026,9,14,15,tzinfo=timezone.utc)
        state={'symbols':{'A':{'lastAttemptUTC':at.isoformat()}}}
        health=coverage_health(state,[],['A'],['A','B'],at.timestamp())
        self.assertEqual(health['unavailableThisScan'],1)
        self.assertEqual(health['successfulLast5m'],0)
        self.assertEqual(health['neverAttemptedToday'],1)
        self.assertIsNone(health['barCloseAgeMedianSeconds'])

    def test_indicator_snapshot_does_not_change_with_later_scan(self):
        state={'sessionDateET':'2026-09-14'}
        row={'symbol':'A','stage':'EARLY','quoteFresh':True,'screeningPassed':True,'barClosed':True,
            'quoteTimestampUTC':'2026-09-14T14:00:00+00:00','price':10,'score':42,'ret5mPct':1,'riskBlocks':[]}
        freeze_signals(state,[row],'2026-09-14T14:01:10+00:00')
        row['ret5mPct']=-3
        freeze_signals(state,[row],'2026-09-14T14:02:10+00:00')
        sig=next(iter(state['signalLedger'].values()))
        self.assertEqual(sig['indicatorEvidence']['ret5mPct'],1)
        self.assertIn('spread',sig['missingExecutionEvidence'])

    def test_audit_separates_versions_unknowns_and_duplicate_stages(self):
        base={'version':'10.3','symbol':'A','sessionDateET':'2026-09-14','session':'regular','score':70}
        rows=[{**base,'stage':'EARLY','signalAtUTC':'14:00','label':'TIMEOUT','netReturnPct':-.4},
            {**base,'stage':'CONFIRMED','signalAtUTC':'14:02','label':'TARGET_FIRST','netReturnPct':2.6},
            {**base,'symbol':'B','stage':'EARLY','signalAtUTC':'14:03','label':'UNSCORABLE'},
            {**base,'version':'10.2','stage':'EARLY','signalAtUTC':'14:04','label':'TARGET_FIRST'}]
        r=build({'signalLedger':dict(enumerate(rows))})['versions']['10.3']['firstAlertPerStockSession']
        self.assertEqual(r['alerts'],2);self.assertEqual(r['resolved'],1)
        self.assertEqual(r['meanNetReturnPct'],-.4);self.assertEqual(r['completeIndicatorSnapshots'],0)

if __name__=='__main__':unittest.main()
