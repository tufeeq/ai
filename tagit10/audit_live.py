"""Audit recorded alerts. Does not reconstruct unavailable indicators or broker fills."""
import argparse, json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

RESOLVED = {'TARGET_FIRST','STOP_FIRST','TIMEOUT'}

def summarize(rows):
    resolved = [x for x in rows if x.get('label') in RESOLVED]
    nets = [x['netReturnPct'] for x in resolved if isinstance(x.get('netReturnPct'), (int,float))]
    return {'alerts':len(rows), 'labels':dict(Counter(x.get('label','UNKNOWN') for x in rows)),
        'resolved':len(resolved), 'sessions':len({x.get('sessionDateET') for x in resolved}),
        'targetFirstPct':round(100*sum(x['label']=='TARGET_FIRST' for x in resolved)/len(resolved),2) if resolved else None,
        'positiveNetPct':round(100*sum(v>0 for v in nets)/len(nets),2) if nets else None,
        'meanNetReturnPct':round(mean(nets),4) if nets else None,
        'worstNetReturnPct':min(nets) if nets else None,
        'completeIndicatorSnapshots':sum(x.get('indicatorEvidence') is not None for x in rows)}

def build(state, generated_at=None):
    all_rows = list(state.get('signalLedger',{}).values())
    versions = {}
    for version in sorted({x.get('version','UNKNOWN') for x in all_rows}):
        rows = sorted((x for x in all_rows if x.get('version','UNKNOWN')==version), key=lambda x:x['signalAtUTC'])
        unique = {}
        for x in rows:
            unique.setdefault((x.get('sessionDateET'),x.get('session'),x['symbol']),x)
        independent = list(unique.values())
        versions[version] = {'allStages':summarize(rows),'firstAlertPerStockSession':summarize(independent),
            'byStage':{s:summarize([x for x in rows if x['stage']==s]) for s in ('EARLY','ACTIONABLE','CONFIRMED')},
            'activityScoreBands':{label:summarize([x for x in independent if low<=x.get('score',-1)<high])
                for label,low,high in [('below40',0,40),('40to55',40,55),('55plus',55,101)]}}
    return {'generatedAtUTC':generated_at or datetime.now(timezone.utc).isoformat(),
        'kind':'RECORDED_SYSTEM_ALERT_AUDIT', 'versions':versions,
        'claim':'Descriptive recorded research outcomes; not a new historical replay and not personal brokerage results.',
        'limitations':['Versions and stages are separated; first alert per stock-session reduces duplicate counting but observations can remain correlated.',
            'Missing future bars are unscorable, never wins. Pending alerts have not completed their window.',
            'Original alerts without indicatorEvidence cannot establish which individual indicator caused failure.',
            'Activity-score bands are descriptive and must not be optimized on this same sample.'],
        'alerts':[x for x in all_rows if x.get('version')=='10.3']}

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('state',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    report=build(json.loads(a.state.read_text()))
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'versions':report['versions']}))
