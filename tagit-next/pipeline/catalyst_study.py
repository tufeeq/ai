"""Catalyst (information) study for Nasdaq small caps: do SEC filing events give a tradeable edge?

Protocol catalyst-study-1, fixed 2026-09-27 BEFORE any return was computed (only data-format
diagnostics were looked at before the full run).

Data (free only)
  - Events: SEC EDGAR submissions JSON per company (form, 8-K items, acceptanceDateTime), SEC
    insider-transactions data sets (Form 4 open-market purchases), XBRL company concepts (cash).
  - Prices: consolidated (SIP) split-adjusted daily bars through the read-only relay, Nasdaq
    listings active AND inactive (delisted names included), 2022-11-15 -> 2026-09-24.
  - Ticker <-> CIK: company_tickers.json (today) plus the issuer trading symbol recorded in every
    Form 4 (point-in-time, covers delisted and renamed issuers). A filing of company C on date d is
    mapped to symbol S only if C is the owner of S at d (C's Form 4 symbol interval contains d, or is
    the nearest within 365 days, or C holds S today and nobody else held it at d).

Timing (no look-ahead)
  - Event time = EDGAR acceptance time (the submissions JSON reports New York wall-clock time; reading
    it as New York is never earlier than reading it as UTC). Accepted before 09:15 New York on a
    session day -> entry at that session's open; otherwise at the open of the next session the stock
    trades. Form 4 data sets give only the filing date -> entry at the first session AFTER that date.
  - Eligibility is judged on the bar before entry: close $0.50-$20, 20-day average dollar volume
    >= $300K, >= 21 prior bars. Entry more than 7 calendar days after the event (halt) -> skipped.
  - Exit at the close of the entry session + h - 1 (H1 = same-day close), h in {1, 3, 5, 10}.
  - Costs: 0.5 pp round trip; shorts also pay 0.1 pp borrow per session held. Sensitivity: 1.0 pp
    and 0.3 pp/session borrow.
  - Same symbol + same hypothesis within 5 sessions of a kept event -> the later event is dropped.

Pre-registered hypotheses (primary spec = direction + horizon, fixed now)
  P1 offering_short     424B1/424B4/424B5 filed (priced offering / shelf takedown) -> SHORT, H5.
  P2 insider_cluster    >= 2 distinct insiders with open-market purchases (Form 4 code P) filed within
                        10 calendar days, together >= $50K; one event per issuer per 30 days -> LONG, H10.
  P3 agreement_clean    8-K item 1.01 without items 2.03/3.02 in it and without any 424B*, S-1, S-3,
                        F-1, F-3 or 8-K 2.03/3.02 by the company in the 30 days before -> LONG, H5.
  P4 delisting_notice   8-K item 3.01 -> SHORT, H5.
  P5 earnings_gap_fade  8-K item 2.02 and the entry open >= 5% over the previous close -> SHORT, H3.
  P6 dilution_flag      eligible stock-days where the company filed S-1/S-3/F-1/F-3 in the last 365
                        days AND its latest reported cash (XBRL, filed before the day) is < $10M -> SHORT, H10.
     Avoid-filter form of P6: flagged minus unflagged long return, H10; useful if the holdout
     interval is entirely below 0.
  Reverse-split announcements were considered and NOT registered: no reliable free timestamped source
  (8-K 5.03 mixes all charter amendments).

Split and decision rule
  - Sessions 2023-01-03 -> 2026-09-24; development = first two thirds, holdout = last third (by entry
    session). Moving-block bootstrap over sessions (block 10, 2000 draws) for 95% intervals.
  - A primary HOLDS only if: development mean > 0, holdout mean > 0, holdout 95% lower bound > 0,
    holdout mean > the same-direction baseline (every eligible stock-day, same horizon and costs),
    and >= 30 holdout trades. The Bonferroni (6 tests, 99.2%) lower bound is also reported.
  - Secondary: the full grid (6 hypotheses x long/short x H1/3/5/10 plus earnings gap-down) is shown;
    one grid cell is selected on development (>= 100 trades, mean > 0, best lower bound) and tested
    once on the holdout under the same rule. Nothing is re-picked after the holdout is seen.

Research evidence only: daily bars are not fills; shorts in small caps may be unavailable to borrow.

Usage: python3 catalyst_study.py [--limit-symbols N] [--diagnostics-only] [--cache DIR] [--out PATH]
"""
import argparse
import bisect
import concurrent.futures as cf
import csv
import datetime as dt
import gzip
import io
import json
import math
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import RateLimiter, fetch, SEC_UA  # noqa: E402

