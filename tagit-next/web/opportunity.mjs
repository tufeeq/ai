// Pure opportunity assessment and observation accounting; never a fill simulator.
export const finite=x=>typeof x==='number'&&Number.isFinite(x);
export const positive=x=>finite(x)&&x>0;
export const elapsed=(at,now)=>{const t=Date.parse(at);return Number.isFinite(t)?now-t:Infinity;};
export const isExtended=row=>row.extended===true||row.day_change>25||row.signal?.return_3m>8;
export function assess(row,{now=Date.now(),serverTime,connected=true,feed='iex'}={}){
 const s=row.signal;const checks=[
  {key:'history',name:'دقائق حديثة مكتملة',pass:s?.ready===true&&elapsed(s?.bar_at,now)>=60000&&elapsed(s?.bar_at,now)<=150000,value:s?`${s.bars} دقيقة متاحة`:null},
  {key:'momentum',name:'صعود ٣ دقائق ≥ ٠٫٧٪',pass:finite(s?.return_3m)&&s.return_3m>=0.7,value:s?.return_3m,unit:'%'},
  {key:'volume',name:'تسارع الحجم ≥ ضعفين',pass:finite(s?.volume_ratio)&&s.volume_ratio>=2,value:s?.volume_ratio,unit:'×'},
  {key:'dollars',name:'قيمة تداول ٣ دقائق ≥ $25,000',pass:finite(s?.dollars_3m)&&s.dollars_3m>=25000,value:s?.dollars_3m,unit:'$'},
  {key:'prints',name:'٣٠ صفقة على الأقل',pass:finite(s?.trades_3m)&&s.trades_3m>=30,value:s?.trades_3m},
  {key:'balance',name:'لا تتركز أكثر من ٧٠٪ في دقيقة',pass:finite(s?.volume_concentration)&&s.volume_concentration<=0.7,value:finite(s?.volume_concentration)?s.volume_concentration*100:null,unit:'%'},
  {key:'vwap',name:'السعر فوق متوسط النافذة المرجّح',pass:positive(s?.vwap_window)&&row.price>=s.vwap_window,value:s?.vwap_window,unit:'$'},
  {key:'trade',name:'آخر صفقة خلال ١٥ ثانية',pass:elapsed(row.price_at,now)>=0&&elapsed(row.price_at,now)<=15000,value:row.price_at},
  {key:'quote',name:'عرض شراء وبيع خلال ١٠ ثوانٍ',pass:elapsed(row.quote_at,now)>=0&&elapsed(row.quote_at,now)<=10000&&positive(row.bid)&&positive(row.ask)&&row.bid<=row.ask,value:row.quote_at},
  {key:'spread',name:'فارق العرض والطلب ≤ ٠٫٨٪',pass:finite(row.spread_pct)&&row.spread_pct<=0.8&&row.spread_pct>=0,value:row.spread_pct,unit:'%'},
  {key:'extension',name:'لم تمتد الحركة بعيدًا عن البداية',pass:row.extended===false&&!(row.day_change>25)&&!(s?.return_3m>8),value:row.day_change,unit:'%'},
  {key:'structure',name:'إبطال قريب ومحدد',pass:s?.plan_valid===true,value:positive(s?.trigger)&&positive(s?.stop)?(s.trigger/s.stop-1)*100:null,unit:'%'}
 ];
 const p=row.plan;const recentScan=connected&&elapsed(serverTime,now)>=0&&elapsed(serverTime,now)<=90000;
 const planGood=positive(p?.entry)&&positive(p?.stop)&&p.entry>p.stop&&Array.isArray(p.targets)&&p.targets.length===2&&p.targets.every(t=>positive(t)&&t>p.entry);
 const livePlan=Boolean(recentScan&&feed!=='delayed_sip'&&checks.every(c=>c.pass)&&row.actionable===true&&planGood&&row.price>p.stop&&row.price<=p.entry*1.01);
 let state=livePlan?'READY':isExtended(row)?'EXTENDED':!recentScan||!checks.find(c=>c.key==='trade').pass?'STALE':s?.expansion?'CONFIRM':'WATCH';
 const blockers=checks.filter(c=>!c.pass).map(c=>c.name);
 if(!recentScan)blockers.unshift('الاتصال أو المسح غير حديث');
 if(feed==='delayed_sip')blockers.unshift('المصدر متأخر');
 if(planGood&&row.price>p.entry*1.01)blockers.unshift('السعر تجاوز منطقة التفعيل');
 return {state,checks,blockers,passed:checks.filter(c=>c.pass).length,total:checks.length,plan:livePlan?p:null};
}
export function sizePosition(plan,riskBudget,capital){
 if(!positive(plan?.entry)||!positive(plan?.stop)||plan.stop>=plan.entry||!positive(riskBudget)||!positive(capital))return null;
 const perShare=plan.entry-plan.stop;const shares=Math.floor(Math.min(riskBudget/perShare,capital/plan.entry));
 return {shares,notional:shares*plan.entry,plannedRisk:shares*perShare,perShare};
}
export function recordObservation(event,row){
 if(!positive(row?.price)||elapsed(row.price_at,Date.parse(event.started_at))>0||!Number.isFinite(Date.parse(row.price_at)))return event;
 const points=Array.isArray(event.points)?event.points:[];
 if(points.length&&Date.parse(row.price_at)<=Date.parse(points.at(-1).at))return event;
 const latest={at:row.price_at,price:row.price};const min=Math.min(event.min??event.start_price,row.price),max=Math.max(event.max??event.start_price,row.price);
 return {...event,min,max,last_price:row.price,last_at:row.price_at,points:[...points,latest].slice(-360)};
}
export function outcome(event){
 if(!positive(event.start_price))return {change:null,maximum:null,drawdown:null,retention:null};
 const change=positive(event.last_price)?(event.last_price/event.start_price-1)*100:null;
 const maximum=positive(event.max)?(event.max/event.start_price-1)*100:null;
 return {change,maximum,drawdown:positive(event.min)?(event.min/event.start_price-1)*100:null,retention:maximum>0&&finite(change)?change/maximum*100:null};
}
export function restoreJournal(value){
 if(!value||value.schema!==1||!Array.isArray(value.events))return [];
 return value.events.filter(e=>typeof e.id==='string'&&/^[A-Z][A-Z0-9.-]{0,9}$/.test(e.symbol)&&positive(e.start_price)&&Number.isFinite(Date.parse(e.started_at))).slice(-250).map(e=>({...e,points:Array.isArray(e.points)?e.points.filter(p=>positive(p.price)&&Number.isFinite(Date.parse(p.at))).slice(-360):[]}));
}

