import {settings,REFERENCE_URL,normalizeReference} from './market.mjs';
export const RULES=Object.freeze({version:'discovery-1',minimumBars:13,volumeRatio:2,return3m:0.7,minDollars3m:25000,minTrades3m:30,maxSingleMinuteShare:0.7,maxSpread:0.8,maxEarlyDayGain:25,maxEarly3mGain:8,cooldown:1800000});
const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const sessionDate=t=>Number.isFinite(new Date(t).getTime())?dateFormatter.format(new Date(t)):null;
const positive=x=>Number.isFinite(x)&&x>0;
const pct=(a,b)=>positive(a)&&positive(b)?(a/b-1)*100:null;
export function analyzeBars(input,now){
 const bars=[...new Map(input.filter(b=>Date.parse(b.t)+60000<=now&&positive(b.c)&&positive(b.h)&&positive(b.l)&&b.v>=0).map(b=>[b.t,b])).values()].sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
 const last=bars.at(-1);if(!last)return null;
 const recent=bars.slice(-3),baseline=bars.slice(-23,-3);
 const contiguous=recent.length===3&&Date.parse(recent[2].t)-Date.parse(recent[0].t)===120000;
 const current=now-Date.parse(last.t)<=150000;
 const average=baseline.reduce((s,b)=>s+b.v,0)/baseline.length;
 const ratio=average>0?recent.reduce((s,b)=>s+b.v,0)/3/average:null;
 const dollars=recent.reduce((s,b)=>s+b.c*b.v,0),move=pct(last.c,recent[0]?.o);
 const priorHigh=Math.max(...bars.slice(-6,-1).map(b=>b.h));
 const stop=Math.min(...bars.slice(-5).map(b=>b.l))*0.999;
 const trigger=priorHigh*1.001;
 const risk=pct(trigger,stop);
 const ready=baseline.length>=10&&contiguous&&current;
 const trades=recent.reduce((s,b)=>s+(b.n??0),0);
 const totalVolume=bars.reduce((s,b)=>s+b.v,0);
 const vwap=totalVolume>0?bars.reduce((s,b)=>s+(b.vw??b.c)*b.v,0)/totalVolume:null;
 const concentration=Math.max(...recent.map(b=>b.v))/recent.reduce((s,b)=>s+b.v,0);
 const quality=trades>=RULES.minTrades3m&&concentration<=RULES.maxSingleMinuteShare&&last.c>=vwap;
 const expansion=ready&&quality&&ratio>=RULES.volumeRatio&&move>=RULES.return3m&&dollars>=RULES.minDollars3m;
 return {bars:bars.length,ready,trades_3m:trades,vwap_window:vwap,volume_concentration:concentration,quality,volume_ratio:ratio,return_3m:move,dollars_3m:dollars,breakout:last.c>priorHigh,expansion,bar_at:last.t,trigger,stop,plan_valid:risk>=0.5&&risk<=6,targets:[trigger+(trigger-stop),trigger+2*(trigger-stop)]};
}
export function rankSnapshot(symbol,snapshot,metadata,now){
 const t=snapshot?.latestTrade,d=snapshot?.dailyBar,p=snapshot?.prevDailyBar,q=snapshot?.latestQuote;
 const price=positive(t?.p)?t.p:null,age=now-Date.parse(t?.t),qa=now-Date.parse(q?.t);
 const spread=positive(q?.ap)&&positive(q?.bp)&&q.ap>=q.bp?(q.ap-q.bp)/q.ap*100:null;
 return {symbol,...metadata,price,price_at:t?.t??null,age_ms:Number.isFinite(age)?age:null,previous_close:p?.c??null,day_change:pct(price,p?.c),day_volume:d?.v??null,day_dollars:positive(d?.c)?d.c*d.v:null,day_high:d?.h??null,minute_change:pct(snapshot?.minuteBar?.c,snapshot?.minuteBar?.o),minute_dollars:(snapshot?.minuteBar?.v??0)*(snapshot?.minuteBar?.c??0),spread_pct:spread,quote_at:q?.t??null,quote_fresh:qa>=0&&qa<=10000,bid:q?.bp??null,ask:q?.ap??null,status:age>=0&&age<=15000?'FRESH':'STALE'};
}
export function createScanner({env=process.env,fetcher=fetch,now=Date.now}={}){
 let cached=null,loading=null,universe=null,universeAt=0,newsCache=null,newsAt=0,closesAt=0,closes=new Map();const ledger=[],lastSignals=new Map();
 async function request(url,auth=true){const s=settings(env);if(auth&&!s.configured)throw Error('RUNTIME_CREDENTIALS_NOT_CONFIGURED');const r=await fetcher(url,{headers:auth?{'APCA-API-KEY-ID':s.key,'APCA-API-SECRET-KEY':s.secret}:{},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(r.status===401?'PROVIDER_AUTH_FAILED':r.status===403?'FEED_NOT_ENTITLED':r.status===429?'RATE_LIMITED':'PROVIDER_UNAVAILABLE');return r.json();}
 async function scan(){
  const started=now(),s=settings(env);
  if(!universe||now()-universeAt>300000){
   const [assets,raw]=await Promise.all([request('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity&exchange=NASDAQ'),request(REFERENCE_URL,false)]);
   const ref=normalizeReference(raw,now());if(!Array.isArray(assets))throw Error('INVALID_PROVIDER_RESPONSE');
   const listed=assets.filter(a=>a.exchange==='NASDAQ'&&a.status==='active'&&/^[A-Z][A-Z0-9.-]{0,9}$/.test(a.symbol));
   universe={rows:listed.filter(a=>ref.rows.has(a.symbol)).map(a=>({...ref.rows.get(a.symbol),exchange:a.exchange})),listed:listed.length,metadata_at:ref.updated_at};universeAt=now();
  }
  const snapshots={},symbols=universe.rows.map(r=>r.symbol);let failed=0;
  const batches=[];for(let i=0;i<symbols.length;i+=150)batches.push(symbols.slice(i,i+150));
  for(let i=0;i<batches.length;i+=2)await Promise.all(batches.slice(i,i+2).map(async batch=>{try{Object.assign(snapshots,await request('https://data.alpaca.markets/v2/stocks/snapshots?feed='+s.feed+'&symbols='+encodeURIComponent(batch.join(','))));}catch{failed+=batch.length;}}));
  if(symbols.length&&!Object.keys(snapshots).length)throw Error('PROVIDER_UNAVAILABLE');
  if(!closes.size||now()-closesAt>300000){
   const next=new Map(),day=sessionDate(now());
   for(let i=0;i<batches.length;i+=3)await Promise.all(batches.slice(i,i+3).map(async batch=>{try{
    const daily=await request('https://data.alpaca.markets/v2/stocks/bars?timeframe=1Day&adjustment=split&feed='+s.feed+'&limit=10000&symbols='+encodeURIComponent(batch.join(','))+'&start='+encodeURIComponent(new Date(now()-7*86400000).toISOString())+'&end='+day+'T00:00:00Z');
    for(const [symbol,bars]of Object.entries(daily.bars??{})){const prior=bars.filter(b=>sessionDate(b.t)<day&&positive(b.c)).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t)).at(-1);if(prior)next.set(symbol,prior.c);}
   }catch{/* Unverified daily gains remain blank, never raw split jumps. */}}));closes=next;closesAt=now();
  }
  const rows=universe.rows.map(m=>rankSnapshot(m.symbol,snapshots[m.symbol],m,now())).filter(r=>positive(r.price));
  for(const row of rows){row.previous_close=sessionDate(row.price_at)===sessionDate(now())?(closes.get(row.symbol)??null):null;row.day_change=pct(row.price,row.previous_close);row.change_basis=row.previous_close?'SPLIT_ADJUSTED_PREVIOUS_CLOSE':'UNVERIFIED';}

  // Candidate shortlist uses only current observations; includes fresh dollar-volume leaders as well as gainers.
  const gainers=[...rows].sort((a,b)=>(b.day_change??-Infinity)-(a.day_change??-Infinity));
  const active=rows.filter(r=>r.status==='FRESH').sort((a,b)=>(b.day_dollars??0)-(a.day_dollars??0));
  const early=rows.filter(r=>r.status==='FRESH'&&r.minute_dollars>=2000).sort((a,b)=>(b.minute_change??0)-(a.minute_change??0));
  const shortlist=[...new Set([...early.slice(0,40).map(r=>r.symbol),...gainers.slice(0,40).map(r=>r.symbol),...active.slice(0,40).map(r=>r.symbol)])];
  const histories={};let historyError=false;
  if(shortlist.length){try{
   const base='https://data.alpaca.markets/v2/stocks/bars?timeframe=1Min&feed='+s.feed+'&adjustment=raw&sort=asc&limit=10000&symbols='+encodeURIComponent(shortlist.join(','))+'&start='+encodeURIComponent(new Date(now()-90*60000).toISOString())+'&end='+encodeURIComponent(new Date(now()-60000).toISOString());
   let token=null;for(let page=0;page<3;page++){const data=await request(base+(token?'&page_token='+encodeURIComponent(token):''));for(const [symbol,bars]of Object.entries(data.bars??{}))(histories[symbol]??=[]).push(...bars);token=data.next_page_token;if(!token)break;}if(token)historyError=true;
  }catch{historyError=true;}}
  let newsError=false;
  if(!newsCache||now()-newsAt>120000){try{
   const response=await request('https://data.alpaca.markets/v1beta1/news?limit=50&sort=desc&include_content=false&start='+encodeURIComponent(new Date(now()-86400000).toISOString())+'&symbols='+encodeURIComponent(shortlist.join(',')));
   newsCache=response.news??[];newsAt=now();
  }catch{newsError=true;}}
  const checked=now();
  for(const row of rows){
   row.age_ms=checked-Date.parse(row.price_at);row.status=row.age_ms>=0&&row.age_ms<=15000?'FRESH':'STALE';
   row.quote_fresh=checked-Date.parse(row.quote_at)>=0&&checked-Date.parse(row.quote_at)<=10000;
   const signal=analyzeBars(histories[row.symbol]??[],checked);row.signal=signal;
   row.news=(newsCache??[]).filter(n=>n.symbols?.includes(row.symbol)&&Date.parse(n.created_at)<=checked).slice(0,3).map(n=>({headline:n.headline,url:n.url,source:n.source,published_at:n.created_at,first_seen_at:new Date(newsAt).toISOString(),category:classifyHeadline(n.headline)}));
   row.catalyst_status=newsError?'UNAVAILABLE':row.news.length?'RELATED_NEWS':'NO_NEWS_IN_RESULTS';
   row.fundamentals_status='NOT_CONNECTED';row.short_interest_status=row.short_float_pct!==null?'REFERENCE_ONLY_AS_OF_UNKNOWN':'NOT_AVAILABLE';
   row.score=signal?.ready?Math.round(Math.min(40,Math.max(0,signal.return_3m)*10)+Math.min(35,(signal.volume_ratio??0)*7)+Math.min(15,signal.dollars_3m/10000)+(signal.breakout?10:0)):0;
   row.extended=(row.day_change??0)>RULES.maxEarlyDayGain||(signal?.return_3m??0)>RULES.maxEarly3mGain;
   row.stage=row.extended?'EXTENDED':!signal?.ready?'WARMUP':signal.expansion?(signal.breakout?'BREAKOUT':'EXPANSION'):'WATCH';
   row.actionable=Boolean(!row.extended&&signal?.expansion&&signal.plan_valid&&row.status==='FRESH'&&row.quote_fresh&&row.spread_pct!==null&&row.spread_pct<=RULES.maxSpread&&s.feed!=='delayed_sip'&&row.price<=signal.trigger*1.01&&row.price>signal.stop);
   row.plan=row.actionable?{entry:Math.max(row.ask,signal.trigger),stop:signal.stop,targets:[],kind:'CONDITIONAL'}:null;
   if(row.plan){const risk=row.plan.entry-row.plan.stop;row.plan.targets=[row.plan.entry+risk,row.plan.entry+2*risk];}
   if(signal?.expansion&&row.status==='FRESH'&&s.feed!=='delayed_sip'&&checked-(lastSignals.get(row.symbol)??0)>=RULES.cooldown){lastSignals.set(row.symbol,checked);ledger.unshift({symbol:row.symbol,detected_at:new Date(checked).toISOString(),price:row.price,price_at:row.price_at,stage:row.stage,score:row.score,plan:row.plan});}
  }
  ledger.splice(200);
  for(const alert of ledger){const row=rows.find(r=>r.symbol===alert.symbol);if(row?.price&&row.price_at&&Date.parse(row.price_at)>=Date.parse(alert.detected_at)){alert.last_price=row.price;alert.last_price_at=row.price_at;alert.max_observed_price=Math.max(alert.max_observed_price??alert.price,row.price);alert.min_observed_price=Math.min(alert.min_observed_price??alert.price,row.price);alert.observed_return_pct=pct(row.price,alert.price);alert.max_observed_return_pct=pct(alert.max_observed_price,alert.price);alert.min_observed_return_pct=pct(alert.min_observed_price,alert.price);}}
  cached={schema_version:1,status:failed||historyError?'PARTIAL':'OK',server_time:new Date(checked).toISOString(),scan_started_at:new Date(started).toISOString(),refresh_ms:30000,feed:s.feed,coverage:{nasdaq_assets:universe.listed,eligible_small_caps:symbols.length,with_prices:rows.length,fresh_prices:rows.filter(r=>r.status==='FRESH').length,failed_symbols:failed,detailed_symbols:shortlist.length,metadata_at:universe.metadata_at,scope:'NASDAQ equities below $1B present in reference; excludes missing metadata and funds',history_error:historyError,news_error:newsError,news_at:newsAt?new Date(newsAt).toISOString():null},rules:RULES,rows:[...new Map([...rows.sort((a,b)=>Number(a.extended)-Number(b.extended)||b.score-a.score||(b.day_change??-Infinity)-(a.day_change??-Infinity)).slice(0,150),...gainers.slice(0,50)].map(r=>[r.symbol,r])).values()],gainers:gainers.slice(0,50).map(r=>r.symbol),alerts:ledger,storage:'PROCESS_MEMORY',strategy_validation:'UNPROVEN',coverage_note:s.feed==='iex'?'IEX single exchange; not the entire US market':'Consolidated feed'};return cached;
 }
 return {async get(){if(cached&&now()-Date.parse(cached.server_time)<30000)return cached;if(!loading)loading=scan().finally(()=>loading=null);return loading;}};
}

export function classifyHeadline(text=''){
 const t=text.toLowerCase();
 if(/offering|reverse split|bankrupt|delist/.test(t))return 'FINANCING_OR_LISTING_RISK';
 if(/phase [123i]|clinical|trial|fda|pdufa/.test(t))return 'CLINICAL_OR_REGULATORY';
 if(/earnings|revenue|quarter|guidance/.test(t))return 'EARNINGS';
 if(/contract|agreement|acquisition|merger|partnership/.test(t))return 'DEAL';
 return 'OTHER';
}
