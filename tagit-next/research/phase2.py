"""Frozen development ablations. Offline; cannot read holdout or submit orders."""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
from random import Random
from statistics import mean
from .events import time
from .features import (END_OF_MINUTE, exchange_sessions, visible_bars,
                       session_position, momentum_atr, same_time_rvol)

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(value):
    return json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n'


def describe(rows):
    values = [r['net_pct'] for r in rows if r['net_pct'] is not None]
    wins = [v for v in values if v > 0]; losses = [v for v in values if v < 0]
    return {'signals': len(rows), 'evaluable': len(values), 'missing_outcomes': len(rows) - len(values),
            'conditional_mean_pct': mean(values) if values else None,
            'all_signal_expectancy_pct': mean(values) if values and len(values) == len(rows) else None,
            'positive': len(wins), 'negative': len(losses), 'zero': sum(v == 0 for v in values),
            'conditional_win_rate': len(wins) / len(values) if values else None,
            'mean_win_pct': mean(wins) if wins else None, 'mean_loss_pct': mean(losses) if losses else None,
            'conditional_profit_factor': sum(wins) / -sum(losses) if losses else None}


def percentile(values, p):
    values = sorted(values); x = (len(values) - 1) * p; lo = int(x)
    return values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (x - lo)


def paired_bootstrap(rows, iterations, seed, family_size, minimum_complete_fraction=.99):
    """Resample the same session blocks for selected subset and observable baseline.

    Keep sessions with zero labels in the sampling frame. Empty replicates count
    against coverage; intervals are unavailable if fewer than 99% can be scored.
    Unknown labels are never imputed. These are conditional exploratory intervals.
    """
    if iterations < 1 or family_size < 1 or not 0 < minimum_complete_fraction <= 1:
        raise ValueError('Invalid bootstrap configuration')
    groups = defaultdict(lambda: [0.0, 0, 0.0, 0])
    for r in rows:
        totals = groups[r['session']]
        if r['net_pct'] is not None:
            totals[0] += r['net_pct']; totals[1] += 1
            if r['selected']:
                totals[2] += r['net_pct']; totals[3] += 1
    days = sorted(groups); rng = Random(seed); draws = []
    if len(days) >= 2:
        for _ in range(iterations):
            totals = [0., 0, 0., 0]
            for day in rng.choices(days, k=len(days)):
                totals = [a + b for a, b in zip(totals, groups[day])]
            if totals[1] and totals[3]:
                baseline = totals[0] / totals[1]; selected = totals[2] / totals[3]
                draws.append((selected, baseline, selected - baseline))
    enough = len(draws) / iterations >= minimum_complete_fraction
    def interval(index, alpha):
        vals = [d[index] for d in draws]
        return [percentile(vals, alpha / 2), percentile(vals, 1 - alpha / 2)] if enough else None
    return {'sessions': len(days), 'small_cluster_warning': len(days) < 30,
            'iterations': iterations, 'valid_replicates': len(draws), 'seed': seed,
            'selected_mean_ci95_pct': interval(0, .05),
            'comparator_mean_ci95_pct': interval(1, .05),
            'effect_ci95_percentage_points': interval(2, .05),
            'effect_family_adjusted_ci_percentage_points': interval(2, .05 / family_size),
            'family_size': family_size, 'per_interval_confidence': 1 - .05 / family_size,
            'p_adjusted': None, 'confirmatory_significance': 'NOT_ELIGIBLE',
            'scope': 'Conditional on feature-observable and outcome-observed development rows; no missing-data correction'}


def compare(rows, feature, protocol):
    known_rows = []; missing = []
    for row in rows:
        value = row['features'][feature]
        if value['value'] is None:
            missing.append(row)
        else:
            known_rows.append({**row, 'selected': value['selected']})
    selected = [r for r in known_rows if r['selected']]
    excluded = [r for r in known_rows if not r['selected']]
    base, filtered = describe(known_rows), describe(selected)
    delta = (filtered['conditional_mean_pct'] - base['conditional_mean_pct']
             if filtered['evaluable'] and base['evaluable'] else None)
    stats = protocol['statistics']
    boot = paired_bootstrap(known_rows, stats['iterations'], stats['seed'], stats['family_size'],
                            stats['minimum_complete_bootstrap_fraction'])
    session_rows = []
    for day in sorted({r['session'] for r in rows}):
        b = describe([r for r in known_rows if r['session'] == day])
        f = describe([r for r in selected if r['session'] == day])
        session_rows.append({'session': day, 'comparator': b, 'selected': f,
                             'effect_percentage_points': f['conditional_mean_pct'] - b['conditional_mean_pct']
                             if b['evaluable'] and f['evaluable'] else None})
    return {'id': feature, 'decision': 'NOT_APPROVED_DEVELOPMENT_ONLY',
            'full_baseline': describe(rows), 'same_observable_population_baseline': base,
            'selected': filtered, 'excluded': describe(excluded),
            'unknown_feature': describe(missing),
            'missing_feature_reasons': dict(sorted(Counter(r['features'][feature]['status'] for r in missing).items())),
            'effect_percentage_points': delta, 'bootstrap': boot,
            'cost_sensitivity': [{'assumed_round_trip_cost_percentage_points': c,
                                 'conditional_selected_mean_pct': filtered['conditional_mean_pct'] - (c - .5)
                                 if filtered['evaluable'] else None,
                                 'conditional_comparator_mean_pct': base['conditional_mean_pct'] - (c - .5)
                                 if base['evaluable'] else None}
                                for c in protocol['cost_sensitivity_round_trip_percentage_points']],
            'per_session_descriptive_not_walk_forward': session_rows}


