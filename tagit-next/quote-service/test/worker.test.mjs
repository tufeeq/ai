import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createWorker} from '../worker.mjs';
const request=(path,options={})=>new Request('https://example.workers.dev'+path,options);

test('worker imports and serves health without a Node process global',()=>{
 const script=`globalThis.process=undefined;const {default:w}=await import('./worker.mjs');const r=await w.fetch(new Request('https://example.test/api/health'),{});console.log((await r.json()).status);`;
 assert.equal(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('../',import.meta.url),encoding:'utf8'}).trim(),'RUNTIME_CREDENTIALS_NOT_CONFIGURED');
});
test('worker receives protected bindings and isolates service state by environment',async()=>{
 let made=0;const seen=[];
 const worker=createWorker({serviceFactory:({env})=>{made++;seen.push(env);return {health:()=>({status:'CONFIGURED_UNVERIFIED'})};}});
 const a={ALPACA_API_KEY_ID:'fixture-a'},b={ALPACA_API_KEY_ID:'fixture-b'};
 await worker.fetch(request('/api/health'),a);await worker.fetch(request('/api/health'),a);await worker.fetch(request('/api/health'),b);
 assert.equal(made,2);assert.deepEqual(seen,[a,b]);
});
test('worker retains CORS preflight, rejects foreign origins and write methods',async()=>{
 const worker=createWorker(),env={};
 const pre=await worker.fetch(request('/api/quotes',{method:'OPTIONS',headers:{Origin:'https://tufeeq.github.io'}}),env);
 assert.equal(pre.status,204);assert.equal(await pre.text(),'');assert.equal(pre.headers.get('Access-Control-Allow-Origin'),'https://tufeeq.github.io');
 assert.equal((await worker.fetch(request('/api/health',{headers:{Origin:'https://foreign.test'}}),env)).status,403);
 assert.equal((await worker.fetch(request('/api/quotes',{method:'POST'}),env)).status,405);
 assert.equal((await worker.fetch(request('/api/orders'),env)).status,404);
});
test('worker missing credentials returns explicit failure and no quotes',async()=>{
 const r=await createWorker().fetch(request('/api/quotes?symbols=SENS'),{});
 assert.equal(r.status,503);assert.equal(r.headers.get('Cache-Control'),'no-store');
 assert.deepEqual((await r.json()).rows,[]);
});
test('worker preserves quote payload, timestamps and feed without manufacturing freshness',async()=>{
 const payload={status:'OK',feed:'iex',rows:[{symbol:'SENS',status:'STALE',quote:{timestamp:'2026-09-15T16:00:00Z',age_ms:5000}}],approved_for_live:false};
 const worker=createWorker({serviceFactory:()=>({quotes:async s=>{assert.equal(s,'SENS');return payload;}})});
 const r=await worker.fetch(request('/api/quotes?symbols=SENS'),{});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),payload);
});
test('worker retains rate-limit retry and redacts unexpected provider errors',async()=>{
 for(const [message,status,body] of [['RATE_LIMITED',429,'RATE_LIMITED'],['secret-provider-body',503,'SERVICE_ERROR']]){
  const worker=createWorker({serviceFactory:()=>({quotes:async()=>{throw new Error(message);}})});
  const r=await worker.fetch(request('/api/quotes?symbols=SENS'),{});
  assert.equal(r.status,status);assert.equal((await r.json()).status,body);
  if(status===429)assert.equal(r.headers.get('Retry-After'),'30');
 }
});
