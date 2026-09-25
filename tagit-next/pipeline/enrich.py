"""Build tagit-next/data/enrichment.json from free public sources.

Sources (all timestamped in the output; a failed source is reported, never invented):
  - Nasdaq Trader symbol directory: listing status, deficiency/delinquency/bankruptcy flags.
  - SEC EDGAR: recent filings (offerings, listing notices, late filings) and shares outstanding.
  - FINRA consolidated short interest: latest settlement with its date.
  - Nasdaq trade halts RSS: halts current at build time (the live service checks halts in real time).

Usage: python3 enrich.py [--limit N] [--out PATH]
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import gzip
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNIVERSE = ROOT / 'tag/data/universe-broad.json'
DEFAULT_OUT = ROOT / 'tagit-next/data/enrichment.json'
SEC_UA = os.environ.get('SEC_USER_AGENT') or 'TAGit NEXT research tufeeq11@gmail.com'
BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
MAX_CAP_MILLIONS = 1000
FILING_DAYS = 120
SYMBOL = re.compile(r'^[A-Z][A-Z0-9.-]{0,9}$')

FINANCIAL_STATUS = {
    'N': 'NORMAL', 'D': 'DEFICIENT', 'E': 'DELINQUENT', 'Q': 'BANKRUPT',
    'G': 'DEFICIENT_BANKRUPT', 'H': 'DEFICIENT_DELINQUENT', 'J': 'DELINQUENT_BANKRUPT',
    'K': 'DEFICIENT_DELINQUENT_BANKRUPT',
}
MARKET_TIER = {'Q': 'GLOBAL_SELECT', 'G': 'GLOBAL_MARKET', 'S': 'CAPITAL_MARKET'}
OFFERING_FORMS = re.compile(r'^(S-1|S-1/A|S-1MEF|S-3|S-3/A|S-3ASR|F-1|F-1/A|F-3|F-3/A|424B[1-8])$')
LATE_FORMS = {'NT 10-K', 'NT 10-Q', 'NT 20-F'}
PERIODIC_FORMS = {'10-K', '10-Q', '20-F', '40-F', '10-K/A', '10-Q/A'}


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


class RateLimiter:
    """At most `rate` calls per second across threads (SEC asks for <= 10/s)."""

    def __init__(self, rate):
        self.interval = 1 / rate
        self.lock = threading.Lock()
        self.next = time.monotonic()

    def wait(self):
        with self.lock:
            t = time.monotonic()
            if t < self.next:
                time.sleep(self.next - t)
            self.next = max(t, self.next) + self.interval


def fetch(url, headers=None, data=None, timeout=30, retries=3):
    body = json.dumps(data).encode() if data is not None else None
    hdrs = {'Accept-Encoding': 'gzip', **(headers or {})}
    if body is not None:
        hdrs['Content-Type'] = 'application/json'
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return gzip.decompress(raw) if r.headers.get('Content-Encoding') == 'gzip' else raw
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (404, 400, 401, 403):
                raise
        except Exception as e:  # timeouts and resets are retried
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise last


# ---- sources ------------------------------------------------------------------------

def universe():
    rows = json.loads(UNIVERSE.read_text())['rows']
    caps = {}
    for r in rows:
        try:
            cap = float(r.get('Market Cap'))
        except (TypeError, ValueError):
            continue
        if SYMBOL.match(r.get('Ticker', '')) and 0 < cap < MAX_CAP_MILLIONS:
            caps[r['Ticker']] = cap
    return caps


def nasdaq_directory():
    text = fetch('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', {'User-Agent': BROWSER_UA}).decode()
    lines = text.strip().splitlines()
    header = lines[0].split('|')
    file_time = lines[-1].replace('File Creation Time:', '').strip('| ') if lines[-1].startswith('File Creation Time') else None
    listing = {}
    for line in lines[1:]:
        if line.startswith('File Creation Time'):
            continue
        row = dict(zip(header, line.split('|')))
        if row.get('Test Issue') == 'Y' or row.get('ETF') == 'Y':
            continue
        code = row.get('Financial Status', '')
        listing[row['Symbol']] = {
            'status_code': code or None,
            'status': FINANCIAL_STATUS.get(code, 'NOT_REPORTED' if not code else 'UNKNOWN'),
            'tier': MARKET_TIER.get(row.get('Market Category')),
        }
    return listing, file_time


def sec_company(cik, limiter, since):
    headers = {'User-Agent': SEC_UA}
    limiter.wait()
    sub = json.loads(fetch(f'https://data.sec.gov/submissions/CIK{cik:010d}.json', headers))
    recent = sub.get('filings', {}).get('recent', {})
    filings = []
    for i, form in enumerate(recent.get('form', [])):
        date = recent['filingDate'][i]
        if date < since:
            break
        accession = recent['accessionNumber'][i]
        filings.append({
            'form': form,
            'date': date,
            'items': recent.get('items', [''] * (i + 1))[i] or None,
            'url': f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}/{recent['primaryDocument'][i]}",
        })
    periodic = next((
        {'form': f, 'date': recent['filingDate'][i]}
        for i, f in enumerate(recent.get('form', [])) if f in PERIODIC_FORMS), None)

    shares = None
    limiter.wait()
    try:
        concept = json.loads(fetch(
            f'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/dei/EntityCommonStockSharesOutstanding.json', headers))
        points = [p for unit in concept.get('units', {}).values() for p in unit if isinstance(p.get('val'), (int, float))]
        if points:
            latest = max(points, key=lambda p: (p.get('end', ''), p.get('filed', '')))
            shares = {'value': latest['val'], 'as_of': latest.get('end'), 'form': latest.get('form'), 'filed': latest.get('filed')}
    except urllib.error.HTTPError as e:
        if e.code != 404:  # 404: company files no dei shares tag
            raise
    return {'filings': filings, 'latest_periodic': periodic, 'shares_outstanding': shares}


def filing_flags(filings, today):
    flags = []
    recent30 = (today - dt.timedelta(days=30)).isoformat()
    for f in filings:
        form, date, items = f['form'], f['date'], f.get('items') or ''
        if OFFERING_FORMS.match(form):
            flags.append({'kind': 'OFFERING', 'form': form, 'date': date, 'recent': date >= recent30})
        elif form in LATE_FORMS:
            flags.append({'kind': 'LATE_FILING', 'form': form, 'date': date, 'recent': date >= recent30})
        elif form.startswith('8-K'):
            if '3.01' in items:
                flags.append({'kind': 'LISTING_NOTICE', 'form': form, 'date': date, 'recent': date >= recent30})
            if '5.03' in items:
                flags.append({'kind': 'CHARTER_AMENDMENT', 'form': form, 'date': date, 'recent': date >= recent30})
            if '1.03' in items:
                flags.append({'kind': 'BANKRUPTCY', 'form': form, 'date': date, 'recent': date >= recent30})
    # One entry per kind: the most recent.
    seen, out = set(), []
    for flag in flags:
        if flag['kind'] not in seen:
            seen.add(flag['kind'])
            out.append(flag)
    return out


def finra_short_interest(symbols):
    """Latest FINRA settlement for our symbols. The newest settlement date comes from the
    dataset's partitions; FINRA only sorts or filters efficiently on that partition key."""
    base = 'https://api.finra.org'
    headers = {'Accept': 'application/json', 'User-Agent': BROWSER_UA}
    partitions = json.loads(fetch(f'{base}/partitions/group/otcMarket/name/consolidatedShortInterest', headers))
    dates = [p for block in partitions.get('availablePartitions', []) for p in block.get('partitions', [])]
    settlement = max(dates)
    url = f'{base}/data/group/otcMarket/name/consolidatedShortInterest'
    out, offset = {}, 0
    while True:
        page = json.loads(fetch(url, headers, {
            'limit': 5000, 'offset': offset,
            'compareFilters': [{'compareType': 'EQUAL', 'fieldName': 'settlementDate', 'fieldValue': settlement}],
        }))
        for r in page:
            sym = r.get('symbolCode')
            if sym not in symbols:
                continue
            short, prev, adv = r.get('currentShortPositionQuantity'), r.get('previousShortPositionQuantity'), r.get('averageDailyVolumeQuantity')
            out[sym] = {
                'settlement_date': r.get('settlementDate'),
                'shares_short': short,
                'previous_shares_short': prev,
                'change_pct': r.get('changePercent') if r.get('changePercent') is not None else (
                    (short / prev - 1) * 100 if isinstance(short, (int, float)) and isinstance(prev, (int, float)) and prev > 0 else None),
                'days_to_cover': r.get('daysToCoverQuantity') if r.get('daysToCoverQuantity') is not None else (
                    short / adv if isinstance(short, (int, float)) and isinstance(adv, (int, float)) and adv > 0 else None),
                'avg_daily_volume': adv,
            }
        if len(page) < 5000:
            break
        offset += 5000
    return out, settlement


