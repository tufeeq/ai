"""Upcoming scheduled catalysts for the small-cap universe: earnings dates and FDA decision (PDUFA) dates.

Writes tagit-next/data/catalyst-calendar.json. This is information, not a signal. Whether the run-up into
these dates pays is the question of calendar-study-1 (calendar_study.py). Until that study holds, the site
shows only the dates.

Also lists symbols that reported in the last few sessions after a run-up of 10% or more. calendar-study-1 found
that buying after such a report loses money (avoid rule A, holdout 2025-06 -> 2026-09: -1.40% net over
3 sessions, 95% CI [-3.01, -0.34]). The site shows a "do not buy after the news" warning for 3 sessions.

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


RUNUP_WARN_PCT = 10.0
RECENT_DAYS = 7


def add_weekdays(day, n):
    while n > 0:
        day += dt.timedelta(days=1)
        if day.weekday() < 5:
            n -= 1
    return day


def after_news_entry(report_day, time, closes):
    """closes: [(day, close)] sorted, any days. Run-up = last close before the report day over the close 5
    sessions earlier (calendar-study-1 rule A). The reaction session is the report day for a pre-market
    report, else the next weekday; the warning lasts 3 sessions from it."""
    before = [c for d, c in closes if d < report_day.isoformat()]
    if len(before) < 6 or not before[-6] > 0:
        return None
    runup = (before[-1] / before[-6] - 1) * 100
    reaction = report_day if time == 'PRE_MARKET' else add_weekdays(report_day, 1)
    return {'runup_pct': round(runup, 2), 'reaction_day': reaction.isoformat(), 'warn_until': add_weekdays(reaction, 2).isoformat()}


def recent_reports(uni, today):
    reports, errors = [], 0
    for n in range(RECENT_DAYS, -1, -1):
        day = today - dt.timedelta(days=n)
        if day.weekday() >= 5:
            continue
        try:
            rows = nasdaq_earnings(day.isoformat())
        except Exception:
            errors += 1
            continue
        for r in rows:
            sym = (r.get('symbol') or '').strip().upper()
            if sym in uni:
                reports.append((sym, day, TIMES.get(r.get('time'), 'UNSPECIFIED')))
    symbols = sorted({x[0] for x in reports})
    closes = {}
    start = (today - dt.timedelta(days=30)).isoformat() + 'T00:00:00Z'
    for k in range(0, len(symbols), 100):
        try:
            for body in cs.relay_pages({'resource': 'bars', 'symbols': ','.join(symbols[k:k + 100]), 'timeframe': '1Day', 'start': start,
                                        'feed': 'sip', 'adjustment': 'split', 'limit': '10000', 'sort': 'asc'}, 20):
                for sym, lst in (body.get('bars') or {}).items():
                    closes.setdefault(sym, []).extend((b['t'][:10], b['c']) for b in lst)
        except Exception as e:
            errors += 1
            print(f'bars: {e}', flush=True)
    out = []
    for sym, day, time in reports:
        e = after_news_entry(day, time, sorted(closes.get(sym, [])))
        if e and e['runup_pct'] >= RUNUP_WARN_PCT and e['warn_until'] >= today.isoformat():
            out.append({'symbol': sym, 'report_day': day.isoformat(), 'time': time, **e, **uni[sym]})
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
    ap.add_argument('--cache', default='calendar-cache/pdufa-recent-v2.json.gz')
    args = ap.parse_args()
    today = dt.datetime.now(cal.cs.NY).date() if cal.cs.NY else dt.date.today()
    uni = universe()
    Path(args.cache).parent.mkdir(parents=True, exist_ok=True)
    earnings, errors = upcoming_earnings(uni, today)
    fda, diag = upcoming_fda(uni, today, Path(args.cache))
    after_news, after_errors = recent_reports(uni, today)
    print(f'universe {len(uni)} · earnings {len(earnings)} (errors {errors}) · fda {len(fda)} · {diag}', flush=True)
    if errors > EARNINGS_DAYS // 2:
        raise SystemExit('Nasdaq earnings calendar mostly unavailable; keep the last file')
    payload = {
        'schema': 1, 'updated_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'as_of_day': today.isoformat(),
        'universe': f'US-listed stocks below ${MAX_CAP_MILLIONS}M market cap', 'purpose': 'INFORMATION_NOT_SIGNALS',
        'study': 'calendar-study-1', 'sources': {'earnings': 'Nasdaq.com earnings calendar', 'fda': 'SEC EDGAR full-text search (PDUFA) in 8-K/6-K'},
        'earnings': sorted(earnings, key=lambda e: (e['date'], e['symbol'])),
        'fda': sorted(fda, key=lambda e: (e['date'], e['symbol'])),
        'after_news': sorted(after_news, key=lambda e: (e['reaction_day'], e['symbol'])),
        'diagnostics': {'earnings_errors': errors, 'after_news_errors': after_errors, **diag},
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
