#!/usr/bin/env python3
import argparse, concurrent.futures, datetime, json, math, pathlib, time, urllib.parse, urllib.request

DATA_PATH = pathlib.Path('tag/data/live-quotes.json')
USER_AGENT = 'Mozilla/5.0 TAGitTechnical/7.0'
TECH_KEYS = [
    'technicalScore','technicalBias','technicalCoverage','rsi14','macd','macdSignal','macdHist',
    'ema9','ema20','volume5mRatio','volumeTrend','buyVolumePct','fibTrend','fibHigh','fibLow',
    'fibSupport','fibResistance','fibLevels','technicalSource','technicalAsOfUTC'
]

def finite(v):
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None

def avg(xs):
    xs=[x for x in xs if x is not None and math.isfinite(x)]
    return sum(xs)/len(xs) if xs else None

def ema_series(values, period):
    out=[None]*len(values)
    if len(values)<period:return out
    seed=avg(values[:period])
    if seed is None:return out
    k=2/(period+1); e=seed; out[period-1]=e
    for i in range(period,len(values)):
        e=values[i]*k+e*(1-k);out[i]=e
    return out

def rsi14(values):
    p=14
    if len(values)<=p:return None
    gain=loss=0.0
    for i in range(1,p+1):
        d=values[i]-values[i-1]
        if d>=0:gain+=d
        else:loss-=d
    ag=gain/p;al=loss/p
    for i in range(p+1,len(values)):
        d=values[i]-values[i-1];g=max(0.0,d);l=max(0.0,-d)
        ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p
    if al==0:return 100.0
    rs=ag/al
    return 100-(100/(1+rs))

def macd(values):
    e12=ema_series(values,12);e26=ema_series(values,26);line=[]
    for a,b in zip(e12,e26):
        if a is not None and b is not None:line.append(a-b)
    if len(line)<9:return (None,None,None)
    sig=ema_series(line,9);m=line[-1];s=sig[-1]
    return (m,s,None if s is None else m-s)

def fibonacci(bars, price):
    w=bars[-min(156,len(bars)):]
    if len(w)<12:return None
    high,hi_i=max((b['h'],i) for i,b in enumerate(w));low,lo_i=min((b['l'],i) for i,b in enumerate(w))
    if high<=low:return None
    trend='UP' if lo_i<hi_i else 'DOWN';rng=high-low;ratios=(0.236,0.382,0.5,0.618,0.786)
    levels=[]
    for r in ratios:
        p=high-rng*r if trend=='UP' else low+rng*r
        levels.append({'ratio':r,'price':round(p,6)})
    prices=sorted(x['price'] for x in levels)
    supports=[p for p in prices if p<=price];resists=[p for p in prices if p>=price]
    return {'trend':trend,'high':high,'low':low,'support':max(supports) if supports else low,'resistance':min(resists) if resists else high,'levels':levels}

