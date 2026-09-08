#!/usr/bin/env python3
import concurrent.futures
import datetime as dt
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'tag' / 'data'
OUT = DATA / 'live-quotes.json'
ET = ZoneInfo('America/New_York')
NOW_UTC = dt.datetime.now(dt.timezone.utc)
NOW_ET = NOW_UTC.astimezone(ET)
STARTED = time.monotonic()
MAX_TICKERS = 800


def load(path, default=None):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    except Exception:
        return default if default is not None else {}


def num(v):
    try:
        if v is None:
            return None
        s = str(v).strip().replace('%','').replace(',','').replace('$','')
        if not s or s.lower() in ('none','null','nan','-'):
            return None
        x = float(s)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def sym(r):
    return str((r or {}).get('Ticker') or (r or {}).get('ticker') or (r or {}).get('Symbol') or (r or {}).get('symbol') or '').strip().upper()


def session_for(x):
    t = x.time()
    if x.weekday() >= 5:
        return 'closed'
    if dt.time(4,0) <= t < dt.time(9,30):
        return 'pre-market'
    if dt.time(9,30) <= t < dt.time(16,0):
        return 'regular'
    if dt.time(16,0) <= t <= dt.time(20,0):
        return 'after-hours'
    return 'closed'


MARKET_SESSION = session_for(NOW_ET)


def pct(a, b):
    return ((a-b)/b*100.0) if a is not None and b not in (None, 0) else None


def ema(values, period):
    if not values:
        return None
    k = 2.0/(period+1)
    v = float(values[0])
    for x in values[1:]:
        v = float(x)*k + v*(1-k)
    return v


def rsi(values, period=14):
    if len(values) < period + 1:
        return None
    gains=[]; losses=[]
    for a,b in zip(values[-period-1:-1], values[-period:]):
        d=b-a; gains.append(max(d,0)); losses.append(max(-d,0))
    ag=sum(gains)/period; al=sum(losses)/period
    if al == 0:
        return 100.0
    rs=ag/al
    return 100.0-(100.0/(1.0+rs))


def macd_hist(values):
    if len(values) < 35:
        return None
    macd=[]
    for i in range(26, len(values)+1):
        sub=values[:i]
        e12=ema(sub[-60:],12); e26=ema(sub[-60:],26)
        if e12 is not None and e26 is not None:
            macd.append(e12-e26)
    if len(macd) < 9:
        return None
    sig=ema(macd[-18:],9)
    return macd[-1]-sig if sig is not None else None


def input_rows(obj):
    if not isinstance(obj, dict):
        return []
    rows = obj.get('rows') or obj.get('data') or []
    if isinstance(rows, dict):
        return list(rows.values())
    return list(rows) if isinstance(rows, list) else []


prior = load(DATA/'live-quotes.json', {})
pre = load(DATA/'premarket-hot.json', {})
fast = load(DATA/'discovery-fast.json', {})
disc = load(DATA/'discovery.json', {})
fin = load(DATA/'finviz.json', {})

# Discovery metadata is used only as context. The quote/tape itself always comes from 1m chart data.
disc_rows = input_rows(disc)
fast_rows = input_rows(fast)
fin_rows = input_rows(fin)
pre_rows = input_rows(pre)
if not pre_rows and isinstance(pre.get('rows'), dict):
    pre_rows = list(pre['rows'].values())

context = {}
for r in disc_rows + fast_rows + fin_rows + pre_rows:
    t=sym(r)
    if not t:
        continue
    old=context.get(t,{})
    merged=dict(old); merged.update(r); context[t]=merged


def change_of(r):
    return num((r or {}).get('Change') if (r or {}).get('Change') is not None else (r or {}).get('changePct')) or 0.0


def relvol_of(r):
    return num((r or {}).get('Rel Volume') or (r or {}).get('Relative Volume') or (r or {}).get('relativeVolume')) or 0.0


def vol_of(r):
    return num((r or {}).get('Volume') or (r or {}).get('volume')) or 0.0


