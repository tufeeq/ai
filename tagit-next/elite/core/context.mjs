// Optional adapters feed these events only when real point-in-time records exist.
const kinds=new Set(['NEWS','REFERENCE','HALT','RESUME','SPLIT','REVERSE_SPLIT','SYMBOL_CHANGE','FEED_OUTAGE','NO_TRADE']);
export function validateContext(event) {
 if(!kinds.has(event.kind)||!event.source||!event.id||!Number.isFinite(Date.parse(event.received_at)))throw Error('INVALID_CONTEXT_EVENT');
 if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(event.symbol||''))throw Error('INVALID_CONTEXT_SYMBOL');
 if(event.kind==='NEWS'&&(!event.published_at||!event.url||!event.supportingText))throw Error('NEWS_EVIDENCE_REQUIRED');
 if(['SPLIT','REVERSE_SPLIT'].includes(event.kind)&&(!Number.isFinite(event.ratio)||event.ratio<=0||!Number.isFinite(Date.parse(event.effective_at))))throw Error('INVALID_SPLIT_EVENT');
 if(event.kind==='SYMBOL_CHANGE'&&(!event.instrument_id||!event.new_symbol||!event.effective_at))throw Error('SYMBOL_CHANGE_IDENTITY_REQUIRED');
 if(['HALT','FEED_OUTAGE'].includes(event.kind)&&!Number.isFinite(Date.parse(event.start)))throw Error('INVALID_INTERVAL');
 return structuredClone(event);
}
export function appendContext(store,runId,raw){const e=validateContext(raw);return store.input(runId,{...e,event_at:e.effective_at||e.published_at||e.start||e.received_at});}
