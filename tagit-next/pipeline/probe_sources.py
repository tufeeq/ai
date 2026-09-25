"""Probe candidate free data sources from a GitHub Actions runner.

Prints one line per source with HTTP status, latency, size and the fields that
matter for TAGit NEXT, then a JSON summary. Read-only; never trades.
"""
import datetime as dt
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request

SYMBOLS = sys.argv[1:] or ['SENS', 'NUAI', 'BTCT']
SEC_UA = os.environ.get('SEC_USER_AGENT') or 'TAGit NEXT research tufeeq11@gmail.com'
BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
ALPACA = {
    'APCA-API-KEY-ID': os.environ.get('APCA_API_KEY_ID', ''),
    'APCA-API-SECRET-KEY': os.environ.get('APCA_API_SECRET_KEY', ''),
}
results = []


def fetch(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers={'Accept-Encoding': 'gzip', **(headers or {})})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            if r.headers.get('Content-Encoding') == 'gzip':
                body = gzip.decompress(body)
            return r.status, body, time.monotonic() - started
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300], time.monotonic() - started
    except Exception as e:  # network, TLS, timeout
        return 0, str(e).encode()[:300], time.monotonic() - started


def probe(name, url, headers=None, parse=None):
    status, body, secs = fetch(url, headers)
    detail = ''
    if status == 200 and parse:
        try:
            detail = parse(body)
        except Exception as e:  # report parse failures instead of hiding them
            detail = f'PARSE_ERROR {e}'
    elif status != 200:
        detail = body[:160].decode('utf-8', 'replace').replace('\n', ' ')
    results.append({'source': name, 'status': status, 'seconds': round(secs, 2), 'bytes': len(body), 'detail': detail})
    print(f'{status:>3} {secs:5.2f}s {len(body):>9}B  {name}: {detail}', flush=True)
    return status, body


def j(body):
    return json.loads(body)


today = dt.date.today()
yesterday = today - dt.timedelta(days=1 if today.weekday() else 3)
sym = SYMBOLS[0]

print(f'Symbols: {SYMBOLS}; date {today}', flush=True)

# ---- Official ------------------------------------------------------------------
probe('SEC ticker→CIK map', 'https://www.sec.gov/files/company_tickers_exchange.json', {'User-Agent': SEC_UA},
      lambda b: f"{len(j(b)['data'])} tickers")
status, body = fetch('https://www.sec.gov/files/company_tickers_exchange.json', {'User-Agent': SEC_UA})[:2]
cik = None
if status == 200:
    rows = j(body)['data']
    cik = next((r[0] for r in rows if r[2] == sym), None)
if cik:
    probe(f'SEC submissions {sym}', f'https://data.sec.gov/submissions/CIK{cik:010d}.json', {'User-Agent': SEC_UA},
          lambda b: 'recent forms: ' + ','.join(j(b)['filings']['recent']['form'][:12]))
    probe(f'SEC shares outstanding {sym}', f'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/dei/EntityCommonStockSharesOutstanding.json',
          {'User-Agent': SEC_UA}, lambda b: str(j(b)['units']['shares'][-1]))
probe('Nasdaq Trader listed directory', 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', None,
      lambda b: b.decode().splitlines()[0][:120] + f' | rows={len(b.decode().splitlines())}')
probe('Nasdaq trade halts RSS', 'https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts', {'User-Agent': BROWSER_UA},
      lambda b: f"items={b.decode('utf-8', 'replace').count('<item>')}")
for back in range(1, 6):
    d = today - dt.timedelta(days=back)
    s, _ = probe(f'FINRA Reg SHO daily short volume {d}', f'https://cdn.finra.org/equity/regsho/daily/CNMSshvol{d:%Y%m%d}.txt', None,
                 lambda b: b.decode().splitlines()[0] + f' | rows={len(b.decode().splitlines())}')
    if s == 200:
        break
probe('FINRA short interest API', 'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest?limit=2',
      {'Accept': 'application/json'}, lambda b: b[:200].decode('utf-8', 'replace'))

