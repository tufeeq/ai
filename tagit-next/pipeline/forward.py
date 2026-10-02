"""Forward record of live TAGit NEXT alerts and their observed outcomes.

record      — read /api/scanner, append new alerts and a service-health sample to a day ledger.
              Runs every ~10 minutes during the extended session; the request also keeps the free
              service instance from sleeping.
evaluate    — after the close, label each alert of the latest completed session (NOT the runner's
              wall-clock date: GitHub delays scheduled runs, sometimes past midnight New York) with
              the same time-carried protocol as research/outcome-relabel.mjs (outcome-relabel-1),
              using Nasdaq.com minute prices, and merge the day into
              tagit-next/data/forward-outcomes.json.
session-day — print the New York date `evaluate` would use (the workflow keys its cache on it).

Headline statistics are regular-session alerts only; extended-hours alerts are reported beside
them. A day the recorder never sampled is kept but flagged `recorded: false` and not counted.
Nasdaq.com prices are an unofficial, free, consolidated last-sale series; outcomes are price
observations, not fills.
"""
import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')
ROOT = Path(__file__).resolve().parents[2]
OUTCOMES = ROOT / 'tagit-next/data/forward-outcomes.json'
SCANNER = 'https://ai-production-85c7.up.railway.app/api/scanner'
BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
COST_PP = 0.5
HORIZON = dt.timedelta(minutes=30)
ENTRY_WINDOW = dt.timedelta(minutes=2)
KEEP_DAYS = 750  # the published file IS the forward record: keep ~3 years, not a rolling 90 days

# Nasdaq full-day closures and 13:00 early closes (New York dates); keep in step with
# src/core/sipscan.js EARLY_CLOSES. A holiday is never evaluated as a session.
HOLIDAYS = frozenset({
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03',
    '2026-09-07', '2026-11-26', '2026-12-25',
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05',
    '2027-09-06', '2027-11-25', '2027-12-24',
})
EARLY_CLOSES = frozenset({'2026-11-27', '2026-12-24', '2027-11-26'})


