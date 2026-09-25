// Observe transport outside the frozen scanner. The scanner receives identical JSON values.
export function createEvidenceBridge({fetcher=fetch,now=Date.now}={}) {
 const histories=new Map();
 return {async fetcher(url,options){
   const r=await fetcher(url,options),u=new URL(url);
   if(u.hostname!=='data.alpaca.markets'||u.pathname!=='/v2/stocks/bars'||u.searchParams.get('timeframe')!=='1Min'||!r.ok)return r;
   const body=await r.json(),received=now();
   for(const [symbol,bars]of Object.entries(body.bars||{})){
     const map=histories.get(symbol)||new Map();
     for(const b of bars)map.set(b.t,{bar:structuredClone(b),received});
     for(const [t]of map)if(Date.parse(t)<received-100*60000)map.delete(t);
     histories.set(symbol,map);
   }
   for(const [symbol,map]of histories)if(!map.size||[...map.values()].every(x=>received-x.received>120000))histories.delete(symbol);
   return {ok:r.ok,status:r.status,json:async()=>structuredClone(body)};
 },snapshot(at){const stamp=Date.parse(at);return Object.fromEntries([...histories].map(([s,map])=>[s,[...map.values()].filter(x=>x.received<=stamp&&stamp-x.received<=120000).map(x=>x.bar)]).filter(([,bars])=>bars.length));}};
}