# Universe policy: never let one lane crowd out the actual movers. Reserve broad top-gainer,
# unusual-volume and prior-active coverage first, then fill up to 800 unique symbols.
fin_top = sorted(fin_rows, key=lambda r:(change_of(r), relvol_of(r), vol_of(r)), reverse=True)
fin_unusual = sorted(fin_rows, key=lambda r:(relvol_of(r), vol_of(r), abs(change_of(r))), reverse=True)
fast_momentum = sorted(fast_rows, key=lambda r:(abs(change_of(r)), relvol_of(r), vol_of(r)), reverse=True)
pre_hot = sorted(pre_rows, key=lambda r:(abs(change_of(r)), relvol_of(r), vol_of(r)), reverse=True)
prior_active = []
if isinstance(prior.get('quotes'), dict):
    for t,q in prior['quotes'].items():
        prior_active.append({'Ticker':t, **(q or {})})
prior_active.sort(key=lambda r:(num(r.get('earlyBreakoutScore')) or 0, num(r.get('earlyRegimeShiftScore')) or 0, abs(num(r.get('changePct')) or 0)), reverse=True)

def nano_key(r):
    f=num(r.get('Float'))
    return (-(f if f is not None else 1e9), relvol_of(r), vol_of(r))
nano = sorted([r for r in disc_rows if 'nano_low_float' in (r.get('_discoveryLanes') or [])], key=nano_key, reverse=True)

lanes=[
    ('finviz_top_gainers', fin_top, 180),
    ('finviz_unusual_volume', fin_unusual, 120),
    ('fast_discovery', fast_momentum, 180),
    ('premarket_hot', pre_hot, 100),
    ('prior_active', prior_active, 140),
    ('nano_low_float', nano, 80),
]

tickers=[]; lane_of={}; seen=set(); lane_counts={}
for lane,rows,reserve in lanes:
    taken=0
    for r in rows:
        t=sym(r)
        if not t or t in seen or len(t)>12:
            continue
        seen.add(t); tickers.append(t); lane_of[t]=lane; taken+=1
        if taken>=reserve or len(tickers)>=MAX_TICKERS:
            break
    lane_counts[lane]=taken
    if len(tickers)>=MAX_TICKERS:
        break

for rows in (fin_top, fin_unusual, fast_momentum, disc_rows, pre_hot, prior_active, nano):
    if len(tickers)>=MAX_TICKERS:
        break
    for r in rows:
        t=sym(r)
        if not t or t in seen or len(t)>12:
            continue
        seen.add(t); tickers.append(t); lane_of[t]='fill'
        if len(tickers)>=MAX_TICKERS:
            break
lane_counts['fill']=sum(1 for t in tickers if lane_of.get(t)=='fill')