def tech_from_bars(bars):
    bars=[b for b in bars if all(finite(b.get(k)) is not None for k in ('o','h','l','c','v'))]
    if len(bars)<35:return None
    closes=[b['c'] for b in bars];vols=[b['v'] for b in bars];price=closes[-1]
    rsi=rsi14(closes);m,ms,mh=macd(closes);e9=ema_series(closes,9)[-1];e20=ema_series(closes,20)[-1]
    base=avg(vols[-21:-1]);vr=(vols[-1]/base) if base and base>0 else None
    prior=avg(vols[-13:-3]);vt=(avg(vols[-3:])/prior) if prior and prior>0 else None
    pb=bars[-20:];total=sum(b['v'] for b in pb);up=sum(b['v'] for b in pb if b['c']>=b['o']);buy=(up/total*100) if total>0 else None
    fib=fibonacci(bars,price)
    score=50.0
    if rsi is not None:
        if 48<=rsi<=68:score+=14
        elif 42<=rsi<=75:score+=7
        elif rsi>=82:score-=18
        elif rsi<35:score-=10
    if mh is not None:score+=15 if mh>0 else -12
    if m is not None and ms is not None:score+=5 if m>ms else -4
    if e9 is not None and e20 is not None:score+=12 if e9>e20 else -10
    if e9 is not None:score+=7 if price>=e9 else -6
    if vr is not None:score+=14 if vr>=2 else (8 if vr>=1.3 else (-8 if vr<0.7 else 0))
    if vt is not None:score+=7 if vt>=1.2 else (-6 if vt<0.8 else 0)
    if buy is not None:score+=5 if buy>=58 else (-5 if buy<42 else 0)
    if fib:
        if fib['trend']=='UP':score+=6
        sd=(price-fib['support'])/price*100 if price else None
        rd=(fib['resistance']-price)/price*100 if price else None
        if sd is not None and 0<=sd<=3:score+=7
        if rd is not None and 0<=rd<=1.2 and (vr or 0)>=1.3:score+=4
    score=max(0,min(100,round(score)))
    bias='OVERHEATED' if rsi is not None and rsi>=80 and score>=55 else ('BULLISH' if score>=65 else ('BEARISH' if score<=38 else 'NEUTRAL'))
    return {
        'technicalScore':score,'technicalBias':bias,'technicalCoverage':True,
        'rsi14':round(rsi,1) if rsi is not None else None,'macd':round(m,6) if m is not None else None,
        'macdSignal':round(ms,6) if ms is not None else None,'macdHist':round(mh,6) if mh is not None else None,
        'ema9':round(e9,6) if e9 is not None else None,'ema20':round(e20,6) if e20 is not None else None,
        'volume5mRatio':round(vr,2) if vr is not None else None,'volumeTrend':round(vt,2) if vt is not None else None,
        'buyVolumePct':round(buy,1) if buy is not None else None,
        'fibTrend':fib['trend'] if fib else None,'fibHigh':round(fib['high'],6) if fib else None,
        'fibLow':round(fib['low'],6) if fib else None,'fibSupport':round(fib['support'],6) if fib else None,
        'fibResistance':round(fib['resistance'],6) if fib else None,'fibLevels':fib['levels'] if fib else None,
        'technicalSource':'Yahoo Finance 5m OHLCV (5d)','technicalAsOfUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

def fetch_technical(ticker):
    try:
        url='https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(ticker)+'?range=5d&interval=5m&includePrePost=true&events=div%2Csplits'
        req=urllib.request.Request(url,headers={'User-Agent':USER_AGENT,'Accept':'application/json'})
        with urllib.request.urlopen(req,timeout=5.5) as z:data=json.loads(z.read().decode('utf-8'))
        result=((data.get('chart') or {}).get('result') or [None])[0]
        if not result:return ticker,None,'empty result'
        ts=result.get('timestamp') or [];q=((result.get('indicators') or {}).get('quote') or [{}])[0]
        bars=[]
        for i,t in enumerate(ts):
            try:
                o=finite((q.get('open') or [])[i]);h=finite((q.get('high') or [])[i]);l=finite((q.get('low') or [])[i]);c=finite((q.get('close') or [])[i]);v=finite((q.get('volume') or [])[i])
            except Exception:continue
            if None in (o,h,l,c,v):continue
            bars.append({'t':t,'o':o,'h':h,'l':l,'c':c,'v':v})
        out=tech_from_bars(bars)
        return ticker,out,None if out else 'insufficient bars'
    except Exception as e:return ticker,None,str(e)[:160]

def merge_candidate(candidate, quote):
    if not quote:return candidate
    out=dict(candidate)
    for k in TECH_KEYS:
        if k in quote:out[k]=quote.get(k)
    return out

def enrich(path=DATA_PATH, max_symbols=120):
    data=json.loads(path.read_text(encoding='utf-8'));quotes=data.get('quotes') or {}
    seeds=[]
    for arr_name in ('emergingCandidates','accumulationCandidates'):
        for x in data.get(arr_name) or []:
            t=str(x.get('ticker') or '').upper()
            if t and t not in seeds:seeds.append(t)
    ranked=sorted(quotes.items(),key=lambda kv:(finite(kv[1].get('earlyRegimeShiftScore')) or 0,finite(kv[1].get('accumulationScore')) or 0,abs(finite(kv[1].get('changePct')) or 0)),reverse=True)
    for t,_ in ranked:
        if t not in seeds:seeds.append(t)
        if len(seeds)>=max_symbols:break
    seeds=seeds[:max_symbols];found={};errors=[];started=time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
        futures=[ex.submit(fetch_technical,t) for t in seeds]
        for f in concurrent.futures.as_completed(futures):
            t,out,err=f.result()
            if out:found[t]=out
            elif err:errors.append({'ticker':t,'error':err})
    for t,out in found.items():
        if t in quotes:quotes[t].update(out)
    data['quotes']=quotes
    for name in ('emergingCandidates','accumulationCandidates'):
        data[name]=[merge_candidate(x,quotes.get(str(x.get('ticker') or '').upper())) for x in (data.get(name) or [])]
    data['technicalEngine']='RSI14 + MACD(12,26,9) + EMA9/20 + 5m relative volume/trend + Fibonacci'
    data['technicalSource']='Yahoo Finance 5m OHLCV (5d); Finviz/discovery remain universe context'
    data['technicalUpdatedAtUTC']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    data['technicalRequested']=len(seeds);data['technicalCount']=len(found);data['technicalErrors']=errors[:20]
    data['technicalPolicy']='CONFIRMED requires technical coverage; weak/overheated technicals cannot remain confirmed'
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'technicalRequested':len(seeds),'technicalCount':len(found),'durationSec':round(time.monotonic()-started,2),'errors':len(errors)}))
    return len(found)

def self_test():
    bars=[];base=10.0
    for i in range(80):
        c=base+i*0.025+(0.03 if i%3==0 else 0);o=c-0.015;h=c+0.06;l=c-0.05;v=100000+i*2500
        bars.append({'t':i,'o':o,'h':h,'l':l,'c':c,'v':v})
    t=tech_from_bars(bars)
    assert t and t['technicalCoverage'] is True
    assert t['rsi14'] is not None and t['ema9']>t['ema20']
    assert t['fibSupport'] is not None and t['fibResistance'] is not None
    assert 0<=t['technicalScore']<=100
    print('technical self-test passed')

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--self-test',action='store_true');ap.add_argument('--path',default=str(DATA_PATH));ap.add_argument('--max-symbols',type=int,default=120);args=ap.parse_args()
    if args.self_test:self_test()
    else:
        count=enrich(pathlib.Path(args.path),max_symbols=max(20,min(args.max_symbols,180)))
        if count<1:raise SystemExit('No technical data enriched; leaving workflow failed rather than fabricating indicators')
