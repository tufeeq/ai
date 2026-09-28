"""Reproduce the frozen later-development quote-anchored study offline."""
import argparse
from collections import Counter, defaultdict
from dataclasses import asdict
from datetime import timedelta
import gzip
import json
from statistics import mean

from .events import time
from .execution import Policy, valid_quote
from .phase2 import dump, sha
from .quote_anchored import anchored_setup, midpoint_spread_pct
from .quote_anchored_order import prepare_order_invariant, simulate_order_invariant
from .quote_units import VERSION
from .signal_clock import ROOT, prefix_end


PROTOCOL = ROOT / 'research/quote-anchored-later-protocol.json'
LEDGER = ROOT / 'data/quote-anchored-later/retrieval.json'


def first_decision(rows, signal_at, maximum_spread_pct):
    start = time(signal_at)
    end = start + timedelta(minutes=2)
    for row in rows:
        at = time(row['available_at'])
        if at >= end:
            break
        if at >= start and valid_quote(row) and midpoint_spread_pct(row) <= maximum_spread_pct:
            return row
    return None


def quote_discovery(rows, decision_at, coverage_end, reference, threshold_pct, allowance=3):
    """Conservative bid-side opportunity label; this is not an execution return."""
    start = time(decision_at)
    deadline = start + timedelta(minutes=45)
    stop = reference * .97
    target = reference * (1 + threshold_pct / 100)
    for row in rows:
        at = time(row['available_at'])
        if at <= start or at > deadline:
            continue
        if not valid_quote(row):
            continue
        stop_hit = row['bid_min'] <= stop
        target_certain = row['bid_min'] >= target
        target_possible = row['bid_max'] >= target
        if stop_hit and target_possible:
            return {'status': 'UNKNOWN_SAME_TIME_BARRIER_ORDER', 'at': at.isoformat()}
        if stop_hit:
            return {'status': 'STOP_FIRST', 'at': at.isoformat()}
        if target_certain:
            return {'status': 'TARGET_FIRST', 'at': at.isoformat()}
    fresh = [row for row in rows
             if deadline <= time(row['available_at']) <= deadline + timedelta(seconds=allowance)
             and valid_quote(row)]
    if time(coverage_end) >= deadline + timedelta(seconds=allowance) and fresh:
        return {'status': 'NOT_REACHED_FRESH_TIMEOUT', 'at': fresh[0]['available_at']}
    return {'status': 'UNKNOWN_PATH_OR_TIMEOUT', 'at': None}


def bar_discovery(bars, decision_at, reference, threshold_pct):
    """Session-close trade-bar diagnostic, kept separate from quote execution."""
    decision = time(decision_at)
    first_whole_minute = decision.replace(second=0, microsecond=0) + timedelta(minutes=1)
    close = decision.replace(hour=20, minute=0, second=0, microsecond=0)
    stop = reference * .97
    target = reference * (1 + threshold_pct / 100)
    used = 0
    for bar in sorted(bars, key=lambda row: time(row['timestamp'])):
        at = time(bar['timestamp'])
        if at < first_whole_minute or at >= close:
            continue
        used += 1
        stop_hit = bar['low'] <= stop
        target_hit = bar['high'] >= target
        if stop_hit and target_hit:
            return {'status': 'UNKNOWN_SAME_MINUTE_BARRIER_ORDER', 'at': at.isoformat(), 'bars': used}
        if stop_hit:
            return {'status': 'STOP_FIRST', 'at': at.isoformat(), 'bars': used}
        if target_hit:
            return {'status': 'TARGET_FIRST', 'at': at.isoformat(), 'bars': used}
    return {'status': 'NOT_REACHED_BY_SESSION_CLOSE', 'at': None, 'bars': used}