csv.field_size_limit(1 << 30)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / 'data/catalyst-study.json'
SERVICE = os.environ.get('TAGIT_SERVICE', 'https://tagit-next-quotes.onrender.com')
FROM, TO = '2023-01-03', '2026-09-24'
WINDOWS = [('2022-11-15T00:00:00Z', '2024-12-31T23:59:00Z'), ('2025-01-01T00:00:00Z', '2026-10-05T23:59:00Z')]
EDGAR_SINCE = '2021-11-01'  # a year of filing history before the first bar window (shelf look-back)
HORIZONS = (1, 3, 5, 10)
COST, BORROW = 0.5, 0.1
COST_HI, BORROW_HI = 1.0, 0.3
CUTOFF_MIN = 9 * 60 + 15
MAX_ENTRY_DELAY_DAYS = 7
DEDUPE_SESSIONS = 5
BLOCK, DRAWS = 10, 2000
SYMBOL = re.compile(r'^[A-Z]{1,5}$')
EXCLUDE = re.compile(r'warrant|right|unit|preferred|depositary|etf|fund|trust|notes|debenture|acquisition corp', re.I)

OFFERING_PRICED = {'424B1', '424B4', '424B5'}
REGISTRATION = {'S-1', 'S-3', 'F-1', 'F-3'}
FINANCING_FORMS = re.compile(r'^(424B\d|S-1|S-3|F-1|F-3)$')

PRIMARY = {
    'offering_short': ('offering', -1, 5),
    'insider_cluster': ('insider_cluster', 1, 10),
    'agreement_clean': ('agreement', 1, 5),
    'delisting_notice': ('delisting', -1, 5),
    'earnings_gap_fade': ('earnings_gap_up', -1, 3),
    'dilution_flag': ('dilution', -1, 10),
}
HYPOTHESES = ['offering', 'insider_cluster', 'agreement', 'delisting', 'earnings_gap_up', 'earnings_gap_down', 'dilution']

NY = None
try:
    from zoneinfo import ZoneInfo
    NY = ZoneInfo('America/New_York')
except Exception:  # pragma: no cover
    pass


# ---- pure helpers (unit tested) --------------------------------------------------------------

def parse_acceptance(value):
    """'2024-03-01T16:05:23.000Z' (New York wall clock in EDGAR submissions) -> ('2024-03-01', 965)."""
    if not value or len(value) < 16:
        return None
    return value[:10], int(value[11:13]) * 60 + int(value[14:16])


def parse_date(value):
    """'31-JAN-2024' or '2024-01-31' -> '2024-01-31'."""
    value = (value or '').strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}', value):
        return value[:10]
    try:
        return dt.datetime.strptime(value.title(), '%d-%b-%Y').date().isoformat()
    except ValueError:
        return None


def add_days(day, n):
    return (dt.date.fromisoformat(day) + dt.timedelta(days=n)).isoformat()


def entry_index(dates, day, minute=None):
    """Index of the entry bar in a symbol's sorted bar dates for an event on `day` at `minute`
    (New York minutes; None = time unknown -> first bar strictly after `day`)."""
    if minute is not None and minute < CUTOFF_MIN:
        i = bisect.bisect_left(dates, day)
    else:
        i = bisect.bisect_right(dates, day)
    if i >= len(dates) or dates[i] > add_days(day, MAX_ENTRY_DELAY_DAYS):
        return None
    return i


def eligible(bars, i):
    """Eligibility judged on bar i (the bar before entry)."""
    if i < 21 or not (0.5 <= bars[i][4] <= 20):
        return False
    avg = sum(b[4] * b[5] for b in bars[i - 20:i]) / 20
    return avg >= 300_000


def gross_returns(bars, i):
    """Gross long returns (pp) from the open of bar i to the close of bar i + h - 1."""
    entry = bars[i][1]
    if not entry or entry <= 0:
        return None
    out = {}
    for h in HORIZONS:
        j = i + h - 1
        out[h] = (bars[j][4] / entry - 1) * 100 if j < len(bars) and bars[j][4] > 0 else None
    return out


def net(gross, direction, h, cost=COST, borrow=BORROW):
    return direction * gross - cost - (borrow * h if direction < 0 else 0)


def norm_symbol(s):
    s = (s or '').strip().upper()
    s = re.sub(r'^(NASDAQ|NYSE|NYSEAMERICAN|AMEX)[:\s]+', '', s)
    return s if SYMBOL.match(s) else None


