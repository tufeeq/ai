import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,hash} from './store.mjs';
import {configuration} from './config.mjs';
import {createCalendar,nyParts} from './calendar.mjs';
import {normalizeBar} from './data.mjs';
import {createEngine} from './engine.mjs';
import {entryProposal} from './proposals.mjs';
import {learningPool} from './learning.mjs';
import {settings} from '../../quote-service/src/market.mjs';
import {restoreDecisionSnapshot} from './recovery.mjs';
export function createElite({env=process.env,fetcher=fetch,now=Date.now}={}) {
 const path=env.TAG_ELITE_DB||`${tmpdir()}/tag-elite.sqlite`;if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const store=openStore(path),config=configuration({...JSON.parse(env.TAG_ELITE_CONFIG_JSON||'{}'),mode:'SHADOW'}),runId='elite-shadow-v1-'+hash(config).slice(0,12),metadata=[],news=[],livePrices=new Map(),liveQuotes=new Map();
 store.run(runId,config);let recoveredDecisions=0;
 const recoveryFile=new URL('../recovery/2026-09-25-pre-fix.json',import.meta.url);
 if(existsSync(recoveryFile)&&env.TAG_ELITE_SKIP_RECOVERY!=='1')recoveredDecisions=restoreDecisionSnapshot(store,runId,config,JSON.parse(readFileSync(recoveryFile,'utf8')));
 const status={mode:'SHADOW',version:config.version,release:env.RENDER_GIT_COMMIT||'LOCAL',configHash:hash(config),background:env.TAGIT_BACKGROUND==='1',durabilityVerified:false,
   storage:path===':memory:'?'MEMORY':path.startsWith(tmpdir()+'/')?'EPHEMERAL_SQLITE':'PERSISTENT_PATH_UNVERIFIED',
   lastObservedAt:null,lastError:null,busy:false,processedBars:0,duplicateBars:0,invalidBars:0,computeMs:null,calendarSource:'PROVIDER',approvedForLive:false,recoveredDecisions};
 let engine=null,calendar=null,calendarDay=null,chain=Promise.resolve(),lastScan=null,followupAt=0,stopped=false;
 let learning=null;
 const newsSeen=new Set();
 for(const o of store.snapshots(runId)){
   if(o.eligibility?.record)metadata.push(o.eligibility.record);
   for(const item of o.news||[])if(!newsSeen.has(item.id)){newsSeen.add(item.id);news.push(item);}
 }
 async function provider(url){const s=settings(env);if(!s.configured)throw Error('CREDENTIALS_NOT_CONFIGURED');
  const r=await fetcher(url,{headers:{'APCA-API-KEY-ID':s.key,'APCA-API-SECRET-KEY':s.secret},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error(r.status===429?'RATE_LIMITED':r.status===403?'FEED_NOT_ENTITLED':'PROVIDER_UNAVAILABLE');return r.json();
 }
 async function calendarFor(day){if(calendarDay===day)return;
  const rows=await provider(`https://paper-api.alpaca.markets/v2/calendar?start=${day}&end=${day}`);
  if(!Array.isArray(rows))throw Error('CALENDAR_UNAVAILABLE');
  calendar=createCalendar(rows,{source:'Alpaca exchange calendar',start:day,end:day});calendarDay=day;
  engine=createEngine({store,calendar,config,runId,metadata,news});
 }
 async function consume({scan,histories}) {
  if(stopped||lastScan&&Date.parse(scan.server_time)<=Date.parse(lastScan))return;status.busy=true;status.lastError=null;const started=now();
  try{
   if(scan.coverage?.version==='breadth-1')learning=learningPool(scan);
   const day=nyParts(scan.server_time).date;await calendarFor(day);if(!calendar.session(day))return;
   const receivedAt=new Date(now()).toISOString(),rows=new Map(scan.rows.map(r=>[r.symbol,r]));
   for(const row of scan.rows){
    if(row.price>0&&row.price_at)livePrices.set(row.symbol,{price:row.price,at:row.price_at,feed:scan.feed,received_at:scan.server_time});
    if(row.bid>0&&row.ask>=row.bid&&row.quote_at){const quote={bid:row.bid,ask:row.ask,at:row.quote_at,received_at:scan.server_time};liveQuotes.set(row.symbol,quote);store.input(runId,{kind:'QUOTE',symbol:row.symbol,event_at:quote.at,received_at:quote.received_at,quote});}
    const record={symbol:row.symbol,exchange:row.exchange||'NASDAQ',market_cap:row.market_cap,valid_from:row.metadata_at,received_at:scan.server_time,source:'Finviz reference via NEXT scan',sharia:{status:'UNKNOWN',source:null}};
    if(record.valid_from&&Number.isFinite(record.market_cap)){metadata.push(record);store.input(runId,{kind:'METADATA',symbol:row.symbol,event_at:record.valid_from,received_at:scan.server_time,record});}
    for(const n of row.news||[]){const id=hash([row.symbol,n.url,n.headline,n.published_at]);if(newsSeen.has(id))continue;newsSeen.add(id);
      const item={id,version:id,headline:n.headline,symbols:[row.symbol],published_at:n.published_at,received_at:scan.server_time,source:n.source,url:n.url,category:n.category,supportingText:n.headline};
      news.push(item);store.input(runId,{kind:'NEWS',symbol:row.symbol,event_at:item.published_at,received_at:item.received_at,item});}
   }
   // Follow already discovered symbols even after they leave the legacy shortlist. This request does not alter legacy decisions.
   const tracked=engine.snapshots().filter(o=>o.session===day).map(o=>o.symbol),missing=tracked.filter(s=>!histories[s]?.some(b=>Date.parse(b.t)>=now()-120000));
   const combined={...histories};
   if(missing.length&&now()-followupAt>=60000){followupAt=now();
     for(let i=0;i<missing.length;i+=50){const symbols=missing.slice(i,i+50),feed=settings(env).feed;
       let token=null;for(let page=0;page<3;page++){
         const url=new URL('https://data.alpaca.markets/v2/stocks/bars');url.search=new URLSearchParams({symbols:symbols.join(','),timeframe:'1Min',feed,adjustment:'raw',sort:'asc',limit:'10000',start:new Date(now()-90*60000).toISOString(),end:new Date(now()-60000).toISOString(),...(token?{page_token:token}:{})});
         const data=await provider(url.href);for(const [symbol,bars]of Object.entries(data.bars||{}))(combined[symbol]??=[]).push(...bars);token=data.next_page_token;if(!token)break;if(page===2)status.lastError='FOLLOWUP_HISTORY_PARTIAL';
       }
     }
   }
   let observedSymbols=0;
   for(const [symbol,raw]of Object.entries(combined)){
     if(++observedSymbols%10===0)await new Promise(resolve=>setImmediate(resolve));
     const sorted=[...raw].sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));const row=rows.get(symbol);
     for(let i=0;i<sorted.length;i++){
       try{const b=normalizeBar(sorted[i],{symbol,feed:scan.feed,receivedAt:scan.coverage?.version==='breadth-1'?new Date(now()).toISOString():receivedAt});
         if(row?.quote_fresh&&i===sorted.length-1)b.quote={bid:row.bid,ask:row.ask,t:row.quote_at};
         // Latest observed bar receives the original detector finding, never a retroactive discovery in a fetched history.
         const detect=i===sorted.length-1&&row?.signal?.expansion?{...row.signal,liveShortlistReproduced:row.signal.provenance!=='BROAD_UNIVERSE_SWEEP'}: {expansion:false};
         engine.process(b,{detect});status.processedBars++;
       }catch(e){if(['INVALID_BAR_TIME','INVALID_OHLCV','INCOMPLETE_OR_FUTURE_BAR'].includes(e.message))status.invalidBars++;else throw e;}
     }
   }
   if(metadata.length>10000)metadata.splice(0,metadata.length-10000);if(news.length>5000)news.splice(0,news.length-5000);
   for(const o of store.snapshots(runId)){const events=store.timeline(o.id),proposal=entryProposal(o,events,liveQuotes.get(o.symbol),now());if(proposal.status==='PROPOSED'&&!events.some(e=>e.kind==='ENTRY_PROPOSAL'&&e.proposal?.decidedAt===proposal.decidedAt&&e.proposal?.version===proposal.version))store.event(o,{kind:'ENTRY_PROPOSAL',at:new Date(now()).toISOString(),proposal,reason:'Research proposal only; no execution or order sent'});}
   if(scan.coverage)store.input(runId,{kind:'SCAN_COVERAGE',event_at:scan.server_time,received_at:new Date(now()).toISOString(),coverage:scan.coverage});
   lastScan=scan.server_time;status.lastObservedAt=scan.server_time;store.job('live-observer','OBSERVATION',scan.server_time,'IDLE');
  }catch(e){status.lastError=['RATE_LIMITED','FEED_NOT_ENTITLED','CALENDAR_UNAVAILABLE','CREDENTIALS_NOT_CONFIGURED','PROVIDER_UNAVAILABLE'].includes(e.message)?e.message:'OBSERVATION_FAILED';store.job('live-observer','OBSERVATION',lastScan,'FAILED',status.lastError);}
  finally{status.busy=false;status.computeMs=now()-started;}
 }
 return {observe(e){if(stopped)return chain;chain=chain.then(()=>consume(e)).catch(()=>{status.lastError='STORAGE_FAILED';});return chain;},
  status:()=>({...status,...store.summary(),storage:status.storage}),
  snapshot(){const rows=store.snapshots(runId);return {name:'TAG elite',status:this.status(),mode:'SHADOW',serverTime:new Date(now()).toISOString(),learning,opportunities:rows.map(o=>({...o,bars:store.series(runId,o),lastTrade:livePrices.get(o.symbol)??null,timeline:store.timeline(o.id),proposal:entryProposal(o,store.timeline(o.id),liveQuotes.get(o.symbol),now())})),rulesPromoted:false};},
  timeline:id=>store.timeline(id),async close(){stopped=true;await chain;store.close();},drain:()=>chain};
}