def yahoo_one(ticker):
    try:
        url='https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(ticker)+'?interval=1m&range=1d&includePrePost=true&events=div%2Csplits'
        req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 TAGitLive/9.0','Accept':'application/json'})
        with urllib.request.urlopen(req, timeout=4.0) as z:
            data=json.loads(z.read().decode('utf-8'))
        result=((data.get('chart') or {}).get('result') or [None])[0]
        if not result:
            return ticker,None,'empty chart result'
        meta=result.get('meta') or {}
        ts=result.get('timestamp') or []
        quote=((result.get('indicators') or {}).get('quote') or [{}])[0]
        closes=quote.get('close') or []; highs=quote.get('high') or []; lows=quote.get('low') or []; volumes=quote.get('volume') or []
        pts=[]
        for i,t in enumerate(ts):
            if i>=len(closes) or closes[i] is None:
                continue
            stamp=dt.datetime.fromtimestamp(t, dt.timezone.utc).astimezone(ET)
            c=float(closes[i]); h=float(highs[i]) if i<len(highs) and highs[i] is not None else c; l=float(lows[i]) if i<len(lows) and lows[i] is not None else c; v=int(volumes[i]) if i<len(volumes) and volumes[i] is not None else 0
            pts.append((t,stamp,session_for(stamp),c,h,l,v))
        if not pts:
            return ticker,None,'no priced points'
        latest=pts[-1]
        prev=num(meta.get('previousClose') if meta.get('previousClose') is not None else meta.get('chartPreviousClose'))
        reg=[p for p in pts if p[2]=='regular']; prepts=[p for p in pts if p[2]=='pre-market']; post=[p for p in pts if p[2]=='after-hours']
        regpx=num(meta.get('regularMarketPrice')) or (reg[-1][3] if reg else None)
        prepx=prepts[-1][3] if prepts else None; postpx=post[-1][3] if post else None
        age_min=(NOW_UTC.timestamp()-latest[0])/60.0
        active=[p for p in pts if p[2]==MARKET_SESSION] if MARKET_SESSION!='closed' else pts
        if not active:
            active=pts
        active_span=(latest[0]-active[0][0])/60.0 if active else 0.0

        def px_ago(minutes):
            cutoff=latest[0]-minutes*60
            before=[p for p in active if p[0]<=cutoff]
            return before[-1][3] if before else (active[0][3] if active else None)
        def vol_window(start_min,end_min=0):
            lo=latest[0]-start_min*60; hi=latest[0]-end_min*60
            return sum(p[6] for p in active if lo < p[0] <= hi)
        def prange(minutes):
            arr=[p for p in active if p[0]>=latest[0]-minutes*60]
            if not arr:
                return None
            lo=min(p[5] for p in arr); hi=max(p[4] for p in arr); mid=(lo+hi)/2
            return (hi-lo)/mid*100.0 if mid else None

        v5=pct(latest[3],px_ago(5)); v15=pct(latest[3],px_ago(15)); v30=pct(latest[3],px_ago(30))
        vol5=vol_window(5); prev5=vol_window(10,5); vol15=vol_window(15); prev15=vol_window(30,15)
        acc5=(vol5/prev5) if prev5>0 else None; acc15=(vol15/prev15) if prev15>0 else None
        range15=prange(15); range30=prange(30); day_ch=pct(latest[3],prev)
        ctx=context.get(ticker,{})
        float_m=num(ctx.get('Float') or ctx.get('floatM')); relv=num(ctx.get('Rel Volume') or ctx.get('Relative Volume') or ctx.get('relativeVolume'))
        turn5=(vol5/(float_m*1_000_000)*100.0) if float_m and float_m>0 else None
        turn15=(vol15/(float_m*1_000_000)*100.0) if float_m and float_m>0 else None
        session_vol=sum(p[6] for p in active)
        close_series=[p[3] for p in active]
        e9=ema(close_series[-90:],9); e20=ema(close_series[-120:],20); rrsi=rsi(close_series,14); mh=macd_hist(close_series)
        recent60=[p for p in active if p[0]>=latest[0]-60*60] or active[-60:]
        lo60=min(p[5] for p in recent60); hi60=max(p[4] for p in recent60); span60=hi60-lo60
        fib_support=hi60-0.618*span60 if span60>0 else lo60
        fib_resistance=hi60-0.236*span60 if span60>0 else hi60
        prev_close=active[0][3]
        buy_vol=sum(p[6] for i,p in enumerate(active) if i>0 and p[3]>=active[i-1][3])
        active_vol=sum(p[6] for p in active)
        buy_pct=(buy_vol/active_vol*100.0) if active_vol>0 else None
        vol5_ratio=(vol5/prev5) if prev5>0 else None
        vol_trend=(vol15/prev15) if prev15>0 else None

        technical_score=50.0
        if rrsi is not None:
            if 48<=rrsi<=72: technical_score+=14
            elif rrsi<38 or rrsi>82: technical_score-=18
        if e9 is not None and e20 is not None:
            technical_score += 12 if e9>=e20 else -10
        if mh is not None:
            technical_score += 12 if mh>=0 else -10
        if vol5_ratio is not None:
            technical_score += min(12,max(-8,(vol5_ratio-1)*8))
        if latest[3] >= fib_support*0.995:
            technical_score += 6
        technical_score=max(0,min(100,round(technical_score)))
        tech_ready=rrsi is not None and e9 is not None and e20 is not None and mh is not None and fib_support is not None

        pressure_sources=0
        if acc5 is not None and acc5>=1.8: pressure_sources+=1
        if acc15 is not None and acc15>=1.4: pressure_sources+=1
        if relv is not None and relv>=1.8: pressure_sources+=1
        if turn15 is not None and turn15>=0.55: pressure_sources+=1
        compressed=(range15 is not None and range15<=4.0 and (range30 is None or range30<=7.0))
        quiet=(v5 is not None and -0.8<=v5<=1.8 and v15 is not None and -1.0<=v15<=4.0)
        trend_ok=(e9 is None or e20 is None or e9>=e20*0.997) and (mh is None or mh>=-abs(latest[3])*0.0025)
        buy_ok=(buy_pct is None or buy_pct>=50)
        prebreakout=(age_min<=2.0 and active_span>=10 and day_ch is not None and -3<=day_ch<10 and compressed and quiet and trend_ok and pressure_sources>=1 and buy_ok)

        early_score=0.0
        if active_span>=10: early_score+=8
        if day_ch is not None:
            if 0<=day_ch<8: early_score+=14
            elif -2<=day_ch<0: early_score+=6
        if range15 is not None: early_score+=max(0,min(20,(4.5-range15)*7))
        if acc5 is not None: early_score+=max(0,min(18,(acc5-1)*10))
        if acc15 is not None: early_score+=max(0,min(10,(acc15-1)*8))
        if relv is not None: early_score+=max(0,min(12,(relv-1)*6))
        if turn15 is not None: early_score+=min(12,turn15*8)
        if rrsi is not None and 45<=rrsi<=75: early_score+=8
        if e9 is not None and e20 is not None and e9>=e20: early_score+=8
        if mh is not None and mh>=0: early_score+=7
        if buy_pct is not None and buy_pct>=53: early_score+=7
        if v5 is not None and v5>2.2: early_score-=12
        if day_ch is not None and day_ch>=10: early_score-=30
        early_score=max(0,min(100,round(early_score)))

        accumulation=(age_min<=2.5 and active_span>=12 and range15 is not None and range15<=3.2 and v5 is not None and abs(v5)<=1.4 and pressure_sources>=1)
        acc_score=0.0
        if accumulation: acc_score+=30
        if range15 is not None: acc_score+=max(0,min(25,(3.5-range15)*10))
        if acc5 is not None: acc_score+=max(0,min(25,(acc5-1)*12))
        if relv is not None: acc_score+=max(0,min(15,(relv-1)*6))
        if buy_pct is not None and buy_pct>=52: acc_score+=10
        acc_score=max(0,min(100,round(acc_score)))

        regime=40.0
        if v5 is not None: regime+=max(-12,min(22,v5*4))
        if v15 is not None: regime+=max(-8,min(18,v15*1.8))
        if acc5 is not None: regime+=max(-5,min(18,(acc5-1)*8))
        if turn5 is not None: regime+=min(18,turn5*4)
        if day_ch is not None and 1<=day_ch<12: regime+=10
        if prebreakout: regime+=10
        if day_ch is not None and day_ch>=22: regime-=30
        if v5 is not None and v5<0: regime-=8
        regime=max(0,min(100,round(regime)))
        ignition=max(0,min(100,round(regime + (8 if early_score>=72 else 0) + (6 if acc5 is not None and acc5>=2 else 0) - (18 if day_ch is not None and day_ch>=18 else 0))))

        q={
            'ticker':ticker,'price':latest[3],'session':latest[2],'timestampET':latest[1].isoformat(),'previousClose':prev,
            'regularMarketPrice':regpx,'preMarketPrice':prepx,'afterHoursPrice':postpx,'changePct':day_ch,
            'preMarketChangePct':pct(prepx,prev),'afterHoursChangePct':pct(postpx,regpx),'sessionVolume':session_vol,
            'quoteAgeMin':round(age_min,2),'activeSpanMin':round(active_span,2),'universeLane':lane_of.get(ticker,'unknown'),
            'priceVelocity5mPct':round(v5,3) if v5 is not None else None,'priceVelocity15mPct':round(v15,3) if v15 is not None else None,
            'priceVelocity30mPct':round(v30,3) if v30 is not None else None,'range15mPct':round(range15,3) if range15 is not None else None,
            'range30mPct':round(range30,3) if range30 is not None else None,'volume5m':vol5,'volume15m':vol15,
            'volumeAcceleration5m':round(acc5,3) if acc5 is not None else None,'volumeAcceleration15m':round(acc15,3) if acc15 is not None else None,
            'volumeAccelerationComparable5m':prev5>0,'volumeAccelerationComparable15m':prev15>0,'relativeVolume':relv,'floatM':float_m,
            'turnover5mPctFloat':round(turn5,3) if turn5 is not None else None,'turnover15mPctFloat':round(turn15,3) if turn15 is not None else None,
            'buyVolumePct':round(buy_pct,1) if buy_pct is not None else None,'volume5mRatio':round(vol5_ratio,3) if vol5_ratio is not None else None,
            'volumeTrend':round(vol_trend,3) if vol_trend is not None else None,'rsi14':round(rrsi,2) if rrsi is not None else None,
            'ema9':round(e9,6) if e9 is not None else None,'ema20':round(e20,6) if e20 is not None else None,'macdHist':round(mh,6) if mh is not None else None,
            'fibSupport':round(fib_support,6) if fib_support is not None else None,'fibResistance':round(fib_resistance,6) if fib_resistance is not None else None,
            'fibTrend':'ABOVE_SUPPORT' if latest[3]>=fib_support else 'BELOW_SUPPORT','technicalCoverage':tech_ready,'technicalScore':technical_score,
            'technicalBias':'BULLISH' if technical_score>=62 else ('BEARISH' if technical_score<40 else 'NEUTRAL'),
            'liquidityAccumulation':accumulation,'accumulationScore':int(acc_score),'preBreakout':prebreakout,'earlyBreakoutScore':int(early_score),
            'earlyRegimeShiftScore':int(regime),'ignitionScore':int(ignition),'source':'Yahoo Finance 1m chart + discovery context'
        }
        return ticker,q,None
    except Exception as e:
        return ticker,None,str(e)[:180]


