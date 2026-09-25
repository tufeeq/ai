// Deterministic replay of actual scanner clock reads and async response ordering.
// No source rewrite, no network during replay, no replacement of receipt by event time.
import {createScanner} from '../quote-service/src/scanner.mjs';
export function tracedScanner({env,fetcher=fetch,now=Date.now,record=()=>{},onEvidence=null}){
 let requestId=0,loading=null;
 const clock=()=>{const value=now();record({kind:'CLOCK',value});return value;};
 const transport=async(url,options)=>{const id=++requestId;record({kind:'REQUEST',id,url});
  try{const r=await fetcher(url,options),body=await r.json();record({kind:'RESPONSE',id,status:r.status,body});return {ok:r.ok,status:r.status,json:async()=>structuredClone(body)};}
  catch(e){record({kind:'RESPONSE',id,error:'TRANSPORT_FAILED'});throw e;}
 };
 const scanner=createScanner({env,fetcher:transport,now:clock,onEvidence});
 return {get(){if(loading)return loading;record({kind:'GET',feed:env.TAGIT_DATA_FEED||'iex'});
  loading=scanner.get().then(r=>{record({kind:'RESULT'});return r;},e=>{record({kind:'FAILURE'});throw e;}).finally(()=>{loading=null;});return loading;
 }};
}

export async function replayTrace(trace){
 let cursor=0;const waiting=new Map();let violation=false;
 function pump(){while(trace[cursor]?.kind==='RESPONSE'){
  const e=trace[cursor++],p=waiting.get(e.id);if(!p){violation=true;throw Error('RESPONSE_WITHOUT_REQUEST');}waiting.delete(e.id);
  if(e.error)p.reject(Error('TRANSPORT_FAILED'));else p.resolve({ok:e.status>=200&&e.status<300,status:e.status,json:async()=>structuredClone(e.body)});
 }}
 function take(kind){pump();const e=trace[cursor++];if(e?.kind!==kind){violation=true;throw Error('TRACE_ORDER_MISMATCH_'+kind);}return e;}
 const scanner=createScanner({env:{ALPACA_API_KEY_ID:'REPLAY',ALPACA_API_SECRET_KEY:'REPLAY',TAGIT_DATA_FEED:trace[0]?.feed||'iex'},
  now:()=>{const e=take('CLOCK');pump();return e.value;},
  fetcher:url=>{const e=take('REQUEST');if(e.url!==url){violation=true;throw Error('TRACE_REQUEST_MISMATCH');}return new Promise((resolve,reject)=>{waiting.set(e.id,{resolve,reject});pump();});}});
 const outputs=[];
 while(cursor<trace.length){take('GET');let result,error,timer;
  try{result=await Promise.race([scanner.get(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('INCOMPLETE_TRACE')),1000);})]);}
  catch(e){error=e;}finally{clearTimeout(timer);}
  const end=take(error?'FAILURE':'RESULT');
  outputs.push(error?{error:'SCAN_FAILED'}:{result:structuredClone(result)});
  if(waiting.size)throw Error('UNFINISHED_REQUESTS');
  if(violation)throw Error('TRACE_INTEGRITY_FAILURE');
 }
 return {outputs,clock_and_response_order_reproduced:true,source_pit_verified:false,approved_for_live:false};
}
