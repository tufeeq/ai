"""Frozen SIP path audit. Observed price indications are never simulated fills."""
import argparse
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
import gzip
import json
from pathlib import Path

from .events import time
from .execution import valid_quote
from .phase2 import dump, sha

ROOT = Path(__file__).resolve().parents[1]
EPS = timedelta(microseconds=1)


def covered(intervals, start, end):
    """Half-open retrieval coverage. Capped final timestamps stay unqualified."""
    cursor = time(start); end = time(end)
    for a, b in sorted((time(a), time(b)) for a, b in intervals):
        if b < a: raise ValueError('Reversed coverage interval')
        if a > cursor: break
        cursor = max(cursor, b)
        if cursor >= end: return True
    return cursor >= end


def price_path(quotes, start, deadline, intervals):
    start, deadline = time(start), time(deadline)
    if start >= deadline: raise ValueError('Positive horizon required')
    groups = defaultdict(list); invalid = 0; duplicate = 0; seen = set()
    for q in quotes:
        at = time(q['timestamp'])
        if not start <= at <= deadline + timedelta(seconds=3): continue
        # Exact duplicated boundary observations do not create extra market states.
        # Original responses remain intact; this is NOT a quote-activity statistic.
        key = json.dumps(q, sort_keys=True)
        if key in seen: duplicate += 1; continue
        seen.add(key)
        norm = {k: q.get(v) for k, v in [('bid','bid_price'),('ask','ask_price'),
                 ('bid_size','bid_size'),('ask_size','ask_size')]}
        if valid_quote(norm): groups[at].append(norm)
        else: invalid += 1
    base = {'status': 'UNKNOWN_ENTRY', 'entry_ask_anchor': None, 'entry_at': None,
            'indicative_bid_return_pct': None, 'execution_status': 'UNVERIFIED_SIZE_VOLUME_LATENCY_COSTS',
            'executable_net_return_pct': None, 'executable_fill_verified': False,
            'approved_for_live': False, 'invalid_quotes': invalid,
            'exact_duplicate_observations': duplicate,
            'full_api_interval_covered': covered(intervals, start, deadline + timedelta(seconds=3)),
            'continuous_quote_freshness_verified': False}
    def finish(status, **extra): return {**base, 'status': status, **extra}
    entry = None; target = None; stop = None
    times = sorted(groups)
    base['max_observed_update_gap_seconds'] = max(((b-a).total_seconds() for a,b in zip(times,times[1:])), default=None)
    for at in times:
        group = groups[at]
        if entry is None:
            if at > start + timedelta(seconds=30): break
            if not covered(intervals, start, at + EPS): return finish('UNKNOWN_RETRIEVAL_GAP')
            asks = {q['ask'] for q in group}
            if len(asks) != 1: return finish('UNKNOWN_SAME_TIME_ENTRY_ORDER', observed_at=at.isoformat())
            entry = asks.pop()
            target = float(Decimal(str(entry)) * Decimal('1.10'))
            stop = float(Decimal(str(entry)) * Decimal('0.97'))
            base.update(entry_ask_anchor=entry, entry_at=at.isoformat(), target_bid=target, stop_bid=stop)
        if not covered(intervals, start, at + EPS): return finish('UNKNOWN_RETRIEVAL_GAP')
        bids = {q['bid'] for q in group}
        if at >= deadline:
            # Never convert a target/stop after the deadline into a barrier hit.
            if len(bids) != 1: return finish('UNKNOWN_SAME_TIME_TIMEOUT_ORDER', observed_at=at.isoformat())
            bid = bids.pop()
            return finish('OBSERVED_TIMEOUT_PRICE', observed_at=at.isoformat(), observed_bid=bid,
                          indicative_bid_return_pct=(bid / entry - 1)*100)
        lower = min(bids) <= stop; upper = max(bids) >= target
        if lower and upper: return finish('UNKNOWN_SAME_TIME_BARRIER_ORDER', observed_at=at.isoformat())
        if lower or upper:
            hits = [v for v in bids if v <= stop] if lower else [v for v in bids if v >= target]
            # Different same-time prices cannot identify a unique first bid/fill.
            return finish('OBSERVED_STOP_FIRST' if lower else 'OBSERVED_TARGET_FIRST',
                          observed_at=at.isoformat(), observed_bid=hits[0] if len(hits)==1 else None,
                          indicative_bid_return_pct=(hits[0]/entry-1)*100 if len(hits)==1 else None,
                          indicative_bid_return_range_pct=[(min(hits)/entry-1)*100,(max(hits)/entry-1)*100])
    if entry is None:
        return finish('NO_ENTRY_QUOTE_OBSERVED' if covered(intervals,start,start+timedelta(seconds=30)+EPS)
                      else 'UNKNOWN_RETRIEVAL_GAP')
    return finish('UNKNOWN_TIMEOUT_PRICE' if base['full_api_interval_covered'] else 'UNKNOWN_RETRIEVAL_GAP')


