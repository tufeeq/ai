"""Authenticated quote checks and frozen conditional plans; no order submission."""
import copy, hashlib, json, math, os, re, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

SCHEMA='conditional-plan-v1'
QUOTE_MAX_AGE=15
SPREAD_MAX_PCT=.3
PLAN_LIFETIME=300
SLIPPAGE_PER_SIDE=.002

def stamp(value):
    try:return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
    except (ValueError,TypeError,AttributeError):return None

def iso(at):return datetime.fromtimestamp(at,timezone.utc).isoformat()
def finite(x):return isinstance(x,(float,int)) and not isinstance(x,bool) and math.isfinite(x)

def normalize_quote(snapshot, feed):
    q=snapshot.get('latest_quote') or snapshot.get('latestQuote') or {}
    def field(long,short):return q.get(long,q.get(short))
    return {'source':'Alpaca','feed':feed,'scope':'SINGLE_EXCHANGE' if feed=='iex' else 'CONSOLIDATED',
        'timestampUTC':field('timestamp','t'),'bid':field('bid_price','bp'),'ask':field('ask_price','ap'),
        'bidSize':field('bid_size','bs'),'askSize':field('ask_size','as')}

def quote_checks(q,at):
    if not q:return ['QUOTE_UNAVAILABLE']
    failed=[];ts=stamp(q.get('timestampUTC'))
    if ts is None or not 0<=at-ts<=QUOTE_MAX_AGE:failed.append('QUOTE_EXPIRED')
    bid,ask=q.get('bid'),q.get('ask')
    if not all(finite(v) and v>0 for v in (bid,ask,q.get('bidSize'),q.get('askSize'))) or bid>ask:
        failed.append('INVALID_BID_ASK')
    elif 100*(ask-bid)/((ask+bid)/2)>SPREAD_MAX_PCT:failed.append('SPREAD_TOO_WIDE')
    if q.get('feed') not in ('iex','sip'):failed.append('UNSUPPORTED_QUOTE_FEED')
    return failed

def fetch_quotes(symbols):
    """Credentials stay server-side. Never retry a denied feed with hidden defaults."""
    key=os.getenv('ALPACA_API_KEY_ID','').strip();secret=os.getenv('ALPACA_API_SECRET_KEY','').strip()
    feed=os.getenv('TAGIT_ALPACA_FEED','iex').strip().lower()
    health={'feed':feed,'scope':'SINGLE_EXCHANGE' if feed=='iex' else 'CONSOLIDATED',
        'transport':'REST_POLLING','credentialsConfigured':bool(key and secret),'requested':0,'received':0}
    if not key or not secret:return {},{**health,'status':'RUNTIME_CREDENTIALS_NOT_CONFIGURED'}
    if feed not in ('iex','sip'):return {},{**health,'status':'INVALID_FEED_CONFIGURATION'}
    symbols=list(dict.fromkeys(s for s in symbols if re.fullmatch(r'[A-Z][A-Z0-9.\-]{0,11}',s)))[:50]
    health['requested']=len(symbols)
    if not symbols:return {},{**health,'status':'NO_QUALIFYING_SYMBOLS'}
    url='https://data.alpaca.markets/v2/stocks/snapshots?'+urllib.parse.urlencode({'symbols':','.join(symbols),'feed':feed})
    req=urllib.request.Request(url,headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret,'Accept':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=8) as r:data=json.load(r)
        if not isinstance(data,dict):raise ValueError('schema')
        quotes={s:normalize_quote(data[s],feed) for s in symbols if isinstance(data.get(s),dict)}
        health.update(status='OK' if len(quotes)==len(symbols) else 'PARTIAL',received=len(quotes))
        return quotes,health
    except urllib.error.HTTPError as e:
        # Never echo response bodies, authentication headers or credential values.
        return {},{**health,'status':'AUTH_OR_ENTITLEMENT_DENIED' if e.code in (401,403,422) else 'PROVIDER_ERROR','httpStatus':e.code}
    except (OSError,ValueError,TypeError):return {},{**health,'status':'PROVIDER_UNAVAILABLE'}

def structure_ready(row,at):
    close=stamp(row.get('barCloseTimestampUTC'))
    return (row.get('screeningPassed') is True and row.get('barClosed') is True
        and row.get('quoteFresh') is True and row.get('instrumentType')=='EQUITY'
        and row.get('session')=='regular' and not row.get('riskBlocks')
        and close is not None and 0<=at-close<=60)