def parse_time(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None


def get_json(url, timeout=90, headers=None):
    req = urllib.request.Request(url, headers={'User-Agent': BROWSER_UA, 'Accept': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


# ---- sessions -------------------------------------------------------------------------------

def is_session(day):
    return day.weekday() < 5 and day.isoformat() not in HOLIDAYS


def session_bounds(day):
    """(open, regular close, extended end) in UTC for a New York date; 13:00 close on early-close days."""
    at = lambda h, m=0: dt.datetime.combine(day, dt.time(h, m), NY).astimezone(dt.timezone.utc)
    return at(9, 30), (at(13) if day.isoformat() in EARLY_CLOSES else at(16)), at(20)


def session_day(now=None):
    """The latest session whose regular close has passed at `now` (UTC-aware)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    day = now.astimezone(NY).date()
    for _ in range(10):
        if is_session(day) and now >= session_bounds(day)[1]:
            return day
        day -= dt.timedelta(days=1)
    raise RuntimeError('no session in the last 10 days')


# ---- record ---------------------------------------------------------------------------------

def record(ledger_path, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {'schema': 1, 'alerts': {}, 'health': []}
    started = time.monotonic()
    sample = {'at': now.isoformat(timespec='seconds')}
    try:
        payload = get_json(SCANNER)
        sample.update({
            'status': payload.get('status'), 'seconds': round(time.monotonic() - started, 1),
            'server_time': payload.get('server_time'), 'feed': payload.get('feed'),
            'fresh_prices': (payload.get('coverage') or {}).get('fresh_prices'),
            'with_prices': (payload.get('coverage') or {}).get('with_prices'),
        })
        added = 0
        for a in payload.get('alerts') or []:
            key = f"{a.get('symbol')}|{a.get('detected_at')}"
            if a.get('symbol') and parse_time(a.get('detected_at')) and key not in ledger['alerts']:
                ledger['alerts'][key] = {k: a.get(k) for k in ('symbol', 'detected_at', 'price', 'price_at', 'stage', 'score', 'plan')}
                ledger['alerts'][key]['recorded_at'] = sample['at']
                added += 1
        sample['new_alerts'] = added
    except Exception as e:  # an unreachable service is itself a health observation
        sample.update({'status': 'UNREACHABLE', 'seconds': round(time.monotonic() - started, 1), 'error': str(e)[:160]})
    ledger['health'].append(sample)
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps(ledger, indent=1, sort_keys=True))
    print(json.dumps(sample))
    return ledger


# ---- evaluate -----------------------------------------------------------------------------

def chart_points(chart, day):
    """Parse Nasdaq.com chart points into [(utc datetime, price)], ascending.

    `x` is the New York wall-clock time written as epoch ms in UTC (7:00 AM ET → 07:00Z);
    each point is cross-checked against its printed `z.dateTime` ("7:00 AM ET") and the day.
    Only minutes with trades appear, so gaps are minutes without trades.
    """
    points = []
    for p in chart or []:
        price, x = p.get('y'), p.get('x')
        printed = ((p.get('z') or {}).get('dateTime') or '').replace(' ET', '').strip()
        if not isinstance(price, (int, float)) or price <= 0 or not isinstance(x, (int, float)):
            continue
        wall = dt.datetime.fromtimestamp(x / 1000, dt.timezone.utc).replace(tzinfo=None)
        if wall.date() != day or (printed and wall.strftime('%-I:%M %p') != printed):
            continue  # inconsistent point: drop rather than guess
        points.append((wall.replace(tzinfo=NY).astimezone(dt.timezone.utc), float(price)))
    return sorted(points)


def nasdaq_minutes(symbol, day):
    data = get_json(f'https://api.nasdaq.com/api/quote/{symbol}/chart?assetclass=stocks', timeout=30).get('data') or {}
    return chart_points(data.get('chart'), day)


def label(alert, points, session_close):
    detected = parse_time(alert['detected_at'])
    horizon = min(detected + HORIZON, session_close)
    entry = next(((t, p) for t, p in points if detected <= t < detected + ENTRY_WINDOW and t < session_close), None)
    if entry is None:
        return {'status': 'NO_ENTRY'}
    path = [(t, p) for t, p in points if entry[0] <= t < horizon]
    exit_t, exit_p = path[-1]
    out = {
        'status': 'RESOLVED', 'entry': entry[1], 'entry_at': entry[0].isoformat(), 'exit': exit_p, 'exit_at': exit_t.isoformat(),
        'exit_kind': 'SESSION_END' if horizon < detected + HORIZON else 'TIME_30M',
        'max_up_pct': (max(p for _, p in path) / entry[1] - 1) * 100,
        'max_down_pct': (min(p for _, p in path) / entry[1] - 1) * 100,
        'return_after_cost_pct': (exit_p / entry[1] - 1) * 100 - COST_PP,
    }
    plan = alert.get('plan') or {}
    stop, targets = plan.get('stop'), plan.get('targets') or []
    if isinstance(stop, (int, float)) and stop > 0 and len(targets) == 2:
        risk = entry[1] - stop
        if risk <= 0:
            out['plan'] = {'status': 'INVALIDATED'}
        else:
            target = entry[1] + 2 * risk
            status, price = 'TIME', exit_p
            for _, p in path:
                if p <= stop:  # a sampled price at/below the stop: the stop fills no better than that price
                    status, price = 'STOP', p
                    break
                if p >= target:  # a resting 2R limit fills at the target
                    status, price = 'TARGET_2R', target
                    break
            out['plan'] = {'status': status, 'r': (price - entry[1]) / risk,
                           'r_after_cost': (price - entry[1] - entry[1] * COST_PP / 100) / risk}
    return out


def label_all(alerts, day, fetch=None):
    fetch = fetch or nasdaq_minutes
    open_, close, extended_end = session_bounds(day)
    events, cache = [], {}
    for alert in sorted(alerts, key=lambda a: a['detected_at']):
        detected = parse_time(alert['detected_at'])
        if detected.astimezone(NY).date() != day:
            continue
        regular = open_ <= detected < close
        event = {k: alert.get(k) for k in ('symbol', 'detected_at', 'price', 'stage', 'score')}
        event['session'] = 'REGULAR' if regular else 'EXTENDED'
        # Plan levels as shown at the alert, for the paper ledger (pipeline/paper_ledger.mjs).
        event['plan_levels'] = alert.get('plan') if isinstance(alert.get('plan'), dict) else None
        try:
            if alert['symbol'] not in cache:
                cache[alert['symbol']] = fetch(alert['symbol'], day)
                time.sleep(0.5)
            points = cache[alert['symbol']]
            if not points:
                # No price at all for that date (the chart already rolled to another session, or the
                # symbol has no chart): unknown, never "no trade within two minutes".
                event.update({'status': 'SOURCE_UNAVAILABLE', 'error': 'no chart points for this date'})
            else:
                # Regular-session alerts exit by the close; extended-hours alerts by 20:00.
                event.update(label(alert, points, close if regular else extended_end))
        except Exception as e:
            event.update({'status': 'SOURCE_UNAVAILABLE', 'error': str(e)[:120]})
        events.append(event)
    return events


def _mean(xs):
    return sum(xs) / len(xs) if xs else None


def _plans(resolved):
    return [e['plan'] for e in resolved if (e.get('plan') or {}).get('status') in ('STOP', 'TARGET_2R', 'TIME')]


def summarize_day(day, events, health, evaluated_at):
    reachable = [h for h in health if h.get('status') not in (None, 'UNREACHABLE')]
    regular = [e for e in events if e.get('session') == 'REGULAR']
    extended = [e for e in events if e.get('session') == 'EXTENDED']
    resolved = [e for e in regular if e.get('status') == 'RESOLVED']
    ext_resolved = [e for e in extended if e.get('status') == 'RESOLVED']
    plans = _plans(resolved)
    seconds = sorted(h['seconds'] for h in reachable)
    return {
        'date': day.isoformat(),
        'evaluated_at': evaluated_at.isoformat(timespec='seconds'),
        # Complete only when evaluated after 20:00 (extended-hours alerts run to 20:00).
        'complete': evaluated_at >= session_bounds(day)[2],
        # A day without a single recorder sample was not observed: zero alerts then means nothing.
        'recorded': bool(health),
        'alerts': len(events),
        # Headline statistics: regular-session alerts (the outcome-relabel-1 protocol).
        'regular_alerts': len(regular),
        'resolved': len(resolved),
        'no_entry': sum(e.get('status') == 'NO_ENTRY' for e in regular),
        'source_unavailable': sum(e.get('status') == 'SOURCE_UNAVAILABLE' for e in regular),
        'mean_return_after_cost_pct': _mean([e['return_after_cost_pct'] for e in resolved]),
        'positive_after_cost': sum(e['return_after_cost_pct'] > 0 for e in resolved),
        # Extended-hours alerts: reported, never mixed into the headline mean.
        'extended_session_alerts': len(extended),
        'extended_resolved': len(ext_resolved),
        'extended_mean_return_after_cost_pct': _mean([e['return_after_cost_pct'] for e in ext_resolved]),
        'plan_traded': len(plans),
        'plan_target_2r': sum(p['status'] == 'TARGET_2R' for p in plans),
        'plan_stop': sum(p['status'] == 'STOP' for p in plans),
        # plan_mean_r carries the same 0.5 pp cost as the returns; the gross value sits beside it.
        'plan_mean_r': _mean([p['r_after_cost'] for p in plans]),
        'plan_mean_r_gross': _mean([p['r'] for p in plans]),
        'health': {
            'samples': len(health), 'reachable': len(reachable),
            'median_response_seconds': (seconds[(len(seconds) - 1) // 2] + seconds[len(seconds) // 2]) / 2 if seconds else None,
            'slow_over_20s': sum(s > 20 for s in seconds),
        },
    }


def _evaluated(summary):
    return summary['resolved'] + summary.get('extended_resolved', 0)


def keeps_old(new, old):
    """True when a later pass is poorer than the day already published (chart rolled over, cache
    lost, recorder ledger missing): a re-run must never erase observations."""
    n, o = new['summary'], old['summary']
    old_recorded = o.get('recorded', o['health']['samples'] > 0)
    return (old_recorded and not n['recorded']) or _evaluated(n) < _evaluated(o) or n['alerts'] < o['alerts']


def build_totals(days):
    observed = [d for d in days if d['summary'].get('recorded', d['summary']['health']['samples'] > 0)]
    resolved = [e for d in observed for e in d['events'] if e.get('session', 'REGULAR') == 'REGULAR' and e.get('status') == 'RESOLVED']
    plans = _plans(resolved)
    return {
        'days': len(observed),
        'days_not_recorded': len(days) - len(observed),
        'alerts': sum(d['summary']['alerts'] for d in observed),
        'regular_alerts': sum(d['summary'].get('regular_alerts', 0) for d in observed),
        'resolved': len(resolved),
        'mean_return_after_cost_pct': _mean([e['return_after_cost_pct'] for e in resolved]),
        'positive_after_cost': sum(e['return_after_cost_pct'] > 0 for e in resolved),
        'plan_traded': len(plans),
        'plan_mean_r': _mean([p.get('r_after_cost', p['r']) for p in plans]),
        'plan_mean_r_gross': _mean([p['r'] for p in plans]),
    }


def merge_day(report, entry):
    """Insert or replace one day; drop weekend/holiday rows; recompute the totals from the events."""
    date = entry['summary']['date']
    old = next((d for d in report['days'] if d['summary']['date'] == date), None)
    if old is not None and keeps_old(entry, old):
        print(f'{date}: kept the earlier evaluation ({_evaluated(old["summary"])} resolved, '
              f'{old["summary"]["alerts"]} alerts) over this poorer pass ({_evaluated(entry["summary"])}, {entry["summary"]["alerts"]})')
        entry = old
    days = [d for d in report['days'] if d['summary']['date'] != date and is_session(dt.date.fromisoformat(d['summary']['date']))]
    report['days'] = sorted(days + [entry], key=lambda d: d['summary']['date'])[-KEEP_DAYS:]
    report.update({
        'source': 'Live /api/scanner alerts; outcomes from Nasdaq.com minute last-sale prices (unofficial)',
        'cost_pp': COST_PP,
        'status': 'FORWARD_OBSERVATION',
        'profitability_claim_allowed': False,
        'totals': build_totals(report['days']),
    })
    return report


def evaluate(ledger_path, day=None, now=None, fetch=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    day = day or session_day(now)
    if not is_session(day):
        print(f'{day}: not a trading session; nothing evaluated')
        return None
    if now < session_bounds(day)[1]:
        print(f'{day}: session not closed yet; nothing evaluated')
        return None
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {'alerts': {}, 'health': []}
    events = label_all(ledger['alerts'].values(), day, fetch)
    health = [h for h in ledger.get('health', []) if parse_time(h['at']).astimezone(NY).date() == day]
    entry = {'summary': summarize_day(day, events, health, now), 'events': events}

    report = json.loads(OUTCOMES.read_text()) if OUTCOMES.exists() else {'schema': 1, 'protocol': 'outcome-relabel-1 (forward)', 'days': []}
    unchanged = lambda r: json.dumps({k: v for k, v in r.items() if k != 'updated_at'}, sort_keys=True)
    before = unchanged(report)
    merge_day(report, entry)
    if unchanged(report) == before:  # no data change: no commit, no deploy
        print(f'{day}: no change')
        return report
    report['updated_at'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    OUTCOMES.parent.mkdir(parents=True, exist_ok=True)
    OUTCOMES.write_text(json.dumps(report, indent=1, sort_keys=True) + '\n')
    print(json.dumps(entry['summary'], indent=1))
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['record', 'evaluate', 'session-day'])
    parser.add_argument('--ledger', default='forward-ledger.json')
    parser.add_argument('--day', help='YYYY-MM-DD New York date to evaluate (default: latest closed session)')
    args = parser.parse_args()
    ledger = Path(args.ledger)
    day = dt.date.fromisoformat(args.day) if args.day else None
    if args.command == 'record':
        record(ledger)
    elif args.command == 'session-day':
        print((day or session_day()).isoformat())
    else:
        evaluate(ledger, day)


if __name__ == '__main__':
    sys.exit(main())
