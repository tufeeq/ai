"""Upcoming scheduled catalysts for the small-cap universe: earnings dates and FDA decision (PDUFA) dates.

Writes tagit-next/data/catalyst-calendar.json. This is information, not a signal. Whether the run-up into
these dates pays is the question of calendar-study-1 (calendar_study.py). Until that study holds, the site
shows only the dates.

Sources (free):
  - Earnings: the Nasdaq.com earnings calendar (api.nasdaq.com/api/calendar/earnings?date=), next 21 days.
  - FDA: SEC EDGAR full-text search for "PDUFA" in 8-K/6-K filings over the last 13 months, parsed as in
    calendar_study.py. Future dates only; a date counts as cancelled when the company later announced
    an extension, and as passed when it later filed a decision notice.
"""
import argparse
import datetime as dt
import json
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import calendar_study as cal  # noqa: E402
import catalyst_study as cs  # noqa: E402
from enrich import BROWSER_UA, fetch  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tagit-next/data/catalyst-calendar.json'
UNIVERSE = ROOT / 'tag/data/universe-broad.json'
MAX_CAP_MILLIONS = 300
EARNINGS_DAYS = 21


def universe():
    rows = json.loads(UNIVERSE.read_text())['rows']
    out = {}
    for r in rows:
        try:
            cap = float(r.get('Market Cap') or 0)
        except ValueError:
            continue
        if 0 < cap < MAX_CAP_MILLIONS:
            out[r['Ticker']] = {'name': r.get('Company'), 'market_cap_m': round(cap, 1), 'industry': r.get('Industry')}
    return out


def nasdaq_earnings(day):
    body = json.loads(fetch(f'https://api.nasdaq.com/api/calendar/earnings?{urllib.parse.urlencode({"date": day})}',
                            {'User-Agent': BROWSER_UA, 'Accept': 'application/json'}, timeout=30))
    return ((body.get('data') or {}).get('rows')) or []


TIMES = {'time-pre-market': 'PRE_MARKET', 'time-after-hours': 'AFTER_HOURS'}


def upcoming_earnings(uni, today):
    out, errors = [], 0
    for n in range(EARNINGS_DAYS + 1):
        day = (today + dt.timedelta(days=n))
        if day.weekday() >= 5:
            continue
        try:
            rows = nasdaq_earnings(day.isoformat())
        except Exception as e:
            errors += 1
            print(f'earnings {day}: {e}', flush=True)
            continue
        for r in rows:
            s = (r.get('symbol') or '').strip().upper()
            if s in uni:
                out.append({'symbol': s, 'date': day.isoformat(), 'time': TIMES.get(r.get('time'), 'UNSPECIFIED'),
                            'fiscal_quarter': r.get('fiscalQuarterEnding') or None, **uni[s]})
    return out, errors


def upcoming_fda(uni, today, cache):
    tickers = cs.sec_json('https://www.sec.gov/files/company_tickers.json')
    by_cik = {}
    for row in tickers.values():
        s = cs.norm_symbol(row.get('ticker'))
        if s in uni:
            by_cik.setdefault(int(row['cik_str']), s)
    start = (today - dt.timedelta(days=400)).isoformat()
    diag = {}
    mentions = cal.pdufa_mentions(cache, start=start, end=today.isoformat(), diag=diag)
    out = []
    for cik, ms in mentions.items():
        s = by_cik.get(cik)
        if not s:
            continue
        for d, f, cancel, decisions in cal.pdufa_events(ms):
            if d < today.isoformat() or cancel or any(x > f for x in decisions):
                continue
            out.append({'symbol': s, 'date': d, 'announced': f, **uni[s]})
    return out, diag


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(OUT))
    ap.add_argument('--cache', default='calendar-cache/pdufa-recent.json.gz')
    args = ap.parse_args()
    today = dt.datetime.now(cal.cs.NY).date() if cal.cs.NY else dt.date.today()
    uni = universe()
    Path(args.cache).parent.mkdir(parents=True, exist_ok=True)
    earnings, errors = upcoming_earnings(uni, today)
    fda, diag = upcoming_fda(uni, today, Path(args.cache))
    print(f'universe {len(uni)} · earnings {len(earnings)} (errors {errors}) · fda {len(fda)} · {diag}', flush=True)
    if errors > EARNINGS_DAYS // 2:
        raise SystemExit('Nasdaq earnings calendar mostly unavailable; keep the last file')
    payload = {
        'schema': 1, 'updated_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'as_of_day': today.isoformat(),
        'universe': f'US-listed stocks below ${MAX_CAP_MILLIONS}M market cap', 'purpose': 'INFORMATION_NOT_SIGNALS',
        'study': 'calendar-study-1', 'sources': {'earnings': 'Nasdaq.com earnings calendar', 'fda': 'SEC EDGAR full-text search (PDUFA) in 8-K/6-K'},
        'earnings': sorted(earnings, key=lambda e: (e['date'], e['symbol'])),
        'fda': sorted(fda, key=lambda e: (e['date'], e['symbol'])),
        'diagnostics': {'earnings_errors': errors, **diag},
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
