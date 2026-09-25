"""Frozen continuation diagnostic on exposed data. No orders or live-rule changes.

OHLC labels establish candle ordering only, never bid/ask execution or profitability.
Future labels are separate from the availability-filtered feature calculation.
"""
import argparse
from collections import Counter
from datetime import timedelta
from decimal import Decimal
import gzip
import hashlib
import json
from math import isfinite
from pathlib import Path
from statistics import mean

from .events import time
from .features import END_OF_MINUTE, MINUTE, exchange_sessions, minute_window, visible_bars
from .phase2 import dump, paired_bootstrap, sha

ROOT = Path(__file__).resolve().parents[1]
RESOLVED = {'TARGET', 'STOP', 'TIMEOUT', 'SESSION_END'}


def three_rising_closes(bars, at):
    at = time(at)
    end = at.replace(second=0, microsecond=0)
    rows = minute_window(bars, end, 3, at)
    if rows is None or any(r['volume'] <= 0 for r in rows):
        return {'status': 'UNKNOWN_THREE_MINUTES', 'selected': None}
    closes = [r['close'] for r in rows]
    return {'status': 'OBSERVABLE', 'selected': closes[0] < closes[1] < closes[2],
            'closes': closes, 'last_input_available_at': max(r['_available'] for r in rows).isoformat()}


def valid_bar(b):
    vals = [b.get(k) for k in ('open', 'high', 'low', 'close', 'volume')]
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not isfinite(v) or v <= 0 for v in vals):
        return False
    o, h, l, c, _ = vals
    return l <= min(o, c) <= max(o, c) <= h


def label_path(index, at, session, target_pct=10, stop_pct=3, horizon_minutes=60, latency_seconds=1):
    """No stitching across a missing minute and no invented intraminute order.

    A bar's open is observed before its high/low; if both barriers are touched
    later in the same bar the outcome stays ambiguous. Terminal bar extrema are
    deliberately NOT reported as pre-exit MAE/MFE (their sequence is unknown).
    """
    if (any(isinstance(v, bool) or not isinstance(v, (int, float)) or not isfinite(v)
            for v in (target_pct, stop_pct, latency_seconds))
            or target_pct <= 0 or not 0 < stop_pct < 100 or latency_seconds < 0
            or isinstance(horizon_minutes, bool) or not isinstance(horizon_minutes, int) or horizon_minutes < 1):
        raise ValueError('Invalid barrier policy')
    at = time(at)
    start, close = (time(s) for s in session)
    if start >= close or start.second or close.second or start.microsecond or close.microsecond:
        raise ValueError('Minute-aligned session bounds required')
    ready = at + timedelta(seconds=latency_seconds)
    entry_at = ready.replace(second=0, microsecond=0)
    if entry_at < ready:
        entry_at += MINUTE
    base = {'status': None, 'entry_at': entry_at.isoformat(), 'entry_price_proxy': None,
            'gross_return_proxy_pct': None, 'target_first': None, 'exit_interval': None,
            'evidence': 'BAR_PROXY_NOT_EXECUTABLE'}

    def result(status, **details):
        return {**base, 'status': status, **details}

    if at < start or entry_at >= close:
        return result('NO_SESSION_ENTRY', target_first=False)
    b = index.get(entry_at)
    if b is None:
        return result('UNKNOWN_ENTRY_BAR', first_missing_at=entry_at.isoformat())
    if not valid_bar(b):
        return result('UNKNOWN_ENTRY_BAR_INVALID', first_missing_at=entry_at.isoformat())
    entry = b['open']
    # Preserve decimal price/percentage boundaries (100 * 1.1 otherwise exceeds 110).
    target = float(Decimal(str(entry)) * (1 + Decimal(str(target_pct)) / 100))
    stop = float(Decimal(str(entry)) * (1 - Decimal(str(stop_pct)) / 100))
    planned_end = entry_at + horizon_minutes * MINUTE
    end = min(planned_end, close)
    base.update(entry_price_proxy=entry, target_price=target, stop_price=stop,
                deadline=end.isoformat(), effective_horizon_minutes=(end - entry_at).total_seconds() / 60)

    def terminal(status, price, lower, upper, kind):
        return result(status, target_first=status == 'TARGET', exit_price_proxy=price,
                      gross_return_proxy_pct=(price / entry - 1) * 100,
                      exit_interval={'start': lower.isoformat(), 'end': upper.isoformat(), 'kind': kind})

    cursor = entry_at
    while cursor < end:
        b = index.get(cursor)
        if b is None:
            return result('UNKNOWN_PATH_GAP', first_missing_at=cursor.isoformat())
        if not valid_bar(b):
            return result('UNKNOWN_PATH_BAR_INVALID', first_missing_at=cursor.isoformat())
        # Opening gaps have a known order relative to the later bar range.
        if b['open'] <= stop:
            return terminal('STOP', b['open'], cursor, cursor, 'OPEN')
        if b['open'] >= target:
            return terminal('TARGET', b['open'], cursor, cursor, 'OPEN')
        upper, lower = b['high'] >= target, b['low'] <= stop
        if upper and lower:
            return result('AMBIGUOUS_BOTH', first_missing_at=cursor.isoformat(),
                          exit_interval={'start': cursor.isoformat(), 'end': (cursor + MINUTE).isoformat(),
                                         'kind': 'ORDER_UNKNOWN'})
        if lower:
            return terminal('STOP', stop, cursor, cursor + MINUTE, 'INTRAMINUTE')
        if upper:
            return terminal('TARGET', target, cursor, cursor + MINUTE, 'INTRAMINUTE')
        cursor += MINUTE
    # Last trade in final complete bar is a price proxy, not an executable close.
    return terminal('SESSION_END' if close < planned_end else 'TIMEOUT', b['close'],
                    end - MINUTE, end, 'FINAL_BAR_CLOSE_PROXY')


