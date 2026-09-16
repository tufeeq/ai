// Read-only market data. No order endpoint, strategy score, or legacy engine.
export const REFERENCE_URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/universe-broad.json';
export const FRESH_QUOTE_MS=3000;
export const MAX_REFERENCE_AGE_MS=86400000;
const isoPattern=/(?:Z|[+-]\d{2}:\d{2})$/;
const finitePositive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function ageMs(at,now){if(typeof at!=='string'||!isoPattern.test(at))return null;const t=Date.parse(at);return Number.isFinite(t)?now-t:null;}
export function normalizeReference(raw,now){
  const age=ageMs(raw?.updatedAt,now);
  if(raw?.schemaVersion!==1||!Array.isArray(raw.rows)||age===null||age<0||age>MAX_REFERENCE_AGE_MS)throw new Error('CURRENT_UNIVERSE_REQUIRED');
  const rows=new Map();
  for(const r of raw.rows){
    const symbol=r.Ticker,industry=r.Industry;
    // Finviz numeric export Market Cap is in USD millions. Reject unknown units.
    const text=String(r['Market Cap']??'');
    const cap=/^\d+(?:\.\d+)?$/.test(text)?Number(text)*1e6:NaN;
    if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol??'')||!industry||/exchange.traded|closed.end|shell compan/i.test(industry)||!finitePositive(cap)||cap>=1e9)continue;
    const rowAge=ageMs(r._snapshotTimestampUTC??raw.updatedAt,now);
    if(rowAge===null||rowAge<0||rowAge>MAX_REFERENCE_AGE_MS)continue;
    rows.set(symbol,{symbol,name:r.Company??symbol,market_cap:cap,metadata_at:r._snapshotTimestampUTC??raw.updatedAt});
  }
  return {source:'Finviz reference metadata only',updated_at:raw.updatedAt,rows};
}
export function normalizeSnapshot(symbol,snapshot,feed,now,metadata){
  const q=snapshot?.latestQuote,t=snapshot?.latestTrade;
  const validQuote=finitePositive(q?.bp)&&finitePositive(q?.ap)&&q.bp<=q.ap&&finitePositive(q.bs)&&finitePositive(q.as);
  const qa=ageMs(q?.t,now),ta=ageMs(t?.t,now);
  const spread=validQuote?(q.ap-q.bp)/q.ap*100:null;
  let status=!validQuote||qa===null?'INVALID_QUOTE':qa<0?'FUTURE_TIMESTAMP':feed==='delayed_sip'?'DELAYED':qa>FRESH_QUOTE_MS?'STALE':spread>0.8?'WIDE_SPREAD':feed==='iex'?'RECENT_IEX':'RECENT_SIP';
  const tradeValid=finitePositive(t?.p)&&ta!==null&&ta>=0;
  return {symbol,...metadata,feed,coverage:feed==='iex'?'SINGLE_EXCHANGE':feed==='sip'?'CONSOLIDATED':'DELAYED_CONSOLIDATED',status,
    quote:validQuote&&qa!==null&&qa>=0?{bid:q.bp,ask:q.ap,bid_size:q.bs,ask_size:q.as,timestamp:q.t,age_ms:qa,spread_pct:spread}:null,
    trade:tradeValid?{price:t.p,timestamp:t.t,age_ms:ta,status:feed==='delayed_sip'?'DELAYED':ta>FRESH_QUOTE_MS?'STALE':'RECENT'}:null,
    approved_for_live:false,purpose:'PRICE_OBSERVATION_ONLY'};
}
export function parseSymbols(value){
  const symbols=[...new Set(String(value??'').toUpperCase().split(',').map(s=>s.trim()).filter(Boolean))].sort();
  if(!symbols.length||symbols.length>20||symbols.some(s=>!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))throw new Error('INVALID_SYMBOLS');
  return symbols;
}
export function settings(env){
  const key=env.ALPACA_API_KEY_ID||env.APCA_API_KEY_ID,secret=env.ALPACA_API_SECRET_KEY||env.APCA_API_SECRET_KEY;
  const feed=env.TAGIT_DATA_FEED||'iex';
  if(!['iex','sip','delayed_sip'].includes(feed))throw new Error('INVALID_FEED');
  return {key,secret,feed,configured:Boolean(key&&secret)};
}
export function createMarketService({env=process.env,fetcher=fetch,now=Date.now}={}){
  let reference=null,referenceFetched=0,referenceLoading=null;
  const cache=new Map(),inflight=new Map();let windowStart=0,requests=0;
  async function fetchJSON(url,headers){
    let r;try{r=await fetcher(url,{headers,signal:AbortSignal.timeout(4500)});}catch{throw new Error('PROVIDER_UNAVAILABLE');}
    if(!r.ok){const code=r.status===401?'PROVIDER_AUTH_FAILED':r.status===403?'FEED_NOT_ENTITLED':r.status===429?'RATE_LIMITED':'PROVIDER_UNAVAILABLE';throw new Error(code);}
    try{return await r.json();}catch{throw new Error('INVALID_PROVIDER_RESPONSE');}
  }
  async function getReference(){
    if(reference&&now()-referenceFetched<300000)return normalizeReference(reference,now());
    if(!referenceLoading)referenceLoading=(async()=>{const raw=await fetchJSON(REFERENCE_URL,{});normalizeReference(raw,now());reference=raw;referenceFetched=now();})().finally(()=>{referenceLoading=null;});
    await referenceLoading;return normalizeReference(reference,now());
  }
  async function quotes(value){
    const symbols=parseSymbols(value),s=settings(env);
    if(!s.configured)throw new Error('RUNTIME_CREDENTIALS_NOT_CONFIGURED');
    const ref=await getReference();
    const rejected=symbols.filter(symbol=>!ref.rows.has(symbol));
    const eligible=symbols.filter(symbol=>ref.rows.has(symbol));
    if(!eligible.length)return {schema_version:1,status:'INELIGIBLE_SYMBOLS',rejected,rows:[],server_time:new Date(now()).toISOString(),approved_for_live:false};
    const key=s.feed+':'+eligible.join(',');let raw=cache.get(key);
    if(!raw||now()-raw.received>1500){
      if(!inflight.has(key)){
        if(now()-windowStart>=60000){windowStart=now();requests=0;}if(requests>=90)throw new Error('RATE_LIMITED');requests++;
        inflight.set(key,(async()=>{
          const payload=await fetchJSON('https://data.alpaca.markets/v2/stocks/snapshots?symbols='+encodeURIComponent(eligible.join(','))+'&feed='+s.feed,
            {'APCA-API-KEY-ID':s.key,'APCA-API-SECRET-KEY':s.secret});
          if(!payload||Array.isArray(payload)||typeof payload!=='object')throw new Error('INVALID_PROVIDER_RESPONSE');
          const record={payload,received:now()};if(cache.size>=50)cache.delete(cache.keys().next().value);cache.set(key,record);return record;
        })().finally(()=>inflight.delete(key)));
      }
      raw=await inflight.get(key);
    }
    const checked=now();
    return {schema_version:1,status:rejected.length?'PARTIAL':'OK',rejected,feed:s.feed,server_time:new Date(checked).toISOString(),provider_received_at:new Date(raw.received).toISOString(),metadata_at:ref.updated_at,
      refresh_ms:5000,rows:eligible.map(symbol=>normalizeSnapshot(symbol,raw.payload[symbol],s.feed,checked,ref.rows.get(symbol))),approved_for_live:false,purpose:'PRICE_OBSERVATION_ONLY'};
  }
  return {quotes,async universe(){const r=await getReference();return {schema_version:1,updated_at:r.updated_at,source:r.source,rows:[...r.rows.values()],approved_for_live:false};},health(){const s=settings(env);return {schema_version:1,status:s.configured?'CONFIGURED_UNVERIFIED':'RUNTIME_CREDENTIALS_NOT_CONFIGURED',feed:s.feed,credentials_configured:s.configured,stream_connected:false,transport:'HTTP_POLLING',refresh_ms:5000,approved_for_live:false};}};
}
