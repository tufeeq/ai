// Live-provider adapter. Sandbox ratings and report dates are not financial dates.
export function createSharia({env=process.env,fetcher=fetch,now=Date.now}={}){
 const cache=new Map();let minute=0,count=0;
 const unknown=reason=>({status:'UNKNOWN',reason,source:'Zoya',source_url:'https://zoya.finance/api',methodology:'AAOIFI',financial_statement_at:null});
 return {async get(symbol){
  if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol??''))throw Error('INVALID_SYMBOLS');
  if(!env.ZOYA_API_KEY?.startsWith('live-'))return unknown('LIVE_PROVIDER_NOT_CONNECTED');
  if(env.TAGIT_SHARIA_PUBLIC_DISPLAY!=='1')return unknown('PUBLIC_DISPLAY_PERMISSION_REQUIRED');
  const old=cache.get(symbol);if(old&&now()-old.at<3600000)return old.value;
  if(now()-minute>=60000){minute=now();count=0;}if(count>=10)return unknown('RATE_LIMITED');count++;
  try{const r=await fetcher('https://api.zoya.finance/graphql',{method:'POST',headers:{Authorization:env.ZOYA_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),
   body:JSON.stringify({query:'query($symbol: String!) { basicCompliance { report(symbol: $symbol) { symbol exchange status reportDate } } }',variables:{symbol}})});
   if(!r.ok)return unknown('PROVIDER_UNAVAILABLE');const body=await r.json(),p=body.data?.basicCompliance?.report;
   if(body.errors?.length||!p||p.symbol!==symbol||p.exchange!=='XNAS')return unknown('MISSING_OR_AMBIGUOUS_REPORT');
   const age=now()-Date.parse(p.reportDate);if(!Number.isFinite(age)||age<0||age>90*86400000)return unknown('STALE_OR_UNDATED_REPORT');
   // Basic API does not expose the date of underlying financial statements.
   // Preserve provider opinion separately; do not satisfy the user's stricter gate.
   const value={...unknown('FINANCIAL_STATEMENT_DATE_MISSING'),provider_status:p.status,
    reviewed_at:p.reportDate,received_at:new Date(now()).toISOString(),symbol};
   if(cache.size>=1000)cache.delete(cache.keys().next().value);cache.set(symbol,{at:now(),value});return value;
  }catch{return unknown('PROVIDER_UNAVAILABLE');}
 }};
}
