import datetime as dt
import json
import unittest
from unittest import mock

import enrich


class FilingFlags(unittest.TestCase):
    def test_offering_listing_and_late_filing_flags_keep_the_most_recent_of_each_kind(self):
        today = dt.date(2026, 9, 25)
        filings = [
            {'form': '424B4', 'date': '2026-09-20', 'items': None},
            {'form': '8-K', 'date': '2026-09-10', 'items': '3.01,9.01'},
            {'form': 'S-1', 'date': '2026-07-01', 'items': None},
            {'form': 'NT 10-Q', 'date': '2026-08-15', 'items': None},
            {'form': '8-K', 'date': '2026-06-01', 'items': '5.03'},
            {'form': '4', 'date': '2026-09-24', 'items': None},
        ]
        flags = enrich.filing_flags(filings, today)
        kinds = {f['kind']: f for f in flags}
        self.assertEqual(set(kinds), {'OFFERING', 'LISTING_NOTICE', 'LATE_FILING', 'CHARTER_AMENDMENT'})
        self.assertEqual(kinds['OFFERING']['form'], '424B4')
        self.assertTrue(kinds['OFFERING']['recent'])
        self.assertTrue(kinds['LISTING_NOTICE']['recent'])
        self.assertFalse(kinds['LATE_FILING']['recent'])

    def test_ordinary_filings_raise_no_flags(self):
        self.assertEqual(enrich.filing_flags([{'form': '10-Q', 'date': '2026-09-01', 'items': None}], dt.date(2026, 9, 25)), [])


class Halts(unittest.TestCase):
    RSS = b'''<?xml version="1.0"?><rss xmlns:ndaq="http://www.nasdaqtrader.com/"><channel>
      <item><ndaq:IssueSymbol>AAA</ndaq:IssueSymbol><ndaq:HaltDate>09/25/2026</ndaq:HaltDate><ndaq:HaltTime>10:01:02</ndaq:HaltTime>
        <ndaq:ReasonCode>LUDP</ndaq:ReasonCode><ndaq:ResumptionTradeTime></ndaq:ResumptionTradeTime></item>
      <item><ndaq:IssueSymbol>BBB</ndaq:IssueSymbol><ndaq:ReasonCode>T1</ndaq:ReasonCode><ndaq:ResumptionTradeTime>10:30:00</ndaq:ResumptionTradeTime></item>
      <item><ndaq:IssueSymbol>ZZZ</ndaq:IssueSymbol><ndaq:ReasonCode>T1</ndaq:ReasonCode></item>
    </channel></rss>'''

    def test_only_unresumed_halts_for_universe_symbols(self):
        with mock.patch.object(enrich, 'fetch', return_value=self.RSS):
            halts = enrich.current_halts({'AAA', 'BBB'})
        self.assertEqual(list(halts), ['AAA'])
        self.assertEqual(halts['AAA']['reason_code'], 'LUDP')


class Directory(unittest.TestCase):
    TXT = (b'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\n'
           b'AAA|Alpha Inc - Common Stock|S|N|D|100|N|N\n'
           b'TEST|Test Issue|S|Y|N|100|N|N\n'
           b'ETFX|Some ETF|G|N|N|100|Y|N\n'
           b'File Creation Time: 0925202612:00|||||||\n')

    def test_skips_test_issues_and_etfs_and_decodes_status(self):
        with mock.patch.object(enrich, 'fetch', return_value=self.TXT):
            listing, file_time = enrich.nasdaq_directory()
        self.assertEqual(list(listing), ['AAA'])
        self.assertEqual(listing['AAA']['status'], 'DEFICIENT')
        self.assertEqual(listing['AAA']['tier'], 'CAPITAL_MARKET')
        self.assertEqual(file_time, '0925202612:00')


class Finra(unittest.TestCase):
    def test_uses_newest_partition_and_filters_by_equal_settlement(self):
        calls = []
        def fake(url, headers=None, data=None, **k):
            calls.append((url, data))
            if 'partitions' in url:
                return json.dumps({'availablePartitions': [{'partitions': ['2026-08-31']}, {'partitions': ['2026-09-15']}]}).encode()
            return json.dumps([
                {'symbolCode': 'AAA', 'settlementDate': '2026-09-15', 'currentShortPositionQuantity': 300,
                 'previousShortPositionQuantity': 200, 'averageDailyVolumeQuantity': 100},
                {'symbolCode': 'ZZZ', 'settlementDate': '2026-09-15', 'currentShortPositionQuantity': 1},
            ]).encode()
        with mock.patch.object(enrich, 'fetch', side_effect=fake):
            out, settlement = enrich.finra_short_interest({'AAA'})
        self.assertEqual(settlement, '2026-09-15')
        self.assertEqual(calls[1][1]['compareFilters'][0]['fieldValue'], '2026-09-15')
        self.assertNotIn('sortFields', calls[1][1])
        self.assertEqual(list(out), ['AAA'])
        self.assertAlmostEqual(out['AAA']['days_to_cover'], 3.0)
        self.assertAlmostEqual(out['AAA']['change_pct'], 50.0)


if __name__ == '__main__':
    unittest.main()
