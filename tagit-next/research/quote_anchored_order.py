"""Order-invariant repair for same-timestamp quote records in the frozen audit."""
import argparse
from collections import Counter, defaultdict
from dataclasses import asdict
from datetime import timedelta
import gzip
import json
from math import isfinite, sqrt

from .events import time
from .execution import Policy, valid_quote
from .phase2 import dump, sha
from .quote_anchored import anchored_setup, load_inputs, midpoint_spread_pct
from .quote_units import VERSION, normalize
from .signal_clock import ROOT, prefix_end, volume_index, volume_at


def prepare_order_invariant(raw, bars, start, end, max_age=90):
    """Build a conservative envelope without choosing provider record order."""
    start, end = time(start), time(end)
    groups = defaultdict(list)
    index = volume_index(bars)
    for row in raw:
        at = time(row['timestamp'])
        if start <= at < end:
            groups[at].append(row)
    rows = []
    duplicates = conflicts = 0
    invalid_at = None
    for at, group in sorted(groups.items()):
        states = {}
        for raw_row in group:
            key = tuple(repr(raw_row.get(k)) for k in ('bid_price', 'ask_price', 'bid_size', 'ask_size'))
            states.setdefault(key, raw_row)
        duplicates += len(group) - len(states)
        conflicts += len(states) > 1
        normalized = []
        for raw_row in states.values():
            sizes = normalize(raw_row.get('bid_size'), raw_row.get('ask_size'), raw_row['timestamp'],
                              provider='alpaca', feed='sip')
            state = dict(bid=raw_row.get('bid_price'), ask=raw_row.get('ask_price'),
                         bid_size=sizes['bid_size'], ask_size=sizes['ask_size'])
            if not valid_quote(state):
                invalid_at = at
                end = at
                break
            normalized.append(state)
        if invalid_at is not None:
            break
        volume, available = volume_at(index, at, max_age)
        bids = [s['bid'] for s in normalized]
        asks = [s['ask'] for s in normalized]
        rows.append(dict(sequence=len(rows), event_at=at.isoformat(), available_at=at.isoformat(),
                         bid=min(bids), bid_min=min(bids), bid_max=max(bids),
                         ask=max(asks), ask_min=min(asks), ask_max=max(asks),
                         bid_size=min(s['bid_size'] for s in normalized),
                         ask_size=min(s['ask_size'] for s in normalized),
                         same_time_states=len(normalized), lagged_volume=volume,
                         volume_available_at=available, volume_end_at=available))
    return rows, end, dict(exact_duplicate_updates_removed=duplicates,
                           conflicting_same_time_groups_enveloped=conflicts,
                           invalid_group_at=invalid_at.isoformat() if invalid_at else None)


def possible_entry(q, setup, policy):
    """Return all-in-band, none-in-band, or mixed for the ask range."""
    volume = q.get('lagged_volume')
    if volume is None or volume <= 0:
        maximum_impact = policy.impact_bps_at_full_participation * sqrt(policy.max_participation) / 10000
        low, high = q['ask_min'], q['ask_max'] * (1 + maximum_impact)
        return 'UNKNOWN_VOLUME' if low <= setup['max_entry'] and high >= setup['entry'] else 'NONE'
    if not q.get('volume_available_at') or time(q['volume_available_at']) > time(q['available_at']):
        return 'UNKNOWN_VOLUME'
    if setup['quantity'] > q['ask_size'] or setup['quantity'] / volume > policy.max_participation:
        return 'NONE'
    impact = policy.impact_bps_at_full_participation * sqrt(setup['quantity'] / volume) / 10000
    low, high = q['ask_min'] * (1 + impact), q['ask_max'] * (1 + impact)
    if setup['entry'] <= low and high <= setup['max_entry']:
        return 'ALL'
    if high < setup['entry'] or low > setup['max_entry']:
        return 'NONE'
    return 'MIXED'