quotes={}; errors=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=64) as ex:
    futures=[ex.submit(yahoo_one,t) for t in tickers]
    for f in concurrent.futures.as_completed(futures):
        t,q,err=f.result()
        if q is not None:
            quotes[t]=q
        elif err:
            errors.append({'ticker':t,'error':err})

fresh=sum(1 for q in quotes.values() if q.get('quoteAgeMin',999)<=2.5 and (MARKET_SESSION=='closed' or q.get('session')==MARKET_SESSION))
if MARKET_SESSION!='closed' and fresh<50:
    raise SystemExit(f'Fail-closed: only {fresh} fresh quotes; refusing to overwrite last valid feed')


def compact(q):
    keys=['ticker','price','changePct','quoteAgeMin','activeSpanMin','sessionVolume','priceVelocity5mPct','priceVelocity15mPct','priceVelocity30mPct','range15mPct','range30mPct','volume5m','volume15m','volumeAcceleration5m','volumeAcceleration15m','volumeAccelerationComparable5m','volumeAccelerationComparable15m','relativeVolume','floatM','turnover5mPctFloat','turnover15mPctFloat','buyVolumePct','volume5mRatio','volumeTrend','rsi14','ema9','ema20','macdHist','fibSupport','fibResistance','fibTrend','technicalCoverage','technicalScore','technicalBias','liquidityAccumulation','accumulationScore','preBreakout','earlyBreakoutScore','earlyRegimeShiftScore','ignitionScore','universeLane','timestampET']
    return {k:q.get(k) for k in keys}