class Ownership:
    """Who owned a ticker on a date, from Form 4 issuer symbols (dated) and today's ticker list."""

    def __init__(self, insider_pairs, current):
        # insider_pairs: {(symbol, cik): [first_date, last_date]}; current: {symbol: cik}
        self.by_symbol = {}
        for (s, c), (a, b) in insider_pairs.items():
            self.by_symbol.setdefault(s, []).append((c, a, b))
        self.current = current

    def owner(self, symbol, day):
        spans = self.by_symbol.get(symbol, [])
        inside = [c for c, a, b in spans if a <= day <= b]
        if len(inside) == 1:
            return inside[0]
        if len(inside) > 1:
            return None  # ambiguous: skip rather than guess
        best, dist = None, 366
        for c, a, b in spans:
            d = (dt.date.fromisoformat(a) - dt.date.fromisoformat(day)).days if day < a else (dt.date.fromisoformat(day) - dt.date.fromisoformat(b)).days
            if d < dist:
                best, dist = c, d
        if best is not None:
            return best
        return self.current.get(symbol)

    def symbols_of(self, cik):
        out = {s for s, spans in self.by_symbol.items() for c, _, _ in spans if c == cik}
        out |= {s for s, c in self.current.items() if c == cik}
        return out


def filing_events(filings):
    """Company filings (sorted by acceptance) -> [(hypothesis, day, minute, meta)].
    filings: [{'form', 'acc': 'YYYY-MM-DDTHH:MM', 'items': '1.01,9.01'}]."""
    out = []
    financing_days = []
    for f in filings:
        t = parse_acceptance(f['acc'])
        if not t:
            continue
        day, minute = t
        form, items = f['form'], set((f.get('items') or '').replace(' ', '').split(',')) - {''}
        if form in OFFERING_PRICED:
            out.append(('offering', day, minute, form))
        if form == '8-K':
            if '1.01' in items and not items & {'2.03', '3.02'}:
                since = add_days(day, -30)
                if not any(since <= d <= day for d in financing_days):
                    out.append(('agreement', day, minute, ','.join(sorted(items))))
            if '3.01' in items:
                out.append(('delisting', day, minute, '3.01'))
            if '2.02' in items:
                out.append(('earnings', day, minute, '2.02'))
        if FINANCING_FORMS.match(form) or (form == '8-K' and items & {'2.03', '3.02'}):
            financing_days.append(day)
    return out


def insider_clusters(purchases):
    """purchases: [(filing_day, owner_cik, value_usd)] for one issuer -> event days."""
    purchases = sorted(purchases)
    events, last = [], None
    for k, (day, _, _) in enumerate(purchases):
        since = add_days(day, -9)
        window = [p for p in purchases[:k + 1] if p[0] >= since]
        owners = {p[1] for p in window}
        value = sum(p[2] for p in window)
        if len(owners) >= 2 and value >= 50_000 and (last is None or day > add_days(last, 30)):
            events.append(day)
            last = day
    return events


def cash_index(points):
    """Sorted [(filed, end, usd)] -> (filed dates, best-so-far (end, usd) by latest period end)."""
    points = sorted(tuple(p) for p in points)
    filed, best, cur = [], [], None
    for f, e, v in points:
        if cur is None or e >= cur[0]:
            cur = (e, v)
        filed.append(f)
        best.append(cur)
    return filed, best


def dilution_flag(day, registrations, cash):
    """registrations: sorted acceptance days of S-1/S-3/F-1/F-3; cash: cash_index(...).
    True when a registration fell in [day-365, day-1] and the latest cash filed before `day`
    (period end within 400 days) is below $10M; None when a shelf exists but cash is unknown."""
    lo = add_days(day, -365)
    i = bisect.bisect_left(registrations, lo)
    has_shelf = i < len(registrations) and registrations[i] < day
    if not has_shelf:
        return False
    filed, best = cash
    k = bisect.bisect_left(filed, day) - 1
    if k < 0 or best[k][0] < add_days(day, -400):
        return None
    return best[k][1] < 10_000_000


# ---- statistics ------------------------------------------------------------------------------

class Cells:
    """Per-session gross sums/counts for one (hypothesis, horizon)."""

    def __init__(self, n_sessions):
        self.s = [0.0] * n_sessions
        self.n = [0] * n_sessions
        self.pos = {1: [0] * n_sessions, -1: [0] * n_sessions}

    def add(self, k, g, h):
        self.s[k] += g
        self.n[k] += 1
        if net(g, 1, h) > 0:
            self.pos[1][k] += 1
        if net(g, -1, h) > 0:
            self.pos[-1][k] += 1


