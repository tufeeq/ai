"""Read-only checks against the actual public page and emitted feed."""
import json,time,urllib.request
from datetime import datetime,timezone
def get(url):
 with urllib.request.urlopen(url,timeout=20) as r:
  assert r.status==200
  return r.read()
html=get('https://tufeeq.github.io/ai/tagit10/?quality=10.3').decode()
assert 'QUALITY 10.3' in html
assert 'evidenceNotice' in html
js=get('https://tufeeq.github.io/ai/tagit10/app.js?v=10300').decode()
assert "screeningPassed!==true" in js
latest=None
for attempt in range(8):
 candidates=[]
 for branch in ('main','tagit10-live'):
  try:
   d=json.loads(get(f'https://raw.githubusercontent.com/tufeeq/ai/{branch}/tagit10-live.json?t={time.time()}'))
   if d.get('engineVersion')=='10.3':candidates.append(d)
  except Exception:pass
 if candidates:
  latest=max(candidates,key=lambda d:d['updatedAtUTC'])
  if latest.get('providerHealth',{}).get('finviz',{}).get('rvolRows',0)>0:break
 time.sleep(10)
assert latest,'No 10.3 feed found'
age=(datetime.now(timezone.utc)-datetime.fromisoformat(latest['updatedAtUTC'])).total_seconds()
assert -30<=age<=300,f'Feed is stale: {age}'
assert latest.get('providerHealth',{}).get('finviz',{}).get('rvolRows',0)>0,'Missing actual RVOL fields'
for key in ('early','actionable','confirmed'):
 for row in latest.get(key,[]):
  assert row.get('screeningPassed') is True and row.get('barClosed') is True and row.get('tradeEligible') is False
  assert not row.get('riskBlocks')
print(json.dumps({'publicPage':'HTTP_200_QUALITY_10.3','engineVersion':latest['engineVersion'],
 'updatedAtUTC':latest['updatedAtUTC'],'feedAgeSeconds':round(age,1),'quotesFresh':latest['quotesFresh'],
 'finviz':latest['providerHealth']['finviz'],'early':len(latest['early']),'confirmed':len(latest['confirmed'])}))