# ---- Alpaca (existing keys) ------------------------------------------------------
if ALPACA['APCA-API-KEY-ID']:
    start = f'{yesterday}T13:30:00Z'
    end = f'{yesterday}T20:00:00Z'
    for feed in ('iex', 'sip'):
        probe(f'Alpaca {feed.upper()} 1Min bars {sym} {yesterday}',
              f'https://data.alpaca.markets/v2/stocks/bars?symbols={sym}&timeframe=1Min&start={start}&end={end}&limit=10000&feed={feed}',
              ALPACA, lambda b: f"bars={len(j(b)['bars'].get(sym, []))} volume={sum(x['v'] for x in j(b)['bars'].get(sym, []))}")
    recent_end = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=16)).strftime('%Y-%m-%dT%H:%M:%SZ')
    probe('Alpaca SIP bars ending 16 min ago (free-plan delay check)',
          f'https://data.alpaca.markets/v2/stocks/bars?symbols={sym}&timeframe=1Min&end={recent_end}&limit=5&feed=sip&sort=desc',
          ALPACA, lambda b: f"bars={len(j(b)['bars'].get(sym, []))}")
    probe('Alpaca SIP daily bars (previous close)',
          f'https://data.alpaca.markets/v2/stocks/bars?symbols={",".join(SYMBOLS)}&timeframe=1Day&limit=20&feed=sip&adjustment=split&start={today - dt.timedelta(days=7)}',
          ALPACA, lambda b: str({k: v[-1]['c'] for k, v in j(b)['bars'].items()}))
else:
    print('Alpaca secrets not available to this run', flush=True)

# ---- Massive (formerly Polygon) --------------------------------------------------------
if os.environ.get('MASSIVE_API_KEY'):
    probe(f'Massive previous day {sym}', f'https://api.polygon.io/v2/aggs/ticker/{sym}/prev?adjusted=true&apiKey={os.environ["MASSIVE_API_KEY"]}',
          None, lambda b: str(j(b).get('results', j(b))[:1] if isinstance(j(b).get('results'), list) else j(b))[:200])

# ---- Unofficial ------------------------------------------------------------------------
probe(f'Yahoo chart 1m {sym}', f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=1d&includePrePost=true',
      {'User-Agent': BROWSER_UA},
      lambda b: (lambda m: f"exchange={m.get('exchangeName')} delay={m.get('exchangeDataDelayedBy')} price={m.get('regularMarketPrice')} t={m.get('regularMarketTime')} points={len(j(b)['chart']['result'][0].get('timestamp') or [])}")(j(b)['chart']['result'][0]['meta']))
probe(f'Yahoo chart 5d/1m {sym} (history depth)', f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=5d',
      {'User-Agent': BROWSER_UA}, lambda b: f"points={len(j(b)['chart']['result'][0].get('timestamp') or [])}")
probe(f'Nasdaq.com quote {sym}', f'https://api.nasdaq.com/api/quote/{sym}/info?assetclass=stocks',
      {'User-Agent': BROWSER_UA, 'Accept': 'application/json'},
      lambda b: str((j(b).get('data') or {}).get('primaryData'))[:220])
probe(f'Nasdaq.com intraday chart {sym}', f'https://api.nasdaq.com/api/quote/{sym}/chart?assetclass=stocks',
      {'User-Agent': BROWSER_UA, 'Accept': 'application/json'},
      lambda b: f"points={len(((j(b).get('data') or {}).get('chart') or []))}")
status, body = fetch(f'https://api.nasdaq.com/api/quote/{sym}/chart?assetclass=stocks', {'User-Agent': BROWSER_UA, 'Accept': 'application/json'})[:2]
if status == 200:
    data = j(body).get('data') or {}
    chart = data.get('chart') or []
    print('NASDAQ CHART RAW', json.dumps({k: v for k, v in data.items() if k != 'chart'})[:600], flush=True)
    print('NASDAQ CHART POINTS', json.dumps(chart[:3] + chart[-2:])[:900], flush=True)
status, body = fetch('https://tagit-next-quotes.onrender.com/api/scanner', None, 90)[:2]
print('TAGIT SCANNER', status, (json.dumps({k: (v if not isinstance(v, list) else len(v)) for k, v in j(body).items()}) if status == 200 else body[:200])[:700], flush=True)
if status == 200 and j(body).get('alerts'):
    print('TAGIT ALERT SAMPLE', json.dumps(j(body)['alerts'][:2])[:700], flush=True)
probe('Stooq daily CSV', f'https://stooq.com/q/d/l/?s={sym.lower()}.us&i=d', {'User-Agent': BROWSER_UA},
      lambda b: b.decode().splitlines()[-1][:120])

out = os.environ.get('PROBE_OUT')
if out:
    with open(out, 'w') as f:
        json.dump({'probed_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'symbols': SYMBOLS, 'results': results}, f, indent=2)
print('SUMMARY ' + json.dumps([{k: r[k] for k in ('source', 'status')} for r in results]))
