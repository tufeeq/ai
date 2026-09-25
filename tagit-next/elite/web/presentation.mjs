// Display evidence only. These helpers do not change stored movement states or trading rules.
export const changePct=(price,reference)=>Number.isFinite(price)&&reference>0?(price/reference-1)*100:null;
export function priceEvidence(o,at=Date.now(),live=true){
 const t=o.lastTrade,valid=live&&t?.price>0&&Date.parse(t.at)<=at&&Date.parse(t.received_at)<=at&&Date.parse(t.at)>=Date.parse(o.price_at)+60000;
 const price=valid?t.price:o.current_price,stamp=valid?t.at:o.price_at;
 const age=Math.max(0,at-Date.parse(stamp)-(valid?0:60000));
 return {price,at:stamp,kind:valid?'TRADE':'MINUTE_CLOSE',ageMs:Number.isFinite(age)?age:null,stale:live&&age>90000,change:changePct(price,o.first_price)};
}
export function reviewEvidence(o,at=Date.now(),live=true){
 const reasons=[];
 if(o.blocking?.includes('CORPORATE_ACTION_UNRECONCILED'))reasons.push('CORPORATE_ACTION');
 if((o.quality?.contiguousBars??0)<3)reasons.push('GAPS');
 if(live&&at-(Date.parse(o.price_at)+60000)>90000)reasons.push('STALE');
 const paused=reasons.length>0;
 const price=priceEvidence(o,at,live);
 return {paused,reasons,change:price.change,belowFirst:price.change<0,
   title:paused?'تقييم المرحلة معلّق':o.state==='DETECTED'?'اكتشاف محفوظ · الحركة لم تتأكد':'آخر مرحلة مؤكدة بالقواعد',
   explanation:paused?(reasons.includes('GAPS')?'الشموع الأخيرة غير متصلة؛ لا تكفي لتأكيد انتقال المرحلة.':'لا تتوفر بيانات حديثة كافية لتحديث المرحلة.'):
    o.pendingState?`الانتقال التالي ينتظر اكتمال التأكيد (${o.pendingCount??0} من 2 إغلاق).`:
    o.state==='DETECTED'?'ظهر نشاط عند الاكتشاف؛ لم تتحقق شروط مرحلة جديدة بعد.':'المرحلة محسوبة من الشموع المكتملة، والسعر الأخير يعرض بصورة مستقلة.'};
}
export function visibleBars(o,cutoff){return (o.bars||[]).filter(b=>b[0]+60000<=cutoff&&(!Number.isFinite(b[6])||b[6]<=cutoff));}
export function newsEvidence(n){return /\bstocks\b.*\bmoving\b|\bstocks\b.*\bpremarket\b/i.test(n.headline||'')?'MARKET_ROUNDUP':'PROVIDER_LINKED';}
export function safeNewsUrl(url){try{const u=new URL(url);return u.protocol==='https:'?u.href:null;}catch{return null;}}

// Outcomes are observed minute-close changes from the original detection price, not fills.
export const horizons=[1,5,15,30,60];
export function forwardEvidence(o,minutes,cutoff=Date.now()){
 const first=Date.parse(o.first_at),target=first+minutes*60000;
 if(!Number.isFinite(first)||!(o.first_price>0))return {status:'UNKNOWN'};
 if(target>cutoff)return {status:'PENDING'};
 const end=Math.ceil(target/60000)*60000;
 if(end>cutoff)return {status:'PENDING'};
 const candidates=visibleBars(o,cutoff).filter(b=>b[0]+60000===end&&Number.isFinite(b[4])&&b[4]>0);
 // Conflicting revisions cannot be resolved from the public candle snapshot.
 if(!candidates.length||new Set(candidates.map(b=>b[4])).size>1)return {status:'UNKNOWN'};
 const b=candidates[0];
 return {status:'OBSERVED',change:changePct(b[4],o.first_price),price:b[4],at:new Date(end).toISOString(),receivedAt:b[6]?new Date(b[6]).toISOString():null};
}
