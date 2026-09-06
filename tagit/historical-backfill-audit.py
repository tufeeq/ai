#!/usr/bin/env python3
import json, pathlib, subprocess
from collections import Counter
from datetime import datetime, timezone

PATH='tag/data/discovery-fast.json'
revs=subprocess.check_output(['git','log','--format=%H','--reverse','--',PATH],text=True).splitlines()
unique=set(); ticker_days=set(); rows=0; early_rows=0; byday=Counter(); seen=set(); parse_fail=0
for sha in revs:
    try:
        raw=subprocess.check_output(['git','show',f'{sha}:{PATH}'],text=True,stderr=subprocess.DEVNULL)
        d=json.loads(raw); iso=d.get('snapshotTimestampUTC') or d.get('updatedAt')
        if not iso or iso in seen: continue
        seen.add(iso); day=iso[:10]
        for r in d.get('rows') or d.get('data') or []:
            t=str(r.get('Ticker') or r.get('Symbol') or '').strip().upper()
            if not t: continue
            rows+=1
            def n(v):
                try:return float(str(v).replace('$','').replace('%','').replace(',','').strip())
                except:return None
            p=n(r.get('Price')); ch=n(r.get('Change'))
            if p is None or ch is None or not (.15<=p<=20 and -20<=ch<10):continue
            early_rows+=1;unique.add(t);ticker_days.add(t+'|'+day);byday[day]+=1
    except Exception:parse_fail+=1
out={'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'gitRevisions':len(revs),'snapshots':len(seen),'rawRows':rows,'eligibleEarlyRows':early_rows,'uniqueTickers':len(unique),'tickerDays':len(ticker_days),'parseFailures':parse_fail,'dates':dict(sorted(byday.items())),'sampleTickers':sorted(unique)[:50]}
pathlib.Path('tag/data/tagit-backfill-scope.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
