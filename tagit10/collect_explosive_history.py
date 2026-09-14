"""Persist a return-independent equity cohort and auditable closed intraday bars."""
import csv, gzip, hashlib, io, json, math, os, re, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'history/explosive'
ET = ZoneInfo('America/New_York')
UA = {'User-Agent': 'Mozilla/5.0 TAGit10 personal historical research'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
        return r.read()


def directory():
    rows = {}
    for name in ['nasdaqlisted', 'otherlisted']:
        raw = get('https://www.nasdaqtrader.com/dynamic/SymDir/' + name + '.txt').decode()
        for r in csv.DictReader(io.StringIO(raw), delimiter='|'):
            s = (r.get('Symbol') or r.get('ACT Symbol') or '').strip()
            title = r.get('Security Name') or ''
            if not re.fullmatch('[A-Z]{1,5}', s) or r.get('ETF') != 'N' or r.get('Test Issue') != 'N':
                continue
            if re.search(r'\b(warrants?|rights?|units?|preferred|fund|etn|notes|debentures)\b', title, re.I):
                continue
            rows[s] = {'symbol': s, 'name': title, 'directory': name}
    if len(rows) < 1500:
        raise RuntimeError('Directory coverage too low; keeping prior artifacts')
    return rows


def valid_bar(b):
    return (all(math.isfinite(v) for v in b.values()) and b['t'] % 300 == 0 and
            b['v'] >= 0 and 0 < b['l'] <= min(b['o'], b['c']) <= max(b['o'], b['c']) <= b['h'])


def fetch(s, start, end):
    url = ('https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(s, safe='') +
           f'?period1={start}&period2={end}&interval=5m&includePrePost=true&events=div%2Csplits')
    error = None
    for attempt in range(2):
        try:
            raw = get(url)
            z = json.loads(raw)['chart']['result'][0]
            if z['meta'].get('instrumentType') != 'EQUITY':
                return s, None, 'NOT_EQUITY'
            q = z['indicators']['quote'][0]
            bars, bad = {}, 0
            for i, t in enumerate(z.get('timestamp') or []):
                try:
                    b = {'t': int(t), **{k: float(q[v][i]) for k, v in zip('ohlcv', ['open', 'high', 'low', 'close', 'volume'])}}
                    if t + 300 > end or not valid_bar(b):
                        bad += 1
                        continue
                    bars[t] = b
                except (ValueError, TypeError, IndexError, KeyError):
                    bad += 1
            if not bars:
                return s, None, 'NO_VALID_BARS'
            return s, {'symbol': s, 'bars': [bars[t] for t in sorted(bars)],
                       'splitEvents': z.get('events', {}).get('splits', {}),
                       'downloadedAtUTC': datetime.now(timezone.utc).isoformat(),
                       'responseSha256': hashlib.sha256(raw).hexdigest(), 'rejectedBars': bad}, None
        except Exception as exc:
            error = type(exc).__name__
            time.sleep(1 + attempt)
    return s, None, error


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    # Exclude the entire current New York date, even if the market is open.
    today = now.astimezone(ET).date()
    end = int(datetime.combine(today, datetime.min.time(), ET).timestamp())
    start = end - 59 * 86400
    manifest_path = DATA / 'manifest.json'
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text())
        if old.get('requestEndUTC') == end and len(list(DATA.glob('bars-*.jsonl.gz'))) == 16:
            print(json.dumps({'collection': 'REUSE_SAME_COMPLETED_DATE', 'bars': old['bars'], 'symbols': old['successfulSymbols']}), flush=True)
            return
    symbols_path = DATA / 'cohort.json'
    if symbols_path.exists():
        cohort = json.loads(symbols_path.read_text())
    else:
        members = directory()
        chosen = sorted(members, key=lambda s: hashlib.sha256(('tagit10-explosion-v1:' + s).encode()).hexdigest())[:2000]
        cohort = {'frozenAtUTC': now.isoformat(), 'selection': 'SHA256 sample before requesting returns; current common-equity directory, NOT historical membership',
                  'directoryEquities': len(members), 'members': [members[s] for s in chosen]}
    symbols = [r['symbol'] for r in cohort['members']]
    obtained, errors = {}, {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch, s, start, end) for s in symbols]
        for f in as_completed(futures):
            s, item, error = f.result()
            if item:
                obtained[s] = item
            else:
                errors[s] = error
            count = len(obtained) + len(errors)
            if count % 100 == 0:
                print(json.dumps({'downloaded': count, 'succeeded': len(obtained), 'failed': len(errors)}), flush=True)
    if len(obtained) < .85 * len(symbols):
        raise RuntimeError(f'Only {len(obtained)}/{len(symbols)} symbols; refusing to replace evidence')
    # Preserve prior data for symbols temporarily unavailable, with original provenance.
    prior = {}
    for path in sorted(DATA.glob('bars-*.jsonl.gz')):
        with gzip.open(path, 'rt') as f:
            for line in f:
                item = json.loads(line)
                prior[item['symbol']] = item
    retention = end - 180 * 86400
    merged = {}
    for s in symbols:
        previous = prior.get(s, {})
        item = obtained.get(s, previous)
        if not item:
            continue
        bars = {b['t']: b for b in previous.get('bars', [])}
        bars.update({b['t']: b for b in item['bars']})
        merged[s] = {**item, 'bars': [bars[t] for t in sorted(bars) if retention <= t < end],
                     'splitEvents': {**previous.get('splitEvents', {}), **item.get('splitEvents', {})},
                     'latestFetchSucceeded': s in obtained}
    artifacts = {}
    for shard in '0123456789abcdef':
        path = DATA / f'bars-{shard}.jsonl.gz'
        with gzip.open(path, 'wt', compresslevel=6) as f:
            for s, item in sorted(merged.items()):
                if hashlib.sha256(s.encode()).hexdigest()[0] == shard:
                    f.write(json.dumps(item, separators=(',', ':'), allow_nan=False) + '\n')
        artifacts[path.name] = {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    symbols_path.write_text(json.dumps(cohort, indent=2) + '\n')
    report = {'collectedAtUTC': now.isoformat(), 'requestStartUTC': start, 'requestEndUTC': end,
              'intervalSeconds': 300, 'extendedHoursIncluded': True, 'currentSessionExcluded': True,
              'requestedSymbols': len(symbols), 'successfulSymbols': len(obtained),
              'retainedSymbols': len(merged), 'bars': sum(len(x['bars']) for x in merged.values()),
              'errors': errors, 'rejectedSourceBars': sum(x['rejectedBars'] for x in obtained.values()),
              'artifacts': artifacts,
              'limitations': ['Current survivors, not historical point-in-time exchange membership',
                              'Yahoo retrospective OHLCV; no executable quotes or historical news/float',
                              'A sample of the equity universe, not every historical market winner'],
              'sources': ['https://ranaroussi.github.io/yfinance/reference/api/yfinance.download.html',
                          'https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs']}
    manifest_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['successfulSymbols', 'bars', 'requestStartUTC', 'requestEndUTC']}), flush=True)


if __name__ == '__main__':
    main()
