"""Offline paired sensitivity of exit-capacity allowance on 20 frozen cases."""
import argparse
from collections import Counter
from dataclasses import asdict
import json
from statistics import mean

from .execution import Policy
from .phase2 import dump, sha
from .quote_anchored import anchored_setup
from .quote_anchored_later import first_decision, load as load_later
from .quote_anchored_order import (case_path_order, load_repair,
                                   prepare_order_invariant,
                                   simulate_order_invariant)
from .signal_clock import ROOT, prefix_end


PROTOCOL = ROOT / 'research/exit-capacity-sensitivity-protocol.json'
PROTOCOL_COMMIT = '80313dd1824fd2c310999023d9bce979351984f3'


def _load_protocol():
    protocol = json.loads(PROTOCOL.read_text())
    if protocol['holdout_opens'] or protocol['deployment_allowed'] or protocol['live_rule_changes_allowed']:
        raise ValueError('Sensitivity may not open holdout or change live rules')
    if protocol['new_market_request_budget'] != 0:
        raise ValueError('Sensitivity must remain offline')
    for path, digest in protocol['source_sha256'].items():
        if sha(ROOT / path) != digest:
            raise ValueError(f'Frozen sensitivity source changed: {path}')
    return protocol


def _prior_cases(primary):
    _, _, _, windows, exits, bars, anchors, _ = load_repair()
    cases = []
    for window in windows:
        case = {'id': window['setup']['id'], 'symbol': window['setup']['symbol']}
        rows, end, quality = case_path_order(window, exits.get(case['id']), bars, primary)
        anchor = anchors[case['id']]
        setup = (anchored_setup(case, {'available_at': anchor['at'], 'ask': anchor['ask']}, primary)
                 if anchor is not None else None)
        cases.append({**case, 'sample': '2026-08-24', 'decision': anchor, 'setup': setup,
                      'rows': rows, 'coverage_end': end, 'quality': quality})
    return cases


def _later_cases(primary):
    protocol, _, raw_by_case, intervals, bars_by_date, _ = load_later()
    cases = []
    for index, frozen in enumerate(protocol['cases']):
        signal = frozen['at']
        bars = bars_by_date[signal[:10]].get(frozen['symbol'], [])
        end = prefix_end(intervals[index], signal)
        rows, end, quality = prepare_order_invariant(
            raw_by_case[index], bars, signal, end,
            primary['entry']['maximum_completed_bar_age_seconds'])
        anchor = first_decision(rows, signal, primary['entry']['maximum_midpoint_spread_pct'])
        case = {'id': frozen['id'], 'symbol': frozen['symbol']}
        setup = anchored_setup(case, anchor, primary) if anchor is not None else None
        cases.append({**case, 'sample': '2026-08-25_to_2026-08-28',
                      'decision': anchor, 'setup': setup, 'rows': rows,
                      'coverage_end': end, 'quality': quality})
    return cases


def transition_counts(pairs):
    return dict(sorted(Counter(f"{before['status']} -> {after['status']}"
                               for before, after in pairs).items()))


def _missing_result():
    return {'status': 'UNKNOWN_NO_DECISION_QUOTE', 'entry_at': None, 'net_pct': None}


