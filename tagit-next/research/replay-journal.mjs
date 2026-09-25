import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {replayTrace} from './scanner-trace.mjs';
export async function replayJournal(path){
 const db=new DatabaseSync(path,{readOnly:true});
 try{const segments=[];let trace=[];
  for(const row of db.prepare("SELECT kind,payload FROM events WHERE kind IN ('RUNTIME_START','SCANNER_TRACE') ORDER BY sequence").all()){
   if(row.kind==='RUNTIME_START'){if(trace.length)segments.push(trace);trace=[];}else trace.push(JSON.parse(row.payload));
  }if(trace.length)segments.push(trace);
  const results=[];let verified=0;
  for(const trace of segments){
   try{const replay=await replayTrace(trace);for(const item of replay.outputs){
    if(item.error)continue;const saved=db.prepare('SELECT payload FROM scans WHERE id=?').get(item.result.server_time);
    if(!saved||JSON.stringify(JSON.parse(saved.payload))!==JSON.stringify(item.result))throw Error('SCAN_RESULT_MISMATCH');verified++;
   }results.push({status:'MATCHED',calls:replay.outputs.length});}
   catch{results.push({status:'INCOMPLETE_OR_MISMATCHED_TRACE'});}
  }
  return {segments:results,verified_scan_calls:verified,complete:results.length>0&&results.every(r=>r.status==='MATCHED'),
   performance_validation:false,scope:'Exact recorded scanner I/O and clock reads; not independent market evidence'};
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv[2])throw Error('Usage: node research/replay-journal.mjs PATH.sqlite');
 const r=await replayJournal(process.argv[2]);console.log(JSON.stringify(r,null,2));if(!r.complete)process.exitCode=1;
}
