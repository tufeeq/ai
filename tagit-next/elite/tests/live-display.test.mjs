import test from 'node:test';
import assert from 'node:assert/strict';
import {priceEvidence,reviewEvidence,visibleBars,newsEvidence,safeNewsUrl} from '../web/presentation.mjs';
import {createElite} from '../core/live.mjs';
import {openStore,hash} from '../core/store.mjs';
import {configuration} from '../core/config.mjs';
import {restoreDecisionSnapshot} from '../core/recovery.mjs';
import {createEngine} from '../core/engine.mjs';
import {createCalendar} from '../core/calendar.mjs';
import {normalizeBar} from '../core/data.mjs';
const clock=Date.parse('2026-09-04T14:00:20Z');
const sample={symbol:'TEST',current_price:1.23,price_at:'2026-09-04T13:58:00Z',first_price:1.35,state:'DETECTED',quality:{contiguousBars:2},lastTrade:{price:1.27,at:'2026-09-04T14:00:10Z',received_at:'2026-09-04T14:00:12Z'}};
test('live display distinguishes latest trade from bar close and shows fall since discovery',()=>{
 const p=priceEvidence(sample,clock,true);assert.equal(p.price,1.27);assert.equal(p.kind,'TRADE');assert.equal(p.ageMs,10000);assert.ok(p.change<0);
 assert.equal(priceEvidence(sample,clock,false).price,1.23);
 assert.equal(priceEvidence({...sample,lastTrade:{...sample.lastTrade,received_at:'2026-09-04T14:01:00Z'}},clock).price,1.23);
 assert.equal(priceEvidence({...sample,lastTrade:{...sample.lastTrade,at:'2026-09-04T13:55:00Z'}},clock).price,1.23);
});
test('an old DETECTED state is explicitly suspended when gaps or staleness prevent confirmation',()=>{
 const r=reviewEvidence(sample,clock);assert.equal(r.paused,true);assert.ok(r.reasons.includes('GAPS'));assert.equal(r.belowFirst,true);assert.equal(sample.state,'DETECTED');
 assert.ok(reviewEvidence({...sample,quality:{contiguousBars:8}},clock+120000).reasons.includes('STALE'));
});
test('chart cutoff respects actual receipt as well as completed candle time',()=>{
 const o={bars:[[clock-120000,1,1,1,1,10,clock+1000],[clock-240000,1,1,1,1,10,clock-100000]]};
 assert.equal(visibleBars(o,clock).length,1);assert.equal(visibleBars(o,clock+1000).length,2);
 assert.equal(newsEvidence({headline:"12 Health Care Stocks Moving In Friday's Pre-Market Session"}),'MARKET_ROUNDUP');
 assert.equal(safeNewsUrl('javascript:alert(1)'),null);assert.equal(safeNewsUrl('https://example.com/news'),'https://example.com/news');
});
test('actual observer API exposes real received OHLC bars for live charts',async()=>{
 const rows=Array.from({length:29},(_,i)=>({t:new Date(Date.parse('2026-09-04T13:30:00Z')+i*60000).toISOString(),o:10,h:10.1,l:9.9,c:10,v:1000,n:10}));
 const elite=createElite({env:{TAG_ELITE_DB:':memory:',TAG_ELITE_SKIP_RECOVERY:'1',ALPACA_API_KEY_ID:'fixture',ALPACA_API_SECRET_KEY:'fixture'},now:()=>clock,fetcher:async()=>({ok:true,json:async()=>[{date:'2026-09-04',open:'09:30',close:'16:00'}]})});
 elite.observe({scan:{server_time:new Date(clock).toISOString(),feed:'iex',rows:[{symbol:'TEST',signal:{expansion:true},news:[]}]},histories:{TEST:rows}});await elite.drain();
 const snap=elite.snapshot();assert.equal(snap.status.lastError,null);assert.equal(snap.opportunities.length,1);assert.equal(snap.opportunities[0].bars.length,29);assert.equal(snap.opportunities[0].bars[0][6],clock);assert.equal(snap.opportunities[0].first_price,10);assert.equal(snap.opportunities[0].entryReady,false);
 elite.observe({scan:{server_time:new Date(clock).toISOString(),feed:'iex',rows:[]},histories:{TEST:rows}});await elite.drain();assert.equal(elite.snapshot().opportunities[0].timeline.filter(e=>e.kind==='DISCOVERY').length,1);await elite.close();
});
test('deployment recovery preserves first detection and does not replay old bars as new decisions',()=>{
 const cfg=configuration(),runId='elite-shadow-v1-'+hash(cfg).slice(0,12),store=openStore();store.run(runId,cfg);
 const firstAt='2026-09-04T13:55:00Z',id=hash([runId,'TEST','iex','2026-09-04']).slice(0,24);
 const o={id,symbol:'TEST',feed:'iex',session:'2026-09-04',first_at:firstAt,first_price:1.35,price_at:'2026-09-04T13:58:00Z',methodology:cfg.version,current_price:1.23,state:'DETECTED',timeline:[{kind:'DISCOVERY',at:firstAt,price:1.35}]};
 const snapshot={serverTime:new Date(clock).toISOString(),status:{configHash:hash(cfg)},opportunities:[o]};
 assert.equal(restoreDecisionSnapshot(store,runId,cfg,snapshot),1);assert.equal(restoreDecisionSnapshot(store,runId,cfg,snapshot),0);
 const engine=createEngine({store,config:cfg,runId,calendar:createCalendar([{date:'2026-09-04',open:'09:30',close:'16:00'}])});
 engine.process(normalizeBar({t:'2026-09-04T13:40:00Z',o:1,h:1,l:1,c:1,v:1},{symbol:'TEST',feed:'iex',receivedAt:new Date(clock).toISOString()}),{detect:{expansion:true}});
 assert.equal(engine.snapshots()[0].current_price,1.23);assert.equal(engine.snapshots()[0].first_price,1.35);assert.equal(engine.timeline(id).filter(e=>e.kind==='DISCOVERY').length,1);assert.equal(store.series(runId,o).length,1);store.close();
});