def load():
    ledger = json.loads(LEDGER.read_text())
    if sha(PROTOCOL) != ledger['protocol_sha256']:
        raise ValueError('Frozen later-development protocol changed')
    protocol = json.loads(PROTOCOL.read_text())
    if protocol['holdout_opens'] or protocol['deployment_allowed'] or protocol['live_rule_changes_allowed']:
        raise ValueError('Later-development study cannot open holdout or deploy')
    if ledger['requests_used'] != len(ledger['records']) or ledger['requests_used'] > protocol['new_market_request_budget']:
        raise ValueError('Request ledger exceeds the frozen budget')
    for path, digest in protocol['source_sha256'].items():
        if sha(ROOT / path) != digest:
            raise ValueError(f'Frozen source changed: {path}')

    raw_by_case = defaultdict(list)
    intervals = defaultdict(list)
    total = 0
    for record in ledger['records']:
        path = ROOT / 'data/quote-anchored-later' / record['filename']
        if sha(path) != record['sha256']:
            raise ValueError(f'Retrieval file changed: {record["filename"]}')
        page = json.loads(gzip.decompress(path.read_bytes())) if path.suffix == '.gz' else json.loads(path.read_text())
        request = page['request']
        case = protocol['cases'][record['case_index']]
        symbol = case['symbol']
        quotes = page.get('quotes', {}).get(symbol, [])
        if (page['tool'] != 'get_stock_quotes' or request['symbols'] != [symbol] or
                request['feed'] != 'sip' or request['sort'] != 'asc' or
                request['limit'] != protocol['retrieval']['limit_per_request'] or
                page['counts']['records'] != record['count'] or len(quotes) != record['count'] or
                any(row['symbol'] != symbol for row in quotes)):
            raise ValueError(f'Invalid retrieval record: {record["filename"]}')
        start, requested_end = request['start'], request['end']
        if not time(case['at']) <= time(start) < time(requested_end) <= time(case['at']) + timedelta(minutes=48):
            raise ValueError(f'Retrieval outside frozen window: {record["filename"]}')
        end = quotes[-1]['timestamp'] if len(quotes) >= request['limit'] else requested_end
        raw_by_case[record['case_index']].extend(quotes)
        intervals[record['case_index']].append((start, end))
        total += len(quotes)

    bars = {}
    manifest = json.loads((ROOT / 'data/study-manifest.json').read_text())
    wanted = {time(case['at']).date().isoformat() for case in protocol['cases']}
    for item in manifest['files']:
        date = (ROOT / item['path']).name[:10]
        if date not in wanted:
            continue
        path = ROOT / item['path']
        if sha(path) != item['sha256']:
            raise ValueError(f'Bar file changed: {item["path"]}')
        bars[date] = json.loads(gzip.decompress(path.read_bytes()))['bars']
    if set(bars) != wanted:
        raise ValueError('Missing frozen development bars')
    return protocol, ledger, raw_by_case, intervals, bars, total