def summary(rows, costs):
    counts = Counter(r['label']['status'] for r in rows)
    returns = [r['label']['gross_return_proxy_pct'] for r in rows
               if r['label']['status'] in RESOLVED]
    unknown = sum(r['label']['target_first'] is None for r in rows)
    targets = counts['TARGET']; known = len(rows) - unknown
    gross = mean(returns) if returns else None
    return {'signals': len(rows), 'bar_outcomes_resolved': len(returns),
            'known_no_entry': counts['NO_SESSION_ENTRY'], 'unknown_or_ambiguous': unknown,
            'status_counts': dict(sorted(counts.items())),
            'conditional_target_rate': targets / known if known else None,
            'target_rate_identification_bounds_not_ci': [targets / len(rows), (targets + unknown) / len(rows)] if rows else None,
            'conditional_gross_return_proxy_pct': gross,
            'cost_scenarios': [{'assumed_round_trip_cost_pp': c,
                                'conditional_mean_return_proxy_pct': gross - c if gross is not None else None} for c in costs],
            'executable_expectancy_pct': None, 'profitability_claim_allowed': False}


def comparison(rows, protocol):
    observable = [r for r in rows if r['feature']['selected'] is not None]
    selected = [r for r in observable if r['feature']['selected']]
    excluded = [r for r in observable if not r['feature']['selected']]
    stats = protocol['statistics']; costs = protocol['cost_sensitivity_round_trip_percentage_points']
    def bootstrap(metric):
        data = []
        for r in observable:
            label = r['label']
            if metric == 'target_rate':
                val = None if label['target_first'] is None else 100 * int(label['target_first'])
            else:
                val = label['gross_return_proxy_pct']
                if val is not None: val -= costs[0]
            data.append({'session': r['session'], 'selected': r['feature']['selected'], 'net_pct': val})
        result = paired_bootstrap(data, stats['iterations'], stats['seed'], stats['family_size'],
                                  stats['minimum_complete_bootstrap_fraction'])
        return {'metric': metric, 'effect_ci95_pp': result['effect_ci95_percentage_points'],
                'selected_ci95': result['selected_mean_ci95_pct'],
                'comparator_ci95': result['comparator_mean_ci95_pct'],
                'valid_replicates': result['valid_replicates'], 'iterations': stats['iterations'],
                'sessions': result['sessions'], 'small_cluster_warning': result['small_cluster_warning'],
                'confirmatory_significance': 'NOT_ELIGIBLE'}
    base, chosen = summary(observable, costs), summary(selected, costs)
    return {'id': protocol['hypothesis']['id'], 'decision': 'NOT_APPROVED_DEVELOPMENT_ONLY',
            'same_observable_population_baseline': base, 'selected': chosen, 'excluded': summary(excluded, costs),
            'unknown_feature': summary([r for r in rows if r['feature']['selected'] is None], costs),
            'observed_targets_retained': sum(r['label']['status'] == 'TARGET' for r in selected),
            'observed_targets_excluded': sum(r['label']['status'] == 'TARGET' for r in excluded),
            'conditional_target_rate_effect_pp': 100 * (chosen['conditional_target_rate'] - base['conditional_target_rate'])
                if chosen['conditional_target_rate'] is not None and base['conditional_target_rate'] is not None else None,
            'target_rate_bootstrap': bootstrap('target_rate'),
            'return_proxy_bootstrap': bootstrap('return_proxy'),
            'per_session': [{'session': day, 'baseline': summary([r for r in observable if r['session'] == day], costs),
                             'selected': summary([r for r in selected if r['session'] == day], costs)}
                            for day in sorted({r['session'] for r in rows})]}


