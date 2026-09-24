// Replays the entire unchanged scanner, including shortlist, gates and pagination.
// An exact response URL must exist at the simulated scan tick. No network fallback.
import {createScanner} from '../quote-service/src/scanner.mjs';
export async function replayScannerTape({responses,ticks,feed='sip'}){
 let clock=0;const consumed=[],missing=[];
 for(const r of responses){
  if(!Number.isFinite(Date.parse(r.available_at))||!Number.isFinite(Date.parse(r.requested_at))||Date.parse(r.available_at)<Date.parse(r.requested_at))throw Error('INVALID_AVAILABILITY');
  if(!Number.isInteger(r.sequence))throw Error('MISSING_SEQUENCE');
 }
 if(new Set(responses.map(r=>r.sequence)).size!==responses.length)throw Error('DUPLICATE_SEQUENCE');
 const fetcher=async url=>{
  const candidates=responses.filter(r=>r.url===url&&Date.parse(r.available_at)<=clock).sort((a,b)=>Date.parse(b.available_at)-Date.parse(a.available_at)||b.sequence-a.sequence);
  const r=candidates[0];if(!r){missing.push({at:new Date(clock).toISOString(),url});throw Error('TAPE_RESPONSE_MISSING');}
  consumed.push(r.sequence);return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>structuredClone(r.body)};
 };
 const scanner=createScanner({env:{ALPACA_API_KEY_ID:'REPLAY',ALPACA_API_SECRET_KEY:'REPLAY',TAGIT_DATA_FEED:feed},fetcher,now:()=>clock});
 const scans=[];
 for(const t of ticks){const next=Date.parse(t);if(!Number.isFinite(next)||next<=clock||(clock&&next-clock!==30000))throw Error('INVALID_SCAN_CLOCK');clock=next;
  try{scans.push({at:t,result:structuredClone(await scanner.get())});}catch{scans.push({at:t,error:'INCOMPLETE_TAPE'});}
 }
 return {scans,consumed,missing,scenario:'ZERO_PROCESSING_LATENCY_AVAILABLE_RESPONSES_ONLY',
  complete_transport_tape:missing.length===0,point_in_time_universe_verified:false,approved_for_live:false};
}
