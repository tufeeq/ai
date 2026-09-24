import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replayDiscovery} from '../../research/discovery-replay.mjs';
const origin=Date.parse('2026-01-05T14:30:00Z'),stamp=m=>new Date(origin+m*60000).toISOString();
const events=Array.from({length:13},(_,i)=>({symbol:'SYNTHETIC',sequence:i,available_at:stamp(i+1),bar:{t:stamp(i),o:10,h:10.2,l:9.9,c:i>9?10.1:10,v:i>9?10000:1000,n:100,vw:10}}));
test('30s replay uses frozen detector and availability, unaffected by future revisions',()=>{
 const window={start:stamp(0),end:stamp(13)};
 const a=replayDiscovery(events,window);
 assert.equal(a.scans,27);assert.equal(a.signals.length,1);assert.equal(a.signals[0].at,stamp(13));
 const future={...events[12],sequence:99,available_at:stamp(14),bar:{...events[12].bar,c:1000}};
 assert.deepEqual(replayDiscovery([...events,future],window),a);
 const delayed=events.map(e=>e.sequence===12?{...e,available_at:stamp(13.5)}:e);
 assert.equal(replayDiscovery(delayed,window).signals.length,0);
 assert.equal(replayDiscovery(delayed,{...window,end:stamp(13.5)}).signals[0].at,stamp(13.5));
});
test('replay refuses incomplete minute, duplicate sequence and non-production interval',()=>{
 const window={start:stamp(0),end:stamp(13)};
 assert.throws(()=>replayDiscovery([{...events[0],available_at:stamp(.5)}],window));
 assert.throws(()=>replayDiscovery([...events,events[0]],window));
 assert.throws(()=>replayDiscovery(events,{...window,interval:5000}));
});
