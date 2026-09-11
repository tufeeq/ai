#!/usr/bin/env python3
import csv, io, json, math, os, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ET=ZoneInfo('America/New_York'); ROOT=Path(__file__).resolve().parents[1]
STATE_PATH=ROOT/'tagit10-state.json'; OUT_PATH=ROOT/'tagit10-live.json'; TOKEN=os.getenv('FINVIZ_TOKEN','').strip(); UA='Mozilla/5.0 TAGit10/10.1'
def now(): return datetime.now(timezone.utc)
def n(v,d=None):
    try:
        if v is None:return d
        x=float(str(v).replace('%','').replace(',','').replace('$','').strip()); return x if math.isfinite(x) else d
    except:return d
def get(url,timeout=12):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=timeout) as r:return r.read()
def session(et):
    from datetime import time as T
    t=et.time()
    if et.weekday()>=5:return 'closed'
    if T(4)<=t<T(9,30):return 'pre-market'
    if T(9,30)<=t<T(16):return 'regular'
    if T(16)<=t<T(20):return 'after-hours'
    return 'closed'
def load_state():
    try:return json.loads(STATE_PATH.read_text())
    except:return {'schemaVersion':10,'sessionDateET':None,'symbols':{},'events':[],'sweepCursor':0}
def save_state(s):
    s['events']=s.get('events',[])[-5000:]
    if len(s.get('symbols',{}))>2500:s['symbols']=dict(sorted(s['symbols'].items(),key=lambda kv:(kv[1].get('maxScore',0),kv[1].get('lastSeenUTC','')),reverse=True)[:2500])
    STATE_PATH.write_text(json.dumps(s,separators=(',',':')))
def finviz_rows():
    if not TOKEN:return []
    merged={}
    for sig in ('ta_topgainers','ta_unusualvolume','ta_mostactive'):
        try:
            raw=get(f'https://elite.finviz.com/export/screener?s={sig}&v=152&auth={TOKEN}',20).decode('utf-8-sig','ignore')
            for r in csv.DictReader(io.StringIO(raw)):
                s=(r.get('Ticker') or '').strip().upper()
                if s:z=merged.setdefault(s,{});z.update(r);z.setdefault('_lanes',[]).append(sig)
        except:pass
        time.sleep(.5)
    return list(merged.values())
def symbol_directory():
    out=[]
    for u in ('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt','https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'):
        try:
            for r in csv.DictReader(io.StringIO(get(u,15).decode('utf-8','ignore')),delimiter='|'):
                s=(r.get('Symbol') or r.get('ACT Symbol') or '').strip().upper(); etf=(r.get('ETF') or '').strip().upper(); test=(r.get('Test Issue') or '').strip().upper()
                if s and s.isascii() and '$' not in s and '.' not in s and len(s)<=5 and etf!='Y' and test!='Y':out.append(s)
        except:pass
    return sorted(set(out))
def chart(sym):
    try:
        r=json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=1d&includePrePost=true&events=div%2Csplits',10))['chart']['result'][0];ts=r.get('timestamp') or [];q=r['indicators']['quote'][0]
        pts=[(t,n(c),n(v)) for t,c,v in zip(ts,q.get('close') or [],q.get('volume') or [None]*len(ts)) if n(c) is not None and n(c)>0]
        if len(pts)<3:return None
        m=r.get('meta') or {};return pts,m,n(m.get('chartPreviousClose') or m.get('previousClose'))
    except:return None
def pick(fr,*keys):
    for k in keys:
        if k in (fr or {}):
            v=n(fr.get(k))
            if v is not None:return v
    return None
def round_or_none(v, digits=3):
    return round(v,digits) if v is not None else None

def window_metrics(pts):
    """Minute windows use timestamps, never positions in sparse quote arrays."""
    end=pts[-1][0]; price=pts[-1][1]
    def ret(minutes):
        cutoff=end-minutes*60
        eligible=[v for v in pts if cutoff-90 <= v[0] <= cutoff]
        return (price/eligible[-1][1]-1)*100 if eligible else None
    recent=[v for v in pts if end-900 < v[0] <= end]
    prior=[v for v in pts if end-1800 < v[0] <= end-900]
    def volume(rows):
        return sum(v[2] for v in rows) if rows and all(v[2] is not None for v in rows) else None
    v5=volume([v for v in pts if end-300 < v[0] <= end])
    v15=volume(recent); before=volume(prior)
    # An isolated tick does not establish a comparable 15-minute window.
    comparable=len(recent)>=12 and len(prior)>=12
    va=v15/before if comparable and v15 is not None and before is not None and before>0 else None
    prices=[v[1] for v in recent]
    return {'ret5':ret(5),'ret15':ret(15),'v5':v5,'v15':v15,'va':va,
            'range15':(max(prices)/min(prices)-1)*100 if len(recent)>=12 else None,
            'low15':min(prices) if len(recent)>=12 else None,
            'high15':max(prices) if len(recent)>=12 else None}

