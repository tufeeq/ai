import {hash} from './store.mjs';
// A deployment snapshot preserves public decision evidence, not a backup of the full input journal.
export function restoreDecisionSnapshot(store,runId,config,snapshot){
 if(!snapshot||snapshot.status?.configHash!==hash(config))return 0;
 let restored=0;
 store.transaction(()=>{
  for(const saved of snapshot.opportunities||[]){
   const key=`${saved.symbol}|${saved.feed}|${saved.session}`;
   if(store.restore(runId,key))continue;
   const {bars=[],timeline=[],lastTrade,...o}=saved;
   if(o.id!==hash([runId,o.symbol,o.feed,o.session]).slice(0,24))throw Error('SNAPSHOT_ID_MISMATCH');
   const first=timeline.find(e=>e.kind==='DISCOVERY');
   if(!first||first.at!==o.first_at||first.price!==o.first_price)throw Error('SNAPSHOT_DISCOVERY_MISMATCH');
   store.first({id:o.id,symbol:o.symbol,session:o.session,first_at:o.first_at,first_price:o.first_price,methodology:o.methodology,
    first_signal:o.first_signal,first_quality:o.first_quality,first_eligibility:o.first_eligibility,
    provenance:'RECOVERED_PUBLIC_DECISION_SNAPSHOT',snapshot_at:snapshot.serverTime},runId);
   for(const e of timeline)store.event(o,e);
   store.event(o,{kind:'RECOVERED_DECISION_SNAPSHOT',at:snapshot.serverTime,reason:'First discovery and recorded transitions preserved before deployment. Full raw-input journal not available in public export.'});
   const normalized=bars.map(b=>({t:new Date(b[0]).toISOString(),o:b[1],h:b[2],l:b[3],c:b[4],v:b[5],received_at:new Date(b[6]||Date.parse(snapshot.serverTime)).toISOString(),symbol:o.symbol,feed:o.feed,n:null,vw:null}));
   store.checkpoint(runId,key,{bars:normalized,opportunity:o,lastTime:Date.parse(o.price_at),contextRehydration:true});restored++;
  }
 });return restored;
}