export function splitPriority(rows,options){
 const ranked=rows.map(row=>({row,assessment:options.assessment?options.assessment(row):assess(row,{...options,serverTime:row.scan_at??options.serverTime})})).sort((a,b)=>b.assessment.passed-a.assessment.passed||(b.row.score??0)-(a.row.score??0));
 const upper=[],lower=[];
 for(const item of ranked){const a=item.assessment;const timely=a.checks.find(c=>c.key==='trade').pass&&elapsed(item.row.scan_at??options.serverTime,options.now??Date.now())>=0&&elapsed(item.row.scan_at??options.serverTime,options.now??Date.now())<=90000&&options.connected!==false;
  (a.passed>=8&&timely&&options.feed!=='delayed_sip'&&a.checks.filter(c=>['history','extension','dollars','prints','balance'].includes(c.key)).every(c=>c.pass)?upper:lower).push(item.row);
 }
 return {upper,lower};
}
// Snapshot-volume pressure proxy, not trade-side flow or capital entering/leaving a company.
export function updatePressure(previous,row,at){
 const ts=Date.parse(at),event=Date.parse(row.price_at),volume=row.day_volume;
 if(!Number.isFinite(ts)||!Number.isFinite(event)||!positive(row.price)||!finite(volume)||volume<0||ts-event<0||ts-event>60000)return previous??null;
 if(previous&&ts<=previous.at)return previous;
 const sample={at:ts,price:row.price,volume};
 if(!previous||ts-previous.at>90000||volume<previous.volume||new Date(ts).toISOString().slice(0,10)!==new Date(previous.at).toISOString().slice(0,10))return {...sample,segments:[]};
 const delta=volume-previous.volume,dollars=delta*(row.price+previous.price)/2;
 const side=row.price>previous.price?'up':row.price<previous.price?'down':'flat';
 const segments=[...(previous.segments??[]).filter(x=>ts-x.at<=300000),...(delta>0?[{at:ts,dollars,side}]:[])];
 return {...sample,segments};
}
export function pressureSummary(state,now=Date.now()){
 if(!state||now-state.at>90000)return {status:'UNKNOWN',label:'غير متاح',up:null,down:null,flat:null,net:null};
 const samples=state.segments.filter(x=>now-x.at<=300000),sum=side=>samples.filter(x=>x.side===side).reduce((s,x)=>s+x.dollars,0),up=sum('up'),down=sum('down'),flat=sum('flat'),total=up+down+flat;
 if(samples.length<3||total<=0)return {status:'WARMUP',label:'تجميع عينات',up,down,flat,net:null};
 const net=up-down,classified=(up+down)/total;
 const status=classified<.6?'UNCLEAR':net/total>.15?'IN':net/total<-.15?'OUT':'BALANCED';
 return {status,label:{IN:'↗ ضغط شراء تقديري',OUT:'↘ ضغط بيع تقديري',BALANCED:'↔ متوازن',UNCLEAR:'اتجاه غير واضح'}[status],up,down,flat,net,samples:samples.length,coverage:classified};
}
export function shariaStatus(record,now=Date.now()){
 const unknown={status:'UNKNOWN',icon:'؟',label:'الامتثال الشرعي غير متحقق',source:null};
 if(!record||!['COMPLIANT','NON_COMPLIANT'].includes(record.status)||!record.methodology||!record.source||!/^https:\/\//.test(record.source_url??'')||elapsed(record.reviewed_at,now)<0||elapsed(record.reviewed_at,now)>90*86400000||!Number.isFinite(Date.parse(record.valid_until))||Date.parse(record.valid_until)<now)return unknown;
 return {...record,icon:record.status==='COMPLIANT'?'✓':'×',label:record.status==='COMPLIANT'?'مطابق وفق الفحص الموثق':'غير مطابق وفق الفحص الموثق'};
}

// Trade and quote clocks advance independently. A slow scan cannot roll either back.
const nyDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
export const marketDate=at=>Number.isFinite(Date.parse(at))?nyDate.format(new Date(at)):null;
const stamp=at=>Number.isFinite(Date.parse(at))?Date.parse(at):-Infinity;
export function mergeMarketRow(current,incoming,{scan=false,now=Date.now()}={}){
 const result=scan?{...incoming}:{...current};
 const validTrade=r=>positive(r?.price)&&stamp(r.price_at)>-Infinity&&stamp(r.price_at)<=now;
 const validQuote=r=>positive(r?.bid)&&positive(r?.ask)&&r.bid<=r.ask&&stamp(r.quote_at)>-Infinity&&stamp(r.quote_at)<=now;
 const trade=validTrade(incoming)&&(!validTrade(current)||stamp(incoming.price_at)>=stamp(current.price_at))?incoming:validTrade(current)?current:null;
 const quote=validQuote(incoming)&&(!validQuote(current)||stamp(incoming.quote_at)>=stamp(current.quote_at))?incoming:validQuote(current)?current:null;
 result.price=trade?.price??null;result.price_at=trade?.price_at??null;
 result.quote_at=quote?.quote_at??null;result.bid=quote?.bid??null;result.ask=quote?.ask??null;
 result.spread_pct=quote?(quote.ask-quote.bid)/((quote.ask+quote.bid)/2)*100:null;
 const session=marketDate(scan?incoming.scan_at:current?.scan_at);
 result.day_change=session&&session===marketDate(result.price_at)&&positive(result.previous_close)?(result.price/result.previous_close-1)*100:null;
 // Keep the scan's technical extension flag; day extension is recomputed from the live price.
 return result;
}
