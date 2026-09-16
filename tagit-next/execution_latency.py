"""Frozen development-only latency comparison; missing evidence stays unknown."""
import json
from collections import Counter
from datetime import timedelta
from pathlib import Path
from engine import timestamp
from quote_audit import audit
from exit_audit import evaluate, valid_quote


def exit_policy(window, setup, allowance=3, cost=.0025):
    if allowance not in (3, 30):
        raise ValueError('Only predeclared exit allowances are supported')
    result = evaluate(window, setup, cost)
    entry = window['entry']['first_eligible']
    deadline = timestamp(entry['at']) + timedelta(minutes=45)
    result['exit_allowance_seconds'] = allowance
    result['deadline'] = deadline.isoformat()
    # Preserve stops, targets, provider errors, capped prefixes and the frozen
    # fresh-last-quote fallback. Do not reprice an already resolved baseline.
    if allowance == 30 and result['outcome'] == 'UNKNOWN_TIMEOUT_QUOTE':
        for q in sorted(window.get('quotes', []), key=lambda q: timestamp(q['timestamp'])):
            t = timestamp(q['timestamp'])
            delay = (t-deadline).total_seconds()
            if delay < 0:
                continue
            if delay > allowance:
                break
            if valid_quote(q):
                result.update(outcome='TIMEOUT_DELAYED_QUOTE', exit_at=t.isoformat(),
                              exit_bid=q['bid_price'], net_pct=round(
                                  (q['bid_price']*(1-cost)/(entry['ask']*(1+cost))-1)*100, 4))
                break
    result['exit_delay_seconds'] = (
        (timestamp(result['exit_at'])-deadline).total_seconds()
        if 'exit_at' in result else None)
    result['late_exit'] = bool(result['exit_delay_seconds'] is not None and
                               result['exit_delay_seconds'] > 0)
    return result


def run(protocol, data):
    expected = [s['id'] for s in protocol['cases']]
    windows = {w['id']: w for w in data['windows']}
    if len(windows) != len(data['windows']) or set(windows) != set(expected):
        raise ValueError('Input IDs must exactly match the frozen sample')
    scenarios = []
    for latency in protocol['entry_latency_seconds']:
        for allowance in protocol['exit_new_quote_allowance_seconds']:
            results = []
            for setup in protocol['cases']:
                w = windows[setup['id']]
                common = dict(id=setup['id'], symbol=setup['symbol'],
                              entry_latency_seconds=latency,
                              exit_allowance_seconds=allowance,
                              approved_for_live=False)
                if w.get('error'):
                    results.append(dict(common, outcome='PROVIDER_ERROR', net_pct=None))
                    continue
                quotes = w.get('quotes', [])
                entry_quotes = [q for q in quotes if timestamp(q['timestamp']) <= timestamp(setup['expires_at'])]
                entry_capped = bool(w.get('truncated')) and (
                    not quotes or max(timestamp(q['timestamp']) for q in quotes) < timestamp(setup['expires_at']))
                entry_window = dict(setup=setup, quotes=entry_quotes, feed='sip',
                                    limit=len(entry_quotes) if entry_capped else len(entry_quotes)+1)
                entry = audit(entry_window, latency_seconds=latency)
                if not entry['first_eligible']:
                    results.append(dict(common, outcome=entry['status'], net_pct=None,
                                        entry_observation=entry))
                    continue
                result = exit_policy(dict(w, entry=entry), setup, allowance,
                                     protocol['cost_per_side'])
                results.append(dict(result, **common))
            counts = Counter(r['outcome'] for r in results)
            scenarios.append(dict(entry_latency_seconds=latency,
                                  exit_allowance_seconds=allowance, cases=len(results),
                                  resolved=sum(r.get('net_pct') is not None for r in results),
                                  outcomes=dict(counts), results=results))
    return dict(scope=protocol['scope'], approved_for_live=False,
                frozen_cases=len(expected), market_requests=data['market_requests'],
                quotes=sum(len(w.get('quotes', [])) for w in data['windows']),
                evidence_status='INCOMPLETE_PROVIDER_ERRORS' if any(w.get('error') for w in data['windows']) else 'DEVELOPMENT_ONLY',
                news_coverage='UNKNOWN_NOT_CONNECTED', scenarios=scenarios,
                limitations=['Quote events are not fills or arrival timestamps.',
                             'Longer timeout allowance changes execution risk, not detector accuracy.',
                             'Development sample only; no validation/test period used.',
                             'No missing outcome is a zero, loss, win or absent opportunity.'])


if __name__ == '__main__':
    root = Path(__file__).resolve().parent/'data'
    report = run(json.loads((root/'execution-latency-protocol.json').read_text()),
                 json.loads((root/'execution-latency-input.json').read_text()))
    (root/'execution-latency-report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k != 'scenarios'}, indent=2))