def simulate_order_invariant(setup, quotes, policy, coverage_end, maximum_spread_pct):
    start, expiry, end = time(setup['decision_at']), time(setup['expires_at']), time(coverage_end)
    qty = setup['quantity']
    rows = sorted(quotes, key=lambda q: (time(q['available_at']), q['sequence']))
    base = dict(id=setup['id'], symbol=setup['symbol'], status='UNKNOWN_COVERAGE', net_pct=None,
                entry_at=None, exit_at=None, mae_pct=None, mfe_pct=None, verified_fill=False,
                approved_for_live=False, evidence='ORDER_INVARIANT_HISTORICAL_QUOTE_SCENARIO')
    filled = deadline = trigger = trigger_at = None
    adverse = []
    favorable = []

    def finish(status, **extra):
        return {**base, 'status': status, **extra,
                'mae_pct': min(0, min(adverse)) if adverse else None,
                'mfe_pct': max(0, max(favorable)) if favorable else None}

    def executable(q, at, side):
        volume = q.get('lagged_volume')
        if (isinstance(volume, bool) or not isinstance(volume, (int, float)) or
                not isfinite(volume) or volume <= 0):
            return None
        if not q.get('volume_available_at') or time(q['volume_available_at']) > at:
            return None
        if qty > q[side + '_size'] or qty / volume > policy.max_participation:
            return None
        impact = policy.impact_bps_at_full_participation * sqrt(qty / volume) / 10000
        return q[side] * (1 + impact if side == 'ask' else 1 - impact)

    for q in rows:
        at = time(q['available_at'])
        if at < start:
            continue
        if filled is None and at > expiry:
            break
        exit_clock = trigger_at if trigger_at is not None else deadline
        if filled is not None and at > exit_clock + timedelta(seconds=policy.exit_wait_seconds):
            break
        if not valid_quote(q) or (at - time(q['event_at'])).total_seconds() > policy.quote_age_seconds:
            continue
        if filled is None:
            if q['bid_min'] <= setup['stop']:
                return finish('INVALIDATED_BEFORE_ENTRY', invalidated_at=at.isoformat())
            if at < start + timedelta(seconds=policy.latency_seconds):
                continue
            if midpoint_spread_pct(q) > maximum_spread_pct:
                continue
            eligibility = possible_entry(q, setup, policy)
            if eligibility == 'UNKNOWN_VOLUME':
                return finish('UNKNOWN_ENTRY_LIQUIDITY', unknown_liquidity_at=at.isoformat())
            if eligibility == 'MIXED':
                return finish('UNKNOWN_SAME_TIME_ENTRY_ORDER', ambiguous_at=at.isoformat())
            if eligibility != 'ALL':
                continue
            price = executable(q, at, 'ask')
            if price is None:
                continue
            filled = price
            deadline = at + timedelta(seconds=policy.horizon_seconds)
            base.update(entry_at=at.isoformat(), entry_ask=q['ask'], entry_price=price,
                        deadline=deadline.isoformat())
            adverse.append((q['bid_min'] / filled - 1) * 100)
            favorable.append((q['bid_max'] / filled - 1) * 100)
            continue
        adverse.append((q['bid_min'] / filled - 1) * 100)
        favorable.append((q['bid_max'] / filled - 1) * 100)
        if trigger is None:
            if at >= deadline:
                trigger = 'TIMEOUT'
            elif q['bid_min'] <= setup['stop'] and q['bid_max'] >= setup['target']:
                return finish('UNKNOWN_SAME_TIME_BARRIER_ORDER', ambiguous_at=at.isoformat())
            elif q['bid_min'] <= setup['stop']:
                trigger = 'STOP'
            elif q['bid_min'] >= setup['target']:
                trigger = 'TARGET'
            if trigger is not None:
                trigger_at = at
        if trigger is None:
            continue
        if end < at:
            return finish('UNKNOWN_EXIT_COVERAGE', trigger=trigger, trigger_at=trigger_at.isoformat())
        price = executable(q, at, 'bid')
        if price is None:
            continue
        fee = policy.fee_bps_per_side / 10000
        net = (price * (1 - fee) / (filled * (1 + fee)) - 1) * 100
        return finish(trigger, net_pct=net, exit_at=at.isoformat(), exit_bid=q['bid'], exit_price=price,
                      trigger_at=trigger_at.isoformat(), exit_delay_seconds=(at - trigger_at).total_seconds())
    if filled is not None:
        return finish('UNKNOWN_EXIT_COVERAGE', trigger=trigger,
                      trigger_at=trigger_at.isoformat() if trigger_at else None)
    return finish('NO_ENTRY' if end >= expiry else 'UNKNOWN_ENTRY_COVERAGE')