def block_bootstrap(s, n, lo, hi, draws=DRAWS, block=BLOCK, seed=7):
    """Moving-block bootstrap of the pooled gross mean over sessions [lo, hi)."""
    length = hi - lo
    if length <= 0:
        return []
    block = min(block, length)
    ps, pn = [0.0], [0]
    for k in range(lo, hi):
        ps.append(ps[-1] + s[k])
        pn.append(pn[-1] + n[k])
    starts = length - block + 1
    nblocks = math.ceil(length / block)
    rnd = random.Random(seed)
    means = []
    for _ in range(draws):
        ts = tn = 0
        for _ in range(nblocks):
            a = rnd.randrange(starts)
            ts += ps[a + block] - ps[a]
            tn += pn[a + block] - pn[a]
        if tn:
            means.append(ts / tn)
    means.sort()
    return means


def quantile(xs, q):
    if not xs:
        return None
    return xs[min(len(xs) - 1, max(0, int(q * len(xs))))]


def r3(x):
    return None if x is None or not math.isfinite(x) else round(x, 3)


def summarize(cells, lo, hi, direction, h, cost=COST, borrow=BORROW, boot=None):
    n = sum(cells.n[lo:hi])
    if not n:
        return {'trades': 0, 'days': 0, 'mean_pct': None, 'ci95': None, 'lb_bonferroni': None, 'win_rate': None}
    g = sum(cells.s[lo:hi]) / n
    boot = boot if boot is not None else block_bootstrap(cells.s, cells.n, lo, hi)
    tr = [net(x, direction, h, cost, borrow) for x in boot]
    tr.sort()
    return {
        'trades': n,
        'days': sum(1 for k in range(lo, hi) if cells.n[k]),
        'mean_pct': r3(net(g, direction, h, cost, borrow)),
        'ci95': [r3(quantile(tr, 0.025)), r3(quantile(tr, 0.975))],
        'lb_bonferroni': r3(quantile(tr, 0.05 / 6 / 2)),
        'win_rate': r3(sum(cells.pos[direction][lo:hi]) / n) if cost == COST else None,
    }


def spread(flag, other, lo, hi, h, draws=DRAWS, block=BLOCK, seed=9):
    """Flagged minus unflagged gross long mean over [lo, hi) with a paired block bootstrap."""
    def pooled(c, ks):
        n = sum(c.n[k] for k in ks)
        return sum(c.s[k] for k in ks) / n if n else float('nan')
    ks = range(lo, hi)
    point = pooled(flag, ks) - pooled(other, ks)
    length = hi - lo
    block = min(block, length)
    rnd = random.Random(seed)
    out = []
    for _ in range(draws):
        pick = []
        for _ in range(math.ceil(length / block)):
            a = lo + rnd.randrange(length - block + 1)
            pick.extend(range(a, a + block))
        d = pooled(flag, pick) - pooled(other, pick)
        if math.isfinite(d):
            out.append(d)
    out.sort()
    return {'horizon': h, 'flagged_minus_unflagged_pp': r3(point), 'ci95': [r3(quantile(out, 0.025)), r3(quantile(out, 0.975))]}


def verdict(dev, hold, base_hold):
    return bool(
        dev['mean_pct'] is not None and dev['mean_pct'] > 0
        and hold['mean_pct'] is not None and hold['mean_pct'] > 0
        and hold['ci95'] and hold['ci95'][0] is not None and hold['ci95'][0] > 0
        and hold['trades'] >= 30
        and hold['mean_pct'] > (base_hold['mean_pct'] if base_hold['mean_pct'] is not None else -1e9))


