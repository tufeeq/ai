"""Scheduled-catalyst study for Nasdaq small caps: does the run-up into a KNOWN date pay, and does the
stock get sold after the news?

Protocol calendar-study-1. The protocol was fixed on 2026-10-02, BEFORE any return was computed. The first run
prints only data diagnostics (event counts, how well dates parse, how well earnings dates are predicted).

The idea (from the owner)
  Some dates are known in advance: earnings releases, FDA decision dates (PDUFA). The theory is that holders
  buy gradually into the date, the news lands, the stock spikes, and then early buyers sell into the news.
  Long only: buy several sessions BEFORE the date and sell at the close of the session before it. Do not
  hold through the binary news. Buying AFTER the news is tested as an avoid rule.

Data (free only; prices and SEC filings reuse catalyst-study-1's cached artifact)
  - Prices: consolidated (SIP) split-adjusted daily bars for Nasdaq listings, active and inactive,
    2022-11-15 -> 2026-09-24.
  - Earnings: SEC 8-K item 2.02 (results of operations) acceptance times per company.
  - FDA dates: SEC EDGAR full-text search for "PDUFA" in 8-K and 6-K filings, 2022-06-01 -> 2026-09-24.
    The exhibit text is parsed for the target action date.
  - Ticker <-> CIK point-in-time mapping is the same as in catalyst-study-1.

Events (no look-ahead)
  E  earnings, PREDICTED date. A company's 8-K 2.02 on day a predicts its next-year report on
     P = a + 364 days (same weekday). P is known a year ahead. Repeated 2.02 filings within 30 days count once.
     Skip the event when the company already filed a 2.02 in the 40 days before entry: it has
     already reported this quarter.
  EO earnings, ACTUAL date ("oracle"). This uses the real 2.02 date as if a confirmed calendar date were
     known in advance. This is only realistic for companies that confirm their dates (Nasdaq's
     calendar), so it is secondary and labelled as such.
  B  FDA PDUFA date D, taken from the first 8-K/6-K that announced it (file day f).
     - The date is the first "Month D, YYYY" within 250 characters after a PDUFA mention (or 120 before it),
       with f + 7 days <= D <= f + 400 days.
     - A filing that says the FDA approved, or that mentions a complete response letter, is a decision
       notice and never a source.
     - D is cancelled from the first later filing (before D) that announces a later date for the same
       company together with the word "extend".
     - D is dropped when a decision notice by the company is filed between f and entry, or when D is
       cancelled before entry.

Trades (entry at an open, exit at a close; eligibility on the bar before entry: close $0.50-$20,
20-day average dollar volume >= $300K, >= 21 prior bars; costs 0.5 pp round trip, sensitivity 1.0 pp)
  - Run-up trades (E, EO, B): let s* be the first session on or after the date. Enter at the open of s* - k,
    exit at the close of s* - 1, holding k sessions, for k in {3, 5, 10}. B also requires the entry
    session to be after f.
  - After-news (avoid) trades:
    - A  enter at the open after the actual 2.02, by catalyst-study-1's rule (same session if accepted
      before 09:15 New York, else the next). Only when the stock rose >= 10% from close s*-6 to close s*-1.
      Hold h in {1, 3, 5}.
    - BA enter at the open of the first session after D, for every B event not cancelled before D.
      Hold h in {1, 3, 5}.
  - Same symbol and same family within 5 sessions: keep the first.

Pre-registered primaries (long)
  E_run5   predicted earnings date, k = 5
  B_run10  PDUFA date, k = 10
A primary HOLDS only if all of these are true:
  - development mean > 0;
  - holdout mean > 0;
  - holdout 95% lower bound > 0;
  - >= 30 holdout trades;
  - holdout mean > the same-horizon baseline (every eligible stock-day).
B_run10 must also beat the baseline made of the stock-days of the PDUFA companies themselves.
The Bonferroni (2 tests) lower bound is also reported.

Avoid rules: A (h = 3) and BA (h = 3) are USEFUL as "do not buy after the news" warnings if the
development mean < 0 and the holdout 95% upper bound < 0.

Split: sessions 2023-01-03 -> 2026-09-24, development = first two thirds, holdout = last third. CIs come from
a moving-block bootstrap over sessions (block 10, 2000 draws). The grid (all k and h) is shown. Nothing is
re-picked after the holdout is seen.

Research evidence only: daily bars are not fills; no orders are placed.

Usage: python3 calendar_study.py --cache DIR [--diagnostics-only] [--out PATH]
"""
import argparse
import bisect
import concurrent.futures as cf
import datetime as dt
import gzip
import html
import json
import math
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import catalyst_study as cs  # noqa: E402
from enrich import fetch, SEC_UA  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / 'data/calendar-study.json'
RUNUPS = (3, 5, 10)
AFTER = (1, 3, 5)
PRIMARY = {'E_run5': ('E', 5), 'B_run10': ('B', 10)}
FAMILIES = ['E', 'EO', 'B', 'A', 'BA']
FTS_FROM, FTS_TO = '2022-06-01', cs.TO
DEDUPE = 5
RUNUP_FOR_A = 10.0