def build():
    protocol_path = ROOT / 'research/continuation-protocol.json'
    protocol = json.loads(protocol_path.read_text())
    inputs = json.loads((ROOT / 'research/continuation-inputs.json').read_text())
    if sha(protocol_path) != inputs['protocol_sha256']:
        raise ValueError('Frozen continuation protocol changed')
    if protocol['deployment_allowed'] or protocol['holdout_opens'] != 0 or protocol['status'] != 'EXPOSED_DEVELOPMENT_ONLY':
        raise ValueError('Development diagnostic only')
    for path, digest in protocol['source_sha256'].items():
        if sha(ROOT / path) != digest: raise ValueError(f'Frozen source changed: {path}')
    sessions = exchange_sessions(json.loads((ROOT / 'data/capabilities/calendar-20260824-20260904.json').read_text())['calendar'])
    sources = {}
    for item in json.loads((ROOT / 'data/study-manifest.json').read_text())['files']:
        p = ROOT / item['path']
        if sha(p) != item['sha256']: raise ValueError(f'Bar hash mismatch: {p}')
        day = p.name[:10]
        if not protocol['period']['start'] <= day <= protocol['period']['end']:
            raise ValueError('Unregistered session')
        sources[day] = json.loads(gzip.decompress(p.read_bytes()))['bars']
    rows = []; seen = set()
    for event in json.loads((ROOT / 'data/discovery-audit.json').read_text())['events']:
        day, symbol, at = event['date'], event['symbol'], event['detected_at']
        sid = f'{day}|{symbol}|{at}'
        if sid in seen: raise ValueError('Duplicate signal')
        seen.add(sid)
        session = sessions[day]
        raw = [b for b in sources[day].get(symbol, []) if session[0] <= time(b['timestamp']) < session[1]]
        # This computation only receives data available at the detection time.
        feature = three_rising_closes(visible_bars(raw, time(at), END_OF_MINUTE), at)
        index = {}
        for b in raw:
            t = time(b['timestamp'])
            if t in index or t.second or t.microsecond: raise ValueError('Duplicate/non-minute bar')
            index[t] = b
        bp = protocol['barriers']
        label = label_path(index, at, session, bp['target_gross_pct'], bp['stop_gross_pct'],
                           bp['horizon_minutes'], protocol['entry']['latency_seconds'])
        rows.append({'id': sid, 'session': day, 'symbol': symbol, 'at': at,
                     'legacy_30m_scorable': event['scorable'], 'feature': feature, 'label': label})
    costs = protocol['cost_sensitivity_round_trip_percentage_points']
    return {'protocol': protocol['id'], 'protocol_commit': inputs['protocol_commit'], 'as_of': '2026-09-24',
            'status': protocol['status'], 'barrier_policy': protocol['barriers'],
            'entry_policy': protocol['entry'], 'availability': protocol['availability'],
            'all_signals': summary(rows, costs), 'comparison': comparison(rows, protocol),
            'legacy_missing_now_bar_resolved': sum(not r['legacy_30m_scorable'] and r['label']['status'] in RESOLVED for r in rows),
            'legacy_scorable_now_unknown': sum(r['legacy_30m_scorable'] and r['label']['target_first'] is None for r in rows),
            'phase1_complete': False, 'holdout_opens': 0, 'new_market_requests': 0,
            'live_rules_changed': False, 'profitability_claim_allowed': False, 'calibrated_probabilities': None,
            'limits': [protocol['selection'], protocol['availability'], protocol['cost_warning'],
                       'Different entry delay, horizon and barriers from old baseline; coverage change is not accuracy improvement',
                       'Only sampled detector events; target retention is not market-wide recall or top-30 capture',
                       'Threshold/open/close fills are OHLC proxies with unknown quotes, impact, halts and capacity',
                       'Ten exposed sessions, overlapping signals and outcome-dependent missingness; no independent model evaluation',
                       'Bootstrap is exploratory; no multiplicity-adjusted efficacy claim across past experiments'],
            'rows': rows}


