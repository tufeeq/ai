"""Full supplied-universe history collector with pagination and provenance.

Universe MUST be frozen before the evaluation period. Does not select winners.
Uses protected process credentials; does not accept credentials on command line.
"""
import argparse
import json
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path
from engine import timestamp
from stream import credentials


def collect(metadata, start, end, feed='sip'):
    if timestamp(end) <= timestamp(start):
        raise ValueError('End must be later than start')
    if not metadata or any(timestamp(m['metadata_at']) > timestamp(start) for m in metadata):
        raise ValueError('Freeze the whole eligible universe BEFORE the evaluation starts')
    key, secret = credentials()
    bars = {}
    symbols = sorted({m['symbol'] for m in metadata})
    for offset in range(0, len(symbols), 50):
        token, seen = None, set()
        while True:
            query = dict(symbols=','.join(symbols[offset:offset+50]), timeframe='1Min',
                         start=start, end=end, feed=feed, sort='asc', limit=10000, adjustment='raw')
            if token:
                query['page_token'] = token
            req = Request('https://data.alpaca.markets/v2/stocks/bars?'+urlencode(query),
                          headers={'APCA-API-KEY-ID':key, 'APCA-API-SECRET-KEY':secret})
            for attempt in range(5):
                try:
                    with urlopen(req, timeout=30) as response:
                        page = json.load(response)
                    break
                except HTTPError as exc:
                    if exc.code != 429 or attempt == 4:
                        raise RuntimeError(f'Data provider HTTP {exc.code}; no fallback feed substituted') from None
                    time.sleep(min(2**attempt, 16))
            for symbol, rows in (page.get('bars') or {}).items():
                bars.setdefault(symbol, []).extend(dict(timestamp=b['t'], open=b['o'], high=b['h'],
                                                        low=b['l'], close=b['c'], volume=b['v'],
                                                        vwap=b.get('vw'), trade_count=b.get('n')) for b in rows)
            token = page.get('next_page_token')
            if not token:
                break
            if token in seen:
                raise RuntimeError('Repeated pagination token; refusing incomplete data')
            seen.add(token)
    return dict(source='Alpaca historical bars', feed=feed, start=start, end=end,
                selection='All symbols in the supplied pre-period universe; completeness requires reference-universe audit.',
                metadata_source='User-supplied frozen pre-period metadata', metadata=metadata, bars=bars,
                missing_symbols=sorted(set(symbols)-bars.keys()))


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--universe', required=True)
    p.add_argument('--start', required=True)
    p.add_argument('--end', required=True)
    p.add_argument('--output', required=True)
    a=p.parse_args()
    output=collect(json.loads(Path(a.universe).read_text()), a.start, a.end)
    Path(a.output).write_text(json.dumps(output)+'\n')