MONTHS = {m: k + 1 for k, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
                                          'september', 'october', 'november', 'december'])}
MONTHS.update({m[:3]: v for m, v in list(MONTHS.items())})
MONTHS['sept'] = 9
DATE_RE = re.compile(r'\b(January|February|March|April|May|June|July|August|September|October|November|December|'
                     r'Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b')
PDUFA_RE = re.compile(r'PDUFA', re.I)
DECISION_RE = re.compile(r'\b(FDA|Food and Drug Administration)\b[^.]{0,80}\b(has\s+)?approved\b|\bcomplete response letter\b|\bCRL\b', re.I)
EXTEND_RE = re.compile(r'\bextend', re.I)


# ---- pure helpers (unit tested) --------------------------------------------------------------

def text_of(raw):
    """HTML/text exhibit -> plain text with single spaces."""
    t = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', raw)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = html.unescape(t).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', t)


def parse_pdufa(text, filed):
    """-> {'date': 'YYYY-MM-DD' | None, 'decision': bool, 'extension': bool} for one filing's text."""
    decision = bool(DECISION_RE.search(text))
    best = None
    extension = False
    lo, hi = cs.add_days(filed, 7), cs.add_days(filed, 400)
    for m in PDUFA_RE.finditer(text):
        window_after = text[m.end():m.end() + 250]
        window_before = text[max(0, m.start() - 120):m.start()]
        found = None
        for w in (window_after, window_before):
            for d in DATE_RE.finditer(w):
                try:
                    day = dt.date(int(d.group(3)), MONTHS[d.group(1).lower().rstrip('.')], int(d.group(2))).isoformat()
                except ValueError:
                    continue
                if lo <= day <= hi:
                    found = day
                    break
            if found:
                break
        if found:
            if EXTEND_RE.search(window_before + window_after):
                extension = True
            if best is None:
                best = found
    return {'date': best, 'decision': decision, 'extension': extension}


def pdufa_events(mentions):
    """mentions for one company: [(filed, date|None, decision, extension)] -> [(D, f, cancel_day|None, decision_days)].
    D is announced first on f; cancelled from the first later filing (before D) that announces a later date with
    an extension; decision_days are the filing days of decision notices (used to drop events)."""
    mentions = sorted(mentions, key=lambda m: (m[0], m[1] or ""))
    decisions = sorted(f for f, _, dec, _ in mentions if dec)
    first = {}
    for f, d, dec, _ in mentions:
        if d and not dec and d not in first:
            first[d] = f
    out = []
    for d, f in sorted(first.items()):
        cancel = None
        for f2, d2, dec2, ext2 in mentions:
            if f2 > f and f2 < d and d2 and d2 > d and ext2 and not dec2:
                cancel = f2
                break
        out.append((d, f, cancel, decisions))
    return out


def earnings_days(filings):
    """Company filings -> sorted 8-K 2.02 (day, minute), repeats within 30 days dropped."""
    out = []
    for f in filings:
        if f['form'] != '8-K' or '2.02' not in (f.get('items') or ''):
            continue
        t = cs.parse_acceptance(f['acc'])
        if not t:
            continue
        if out and t[0] <= cs.add_days(out[-1][0], 30):
            continue
        out.append(t)
    return out


def predicted_dates(days):
    """[(day, minute)] of actual reports -> [(predicted day, source day)] one year ahead (same weekday)."""
    return [(cs.add_days(d, 364), d) for d, _ in days]


def reported_recently(days, entry_day, window=40):
    lo = cs.add_days(entry_day, -window)
    return any(lo <= d < entry_day for d, _ in days)