def analyze(cells, sessions):
    """cells: {hypothesis or 'baseline' or 'unflagged': {h: Cells}}."""
    cut = len(sessions) * 2 // 3
    periods = {'development': (0, cut), 'holdout': (cut, len(sessions))}
    grid = {}
    for name in ['baseline', *HYPOTHESES]:
        if name not in cells:
            continue
        grid[name] = {}
        for h in HORIZONS:
            c = cells[name][h]
            for d, label in ((1, 'long'), (-1, 'short')):
                row = {}
                for p, (lo, hi) in periods.items():
                    boot = block_bootstrap(c.s, c.n, lo, hi)
                    row[p] = summarize(c, lo, hi, d, h, boot=boot)
                    if p == 'holdout':
                        row['holdout_high_cost'] = summarize(c, lo, hi, d, h, COST_HI, BORROW_HI, boot=boot)
                grid[name][f'{label}_H{h}'] = row
    primaries = {}
    for key, (name, d, h) in PRIMARY.items():
        label = f"{'long' if d > 0 else 'short'}_H{h}"
        row = grid.get(name, {}).get(label)
        if not row:
            continue
        base = grid['baseline'][label]
        primaries[key] = {
            'hypothesis': name, 'direction': 'long' if d > 0 else 'short', 'horizon': h, **row,
            'baseline_holdout': base['holdout'],
            'holds': verdict(row['development'], row['holdout'], base['holdout']),
            'holds_bonferroni': bool(verdict(row['development'], row['holdout'], base['holdout'])
                                     and (row['holdout']['lb_bonferroni'] or -1) > 0),
        }
    ranked = sorted(
        ((name, label, row) for name, rows in grid.items() if name != 'baseline' for label, row in rows.items()
         if row['development']['trades'] >= 100 and (row['development']['mean_pct'] or 0) > 0),
        key=lambda x: -(x[2]['development']['ci95'][0] or -1e9))
    selected = None
    if ranked:
        name, label, row = ranked[0]
        base = grid['baseline'][label]
        selected = {'hypothesis': name, 'spec': label, **row, 'baseline_holdout': base['holdout'],
                    'holds': verdict(row['development'], row['holdout'], base['holdout'])}
    avoid = None
    if 'dilution' in cells and 'unflagged' in cells:
        avoid = {p: spread(cells['dilution'][10], cells['unflagged'][10], lo, hi, 10) for p, (lo, hi) in periods.items()}
        avoid['useful'] = bool(avoid['holdout']['ci95'][1] is not None and avoid['holdout']['ci95'][1] < 0
                               and (avoid['development']['flagged_minus_unflagged_pp'] or 0) < 0)
    return {
        'split': {'development_sessions': cut, 'holdout_sessions': len(sessions) - cut,
                  'holdout_from': sessions[cut] if cut < len(sessions) else None},
        'primary': primaries,
        'any_primary_holds': any(p['holds'] for p in primaries.values()),
        'secondary_selected': selected,
        'dilution_avoid_filter': avoid,
        'grid': grid,
    }


# ---- data: relay -----------------------------------------------------------------------------

_last_relay = [0.0]


def relay(params):
    url = f"{SERVICE}/api/lab/provider?{urllib.parse.urlencode(params)}"
    for attempt in range(8):
        wait = _last_relay[0] + 3.2 - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_relay[0] = time.monotonic()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/json'}), timeout=90) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 503, 502, 504):
                time.sleep(15 * (attempt + 1))
                continue
            if attempt >= 3:
                raise
            time.sleep(5 * (attempt + 1))
        except Exception:
            if attempt >= 5:
                raise
            time.sleep(5 * (attempt + 1))
    raise RuntimeError('RELAY_RETRIES_EXHAUSTED')


def relay_pages(params, max_pages=400):
    token, out = None, []
    for _ in range(max_pages):
        q = dict(params)
        if token:
            q['page_token'] = token
        body = relay(q)
        out.append(body)
        token = body.get('next_page_token') if isinstance(body, dict) else None
        if not token:
            break
    return out


def nasdaq_universe():
    out = {}
    for status in ('active', 'inactive'):
        for body in relay_pages({'resource': 'assets', 'status': status}, 1):
            for a in body if isinstance(body, list) else []:
                if a.get('exchange') == 'NASDAQ' and SYMBOL.match(a.get('symbol', '')) and not EXCLUDE.search(a.get('name') or ''):
                    out[a['symbol']] = {'status': status, 'name': a.get('name')}
    return out


def fetch_bars(symbols, cache_path):
    cached = {}
    if cache_path.exists():
        cached = json.loads(gzip.decompress(cache_path.read_bytes()))
    bars, done = cached.get('bars', {}), set(cached.get('done', []))
    todo = [s for s in symbols if s not in done]
    print(f'bars: {len(done)} cached, {len(todo)} to fetch', flush=True)
    started = time.time()
    for k in range(0, len(todo), 100):
        group = todo[k:k + 100]
        for start, end in WINDOWS:
            for body in relay_pages({'resource': 'bars', 'symbols': ','.join(group), 'timeframe': '1Day', 'start': start,
                                     'end': end, 'feed': 'sip', 'adjustment': 'split', 'limit': '10000', 'sort': 'asc'}):
                for s, lst in (body.get('bars') or {}).items():
                    arr = bars.setdefault(s, [])
                    for b in lst:
                        t = dt.datetime.fromisoformat(b['t'].replace('Z', '+00:00')).astimezone(NY).date().isoformat()
                        arr.append([t, b['o'], b['h'], b['l'], b['c'], b['v']])
        done.update(group)
        print(f'bars {min(k + 100, len(todo))}/{len(todo)} · {round((time.time() - started) / 60)} min', flush=True)
        if (k // 100) % 5 == 4 or k + 100 >= len(todo):
            cache_path.write_bytes(gzip.compress(json.dumps({'bars': bars, 'done': sorted(done)}).encode()))
    for s in bars:
        seen = {}
        for b in bars[s]:
            seen[b[0]] = b
        bars[s] = [seen[d] for d in sorted(seen) if d <= TO]
    return bars


# ---- data: EDGAR -----------------------------------------------------------------------------

LIMIT = RateLimiter(8)


def sec_json(url):
    LIMIT.wait()
    return json.loads(fetch(url, {'User-Agent': SEC_UA}, timeout=60, retries=4))


def insider_quarters():
    q, out = (2022, 4), []
    while q <= (2026, 3):
        out.append(f'{q[0]}q{q[1]}')
        q = (q[0] + (q[1] == 4), q[1] % 4 + 1)
    return out


def read_tsv(z, name):
    member = next((m for m in z.namelist() if m.upper().endswith(name)), None)
    if not member:
        return []
    with z.open(member) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding='utf-8', errors='replace'), delimiter='\t'))