def build():
    protocol, ledger, raw_by_case, intervals, bars_by_date, total = load()
    primary = json.loads((ROOT / 'research/quote-anchored-protocol.json').read_text())
    if (protocol['entry'] != primary['entry'] or protocol['cost_scenarios'] != primary['cost_scenarios'] or
            protocol['execution_label']['stop_bid_multiplier_of_decision_ask'] != primary['barriers']['stop_bid_multiplier_of_decision_ask'] or
            protocol['execution_label']['target_bid_multiplier_of_decision_ask'] != primary['barriers']['target_bid_multiplier_of_decision_ask'] or
            protocol['execution_label']['horizon_minutes_after_entry'] != primary['barriers']['horizon_minutes_after_entry'] or
            protocol['execution_label']['fresh_timeout_allowance_seconds'] != primary['barriers']['fresh_timeout_allowance_seconds']):
        raise ValueError('Later-development execution policy differs from the frozen primary policy')
    cases = []
    for index, case in enumerate(protocol['cases']):
        signal = time(case['at'])
        date = signal.date().isoformat()
        bars = bars_by_date[date].get(case['symbol'], [])
        coverage_end = prefix_end(intervals[index], signal)
        rows, coverage_end, quality = prepare_order_invariant(
            raw_by_case[index], bars, signal, coverage_end,
            primary['entry']['maximum_completed_bar_age_seconds'])
        anchor = first_decision(rows, signal, primary['entry']['maximum_midpoint_spread_pct'])
        item = {'id': case['id'], 'symbol': case['symbol'], 'quality': quality,
                'coverage_prefix_end': coverage_end.isoformat()}
        if anchor is None:
            item.update(decision=None, scenarios=[], quote_discovery={}, bar_discovery={})
            cases.append(item)
            continue
        decision = {'at': anchor['available_at'], 'bid': anchor['bid'], 'ask': anchor['ask'],
                    'spread_pct': midpoint_spread_pct(anchor), 'bid_size': anchor['bid_size'],
                    'ask_size': anchor['ask_size']}
        setup = anchored_setup({'id': case['id'], 'symbol': case['symbol']}, anchor, primary)
        scenarios = []
        for delay in primary['entry']['latency_seconds']:
            for cost in primary['cost_scenarios']:
                policy = Policy(latency_seconds=delay, quote_age_seconds=3,
                                horizon_seconds=primary['barriers']['horizon_minutes_after_entry'] * 60,
                                exit_wait_seconds=primary['barriers']['fresh_timeout_allowance_seconds'],
                                max_participation=primary['entry']['maximum_participation_of_lagged_minute_volume'],
                                fee_bps_per_side=cost['fee_bps_per_side'],
                                impact_bps_at_full_participation=cost['impact_bps_at_full_participation'])
                result = simulate_order_invariant(setup, rows, policy, coverage_end,
                                                  primary['entry']['maximum_midpoint_spread_pct'])
                scenarios.append({'id': f'DELAY_{delay}_{cost["id"]}', 'policy': asdict(policy),
                                  'result': result})
        quote_labels = {str(threshold): quote_discovery(
            rows, anchor['available_at'], coverage_end, anchor['ask'], threshold,
            primary['barriers']['fresh_timeout_allowance_seconds'])
            for threshold in protocol['discovery_labels']['thresholds_pct']}
        bar_labels = {str(threshold): bar_discovery(bars, anchor['available_at'], anchor['ask'], threshold)
                      for threshold in protocol['discovery_labels']['thresholds_pct']}
        item.update(decision=decision, setup=setup, scenarios=scenarios,
                    quote_discovery=quote_labels, bar_discovery=bar_labels)
        cases.append(item)

    scenario_summary = []
    scenario_ids = [f'DELAY_{delay}_{cost["id"]}' for delay in primary['entry']['latency_seconds']
                    for cost in primary['cost_scenarios']]
    for scenario_id in scenario_ids:
        results = [next((scenario['result'] for scenario in case['scenarios']
                         if scenario['id'] == scenario_id),
                        {'status': 'UNKNOWN_NO_DECISION_QUOTE', 'entry_at': None, 'net_pct': None})
                   for case in cases]
        values = [result['net_pct'] for result in results if result.get('net_pct') is not None]
        counts = Counter(result['status'] for result in results)
        scenario_summary.append({
            'id': scenario_id, 'cases': len(results), 'status_counts': dict(sorted(counts.items())),
            'simulated_entries': sum(result.get('entry_at') is not None for result in results),
            'resolved_returns': len(values),
            'full_sample_expectancy_pct': mean(values) if len(values) == len(results) else None,
            'resolved_only_mean_withheld': len(values) != len(results),
            'profitability_claim_allowed': False
        })
        scenario_summary[-1]['unknown_cases'] = sum(count for status, count in counts.items()
                                                    if status.startswith('UNKNOWN'))
    discovery_summary = {}
    for source in ('quote_discovery', 'bar_discovery'):
        discovery_summary[source] = {}
        for threshold in protocol['discovery_labels']['thresholds_pct']:
            key = str(threshold)
            statuses = [case[source].get(key, {'status': 'UNKNOWN_NO_DECISION_QUOTE'})['status']
                        for case in cases]
            discovery_summary[source][key] = {'cases': len(cases),
                                               'status_counts': dict(sorted(Counter(statuses).items()))}
    return {
        'as_of': '2026-09-28', 'protocol': protocol['id'],
        'protocol_commit': ledger['protocol_commit'], 'status': protocol['status'],
        'sample_cases': len(cases), 'sessions': len(protocol['dates']),
        'new_market_requests': ledger['requests_used'], 'new_quote_records': total,
        'quote_unit_version': VERSION, 'scenario_summary': scenario_summary,
        'discovery_summary': discovery_summary, 'cases': cases, 'holdout_opens': 0,
        'verified_fills': 0, 'live_rules_changed': False,
        'profitability_claim_allowed': False,
        'limits': [protocol['selection'], protocol['decision_quote'], protocol['comparison'],
                   'All cases are exposed development observations; this is not an independent test.',
                   'Quote opportunity labels begin at the decision quote, not a verified fill, and are not returns.',
                   'Trade-bar session labels have minute-level ordering ambiguity and are separate from executable quote paths.',
                   'Historical SIP event timestamps do not prove historical receipt time, queue position, or actual fills.']
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    report = build()
    path = ROOT / 'data/quote-anchored-later-report.json'
    content = dump(report)
    if args.check:
        if not path.exists() or path.read_text() != content:
            raise SystemExit('Later quote-anchored reproduction mismatch')
    else:
        path.write_text(content)
    print(dump({key: value for key, value in report.items() if key != 'cases'}))
    for case in report['cases']:
        print(case['id'], case['decision']['at'] if case['decision'] else None,
              [(scenario['id'], scenario['result']['status']) for scenario in case['scenarios']],
              case['quote_discovery'], case['bar_discovery'])


if __name__ == '__main__':
    main()