def features(sym,fr=None,sess='regular'):
    res=chart(sym)
    if not res:return None
    pts,meta,prev=res
    # Keep only today's requested session; pre-market ticks cannot fill regular windows.
    bounds={'pre-market':(240,570),'regular':(570,960),'after-hours':(960,1200)}
    today=now().astimezone(ET).date()
    if sess in bounds:
        lo,hi=bounds[sess]
        pts=[v for v in pts if (lambda dt: dt.date()==today and lo<=dt.hour*60+dt.minute<hi)(datetime.fromtimestamp(v[0],ET))]
    if len(pts)<3:return None
    pts=sorted({v[0]:v for v in pts}.values())
    p=pts[-1][1]; m=window_metrics(pts)
    change=(p/prev-1)*100 if prev and prev>0 else None
    finr=pick(fr,'Relative Volume','Rel Volume','Rel Volume (Intraday)')
    dayvol=sum(v[2] for v in pts) if all(v[2] is not None for v in pts) else None
    rvol=finr if finr is not None and finr>=0 else None
    va=m['va']; r5=m['ret5']; range15=m['range15']
    compress=max(0,1-min(range15,6)/6) if range15 is not None else 0
    accel=min(max(va or 0,0),5)/5; rv=min(max(rvol or 0,0),3)/3
    momentum=min(max(r5 or 0,0),6)/6; flow=max(accel,rv)
    score=100*(.42*accel+.33*rv+.15*compress*flow+.10*momentum)
    if change is not None and change>=10:score*=.72
    if change is not None and change>=20:score*=.55
    quote_age=(now().timestamp()-pts[-1][0]); fresh=-30<=quote_age<=120 and sess in bounds
    volume_ok=m['v5'] is not None and m['v5']>0
    early=fresh and volume_ok and change is not None and change<10 and score>=34 and (va or 0)>=1.2 and range15 is not None and range15<=5.5
    actionable=early and score>=55 and r5 is not None and r5>=.4
    stage='ACTIONABLE' if actionable else 'EARLY' if early else 'WATCH'
    reasons=[]
    if not fresh:reasons.append('السعر متأخر أو خارج الجلسة')
    if not volume_ok:reasons.append('حجم آخر 5 دقائق غير كافٍ أو غير متاح')
    if va is None:reasons.append('لم تكتمل نافذتا حجم قابلتان للمقارنة')
    if va is not None and va>=1.2:reasons.append(f'تسارع الحجم {va:.1f} مرة')
    if range15 is not None and range15<=5.5:reasons.append(f'تماسك سعري داخل نطاق {range15:.2f}%')
    if change is not None and change>=10:reasons.append('تحرك أكثر من 10%؛ تجنب مطاردة الحركة')
    if r5 is not None and r5<0:reasons.append('زخم آخر 5 دقائق سلبي')
    return {'symbol':sym,'price':round(p,6),'changePct':round_or_none(change),
        'ret5mPct':round_or_none(r5),'ret15mPct':round_or_none(m['ret15']),
        'range15mPct':round_or_none(range15),'volume5m':m['v5'],'volume15m':m['v15'],
        'sessionVolume':dayvol,'volumeAcceleration15m':round_or_none(va),
        'relativeVolume':round_or_none(rvol),'volumeVsAvg':None,
        'nearDayHigh':round(p/max(v[1] for v in pts),4),'score':round(score,2),
        'stage':stage,'quoteTimestampUTC':datetime.fromtimestamp(pts[-1][0],timezone.utc).isoformat(),
        'quoteFresh':fresh,'reasons':reasons,'confirmationCount':0,
        'support15m':round_or_none(m['low15'],6),'breakout15m':round_or_none(m['high15'],6),
        'source':'Yahoo 1m / Finviz relative volume','lanes':(fr or {}).get('_lanes',[])}

def confirm_row(x, rec):
    """Require distinct, recent observations; never confirm a repeat of one quote."""
    stamp=datetime.fromisoformat(x['quoteTimestampUTC']).timestamp()
    previous=rec.get('lastQuoteTimestampUTC')
    gap=stamp-datetime.fromisoformat(previous).timestamp() if previous else None
    eligible=x['stage']=='ACTIONABLE' and x.get('quoteFresh') is True
    if not eligible:count=0
    elif gap == 0:count=rec.get('confirmationCount',0)
    elif gap is not None and 0<gap<=300:count=rec.get('confirmationCount',0)+1
    else:count=1
    if eligible and count>=2:x['stage']='CONFIRMED'
    x['confirmationCount']=count
    rec.update(lastQuoteTimestampUTC=x['quoteTimestampUTC'],confirmationCount=count)

