import test from 'node:test';import assert from 'node:assert/strict';
import {assess,sizePosition,recordObservation,outcome,restoreJournal} from '../opportunity.mjs';
const now=Date.parse('2026-09-16T15:00:00Z'),at=new Date(now).toISOString();
const row={price:2.02,price_at:at,quote_at:at,bid:2.019,ask:2.02,spread_pct:.05,day_change:5,extended:false,actionable:true,plan:{entry:2.02,stop:1.98,targets:[2.06,2.1]},signal:{ready:true,bar_at:new Date(now-60000).toISOString(),bars:20,return_3m:1,volume_ratio:3,dollars_3m:50000,trades_3m:100,volume_concentration:.5,vwap_window:2,plan_valid:true}};
const options={now,serverTime:at,feed:'iex'};
test('live plan requires all conditions including fresh quote and scan',()=>{assert.ok(assess(row,options).plan);assert.equal(assess(row,{...options,now:now+11000}).plan,null);assert.equal(assess(row,{...options,serverTime:new Date(now-91000).toISOString()}).plan,null);assert.equal(assess(row,{...options,connected:false}).plan,null);assert.equal(assess(row,{...options,feed:'delayed_sip'}).plan,null);});
test('thin volume, unknown spread, chasing, and invalid plan fail closed',()=>{for(const r of [{...row,spread_pct:null},{...row,price:3},{...row,plan:{entry:2,stop:3,targets:[4,5]}},{...row,signal:{...row.signal,trades_3m:3}},{...row,extended:true}])assert.equal(assess(r,options).plan,null);});
test('size uses both capital and chosen loss constraint',()=>{const r=sizePosition({entry:10,stop:9},25,100);assert.equal(r.shares,10);assert.equal(r.plannedRisk,10);assert.equal(sizePosition({entry:1,stop:2},10,100),null);assert.equal(sizePosition(row.plan,0,100),null);});
test('observations reject older quotes, duplicates, and prior-to-detection data',()=>{const e={started_at:at,start_price:2,points:[]};assert.equal(recordObservation(e,{price:1,price_at:new Date(now-1).toISOString()}),e);const a=recordObservation(e,{price:2.2,price_at:new Date(now+1000).toISOString()});assert.equal(recordObservation(a,{price:3,price_at:new Date(now+1000).toISOString()}),a);const b=recordObservation(a,{price:1.9,price_at:new Date(now+2000).toISOString()});const o=outcome(b);assert.ok(Math.abs(o.maximum-10)<1e-10);assert.ok(Math.abs(o.drawdown+5)<1e-10);assert.ok(Math.abs(o.retention+50)<1e-10);});
test('restore rejects malformed records without inventing prices',()=>{assert.deepEqual(restoreJournal({schema:1,events:[{symbol:'ABC',id:'a',start_price:null,started_at:at}]}),[]);assert.deepEqual(restoreJournal(null),[]);});
import {splitPriority,updatePressure,pressureSummary,shariaStatus} from '../opportunity.mjs';
test('priority requires eight checks, a current scan and a fresh trade',()=>{assert.equal(splitPriority([row],options).upper.length,1);assert.equal(splitPriority([row],{...options,now:now+16000}).upper.length,0);assert.equal(splitPriority([{...row,extended:true}],options).upper.length,0);});
test('pressure ignores duplicates, resets gaps and differentiates rising-volume price pressure',()=>{let s=updatePressure(null,{price:1,day_volume:10,price_at:at},at);for(let i=1;i<=3;i++){const t=new Date(now+i*30000).toISOString();s=updatePressure(s,{price:1+i*.1,day_volume:10+i*100,price_at:t},t);}assert.equal(pressureSummary(s,now+90000).status,'IN');assert.equal(updatePressure(s,{price:9,day_volume:999,price_at:at},at),s);const t=new Date(now+300000).toISOString();assert.equal(updatePressure(s,{price:2,day_volume:500,price_at:t},t).segments.length,0);assert.equal(pressureSummary(s,now+200000).status,'UNKNOWN');});
test('Sharia badges require a sourced dated methodology and valid review',()=>{assert.equal(shariaStatus(null,now).status,'UNKNOWN');const r={status:'COMPLIANT',source:'test-only provider',source_url:'https://example.com/review',methodology:'test-only',reviewed_at:at,valid_until:new Date(now+86400000).toISOString()};assert.equal(shariaStatus(r,now).status,'COMPLIANT');assert.equal(shariaStatus({...r,source_url:null},now).status,'UNKNOWN');assert.equal(shariaStatus(r,now+2*86400000).status,'UNKNOWN');});
import {mergeMarketRow,isExtended,marketDate} from '../opportunity.mjs';
test('eight checks cannot bypass thin liquidity, stale bars, or a delayed feed',()=>{
 for(const changes of [{dollars_3m:100},{trades_3m:2},{volume_concentration:.95},{bar_at:new Date(now-180000).toISOString()}])assert.equal(splitPriority([{...row,signal:{...row.signal,...changes}}],options).upper.length,0);
 assert.equal(splitPriority([row],{...options,feed:'delayed_sip'}).upper.length,0);
 assert.equal(splitPriority([{...row,day_change:26}],options).upper.length,0);
 assert.equal(assess({...row,day_change:26},options).state,'EXTENDED');
});
test('slow scan preserves newer trade and independently newer quote',()=>{
 const latest={...row,price:2.5,price_at:new Date(now+5000).toISOString(),quote_at:new Date(now+6000).toISOString(),bid:2.49,ask:2.5};
 const scanned={...row,scan_at:at,previous_close:2,name:'updated metadata'};
 const result=mergeMarketRow(latest,scanned,{scan:true,now:now+7000});
 assert.equal(result.price,2.5);assert.equal(result.quote_at,latest.quote_at);assert.equal(result.name,'updated metadata');assert.equal(result.day_change,25);
});
test('an old or missing trade does not block a new quote; a missing quote does not erase a good one',()=>{
 const current={...row,scan_at:at,previous_close:2};
 const next=mergeMarketRow(current,{price:1,price_at:new Date(now-1000).toISOString(),quote_at:new Date(now+1000).toISOString(),bid:2.03,ask:2.04},{now:now+2000});
 assert.equal(next.price,row.price);assert.equal(next.bid,2.03);
 const trade=mergeMarketRow(next,{price:2.6,price_at:new Date(now+2000).toISOString()},{now:now+2000});
 assert.equal(trade.bid,2.03);assert.ok(isExtended(trade));assert.equal(trade.day_change,30.000000000000004);
});
test('rejects future and malformed prices and avoids previous-session percentage reuse',()=>{
 const current={...row,scan_at:at,previous_close:2};
 assert.equal(mergeMarketRow(current,{price:9,price_at:new Date(now+1).toISOString()},{now}).price,row.price);
 assert.equal(mergeMarketRow(current,{price:-1,price_at:at},{now}).price,row.price);
 const tomorrow=new Date(now+86400000).toISOString();assert.equal(mergeMarketRow(current,{price:3,price_at:tomorrow},{now:now+86400000}).day_change,null);
 assert.equal(marketDate('2026-09-17T01:00:00Z'),marketDate(at));
});
