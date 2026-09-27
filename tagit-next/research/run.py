"""Offline one-command baseline audit; never opens holdout or calls a provider."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from .metrics import summarize
from .splits import claim_blockers

ROOT=Path(__file__).resolve().parents[1]
FROZEN_MARKET_SHA256='48631ae222cb83dd3c49541662b58e671502250099e57bb46f28a8be01c31c73'


def build():
    protocol=json.loads((ROOT/'research/protocol.json').read_text())
    scanner_name='quote-service/src/scanner.mjs'
    frozen_scanner=ROOT/'research/frozen/scanner-discovery-1.mjs'
    if hashlib.sha256((ROOT/'research/frozen/market.mjs').read_bytes()).hexdigest()!=FROZEN_MARKET_SHA256:
        raise ValueError('Frozen scanner dependency changed: market.mjs')
    for name,digest in protocol['frozen_sha256'].items():
        source=frozen_scanner if name==scanner_name else ROOT/name
        if hashlib.sha256(source.read_bytes()).hexdigest()!=digest:
            raise ValueError(f'Frozen evidence changed: {name}')
    manifest=json.loads((ROOT/'data/study-manifest.json').read_text())
    for entry in manifest['files']:
        if hashlib.sha256((ROOT/entry['path']).read_bytes()).hexdigest()!=entry['sha256']:
            raise ValueError(f"Source hash mismatch: {entry['path']}")
    with TemporaryDirectory() as tmp:
        out=Path(tmp)/'baseline.json'
        subprocess.run(['node','research/frozen/evaluate-discovery.mjs','--output',str(out)],
                       cwd=ROOT,check=True,capture_output=True,text=True)
        replayed=json.loads(out.read_text())
    expected=json.loads((ROOT/'data/discovery-audit.json').read_text())
    # Saved report predates two UI extension-category metadata fields. Require all
    # original fields and the full event ledger to match exactly, not just a mean.
    for k,v in expected.items():
        if k=='rules':
            if any(replayed[k].get(r)!=x for r,x in v.items()):raise ValueError('Baseline rules mismatch')
        elif replayed.get(k)!=v:raise ValueError(f'Baseline mismatch: {k}')
    rows=[dict(status='LEGACY_CLOSE_RETURN' if e['scorable'] else 'MISSING_FUTURE_MINUTES',
               session=e['date'],at=e['detected_at'],net_pct=e.get('end_return_after_assumed_cost_pct'),
               mae_pct=e.get('max_down_pct'),mfe_pct=e.get('max_up_pct')) for e in expected['events']]
    metrics=summarize(rows,**{k:protocol['bootstrap'][k] for k in ('seed','iterations')})
    return {'protocol':protocol['id'],'as_of':'2026-09-24','baseline_exact_reproduction':True,
            'raw_bars':manifest['total_bars'],'baseline_regular_session_bars':expected['bars'],
            'sessions':len(manifest['files']),'legacy_baseline':metrics,
            'interpretation':'30-minute close return minus assumed 0.5 percentage points, not triple-barrier performance',
            'new_execution_historical_results':None,'phase1_complete':False,'phase2_allowed':False,
            'profitability_claim_allowed':False,'claim_blockers':claim_blockers({}),
            'limitations':expected['limitations']+[
                'Only 10 exposed sessions; no 12-month point-in-time NASDAQ under-100M universe',
                'Full live shortlist, split handling and request timing not yet replayed',
                'Historical receipt/revision times and calibrated execution costs unavailable',
                'No holdout opened; no walk-forward performance or model comparison yet'],
            'next_step':'Build source inventory and point-in-time membership/filing availability coverage before freezing calendar folds or requesting a test sample'}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    report=build();text=json.dumps(report,indent=2,ensure_ascii=False,allow_nan=False)+'\n'
    evidence={k:report[k] for k in ('as_of','protocol','baseline_exact_reproduction','phase1_complete','profitability_claim_allowed')}
    evidence.update({k:report['legacy_baseline'][k] for k in ('signals','evaluable','unevaluable','resolved_expectancy_pct')})
    artifacts={ROOT/'data/phase1-baseline.json':text,
               ROOT/'web/phase1-evidence.json':json.dumps(evidence,indent=2,allow_nan=False)+'\n'}
    for path,content in artifacts.items():
        if args.check:
            if not path.exists() or path.read_text()!=content:raise SystemExit(f'Phase 1 artifact mismatch: {path.name}')
        else:path.write_text(content)
    print(json.dumps({k:report[k] for k in ('baseline_exact_reproduction','phase1_complete','phase2_allowed','profitability_claim_allowed')}))


if __name__=='__main__':main()
