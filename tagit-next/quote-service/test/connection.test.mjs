import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyConnection} from '../scripts/verify-connection.mjs';
import {createMarketService} from '../src/market.mjs';
const at='2026-09-16T14:00:00Z',now=Date.parse(at);
const reference={schemaVersion:1,updatedAt:at,rows:[{Ticker:'SENS',Industry:'Medical Devices','Market Cap':'400'}]};
const service=createMarketService({env:{ALPACA_API_KEY_ID:'fixture',ALPACA_API_SECRET_KEY:'fixture'},now:()=>now,fetcher:async url=>({ok:true,json:async()=>url.includes('raw.githubusercontent')?reference:{SENS:{latestQuote:{bp:1,ap:1.002,bs:100,as:100,t:at}}}})});
const response=(value,{status=200,cors=true}={})=>new Response(JSON.stringify(value),{status,headers:cors?{'Access-Control-Allow-Origin':'https://tufeeq.github.io'}:{}});
test('probe requires real quote response after configured health',async()=>{
 const result=await verifyConnection('https://example.test','SENS',{fetcher:async url=>response(url.endsWith('/health')?service.health():await service.quotes('SENS'))});
 assert.equal(result.transport_verified,true);assert.equal(result.approved_for_live,false);assert.equal(result.recent_quotes,1);
});
test('configured health cannot substitute for prices',async()=>{
 await assert.rejects(verifyConnection('https://example.test','SENS',{fetcher:async url=>response(url.endsWith('/health')?service.health():{status:'PROVIDER_AUTH_FAILED'},{status:url.endsWith('/health')?200:503})}),/PROVIDER_AUTH_FAILED/);
});
test('probe stops at missing credentials and rejects unavailable CORS',async()=>{
 let calls=0;await assert.rejects(verifyConnection('https://example.test','SENS',{fetcher:async()=>{calls++;return response({credentials_configured:false});}}),/RUNTIME_CREDENTIALS_NOT_CONFIGURED/);assert.equal(calls,1);
 await assert.rejects(verifyConnection('https://example.test','SENS',{fetcher:async()=>response(service.health(),{cors:false})}),/CORS_NOT_CONFIGURED/);
});
test('probe never exposes a provider exception or follows redirects',async()=>{
 await assert.rejects(verifyConnection('https://example.test','SENS',{fetcher:async(url,options)=>{assert.equal(options.redirect,'error');throw new Error('secret');}}),e=>e.message==='DEPLOYMENT_UNREACHABLE');
});