def session_on_or_after(dates, day, max_gap=7):
    i = bisect.bisect_left(dates, day)
    if i >= len(dates) or dates[i] > cs.add_days(day, max_gap):
        return None
    return i


def runup_trade(bars, dates, day, k):
    """(entry index, gross % from open of s*-k to close of s*-1) or None."""
    s = session_on_or_after(dates, day)
    if s is None or s - k < 22:
        return None
    i = s - k
    if not cs.eligible(bars, i - 1) or not bars[i][1] or bars[i][1] <= 0 or bars[s - 1][4] <= 0:
        return None
    return i, (bars[s - 1][4] / bars[i][1] - 1) * 100


def after_trade(bars, i, h):
    j = i + h - 1
    if j >= len(bars) or not bars[i][1] or bars[i][1] <= 0 or bars[j][4] <= 0:
        return None
    return (bars[j][4] / bars[i][1] - 1) * 100


# ---- statistics ------------------------------------------------------------------------------

def summarize(c, lo, hi, h, cost=cs.COST, tests=2):
    n = sum(c.n[lo:hi])
    if not n:
        return {'trades': 0, 'days': 0, 'mean_pct': None, 'ci95': None, 'lb_bonferroni': None, 'win_rate': None}
    g = sum(c.s[lo:hi]) / n
    boot = [x - cost for x in cs.block_bootstrap(c.s, c.n, lo, hi)]
    boot.sort()
    return {'trades': n, 'days': sum(1 for k in range(lo, hi) if c.n[k]), 'mean_pct': cs.r3(g - cost),
            'ci95': [cs.r3(cs.quantile(boot, 0.025)), cs.r3(cs.quantile(boot, 0.975))],
            'lb_bonferroni': cs.r3(cs.quantile(boot, 0.05 / tests / 2)),
            'win_rate': cs.r3(sum(c.pos[1][lo:hi]) / n) if cost == cs.COST else None}


def analyze(cells, sessions):
    cut = len(sessions) * 2 // 3
    periods = {'development': (0, cut), 'holdout': (cut, len(sessions))}
    grid = {}
    for name, hs in cells.items():
        grid[name] = {}
        for h, c in hs.items():
            row = {p: summarize(c, lo, hi, h) for p, (lo, hi) in periods.items()}
            row['holdout_high_cost'] = summarize(c, cut, len(sessions), h, cs.COST_HI)
            grid[name][f'H{h}'] = row
    primary = {}
    for key, (fam, k) in PRIMARY.items():
        row = grid[fam][f'H{k}']
        base = grid['baseline'][f'H{k}']['holdout']
        ok = cs.verdict(row['development'], row['holdout'], base)
        extra = None
        if fam == 'B':
            extra = grid['baseline_pdufa_names'][f'H{k}']['holdout']
            ok = ok and row['holdout']['mean_pct'] is not None and extra['mean_pct'] is not None and row['holdout']['mean_pct'] > extra['mean_pct']
        primary[key] = {'family': fam, 'sessions_held': k, **row, 'baseline_holdout': base, 'names_baseline_holdout': extra,
                        'holds': bool(ok), 'holds_bonferroni': bool(ok and (row['holdout']['lb_bonferroni'] or -1) > 0)}
    avoid = {}
    for fam in ('A', 'BA'):
        row = grid[fam]['H3']
        d, h = row['development'], row['holdout']
        avoid[fam] = {**row, 'useful': bool(d['mean_pct'] is not None and d['mean_pct'] < 0 and h['ci95'] and h['ci95'][1] is not None and h['ci95'][1] < 0)}
    return {'split': {'development_sessions': cut, 'holdout_sessions': len(sessions) - cut, 'holdout_from': sessions[cut]},
            'primary': primary, 'any_primary_holds': any(p['holds'] for p in primary.values()), 'avoid': avoid, 'grid': grid}


# ---- data: EDGAR full-text search ------------------------------------------------------------

def months(a, b):
    d = dt.date.fromisoformat(a).replace(day=1)
    end = dt.date.fromisoformat(b)
    while d <= end:
        nxt = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield d.isoformat(), min(end, nxt - dt.timedelta(days=1)).isoformat()
        d = nxt