def build():
    protocol = json.loads((ROOT / 'research/phase2-protocol.json').read_text())
    inputs = json.loads((ROOT / 'research/phase2-inputs.json').read_text())
    for path, digest in {**protocol['source_sha256'], **inputs['sha256']}.items():
        if sha(ROOT / path) != digest:
            raise ValueError(f'Frozen input changed: {path}')
    if (protocol['period']['role'] != 'ALREADY_EXPOSED_DEVELOPMENT' or protocol['deployment_allowed']
            or protocol['holdout']['opens'] != 0):
        raise ValueError('This runner only supports development diagnostics')
    hypotheses = {h['id']: h for h in protocol['hypotheses']}
    if set(hypotheses) != {'core_session', 'momentum_atr'} or protocol['statistics']['family_size'] != len(hypotheses):
        raise ValueError('Unexpected hypothesis family')
    calendar = json.loads((ROOT / inputs['calendar_path']).read_text())
    sessions = exchange_sessions(calendar['calendar'])
    sources = {}
    manifest = json.loads((ROOT / 'data/study-manifest.json').read_text())
    for item in manifest['files']:
        path = ROOT / item['path']
        if sha(path) != item['sha256']:
            raise ValueError(f'Source hash mismatch: {path}')
        date = path.name[:10]
        if not protocol['period']['start'] <= date <= protocol['period']['end']:
            raise ValueError('Unregistered data date')
        sources[date] = json.loads(gzip.decompress(path.read_bytes()))['bars']
    ledger = json.loads((ROOT / 'data/discovery-audit.json').read_text())['events']
    rows = []; seen = set(); rvol_status = Counter()
    for e in ledger:
        sid = f"{e['date']}|{e['symbol']}|{e['detected_at']}"
        if sid in seen:
            raise ValueError('Duplicate signal ID')
        seen.add(sid)
        at = time(e['detected_at']); session = sessions[e['date']]
        source = [b for b in sources[e['date']].get(e['symbol'], [])
                  if session[0] <= time(b['timestamp']) < session[1]]
        bars = visible_bars(source, at, END_OF_MINUTE)
        position = session_position(at, session)
        core = hypotheses['core_session']
        position['selected'] = (position['regular_session'] and position['value'] >= core['first_minutes_excluded'] and
                                position['minutes_to_close'] > core['last_minutes_excluded']) if position['value'] is not None else None
        momentum = momentum_atr(bars, at, hypotheses['momentum_atr']['atr_period'])
        momentum['selected'] = momentum['value'] >= hypotheses['momentum_atr']['minimum_ratio'] if momentum['value'] is not None else None
        # Coverage probe only: no 20-session history exists in this ten-session sample.
        rv = same_time_rvol(bars, at, sessions)
        rvol_status[rv['status']] += 1
        # Labels are joined AFTER features/masks are fixed, and never enter features.
        net = e.get('end_return_after_assumed_cost_pct')
        if bool(e['scorable']) != (net is not None):
            raise ValueError('Inconsistent outcome coverage')
        rows.append({'id': sid, 'session': e['date'], 'symbol': e['symbol'], 'at': e['detected_at'],
                     'net_pct': net, 'features': {'core_session': position, 'momentum_atr': momentum}})
    results = [compare(rows, h['id'], protocol) for h in protocol['hypotheses']]
    report = {'protocol': protocol['id'], 'protocol_commit': inputs['protocol_commit'],
              'as_of': '2026-09-24', 'status': 'DEVELOPMENT_DIAGNOSTIC_ONLY',
              'period': protocol['period'], 'full_baseline': describe(rows), 'comparisons': results,
              'rvol_20sessions': {'status': 'NOT_EVALUABLE', 'reasons': dict(sorted(rvol_status.items())),
                                  'effect': None, 'reason': 'Only ten saved sessions; split-volume basis also unqualified'},
              'new_price_quote_trade_requests': 0, 'new_calendar_requests': 1,
              'phase1_complete': False, 'live_rules_changed': False, 'profitability_claim_allowed': False,
              'holdout_opens': 0, 'independent_validation': None, 'final_configuration': None,
              'limits': [protocol['label'], protocol['availability'], protocol['comparison'],
                         'Selected surviving symbols, not a historical NASDAQ <$100M point-in-time universe',
                         'Exposed development dates; per-session breakdown is not walk-forward validation',
                         'Missing outcomes can be informative; conditional means cannot establish all-signal profitability',
                         'Only ten sessions; bootstrap intervals and cost scenarios are exploratory',
                         'No quotes, executable remaining-upside labels or news added; holdout remains locked'],
              'signal_masks': [{'id': r['id'], 'outcome_observed': r['net_pct'] is not None,
                                'core_session': r['features']['core_session'],
                                'momentum_atr': r['features']['momentum_atr']} for r in rows]}
    return report


def public_evidence(report):
    return {k: v for k, v in report.items() if k != 'signal_masks'}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); args = parser.parse_args()
    report = build()
    artifacts = {ROOT / 'data/phase2-development.json': dump(report),
                 ROOT / 'web/phase2-evidence.json': dump(public_evidence(report))}
    for path, value in artifacts.items():
        if args.check:
            if not path.exists() or path.read_text() != value:
                raise SystemExit(f'Reproduction mismatch: {path}')
        else:
            path.write_text(value)
    print(dump({'status': report['status'], 'signals': report['full_baseline']['signals'],
                'comparisons': [{k: r[k] for k in ('id', 'selected', 'excluded', 'unknown_feature',
                                                  'effect_percentage_points', 'bootstrap')} for r in report['comparisons']],
                'profitability_claim_allowed': False}))


if __name__ == '__main__':
    main()