early=[]; emerging=[]; accumulation=[]
for q in quotes.values():
    if q.get('quoteAgeMin',999)>2.5 or (MARKET_SESSION!='closed' and q.get('session')!=MARKET_SESSION):
        continue
    ch=q.get('changePct'); v5=q.get('priceVelocity5mPct'); v15=q.get('priceVelocity15mPct'); score=q.get('earlyRegimeShiftScore') or 0
    if q.get('preBreakout') and (q.get('earlyBreakoutScore') or 0)>=68:
        early.append(compact(q))
    if q.get('liquidityAccumulation') and (q.get('accumulationScore') or 0)>=55 and ch is not None and ch>-5:
        accumulation.append(compact(q))
    independent=((v15 is not None and v15>=1.0) or (q.get('volumeAccelerationComparable5m') and (q.get('volumeAcceleration5m') or 0)>=1.7) or (q.get('turnover5mPctFloat') is not None and q.get('turnover5mPctFloat')>=0.75) or q.get('preBreakout'))
    if ch is not None and -1<=ch<20 and score>=64 and q.get('activeSpanMin',0)>=8 and v5 is not None and v5>=0.55 and independent:
        emerging.append(compact(q))

early.sort(key=lambda x:(x.get('earlyBreakoutScore') or 0,x.get('technicalScore') or 0,x.get('buyVolumePct') or 0),reverse=True)
emerging.sort(key=lambda x:(x.get('earlyRegimeShiftScore') or 0,x.get('ignitionScore') or 0,x.get('technicalScore') or 0),reverse=True)
accumulation.sort(key=lambda x:(x.get('accumulationScore') or 0,x.get('earlyBreakoutScore') or 0,x.get('sessionVolume') or 0),reverse=True)