def inverse_order_invariant(rows, setup, coverage_end, allowance):
    start = time(setup['decision_at'])
    deadline = start + timedelta(minutes=45)
    for q in rows:
        at = time(q['available_at'])
        if at <= start or at > deadline:
            continue
        if q['bid_min'] <= setup['stop'] and q['bid_max'] >= setup['target']:
            return dict(status='UNKNOWN_SAME_TIME_BARRIER_ORDER', at=at.isoformat(), bid=None)
        if q['bid_min'] <= setup['stop']:
            return dict(status='STOP_FIRST_INDICATION', at=at.isoformat(), bid=q['bid_min'])
        if q['bid_min'] >= setup['target']:
            return dict(status='TARGET_FIRST_INDICATION', at=at.isoformat(), bid=q['bid_min'])
    fresh = [q for q in rows if deadline <= time(q['available_at']) <= deadline + timedelta(seconds=allowance)]
    if time(coverage_end) >= deadline + timedelta(seconds=allowance) and fresh:
        return dict(status='NO_BARRIER_FRESH_TIMEOUT', at=fresh[0]['available_at'], bid=fresh[0]['bid_min'])
    return dict(status='UNKNOWN_PATH_OR_TIMEOUT', at=None, bid=None)


def load_repair():
    inputs = json.loads((ROOT / 'research/quote-anchored-order-inputs.json').read_text())
    repair_path = ROOT / 'research/quote-anchored-order-protocol.json'
    if sha(repair_path) != inputs['protocol_sha256']:
        raise ValueError('Frozen repair protocol changed')
    repair = json.loads(repair_path.read_text())
    if repair['holdout_opens'] or repair['deployment_allowed'] or repair['live_rule_changes_allowed']:
        raise ValueError('Development measurement repair only')
    for path, digest in repair['source_sha256'].items():
        if sha(ROOT / path) != digest:
            raise ValueError(f'Frozen repair source changed: {path}')
    _, primary, windows, exits, bars = load_inputs()
    if primary['cases'] != repair['cases']:
        raise ValueError('Repair sample changed')
    raw_report = json.loads((ROOT / 'data/quote-anchored-report.json').read_text())
    anchors = {c['id']: c['decision'] for c in raw_report['cases']}
    return inputs, repair, primary, windows, exits, bars, anchors, raw_report


def case_path_order(entry_window, exit_window, bars, primary):
    old = entry_window['setup']
    start = time(old['at'])
    intervals = []
    quotes = list(entry_window['quotes'])
    if entry_window.get('error') is None and entry_window['feed'] == 'sip' and len(quotes) < entry_window['limit']:
        intervals.append((old['at'], old['expires_at']))
    if exit_window is not None and not exit_window.get('error') and exit_window['feed'] == 'sip':
        extra = exit_window.get('quotes', [])
        quotes += extra
        at = exit_window['entry']['first_eligible']['at']
        deadline = time(at) + timedelta(minutes=45)
        finish = extra[-1]['timestamp'] if exit_window.get('truncated', len(extra) >= exit_window['limit']) else (deadline + timedelta(seconds=3)).isoformat()
        intervals.append((at, finish))
    end = prefix_end(intervals, start)
    return prepare_order_invariant(quotes, bars.get(old['symbol'], []), start, end,
                                   primary['entry']['maximum_completed_bar_age_seconds'])