def insider_data(diag):
    """Form 4 purchases and (symbol, issuer CIK) date intervals from the quarterly data sets."""
    purchases, pairs, quarters = {}, {}, {}
    for q in insider_quarters():
        url = f'https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/{q}_form345.zip'
        try:
            LIMIT.wait()
            raw = fetch(url, {'User-Agent': SEC_UA}, timeout=120, retries=4)
        except Exception as e:
            quarters[q] = f'UNAVAILABLE {str(e)[:80]}'
            continue
        z = zipfile.ZipFile(io.BytesIO(raw))
        subs = {}
        for r in read_tsv(z, 'SUBMISSION.TSV'):
            day = parse_date(r.get('FILING_DATE'))
            try:
                cik = int(r.get('ISSUERCIK') or 0)
            except ValueError:
                continue
            if not day or not cik:
                continue
            subs[r['ACCESSION_NUMBER']] = (day, cik, r.get('DOCUMENT_TYPE'))
            sym = norm_symbol(r.get('ISSUERTRADINGSYMBOL'))
            if sym:
                span = pairs.setdefault((sym, cik), [day, day])
                span[0], span[1] = min(span[0], day), max(span[1], day)
        owners = {}
        for r in read_tsv(z, 'REPORTINGOWNER.TSV'):
            owners.setdefault(r['ACCESSION_NUMBER'], r.get('RPTOWNERCIK'))
        n = 0
        for r in read_tsv(z, 'NONDERIV_TRANS.TSV'):
            if r.get('TRANS_CODE') != 'P' or r.get('TRANS_ACQUIRED_DISP_CD') != 'A':
                continue
            sub = subs.get(r['ACCESSION_NUMBER'])
            if not sub or sub[2] != '4':
                continue
            try:
                value = float(r.get('TRANS_SHARES') or 0) * float(r.get('TRANS_PRICEPERSHARE') or 0)
            except ValueError:
                continue
            if value <= 0:
                continue
            purchases.setdefault(sub[1], []).append((sub[0], owners.get(r['ACCESSION_NUMBER']) or r['ACCESSION_NUMBER'], value))
            n += 1
        quarters[q] = {'submissions': len(subs), 'purchases': n}
        print(f'insider {q}: {quarters[q]}', flush=True)
    diag['insider_quarters'] = quarters
    return purchases, pairs


def company_filings(cik):
    sub = sec_json(f'https://data.sec.gov/submissions/CIK{cik:010d}.json')
    blocks = [sub.get('filings', {}).get('recent', {})]
    for extra in sub.get('filings', {}).get('files', []):
        if extra.get('filingTo', '9999') >= EDGAR_SINCE:
            blocks.append(sec_json(f"https://data.sec.gov/submissions/{extra['name']}"))
    out = []
    keep = re.compile(r'^(8-K|424B\d|S-1|S-3|F-1|F-3)$')
    for b in blocks:
        for i, form in enumerate(b.get('form', [])):
            if not keep.match(form):
                continue
            acc = (b.get('acceptanceDateTime') or [''] * (i + 1))[i] or ''
            if acc[:10] < EDGAR_SINCE:
                continue
            out.append({'form': form, 'acc': acc[:16], 'items': (b.get('items') or [''] * (i + 1))[i] or ''})
    out.sort(key=lambda f: f['acc'])
    return out


def company_cash(cik):
    for tag in ('CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'):
        try:
            c = sec_json(f'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/us-gaap/{tag}.json')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            raise
        pts = sorted({(p['filed'], p['end'], p['val']) for p in c.get('units', {}).get('USD', [])
                      if p.get('filed') and p.get('end') and isinstance(p.get('val'), (int, float))})
        if pts:
            return [list(p) for p in pts]
    return []


