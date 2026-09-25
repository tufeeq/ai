import test from 'node:test';
import assert from 'node:assert/strict';
import {connectPrices} from './stream-client.mjs';
test('stream client routes data without creating signals and reports failure',()=>{
 let es;class Fake{constructor(url){this.url=url;this.handlers={};es=this;}addEventListener(k,f){this.handlers[k]=f;}close(){this.closed=true;}}
 const rows=[],states=[];const stop=connectPrices('https://example.com',{EventSourceImpl:Fake,onMarket:r=>rows.push(r),onStatus:s=>states.push(s)});
 assert.equal(es.url,'https://example.com/api/events');es.handlers.market({data:'{"T":"t","S":"TEST","p":1}'});assert.equal(rows[0].p,1);
 es.handlers.runtime({data:'{"stream":{"state":"DISCONNECTED"}}'});assert.equal(states[0].state,'DISCONNECTED');
 es.handlers.market({data:'invalid'});assert.equal(states.at(-1).state,'INVALID_MESSAGE');es.onerror();assert.deepEqual(states.at(-1).subscribed_symbols,[]);stop();assert.equal(es.closed,true);
});
test('stream client rejects credentials and non-HTTPS endpoints',()=>{
 assert.throws(()=>connectPrices('https://user:secret@example.com'),/INVALID_ENDPOINT/);
 assert.throws(()=>connectPrices('http://example.com'),/INVALID_ENDPOINT/);
});
