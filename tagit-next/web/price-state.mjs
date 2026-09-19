// Validate timestamps against the server clock, never the user's device clock.
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const stamp=s=>typeof s==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(s)?Date.parse(s):NaN;
const statuses=new Set(['RECENT_IEX','RECENT_SIP','WIDE_SPREAD','STALE','DELAYED','INVALID_QUOTE','FUTURE_TIMESTAMP']);
export function viewQuote(row,elapsed=0){
 const advance=Number.isFinite(elapsed)?Math.max(0,elapsed):Infinity;
 const quoteAge=Number.isFinite(row.quote?.age_ms)?row.quote.age_ms+advance:null;
 const tradeAge=Number.isFinite(row.trade?.age_ms)?row.trade.age_ms+advance:null;
 let status=row.status;
 if(['RECENT_IEX','RECENT_SIP','WIDE_SPREAD'].includes(status)&&quoteAge>3000)status='STALE';
 if(quoteAge===null&&['RECENT_IEX','RECENT_SIP','WIDE_SPREAD'].includes(status))status='INVALID_QUOTE';
 return {status,quoteAge,tradeAge,tradeStatus:row.feed==='delayed_sip'?'DELAYED':tradeAge===null?'MISSING':tradeAge>3000?'STALE':'RECENT'};
}
export function serviceOrigin(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('INVALID_SERVICE_ORIGIN');
 return url.origin;
}
export function validPayload(p,symbols){
 if(p?.schema_version!==1||!['OK','PARTIAL'].includes(p.status)||p.approved_for_live!==false||!['iex','sip','delayed_sip'].includes(p.feed)||!Array.isArray(p.rows)||!p.rows.length)return false;
 const server=stamp(p.server_time),received=stamp(p.provider_received_at),metadata=stamp(p.metadata_at);
 if(!Number.isFinite(server)||!Number.isFinite(received)||received>server||server-received>1500||!Number.isFinite(metadata)||metadata>server||server-metadata>86400000)return false;
 const rejected=p.rejected??[];
 if(!Array.isArray(rejected)||rejected.some(s=>typeof s!=='string')||(p.status==='OK'&&rejected.length)||(p.status==='PARTIAL'&&!rejected.length))return false;
 const accounted=[...p.rows.map(r=>r?.symbol),...rejected];
 if(accounted.length!==symbols.length||new Set(accounted).size!==symbols.length||symbols.some(s=>!accounted.includes(s)))return false;
 const timed=v=>Number.isFinite(v.age_ms)&&v.age_ms>=0&&Number.isFinite(stamp(v.timestamp))&&server-stamp(v.timestamp)>=0&&Math.abs(server-stamp(v.timestamp)-v.age_ms)<=2;
 return p.rows.every(r=>{
  if(!r||r.approved_for_live!==false||r.feed!==p.feed||!statuses.has(r.status)||!positive(r.market_cap)||r.market_cap>=1e9)return false;
  const rowMetadata=stamp(r.metadata_at);
  if(!Number.isFinite(rowMetadata)||rowMetadata>server||server-rowMetadata>86400000)return false;
  const q=r.quote,t=r.trade;
  if(q&&(!positive(q.bid)||!positive(q.ask)||q.ask<q.bid||!positive(q.bid_size)||!positive(q.ask_size)||!timed(q)))return false;
  if(t&&(!positive(t.price)||!timed(t)))return false;
  if(!q)return ['INVALID_QUOTE','FUTURE_TIMESTAMP'].includes(r.status);
  const expected=p.feed==='delayed_sip'?'DELAYED':q.age_ms>3000?'STALE':(q.ask-q.bid)/q.ask*100>0.8?'WIDE_SPREAD':p.feed==='iex'?'RECENT_IEX':'RECENT_SIP';
  return r.status===expected;
 });
}