def make_plan(row,at):
    """Price levels come only from the closed range available at creation."""
    price,high,low=row.get('price'),row.get('breakout15m'),row.get('support15m')
    if not structure_ready(row,at) or not all(finite(x) and x>0 for x in (price,high,low)):return None
    buffer=.01 if price>=1 else .0001
    entry=round(max(price,high)+buffer,6);stop=round(low-buffer,6)
    if stop<=0 or stop>=entry or (entry-stop)/entry>.05:return None
    entry_limit=round(entry*1.0025,6)
    entry_fill=entry_limit*(1+SLIPPAGE_PER_SIDE);stop_fill=stop*(1-SLIPPAGE_PER_SIDE)
    target=math.ceil((3*entry_fill-2*stop_fill)/(1-SLIPPAGE_PER_SIDE)*1e6)/1e6
    created=row['barCloseTimestampUTC'];expiry=stamp(created)+PLAN_LIFETIME
    identity=f'{SCHEMA}:{row.get("sessionDateET")}:{row["symbol"]}:{created}'
    return {'schema':SCHEMA,'id':hashlib.sha256(identity.encode()).hexdigest()[:16],'symbol':row['symbol'],
        'createdAtUTC':iso(at),'anchorBarCloseUTC':created,'expiresAtUTC':iso(expiry),
        'entryTrigger':entry,'entryLimit':entry_limit,'stopReference':stop,'targetScenario':target,'costBasis':'MAX_ENTRY_PRICE',
        'assumedSlippagePerSidePct':.2,'assumedFeePerSide':0,'plannedNetRewardRisk':2,
        'referenceEvidence':{k:copy.deepcopy(row.get(k)) for k in ('price','breakout15m','support15m','dollarVolume5m','dollarVolume15m','ret5mPct','ret15mPct','source')},
        'tradeEligible':False,'modelApproval':'NOT_ESTABLISHED','meaning':'Conditional paper scenario; target is arithmetic, not a forecast'}

def assess(plan,row,quote,at):
    result=copy.deepcopy(plan);blocks=[]
    if at>=stamp(plan['expiresAtUTC']):blocks.append('PLAN_EXPIRED')
    if not structure_ready(row,at):blocks.append('STRUCTURE_UNAVAILABLE')
    if plan.get('invalidatedAtUTC'):blocks.append('PLAN_INVALIDATED')
    anchor=stamp(plan['anchorBarCloseUTC'])
    later_lows=[p[5] for p in row.get('_points',[]) if len(p)>=6 and anchor<=p[0] and p[0]+60<=at and finite(p[5])]
    close=stamp(row.get('barCloseTimestampUTC'));price=row.get('price')
    fresh_price=close is not None and 0<=at-close<=60 and finite(price)
    if (later_lows and min(later_lows)<=plan['stopReference']) or (fresh_price and price<=plan['stopReference']):
        blocks.append('STOP_ALREADY_BREACHED');result['invalidatedAtUTC']=iso(at)
    elif fresh_price and price>plan['entryLimit']:
        blocks.append('ENTRY_ALREADY_EXTENDED');result['invalidatedAtUTC']=iso(at)
    blocks+=quote_checks(quote,at)
    result.update(quote=copy.deepcopy(quote),evaluatedAtUTC=iso(at),paperTriggerObserved=False)
    if not blocks:
        if quote['bid']<=plan['stopReference']:
            blocks.append('STOP_ALREADY_BREACHED');result['invalidatedAtUTC']=iso(at)
        elif quote['ask']>plan['entryLimit']:
            blocks.append('ENTRY_ALREADY_EXTENDED');result['invalidatedAtUTC']=iso(at)
        elif quote['ask']>=plan['entryTrigger']:result['paperTriggerObserved']=True
    result.update(blocks=blocks,status='BLOCKED' if blocks else 'PAPER_TRIGGER_OBSERVED' if result['paperTriggerObserved'] else 'WAITING_FOR_TRIGGER',
        tradeEligible=False,liveApprovalBlocks=['STRATEGY_NOT_VALIDATED','HALT_AND_CATALYST_UNVERIFIED']+(['SINGLE_EXCHANGE_QUOTE'] if quote and quote.get('feed')=='iex' else []))
    return result

def attach_plans(state,rows,quotes,at):
    active=state.setdefault('conditionalPlans',{});events=state.setdefault('conditionalPlanObservations',{})
    for row in rows:
        key=f'{row.get("sessionDateET")}:{row["symbol"]}'
        old=active.get(key)
        if old is None or at>=stamp(old['expiresAtUTC']):old=make_plan(row,at)
        quote=quotes.get(row['symbol']);row['executionQuote']=quote
        row['bidAskVerified']=bool(quote and not quote_checks(quote,at) and quote.get('feed')=='sip')
        if old is None:continue
        result=assess(old,row,quote,at);active[key]=result;row['conditionalPlan']=result
        if result['paperTriggerObserved'] and result['id'] not in events:
            events[result['id']]={**copy.deepcopy(result),'observedAtUTC':iso(at),'outcomeStatus':'UNASSESSED',
                'executionAssumption':'Observed quote crossing only; no submitted order and no assumed fill'}
    state['conditionalPlans']={k:v for k,v in active.items() if stamp(v['expiresAtUTC'])>=at-86400}
    state['conditionalPlanObservations']=dict(sorted(events.items(),key=lambda kv:kv[1]['observedAtUTC'])[-2000:])
