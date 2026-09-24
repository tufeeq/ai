import unittest
from research.share_capacity import lagged_volume, snapshot, capacity


class ShareCapacity(unittest.TestCase):
    at='2026-09-24T14:00:01Z'

    def quote(self, **kw):
        return dict(timestamp=self.at,bid_price=9.99,ask_price=10,bid_size=100,ask_size=200,**kw)

    def snap(self, quotes=None, bars=None, intervals=None):
        return snapshot(quotes if quotes is not None else [self.quote()],
                        bars if bars is not None else [dict(timestamp='2026-09-24T13:59:00Z',volume=10000)],
                        self.at,intervals if intervals is not None else [('2026-09-24T14:00:00Z','2026-09-24T14:01:00Z')],
                        '2026-09-24T14:00:00Z')

    def test_uncompleted_and_future_volume_never_changes_result(self):
        bars=[dict(timestamp='2026-09-24T13:59:00Z',volume=500)]
        future=[dict(timestamp='2026-09-24T14:00:00Z',volume=9999999),
                dict(timestamp='2026-09-24T14:01:00Z',volume=9999999)]
        self.assertEqual(self.snap(bars=bars),self.snap(bars=bars+future))
        self.assertEqual(capacity(self.snap(bars=bars+future),100,'ask')['status'],'FAIL')

    def test_latest_missing_invalid_or_stale_volume_is_unknown(self):
        for bars in ([],[dict(timestamp='2026-09-24T13:57:00Z',volume=10000)],
                     [dict(timestamp='2026-09-24T13:59:00Z',volume=float('nan'))],
                     [dict(timestamp='2026-09-24T13:58:00Z',volume=10000),dict(timestamp='2026-09-24T13:59:00Z',volume=None)]):
            with self.subTest(bars=bars):self.assertEqual(capacity(self.snap(bars=bars),1,'ask')['status'],'UNKNOWN')

    def test_duplicate_bar_cannot_supply_volume(self):
        bar=dict(timestamp='2026-09-24T13:59:00Z',volume=10000)
        self.assertIsNone(lagged_volume([bar,bar],self.at)['volume'])

    def test_same_timestamp_lower_bound_and_no_summing(self):
        q=self.quote();small={**q,'ask_size':10}
        s=self.snap(quotes=[q,q,small])
        self.assertEqual(s['ask_shares_range'],[10,200])
        self.assertEqual(capacity(s,50,'ask')['status'],'FAIL')

    def test_invalid_same_time_record_is_not_silently_discarded(self):
        q=self.quote();s=self.snap(quotes=[q,{**q,'ask_size':None}])
        self.assertEqual(capacity(s,1,'ask')['status'],'UNKNOWN')

    def test_gap_and_capped_boundary_cannot_qualify(self):
        self.assertEqual(self.snap(intervals=[(self.at,'2026-09-24T14:01:00Z')])['status'],'UNKNOWN_RETRIEVAL_GAP')
        self.assertEqual(self.snap(intervals=[('2026-09-24T14:00:00Z',self.at)])['status'],'UNKNOWN_RETRIEVAL_GAP')

    def test_missing_exit_and_missing_quote_are_unknown(self):
        self.assertEqual(snapshot([],[],None,[],self.at)['status'],'UNKNOWN_EXIT_PRICE')
        self.assertEqual(self.snap(quotes=[])['status'],'UNKNOWN_QUOTE_OBSERVATION')

    def test_displayed_size_and_volume_cap_are_distinct(self):
        s=self.snap()
        self.assertEqual(capacity(s,100,'ask')['status'],'PASS_SNAPSHOT_ONLY')
        self.assertEqual(capacity(s,101,'ask')['reasons'],['ABOVE_LAGGED_VOLUME_CAP'])
        self.assertEqual(capacity(s,201,'ask')['reasons'],['INSUFFICIENT_DISPLAYED_SHARES','ABOVE_LAGGED_VOLUME_CAP'])

    def test_known_size_failure_retains_unknown_volume(self):
        r=capacity(self.snap(bars=[]),201,'ask')
        self.assertEqual(r['status'],'FAIL')
        self.assertIn('UNKNOWN_LAGGED_VOLUME',r['reasons'])

    def test_quantity_cannot_be_fractional_or_nonpositive(self):
        for q in (0,-1,True,1.5):
            with self.subTest(q=q),self.assertRaises(ValueError):capacity(self.snap(),q,'ask')


if __name__=='__main__':unittest.main()
