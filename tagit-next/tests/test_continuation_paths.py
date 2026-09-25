import unittest
from datetime import timedelta
from research.events import time
from research.continuation_paths import covered, price_path

START=time('2026-08-24T14:05:00Z')
END=START+timedelta(hours=1)
S=timedelta(seconds=1)
FULL=[(START,END+3*S)]


def q(seconds,bid=100,ask=100,**kw):
    return {'symbol':'TEST','timestamp':(START+seconds*S).isoformat(),
            'bid_price':bid,'ask_price':ask,'bid_size':1,'ask_size':1,**kw}


class CoverageTests(unittest.TestCase):
    def test_adjacent_and_overlap_cover_but_gap_does_not(self):
        self.assertTrue(covered([(START,START+5*S),(START+5*S,END)],START,END))
        self.assertTrue(covered([(START,START+5*S),(START+4*S,END)],START,END))
        self.assertFalse(covered([(START,START+5*S),(START+6*S,END)],START,END))

    def test_half_open_capped_boundary_is_unqualified(self):
        self.assertFalse(covered([(START,END)],START,END+timedelta(microseconds=1)))

    def test_bad_interval_rejected(self):
        with self.assertRaises(ValueError):covered([(END,START)],START,END)


class ObservedPathTests(unittest.TestCase):
    def run_path(self,rows,coverage=FULL):return price_path(rows,START,END,coverage)

    def test_bid_relative_to_ask_and_stop_not_resurrected(self):
        rows=[q(1,bid=99,ask=100),q(2,bid=97,ask=98),q(3,bid=115,ask=116)]
        r=self.run_path(rows)
        self.assertEqual(r['status'],'OBSERVED_STOP_FIRST')
        self.assertAlmostEqual(r['indicative_bid_return_pct'],-3)
        self.assertIsNone(r['executable_net_return_pct'])
        self.assertFalse(r['approved_for_live'])

    def test_ask_spike_alone_is_not_target(self):
        r=self.run_path([q(1),q(2,bid=101,ask=115)])
        self.assertEqual(r['status'],'UNKNOWN_TIMEOUT_PRICE')

    def test_same_time_opposite_barriers_ambiguous_not_input_order(self):
        a=q(2,bid=96,ask=100);b=q(2,bid=111,ask=112)
        for tail in [[a,b],[b,a]]:
            self.assertEqual(self.run_path([q(1)]+tail)['status'],'UNKNOWN_SAME_TIME_BARRIER_ORDER')

    def test_same_time_different_entry_asks_unknown(self):
        self.assertEqual(self.run_path([q(1),q(1,ask=101)])['status'],'UNKNOWN_SAME_TIME_ENTRY_ORDER')

    def test_data_gap_before_crossing_keeps_unknown(self):
        c=[(START,START+2*S),(START+3*S,END+3*S)]
        self.assertEqual(self.run_path([q(1),q(4,bid=111,ask=112)],c)['status'],'UNKNOWN_RETRIEVAL_GAP')

    def test_later_data_gap_does_not_erase_observed_early_stop(self):
        r=self.run_path([q(1),q(2,bid=96,ask=97)],[(START,START+3*S)])
        self.assertEqual(r['status'],'OBSERVED_STOP_FIRST')
        self.assertFalse(r['full_api_interval_covered'])

    def test_missing_fresh_timeout_and_post_deadline_target(self):
        self.assertEqual(self.run_path([q(1),q(3599,bid=101,ask=102)])['status'],'UNKNOWN_TIMEOUT_PRICE')
        self.assertEqual(self.run_path([q(1),q(3601,bid=111,ask=112)])['status'],'OBSERVED_TIMEOUT_PRICE')
        self.assertEqual(self.run_path([q(1),q(3604,bid=111,ask=112)])['status'],'UNKNOWN_TIMEOUT_PRICE')

    def test_no_entry_after_thirty_seconds_or_invalid_quote(self):
        r=self.run_path([q(1,bid_size=0),q(31)])
        self.assertEqual(r['status'],'NO_ENTRY_QUOTE_OBSERVED')
        self.assertEqual(r['invalid_quotes'],1)
        self.assertFalse(r['executable_fill_verified'])

    def test_boundary_duplicates_are_preserved_but_not_extra_states(self):
        r=self.run_path([q(1),q(1),q(2,bid=110,ask=111)])
        self.assertEqual(r['exact_duplicate_observations'],1)
        self.assertEqual(r['status'],'OBSERVED_TARGET_FIRST')

    def test_multiple_same_time_stop_prices_have_no_unique_return(self):
        r=self.run_path([q(1),q(2,bid=95,ask=99),q(2,bid=96,ask=99)])
        self.assertEqual(r['status'],'OBSERVED_STOP_FIRST')
        self.assertIsNone(r['indicative_bid_return_pct'])


if __name__=='__main__':unittest.main()