def build():
    protocol = _load_protocol()
    primary = json.loads((ROOT / 'research/quote-anchored-protocol.json').read_text())
    fixed = protocol['fixed_policy']
    if (primary['entry']['latency_seconds'] != protocol['entry_latency_seconds'] or
            [cost['id'] for cost in primary['cost_scenarios']] != protocol['cost_scenarios'] or
            primary['entry']['quantity_shares'] != fixed['quantity_shares'] or
            primary['entry']['window_seconds_after_decision'] != fixed['entry_window_seconds'] or
            primary['entry']['minimum_impact_adjusted_ask_multiplier'] != fixed['minimum_impact_adjusted_ask_multiplier'] or
            primary['entry']['maximum_impact_adjusted_ask_multiplier'] != fixed['maximum_impact_adjusted_ask_multiplier'] or
            primary['entry']['maximum_midpoint_spread_pct'] != fixed['maximum_midpoint_spread_pct'] or
            primary['entry']['maximum_participation_of_lagged_minute_volume'] != fixed['maximum_participation_of_lagged_minute_volume'] or
            primary['entry']['maximum_completed_bar_age_seconds'] != fixed['maximum_completed_bar_age_seconds'] or
            primary['barriers']['stop_bid_multiplier_of_decision_ask'] != fixed['stop_bid_multiplier_of_decision_ask'] or
            primary['barriers']['target_bid_multiplier_of_decision_ask'] != fixed['target_bid_multiplier_of_decision_ask'] or
            primary['barriers']['horizon_minutes_after_entry'] != fixed['horizon_minutes_after_entry']):
        raise ValueError('Frozen primary execution policy no longer matches sensitivity protocol')

    loaded = _prior_cases(primary) + _later_cases(primary)
    if [case['id'] for case in loaded] != protocol['cases']:
        raise ValueError('Frozen 20-case sensitivity sample changed')

    cases = []
    for case in loaded:
        item = {key: case[key] for key in ('id', 'symbol', 'sample', 'quality')}
        item['coverage_prefix_end'] = case['coverage_end'].isoformat()
        item['decision_available'] = case['decision'] is not None
        scenarios = []
        for delay in protocol['entry_latency_seconds']:
            for cost_id in protocol['cost_scenarios']:
                cost = next(row for row in primary['cost_scenarios'] if row['id'] == cost_id)
                for allowance in protocol['exit_capacity_allowance_seconds']:
                    if case['setup'] is None:
                        result = _missing_result()
                        policy = None
                    else:
                        policy = Policy(
                            latency_seconds=delay, quote_age_seconds=3,
                            horizon_seconds=fixed['horizon_minutes_after_entry'] * 60,
                            exit_wait_seconds=allowance,
                            max_participation=fixed['maximum_participation_of_lagged_minute_volume'],
                            fee_bps_per_side=cost['fee_bps_per_side'],
                            impact_bps_at_full_participation=cost['impact_bps_at_full_participation'])
                        result = simulate_order_invariant(
                            case['setup'], case['rows'], policy, case['coverage_end'],
                            fixed['maximum_midpoint_spread_pct'])
                    scenarios.append({
                        'id': f'DELAY_{delay}_{cost_id}_EXIT_{allowance}S',
                        'entry_latency_seconds': delay, 'cost': cost_id,
                        'exit_capacity_allowance_seconds': allowance,
                        'policy': asdict(policy) if policy is not None else None,
                        'result': result})
        item['scenarios'] = scenarios
        cases.append(item)

    summary = []
    transitions = []
    for delay in protocol['entry_latency_seconds']:
        for cost_id in protocol['cost_scenarios']:
            by_allowance = {}
            for allowance in protocol['exit_capacity_allowance_seconds']:
                results = [next(s['result'] for s in case['scenarios']
                                if s['entry_latency_seconds'] == delay and s['cost'] == cost_id and
                                s['exit_capacity_allowance_seconds'] == allowance)
                           for case in cases]
                counts = Counter(result['status'] for result in results)
                values = [result['net_pct'] for result in results if result.get('net_pct') is not None]
                row = {
                    'entry_latency_seconds': delay, 'cost': cost_id,
                    'exit_capacity_allowance_seconds': allowance,
                    'cases': len(results), 'status_counts': dict(sorted(counts.items())),
                    'simulated_entries': sum(result.get('entry_at') is not None for result in results),
                    'resolved_returns': len(values),
                    'unknown_exit_cases': counts.get('UNKNOWN_EXIT_COVERAGE', 0),
                    'all_unknown_cases': sum(count for status, count in counts.items()
                                             if status.startswith('UNKNOWN')),
                    'full_sample_expectancy_pct': mean(values) if len(values) == len(results) else None,
                    'resolved_only_mean_withheld': len(values) != len(results),
                    'profitability_claim_allowed': False}
                summary.append(row)
                by_allowance[allowance] = results
            pairs = list(zip(by_allowance[3], by_allowance[30]))
            transitions.append({
                'entry_latency_seconds': delay, 'cost': cost_id, 'cases': len(pairs),
                'unknown_exit_reduction': sum(a['status'] == 'UNKNOWN_EXIT_COVERAGE' for a, _ in pairs) -
                                          sum(b['status'] == 'UNKNOWN_EXIT_COVERAGE' for _, b in pairs),
                'status_transitions': transition_counts(pairs),
                'changed_cases': [case['id'] for case, (a, b) in zip(cases, pairs)
                                  if a['status'] != b['status'] or a.get('exit_at') != b.get('exit_at')]})

    return {
        'as_of': '2026-09-29', 'protocol': protocol['id'],
        'protocol_commit': PROTOCOL_COMMIT, 'status': protocol['status'],
        'sample_cases': len(cases), 'new_market_requests': 0, 'holdout_opens': 0,
        'verified_fills': 0, 'live_rules_changed': False,
        'profitability_claim_allowed': False, 'summary': summary,
        'paired_transitions': transitions, 'cases': cases,
        'limits': [protocol['selection'], protocol['interpretation'],
                   'The 30-second arm can only use quote records already cached before this protocol was frozen.',
                   'A resolved historical quote scenario is not an actual fill and cannot establish profitability.',
                   'All 20 cases are exposed development observations; final holdout remains sealed.']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    report = build()
    path = ROOT / 'data/exit-capacity-sensitivity-report.json'
    content = dump(report)
    if args.check:
        if not path.exists() or path.read_text() != content:
            raise SystemExit('Exit-capacity sensitivity reproduction mismatch')
    else:
        path.write_text(content)
    print(dump({key: value for key, value in report.items() if key != 'cases'}))


if __name__ == '__main__':
    main()
