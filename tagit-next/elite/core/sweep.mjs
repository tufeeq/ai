// Broader observation runs beside the frozen NEXT shortlist. No order endpoint.
import {settings,REFERENCE_URL,normalizeReference} from '../../quote-service/src/market.mjs';
import {analyzeBars,rankSnapshot} from '../../quote-service/src/scanner.mjs';
import {createCalendar,nyParts} from './calendar.mjs';
export function createSweep({env=process.env,fetcher=fetch,now=Date.now}={}){
 const history=new Map(),cursors=new Map();let reference=null,referenceAt=0,calendar=null,day=null,newsAt=0,newsCache=[];
 async function request(url,auth=true){const s=settings(env);if(auth&&!s.configured)throw Error('CREDENTIALS_NOT_CONFIGURED');const r=await fetcher(url,{headers:auth?{'APCA-API-KEY-ID':s.key,'APCA-API-SECRET-KEY':s.secret}:{},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(r.status===429?'RATE_LIMITED':r.status===403?'FEED_NOT_ENTITLED':'PROVIDER_UNAVAILABLE');return r.json();}
 return {async scan(){
  const started=now(),s=settings(env),today=nyParts(started).date;
  if(day!==today){calendar=createCalendar(await request('https://paper-api.alpaca.markets/v2/calendar?start='+today+'&end='+today),{start:today,end:today});day=today;history.clear();cursors.clear();}
  const session=calendar.at(started);
  // Regular and premarket only; after-hours close must be provider-confirmed before enabling.
  if(!session.valid||!['PREMARKET','OPENING','MORNING','MIDDAY','FINAL'].includes(session.phase))return {closed:true,phase:session.phase,server_time:new Date(now()).toISOString()};
  if(!reference||now()-referenceAt>=300000){
   const [assets,raw]=await Promise.all([request('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity&exchange=NASDAQ'),request(REFERENCE_URL,false)]);
   const ref=normalizeReference(raw,now());if(!Array.isArray(assets))throw Error('INVALID_ASSETS');
   const listed=assets.filter(a=>a.exchange==='NASDAQ'&&a.status==='active'&&/^[A-Z][A-Z0-9.-]{0,9}$/.test(a.symbol));
   reference={listed:listed.length,at:ref.updated_at,rows:listed.filter(a=>ref.rows.has(a.symbol)).map(a=>({...ref.rows.get(a.symbol),exchange:a.exchange}))};referenceAt=now();
  }
  const symbols=reference.rows.map(r=>r.symbol).sort(),groups=[];for(let i=0;i<symbols.length;i+=100)groups.push(symbols.slice(i,i+100));
  const attempted=new Set(),completed=new Set(),failed=new Set(),snapshots={},partial=new Set();
  for(let k=0;k<groups.length;k+=2)await Promise.all(groups.slice(k,k+2).map(async group=>{
   const key=group.join(','),end=Math.floor(now()/60000)*60000,start=Math.max(session.pre,cursors.has(key)?cursors.get(key)-120000:end-95*60000);
   group.forEach(x=>attempted.add(x));let token=null;
   try{
    for(let page=0;page<3;page++){
     const url=new URL('https://data.alpaca.markets/v2/stocks/bars');url.search=new URLSearchParams({symbols:key,timeframe:'1Min',feed:s.feed,adjustment:'raw',sort:'asc',limit:'10000',start:new Date(start).toISOString(),end:new Date(end).toISOString(),...(token?{page_token:token}:{})});
     const data=await request(url.href);
     for(const [symbol,bars]of Object.entries(data.bars||{})){if(!group.includes(symbol))continue;const map=history.get(symbol)||new Map();for(const b of bars)if(Date.parse(b.t)+60000<=end)map.set(b.t,b);for(const [t]of map)if(Date.parse(t)<end-100*60000)map.delete(t);history.set(symbol,map);}
     token=data.next_page_token;if(!token)break;
    }
    if(token)group.forEach(x=>partial.add(x));else{cursors.set(key,end);group.forEach(x=>completed.add(x));}
   }catch(e){if(e.message==='RATE_LIMITED')throw e;group.forEach(x=>failed.add(x));}
  }));
  // Read quotes after historical bars so an old quote never appears fresh merely because the scan started recently.
  for(let k=0;k<groups.length;k+=2)await Promise.all(groups.slice(k,k+2).map(async group=>{try{Object.assign(snapshots,await request('https://data.alpaca.markets/v2/stocks/snapshots?feed='+s.feed+'&symbols='+encodeURIComponent(group.join(','))));}catch(e){if(e.message==='RATE_LIMITED')throw e;group.forEach(x=>failed.add(x));}}));
  const checked=now(),histories={};let contiguous=0;
  const rows=reference.rows.map(m=>{const bars=[...(history.get(m.symbol)?.values()||[])].filter(b=>Date.parse(b.t)>=checked-100*60000).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));histories[m.symbol]=bars;
   const signal=completed.has(m.symbol)&&!failed.has(m.symbol)?analyzeBars(bars.filter(b=>Date.parse(b.t)>=checked-90*60000),checked):null;if(signal?.ready)contiguous++;
   const row=rankSnapshot(m.symbol,snapshots[m.symbol],m,checked);return {...row,signal:signal?{...signal,coverageVersion:'breadth-1',provenance:'BROAD_UNIVERSE_SWEEP'}:null,news:[]};});
  let newsError=false;const newsSymbols=rows.filter(r=>r.signal?.expansion).map(r=>r.symbol).slice(0,50);
  if(newsSymbols.length&&(!newsAt||now()-newsAt>=120000)){try{const data=await request('https://data.alpaca.markets/v1beta1/news?limit=50&sort=desc&include_content=false&start='+encodeURIComponent(new Date(now()-86400000).toISOString())+'&symbols='+encodeURIComponent(newsSymbols.join(',')));newsCache=data.news||[];newsAt=now();}catch{newsError=true;}}
  for(const row of rows)row.news=newsCache.filter(n=>n.symbols?.includes(row.symbol)&&Date.parse(n.created_at)<=checked).slice(0,3).map(n=>({headline:n.headline,url:n.url,source:n.source,published_at:n.created_at,first_seen_at:new Date(newsAt).toISOString(),category:'PROVIDER_LINKED'}));
  const completedAt=now();for(const row of rows){row.age_ms=completedAt-Date.parse(row.price_at);row.status=row.age_ms>=0&&row.age_ms<=15000?'FRESH':'STALE';const age=completedAt-Date.parse(row.quote_at);row.quote_fresh=age>=0&&age<=10000;}
  const coverage={version:'breadth-1',news_error:newsError,nasdaq_assets:reference.listed,eligible_small_caps:symbols.length,attempted_symbols:attempted.size,completed_symbols:completed.size,failed_symbols:failed.size,partial_symbols:partial.size,with_bars:rows.filter(r=>histories[r.symbol].length).length,detector_ready:contiguous,with_prices:rows.filter(r=>r.price>0).length,fresh_prices:rows.filter(r=>r.status==='FRESH').length,fresh_quotes:rows.filter(r=>r.quote_fresh).length,metadata_at:reference.at,scan_duration_ms:completedAt-started,feed:s.feed,scope:'All current eligible reference symbols; no top-N cap',afterhours_enabled:false};
  return {scan:{server_time:new Date(completedAt).toISOString(),scan_started_at:new Date(started).toISOString(),feed:s.feed,coverage,rows},histories};
 }};
}
export function createSweepWorker({sweep,observe,drain=async()=>{},enabled=true,now=Date.now,intervalMs=60000}={}){
 let timer=null,inflight=null,stopped=false,lastAttempt=0;
 const status={enabled,busy:false,last_started_at:null,last_completed_at:null,last_error:null,phase:null,coverage:null,next_at:null,interval_ms:intervalMs,continuous_host_verified:false};
 async function refresh(){
  if(stopped)return;if(inflight)return inflight;if(lastAttempt&&now()-lastAttempt<(status.last_error==='RATE_LIMITED'?120000:intervalMs))return;
  lastAttempt=now();status.busy=true;status.last_started_at=new Date(now()).toISOString();
  inflight=(async()=>{try{const value=await sweep.scan();status.phase=value.phase||'MONITORING';if(!value.closed){await observe(value);await drain();status.coverage=value.scan.coverage;status.last_completed_at=value.scan.server_time;}status.last_error=null;}catch(e){status.last_error=['RATE_LIMITED','FEED_NOT_ENTITLED','CREDENTIALS_NOT_CONFIGURED','CURRENT_UNIVERSE_REQUIRED'].includes(e.message)?e.message:'SWEEP_FAILED';}finally{status.busy=false;inflight=null;}})();return inflight;
 }
 async function cycle(){await refresh();if(!stopped&&enabled){const delay=status.last_error==='RATE_LIMITED'?120000:intervalMs;status.next_at=new Date(now()+delay).toISOString();timer=setTimeout(cycle,delay);timer.unref?.();}}
 return {refresh,status:()=>({...status}),start(){if(enabled&&!stopped&&!timer)void cycle();},async close(){stopped=true;clearTimeout(timer);await inflight;}};
}
