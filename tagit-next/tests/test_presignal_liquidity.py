import unittest
from presignal_liquidity import features,run


def q(at,bid=10,ask=10.01,size=100):
    return dict(timestamp=at,bid_price=bid,ask_price=ask,bid_size=size,ask_size=size)


class PresignalLiquidityTests(unittest.TestCase):
    def case(self,id='X:2026-08-26T14:01:00Z'):
        return dict(id=id,symbol='X',signal_at='2026-08-26T14:01:00Z',expires_at='2026-08-26T14:03:00Z',
                    control_at='2026-08-26T13:51:00Z',known_candle_outcome='ENTRY_NOT_AVAILABLE',
                    known_candle_net_pct=None,entry=10,max_entry=10.1,stop=9,target=12)

    def test_window_is_strictly_before_event(self):
        rows=[q('2026-08-26T14:00:00Z'),q('2026-08-26T14:01:00Z')]
        self.assertEqual(features(rows,'2026-08-26T14:01:00Z')['valid_quotes'],1)

    def test_invalid_and_crossed_quotes_excluded(self):
        rows=[q('2026-08-26T14:00:10Z',size=0),q('2026-08-26T14:00:20Z',10,9),q('2026-08-26T14:00:30Z')]
        self.assertEqual(features(rows,'2026-08-26T14:01:00Z')['valid_quotes'],1)

    def test_nearest_rank_p90_and_terminal_age(self):
        rows=[q(f'2026-08-26T14:00:{s:02d}Z',10,10+v) for s,v in zip(range(1,11),[.01]*9+[1])]
        f=features(rows,'2026-08-26T14:01:00Z')
        self.assertLess(f['p90_spread_bps'],80);self.assertEqual(f['terminal_age_seconds'],50)
        self.assertFalse(f['liquidity_ready'])

    def test_ready_requires_count_spread_and_recent_terminal(self):
        rows=[q(f'2026-08-26T14:00:{s:02d}Z') for s in [50,55,57,58,59]]
        self.assertTrue(features(rows,'2026-08-26T14:01:00Z')['liquidity_ready'])

    def test_exact_frozen_case_accounting(self):
        c=self.case();p={'scope':'dev','selection':{'cases':[c]}}
        with self.assertRaises(ValueError):run(p,{'windows':[]})

    def test_missing_or_truncated_case_is_preserved_unknown(self):
        c=self.case();p={'scope':'dev','selection':{'cases':[c]}}
        raw={'protocol_commit':'a','market_requests':1,'quotes':0,'windows':[{'id':c['id'],'truncated':True,'quotes':[]}]}
        r=run(p,raw);self.assertEqual(r['results'][0]['pair_result'],'UNKNOWN');self.assertFalse(r['primary']['passed'])

    def test_primary_requires_six_of_eight_complete_pair_wins(self):
        cases=[];windows=[]
        for i in range(8):
            c=self.case(f'X{i}:2026-08-26T14:01:00Z');c['symbol']=f'X{i}';cases.append(c)
            control=[q(f'2026-08-26T13:50:{s:02d}Z',10,10.02) for s in [5,15,25,35,45,59]]
            signal=[q(f'2026-08-26T14:00:{s:02d}Z',10,10.01) for s in [5,15,25,35,45,55,58,59]]
            entry=[q('2026-08-26T14:01:01Z')]
            windows.append({'id':c['id'],'quotes':control+signal+entry,'truncated':False})
        p={'scope':'dev','selection':{'cases':cases}}
        raw={'protocol_commit':'a','market_requests':8,'quotes':120,'windows':windows}
        r=run(p,raw);self.assertEqual(r['primary']['wins'],8);self.assertTrue(r['primary']['passed'])

    def test_secondary_refuses_small_groups(self):
        c=self.case();p={'scope':'dev','selection':{'cases':[c]}}
        rows=[q(f'2026-08-26T14:00:{s:02d}Z') for s in [50,55,57,58,59]]+[q('2026-08-26T14:01:01Z')]
        raw={'protocol_commit':'a','market_requests':1,'quotes':6,'windows':[{'id':c['id'],'quotes':rows,'truncated':False}]}
        self.assertEqual(run(p,raw)['secondary']['decision'],'INSUFFICIENT_GROUP_SIZE')