def edgar(universe_symbols, cache_path, diag):
    if cache_path.exists():
        data = json.loads(gzip.decompress(cache_path.read_bytes()))
        print(f"edgar: cache with {len(data['filings'])} companies", flush=True)
        return data
    tickers = sec_json('https://www.sec.gov/files/company_tickers.json')
    current = {}
    for row in tickers.values():
        s = norm_symbol(row.get('ticker'))
        if s:
            current[s] = int(row['cik_str'])
    purchases, pairs = insider_data(diag)
    pairs = {k: v for k, v in pairs.items() if k[0] in universe_symbols}
    current = {s: c for s, c in current.items() if s in universe_symbols}
    ciks = sorted({c for _, c in pairs} | set(current.values()))
    print(f'edgar: {len(ciks)} companies for {len(universe_symbols)} symbols', flush=True)
    filings, cash, errors = {}, {}, 0
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {pool.submit(company_filings, c): c for c in ciks}
        for k, job in enumerate(cf.as_completed(jobs)):
            try:
                filings[jobs[job]] = job.result()
            except Exception as e:
                errors += 1
                if errors < 10:
                    print(f'submissions {jobs[job]}: {e}', flush=True)
            if k % 500 == 0:
                print(f'submissions {k}/{len(ciks)}', flush=True)
        need_cash = [c for c, fs in filings.items() if any(f['form'] in REGISTRATION for f in fs)]
        jobs = {pool.submit(company_cash, c): c for c in need_cash}
        for job in cf.as_completed(jobs):
            try:
                cash[jobs[job]] = job.result()
            except Exception:
                errors += 1
    diag['edgar_errors'] = errors
    wanted = set(ciks)
    data = {
        'current': current,
        'pairs': [[s, c, a, b] for (s, c), (a, b) in pairs.items()],
        'purchases': {str(c): v for c, v in purchases.items() if c in wanted},
        'filings': {str(c): v for c, v in filings.items()},
        'cash': {str(c): v for c, v in cash.items()},
    }
    cache_path.write_bytes(gzip.compress(json.dumps(data).encode()))
    return data


# ---- study -----------------------------------------------------------------------------------

def build_events(data, bars, diag):
    own = Ownership({(s, c): (a, b) for s, c, a, b in data['pairs']}, {s: int(c) for s, c in data['current'].items()})
    dates = {s: [b[0] for b in v] for s, v in bars.items()}
    events = []  # (hypothesis, symbol, entry_index, meta)
    counts = {'raw': {}, 'mapped': {}, 'eligible': {}}

    def place(hyp, cik, day, minute, meta):
        counts['raw'][hyp] = counts['raw'].get(hyp, 0) + 1
        for s in own.symbols_of(cik):
            if s not in bars or own.owner(s, day) != cik:
                continue
            i = entry_index(dates[s], day, minute)
            if i is None:
                continue
            counts['mapped'][hyp] = counts['mapped'].get(hyp, 0) + 1
            if not eligible(bars[s], i - 1):
                continue
            events.append((hyp, s, i, meta, day))
            counts['eligible'][hyp] = counts['eligible'].get(hyp, 0) + 1
            return

    for cik, fs in data['filings'].items():
        for hyp, day, minute, meta in filing_events(fs):
            place(hyp, int(cik), day, minute, meta)
    for cik, ps in data['purchases'].items():
        for day in insider_clusters([tuple(p) for p in ps]):
            place('insider_cluster', int(cik), day, None, 'P')
    diag['event_counts'] = counts
    return events, own


