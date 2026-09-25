import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openStore} from '../core/store.mjs';import {configuration} from '../core/config.mjs';import {createCalendar} from '../core/calendar.mjs';
import {normalizeBar,quality,eligibility,visibleNews} from '../core/data.mjs';import {createEngine} from '../core/engine.mjs';import {features} from '../core/features.mjs';
import {simulate} from '../core/simulator.mjs';import {discoveryOutcome,partitions,walkForward,synchrony} from '../core/evaluation.mjs';
const start=Date.parse('2026-09-04T13:30:00Z'),calendar=createCalendar([{date:'2026-09-04',open:'09:30',close:'16:00'}]);
const bar=(i,c=10,extra={})=>normalizeBar({t:new Date(start+i*60000).toISOString(),o:c,h:c+.02,l:c-.02,c,v:100000,n:100,...extra},{symbol:'TEST',feed:'sip',receivedAt:new Date(start+(i+1)*60000).toISOString()});
function fixture(path=':memory:',options={}){const store=openStore(path),engine=createEngine({store,calendar,runId:'test',discoveryMode:'PRESERVED',config:{mode:'REPLAY'},...options});return {store,engine};}
function seed(e){for(let i=0;i<25;i++)e.process(bar(i),{detect:i===23?{imported:true}:null});}
test('timestamps require timezone and completed minute; structurally invalid OHLC rejected',()=>{
 assert.throws(()=>normalizeBar({t:'2026-09-04T13:30:00',o:1,h:1,l:1,c:1,v:1},{symbol:'TEST',feed:'sip',receivedAt:new Date(start+60000).toISOString()}),/TIME/);
 assert.throws(()=>normalizeBar({t:new Date(start).toISOString(),o:1,h:1,l:1,c:2,v:1},{symbol:'TEST',feed:'sip',receivedAt:new Date(start+60000).toISOString()}),/OHLCV/);
 assert.throws(()=>normalizeBar({t:new Date(start).toISOString(),o:1,h:1,l:1,c:1,v:1},{symbol:'TEST',feed:'sip',receivedAt:new Date(start).toISOString()}),/INCOMPLETE/);
});
test('DST, holidays and early close use exchange calendar, not fixed UTC offsets',()=>{
 const c=createCalendar([{date:'2026-03-06',open:'09:30',close:'16:00'},{date:'2026-03-09',open:'09:30',close:'16:00'},{date:'2026-11-27',open:'09:30',close:'13:00',post_close:'17:00:00'}],{start:'2026-03-01',end:'2026-11-30'});
 assert.equal(new Date(c.session('2026-03-06').open).toISOString(),'2026-03-06T14:30:00.000Z');assert.equal(new Date(c.session('2026-03-09').open).toISOString(),'2026-03-09T13:30:00.000Z');
 assert.equal(c.at('2026-03-08T15:00:00Z').phase,'CLOSED');assert.equal(c.at('2027-03-08T15:00:00Z').phase,'CALENDAR_UNKNOWN');assert.equal(c.at('2026-11-27T18:01:00Z').phase,'AFTERHOURS');assert.equal(c.at('2026-11-27T17:59:00Z').shortened,true);
});
test('three observed bars are not three contiguous minutes and gap reasons stay explicit',()=>{
 const bs=[bar(0),bar(4),bar(5)],q=quality(bs,start+6*60000,{feed:'sip',haltIntervals:[{start:new Date(start+60000).toISOString(),end:new Date(start+3*60000).toISOString(),received_at:new Date(start).toISOString()}]});
 assert.equal(q.contiguousBars,2);assert.equal(q.entryAllowed,false);assert.equal(q.gaps.HALT,2);assert.equal(q.gaps.UNKNOWN,1);
 const f=features(bs,{session:calendar.session('2026-09-04'),at:bs.at(-1).received_at});assert.equal(f.threeBarsAreContiguousMinutes,false);assert.equal(f.volumeRatio3Minutes,null);
});
test('future metadata and later news are invisible; current cap cannot qualify history',()=>{
 const cfg=configuration(),m={symbol:'TEST',source:'test',exchange:'NASDAQ',market_cap:1000000,valid_from:new Date(start).toISOString(),received_at:new Date(start+60000).toISOString()};
 assert.equal(eligibility([m],start,cfg).status,'UNKNOWN');assert.equal(eligibility([m],start+60000,cfg).status,'BLOCKED');
 assert.deepEqual(visibleNews([{symbols:['TEST'],published_at:new Date(start-60000).toISOString(),received_at:new Date(start+60000).toISOString()}],start,'TEST'),[]);
 assert.equal(eligibility([{...m,market_cap:100000000}],start+60000,configuration({shariaRequired:false})).status,'BLOCKED');
});
test('first discovery immutable; rediscoveries are linked and entry extension cannot delete it',()=>{
 const {store,engine}=fixture();seed(engine);const first=engine.snapshots()[0];engine.process(bar(25,50),{detect:{imported:true}});const current=engine.snapshots()[0];
 assert.equal(current.id,first.id);assert.equal(current.first_price,10);assert.equal(current.first_at,first.first_at);assert.equal(engine.snapshots().length,1);assert.equal(engine.timeline(first.id).filter(e=>e.kind==='BASELINE_REDETECTION').length,1);
 assert.throws(()=>store.db.prepare('UPDATE opportunities SET first_price=999 WHERE id=?').run(first.id),/IMMUTABLE/);store.close();
});
test('duplicate receipt or restart cannot repeat discovery; SQLite checkpoint resumes identically',()=>{
 const dir=mkdtempSync(join(tmpdir(),'elite-test-')),path=join(dir,'a.db');let {store,engine}=fixture(path);seed(engine);const id=engine.snapshots()[0].id,count=store.summary().inputs;
 engine.process({...bar(23),received_at:new Date(start+40*60000).toISOString()},{detect:{imported:true}});assert.equal(store.summary().inputs,count);store.close();
 ({store,engine}=fixture(path));seed(engine);assert.equal(engine.timeline(id).filter(e=>e.kind==='DISCOVERY').length,1);assert.equal(engine.snapshots()[0].id,id);store.close();rmSync(dir,{recursive:true});
});
test('same event availability gives identical incremental and replay state',()=>{
 const a=fixture(),b=fixture();const events=Array.from({length:65},(_,i)=>bar(i,10+Math.sin(i/3)*.3));
 for(const x of events)a.engine.process(x,{detect:x.t===events[23].t?{imported:true}:null});
 for(const batch of [events.slice(0,20),events.slice(20,42),events.slice(42)])for(const x of batch)b.engine.process(x,{detect:x.t===events[23].t?{imported:true}:null});
 assert.deepEqual(a.engine.snapshots(),b.engine.snapshots());assert.deepEqual(a.engine.timeline(a.engine.snapshots()[0].id),b.engine.timeline(b.engine.snapshots()[0].id));a.store.close();b.store.close();
});
test('late correction appends audit without rewriting old decision or opening a phantom alert',()=>{
 const {store,engine}=fixture();seed(engine);const before=engine.snapshots()[0];engine.process({...bar(23,12),received_at:new Date(start+30*60000).toISOString()},{detect:{imported:true}});
 assert.deepEqual(engine.snapshots()[0],before);assert.equal(engine.timeline(before.id).at(-1).kind,'CORRECTION_OR_DUPLICATE');store.close();
});
test('one noise bar cannot confirm movement, and a gap resets transition persistence',()=>{
 const {store,engine}=fixture();seed(engine);engine.process(bar(25,11));assert.equal(engine.snapshots()[0].state,'DETECTED');engine.process(bar(29,11));assert.equal(engine.snapshots()[0].state,'DETECTED');assert.equal(engine.snapshots()[0].entryReady,false);store.close();
});
test('missing price path means unknown outcome, not failure or invented interpolation',()=>{
 const o={first_at:new Date(start).toISOString(),first_price:10};const r=discoveryOutcome(o,[bar(0),bar(2)],start+3*60000);assert.equal(r.complete,false);assert.equal(r.hits[20].status,'UNKNOWN');assert.equal(r.peakIsExecutableExit,false);
});
test('execution after latency uses next available bar open, costs reduce returns, eligibility gates official results',()=>{
 const bars=Array.from({length:50},(_,i)=>bar(i,10)),o={first_at:new Date(start+60000).toISOString(),first_price:10,first_eligibility:{status:'UNKNOWN'}};const cfg=configuration({execution:{holdingMinutes:5}});
 const strict=simulate(o,bars,[],calendar.session('2026-09-04'),cfg);assert.equal(strict.families[0].status,'NOT_EVALUABLE_ELIGIBILITY');
 const r=simulate(o,bars,[],calendar.session('2026-09-04'),cfg,{diagnostic:true}).families[0].trades[0];assert.ok(Date.parse(r.entry.at)>Date.parse(o.first_at));assert.ok(r.returnPct<0);assert.equal(r.intrabarOrder,'NOT_USED_CLOSE_DECISIONS');
});
test('cannot change configuration inside a run and cannot present exposed dates as independent',()=>{
 const {store}=fixture();assert.throws(()=>store.run('test',configuration({mode:'REPLAY',maxMarketCap:500})),/CONFLICT/);store.close();
 const d=['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06'];assert.equal(partitions(d).independent,false);assert.equal(walkForward(d).length,1);assert.equal(synchrony([{first_at:new Date(start).toISOString(),symbol:'TEST'}])[0].rate,null);
});
test('source module has no broker order endpoint and hard-disables order approval',()=>{
 assert.equal(configuration({allowOrders:true}).allowOrders,false);const text=readFileSync(new URL('../core/live.mjs',import.meta.url),'utf8');assert.ok(!text.includes('/v2/orders'));
});
test('corporate action pauses raw comparisons without modifying first detection',()=>{
 const {store,engine}=fixture();seed(engine);const original=engine.snapshots()[0];engine.process(bar(25,100),{corporateActions:[{id:'split-1',symbol:'TEST',kind:'REVERSE_SPLIT',ratio:10,received_at:new Date(start+25*60000).toISOString(),effective_at:new Date(start+25*60000).toISOString()}]});const o=engine.snapshots()[0];assert.equal(o.first_price,original.first_price);assert.equal(o.state,original.state);assert.ok(o.blocking.includes('CORPORATE_ACTION_UNRECONCILED'));store.close();
});
test('two writers read checkpoint under transaction and do not overwrite first signal',()=>{
 const dir=mkdtempSync(join(tmpdir(),'elite-writers-')),path=join(dir,'a.db');const a=fixture(path),b=fixture(path);seed(a.engine);b.engine.process(bar(25,11));a.engine.process(bar(26,11));assert.equal(a.engine.snapshots()[0].current_price,11);assert.equal(b.engine.snapshots()[0].first_price,10);assert.equal(a.store.summary().opportunities,1);a.store.close();b.store.close();rmSync(dir,{recursive:true});
});
