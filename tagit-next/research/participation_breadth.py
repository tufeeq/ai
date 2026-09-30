"""Frozen temporal replication of a causal pre-signal volume-breadth feature."""
import argparse
from collections import Counter
import gzip
import json
from math import sqrt
from statistics import median

from .continuation import label_path
from .events import time
from .features import END_OF_MINUTE, minute_window, visible_bars
from .phase2 import dump, sha
from .signal_clock import ROOT


PROTOCOL = ROOT / 'research/participation-breadth-protocol.json'
PROTOCOL_COMMIT = '0949c6a258a4a886c66f42b5e91628e237ac6674'


def persistent_participation(bars, at):
    """All three completed signal minutes must clear prior-ten median volume."""
    at = time(at)
    end = at.replace(second=0, microsecond=0)
    rows = minute_window(bars, end, 13, at)
    if rows is None:
        return {'status': 'UNKNOWN_CONTIGUOUS_THIRTEEN_MINUTES', 'selected': None}
    volumes = [row['volume'] for row in rows]
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0
           for value in volumes):
        return {'status': 'UNKNOWN_NONPOSITIVE_VOLUME', 'selected': None}
    reference = median(volumes[:10])
    recent = volumes[10:]
    ratios = [value / reference for value in recent]
    return {'status': 'OBSERVABLE', 'selected': all(ratio >= 1 for ratio in ratios),
            'reference_median_volume': reference, 'recent_volumes': recent,
            'recent_to_reference_ratios': ratios,
            'minimum_recent_to_reference_ratio': min(ratios),
            'last_input_available_at': max(row['_available'] for row in rows).isoformat()}


def wilson95(successes, total):
    if total <= 0:
        return None
    z = 1.959963984540054
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    radius = z * sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [center - radius, center + radius]


def describe(rows):
    observable = [row for row in rows if row['feature']['selected'] is not None]
    selected = [row for row in observable if row['feature']['selected']]

    def group(items):
        known = [row for row in items if row['label']['target_first'] is not None]
        targets = sum(row['label']['target_first'] is True for row in known)
        rate = targets / len(known) if known else None
        return {'signals': len(items), 'known_outcomes': len(known),
                'unknown_outcomes': len(items) - len(known), 'known_targets': targets,
                'known_non_targets': len(known) - targets,
                'conditional_target_rate': rate,
                'conditional_target_rate_ci95_wilson': wilson95(targets, len(known)),
                'known_false_positive_proxy': 1 - rate if rate is not None else None,
                'full_denominator_target_rate_lower_bound': targets / len(items) if items else None,
                'status_counts': dict(sorted(Counter(row['label']['status'] for row in items).items()))}

    baseline = group(observable)
    chosen = group(selected)
    targets = baseline['known_targets']
    retention = chosen['known_targets'] / targets if targets else None
    lift = (100 * (chosen['conditional_target_rate'] - baseline['conditional_target_rate'])
            if chosen['conditional_target_rate'] is not None and baseline['conditional_target_rate'] is not None
            else None)
    return {'all': group(rows), 'same_observable_baseline': baseline, 'selected': chosen,
            'excluded': group([row for row in observable if not row['feature']['selected']]),
            'unknown_feature': group([row for row in rows if row['feature']['selected'] is None]),
            'target_retention': retention, 'target_rate_lift_percentage_points': lift}


def period_decision(summary, acceptance):
    base = summary['same_observable_baseline']
    checks = {
        'minimum_known_outcomes': base['known_outcomes'] >= acceptance['minimum_known_outcomes'],
        'minimum_known_targets': base['known_targets'] >= acceptance['minimum_known_targets'],
        'minimum_target_retention': (summary['target_retention'] is not None and
                                     summary['target_retention'] >= acceptance['minimum_target_retention']),
        'minimum_target_rate_lift': (summary['target_rate_lift_percentage_points'] is not None and
                                     summary['target_rate_lift_percentage_points'] >=
                                     acceptance['minimum_target_rate_lift_percentage_points'])}
    return {'checks': checks, 'passed': all(checks.values()),
            'decision': 'PASS' if all(checks.values()) else 'REJECT'}


