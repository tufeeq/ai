import unittest
from research.quote_units import contract, normalize
from research.execution import simulate, Policy


class QuoteUnits(unittest.TestCase):
    at = '2026-09-24T14:00:01Z'

    def norm(self, bid=100, ask=200, at=None, **kw):
        return normalize(bid, ask, at or self.at, **({'provider':'alpaca','feed':'sip'} | kw))

    def test_shares_not_lots(self):
        q=self.norm()
        self.assertEqual((q['bid_size'],q['ask_size']),(100,200))
        self.assertEqual(q['basis']['multiplier'],1)

    def test_new_york_transition_day(self):
        self.assertEqual(self.norm(at='2025-11-03T04:59:59Z')['status'],'UNKNOWN_QUOTE_SIZE_UNIT')
        self.assertEqual(self.norm(at='2025-11-03T05:00:00Z')['status'],'SHARES')

    def test_other_feed_provider_and_older_dates_unknown(self):
        for kw in ({'feed':'iex'},{'feed':'delayed_sip'},{'provider':'other'}, {'at':'2025-10-31T14:00:00Z'}):
            with self.subTest(kw=kw):self.assertEqual(self.norm(**kw)['status'],'UNKNOWN_QUOTE_SIZE_UNIT')

    def test_invalid_sizes_cannot_become_liquidity(self):
        for bad in (None,True,-1,.5,float('nan'),float('inf'),'100'):
            for bid,ask in ((bad,100),(100,bad)):
                with self.subTest(bid=bid,ask=ask):
                    q=self.norm(bid,ask)
                    self.assertEqual(q['status'],'INVALID_QUOTE_SIZE')
                    self.assertIsNone(q['ask_size'])

    def test_zero_size_stays_zero(self):
        self.assertEqual(self.norm(0,0)['ask_size'],0)

    def test_quantity_above_displayed_shares_cannot_fill(self):
        setup=dict(id='s',symbol='TEST',at='2026-09-24T14:00:00Z',expires_at='2026-09-24T14:00:30Z',
                   quantity=101,entry=10,max_entry=10.01,stop=9.8,target=10.4)
        quotes=[]
        for sec,bid,ask in [('01',9.99,10),('02',10.41,10.42)]:
            stamp=f'2026-09-24T14:00:{sec}Z'
            q=self.norm(100,100,stamp)
            quotes.append(dict(sequence=int(sec),event_at=stamp,available_at=stamp,bid=bid,ask=ask,
                               bid_size=q['bid_size'],ask_size=q['ask_size'],lagged_volume=100000,
                               volume_available_at='2026-09-24T14:00:00Z',volume_end_at='2026-09-24T14:00:00Z'))
        coverage=dict(complete=True,start=setup['at'],end=setup['expires_at'])
        self.assertEqual(simulate(setup,quotes,Policy(),coverage)['status'],'NO_ENTRY')
        # Test would expose the old 100x unit inflation by manufacturing a TARGET.
        wrong=[{**q,'bid_size':10000,'ask_size':10000} for q in quotes]
        self.assertEqual(simulate(setup,wrong,Policy(),coverage)['status'],'TARGET')


if __name__=='__main__':unittest.main()
