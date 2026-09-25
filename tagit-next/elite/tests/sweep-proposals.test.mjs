import test from 'node:test';
import assert from 'node:assert/strict';
import {createSweep,createSweepWorker} from '../core/sweep.mjs';
import {entryProposal} from '../core/proposals.mjs';
const clock=Date.parse('2026-09-25T14:00:20Z');
function fixture({partial=false,rate=false}={}){
 let now=clock;const calls=[],symbols=Array.from({length:250},(_,i)=>'A'+String(i).padStart(3,'0'));
 const fetcher=async url=>{const u=new URL(url);calls.push(u);const reply=data=>({ok:true,json:async()=>data});
  if(u.pathname.endsWith('/calendar'))return reply([{date:'2026-09-25',open:'09:30',close:'16:00'}]);
  if(u.pathname.endsWith('/assets'))return reply(symbols.map(symbol=>({symbol,status:'active',exchange:'NASDAQ'})));
  if(u.hostname==='raw.githubusercontent.com')return reply({schemaVersion:1,updatedAt:new Date(clock-3600000).toISOString(),rows:symbols.map(Ticker=>({Ticker,Industry:'Software','Market Cap':'12'}))});
  const group=u.searchParams.get('symbols').split(',');
  if(u.pathname.endsWith('/bars')){if(rate)return {ok:false,status:429};return reply({bars:Object.fromEntries(group.map(symbol=>[symbol,Array.from({length:30},(_,i)=>({t:new Date(clock-20000-30*60000+i*60000).toISOString(),o:10,h:10.1,l:9.9,c:10,v:1000,n:20}))])),next_page_token:partial?'MORE':null});}
  if(u.pathname.endsWith('/snapshots'))return reply(Object.fromEntries(group.map(symbol=>[symbol,{latestTrade:{p:10,t:new Date(now).toISOString()},latestQuote:{bp:9.99,ap:10.01,t:new Date(now).toISOString()}}])));
  throw Error('Unexpected '+url);
 };
 return {calls,symbols,sweep:createSweep({env:{ALPACA_API_KEY_ID:'fixture',ALPACA_API_SECRET_KEY:'fixture'},fetcher,now:()=>now}),advance:()=>now+=60000};
}
test('broad sweep evaluates all 250 eligible symbols and uses incremental fetches',async()=>{
 const f=fixture(),first=await f.sweep.scan();assert.equal(first.scan.rows.length,250);assert.equal(first.scan.coverage.completed_symbols,250);assert.equal(first.scan.coverage.fresh_quotes,250);assert.equal(Object.keys(first.histories).length,250);
 const initial=f.calls.filter(u=>u.pathname.endsWith('/bars'))[0];f.advance();await f.sweep.scan();const latest=f.calls.filter(u=>u.pathname.endsWith('/bars')).at(-1);assert.ok(Date.parse(latest.searchParams.get('start'))>Date.parse(initial.searchParams.get('start')));
});
test('pagination truncation does not count as completed or emit detections',async()=>{
 const {sweep}=fixture({partial:true}),v=await sweep.scan();assert.equal(v.scan.coverage.completed_symbols,0);assert.equal(v.scan.coverage.partial_symbols,250);assert.ok(v.scan.rows.every(r=>r.signal===null));
});
test('worker coalesces refresh, drains observer, and rate limits retry',async()=>{
 let time=clock,calls=0,seen=0,drains=0;const worker=createSweepWorker({enabled:false,now:()=>time,sweep:{async scan(){calls++;await new Promise(r=>setTimeout(r,5));return {scan:{server_time:new Date(time).toISOString(),coverage:{completed_symbols:1}},histories:{}};}},observe:async()=>seen++,drain:async()=>drains++});
 await Promise.all([worker.refresh(),worker.refresh()]);assert.equal(calls,1);assert.equal(seen,1);assert.equal(drains,1);await worker.refresh();assert.equal(calls,1);time+=60000;await worker.refresh();assert.equal(calls,2);await worker.close();
 const bad=createSweepWorker({enabled:false,now:()=>time,sweep:{async scan(){throw Error('RATE_LIMITED');}},observe:()=>{throw Error('must not observe');}});await bad.refresh();assert.equal(bad.status().last_error,'RATE_LIMITED');await bad.close();
});
const confirmation={kind:'STATE',to:'RECOVERY_CONFIRMED',at:new Date(clock).toISOString(),level:10,features:{atr:1,priorLow:9.8}};
const o={wave:1,state:'RECOVERY_CONFIRMED',blocking:[],price_at:new Date(clock-60000).toISOString(),quality:{entryAllowed:true},feed:'iex',eligibility:{status:'ELIGIBLE',record:{valid_from:new Date(clock).toISOString()}}};
const quote={bid:10,ask:10.05,at:new Date(clock+2000).toISOString(),received_at:new Date(clock+3000).toISOString()};
test('entry plan uses frozen confirmed levels, future execution quote and fixed expiry',()=>{
 const p=entryProposal(o,[confirmation],quote,clock+4000);assert.equal(p.status,'PROPOSED');assert.equal(p.entryZone.max,10.1);assert.equal(p.scenarioStop,9.55);assert.equal(p.expiresAt,new Date(clock+120000).toISOString());assert.equal(p.orderEnabled,false);
 assert.equal(entryProposal(o,[],quote,clock+4000).status,'WAITING');
 assert.equal(entryProposal(o,[confirmation],quote,clock+120000).status,'EXPIRED');
 assert.ok(entryProposal(o,[confirmation],{...quote,at:new Date(clock).toISOString()},clock+4000).reasons.includes('FRESH_EXECUTION_QUOTE_MISSING'));
 assert.ok(entryProposal(o,[confirmation],{...quote,received_at:new Date(clock+5000).toISOString()},clock+4000).reasons.includes('FRESH_EXECUTION_QUOTE_MISSING'));
});
test('entry cannot bypass eligibility, quote freshness, price zone, quality, or attempt limit',()=>{
 for(const [value,reason]of [[{...o,blocking:['SHARIA_UNVERIFIED']},'SHARIA_UNVERIFIED'],[{...o,quality:{entryAllowed:false}},'DATA_QUALITY'],[{...o,eligibility:null},'POINT_IN_TIME_METADATA_MISSING']])assert.ok(entryProposal(value,[confirmation],quote,clock+4000).reasons.includes(reason));
 assert.ok(entryProposal(o,[confirmation],{...quote,ask:10.2},clock+4000).reasons.includes('OUTSIDE_ENTRY_ZONE'));
 assert.ok(entryProposal(o,[confirmation],quote,clock+15000).reasons.includes('FRESH_EXECUTION_QUOTE_MISSING'));
 assert.ok(entryProposal(o,[confirmation,confirmation,confirmation],quote,clock+4000).reasons.includes('MAX_ATTEMPTS'));
});
