import unittest
from dataclasses import replace
from research.events import Event,Universe,replay,time
from research.execution import Policy,simulate
from research.metrics import summarize,bonferroni,portfolio_drawdown
from research.splits import validate_windows,purge,claim_blockers

def ts(s):return f'2026-01-05T14:30:{s:02d}+00:00'

def quote(s,bid=10,ask=10.01,**kw):
    return dict(event_at=ts(s),available_at=ts(s),sequence=s,bid=bid,ask=ask,
                bid_size=100,ask_size=100,lagged_volume=10000,
                volume_end_at=ts(0),volume_available_at=ts(0),**kw)

SETUP=dict(id='synthetic',symbol='TEST',at=ts(0),expires_at=ts(10),quantity=10,
           stop=9,entry=10,max_entry=10.1,target=11)
COVERAGE=dict(complete=True,start=ts(0),end=ts(59))
POLICY=Policy(horizon_seconds=20)


class PhaseOne(unittest.TestCase):
    def test_clock_never_exposes_future_or_delayed_event(self):
        events=[Event(time(ts(0)),time(ts(31)),0,'QUOTE','ID',{'value':1})]
        seen=[]
        scans=replay(events,ts(0),ts(59),seen.append,lambda t:len(seen))
        self.assertEqual(scans,[0,0])
        # Replacing future data cannot change past decisions.
        changed=[replace(events[0],payload={'value':999999})]
        seen=[]
        self.assertEqual(replay(changed,ts(0),ts(59),seen.append,lambda t:len(seen)),scans)

    def test_tick_tie_and_sequence(self):
        events=[Event(time(ts(0)),time(ts(30)),n,'QUOTE','ID',{}) for n in (2,1)]
        seen=[]
        self.assertEqual(replay(events,ts(0),ts(59),lambda e:seen.append(e.sequence),lambda t:list(seen)),[[],[1,2]])
        with self.assertRaises(ValueError):replay(events+events,ts(0),ts(59),lambda e:None,lambda t:None)

    def test_incomplete_bar_rejected(self):
        with self.assertRaises(ValueError):Event(time(ts(0)),time(ts(59)),0,'BAR','ID',{})
        with self.assertRaises(ValueError):time('2026-01-05')

    def test_pit_delisting_and_publication(self):
        row=dict(instrument_id='ID',source='synthetic',effective_at=ts(0),published_at=ts(0),
                 available_at=ts(10),exchange='NASDAQ',listing_status='LISTED',
                 shares_outstanding=1000000,share_basis='COMPANY_TOTAL_ON_PRICE_BASIS')
        u=Universe([row,{**row,'effective_at':ts(40),'available_at':ts(40),'listing_status':'DELISTED'}])
        self.assertEqual(u.at('ID',ts(9),10)['status'],'UNKNOWN_METADATA')
        self.assertEqual(u.at('ID',ts(20),10)['status'],'ELIGIBLE')
        self.assertEqual(u.at('ID',ts(40),10)['status'],'OUTSIDE_LISTING')
        self.assertEqual(u.at('ID',ts(20),100)['status'],'OUTSIDE_CAP')

    def run_quotes(self,quotes,**kw):
        return simulate(SETUP,quotes,kw.get('policy',POLICY),kw.get('coverage',COVERAGE))

    def test_latency_stop_cannot_rebound_into_entry(self):
        result=self.run_quotes([quote(0,8.9,9),quote(1),quote(2,12,12.01)])
        self.assertEqual(result['status'],'INVALIDATED_BEFORE_ENTRY')

    def test_target_uses_bid_and_pays_spread_impact_fees(self):
        r=self.run_quotes([quote(1),quote(2,10.99,11.01),quote(3,11,11.01)])
        self.assertEqual((r['status'],r['exit_at']),('TARGET',ts(3)))
        self.assertGreater(r['entry_price'],10.01);self.assertLess(r['exit_price'],11)
        self.assertLess(r['net_pct'],(11/10.01-1)*100)
        only_entry=self.run_quotes([quote(1)])
        self.assertEqual(only_entry['mfe_pct'],0)
        self.assertLess(only_entry['mae_pct'],0)

    def test_cost_sensitivity_fixed_entry(self):
        rows=[quote(1),quote(2,11,11.01)]
        low=self.run_quotes(rows,policy=replace(POLICY,fee_bps_per_side=0,impact_bps_at_full_participation=0))
        high=self.run_quotes(rows,policy=replace(POLICY,fee_bps_per_side=5,impact_bps_at_full_participation=40))
        self.assertLess(high['net_pct'],low['net_pct'])

    def test_stop_latches_when_displayed_size_insufficient(self):
        q=quote(2,8.9,9);q['bid_size']=1
        r=self.run_quotes([quote(1),q,quote(3,11,11.01)])
        self.assertEqual(r['status'],'STOP')

    def test_timeout_precedes_late_target(self):
        r=self.run_quotes([quote(1),quote(21,12,12.01)])
        self.assertEqual(r['status'],'TIMEOUT')
        self.assertEqual(self.run_quotes([quote(1),quote(25,12,12.01)])['status'],'UNKNOWN_EXIT')

    def test_incomplete_coverage_never_resolves_return(self):
        for coverage in (None,{**COVERAGE,'complete':False},{**COVERAGE,'gaps':['missing-page']},
                         {**COVERAGE,'truncated':True}):
            r=self.run_quotes([quote(1),quote(2,11,11.01)],coverage=coverage)
            self.assertEqual(r['status'],'UNKNOWN_COVERAGE');self.assertIsNone(r['net_pct'])

    def test_future_volume_cannot_enable_execution(self):
        for field in ('volume_available_at','volume_end_at'):
            q=quote(1);q[field]=ts(2)
            self.assertEqual(self.run_quotes([q])['status'],'NO_ENTRY')

    def test_stale_crossed_and_duplicate_quotes(self):
        q=quote(1);q['available_at']=ts(5)
        self.assertEqual(self.run_quotes([q,quote(6,10.2,10)])['status'],'NO_ENTRY')
        with self.assertRaises(ValueError):self.run_quotes([quote(1),quote(1)])

    def test_missing_results_never_become_zero_or_portfolio_drawdown(self):
        rows=[dict(status='TARGET',session='2026-01-05',at=ts(1),net_pct=10),
              dict(status='STOP',session='2026-01-06',at=ts(1),net_pct=-2),
              dict(status='UNKNOWN_EXIT',session='2026-01-06',at=ts(1),net_pct=None)]
        s=summarize(rows,iterations=200)
        self.assertEqual((s['signals'],s['evaluable'],s['unevaluable']),(3,2,1))
        self.assertEqual(s['resolved_expectancy_pct'],4)
        self.assertIsNone(s['all_signal_expectancy_pct']);self.assertIsNone(s['portfolio_max_drawdown_pct'])
        self.assertEqual(s,summarize(rows,iterations=200))
        self.assertAlmostEqual(portfolio_drawdown([100,120,90,110]),-25)

    def test_family_includes_failed_configurations(self):
        self.assertEqual(bonferroni([.01,None,.4],10),[.1,None,1])
        with self.assertRaises(ValueError):bonferroni([.01,.1],1)

    def test_split_purging_and_claim_fail_closed(self):
        w=dict(train_start=ts(0),train_end=ts(10),validation_start=ts(10),validation_end=ts(30))
        self.assertTrue(validate_windows([w]))
        with self.assertRaises(ValueError):validate_windows([w,w])
        self.assertEqual(purge([dict(at=ts(5),label_end=ts(10))],ts(0),ts(10)),[])
        self.assertIn('holdout_below_500',claim_blockers({}))
        self.assertIn('positive_ci_not_established',claim_blockers({'ci95':[float('nan'),1]}))
        self.assertIn('positive_ci_not_established',claim_blockers({'ci95':[1,float('inf')]}))


if __name__=='__main__':unittest.main()
