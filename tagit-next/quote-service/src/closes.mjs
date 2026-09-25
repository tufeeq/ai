// Prior-session closes from consolidated (SIP) daily bars. Bars that ended before today are older
// than 15 minutes, so free Alpaca plans may read SIP for them; a single-exchange IEX close misstates
// thin names and therefore their day change. Refreshed in the background; failures leave the
// scanner's own close in place and are reported.
import {settings} from './market.mjs';

const TTL_MS=10*60000;
const BATCH=150;
const nyDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const sessionDate=t=>nyDate.format(new Date(t));

export function createSipCloses({env=process.env,fetcher=fetch,now=Date.now}={}){
 let closes=new Map(),day=null,fetchedAt=0,loading=null,status='IDLE',error=null;
 async function refresh(symbols){
  const s=settings(env);
  if(!s.configured){status='NOT_CONFIGURED';return;}
  const today=sessionDate(now()),next=new Map();
  try{
   for(let i=0;i<symbols.length;i+=BATCH){
    const batch=symbols.slice(i,i+BATCH);
    const url='https://data.alpaca.markets/v2/stocks/bars?timeframe=1Day&adjustment=split&feed=sip&limit=10000&symbols='+encodeURIComponent(batch.join(','))
     +'&start='+encodeURIComponent(new Date(now()-7*86400000).toISOString())+'&end='+today+'T00:00:00Z';
    const r=await fetcher(url,{headers:{'APCA-API-KEY-ID':s.key,'APCA-API-SECRET-KEY':s.secret},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('HTTP_'+r.status);
    for(const [symbol,bars] of Object.entries((await r.json()).bars??{})){
     const prior=bars.filter(b=>sessionDate(b.t)<today&&b.c>0).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t)).at(-1);
     if(prior)next.set(symbol,{close:prior.c,session:sessionDate(prior.t)});
    }
   }
   closes=next;day=today;fetchedAt=now();status='OK';error=null;
  }catch(e){status='UNAVAILABLE';error=e.message;}
 }
 return {
  /** Cached closes for today's session; refreshes in the background when stale or a new day starts. */
  peek(symbols){
   const today=sessionDate(now());
   if((day!==today||now()-fetchedAt>TTL_MS)&&!loading&&symbols.length)loading=refresh([...new Set(symbols)]).finally(()=>loading=null);
   return day===today?closes:new Map();
  },
  settle:()=>loading,
  status:()=>({source:'ALPACA_SIP_DAILY',status,session:day,symbols:closes.size,fetched_at:fetchedAt?new Date(fetchedAt).toISOString():null,error}),
 };
}

/** Replace a row's previous close with the SIP close and recompute its day change from the live price. */
export function applyClose(row,sip){
 if(!sip)return row;
 const change=row.price>0&&sip.close>0?(row.price/sip.close-1)*100:null;
 return {...row,previous_close:sip.close,day_change:change,change_basis:'SIP_PREVIOUS_CLOSE',close_session:sip.session};
}
