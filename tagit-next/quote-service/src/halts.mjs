// Current trading halts from Nasdaq Trader's public RSS feed (all U.S. listings).
// A halt without a resumption trade time is current. Cached briefly; a failed fetch
// reports UNKNOWN instead of claiming "not halted".
const URL_HALTS='https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts';
const TTL_MS=30000;
const tag=(xml,name)=>{const m=xml.match(new RegExp(`<ndaq:${name}>([^<]*)</ndaq:${name}>`));return m?m[1].trim()||null:null;};

/** "09/25/2026" + "10:01:02" New York → ISO UTC; null when malformed. */
export function nyToIso(date,time){
 const d=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date??''),t=/^(\d{2}):(\d{2}):(\d{2})$/.exec(time??'');
 if(!d||!t)return null;
 const wall=Date.UTC(+d[3],+d[1]-1,+d[2],+t[1],+t[2],+t[3]);
 // New York offset for that wall time (EDT −4 or EST −5), found by formatting the guess.
 for(const offset of [4,5]){
  const guess=wall+offset*3600000;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
  const hh=+parts.find(p=>p.type==='hour').value,mm=+parts.find(p=>p.type==='minute').value;
  if(hh===+t[1]&&mm===+t[2])return new Date(guess).toISOString();
 }
 return null;
}

export function parseHalts(xml){
 const halts=new Map();
 for(const item of xml.split('<item>').slice(1)){
  const symbol=tag(item,'IssueSymbol');
  if(!symbol||tag(item,'ResumptionTradeTime'))continue;
  halts.set(symbol,{
   reason_code:tag(item,'ReasonCode'),
   halted_at:nyToIso(tag(item,'HaltDate'),tag(item,'HaltTime')),
   resumption_quote_time:tag(item,'ResumptionQuoteTime'),
   source:'NASDAQ_TRADER_RSS',
  });
 }
 return halts;
}

export function createHaltWatcher({fetcher=fetch,now=Date.now}={}){
 let halts=new Map(),fetchedAt=0,status='UNKNOWN',loading=null,error=null;
 async function refresh(){
  try{
   const r=await fetcher(URL_HALTS,{headers:{'User-Agent':'Mozilla/5.0 TAGit NEXT'},signal:AbortSignal.timeout(8000)});
   if(!r.ok)throw Error('HTTP_'+r.status);
   const text=await r.text();
   if(!text.includes('<rss'))throw Error('NOT_RSS');
   halts=parseHalts(text);fetchedAt=now();status='OK';error=null;
  }catch(e){status='UNAVAILABLE';error=e.message;}
 }
 return {
  /** Current halts; refreshes in the background when older than the TTL. */
  async get({wait=false}={}){
   if(now()-fetchedAt>TTL_MS&&!loading)loading=refresh().finally(()=>loading=null);
   if(wait&&loading)await loading;
   const fresh=status==='OK'&&now()-fetchedAt<=TTL_MS*4;
   return {halts:fresh?halts:new Map(),status:fresh?'OK':'UNKNOWN',fetched_at:fetchedAt?new Date(fetchedAt).toISOString():null};
  },
  status:()=>({status,fetched_at:fetchedAt?new Date(fetchedAt).toISOString():null,current:halts.size,error}),
 };
}