duration=round(time.monotonic()-STARTED,2)
confidence='HIGH' if fresh>=350 else ('MEDIUM' if fresh>=120 else 'LOW')
out={
    'schemaVersion':9,
    'source':'TAGit Live Engine V9 · Yahoo 1m chart + Finviz/discovery context · technical + pre-breakout detection',
    'updatedAtUTC':NOW_UTC.isoformat(),'updatedAtET':NOW_ET.isoformat(),'marketClockSession':MARKET_SESSION,
    'count':len(quotes),'freshCount':fresh,'requested':len(tickers),'scanDurationSec':duration,'dataConfidence':confidence,
    'coveragePolicy':'TOP_GAINERS+UNUSUAL_VOLUME+DISCOVERY+PRIOR_ACTIVE; 800 UNIQUE SYMBOL TARGET',
    'cadencePolicy':'EVENT_BRIDGE+SESSION_DAEMON; FRONTEND DISPLAYS TRUE QUOTE AGE',
    'earlyDetectionPolicy':'UNDER_10PCT + COMPRESSION + VOLUME_PRESSURE + NON_BEARISH_TECHNICALS + BUY_VOLUME CONFIRMATION',
    'confirmationPolicy':'MULTI_SNAPSHOT FRONTEND MEMORY + TECHNICAL COVERAGE + FAIL_CLOSED STALE FEED',
    'laneCounts':lane_counts,
    'inputDiagnostics':{'finvizRows':len(fin_rows),'fastRows':len(fast_rows),'discoveryRows':len(disc_rows),'premarketRows':len(pre_rows),'priorQuotes':len(prior.get('quotes') or {})},
    'quoteErrors':len(errors),'errorSample':errors[:20],
    'earlyCount':len(early[:60]),'earlyCandidates':early[:60],
    'emergingCount':len(emerging[:60]),'emergingCandidates':emerging[:60],
    'accumulationCount':len(accumulation[:60]),'accumulationCandidates':accumulation[:60],
    'quotes':quotes
}
OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:out[k] for k in ('schemaVersion','updatedAtET','marketClockSession','count','freshCount','requested','scanDurationSec','dataConfidence','earlyCount','emergingCount','accumulationCount')},ensure_ascii=False,indent=2))