def repair_manifest(report):
    """Freeze a small measurement-repair sample by missingness, never by returns."""
    candidates = [r for r in report['rows'] if r['label']['target_first'] is None]
    groups = sorted({r['label']['status'] for r in candidates})
    chosen = []
    for status in groups:
        bucket = sorted([r for r in candidates if r['label']['status'] == status],
                        key=lambda r: hashlib.sha256(r['id'].encode()).hexdigest())
        if bucket: chosen.append(bucket[0])
    remainder = sorted([r for r in candidates if r not in chosen],
                       key=lambda r: hashlib.sha256(r['id'].encode()).hexdigest())
    chosen = (chosen + remainder)[:6]
    return {'status': 'FROZEN_NOT_FETCHED', 'source_protocol_commit': report['protocol_commit'],
            'selection': 'One minimum SHA256(signal ID) per unknown status, then lowest remaining hashes, up to six',
            'purpose': 'Development measurement repair, not validation or winner selection',
            'requests_used': 0, 'next_cycle_request_cap': 20,
            'cases': [{'id': r['id'], 'symbol': r['symbol'], 'reason': r['label']['status'],
                       'signal_at': r['at'], 'entry_at': r['label']['entry_at'],
                       'first_missing_at': r['label'].get('first_missing_at'),
                       'deadline': r['label'].get('deadline')} for r in chosen]}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); args = parser.parse_args()
    report = build()
    artifacts = {ROOT / 'data/continuation-development.json': report,
                 ROOT / 'web/continuation-evidence.json': {k: v for k, v in report.items() if k != 'rows'},
                 ROOT / 'research/continuation-quote-sample.json': repair_manifest(report)}
    for path, value in artifacts.items():
        content = dump(value)
        if args.check:
            if not path.exists() or path.read_text() != content: raise SystemExit(f'Reproduction mismatch: {path}')
        else: path.write_text(content)
    print(dump({'all_signals': report['all_signals'], 'comparison': report['comparison']}))


if __name__ == '__main__':
    main()
