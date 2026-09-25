"""Freeze the exposed six-case signal-clock diagnostic BEFORE new quote requests."""
import json
from pathlib import Path
from .phase2 import sha, dump

ROOT=Path(__file__).resolve().parents[1]


def build():
    sample=json.loads((ROOT/'research/continuation-quote-sample.json').read_text())['cases']
    events=json.loads((ROOT/'data/discovery-audit.json').read_text())['events']
    cases=[]
    for index,c in enumerate(sample):
        e=next(e for e in events if e['symbol']==c['symbol'] and e['detected_at']==c['signal_at'])
        cases.append({**c,'reference_price':e['signal_price'],
                      'cached_entry_source':'data/quote-windows.json.gz' if index==0 else
                      'data/presignal-liquidity-validation-quotes.json' if index==3 else None,
                      'request':None if index in (0,3) else dict(symbol=c['symbol'],start=c['signal_at'],end=c['entry_at'],feed='sip',sort='asc',limit=10000)})
    sources=['research/continuation-quote-sample.json','research/continuation-path-inputs.json',
             'data/discovery-audit.json','data/study-manifest.json','data/quote-windows.json.gz',
             'data/presignal-liquidity-validation-quotes.json','research/quote_units.py','research/execution.py']
    return dict(id='SIGNAL_CLOCK_EXECUTION_20260925',base_commit='2a6c47b46a7a2cfa9d9da0c682ea7228f59fa9b0',
                status='EXPOSED_DEVELOPMENT_ONLY',selection='All six previously frozen missingness cases; no reselection or holdout claim.',
                question='How does original-signal entry qualification with fixed quantity, latency and costs differ from minute-later price snapshots?',
                cases=cases,quantity=100,entry_window_seconds=30,entry_cap_multiplier=1.001,
                stop_multiplier=.97,target_multiplier=1.10,horizon_seconds=3600,exit_wait_seconds=3,
                reference='signal_price (last completed close), verified against the ending minute bar; NEVER the future entry field or first future ask. Fixed +10%/-3% diagnostic, not the live detector plan.',
                latency_seconds=[1,3],cost_scenarios=[dict(id='BASE',fee_bps_per_side=1,impact_bps_at_full_participation=20),dict(id='STRESS',fee_bps_per_side=2,impact_bps_at_full_participation=40)],
                max_participation=.01,quote_age_seconds=3,max_completed_bar_age_seconds=90,
                availability='Historical event-time receipt assumption; entry decision delays of 1/3 seconds. Minute volume available at bar end. Actual transport, bar-revision and exit-order latency unknown; no fill claims.',
                coverage='Use continuous retrieved prefix only; never process a quote after a gap. Conflicting same-microsecond observations truncate the qualified prefix; no arbitrary sequence. Exact duplicates removed for transitions, never summed for size.',
                unknown_entry='When a missing/invalid volume could affect an otherwise price-and-size-qualified entry, stop before that quote and retain UNKNOWN_ENTRY_LIQUIDITY; do not turn missing evidence into NO_ENTRY.',
                request_budget=20,retrieval='Four missing signal-to-next-minute intervals including the 30-second bridge for early fills. Reuse BTCT Aug24 and FWRD entry caches. Capped pages resume inclusively at final timestamp, FIFO; no retries, no identical query twice; save errors and resume cursor.',
                performance='Per-case conditional scenario returns only. No resolved-only mean, no selected winner, no probability, no live-rule change. Retain all six cases in each scenario.',
                holdout_opens=0,deployment_allowed=False,source_sha256={p:sha(ROOT/p) for p in sources})


if __name__=='__main__':
    p=ROOT/'research/signal-clock-protocol.json'
    if p.exists():raise SystemExit('Protocol already exists; do not overwrite a frozen selection')
    p.write_text(dump(build()))
