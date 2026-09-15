// Pure view state: age advances locally even when the network stops updating.
export function viewQuote(row,elapsed=0){
 const q=row.quote,t=row.trade;
 const quoteAge=Number.isFinite(q?.age_ms)?q.age_ms+Math.max(0,elapsed):null;
 const tradeAge=Number.isFinite(t?.age_ms)?t.age_ms+Math.max(0,elapsed):null;
 let status=row.status;
 if(['RECENT_IEX','RECENT_SIP','WIDE_SPREAD'].includes(status)&&quoteAge>3000)status='STALE';
 if(quoteAge===null&&['RECENT_IEX','RECENT_SIP'].includes(status))status='INVALID_QUOTE';
 return {status,quoteAge,tradeAge,tradeStatus:row.feed==='delayed_sip'?'DELAYED':tradeAge===null?'MISSING':tradeAge>3000?'STALE':'RECENT'};
}
export function serviceOrigin(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('INVALID_SERVICE_ORIGIN');
 return url.origin;
}
export function validPayload(p,symbols){
 if(p?.schema_version!==1||p.status!=='OK'||p.approved_for_live!==false||!['iex','sip','delayed_sip'].includes(p.feed)||!Array.isArray(p.rows)||p.rows.length!==symbols.length)return false;
 const returned=new Set(p.rows.map(r=>r.symbol));
 if(returned.size!==symbols.length||symbols.some(s=>!returned.has(s)))return false;
 return p.rows.every(r=>r.approved_for_live===false&&r.feed===p.feed&&typeof r.status==='string'&&typeof r.market_cap==='number'&&Number.isFinite(r.market_cap)&&r.market_cap>0&&r.market_cap<1e9&&(!r.quote||(Number.isFinite(r.quote.bid)&&Number.isFinite(r.quote.ask)&&r.quote.bid>0&&r.quote.ask>=r.quote.bid&&r.quote.bid_size>0&&r.quote.ask_size>0&&Number.isFinite(r.quote.age_ms)&&r.quote.age_ms>=0))&&(!r.trade||(Number.isFinite(r.trade.price)&&r.trade.price>0&&Number.isFinite(r.trade.age_ms)&&r.trade.age_ms>=0)));
}
