#!/usr/bin/env python3
import json, pathlib, runpy
from collections import Counter
from datetime import datetime, timezone

g=runpy.run_path('tagit/historical-feature-builder.py')['build']()
early=g['early']
unique=sorted(set(x['ticker'] for x in early))
td=sorted(set(x['key'] for x in early))
pos_td=sorted(set(x['key'] for x in early if x['target']))
byday=Counter(x['day'] for x in early)
out={'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'eligibleEarlyRows':len(early),'uniqueTickers':len(unique),'tickerDays':len(td),'positiveTickerDays':len(pos_td),'dates':dict(sorted(byday.items())),'sampleTickers':unique[:50]}
pathlib.Path('tag/data/tagit-backfill-scope.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
