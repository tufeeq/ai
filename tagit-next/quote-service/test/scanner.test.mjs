import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeBars,rankSnapshot} from '../src/scanner.mjs';
const start=Date.parse('2026-09-16T14:00:00Z');
const bars=Array.from({length:23},(_,i)=>({t:new Date(start+i*60000).toISOString(),o:2,c:i>=20?2.04:2,h:i>=20?2.05:2.01,l:1.99,n:20,v:i>=20?5000:1000}));
test('expansion uses completed bars, and never future volume',()=>{const now=start+23*60000;const a=analyzeBars(bars,now);assert.equal(a.expansion,true);assert.equal(a.volume_ratio,5);assert.deepEqual(analyzeBars([...bars,{...bars[0],t:new Date(now).toISOString(),v:1e9}],now),a);});
test('a missing recent minute prevents an expansion signal',()=>assert.equal(analyzeBars(bars.filter((_,i)=>i!==21),start+23*60000).expansion,false));
test('old bars and short histories cannot generate fresh signals',()=>{assert.equal(analyzeBars(bars,start+30*60000).expansion,false);assert.equal(analyzeBars(bars.slice(-5),start+23*60000).expansion,false);});
test('duplicate minutes do not inflate volume or history',()=>assert.deepEqual(analyzeBars([...bars,...bars],start+23*60000),analyzeBars(bars,start+23*60000)));
test('a fresh HTTP response does not make an old trade fresh',()=>{const r=rankSnapshot('TEST',{latestTrade:{p:2,t:new Date(start).toISOString()},prevDailyBar:{c:1}}, {},start+60000);assert.equal(r.status,'STALE');assert.equal(r.day_change,100);assert.equal(r.quote_fresh,false);});
test('one dominant minute or a handful of prints is not sustained liquidity',()=>{assert.equal(analyzeBars(bars.map(b=>({...b,n:1})),start+23*60000).expansion,false);const dominated=bars.map((b,i)=>({...b,v:i===22?100000:b.v}));assert.equal(analyzeBars(dominated,start+23*60000).expansion,false);});
import {createScanner} from '../src/scanner.mjs';
test('whole scanner intersects verified NASDAQ assets with fresh small-cap metadata and caches scans',async()=>{
 const now=start+23*60000;let calls=0;
 const fetcher=async url=>{calls++;let payload;if(url.includes('/assets?'))payload=[{symbol:'TEST',exchange:'NASDAQ',status:'active'},{symbol:'NYSE',exchange:'NYSE',status:'active'}];else if(url.includes('universe-broad'))payload={schemaVersion:1,updatedAt:new Date(now).toISOString(),rows:[{Ticker:'TEST',Company:'Test',Industry:'Software','Market Cap':'10'}]};else if(url.includes('/snapshots?'))payload={TEST:{latestTrade:{p:2.04,t:new Date(now).toISOString()},latestQuote:{bp:2.039,ap:2.04,t:new Date(now).toISOString()},dailyBar:{c:2.04,v:100000,h:2.05},prevDailyBar:{c:2}}};else if(url.includes('timeframe=1Day'))payload={bars:{TEST:[{t:'2026-09-15T04:00:00Z',c:2}]}};else if(url.includes('/bars?'))payload={bars:{TEST:bars}};else payload={news:[]};return{ok:true,json:async()=>payload};};
 const scanner=createScanner({env:{ALPACA_API_KEY_ID:'test',ALPACA_API_SECRET_KEY:'test'},fetcher,now:()=>now});const r=await scanner.get();assert.equal(r.coverage.eligible_small_caps,1);assert.equal(r.rows[0].symbol,'TEST');assert.equal(r.rows[0].signal.expansion,true);assert.equal(r.rows[0].change_basis,'SPLIT_ADJUSTED_PREVIOUS_CLOSE');assert.ok(Math.abs(r.rows[0].day_change-2)<0.001);assert.equal(r.alerts.length,1);const count=calls;await scanner.get();assert.equal(calls,count);
});
