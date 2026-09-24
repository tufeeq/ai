import test from 'node:test';
import assert from 'node:assert/strict';
import {providerURL,createLabService} from '../src/lab.mjs';
const now=Date.parse('2026-09-24T17:00:00Z');
const query=(extra={})=>new URLSearchParams({resource:'bars',symbols:'SENS',timeframe:'1Min',start:'2026-09-24T13:30:00Z',end:'2026-09-24T17:00:00Z',feed:'sip',...extra});
test('relay fixes destination, limits history and rejects arbitrary resources',()=>{
 const u=providerURL(query(),now);
 assert.equal(u.origin,'https://data.alpaca.markets');assert.equal(u.searchParams.get('end'),'2026-09-24T16:44:00.000Z');
 for(const q of [query({resource:'orders'}),query({url:'https://evil.test'}),query({symbols:'AAPL&bad=1'}),query({timeframe:'1Sec'}),query({start:'2020-01-01T00:00:00Z'})])assert.throws(()=>providerURL(q,now),/INVALID_LAB_QUERY/);
});
test('provider credentials stay in headers and cache reuses successful requests',async()=>{
 let calls=0;const lab=createLabService({env:{ALPACA_API_KEY_ID:'test-key',ALPACA_API_SECRET_KEY:'test-secret'},now:()=>now,fetcher:async(url,opts)=>{
  calls++;assert.equal(opts.headers['APCA-API-KEY-ID'],'test-key');assert.ok(!url.includes('test-key'));return {ok:true,json:async()=>({bars:{SENS:[]}})};
 }});
 assert.deepEqual(await lab.data(query()),{bars:{SENS:[]}});await lab.data(query());assert.equal(calls,1);
});
test('connection reports SIP entitlement failure without masking it as IEX',async()=>{
 const lab=createLabService({env:{ALPACA_API_KEY_ID:'key',ALPACA_API_SECRET_KEY:'secret'},now:()=>now,fetcher:async()=>({ok:false,status:403})});
 const r=await lab.connection();assert.equal(r.status,'FEED_NOT_ENTITLED');assert.equal(r.feed,'sip');assert.equal(r.approved_for_live,false);
});
test('missing credentials are explicit',async()=>{
 const r=await createLabService({env:{},now:()=>now}).connection();assert.equal(r.status,'RUNTIME_CREDENTIALS_NOT_CONFIGURED');
});
