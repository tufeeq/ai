#!/usr/bin/env python3
"""Independent point-in-time outcome follower for TAGit v4 first surface events.

Tracks every v4 first surface event for up to 60 minutes even after the symbol
leaves Finviz mover lists. Yahoo 1m bars are fetched transiently and never stored.
Only derived MFE/MAE/maturity fields are written back to the shadow ledger.
This is research measurement only; last price is not bid/ask or execution evidence.
"""
import concurrent.futures, datetime, json, math, pathlib, urllib.parse, urllib.request

LEDGER=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')
MAX_EVENT_AGE_MIN=180
TARGET_MIN=60
GRACE_MIN=15

def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def dt(v):
    try:return datetime.datetime.fromisoformat(str(v).replace('Z','+00:00'))
    except:return None

def finite(v):
    try:return v is not None and v!='' and math.isfinite(float(v))
    except:return False

def fetch_chart(symbol):
    try:
        url='https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(symbol)+'?interval=1m&range=1d&includePrePost=true&events=div%2Csplits'
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 TAGitV4EventFollower/1.0','Accept':'application/json'})
        with urllib.request.urlopen(req,timeout=5) as z:data=json.loads(z.read().decode('utf-8'))
        result=((data.get('chart') or {}).get('result') or [None])[0]
        if not result:return symbol,[], 'empty_result'
        ts=result.get('timestamp') or []; q=((result.get('indicators') or {}).get('quote') or [{}])[0]
        close=q.get('close') or []; high=q.get('high') or []; low=q.get('low') or []
        pts=[]
        for i,t in enumerate(ts):
            if i>=len(close) or close[i] is None:continue
            c=float(close[i]); h=float(high[i]) if i<len(high) and high[i] is not None else c; l=float(low[i]) if i<len(low) and low[i] is not None else c
            pts.append((datetime.datetime.fromtimestamp(t,datetime.timezone.utc),c,h,l))
        return symbol,pts,None
    except Exception as e:return symbol,[],type(e).__name__

ledger=read(LEDGER,{})
records=ledger.get('records') or []
now=datetime.datetime.now(datetime.timezone.utc)
# One canonical record per event: the actual first surfaced observation.
events={}
for rec in records:
    if not rec.get('v4FirstSurfaceEvent'):continue
    eid=rec.get('v4EventId'); opened=dt(rec.get('v4FirstSurfaceAt') or rec.get('timestamp')); ref=rec.get('referencePrice'); sym=str(rec.get('symbol') or '').upper()
    if not eid or not opened or not sym or not finite(ref) or float(ref)<=0:continue
    age=(now-opened).total_seconds()/60
    if age<0 or age>MAX_EVENT_AGE_MIN:continue
    # Skip already mature 60m events; censored events may be revisited within max age.
    if rec.get('v4OutcomeMature60') is True:continue
    events[eid]={'eventId':eid,'symbol':sym,'opened':opened,'ref':float(ref)}

symbols=sorted({e['symbol'] for e in events.values()})
charts={};errors={}
if symbols:
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(16,len(symbols))) as ex:
        fs=[ex.submit(fetch_chart,s) for s in symbols]
        for f in concurrent.futures.as_completed(fs):
            s,pts,err=f.result();charts[s]=pts
            if err:errors[s]=err

updated=0;matured=0;censored=0
for rec in records:
    eid=rec.get('v4EventId')
    if eid not in events:continue
    e=events[eid]; pts=charts.get(e['symbol']) or []; opened=e['opened']; end=opened+datetime.timedelta(minutes=TARGET_MIN)
    # Feature/evaluation window starts at the event and never uses pre-event bars.
    win=[p for p in pts if opened<=p[0]<=end]
    if not win:continue
    ref=e['ref']; mfe=max((p[2]/ref-1)*100 for p in win);mae=min((p[3]/ref-1)*100 for p in win);last=win[-1]
    rec['v4OutcomeSource']='Yahoo 1m transient follow-up'
    rec['v4OutcomeLastObservedAt']=last[0].isoformat();rec['v4OutcomeLastPrice']=round(last[1],6)
    rec['v4OutcomeMfe60Pct']=round(mfe,3);rec['v4OutcomeMae60Pct']=round(mae,3)
    rec['v4OutcomeBarsObserved']=len(win);rec['v4OutcomeExecutionVerified']=False
    elapsed_wall=(now-opened).total_seconds()/60
    reached=any(p[0]>=end-datetime.timedelta(seconds=90) for p in pts)
    if elapsed_wall>=TARGET_MIN and reached:
        rec['v4OutcomeMature60']=True;rec['v4OutcomeCensored60']=False;rec['v4Hit10_60m']=bool(mfe>=10);rec['v4OutcomeLabel']=1 if mfe>=10 else 0;rec['v4OutcomeMaturedAtUTC']=now.isoformat();matured+=1
    elif elapsed_wall>=TARGET_MIN+GRACE_MIN and not reached:
        # Never convert missing follow-up coverage into a negative label.
        rec['v4OutcomeMature60']=False;rec['v4OutcomeCensored60']=True;rec['v4OutcomeCensorReason']='NO_PRICE_AT_60M_WINDOW_END';censored+=1
    updated+=1

ledger['v4OutcomeFollower']={'updatedAtUTC':now.isoformat(),'method':'INDEPENDENT_TRANSIENT_YAHOO_1M_EVENT_FOLLOWUP','targetWindowMin':TARGET_MIN,'openEvents':len(events),'symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(charts.get(s)) for s in symbols),'errors':errors,'recordsUpdated':updated,'newMature60':matured,'censored60ThisRun':censored,'executionVerified':False,'rawBarsPersisted':False}
LEDGER.write_text(json.dumps(ledger,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','openEvents':len(events),'symbolsRequested':len(symbols),'updated':updated,'matured':matured,'censored':censored,'errors':len(errors)}))