def run_study(data, bars, diag, diagnostics_only=False):
    sessions = sorted({b[0] for v in bars.values() for b in v if FROM <= b[0] <= TO})
    index = {d: k for k, d in enumerate(sessions)}
    events, own = build_events(data, bars, diag)
    cells = {name: {h: Cells(len(sessions)) for h in HORIZONS} for name in ['baseline', 'unflagged', *HYPOTHESES]}

    # event hypotheses, with de-duplication per symbol
    last = {}
    kept = []
    for hyp, s, i, meta, day in sorted(events, key=lambda e: (e[1], e[2])):
        b = bars[s]
        if hyp == 'earnings':
            gap = (b[i][1] / b[i - 1][4] - 1) * 100 if b[i - 1][4] > 0 else 0
            if gap >= 5:
                hyp = 'earnings_gap_up'
            elif gap <= -5:
                hyp = 'earnings_gap_down'
            else:
                continue
        if (s, hyp) in last and i - last[(s, hyp)] < DEDUPE_SESSIONS:
            continue
        last[(s, hyp)] = i
        k = index.get(b[i][0])
        g = gross_returns(b, i)
        if k is None or not g:
            continue
        for h in HORIZONS:
            if g[h] is not None:
                cells[hyp][h].add(k, g[h], h)
        kept.append({'h': hyp, 's': s, 'filed': day, 'entry': b[i][0], 'meta': meta,
                     'r5': r3(g[5]) if g[5] is not None else None})
    diag['events_kept'] = {h: sum(1 for e in kept if e['h'] == h) for h in HYPOTHESES}

    # baseline and dilution flag over every eligible stock-day
    registrations = {int(c): sorted(f['acc'][:10] for f in fs if f['form'] in REGISTRATION) for c, fs in data['filings'].items()}
    cash = {int(c): cash_index(v) for c, v in data['cash'].items()}
    no_cash = ([], [])
    owner_cache = {}
    flagged = unknown = 0
    for s, b in bars.items():
        for i in range(22, len(b)):
            k = index.get(b[i][0])
            if k is None or not eligible(b, i - 1):
                continue
            g = gross_returns(b, i)
            if not g:
                continue
            month = b[i][0][:7]
            if (s, month) not in owner_cache:
                owner_cache[(s, month)] = own.owner(s, month + '-15')
            cik = owner_cache[(s, month)]
            flag = dilution_flag(b[i][0], registrations.get(cik, []), cash.get(cik, no_cash)) if cik else None
            flagged += flag is True
            unknown += flag is None
            for h in HORIZONS:
                if g[h] is None:
                    continue
                cells['baseline'][h].add(k, g[h], h)
                if flag is True:
                    cells['dilution'][h].add(k, g[h], h)
                elif flag is False:
                    cells['unflagged'][h].add(k, g[h], h)
    diag['stock_days'] = {'eligible': sum(cells['baseline'][1].n), 'dilution_flagged': flagged, 'flag_unknown': unknown}
    if diagnostics_only:
        return {'diagnostics': diag, 'sessions': len(sessions)}
    result = analyze(cells, sessions)
    result['sessions'] = len(sessions)
    result['first_session'], result['last_session'] = sessions[0], sessions[-1]
    result['recent_events'] = sorted(kept, key=lambda e: e['entry'])[-60:]
    result['diagnostics'] = diag
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit-symbols', type=int)
    ap.add_argument('--diagnostics-only', action='store_true')
    ap.add_argument('--cache', default='catalyst-cache')
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    args = ap.parse_args()
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    diag = {}
    uni_path = cache / 'universe.json'
    if uni_path.exists():
        uni = json.loads(uni_path.read_text())
    else:
        uni = nasdaq_universe()
        uni_path.write_text(json.dumps(uni))
    symbols = sorted(uni)[:args.limit_symbols] if args.limit_symbols else sorted(uni)
    diag['universe'] = {'symbols': len(symbols), 'inactive': sum(1 for s in symbols if uni[s]['status'] == 'inactive')}
    print(f"universe: {diag['universe']}", flush=True)
    data = edgar(set(symbols), cache / 'edgar.json.gz', diag)
    bars = fetch_bars(symbols, cache / 'bars.json.gz')
    bars = {s: v for s, v in bars.items() if s in set(symbols)}
    mapped = {s for s in symbols if s in data['current']} | {p[0] for p in data['pairs']}
    diag['mapping'] = {'symbols_with_cik': len(mapped & set(symbols)),
                       'inactive_with_cik': sum(1 for s in mapped if s in uni and uni[s]['status'] == 'inactive'),
                       'companies': len(data['filings']), 'symbols_with_bars': len(bars)}
    print(f"mapping: {diag['mapping']}", flush=True)
    report = run_study(data, bars, diag, args.diagnostics_only)
    report = {'schema': 1, 'protocol': 'catalyst-study-1', 'updated_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
              'status': 'DIAGNOSTICS_ONLY' if args.diagnostics_only else 'RESEARCH_EVIDENCE',
              'profitability_claim_allowed': False,
              'costs': {'round_trip_pp': COST, 'short_borrow_pp_per_session': BORROW,
                        'sensitivity': {'round_trip_pp': COST_HI, 'short_borrow_pp_per_session': BORROW_HI}},
              'primary_specs': {k: {'hypothesis': v[0], 'direction': 'long' if v[1] > 0 else 'short', 'horizon': v[2]} for k, v in PRIMARY.items()},
              **report}
    if args.diagnostics_only:
        print(json.dumps(report, indent=1))
        return
    Path(args.out).write_text(json.dumps(report, separators=(',', ':')) + '\n')
    brief = {k: {x: v[x] for x in ('development', 'holdout', 'baseline_holdout', 'holds', 'holds_bonferroni')} for k, v in report['primary'].items()}
    print(json.dumps({'primary': brief, 'any_primary_holds': report['any_primary_holds'],
                      'secondary_selected': report['secondary_selected'], 'dilution_avoid_filter': report['dilution_avoid_filter'],
                      'diagnostics': report['diagnostics']}, indent=1))


if __name__ == '__main__':
    main()
