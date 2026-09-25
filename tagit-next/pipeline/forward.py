"""Forward record of live TAGit NEXT alerts and their observed outcomes.

record   — read /api/scanner, append new alerts and a service-health sample to a day ledger.
           Runs every ~10 minutes during the extended session; the request also keeps the free
           Render instance from sleeping.
evaluate — after the close, label each regular-session alert with the same time-carried
           protocol as research/outcome-relabel.mjs (outcome-relabel-1), using Nasdaq.com
           minute prices, and merge the day into tagit-next/data/forward-outcomes.json.

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
SCANNER = 'https://tagit-next-quotes.onrender.com/api/scanner'
BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
COST_PP = 0.5
HORIZON = dt.timedelta(minutes=30)
ENTRY_WINDOW = dt.timedelta(minutes=2)
KEEP_DAYS = 90


def parse_time(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None


def get_json(url, timeout=90, headers=None):
    req = urllib.request.Request(url, headers={'User-Agent': BROWSER_UA, 'Accept': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


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
    entry = next(((t, p) for t, p in points if detected <= t < detected + ENTRY_WINDOW), None)
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
            result = {'status': 'TIME', 'r': (exit_p - entry[1]) / risk}
            for _, p in path:
                if p <= stop:
                    result = {'status': 'STOP', 'r': -1.0}
                    break
                if p >= target:
                    result = {'status': 'TARGET_2R', 'r': 2.0}
                    break
            out['plan'] = result
    return out


def evaluate(ledger_path, day=None):
    day = day or dt.datetime.now(NY).date()
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {'alerts': {}, 'health': []}
    open_ = dt.datetime.combine(day, dt.time(9, 30), NY).astimezone(dt.timezone.utc)
    close = dt.datetime.combine(day, dt.time(16, 0), NY).astimezone(dt.timezone.utc)
    extended_end = dt.datetime.combine(day, dt.time(20, 0), NY).astimezone(dt.timezone.utc)
    events, cache = [], {}
    for alert in sorted(ledger['alerts'].values(), key=lambda a: a['detected_at']):
        detected = parse_time(alert['detected_at'])
        if detected.astimezone(NY).date() != day:
            continue
        regular = open_ <= detected < close
        event = {k: alert.get(k) for k in ('symbol', 'detected_at', 'price', 'stage', 'score')}
        event['session'] = 'REGULAR' if regular else 'EXTENDED'
        try:
            if alert['symbol'] not in cache:
                cache[alert['symbol']] = nasdaq_minutes(alert['symbol'], day)
                time.sleep(0.5)
            # Regular-session alerts exit by the 16:00 close; extended-hours alerts by 20:00.
            event.update(label(alert, cache[alert['symbol']], close if regular else extended_end))
        except Exception as e:
            event.update({'status': 'SOURCE_UNAVAILABLE', 'error': str(e)[:120]})
        events.append(event)

    health = [h for h in ledger.get('health', []) if parse_time(h['at']).astimezone(NY).date() == day]
    reachable = [h for h in health if h.get('status') not in (None, 'UNREACHABLE')]
    resolved = [e for e in events if e.get('status') == 'RESOLVED']
    plans = [e['plan'] for e in resolved if e.get('plan', {}).get('status') in ('STOP', 'TARGET_2R', 'TIME')]
    mean = lambda xs: sum(xs) / len(xs) if xs else None
    summary = {
        'date': day.isoformat(),
        'alerts': len(events),
        'resolved': len(resolved),
        'no_entry': sum(e.get('status') == 'NO_ENTRY' for e in events),
        'extended_session_alerts': sum(e.get('session') == 'EXTENDED' for e in events),
        'source_unavailable': sum(e.get('status') == 'SOURCE_UNAVAILABLE' for e in events),
        'mean_return_after_cost_pct': mean([e['return_after_cost_pct'] for e in resolved]),
        'positive_after_cost': sum(e['return_after_cost_pct'] > 0 for e in resolved),
        'plan_traded': len(plans),
        'plan_target_2r': sum(p['status'] == 'TARGET_2R' for p in plans),
        'plan_stop': sum(p['status'] == 'STOP' for p in plans),
        'plan_mean_r': mean([p['r'] for p in plans]),
        'health': {
            'samples': len(health), 'reachable': len(reachable),
            'median_response_seconds': sorted(h['seconds'] for h in reachable)[len(reachable) // 2] if reachable else None,
            'slow_over_20s': sum(h['seconds'] > 20 for h in reachable),
        },
    }

    report = json.loads(OUTCOMES.read_text()) if OUTCOMES.exists() else {'schema': 1, 'protocol': 'outcome-relabel-1 (forward)', 'days': []}
    report['days'] = [d for d in report['days'] if d['summary']['date'] != summary['date']] + [{'summary': summary, 'events': events}]
    report['days'] = sorted(report['days'], key=lambda d: d['summary']['date'])[-KEEP_DAYS:]
    all_resolved = [e for d in report['days'] for e in d['events'] if e.get('status') == 'RESOLVED']
    all_plans = [e['plan'] for e in all_resolved if e.get('plan', {}).get('status') in ('STOP', 'TARGET_2R', 'TIME')]
    report.update({
        'updated_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'source': 'Live /api/scanner alerts; outcomes from Nasdaq.com minute last-sale prices (unofficial)',
        'cost_pp': COST_PP,
        'status': 'FORWARD_OBSERVATION',
        'profitability_claim_allowed': False,
        'totals': {
            'days': len(report['days']),
            'alerts': sum(d['summary']['alerts'] for d in report['days']),
            'resolved': len(all_resolved),
            'mean_return_after_cost_pct': mean([e['return_after_cost_pct'] for e in all_resolved]),
            'positive_after_cost': sum(e['return_after_cost_pct'] > 0 for e in all_resolved),
            'plan_traded': len(all_plans),
            'plan_mean_r': mean([p['r'] for p in all_plans]),
        },
    })
    OUTCOMES.parent.mkdir(parents=True, exist_ok=True)
    OUTCOMES.write_text(json.dumps(report, indent=1, sort_keys=True) + '\n')
    print(json.dumps(summary, indent=1))
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['record', 'evaluate'])
    parser.add_argument('--ledger', default='forward-ledger.json')
    parser.add_argument('--day', help='YYYY-MM-DD New York date to evaluate')
    args = parser.parse_args()
    ledger = Path(args.ledger)
    if args.command == 'record':
        record(ledger)
    else:
        evaluate(ledger, dt.date.fromisoformat(args.day) if args.day else None)


if __name__ == '__main__':
    sys.exit(main())
