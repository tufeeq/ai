"""Reproduce the frozen SIP availability probe; never changes a signal label."""
import argparse
from datetime import timedelta
import gzip
import json
from math import isfinite
from pathlib import Path

from .events import time
from .phase2 import dump, sha

ROOT = Path(__file__).resolve().parents[1]


def observe(rows, symbol, start, end, capped=False, error=None):
    start, end = time(start), time(end)
    if start >= end: raise ValueError('Invalid quote interval')
    in_window = []; valid = []
    for q in rows:
        if q.get('symbol') != symbol: raise ValueError('Wrong quote symbol')
        at = time(q['timestamp'])
        if not start <= at < end: continue
        in_window.append(q)
        values = [q.get(k) for k in ('bid_price', 'ask_price', 'bid_size', 'ask_size')]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not isfinite(v) or v <= 0 for v in values):
            continue
        if q['bid_price'] <= q['ask_price']: valid.append(q)
    valid.sort(key=lambda q: time(q['timestamp']))
    spreads = [(q['ask_price'] / q['bid_price'] - 1) * 100 for q in valid]
    return {'status': 'UNKNOWN_PROVIDER_ERROR' if error else 'VALID_QUOTES_OBSERVED' if valid else 'UNKNOWN_NO_VALID_QUOTES',
            'quotes_in_window': len(in_window), 'valid_quotes': len(valid),
            'invalid_quotes': len(in_window) - len(valid), 'source_capped_or_partial': bool(capped),
            'first_valid_at': valid[0]['timestamp'] if valid else None,
            'last_valid_at': valid[-1]['timestamp'] if valid else None,
            'spread_pct_of_bid_range': [min(spreads), max(spreads)] if spreads else None,
            'error': error, 'continuous_coverage_verified': False, 'executable_fill_verified': False,
            'bar_label_changed': False}


def build():
    protocol = json.loads((ROOT / 'research/continuation-quote-probe-protocol.json').read_text())
    inputs = json.loads((ROOT / 'research/continuation-probe-inputs.json').read_text())
    for name, digest in inputs['sha256'].items():
        if sha(ROOT / name) != digest: raise ValueError(f'Frozen probe source changed: {name}')
    if sha(ROOT / 'research/continuation-quote-sample.json') != protocol['sample_sha256']:
        raise ValueError('Quote sample changed')
    if sha(ROOT / protocol['cached_source']) != protocol['cached_source_sha256']:
        raise ValueError('Cached source changed')
    sample = json.loads((ROOT / 'research/continuation-quote-sample.json').read_text())['cases']
    cache = json.loads(gzip.decompress((ROOT / protocol['cached_source']).read_bytes()))['windows']
    results = []; new_quotes = 0
    for c in sample:
        start = time(c['first_missing_at']); end = start + timedelta(minutes=1)
        if c['id'] == protocol['cached_case']:
            windows = [w for w in cache if w['entry']['symbol'] == c['symbol'] and
                       time(w['entry']['at']).date() == start.date()]
            if len(windows) != 1: raise ValueError('Ambiguous cached window')
            window = windows[0]; rows = window['quotes']; source = protocol['cached_source']
            capped = window.get('truncated', False) or len(rows) >= window['limit']; error = None
        else:
            source = f"data/continuation-probe/{c['symbol']}.json"
            record = json.loads((ROOT / source).read_text()); request = record['request']
            if (request['symbol'] != c['symbol'] or request['feed'] != 'sip'
                    or time(request['start']) != start or time(request['end']) != end):
                raise ValueError('Provider request differs from frozen sample')
            provider = record['provider_result']; data = provider.get('structuredContent') or {}
            error = 'PROVIDER_ERROR' if provider.get('isError') or 'quotes' not in data else None
            rows = data.get('quotes', {}).get(c['symbol'], [])
            new_quotes += len(rows)
            capped = len(rows) >= request['limit'] or bool(data.get('next_page_token'))
        results.append({'id': c['id'], 'symbol': c['symbol'], 'bar_missingness': c['reason'],
                        'start': start.isoformat(), 'end': end.isoformat(), 'source': source,
                        'observation': observe(rows, c['symbol'], start, end, capped, error)})
    return {'as_of': '2026-09-24', 'protocol': protocol['id'], 'protocol_commit': inputs['protocol_commit'],
            'new_requests': len(protocol['new_requests']), 'new_quotes': new_quotes,
            'cached_cases': 1, 'cases_with_valid_quotes': sum(r['observation']['valid_quotes'] > 0 for r in results),
            'labels_resolved_by_probe': 0, 'profitability_claim_allowed': False,
            'interpretation': 'Missing minute bars cannot be interpreted as absence of quotes or inability to trade. Quotes observed do not establish fills or continuous execution coverage. Zero results remain unknown.',
            'next_step': 'For the same frozen development cases, acquire full entry-to-exit SIP paths with pagination, dated lot metadata and causal lagged volume; keep a <=20-request budget and cursor checkpoint. Do not relabel these cases independent validation.',
            'cases': results}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); args = parser.parse_args()
    report = build(); p = ROOT / 'data/continuation-quote-probe.json'; content = dump(report)
    if args.check:
        if not p.exists() or p.read_text() != content: raise SystemExit('Quote-probe reproduction mismatch')
    else: p.write_text(content)
    print(content)


if __name__ == '__main__': main()
