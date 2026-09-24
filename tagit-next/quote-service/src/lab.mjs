import {settings} from './market.mjs';

// Read-only, fixed-destination research relay. Provider credentials never leave the server.
const routes={bars:['https://data.alpaca.markets/v2/stocks/bars',['symbols','timeframe','start','end','adjustment','feed','limit','sort','page_token']],quotes:['https://data.alpaca.markets/v2/stocks/quotes',['symbols','start','end','feed','limit','sort','page_token']],news:['https://data.alpaca.markets/v1beta1/news',['symbols','start','end','limit','sort','page_token','include_content']],calendar:['https://paper-api.alpaca.markets/v2/calendar',['start','end']],assets:['https://paper-api.alpaca.markets/v2/assets',['status','asset_class']]};
const fail=()=>{throw Error('INVALID_LAB_QUERY');};
export function providerURL(input,now=Date.now()){
 const kind=input.get('resource'),route=routes[kind];if(!route)fail();
 for(const key of input.keys())if(key!=='resource'&&!route[1].includes(key))fail();
 const url=new URL(route[0]);for(const key of route[1])if(input.has(key))url.searchParams.set(key,input.get(key));
 const p=url.searchParams;
 if(['bars','quotes','news'].includes(kind)){
  const syms=p.get('symbols')?.split(',');if(!syms?.length||syms.length>100||syms.some(s=>! /^[A-Z][A-Z0-9.-]{0,14}$/.test(s)))fail();
  for(const key of ['start','end'])if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(p.get(key)||'')||!Number.isFinite(Date.parse(p.get(key))))fail();
  const end=Math.min(Date.parse(p.get('end')),now-16*60000),start=Date.parse(p.get('start'));
  if(start>=end||end-start>800*86400000||start<Date.UTC(2016,0,1))fail();
  p.set('end',new Date(end).toISOString());
  const limit=Number(p.get('limit')||10000);if(!Number.isInteger(limit)||limit<1||limit>10000)fail();p.set('limit',String(limit));
  if(p.has('page_token')&&(p.get('page_token').length>2000||/[\r\n]/.test(p.get('page_token'))))fail();
  if(p.has('sort')&&!['asc','desc'].includes(p.get('sort')))fail();
  if(kind==='bars'){
   if(!['1Day','1Min'].includes(p.get('timeframe')))fail();
   if(p.get('timeframe')==='1Min'&&end-start>32*86400000)fail();
   if(!['raw','split'].includes(p.get('adjustment')||'raw'))fail();
  }
  if(kind!=='news'){if(p.has('feed')&&!['sip','iex'].includes(p.get('feed')))fail();p.set('feed',p.get('feed')||'sip');}
  else{p.set('include_content','false');p.set('limit',String(Math.min(limit,50)));}
 }else if(kind==='calendar'){
  for(const k of ['start','end'])if(!/^\d{4}-\d{2}-\d{2}$/.test(p.get(k)||'')||!Number.isFinite(Date.parse(p.get(k))))fail();
  if(Date.parse(p.get('start'))>Date.parse(p.get('end'))||Date.parse(p.get('end'))-Date.parse(p.get('start'))>800*86400000)fail();
 }else{if(!['active','inactive'].includes(p.get('status')))fail();p.set('asset_class','us_equity');}
 return url;
}
export function createLabService({env=process.env,fetcher=fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();let window=0,count=0;
 async function data(input){
  const url=providerURL(input,now()),s=settings(env);if(!s.configured)throw Error('RUNTIME_CREDENTIALS_NOT_CONFIGURED');
  const key=url.href,cached=cache.get(key);if(cached&&now()-cached.at<300000)return cached.value;
  if(!pending.has(key)){
   if(now()-window>=60000){window=now();count=0;}if(count>=40||pending.size>=3)throw Error('RATE_LIMITED');count++;
   pending.set(key,(async()=>{
    let r;try{r=await fetcher(url.href,{headers:{'APCA-API-KEY-ID':s.key,'APCA-API-SECRET-KEY':s.secret},signal:AbortSignal.timeout(25000)});}catch{throw Error('PROVIDER_UNAVAILABLE');}
    if(!r.ok)throw Error(r.status===401?'PROVIDER_AUTH_FAILED':r.status===403?'FEED_NOT_ENTITLED':r.status===429?'RATE_LIMITED':'PROVIDER_UNAVAILABLE');
    let value;try{value=await r.json();}catch{throw Error('INVALID_PROVIDER_RESPONSE');}
    if(!value||typeof value!=='object')throw Error('INVALID_PROVIDER_RESPONSE');
    if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(key,{at:now(),value});return value;
   })().finally(()=>pending.delete(key)));
  }return pending.get(key);
 }
 async function connection(){
  const end=new Date(now()-86400000).toISOString(),start=new Date(now()-8*86400000).toISOString();
  try{
   const r=await data(new URLSearchParams({resource:'bars',symbols:'AAPL',timeframe:'1Day',start,end,feed:'sip',adjustment:'raw',limit:'10'}));
   const bars=r.bars?.AAPL||[];
   return {schema_version:1,status:bars.length?'CONNECTED':'NO_DATA',provider:'Alpaca',feed:'sip',coverage:'CONSOLIDATED_HISTORICAL',minimum_delay_minutes:16,checked_at:new Date(now()).toISOString(),sample_bars:bars.length,last_bar_at:bars.at(-1)?.t??null,approved_for_live:false};
  }catch(e){return {schema_version:1,status:e.message,provider:'Alpaca',feed:'sip',checked_at:new Date(now()).toISOString(),approved_for_live:false};}
 }
 return {data,connection};
}
