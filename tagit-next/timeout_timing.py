"""Timing-only follow-up; frozen execution policy and P&L are not changed."""
import json
from pathlib import Path
from engine import timestamp
from exit_audit import valid_quote


def run(data):
    protocol=data['protocol']; limit=protocol['limit']; rows=[]
    if sorted(w['id'] for w in data['windows'])!=sorted(s['id'] for s in protocol['selected']):
        raise ValueError('Every preselected case must be retained, including provider failures')
    for w in data['windows']:
        deadline=timestamp(w['deadline']); first=None
        for q in sorted(w['quotes'],key=lambda q:timestamp(q['timestamp'])):
            delay=(timestamp(q['timestamp'])-deadline).total_seconds()
            if not protocol['query_offset_start_seconds']<=delay<=protocol['query_offset_end_seconds']: continue
            if valid_quote(q):
                first=dict(at=q['timestamp'],delay_seconds=round(delay,6))
                break
        rows.append(dict(id=w['id'],symbol=w['symbol'],quotes=len(w['quotes']),
                         first_valid=first,error=w['error'],truncated=len(w['quotes'])>=limit,
                         frozen_policy_outcome=w['original_outcome'],approved_for_live=False))
    return dict(purpose=protocol['purpose'],source_commit=protocol['source_commit'],
                market_data_requests=len(rows),total_quotes=sum(r['quotes'] for r in rows),
                cases=len(rows),observed_later_quote=sum(r['first_valid'] is not None for r in rows),
                original_unresolved_cases=len(rows),policy_outcomes_reclassified=0,
                strategy_or_threshold_change=False,results=rows,approved_for_live=False)


if __name__=='__main__':
    root=Path(__file__).resolve().parent
    report=run(json.loads((root/'data/timeout-timing-input.json').read_text()))
    (root/'data/timeout-timing-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