def main():
    t=now();et=t.astimezone(ET);sess=session(et);state=load_state();date=et.date().isoformat()
    if state.get('sessionDateET')!=date:state={'schemaVersion':10,'sessionDateET':date,'symbols':{},'events':[],'sweepCursor':0}
    frs=finviz_rows();fmap={(r.get('Ticker') or '').strip().upper():r for r in frs};hot=list(fmap);retained=[s for s,v in state['symbols'].items() if v.get('bestStage') in ('EARLY','ACTIONABLE','CONFIRMED') or v.get('maxScore',0)>=30];hot=list(dict.fromkeys(hot+retained))[:340]
    directory=symbol_directory();cursor=int(state.get('sweepCursor',0));sweep=[]
    if directory:take=700;sweep=[directory[(cursor+i)%len(directory)] for i in range(min(take,len(directory)))];state['sweepCursor']=(cursor+take)%len(directory)
    universe=list(dict.fromkeys(hot+sweep));rows=[]
    with ThreadPoolExecutor(max_workers=28) as ex:
        fut=[ex.submit(features,s,fmap.get(s),sess) for s in universe]
        for f in as_completed(fut):
            x=f.result()
            if x:rows.append(x)
    rank={'WATCH':0,'EARLY':1,'ACTIONABLE':2,'CONFIRMED':3}
    for x in rows:
        qage=now().timestamp()-datetime.fromisoformat(x['quoteTimestampUTC']).timestamp()
        x['quoteFresh']=x.get('quoteFresh') is True and -30<=qage<=120
        if not x['quoteFresh']:x['stage']='WATCH'
        s=x['symbol'];rec=state['symbols'].setdefault(s,{'firstSeenUTC':t.isoformat(),'bestStage':'WATCH','firstChangePct':x['changePct'],'maxScore':0});confirm_row(x,rec);old=rec.get('bestStage','WATCH');rec.update({'lastSeenUTC':t.isoformat(),'lastScore':x['score'],'lastChangePct':x['changePct'],'maxScore':max(rec.get('maxScore',0),x['score'])})
        if rank[x['stage']]>rank.get(old,0):rec['bestStage']=x['stage'];rec['stageFirstUTC']=t.isoformat();rec['stageFirstChangePct']=x['changePct'];state['events'].append({'ts':t.isoformat(),'symbol':s,'event':'STAGE_UP','from':old,'to':x['stage'],'changePct':x['changePct'],'score':x['score']})
    watch=sorted(rows,key=lambda x:x['score'],reverse=True)[:140];early=[x for x in watch if x['stage'] in ('EARLY','ACTIONABLE','CONFIRMED') and x['changePct'] is not None and x['changePct']<10][:70];action=[x for x in watch if x['stage'] in ('ACTIONABLE','CONFIRMED')][:35];confirmed=[x for x in action if x['stage']=='CONFIRMED'][:20]
    finished=now();out={'engineVersion':'10.1','scanStartedAtUTC':t.isoformat(),'scanDurationSeconds':round((finished-t).total_seconds(),1),'quotesFresh':sum(x.get('quoteFresh') is True for x in rows),'schemaVersion':10,'mode':'FORWARD_PIT_COVERAGE_FIRST','goal':{'earlyTop50RecallPct':70,'status':'TARGET_NOT_GUARANTEED'},'updatedAtUTC':finished.isoformat(),'updatedAtET':finished.astimezone(ET).isoformat(),'session':sess,'universeScanned':len(universe),'quotesValid':len(rows),'hotLane':len(hot),'sweepLane':len(sweep),'watch':watch,'early':early,'actionable':action,'confirmed':confirmed,'truth':{'uiPollSeconds':10,'backendCadenceSeconds':90 if os.getenv('TAGIT_CONTINUOUS')=='1' else 300,'backendCadence':'Best effort: scan duration and GitHub scheduling can delay publication','dataSource':'Yahoo 1m + Finviz Elite + Nasdaq Trader equities','note':'70% is a forward-validation target, not a claimed achieved accuracy.'}}
    OUT_PATH.write_text(json.dumps(out,separators=(',',':')));save_state(state);print(json.dumps({'session':sess,'scanned':len(universe),'valid':len(rows),'watch':len(watch),'early':len(early),'actionable':len(action),'confirmed':len(confirmed)}))
if __name__=='__main__':main()