def _load():
    protocol = json.loads(PROTOCOL.read_text())
    if (protocol['new_market_request_budget'] != 0 or protocol['new_market_requests'] != 0 or
            protocol['holdout_opens'] != 0 or protocol['deployment_allowed'] or
            protocol['live_rule_changes_allowed'] or protocol['profitability_claim_allowed']):
        raise ValueError('Replication must remain offline, non-deployed and non-profitable')
    for path, digest in protocol['source_sha256'].items():
        if sha(ROOT / path) != digest:
            raise ValueError(f'Frozen source changed: {path}')
    development = protocol['sample']['development_sessions']
    validation = protocol['sample']['validation_sessions']
    final_test = protocol['sample']['excluded_final_test_sessions']
    if set(development) & set(validation) or set(development + validation) & set(final_test):
        raise ValueError('Overlapping period assignments')
    allowed = set(development + validation)
    bars = {}
    manifest = json.loads((ROOT / 'data/study-manifest.json').read_text())
    for item in manifest['files']:
        day = item['path'].split('/')[-1][:10]
        if day not in allowed:
            continue
        path = ROOT / item['path']
        if sha(path) != item['sha256'] or sha(path) != protocol['source_sha256'][item['path']]:
            raise ValueError(f'Bar source changed: {item["path"]}')
        bars[day] = json.loads(gzip.decompress(path.read_bytes()))['bars']
    if set(bars) != allowed:
        raise ValueError('Missing registered development or validation bars')
    events = [event for event in json.loads((ROOT / 'data/discovery-audit.json').read_text())['events']
              if event['date'] in allowed]
    return protocol, bars, events


def build():
    protocol, sources, events = _load()
    periods = {'development': set(protocol['sample']['development_sessions']),
               'validation': set(protocol['sample']['validation_sessions'])}
    rows = []
    for event in events:
        day, symbol, at = event['date'], event['symbol'], event['detected_at']
        raw = sources[day].get(symbol, [])
        visible = visible_bars(raw, at, END_OF_MINUTE)
        feature = persistent_participation(visible, at)
        index = {}
        for bar in raw:
            stamp = time(bar['timestamp'])
            if stamp in index:
                raise ValueError('Duplicate bar timestamp')
            index[stamp] = bar
        session_start = time(day + 'T13:30:00+00:00')
        session_end = time(day + 'T20:00:00+00:00')
        policy = protocol['label']
        label = label_path(index, at, (session_start, session_end),
                           policy['target_gross_pct'], policy['stop_gross_pct'],
                           policy['horizon_minutes'], 1)
        period = next(name for name, dates in periods.items() if day in dates)
        rows.append({'id': f'{day}|{symbol}|{at}', 'period': period, 'session': day,
                     'symbol': symbol, 'at': at, 'feature': feature, 'label': label})
    results = {}
    for name in periods:
        subset = [row for row in rows if row['period'] == name]
        summary = describe(subset)
        results[name] = {**summary, 'acceptance': period_decision(summary, protocol['acceptance']),
                         'sessions': sorted(periods[name]),
                         'per_session': {day: describe([row for row in subset if row['session'] == day])
                                         for day in sorted(periods[name])}}
    accepted = all(results[name]['acceptance']['passed'] for name in results)
    return {'as_of': '2026-09-30', 'protocol': protocol['id'],
            'protocol_commit': PROTOCOL_COMMIT, 'status': protocol['status'],
            'feature': protocol['feature']['id'], 'sample_signals': len(rows),
            'development_signals': sum(row['period'] == 'development' for row in rows),
            'validation_signals': sum(row['period'] == 'validation' for row in rows),
            'new_market_requests': 0, 'holdout_opens': 0, 'verified_fills': 0,
            'results': results,
            'decision': ('ACCEPT_FOR_FURTHER_QUOTE_VALIDATION' if accepted else 'REJECT'),
            'live_rules_changed': False, 'profitability_claim_allowed': False,
            'confirmatory_inference_allowed': False,
            'limits': [protocol['sample']['source'], protocol['label']['purpose'],
                       protocol['multiplicity']['reason'],
                       'Validation dates were exposed by prior studies; this is temporal replication, not a blind independent test.',
                       'Final-test sessions 2026-09-02 through 2026-09-04 are not loaded by this runner.',
                       'Minute-bar target/stop labels do not establish executable bid/ask fills, halts, capacity or profitability.'],
            'rows': rows}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    report = build()
    path = ROOT / 'data/participation-breadth-report.json'
    content = dump(report)
    if args.check:
        if not path.exists() or path.read_text() != content:
            raise SystemExit('Participation-breadth reproduction mismatch')
    else:
        path.write_text(content)
    print(dump({key: value for key, value in report.items() if key != 'rows'}))


if __name__ == '__main__':
    main()