def load_paths():
    """Load hash-qualified raw paths once; never infer missing intervals."""
    inputs = json.loads((ROOT / 'research/continuation-path-inputs.json').read_text())
    for p,d in inputs['sha256'].items():
        if sha(ROOT/p) != d: raise ValueError(f'Frozen path input changed: {p}')
    protocol = json.loads((ROOT/'research/continuation-path-protocol.json').read_text())
    if protocol['holdout_opens'] or protocol['deployment_allowed']: raise ValueError('Research only')
    if sha(ROOT/'research/continuation-quote-sample.json') != protocol['sample_sha256']:
        raise ValueError('Frozen selection changed')
    retrieval = json.loads((ROOT/'data/continuation-paths/retrieval.json').read_text())
    if retrieval['requests_used'] > protocol['request_budget']: raise ValueError('Request budget exceeded')
    pages = [json.loads(gzip.decompress((ROOT/(r['filename']+'.gz')).read_bytes())) for r in retrieval['requests']]
    cache = json.loads(gzip.decompress((ROOT/'data/exit-windows.json.gz').read_bytes()))['windows']
    cases = []
    for index,c in enumerate(protocol['cases']):
        start = time(c['entry_at']); end = time(c['end']); intervals = []; rows = []; sources = []
        if index == 0:
            w = next(w for w in cache if w['entry']['symbol']==c['symbol'] and time(w['entry']['at']).date()==start.date())
            rows += w['quotes']; intervals.append((start,time(w['quotes'][-1]['timestamp'])))
            sources.append('data/exit-windows.json.gz')
        else:
            p = f"data/continuation-probe/{c['symbol']}.json"
            d = json.loads((ROOT/p).read_text()); data = d['provider_result']['structuredContent']
            old = data['quotes'][c['symbol']]; rows += old; query = d['request']
            intervals.append((time(query['start']), time(old[-1]['timestamp']) if len(old)>=query['limit'] else time(query['end'])))
            sources.append(p)
        errors = []
        for page,log in zip(pages,retrieval['requests']):
            if page['job']['case_index'] != index: continue
            q = page['query']; data = page['response']; sources.append(log['filename']+'.gz')
            if q['symbol'] != c['symbol'] or q['feed'] != 'sip': raise ValueError('Wrong source feed/symbol')
            if page['isError'] or 'quotes' not in data:
                errors.append({'start':q['start'],'end':q['end'],'source':log['filename']+'.gz'}); continue
            chunk = data['quotes'][c['symbol']]
            if any(r['symbol'] != c['symbol'] for r in chunk): raise ValueError('Wrong quote symbol')
            rows += chunk
            bound = time(chunk[-1]['timestamp']) if len(chunk)>=q['limit'] else time(q['end'])
            intervals.append((time(q['start']),bound))
        cases.append({'id':c['id'],'symbol':c['symbol'],'sources':sources,'provider_errors':errors,
                      'start':start, 'end':end, 'intervals':intervals, 'quotes':rows})
    return inputs, protocol, retrieval, cases


def build():
    inputs, protocol, retrieval, paths = load_paths()
    cases = []
    for path in paths:
        start, end, rows = path['start'], path['end'], path['quotes']
        result = price_path(rows,start,end-timedelta(seconds=3),path['intervals'])
        cases.append({k:path[k] for k in ('id','symbol','sources','provider_errors')})
        cases[-1].update(raw_records_in_requested_window=sum(start<=time(q['timestamp'])<=end for q in rows),
                         indication=result)
    return {'as_of':'2026-09-24','protocol_commit':inputs['protocol_commit'],
            'status':'DEVELOPMENT_PRICE_INDICATIONS_ONLY','requests_used':retrieval['requests_used'],
            'new_quote_records_including_boundary_overlap':sum(r['count'] for r in retrieval['requests']),
            'provider_error_requests':sum(bool(r['error']) for r in retrieval['requests']),
            'full_api_paths':sum(c['indication']['full_api_interval_covered'] for c in cases),
            'observed_price_outcomes':sum(c['indication']['status'].startswith('OBSERVED_') for c in cases),
            'verified_execution_outcomes':0,'net_expectancy_pct':None,'holdout_opens':0,
            'profitability_claim_allowed':False,'live_rules_changed':False,
            'execution_gates':protocol['execution_gates'],'resume':retrieval['resume'],
            'limits':['Observed bid path, not actual fills, receipt timing, calibrated costs or verified quantity.',
                      'API interval completeness is not quote freshness or continuous executable liquidity.',
                      'Same-time order is unknown; boundary duplicates are not used as activity features.',
                      'Six development cases selected for missingness, not independent performance evidence.'],
            'cases':cases}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    report=build();p=ROOT/'data/continuation-path-report.json';content=dump(report)
    if args.check:
        if not p.exists() or p.read_text()!=content:raise SystemExit('Path audit reproduction mismatch')
    else:p.write_text(content)
    print(dump({k:v for k,v in report.items() if k!='cases'}))
    for c in report['cases']:print(c['id'],c['indication']['status'],c['indication']['indicative_bid_return_pct'])


if __name__=='__main__':main()
