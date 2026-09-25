// Real-time consolidated last sale, bid/ask and day volume from Nasdaq.com's public quote API
// (unofficial, free). Complements single-exchange IEX data, which misses most small-cap trades.
// Refreshes run in the background so scans never wait; blocks and rate limits back off.
const API='https://api.nasdaq.com/api/quote/';
const TTL_MS=20000;
const CONCURRENCY=3;
const BACKOFF_MS=5*60000;
const HEADERS={'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36','Accept':'application/json, text/plain, */*','Origin':'https://www.nasdaq.com','Referer':'https://www.nasdaq.com/'};
const money=s=>{const n=Number(String(s??'').replace(/[$,]/g,''));return Number.isFinite(n)&&n>0?n:null;};
const count=s=>{const n=Number(String(s??'').replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:null;};
const MONTHS={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

/** "Sep 25, 2026 2:40 PM ET" → ISO UTC of the start of that New York minute; null when malformed. */
export function nasdaqMinute(text){
 const m=/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET$/.exec(String(text??'').trim());
 if(!m||!(m[1] in MONTHS))return null;
 const hour=(+m[4]%12)+(m[6]==='PM'?12:0),wall=Date.UTC(+m[3],MONTHS[m[1]],+m[2],hour,+m[5]);
 for(const offset of [4,5]){
  const guess=wall+offset*3600000;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
  if(+parts.find(p=>p.type==='hour').value===hour&&+parts.find(p=>p.type==='minute').value===+m[5])return new Date(guess).toISOString();
 }
 return null;
}

export function parseQuote(symbol,body,fetchedAt){
 const d=body?.data,p=d?.primaryData;
 if(!p||d.symbol?.toUpperCase()!==symbol)return null;
 const bid=money(p.bidPrice),ask=money(p.askPrice),price=money(p.lastSalePrice);
 return {
  source:'NASDAQ_COM',
  real_time:p.isRealTime===true,
  price,
  trade_minute_at:nasdaqMinute(p.lastTradeTimestamp),
  bid:bid&&ask&&bid<=ask?bid:null,
  ask:bid&&ask&&bid<=ask?ask:null,
  volume:count(p.volume),
  fetched_at:new Date(fetchedAt).toISOString(),
 };
}

export function createConsolidated({fetcher=fetch,now=Date.now}={}){
 const cache=new Map(),queue=new Set();let active=0,blockedUntil=0,ok=0,failed=0,lastError=null,lastOkAt=null;
 async function load(symbol){
  try{
   const r=await fetcher(API+encodeURIComponent(symbol)+'/info?assetclass=stocks',{headers:HEADERS,signal:AbortSignal.timeout(8000)});
   if(r.status===403||r.status===429){blockedUntil=now()+BACKOFF_MS;throw Error('BLOCKED_'+r.status);}
   if(!r.ok)throw Error('HTTP_'+r.status);
   const quote=parseQuote(symbol,await r.json(),now());
   if(!quote?.price)throw Error('NO_QUOTE');
   cache.set(symbol,quote);ok++;lastOkAt=now();
  }catch(e){failed++;lastError=e.message;}
 }
 function pump(){
  while(active<CONCURRENCY&&queue.size&&now()>=blockedUntil){
   const symbol=queue.values().next().value;queue.delete(symbol);active++;
   load(symbol).finally(()=>{active--;pump();});
  }
 }
 return {
  /** Cached quotes for `symbols`; stale or missing ones are refreshed in the background. */
  peek(symbols){
   const out=new Map();
   for(const s of symbols){
    const q=cache.get(s);
    if(q&&now()-Date.parse(q.fetched_at)<=TTL_MS*3)out.set(s,q);
    if(!q||now()-Date.parse(q.fetched_at)>TTL_MS)queue.add(s);
   }
   pump();
   return out;
  },
  status:()=>({source:'NASDAQ_COM',status:now()<blockedUntil?'BACKING_OFF':lastOkAt?'OK':failed?'FAILING':'IDLE',ok,failed,last_ok_at:lastOkAt?new Date(lastOkAt).toISOString():null,last_error:lastError,queued:queue.size}),
 };
}
