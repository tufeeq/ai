import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal,recordingFetch} from '../src/journal.mjs';
import {createStream} from '../src/stream.mjs';
import {createSharia} from '../src/sharia.mjs';
import {createRuntime} from '../src/runtime.mjs';
import {replayScannerTape} from '../../research/scanner-tape.mjs';
import {createScanner} from '../src/scanner.mjs';
import {tracedScanner,replayTrace} from '../../research/scanner-trace.mjs';
import {replayJournal} from '../../research/replay-journal.mjs';
import {createHandler} from '../src/http.mjs';
import {createServer} from 'node:http';

test('journal survives restart, deduplicates immutable signals and retains unknown outcomes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tagit-'));const path=join(dir,'journal.sqlite');
 try{let j=openJournal(path);const scan={server_time:'2026-09-24T14:00:00Z',feed:'sip',alerts:[{symbol:'TEST',detected_at:'2026-09-24T14:00:00Z',price:1}]};
 j.recordScan(scan);j.recordScan({...scan,alerts:[{...scan.alerts[0],price:999}]});
 j.recordOutcome('TEST:2026-09-24T14:00:00Z',{status:'UNKNOWN_EXIT',net_pct:null});j.close();
 j=openJournal(path);assert.equal(j.summary().signals,1);assert.equal(j.recentSignals()[0].payload.price,1);assert.equal(j.recentSignals()[0].outcome.status,'UNKNOWN_EXIT');j.close();
 }finally{rmSync(dir,{recursive:true});}
});
test('recording transport preserves response availability, hashes and no headers',async()=>{
 let clock=1000;const j=openJournal(':memory:');const f=recordingFetch(j,{now:()=>clock,fetcher:async()=>{clock=2000;return {ok:true,status:200,json:async()=>({bars:{},next_page_token:'MORE'})};}});
 await f('https://data.alpaca.markets/v2/stocks/bars',{headers:{secret:'DO_NOT_RECORD'}});
 const row=j.db.prepare('SELECT * FROM responses').get();assert.equal(row.available_at,'1970-01-01T00:00:02.000Z');assert.equal(row.sha256.length,64);assert.ok(!JSON.stringify(row).includes('DO_NOT_RECORD'));assert.equal(JSON.parse(row.body).next_page_token,'MORE');j.close();
});
class FakeSocket{
 static last;constructor(url){this.url=url;this.readyState=1;this.handlers={};this.sent=[];FakeSocket.last=this;}
 addEventListener(k,f){this.handlers[k]=f;}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.handlers.close?.();}
 message(rows){this.handlers.message({data:JSON.stringify(rows)});}
}
test('stream authenticates then subscribes once, honors account cap and stops safely',()=>{
 const events=[];const s=createStream({env:{ALPACA_API_KEY_ID:'key',ALPACA_API_SECRET_KEY:'secret',TAGIT_STREAM_SYMBOL_LIMIT:'2'},Socket:FakeSocket,onEvent:e=>events.push(e)});
 s.setSymbols(['AAA','BBB','CCC']);s.start();const ws=FakeSocket.last;
 ws.message([{T:'success',msg:'connected'}]);assert.equal(ws.sent[0].action,'auth');
 ws.message([{T:'success',msg:'authenticated'}]);assert.deepEqual(ws.sent[1].quotes,['AAA','BBB']);
 ws.message([{T:'subscription',quotes:['AAA','BBB']}]);assert.equal(s.status().partial,true);
 ws.message([{T:'q',S:'AAA',bp:1,ap:1.01,t:'2026-09-24T14:00:00Z'}]);assert.equal(events.length,1);
 assert.ok(!JSON.stringify(s.status()).includes('secret'));s.stop();assert.equal(s.status().state,'STOPPED');
});
test('background mode refuses ephemeral implicit storage and missing credentials are visible',async()=>{
 assert.throws(()=>createRuntime({env:{TAGIT_BACKGROUND:'1'}}),/PERSISTENT_JOURNAL/);
 const rt=createRuntime({env:{},streamFactory:()=>({status:()=>({state:'DISABLED'}),stop(){}})});
 await rt.cycle();assert.equal(rt.status().last_error,'MISSING_CREDENTIALS');await rt.close();
});
test('full scanner tape never goes to network or consumes future reference responses',async()=>{
 const t='2026-09-24T14:00:00.000Z';const responses=[{sequence:1,url:'https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity&exchange=NASDAQ',requested_at:t,available_at:t,status:200,body:[]}];
 const a=await replayScannerTape({responses,ticks:[t]});assert.equal(a.scans[0].error,'INCOMPLETE_TAPE');assert.equal(a.missing.length,1);
 const reference={sequence:2,url:'https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/universe-broad.json',requested_at:t,available_at:t,status:200,body:{schemaVersion:1,updatedAt:t,rows:[]}};
 // Empty shortlist still asks for news; a missing response is accounted for.
 const b=await replayScannerTape({responses:[...responses,{...reference,available_at:'2026-09-24T14:00:01Z'}],ticks:[t]});assert.deepEqual(b,a);
 const c=await replayScannerTape({responses:[...responses,reference],ticks:[t]});assert.equal(c.scans[0].result.coverage.eligible_small_caps,0);assert.equal(c.scans[0].result.coverage.news_error,true);
});
test('sharia sandbox cannot become real compliance; missing financial date stays unknown',async()=>{
 const disabled=createSharia({env:{ZOYA_API_KEY:'sandbox-test'},fetcher:()=>{throw Error('must not call');}});assert.equal((await disabled.get('TEST')).status,'UNKNOWN');
 const s=createSharia({env:{ZOYA_API_KEY:'live-test',TAGIT_SHARIA_PUBLIC_DISPLAY:'1'},now:()=>Date.parse('2026-09-24T14:00:00Z'),fetcher:async()=>({ok:true,json:async()=>({data:{basicCompliance:{report:{symbol:'TEST',exchange:'XNAS',status:'COMPLIANT',reportDate:'2026-09-20T00:00:00Z'}}}})})});
 const r=await s.get('TEST');assert.equal(r.status,'UNKNOWN');assert.equal(r.provider_status,'COMPLIANT');assert.equal(r.reason,'FINANCIAL_STATEMENT_DATE_MISSING');
});
test('complete response tape reproduces real shortlist, split basis, signal gates and ledger exactly',async()=>{
 const clock=Date.parse('2026-09-24T14:23:00Z'),at=new Date(clock).toISOString();
 const bars=Array.from({length:23},(_,i)=>({t:new Date(clock-(23-i)*60000).toISOString(),o:2,c:i>=20?2.04:2,h:i>=20?2.05:2.01,l:1.99,n:20,v:i>=20?5000:1000}));
 const env={ALPACA_API_KEY_ID:'TEST',ALPACA_API_SECRET_KEY:'TEST',TAGIT_DATA_FEED:'sip'};
 const fetcher=async url=>{let body;
  if(url.includes('/assets?'))body=[{symbol:'TEST',exchange:'NASDAQ',status:'active'}];
  else if(url.includes('universe-broad'))body={schemaVersion:1,updatedAt:at,rows:[{Ticker:'TEST',Industry:'Software','Market Cap':'10'}]};
  else if(url.includes('/snapshots?'))body={TEST:{latestTrade:{p:2.04,t:at},latestQuote:{bp:2.039,ap:2.04,t:at},dailyBar:{c:2.04,v:100000},minuteBar:{o:2,c:2.04,v:5000}}};
  else if(url.includes('timeframe=1Day'))body={bars:{TEST:[{t:'2026-09-23T04:00:00Z',c:2}]}};
  else if(url.includes('timeframe=1Min'))body={bars:{TEST:bars}};
  else body={news:[]};return {ok:true,status:200,json:async()=>body};
 };
 const j=openJournal(':memory:');const scanner=createScanner({env,now:()=>clock,fetcher:recordingFetch(j,{fetcher,now:()=>clock})});
 const original=structuredClone(await scanner.get());assert.equal(original.alerts.length,1);
 const responses=j.db.prepare('SELECT * FROM responses ORDER BY sequence').all().map(r=>({...r,body:JSON.parse(r.body)}));
 const result=await replayScannerTape({responses,ticks:[at]});assert.equal(result.missing.length,0);assert.deepEqual(result.scans[0].result,original);
 const future={...responses[0],sequence:999,available_at:'2026-09-24T15:00:00Z',body:[]};
 assert.deepEqual((await replayScannerTape({responses:[...responses,future],ticks:[at]})).scans,result.scans);j.close();
});
test('real scanner trace reproduces advancing clocks, out-of-order concurrent responses and caches',async()=>{
 let clock=Date.parse('2026-09-24T14:00:00Z');const trace=[];
 const fetcher=async url=>{const assets=url.includes('/assets?');await new Promise(r=>setTimeout(r,assets?8:1));clock+=13;
  const body=assets?[]:url.includes('universe-broad')?{schemaVersion:1,updatedAt:new Date(clock).toISOString(),rows:[]}:{news:[]};
  return {ok:true,status:200,json:async()=>body};};
 const scanner=tracedScanner({env:{ALPACA_API_KEY_ID:'TEST',ALPACA_API_SECRET_KEY:'TEST'},fetcher,now:()=>clock++,record:e=>trace.push(e)});
 const a=structuredClone(await scanner.get());clock+=1000;const b=structuredClone(await scanner.get());
 clock+=31000;const c=structuredClone(await scanner.get());const replay=await replayTrace(trace);
 assert.deepEqual(replay.outputs.map(x=>x.result),[a,b,c]);
 await assert.rejects(replayTrace(trace.filter(e=>e.kind!=='CLOCK')),/TRACE_ORDER/);
});
test('HTTP scanner -> persistent journal -> restart replay matches without browser or provider network',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tagit-e2e-')),path=join(dir,'journal.sqlite');let clock=Date.parse('2026-09-24T14:00:00Z');
 const env={ALPACA_API_KEY_ID:'FAKE',ALPACA_API_SECRET_KEY:'FAKE',TAGIT_JOURNAL_PATH:path};
 const fetcher=async url=>({ok:true,status:200,json:async()=>url.includes('/assets?')?[]:url.includes('universe-broad')?{schemaVersion:1,updatedAt:new Date(clock).toISOString(),rows:[]}:{news:[]}});
 const rt=createRuntime({env,fetcher,now:()=>clock++});const server=createServer(createHandler({env,runtime:rt}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{const scan=await fetch(origin+'/api/scanner').then(r=>r.json());assert.equal(scan.coverage.eligible_small_caps,0);
  const p=await fetch(origin+'/api/performance').then(r=>r.json());assert.equal(p.scans,1);assert.equal(p.profitability_claim_allowed,false);
  assert.equal((await fetch(origin+'/api/events')).status,503);
 }finally{await new Promise(r=>server.close(r));await rt.close();}
 try{const r=await replayJournal(path);assert.equal(r.complete,true);assert.equal(r.verified_scan_calls,1);}finally{rmSync(dir,{recursive:true});}
});