def fts_hits(start, end, query='"PDUFA"', forms='8-K,6-K'):
    out, offset = [], 0
    while True:
        q = urllib.parse.urlencode({'q': query, 'forms': forms, 'dateRange': 'custom', 'startdt': start, 'enddt': end, 'from': offset})
        body = cs.sec_json(f'https://efts.sec.gov/LATEST/search-index?{q}')
        hits = body.get('hits', {}).get('hits', [])
        for h in hits:
            src = h.get('_source', {})
            adsh, _, name = h.get('_id', '').partition(':')
            for cik in src.get('ciks', [])[:1]:
                out.append({'cik': int(cik), 'adsh': adsh, 'file': name, 'filed': src.get('file_date'), 'form': src.get('form')})
        offset += len(hits)
        total = body.get('hits', {}).get('total', {}).get('value', 0)
        if not hits or offset >= min(total, 9900):
            return out


def doc_url(hit):
    return f"https://www.sec.gov/Archives/edgar/data/{hit['cik']}/{hit['adsh'].replace('-', '')}/{hit['file']}"


def pdufa_mentions(cache_path, start=FTS_FROM, end=FTS_TO, diag=None):
    cached = json.loads(gzip.decompress(cache_path.read_bytes())) if cache_path.exists() else {'months': {}, 'docs': {}}
    for a, b in months(start, end):
        if a in cached['months'] and b < dt.date.today().isoformat():
            continue
        cached['months'][a] = fts_hits(a, b)
        print(f'fts {a}: {len(cached["months"][a])} hits', flush=True)
    hits = [h for hs in cached['months'].values() for h in hs if h['filed']]
    todo = [h for h in hits if doc_url(h) not in cached['docs']]
    print(f'pdufa docs: {len(hits)} hits, {len(todo)} to fetch', flush=True)

    def one(h):
        cs.LIMIT.wait()
        raw = fetch(doc_url(h), {'User-Agent': SEC_UA}, timeout=60, retries=3)
        p = parse_pdufa(text_of(raw.decode('utf-8', 'replace')), h['filed'])
        return doc_url(h), [p['date'], p['decision'], p['extension']]

    errors = 0
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        for k, job in enumerate(cf.as_completed([pool.submit(one, h) for h in todo])):
            try:
                url, parsed = job.result()
                cached['docs'][url] = parsed
            except Exception:
                errors += 1
            if k % 500 == 499:
                print(f'pdufa docs {k + 1}/{len(todo)}', flush=True)
                cache_path.write_bytes(gzip.compress(json.dumps(cached).encode()))
    cache_path.write_bytes(gzip.compress(json.dumps(cached).encode()))
    by_cik = {}
    for h in hits:
        p = cached['docs'].get(doc_url(h))
        if p:
            by_cik.setdefault(h['cik'], []).append((h['filed'], p[0], p[1], p[2]))
    if diag is not None:
        docs = [cached['docs'][doc_url(h)] for h in hits if doc_url(h) in cached['docs']]
        diag['pdufa'] = {'hits': len(hits), 'docs_parsed': len(docs), 'fetch_errors': errors,
                         'with_date': sum(1 for d in docs if d[0]), 'decision_notices': sum(1 for d in docs if d[1]),
                         'extensions': sum(1 for d in docs if d[2]), 'companies': len(by_cik)}
    return by_cik


# ---- study -----------------------------------------------------------------------------------

