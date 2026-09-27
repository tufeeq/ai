import unittest

from universe import build_rows, ticker


class UniverseTest(unittest.TestCase):
    def test_rows_match_the_quote_service_schema(self):
        rows = build_rows([
            {'symbol': 'ABCD', 'name': 'Abcd Therapeutics Inc. Common Stock', 'lastsale': '$2.41', 'pctchange': '5.1%',
             'volume': '120000', 'marketCap': '45000000.00', 'industry': 'Biotechnology: Pharmaceutical Preparations', 'sector': 'Health Care', 'country': 'United States'},
            {'symbol': 'ABCDW', 'name': 'Abcd Therapeutics Inc. Warrants', 'marketCap': '1000000'},
            {'symbol': 'SPAC', 'name': 'Spac Acquisition Corp Class A', 'marketCap': '60000000', 'industry': 'Blank Checks'},
            {'symbol': 'ZERO', 'name': 'Zero Inc', 'marketCap': ''},
            {'symbol': 'BRK/B', 'name': 'Berkshire Hathaway Inc. Class B', 'lastsale': '$480.10', 'marketCap': '1000000000000', 'industry': ''},
        ], {'ABCD': 18_000_000}, {'ABCD': 900_000}, '2026-09-27T12:00:00+00:00')
        by = {r['Ticker']: r for r in rows}
        self.assertEqual(sorted(by), ['ABCD', 'BRK-B', 'SPAC'])
        a = by['ABCD']
        self.assertEqual(a['Market Cap'], '45.00')  # USD millions, digits only (service regex)
        self.assertEqual(a['Short Float'], '5.00%')
        self.assertEqual(a['Outstanding'], '18.00')
        self.assertEqual(a['Float'], '')  # unknown, never guessed
        self.assertEqual(a['Price'], '2.41')
        self.assertEqual(by['SPAC']['Industry'], 'Shell Companies')  # excluded by the service
        self.assertEqual(by['BRK-B']['Industry'], 'Unclassified')
        self.assertEqual(by['BRK-B']['Price'], '480.1')

    def test_ticker_normalisation(self):
        self.assertEqual(ticker(' brk/a '), 'BRK-A')


if __name__ == '__main__':
    unittest.main()
