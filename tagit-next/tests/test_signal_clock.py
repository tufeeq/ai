from datetime import timedelta
import unittest
from research.events import time
from research.execution import Policy
from research.signal_clock import prefix_end, prepare, setup_for, volume_at, volume_index, run_scenario


class SignalClock(unittest.TestCase):
    at='2026-09-01T14:00:00Z'

    def raw(self, sec=1, **kw):
        return dict(timestamp=(time(self.at)+timedelta(seconds=sec)).isoformat(),bid_price=9.99,ask_price=10,
                    bid_size=1000,ask_size=1000)|kw

    def setup(self):
        return dict(id='s',symbol='TEST',at=self.at,expires_at='2026-09-01T14:00:30Z',
                    quantity=100,entry=10,max_entry=10.01,stop=9.7,target=11)

    def rows(self, raw, bars=None, end='2026-09-01T15:01:00Z'):
        return prepare(raw,bars if bars is not None else [dict(timestamp='2026-09-01T13:59:00Z',volume=100000)],self.at,end)

    def test_prefix_stops_at_gap_not_last_quote(self):
        intervals=[(self.at,'2026-09-01T14:00:10Z'),('2026-09-01T14:00:11Z','2026-09-01T15:00:00Z')]
        self.assertEqual(prefix_end(intervals,self.at),time('2026-09-01T14:00:10Z'))

    def test_adjacent_and_overlapping_intervals_join(self):
        self.assertEqual(prefix_end([(self.at,'2026-09-01T14:00:10Z'),('2026-09-01T14:00:10Z','2026-09-01T14:00:30Z')],self.at),time('2026-09-01T14:00:30Z'))

    def test_capped_boundary_is_excluded(self):
        rows,end,_=self.rows([self.raw(1)],end='2026-09-01T14:00:01Z')
        self.assertEqual(rows,[])

    def test_conflicting_same_time_sizes_do_not_invent_order(self):
        rows,end,quality=self.rows([self.raw(1),self.raw(2),self.raw(2,ask_size=2000),self.raw(3)])
        self.assertEqual(len(rows),1)
        self.assertEqual(end,time(self.at)+timedelta(seconds=2))
        self.assertIsNotNone(quality['ambiguous_order_at'])

    def test_equivalent_boundary_duplicates_do_not_add_capacity(self):
        rows,_,quality=self.rows([self.raw(1),self.raw(1)])
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['ask_size'],1000)
        self.assertEqual(quality['same_time_equivalent_updates_removed'],1)

    def test_future_volume_cannot_change_prepared_rows(self):
        bars=[dict(timestamp='2026-09-01T13:59:00Z',volume=100000)]
        future=dict(timestamp='2026-09-01T14:00:00Z',volume=99999999)
        self.assertEqual(self.rows([self.raw(1)],bars),self.rows([self.raw(1)],bars+[future]))

    def test_volume_staleness_duplicates_and_zero_are_unknown(self):
        bar=dict(timestamp='2026-09-01T13:59:00Z',volume=100000)
        for bars,at in (([bar,bar],self.at),([bar],'2026-09-01T14:01:31Z'),([{**bar,'volume':0}],self.at)):
            with self.subTest(bars=bars):self.assertEqual(volume_at(volume_index(bars),at),(None,None))

    def test_future_entry_field_never_sets_levels(self):
        c=dict(id='s',symbol='TEST',signal_at=self.at,reference_price=10,entry=999)
        p=dict(entry_window_seconds=30,quantity=100,entry_cap_multiplier=1.001,stop_multiplier=.97,target_multiplier=1.10)
        self.assertEqual(setup_for(c,p),setup_for(c|dict(entry=.1),p))
        self.assertEqual(setup_for(c,p)['entry'],10)

    def test_missing_volume_is_not_no_entry(self):
        rows,end,_=self.rows([self.raw(1)],bars=[])
        self.assertEqual(run_scenario(self.setup(),rows,Policy(),end)['status'],'UNKNOWN_ENTRY_LIQUIDITY')

    def test_missing_earlier_volume_cannot_be_skipped_for_later_fill(self):
        raw=[self.raw(1),self.raw(2),self.raw(3,bid_price=11.1,ask_price=11.2)]
        rows,end,_=self.rows(raw);rows[0].update(lagged_volume=None,volume_available_at=None,volume_end_at=None)
        r=run_scenario(self.setup(),rows,Policy(),end)
        self.assertEqual(r['status'],'UNKNOWN_ENTRY_LIQUIDITY');self.assertIsNone(r['net_pct'])

    def test_unreachable_unknown_volume_does_not_hide_known_no_entry(self):
        rows,end,_=self.rows([self.raw(1,ask_price=12)],bars=[])
        self.assertEqual(run_scenario(self.setup(),rows,Policy(),end)['status'],'NO_ENTRY')

    def test_latency_changes_synthetic_entry_without_peeking(self):
        rows,end,_=self.rows([self.raw(1),self.raw(2,bid_price=11.1,ask_price=11.2)])
        self.assertEqual(run_scenario(self.setup(),rows,Policy(latency_seconds=1),end)['status'],'TARGET')
        self.assertEqual(run_scenario(self.setup(),rows,Policy(latency_seconds=3),end)['status'],'NO_ENTRY')

    def test_uncalibrated_costs_are_applied_not_omitted(self):
        rows,end,_=self.rows([self.raw(1),self.raw(2,bid_price=11.1,ask_price=11.2)])
        base=run_scenario(self.setup(),rows,Policy(),end)
        stress=run_scenario(self.setup(),rows,Policy(fee_bps_per_side=2,impact_bps_at_full_participation=40),end)
        self.assertLess(stress['net_pct'],base['net_pct']);self.assertFalse(stress['verified_fill'])


if __name__=='__main__':unittest.main()
