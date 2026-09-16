// Pure opportunity assessment and observation accounting; never a fill simulator.
export const finite=x=>typeof x==='number'&&Number.isFinite(x);
export const positive=x=>finite(x)&&x>0;
export const elapsed=(at,now)=>{const t=Date.parse(at);return Number.isFinite(t)?now-t:Infinity;};
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
 let state=livePlan?'READY':row.extended?'EXTENDED':!recentScan||!checks.find(c=>c.key==='trade').pass?'STALE':s?.expansion?'CONFIRM':'WATCH';
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
