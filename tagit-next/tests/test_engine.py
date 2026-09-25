import copy
import unittest
from datetime import datetime, timedelta, timezone
from engine import Detector, Config, quote_check, simulate, timestamp


def fixture():
    start=datetime(2026,9,14,13,30,tzinfo=timezone.utc)
    metadata=[dict(symbol='TEST', market_cap=50e6, instrument_type='equity',metadata_at=start.isoformat())]
    bars=[]
    for i in range(23):
        bars.append(dict(timestamp=(start+timedelta(minutes=i)).isoformat(),open=1.,high=1.002,
                         low=.998,close=1.,volume=10000 if i<20 else 60000,vwap=1.))
    bars[-1].update(high=1.013,close=1.012,volume=80000)
    return metadata,bars


def detect(metadata=None, bars=None):
    m,b=fixture()
    engine=Detector(metadata or m)
    signals=[]
    for bar in bars or b:
        s=engine.on_bar('TEST',bar,(timestamp(bar['timestamp'])+timedelta(minutes=1)).isoformat())
        if s: signals.append(s)
    return engine,signals


class Causality(unittest.TestCase):
    def test_signal_after_complete_bar(self):
        m,b=fixture(); e=Detector(m)
        for bar in b[:-1]: e.on_bar('TEST',bar,(timestamp(bar['timestamp'])+timedelta(minutes=1)).isoformat())
        self.assertIsNone(e.on_bar('TEST',b[-1],b[-1]['timestamp']))
        self.assertEqual(e.decisions['TEST']['reason'],'INCOMPLETE_BAR')
        self.assertIsNotNone(e.on_bar('TEST',b[-1],(timestamp(b[-1]['timestamp'])+timedelta(minutes=1)).isoformat()))

    def test_no_large_caps(self):
        m,b=fixture(); m[0]['market_cap']=1e9
        e,s=detect(m,b)
        self.assertEqual(s,[])
        self.assertEqual(e.decisions['TEST']['reason'],'OUTSIDE_SMALL_CAP_UNIVERSE')

    def test_unknown_cap_rejected(self):
        m,b=fixture(); m[0]['market_cap']=None
        self.assertEqual(detect(m,b)[1],[])

    def test_future_metadata_rejected_live(self):
        m,b=fixture(); m[0]['metadata_at']='2026-09-15T00:00:00Z'
        self.assertEqual(detect(m,b)[1],[])

    def test_duplicate_no_vwap_inflation(self):
        e,s=detect(); old=list(e.vwap['TEST'])
        bar=fixture()[1][-1]
        e.on_bar('TEST',bar,s[0]['at'])
        self.assertEqual(e.vwap['TEST'],old)

    def test_gap_does_not_create_false_acceleration(self):
        m,b=fixture(); b[-1]['timestamp']=(timestamp(b[-1]['timestamp'])+timedelta(minutes=1)).isoformat()
        self.assertEqual(detect(m,b)[1],[])

    def test_daily_percentage_is_not_an_entry_gate(self):
        m,b=fixture(); m[0]['day_change_pct']=100
        self.assertEqual(len(detect(m,b)[1]),1)

    def test_prefix_invariance(self):
        m,b=fixture(); original=copy.deepcopy(detect(m,b)[1])
        extra=copy.deepcopy(b[-1]); extra['timestamp']=(timestamp(extra['timestamp'])+timedelta(minutes=1)).isoformat()
        extra.update(open=2.,high=2.1,low=1.9,close=2.)
        self.assertEqual(detect(m,b+[extra])[1][0],original[0])

    def test_risk_target_is_net_two_r_at_entry_cap(self):
        s=detect()[1][0]; cost=Config().cost_per_side
        entry=s['max_entry']*(1+cost)
        self.assertAlmostEqual(s['target']*(1-cost)-entry,2*(entry-s['stop']*(1-cost)))


class Execution(unittest.TestCase):
    def setUp(self):
        self.s=detect()[1][0]
        self.q=dict(timestamp=self.s['at'], feed='sip',bid=self.s['entry'],ask=self.s['entry']*1.001,bid_size=10,ask_size=10)

    def test_iex_not_consolidated(self):
        self.q['feed']='iex'
        self.assertEqual(quote_check(self.s,self.q,self.s['at']),'CONSOLIDATED_QUOTE_REQUIRED')

    def test_quote_freshness(self):
        self.assertEqual(quote_check(self.s,self.q,self.s['at']),'PAPER_EXECUTABLE')
        later=(timestamp(self.s['at'])+timedelta(seconds=4)).isoformat()
        self.assertEqual(quote_check(self.s,self.q,later),'STALE_QUOTE')

    def test_no_chasing(self):
        self.q.update(bid=self.s['max_entry']*1.01,ask=self.s['max_entry']*1.011)
        self.assertEqual(quote_check(self.s,self.q,self.s['at']),'OUTSIDE_ENTRY_RANGE')

    def test_next_bar_gap_not_filled(self):
        b=dict(timestamp=self.s['at'],open=self.s['max_entry']*1.01)
        self.assertEqual(simulate(self.s,[b])['outcome'],'ENTRY_NOT_AVAILABLE')

    def test_ambiguous_bar_not_winner(self):
        b=dict(timestamp=self.s['at'],open=self.s['entry'],low=self.s['stop']*.99,high=self.s['target']*1.01,close=self.s['entry'])
        r=simulate(self.s,[b])
        self.assertEqual(r['outcome'],'AMBIGUOUS_STOP_ASSUMED')
        self.assertLess(r['net_pct'],0)

    def test_missing_bars_not_interpolated(self):
        b=dict(timestamp=self.s['at'],open=self.s['entry'],low=self.s['entry'],high=self.s['entry'],close=self.s['entry'])
        c=dict(b,timestamp=(timestamp(self.s['at'])+timedelta(minutes=2)).isoformat())
        self.assertEqual(simulate(self.s,[b,c])['outcome'],'UNSCORABLE_GAP')

    def test_truncated_horizon_remains_unresolved(self):
        b=dict(timestamp=self.s['at'],open=self.s['entry'],low=self.s['entry'],high=self.s['entry'],close=self.s['entry'])
        self.assertEqual(simulate(self.s,[b])['outcome'],'UNRESOLVED')


if __name__=='__main__': unittest.main()