def current_halts(symbols):
    raw = fetch('https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts', {'User-Agent': BROWSER_UA})
    ns = {'ndaq': 'http://www.nasdaqtrader.com/'}
    halts = {}
    for item in ET.fromstring(raw).iter('item'):
        get = lambda tag: (item.findtext(f'ndaq:{tag}', namespaces=ns) or '').strip() or None
        sym = get('IssueSymbol')
        if sym not in symbols or get('ResumptionTradeTime'):
            continue  # resumed halts are history, not current state
        halts[sym] = {
            'halt_date': get('HaltDate'), 'halt_time': get('HaltTime'), 'reason_code': get('ReasonCode'),
            'resumption_quote_time': get('ResumptionQuoteTime'),
        }
    return halts


# ---- build ------------------------------------------------------------------------------

def build(limit=None):
    today = dt.date.today()
    since = (today - dt.timedelta(days=FILING_DAYS)).isoformat()
    sources = {}
    caps = universe()
    listing, file_time = nasdaq_directory()
    sources['nasdaq_directory'] = {'status': 'OK', 'fetched_at': now_iso(), 'file_time': file_time, 'rows': len(listing)}
    symbols = sorted(s for s in caps if s in listing)
    if limit:
        symbols = symbols[:limit]
    print(f'universe: {len(caps)} under ${MAX_CAP_MILLIONS}M, {len(symbols)} Nasdaq-listed', flush=True)
    result = {s: {'listing': listing[s], 'reference_cap_millions': caps[s]} for s in symbols}

    # SEC
    tickers = json.loads(fetch('https://www.sec.gov/files/company_tickers_exchange.json', {'User-Agent': SEC_UA}))
    fields = tickers['fields']
    cik_of = {row[fields.index('ticker')]: row[fields.index('cik')] for row in tickers['data']}
    limiter, errors = RateLimiter(8), 0
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {pool.submit(sec_company, cik_of[s], limiter, since): s for s in symbols if s in cik_of}
        for job in cf.as_completed(jobs):
            s = jobs[job]
            result[s]['cik'] = cik_of[s]
            try:
                sec = job.result()
                result[s].update(sec)
                result[s]['flags'] = filing_flags(sec['filings'], today)
                sec['filings'][:] = sec['filings'][:5]  # the page shows the latest five
            except Exception as e:  # one company's failure never fails the build
                errors += 1
                result[s]['sec_error'] = str(e)[:120]
    sources['sec'] = {'status': 'OK' if errors < len(jobs) / 10 else 'PARTIAL', 'fetched_at': now_iso(),
                      'companies': len(jobs), 'errors': errors, 'without_cik': len([s for s in symbols if s not in cik_of])}
    print(f"sec: {sources['sec']}", flush=True)

    for name, fn in (('finra_short_interest', finra_short_interest), ('halts', current_halts)):
        try:
            data = fn(set(symbols))
            extra = {}
            if name == 'finra_short_interest':
                data, extra['settlement_date'] = data
            for s, v in data.items():
                result[s]['short_interest' if name == 'finra_short_interest' else 'halt'] = v
            sources[name] = {'status': 'OK', 'fetched_at': now_iso(), 'symbols': len(data), **extra}
        except Exception as e:
            sources[name] = {'status': 'UNAVAILABLE', 'fetched_at': now_iso(), 'error': str(e)[:160]}
        print(f'{name}: {sources[name]}', flush=True)

    return {
        'schema': 1,
        'generated_at': now_iso(),
        'scope': f'Nasdaq-listed common stocks below ${MAX_CAP_MILLIONS}M reference market cap (no ETFs or test issues)',
        'sources': sources,
        'notes': [
            'Filing flags describe what was filed, not its effect on price.',
            'Halts are those current when this file was built; check the live halt status.',
            'Short interest is as of its settlement date, reported by FINRA with a delay.',
        ],
        'symbols': result,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int)
    parser.add_argument('--out', default=str(DEFAULT_OUT))
    args = parser.parse_args()
    report = build(args.limit)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, separators=(',', ':'), sort_keys=True) + '\n')
    size = Path(args.out).stat().st_size
    print(f'wrote {args.out} ({size / 1e6:.2f} MB, {len(report["symbols"])} symbols)')
    if report['sources']['nasdaq_directory']['status'] != 'OK' or report['sources']['sec']['status'] == 'UNAVAILABLE':
        sys.exit(1)


if __name__ == '__main__':
    main()
