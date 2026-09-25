export const iso = t => new Date(t).toISOString();
export const pct = (a,b) => Number.isFinite(a)&&Number.isFinite(b)&&b>0?(a/b-1)*100:null;
export const mean = a => a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
export function normalizeBar(raw,{symbol,feed,receivedAt,availabilityBasis='RECORDED_RECEIPT'}={}) {
  const t=raw.t??raw.timestamp;const received=receivedAt??raw.received_at;
  if(typeof t!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(t)||!Number.isFinite(Date.parse(t))||Date.parse(t)%60000!==0)throw Error('INVALID_BAR_TIME');
  const b={t:iso(Date.parse(t)),o:raw.o??raw.open,h:raw.h??raw.high,l:raw.l??raw.low,c:raw.c??raw.close,v:raw.v??raw.volume,n:raw.n??raw.trade_count??null,vw:raw.vw??raw.vwap??null};
  if(![b.o,b.h,b.l,b.c,b.v].every(Number.isFinite)||b.l<=0||b.l>Math.min(b.o,b.c)||b.h<Math.max(b.o,b.c)||b.v<0||b.n!==null&&(!Number.isInteger(b.n)||b.n<0))throw Error('INVALID_OHLCV');
  if(b.vw!==null&&(!Number.isFinite(b.vw)||b.vw<b.l||b.vw>b.h)) b.vw=null;
  const end=Date.parse(b.t)+60000,at=Date.parse(received);
  if(!Number.isFinite(at)||at<end)throw Error('INCOMPLETE_OR_FUTURE_BAR');
  if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol||''))throw Error('INVALID_SYMBOL');
  if(!['sip','iex','delayed_sip','synthetic'].includes(feed))throw Error('INVALID_FEED');
  return {...b,symbol,feed,received_at:iso(at),availability_basis:availabilityBasis};
}
export function quality(bars,now,{feed,maxLatencyMs=90000,expectedStart=null,haltIntervals=[],feedOutages=[],confirmedNoTrades=[]}={}) {
  const bs=bars.filter(b=>Date.parse(b.t)+60000<=now).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));const last=bs.at(-1);
  if(!last)return {status:'MISSING',contiguousBars:0,missingMinutes:null,latencyMs:null,entryAllowed:false,reasons:['NO_BARS']};
  let contiguous=1;for(let i=bs.length-1;i>0&&Date.parse(bs[i].t)-Date.parse(bs[i-1].t)===60000;i--)contiguous++;
  const from=expectedStart??Date.parse(bs[0].t),expected=Math.max(0,Math.floor((Date.parse(last.t)-from)/60000)+1);
  const gaps={NO_TRADE:0,HALT:0,FEED_OUTAGE:0,UNKNOWN:0};const seen=new Set(bs.map(b=>Date.parse(b.t)));
  const intervals=(xs,t)=>xs.some(x=>Date.parse(x.start)<=t&&t<Date.parse(x.end)&&Date.parse(x.received_at)<=now);
  for(let t=from;t<=Date.parse(last.t);t+=60000)if(!seen.has(t)){
    const k=intervals(haltIntervals,t)?'HALT':intervals(feedOutages,t)?'FEED_OUTAGE':confirmedNoTrades.some(x=>Date.parse(x.t)===t&&Date.parse(x.received_at)<=now)?'NO_TRADE':'UNKNOWN';gaps[k]++;
  }
  const latency=now-(Date.parse(last.t)+60000),reasons=[];
  if(latency>maxLatencyMs)reasons.push('STALE');if(contiguous<3)reasons.push('RECENT_GAP');if(gaps.UNKNOWN)reasons.push('UNKNOWN_GAPS');
  if(feed==='iex')reasons.push('IEX_SINGLE_EXCHANGE');if(feed==='delayed_sip')reasons.push('DELAYED_FEED');
  const missing=Object.values(gaps).reduce((a,b)=>a+b,0);
  return {status:latency>maxLatencyMs?'STALE':missing?'PARTIAL':'COMPLETE_OBSERVED_WINDOW',feed,coverage:feed==='iex'?'SINGLE_EXCHANGE':feed==='synthetic'?'SYNTHETIC':'CONSOLIDATED',latencyMs:latency,expectedMinutes:expected,observedMinutes:seen.size,missingMinutes:missing,gaps,contiguousBars:contiguous,reasons,entryAllowed:contiguous>=23&&latency<=maxLatencyMs&&feed!=='delayed_sip'};
}
export function pointInTime(records,at) {return records.filter(r=>Date.parse(r.received_at)<=at&&Date.parse(r.valid_from)<=at&&(!r.valid_until||at<Date.parse(r.valid_until))).sort((a,b)=>Date.parse(b.received_at)-Date.parse(a.received_at))[0]??null;}
export function eligibility(records,at,cfg) {
  const r=pointInTime(records,at);const reasons=[];
  if(!r)return {status:'UNKNOWN',reasons:['POINT_IN_TIME_METADATA_MISSING'],record:null};
  if(at-Date.parse(r.valid_from)>cfg.maxMetadataAgeMs)reasons.push('STALE_METADATA');
  if(!r.source)reasons.push('MISSING_SOURCE');
  if(!Number.isFinite(r.market_cap)||r.market_cap<=0)reasons.push('MARKET_CAP_UNKNOWN');else if(r.market_cap>=cfg.maxMarketCap)reasons.push('MARKET_CAP_OUT_OF_SCOPE');
  if(!r.exchange)reasons.push('EXCHANGE_UNKNOWN');else if(!cfg.exchanges.includes(r.exchange))reasons.push('EXCHANGE_OUT_OF_SCOPE');
  const sh=r.sharia;
  if(cfg.shariaRequired&&(!sh||sh.status!=='COMPLIANT'||!sh.source||!sh.financial_statement_at||Date.parse(sh.received_at)>at||!Number.isFinite(Date.parse(sh.received_at))))reasons.push('SHARIA_UNVERIFIED');
  return {status:reasons.length?'BLOCKED':'ELIGIBLE',reasons,record:r};
}
export function visibleNews(news,at,symbol) {return news.filter(n=>n.symbols?.includes(symbol)&&Date.parse(n.published_at)<=at&&Date.parse(n.received_at)<=at).sort((a,b)=>Date.parse(b.received_at)-Date.parse(a.received_at));}