def build():
    inputs, repair, primary, windows, exits, bars, anchors, raw_report = load_repair()
    raw_summary = {s['id']: s for s in raw_report['summary']}
    cases = []
    for window in windows:
        case = dict(id=window['setup']['id'], symbol=window['setup']['symbol'])
        rows, end, quality = case_path_order(window, exits.get(case['id']), bars, primary)
        anchor = anchors[case['id']]
        if anchor is None:
            cases.append({**case, 'decision': None, 'quality': quality, 'coverage_prefix_end': end.isoformat(),
                          'inverse': dict(status='UNKNOWN_NO_DECISION_QUOTE', at=None, bid=None), 'scenarios': []})
            continue
        setup = anchored_setup(case, {'available_at': anchor['at'], 'ask': anchor['ask']}, primary)
        scenarios = []
        for delay in primary['entry']['latency_seconds']:
            for cost in primary['cost_scenarios']:
                policy = Policy(latency_seconds=delay, quote_age_seconds=3,
                                horizon_seconds=primary['barriers']['horizon_minutes_after_entry'] * 60,
                                exit_wait_seconds=primary['barriers']['fresh_timeout_allowance_seconds'],
                                max_participation=primary['entry']['maximum_participation_of_lagged_minute_volume'],
                                fee_bps_per_side=cost['fee_bps_per_side'],
                                impact_bps_at_full_participation=cost['impact_bps_at_full_participation'])
                result = simulate_order_invariant(setup, rows, policy, end,
                                                  primary['entry']['maximum_midpoint_spread_pct'])
                scenarios.append(dict(id=f"DELAY_{delay}_{cost['id']}", policy=asdict(policy), result=result))
        cases.append({**case, 'decision': anchor, 'setup': setup, 'quality': quality,
                      'coverage_prefix_end': end.isoformat(),
                      'inverse': inverse_order_invariant(rows, setup, end,
                                                        primary['barriers']['fresh_timeout_allowance_seconds']),
                      'scenarios': scenarios})
    summary = []
    ids = [f"DELAY_{d}_{c['id']}" for d in primary['entry']['latency_seconds'] for c in primary['cost_scenarios']]
    for ident in ids:
        results = [next((s['result'] for s in c['scenarios'] if s['id'] == ident),
                        dict(status='UNKNOWN_NO_DECISION_QUOTE', entry_at=None, net_pct=None)) for c in cases]
        status = Counter(r['status'] for r in results)
        before = raw_summary[ident]
        before_unknown = sum(v for k, v in before['status_counts'].items() if k.startswith('UNKNOWN'))
        after_unknown = sum(v for k, v in status.items() if k.startswith('UNKNOWN'))
        summary.append(dict(id=ident, cases=len(results), status_counts=dict(sorted(status.items())),
                            simulated_entries=sum(r.get('entry_at') is not None for r in results),
                            resolved_returns=sum(r.get('net_pct') is not None for r in results),
                            raw_unknown_cases=before_unknown, repaired_unknown_cases=after_unknown,
                            unknown_cases_resolved_by_measurement_repair=before_unknown-after_unknown,
                            full_sample_expectancy_pct=None,
                            resolved_only_mean_not_strategy_expectancy=True,
                            inverse_no_entry_target_first=sum(r['status'] == 'NO_ENTRY' and c['inverse']['status'] == 'TARGET_FIRST_INDICATION'
                                                            for r, c in zip(results, cases))))
    return dict(as_of='2026-09-27', protocol=repair['id'], protocol_commit=inputs['protocol_commit'],
                status=repair['status'], sample_cases=len(cases), new_market_requests=0,
                quote_unit_version=VERSION, summary=summary, cases=cases, holdout_opens=0,
                verified_fills=0, live_rules_changed=False, profitability_claim_allowed=False,
                limits=[repair['reason_selected'], repair['normalization'], repair['entry_rule'],
                        repair['barrier_rule'], repair['comparison'],
                        'Exit capacity may wait at most the frozen allowance from the barrier trigger, not from the later horizon.',
                        'One exposed development session is not evidence of temporal stability or market-wide recall.',
                        'Historical event timestamps are not historical receipt times and no queue position or actual fill is known.'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    report = build()
    path = ROOT / 'data/quote-anchored-order-report.json'
    content = dump(report)
    if args.check:
        if not path.exists() or path.read_text() != content:
            raise SystemExit('Order-invariant quote-anchored reproduction mismatch')
    else:
        path.write_text(content)
    print(dump({k: v for k, v in report.items() if k != 'cases'}))
    for case in report['cases']:
        print(case['id'], case['inverse']['status'],
              [(s['id'], s['result']['status'], s['result']['net_pct']) for s in case['scenarios']])


if __name__ == '__main__':
    main()