def run_study(data, bars, pdufa, diag, diagnostics_only=False):
    sessions = sorted({b[0] for v in bars.values() for b in v if cs.FROM <= b[0] <= cs.TO})
    index = {d: k for k, d in enumerate(sessions)}
    own = cs.Ownership({(s, c): (a, b) for s, c, a, b in data['pairs']}, {s: int(c) for s, c in data['current'].items()})
    dates = {s: [b[0] for b in v] for s, v in bars.items()}
    cells = {f: {h: cs.Cells(len(sessions)) for h in (AFTER if f in ('A', 'BA') else RUNUPS)} for f in FAMILIES}
    cells['baseline'] = {h: cs.Cells(len(sessions)) for h in RUNUPS + AFTER}
    cells['baseline_pdufa_names'] = {h: cs.Cells(len(sessions)) for h in RUNUPS}
    counts = {f: {'events': 0, 'mapped': 0, 'kept': 0} for f in FAMILIES}
    kept = []
    last = {}
    pdufa_symbols = set()

    def symbol_for(cik, day):
        for s in own.symbols_of(cik):
            if s in bars and own.owner(s, day) == cik:
                return s
        return None

    def add(fam, s, i, h, g, meta):
        k = index.get(bars[s][i][0])
        if k is None or g is None:
            return False
        cells[fam][h].add(k, g, h)
        return True

    def fresh(fam, s, i):
        j = last.get((fam, s))
        if j is not None and abs(i - j) < DEDUPE:
            return False
        last[(fam, s)] = i
        return True

    # earnings: predicted (E), actual "oracle" (EO), after-news (A)
    hits = {'within_3d': 0, 'within_7d': 0, 'predicted': 0}
    for cik, fs in data['filings'].items():
        cik = int(cik)
        days = earnings_days(fs)
        actual = [d for d, _ in days]
        for p, src in predicted_dates(days):
            if not (cs.FROM <= p <= cs.TO):
                continue
            counts['E']['events'] += 1
            hits['predicted'] += 1
            j = bisect.bisect_left(actual, cs.add_days(p, -7))
            near = [abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(p)).days) for a in actual[j:j + 3]]
            hits['within_3d'] += any(x <= 3 for x in near)
            hits['within_7d'] += any(x <= 7 for x in near)
            s = symbol_for(cik, p)
            if not s:
                continue
            counts['E']['mapped'] += 1
            sx = session_on_or_after(dates[s], p)
            if sx is None or not fresh('E', s, sx):
                continue
            first = True
            for k in RUNUPS:
                t = runup_trade(bars[s], dates[s], p, k)
                if not t or reported_recently(days, bars[s][t[0]][0]):
                    continue
                if add('E', s, t[0], k, t[1], src) and first:
                    counts['E']['kept'] += 1
                    first = False
                    kept.append({'f': 'E', 's': s, 'date': p, 'entry': bars[s][t[0]][0], 'r': cs.r3(t[1])})
        for d, minute in days:
            if not (cs.FROM <= d <= cs.TO):
                continue
            counts['EO']['events'] += 1
            s = symbol_for(cik, d)
            if not s:
                continue
            counts['EO']['mapped'] += 1
            sx = session_on_or_after(dates[s], d)
            if sx is None:
                continue
            first = fresh('EO', s, sx)
            for k in RUNUPS if first else ():
                t = runup_trade(bars[s], dates[s], d, k)
                if not t or reported_recently(days, bars[s][t[0]][0]):
                    continue
                if add('EO', s, t[0], k, t[1], d) and first:
                    counts['EO']['kept'] += 1
                    first = False
            # after the news, only following a run-up
            i = cs.entry_index(dates[s], d, minute)
            if i is None or sx < 7 or not cs.eligible(bars[s], i - 1):
                continue
            run = (bars[s][sx - 1][4] / bars[s][sx - 6][4] - 1) * 100 if bars[s][sx - 6][4] > 0 else 0
            counts['A']['events'] += 1  # eligible after-news entries; 'mapped' = those after a >= 10% run-up
            if run < RUNUP_FOR_A or not fresh('A', s, i):
                continue
            counts['A']['mapped'] += 1
            ok = False
            for h in AFTER:
                ok |= add('A', s, i, h, after_trade(bars[s], i, h), d)
            counts['A']['kept'] += ok

    # FDA PDUFA dates: run-up (B) and after the date (BA)
    for cik, mentions in pdufa.items():
        for d, f, cancel, decisions in pdufa_events(mentions):
            if not (cs.FROM <= d <= cs.TO):
                continue
            counts['B']['events'] += 1
            s = symbol_for(cik, d)
            if not s:
                continue
            counts['B']['mapped'] += 1
            pdufa_symbols.add(s)
            sx = session_on_or_after(dates[s], d)
            if sx is None or not fresh('B', s, sx):
                continue
            first = True
            for k in RUNUPS:
                t = runup_trade(bars[s], dates[s], d, k)
                if not t:
                    continue
                entry = bars[s][t[0]][0]
                if entry <= f or (cancel and cancel <= entry) or any(f < x <= entry for x in decisions):
                    continue
                if add('B', s, t[0], k, t[1], d) and first:
                    counts['B']['kept'] += 1
                    first = False
                    kept.append({'f': 'B', 's': s, 'date': d, 'announced': f, 'entry': entry, 'r': cs.r3(t[1])})
            if cancel:
                continue
            i = bisect.bisect_right(dates[s], d)
            if i >= len(dates[s]) or i < 22 or dates[s][i] > cs.add_days(d, 7) or not cs.eligible(bars[s], i - 1):
                continue
            counts['BA']['events'] += 1
            if not fresh('BA', s, i):
                continue
            ok = False
            for h in AFTER:
                ok |= add('BA', s, i, h, after_trade(bars[s], i, h), d)
            counts['BA']['kept'] += ok

    # baselines: every eligible stock-day; and the stock-days of PDUFA companies
    for s, b in bars.items():
        for i in range(22, len(b)):
            k = index.get(b[i][0])
            if k is None or not cs.eligible(b, i - 1) or not b[i][1] or b[i][1] <= 0:
                continue
            for h in RUNUPS + AFTER:
                j = i + h - 1
                if j < len(b) and b[j][4] > 0:
                    g = (b[j][4] / b[i][1] - 1) * 100
                    cells['baseline'][h].add(k, g, h)
                    if s in pdufa_symbols and h in RUNUPS:
                        cells['baseline_pdufa_names'][h].add(k, g, h)
    diag['events'] = counts
    diag['earnings_prediction'] = {**hits, 'share_within_3d': cs.r3(hits['within_3d'] / max(1, hits['predicted'])),
                                   'share_within_7d': cs.r3(hits['within_7d'] / max(1, hits['predicted']))}
    diag['pdufa_symbols'] = len(pdufa_symbols)
    diag['sample_pdufa'] = [e for e in kept if e['f'] == 'B'][:15]
    if diagnostics_only:
        return {'diagnostics': diag, 'sessions': len(sessions)}
    result = analyze(cells, sessions)
    result.update({'sessions': len(sessions), 'first_session': sessions[0], 'last_session': sessions[-1],
                   'recent_events': sorted(kept, key=lambda e: e['entry'])[-60:], 'diagnostics': diag})
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='catalyst-cache')
    ap.add_argument('--diagnostics-only', action='store_true')
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    args = ap.parse_args()
    cache = Path(args.cache)
    for name in ('universe.json', 'edgar.json.gz', 'bars.json.gz'):
        if not (cache / name).exists():
            raise SystemExit(f'missing {cache / name}: restore the catalyst-cache artifact first')
    diag = {}
    uni = json.loads((cache / 'universe.json').read_text())
    data = json.loads(gzip.decompress((cache / 'edgar.json.gz').read_bytes()))
    raw = json.loads(gzip.decompress((cache / 'bars.json.gz').read_bytes()))['bars']
    bars = {}
    for s, lst in raw.items():
        if s not in uni:
            continue
        seen = {b[0]: b for b in lst}
        bars[s] = [seen[d] for d in sorted(seen) if d <= cs.TO]
    print(f'bars for {len(bars)} symbols; filings for {len(data["filings"])} companies', flush=True)
    pdufa = pdufa_mentions(cache / 'pdufa.json.gz', diag=diag)
    report = run_study(data, bars, pdufa, diag, args.diagnostics_only)
    report = {'schema': 1, 'protocol': 'calendar-study-1', 'updated_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
              'status': 'DIAGNOSTICS_ONLY' if args.diagnostics_only else 'RESEARCH_EVIDENCE', 'profitability_claim_allowed': False,
              'costs': {'round_trip_pp': cs.COST, 'sensitivity_round_trip_pp': cs.COST_HI},
              'primary_specs': {k: {'family': f, 'sessions_held': h} for k, (f, h) in PRIMARY.items()}, **report}
    if args.diagnostics_only:
        print(json.dumps(report, indent=1))
        return
    Path(args.out).write_text(json.dumps(report, separators=(',', ':')) + '\n')
    for name, rows in report['grid'].items():
        for spec, row in rows.items():
            d, h = row['development'], row['holdout']
            print(f"GRID {name:20s} {spec:4s} dev n={d['trades']:>7} mean={d['mean_pct']} ci={d['ci95']} | hold n={h['trades']:>7} mean={h['mean_pct']} ci={h['ci95']} | hold@1pp={row['holdout_high_cost']['mean_pct']}")
    brief = {k: {x: v[x] for x in ('development', 'holdout', 'baseline_holdout', 'names_baseline_holdout', 'holds', 'holds_bonferroni')} for k, v in report['primary'].items()}
    print(json.dumps({'primary': brief, 'any_primary_holds': report['any_primary_holds'],
                      'avoid': {k: {x: v[x] for x in ('development', 'holdout', 'useful')} for k, v in report['avoid'].items()},
                      'diagnostics': report['diagnostics']}, indent=1))


if __name__ == '__main__':
    main()
