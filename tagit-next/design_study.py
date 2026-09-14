"""Freeze outcome-independent sampling and hypotheses before fetching test bars."""
import hashlib
import json
from pathlib import Path

SEED='TAGit-NEXT-independent-20260914-v1'
root=Path(__file__).resolve().parent
reference=json.loads((root/'data/broad-reference.json').read_text())
strata=[(0,50e6),(50e6,250e6),(250e6,1e9)]
selected=[]
for low,high in strata:
    rows=[r for r in reference['rows'] if low <= r['market_cap'] < high]
    rows.sort(key=lambda r:hashlib.sha256((SEED+':'+r['symbol']).encode()).hexdigest())
    selected.extend(rows[:32])
protocol=dict(seed=SEED, universe_count=len(reference['rows']), sample_count=len(selected),
    selection='32 lowest SHA256 ranks per current-cap stratum; no returns or winner lists used',
    strata_usd=strata, metadata_asof=reference['updated_at'],
    training=['2026-08-24','2026-08-25','2026-08-26','2026-08-27','2026-08-28'],
    validation=['2026-08-31','2026-09-01'], test=['2026-09-02','2026-09-03','2026-09-04'],
    hypotheses=[{'name':'BASE','overrides':{}},
                {'name':'VOLUME_2X','overrides':{'min_volume_acceleration':2.0}},
                {'name':'TIGHT_BASE','overrides':{'max_base_width':.04,'max_risk':.04}}],
    selection_rule='Require at least 20 resolved training fills and positive mean net; choose greatest validation mean with at least 10 resolved fills and positive mean; otherwise no candidate. Test cannot change selection.',
    limits=['Current cap and active listing snapshot, not historical point-in-time universe.',
            'Reference feed excludes average volume <=50,000 shares; not a full-market census.',
            'All returns are candle-based execution approximations; no quote-based fill evidence.',
            'Stratified sample, not population-weighted market performance.',
            'These historical dates are first read for this independent study; not a prospective live test.'],
    metadata=selected)
(root/'data/study-protocol.json').write_text(json.dumps(protocol,indent=2)+'\n')
print(json.dumps({'count':len(selected),'symbols':[r['symbol'] for r in selected],
                  'sha256':hashlib.sha256(json.dumps(protocol,sort_keys=True).encode()).hexdigest()}))
