import {createScanner} from './scanner.mjs';
import {tracedScanner} from '../../research/scanner-trace.mjs';
import {settings} from './market.mjs';
import {openJournal,recordingFetch} from './journal.mjs';
import {createStream} from './stream.mjs';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function createRuntime({env=process.env,fetcher=fetch,now=Date.now,journalFactory=openJournal,streamFactory=createStream,onEvidence=null}={}){
 const enabled=env.TAGIT_BACKGROUND==='1',streamEnabled=env.TAGIT_STREAM==='1';
 if((enabled||streamEnabled)&&(!env.TAGIT_JOURNAL_PATH||env.TAGIT_JOURNAL_PATH===':memory:'))throw Error('PERSISTENT_JOURNAL_PATH_REQUIRED');
 const journal=env.TAGIT_JOURNAL_PATH?journalFactory(env.TAGIT_JOURNAL_PATH,{now}):null;
 const scanner=journal?tracedScanner({env,fetcher:recordingFetch(journal,{fetcher,now}),now,record:e=>journal.recordEvent('SCANNER_TRACE',null,e),onEvidence}):createScanner({env,fetcher,now,onEvidence});
 const clients=new Set();let loop=null,busy=false,reads=0,stopped=false,lastScan=null,lastError=null,paperRunning=false,paperStatus='DISABLED';
 function broadcast(type,payload){const frame=`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for(const client of clients){if(client.destroyed||!client.write(frame)){client.end();clients.delete(client);}}
 }
 const stream=streamFactory({env,now,onEvent:e=>{try{journal?.recordEvent('MARKET',e.S,e);broadcast('market',e);}catch{lastError='JOURNAL_WRITE_FAILED';stream.stop();}},
  onStatus:s=>{try{journal?.recordEvent('STREAM_STATUS',null,s);}catch{lastError='JOURNAL_WRITE_FAILED';}broadcast('stream',s);}});
 const status=()=>({background_enabled:enabled,scan_busy:busy,last_scan_at:lastScan,last_error:lastError,
  scan_age_ms:lastScan?now()-Date.parse(lastScan):null,stream:stream.status(),
  storage:journal?'SQLITE_FILE':'PROCESS_MEMORY',durability_verified:false,paper:paperStatus,approved_for_live:false});
 function paper(){if(!env.TAGIT_PAPER_PYTHON||!journal||paperRunning)return;paperRunning=true;paperStatus='RUNNING';
  const script=fileURLToPath(new URL('../../research/paper.py',import.meta.url));
  execFile(env.TAGIT_PAPER_PYTHON,[script,'--db',env.TAGIT_JOURNAL_PATH,...(env.TAGIT_LOT_METADATA?['--lots',env.TAGIT_LOT_METADATA]:[])],{timeout:20000,maxBuffer:100000},err=>{paperRunning=false;paperStatus=err?'EVALUATION_FAILED':'COMPLETED_UNPROVEN';});
 }
 const wrapped={async get(){if(stopped)throw Error('RUNTIME_STOPPING');reads++;try{const result=await scanner.get();journal?.recordScan(result);lastScan=result.server_time;
  if(streamEnabled){const pending=journal?.recentSignals(500).filter(a=>now()-Date.parse(a.at)<35*60000).map(a=>a.symbol)??[];
   stream.setSymbols([...pending,...result.rows.map(r=>r.symbol)]);}
  return result;}finally{reads--;}}};
 async function cycle(){if(busy||stopped)return;busy=true;
  try{const s=settings(env);if(!s.configured)throw Error('MISSING_CREDENTIALS');
   // Use the provider's exchange clock: weekends/holidays do not become sessions.
   const r=await fetcher('https://paper-api.alpaca.markets/v2/clock',{headers:{'APCA-API-KEY-ID':s.key,'APCA-API-SECRET-KEY':s.secret},signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error('CLOCK_UNAVAILABLE');const clock=await r.json();
   if(clock.is_open===true){await wrapped.get();lastError=null;}else if(clock.is_open!==false)throw Error('CLOCK_UNAVAILABLE');
   paper();
  }catch(e){lastError=['MISSING_CREDENTIALS','CLOCK_UNAVAILABLE'].includes(e.message)?e.message:'SCAN_OR_STORAGE_FAILED';try{journal?.recordEvent('WORKER_ERROR',null,{code:lastError});}catch{lastError='JOURNAL_WRITE_FAILED';}}
  finally{busy=false;if(!stopped&&enabled){loop=setTimeout(cycle,Math.max(100,30000-now()%30000));loop.unref?.();}}
 }
 journal?.recordEvent('RUNTIME_START',null,{feed:settings(env).feed,background:enabled});
 return {scanner:wrapped,status,journal,cycle,
  start(){if(streamEnabled)stream.start();if(enabled)void cycle();},
  events(req,res){if(!streamEnabled){res.statusCode=503;return res.end(JSON.stringify({status:'STREAM_DISABLED'}));}
   if(clients.size>=50){res.statusCode=503;return res.end(JSON.stringify({status:'CLIENT_LIMIT'}));}
   res.setHeader('Content-Type','text/event-stream');res.setHeader('X-Accel-Buffering','no');res.flushHeaders?.();clients.add(res);
   res.write(`event: stream\ndata: ${JSON.stringify(stream.status())}\n\n`);
   const heartbeat=setInterval(()=>{if(!res.write(`event: runtime\ndata: ${JSON.stringify(status())}\n\n`)){res.end();}},15000);heartbeat.unref?.();
   const close=()=>{clearInterval(heartbeat);clients.delete(res);};res.on('close',close);req.on('aborted',close);
  },
  async close(){stopped=true;clearTimeout(loop);stream.stop();for(const c of clients)c.end();clients.clear();
   // A live scan may still persist its response; close the database only afterwards.
   while(busy||reads||paperRunning)await new Promise(resolve=>setTimeout(resolve,50));journal?.close();}
 };
}
