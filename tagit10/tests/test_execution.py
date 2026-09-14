import copy, io, json, os, sys, unittest, urllib.error
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from execution import *
from quality import merge_evidence

NOW=1789414210
def row():return {'symbol':'TEST','sessionDateET':'2026-09-14','session':'regular','instrumentType':'EQUITY',
    'price':10,'breakout15m':10.01,'support15m':9.9,'barCloseTimestampUTC':iso(NOW-10),
    'barClosed':True,'quoteFresh':True,'screeningPassed':True,'riskBlocks':[],
    '_points':[(NOW-10-900+i*60,10,10000,10,10.01,9.9) for i in range(15)]}
def quote(bid=10,ask=10.01):return {'source':'Alpaca','feed':'iex','timestampUTC':iso(NOW),
    'bid':bid,'ask':ask,'bidSize':10,'askSize':10}

class ExecutionTests(unittest.TestCase):
    def test_both_connector_and_rest_quote_formats(self):
        a=normalize_quote({'latestQuote':{'t':iso(NOW),'bp':10,'ap':10.01,'bs':10,'as':10}},'iex')
        b=normalize_quote({'latest_quote':{'timestamp':iso(NOW),'bid_price':10,'ask_price':10.01,'bid_size':10,'ask_size':10}},'iex')
        self.assertEqual(a,b);self.assertEqual(quote_checks(a,NOW),[])

    def test_stale_future_crossed_zero_size_and_wide_quotes_fail(self):
        for change in [{'timestampUTC':iso(NOW-16)},{'timestampUTC':iso(NOW+1)},{'bid':11},{'askSize':0},{'ask':10.1},{'bid':float('nan')},{'feed':'delayed_sip'}]:
            self.assertTrue(quote_checks({**quote(),**change},NOW),change)

    def test_unknown_quote_is_not_permission(self):
        p=assess(make_plan(row(),NOW),row(),None,NOW)
        self.assertEqual(p['status'],'BLOCKED');self.assertFalse(p['paperTriggerObserved']);self.assertFalse(p['tradeEligible'])

    def test_no_credentials_makes_no_network_request(self):
        with patch.dict(os.environ,{},clear=True),patch('execution.urllib.request.urlopen') as request:
            quotes,h=fetch_quotes(['TEST'])
        request.assert_not_called();self.assertEqual(h['status'],'RUNTIME_CREDENTIALS_NOT_CONFIGURED');self.assertEqual(quotes,{})

    def test_provider_denial_does_not_leak_credentials_or_change_feed(self):
        env={'ALPACA_API_KEY_ID':'TEST_KEY','ALPACA_API_SECRET_KEY':'TEST_SECRET','TAGIT_ALPACA_FEED':'sip'}
        error=urllib.error.HTTPError('https://data.alpaca.markets',403,'denied',{},io.BytesIO(b'TEST_SECRET'))
        with patch.dict(os.environ,env,clear=True),patch('execution.urllib.request.urlopen',side_effect=error) as request:
            q,h=fetch_quotes(['TEST'])
        self.assertEqual(request.call_count,1);self.assertEqual(h['feed'],'sip');self.assertEqual(h['status'],'AUTH_OR_ENTITLEMENT_DENIED')
        self.assertNotIn('TEST_SECRET',json.dumps(h));self.assertNotIn('TEST_KEY',json.dumps(h))

    def test_plan_requires_actual_fresh_regular_session_structure(self):
        for change in [{'riskBlocks':['FALLING_PRICE']},{'session':'after-hours'},{'barClosed':False},
                       {'barCloseTimestampUTC':iso(NOW-61)},{'_points':[]},{'screeningPassed':'true'}]:
            self.assertIsNone(make_plan({**row(),**change},NOW))

    def test_two_writers_share_levels_from_same_closed_anchor(self):
        first=row();later=row();later['barCloseTimestampUTC']=iso(NOW+110)
        later['_points']+= [(NOW-10+i*60,10.1,10000,10.1,10.2,10.05) for i in range(2)]
        a=make_plan(first,NOW);b=make_plan(later,NOW+120)
        self.assertEqual(a['id'],b['id'])
        self.assertEqual(a['entryTrigger'],b['entryTrigger']);self.assertEqual(a['stopReference'],b['stopReference'])

    def test_two_R_is_after_cost_at_maximum_entry_not_just_trigger(self):
        p=make_plan(row(),NOW);entry=p['entryLimit']*1.002;stop=p['stopReference']*.998;target=p['targetScenario']*.998
        self.assertGreaterEqual((target-entry)/(entry-stop),2)
        self.assertLess((target-entry)/(entry-stop),2.001)

    def test_crossing_is_paper_observation_not_live_permission(self):
        p=make_plan(row(),NOW);q=quote(p['entryTrigger']-.005,p['entryTrigger'])
        out=assess(p,row(),q,NOW)
        self.assertTrue(out['paperTriggerObserved']);self.assertFalse(out['tradeEligible'])
        self.assertIn('SINGLE_EXCHANGE_QUOTE',out['liveApprovalBlocks'])

    def test_no_chasing_or_resetting_invalidated_plan(self):
        p=make_plan(row(),NOW);out=assess(p,row(),quote(p['entryLimit']+.01,p['entryLimit']+.02),NOW)
        self.assertIn('ENTRY_ALREADY_EXTENDED',out['blocks'])
        retry=assess(out,row(),quote(p['entryTrigger']-.005,p['entryTrigger']),NOW)
        self.assertIn('PLAN_INVALIDATED',retry['blocks']);self.assertFalse(retry['paperTriggerObserved'])

    def test_expiry_and_stop_failure(self):
        p=make_plan(row(),NOW)
        self.assertIn('PLAN_EXPIRED',assess(p,row(),quote(),NOW+300)['blocks'])
        self.assertIn('STOP_ALREADY_BREACHED',assess(p,row(),quote(9.88,9.89),NOW)['blocks'])

    def test_missing_quotes_cannot_erase_a_known_stop_breach(self):
        p=make_plan(row(),NOW)
        changed={**row(),'price':9.8,'screeningPassed':False,'riskBlocks':['FALLING_PRICE']}
        failed=assess(p,changed,None,NOW)
        self.assertIn('STOP_ALREADY_BREACHED',failed['blocks'])
        self.assertIn('PLAN_INVALIDATED',assess(failed,row(),quote(),NOW+1)['blocks'])

    def test_levels_and_observation_are_frozen_across_refresh_and_state_merge(self):
        state={};r=row();p=make_plan(r,NOW);q=quote(p['entryTrigger']-.005,p['entryTrigger'])
        attach_plans(state,[r],{'TEST':q},NOW);snapshot=copy.deepcopy(state['conditionalPlanObservations'])
        changed={**row(),'breakout15m':10.1,'support15m':9.8};attach_plans(state,[changed],{'TEST':q},NOW+1)
        self.assertEqual(changed['conditionalPlan']['entryTrigger'],p['entryTrigger'])
        self.assertEqual(state['conditionalPlanObservations'],snapshot)
        merged=merge_evidence(state,{'sessionDateET':'2026-09-15'})
        self.assertEqual(merged['conditionalPlanObservations'],snapshot)

if __name__=='__main__':unittest.main()
