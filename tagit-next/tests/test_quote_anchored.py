from datetime import timedelta
import unittest

from research.events import time
from research.execution import Policy
from research.quote_anchored import (anchored_setup, decision_quote, inverse_path,
                                     midpoint_spread_pct, simulate_anchored)


class QuoteAnchored(unittest.TestCase):
    at='2026-08-24T14:00:00Z'

    def quote(self,sec,bid=9.99,ask=10,bid_size=1000,ask_size=1000,volume=100000):
        stamp=(time(self.at)+timedelta(seconds=sec)).isoformat()
        return dict(sequence=sec,event_at=stamp,available_at=stamp,bid=bid,ask=ask,
                    bid_size=bid_size,ask_size=ask_size,lagged_volume=volume,
                    volume_available_at=self.at,volume_end_at=self.at)

    def setup(self):
        return dict(id='x',symbol='X',decision_at=self.at,decision_ask=10,
                    expires_at='2026-08-24T14:00:30Z',quantity=100,entry=9.95,
                    max_entry=10.05,stop=9.7,target=11)

    def test_decision_is_first_qualified_quote_not_future_best(self):
        rows=[self.quote(1,bid=9,ask=11),self.quote(2,bid=9.99,ask=10),self.quote(3,bid=9.8,ask=9.81)]
        self.assertEqual(decision_quote(rows,self.at,.8)['available_at'],rows[1]['available_at'])

    def test_spread_uses_midpoint(self):
        self.assertAlmostEqual(midpoint_spread_pct(self.quote(1,bid=9.9,ask=10.1)),2)

    def test_setup_ignores_old_future_entry_and_plan_levels(self):
        case=dict(id='x',symbol='X',entry=999,stop=.1,target=9999)
        p=dict(entry=dict(quantity_shares=100,window_seconds_after_decision=30,
                          minimum_impact_adjusted_ask_multiplier=.995,maximum_impact_adjusted_ask_multiplier=1.005),
               barriers=dict(stop_bid_multiplier_of_decision_ask=.97,target_bid_multiplier_of_decision_ask=1.1))
        s=anchored_setup(case,self.quote(0),p)
        self.assertEqual((s['entry'],s['max_entry'],s['stop'],s['target']),(9.95,10.05,9.7,11.0))

    def test_latency_prevents_same_instant_fill(self):
        rows=[self.quote(0),self.quote(2,bid=11.1,ask=11.2)]
        r=simulate_anchored(self.setup(),rows,Policy(latency_seconds=3),time(self.at)+timedelta(minutes=46),.8)
        self.assertEqual(r['status'],'NO_ENTRY')

    def test_stop_during_latency_invalidates(self):
        rows=[self.quote(0),self.quote(1,bid=9.6,ask=9.7),self.quote(4)]
        r=simulate_anchored(self.setup(),rows,Policy(latency_seconds=3),time(self.at)+timedelta(minutes=46),.8)
        self.assertEqual(r['status'],'INVALIDATED_BEFORE_ENTRY')

    def test_wide_spread_cannot_enter_but_can_invalidate(self):
        rows=[self.quote(1,bid=9.8,ask=10.1),self.quote(2,bid=9.6,ask=10.1)]
        r=simulate_anchored(self.setup(),rows,Policy(),time(self.at)+timedelta(minutes=46),.8)
        self.assertEqual(r['status'],'INVALIDATED_BEFORE_ENTRY')

    def test_displayed_shares_and_volume_cap_apply(self):
        for q in (self.quote(1,ask_size=99),self.quote(1,volume=9999)):
            with self.subTest(q=q):
                r=simulate_anchored(self.setup(),[q],Policy(),time(self.at)+timedelta(minutes=46),.8)
                self.assertEqual(r['status'],'NO_ENTRY')

    def test_missing_potential_volume_is_unknown_not_no_entry(self):
        q=self.quote(1,volume=None)
        r=simulate_anchored(self.setup(),[q],Policy(),time(self.at)+timedelta(minutes=46),.8)
        self.assertEqual(r['status'],'UNKNOWN_ENTRY_LIQUIDITY')

    def test_missing_volume_outside_band_is_not_decisive(self):
        q=self.quote(1,ask=12,volume=None)
        r=simulate_anchored(self.setup(),[q],Policy(),time(self.at)+timedelta(minutes=46),.8)
        self.assertEqual(r['status'],'NO_ENTRY')

    def test_bid_ask_costs_and_stress_reduce_return(self):
        rows=[self.quote(1),self.quote(2,bid=11.1,ask=11.11)]
        base=simulate_anchored(self.setup(),rows,Policy(),time(self.at)+timedelta(minutes=46),.8)
        stress=simulate_anchored(self.setup(),rows,Policy(fee_bps_per_side=2,impact_bps_at_full_participation=40),time(self.at)+timedelta(minutes=46),.8)
        self.assertEqual(base['status'],'TARGET');self.assertLess(stress['net_pct'],base['net_pct'])
        self.assertFalse(base['verified_fill'])

    def test_trigger_without_exit_capacity_stays_unknown(self):
        rows=[self.quote(1),self.quote(2,bid=11.1,ask=11.11,bid_size=99)]
        r=simulate_anchored(self.setup(),rows,Policy(),time(self.at)+timedelta(minutes=46),.8)
        self.assertEqual(r['status'],'UNKNOWN_EXIT_COVERAGE');self.assertEqual(r['trigger'],'TARGET')

    def test_incomplete_entry_window_is_unknown(self):
        r=simulate_anchored(self.setup(),[],Policy(),time(self.at)+timedelta(seconds=20),.8)
        self.assertEqual(r['status'],'UNKNOWN_ENTRY_COVERAGE')

    def test_inverse_diagnostic_is_not_a_fill(self):
        rows=[self.quote(1,bid=11.1,ask=11.11)]
        r=inverse_path(rows,self.setup(),time(self.at)+timedelta(minutes=46),3)
        self.assertEqual(r['status'],'TARGET_FIRST_INDICATION');self.assertNotIn('net_pct',r)

    def test_inverse_no_barrier_requires_fresh_timeout(self):
        r=inverse_path([self.quote(2700,bid=10,ask=10.01)],self.setup(),time(self.at)+timedelta(minutes=45,seconds=3),3)
        self.assertEqual(r['status'],'NO_BARRIER_FRESH_TIMEOUT')
        r=inverse_path([],self.setup(),time(self.at)+timedelta(minutes=45,seconds=3),3)
        self.assertEqual(r['status'],'UNKNOWN_PATH_OR_TIMEOUT')


if __name__=='__main__':unittest.main()
