export function connectPrices(endpoint,{onMarket,onStatus,EventSourceImpl=globalThis.EventSource}={}){
 const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('INVALID_ENDPOINT');
 const source=new EventSourceImpl(url.origin+'/api/events');
 const read=(e,fn)=>{try{fn(JSON.parse(e.data));}catch{onStatus({state:'INVALID_MESSAGE',subscribed_symbols:[]});}};
 source.addEventListener('market',e=>read(e,onMarket));
 source.addEventListener('stream',e=>read(e,onStatus));
 source.addEventListener('runtime',e=>read(e,r=>onStatus(r.stream)));
 source.onerror=()=>onStatus({state:'DISCONNECTED',subscribed_symbols:[]});
 return ()=>source.close();
}
