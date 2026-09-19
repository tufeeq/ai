import unittest
from execution_latency import exit_policy, run


def quote(at, bid=10., ask=10.01, size=100):
    return dict(timestamp=at, bid_price=bid, ask_price=ask, bid_size=size, ask_size=size)


class ExecutionLatencyTests(unittest.TestCase):
    def setUp(self):
        self.setup=dict(id='S:2026-08-25T14:00:00Z',symbol='S',at='2026-08-25T14:00:00Z',
                        expires_at='2026-08-25T14:02:00Z',entry=10.,max_entry=10.1,
                        stop=9.,target=12.,outcome='UNSCORABLE_GAP')
        self.window=dict(entry=dict(first_eligible=dict(at='2026-08-25T14:00:01Z',ask=10.)),
                         limit=10000, truncated=False, quotes=[])

    def test_late_quote_retains_actual_time_and_price(self):
        self.window['quotes']=[quote('2026-08-25T14:45:05Z',9.8,9.81)]
        self.assertEqual(exit_policy(self.window,self.setup,3)['outcome'],'UNKNOWN_TIMEOUT_QUOTE')
        r=exit_policy(self.window,self.setup,30)
        self.assertEqual(r['outcome'],'TIMEOUT_DELAYED_QUOTE')
        self.assertEqual(r['exit_delay_seconds'],4.)
        self.assertEqual(r['exit_bid'],9.8)
        self.assertLess(r['net_pct'],0)

    def test_exact_bound_is_allowed_but_later_quote_is_unknown(self):
        self.window['quotes']=[quote('2026-08-25T14:45:31Z')]
        self.assertEqual(exit_policy(self.window,self.setup,30)['exit_delay_seconds'],30.)
        self.window['quotes']=[quote('2026-08-25T14:45:31.001Z')]
        self.assertIsNone(exit_policy(self.window,self.setup,30)['net_pct'])

    def test_invalid_updates_do_not_resolve_exit(self):
        self.window['quotes']=[quote('2026-08-25T14:45:04Z',size=0),
                               quote('2026-08-25T14:45:08Z',bid=float('nan'))]
        self.assertIsNone(exit_policy(self.window,self.setup,30)['net_pct'])

    def test_predeadline_stop_cannot_be_replaced_by_later_rebound(self):
        self.window['quotes']=[quote('2026-08-25T14:10:00Z',8.5,8.51),
                               quote('2026-08-25T14:45:05Z',12.,12.01)]
        r=exit_policy(self.window,self.setup,30)
        self.assertEqual(r['outcome'],'STOP');self.assertEqual(r['exit_bid'],8.5)

    def test_capped_prefix_cannot_manufacture_timeout(self):
        self.window.update(truncated=True,quotes=[quote('2026-08-25T14:10:00Z')])
        self.assertEqual(exit_policy(self.window,self.setup,30)['outcome'],'UNKNOWN_TRUNCATED')

    def test_fresh_fallback_is_not_repriced_at_later_quote(self):
        self.window['quotes']=[quote('2026-08-25T14:45:00Z'),quote('2026-08-25T14:45:06Z',8.,8.01)]
        self.assertEqual(exit_policy(self.window,self.setup,30)['outcome'],'TIMEOUT_LAST_FRESH_QUOTE')
        self.assertEqual(exit_policy(self.window,self.setup,30)['exit_bid'],10.)

    def test_all_failed_inputs_remain_in_all_scenarios(self):
        protocol=dict(cases=[self.setup],entry_latency_seconds=[1,3],
                      exit_new_quote_allowance_seconds=[3,30],cost_per_side=.0025,scope='development')
        data=dict(market_requests=1,windows=[dict(id=self.setup['id'],error='provider',quotes=[])])
        r=run(protocol,data)
        self.assertEqual(len(r['scenarios']),4)
        for s in r['scenarios']:
            self.assertEqual(s['cases'],1);self.assertEqual(s['resolved'],0)
            self.assertEqual(s['outcomes'],{'PROVIDER_ERROR':1})
        data['windows']=[]
        with self.assertRaises(ValueError):run(protocol,data)

    def test_latency_changes_observation_without_reusing_early_quote(self):
        protocol=dict(cases=[self.setup],entry_latency_seconds=[1,3],
                      exit_new_quote_allowance_seconds=[3],cost_per_side=.0025,scope='development')
        data=dict(market_requests=1,windows=[dict(id=self.setup['id'],limit=10000,truncated=False,
                   quotes=[quote('2026-08-25T14:00:01Z'),quote('2026-08-25T14:45:02Z')])])
        r=run(protocol,data)
        self.assertEqual(r['scenarios'][0]['resolved'],1)
        self.assertEqual(r['scenarios'][1]['outcomes'],{'NO_ELIGIBLE_QUOTE_OBSERVED':1})
