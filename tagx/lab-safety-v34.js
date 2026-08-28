'use strict';
(function(){
 const KEY='tagx-lab-safety-v34';
 const MAX_DAILY_ENTRIES=6, MAX_OPEN=2, COOLDOWN_MIN=45;
 const n=v=>Number.isFinite(Number(v))?Number(v):null;
 const today=()=>new Date().toISOString().slice(0,10);
 function state(){try{const x=JSON.parse(localStorage.getItem(KEY)||'{}');if(x.day!==today())return {day:today(),entries:0,lastEntry:{}};return x}catch{return {day:today(),entries:0,lastEntry:{}}}}
 function save(x){try{localStorage.setItem(KEY,JSON.stringify(x))}catch{}}
 function existingTrades(){try{return JSON.parse(localStorage.getItem('tagx-trades')||'[]')}catch{return []}}
 function outcomeHealth(){
   try{const el=document.querySelector('[data-calibration30]');const txt=el?.textContent||'';return !/Calibration warning/i.test(txt)}catch{return false}
 }
 function assess(x){
   const t=String(x?.Ticker||x?.ticker||'').toUpperCase();
   const live=window.TAGXIndependenceV31?.latest?.();
   const e=(live?.emergingCandidates||[]).find(z=>String(z.ticker||'').toUpperCase()===t);
   const ch=n(e?.changePct??x?.Change),v5=n(e?.priceVelocity5mPct),v15=n(e?.priceVelocity15mPct),va=n(e?.volumeAcceleration5m),to=n(e?.turnover5mPctFloat);
   const independent=!!window.TAGXIndependenceV31?.isApproved?.(t);
   const early=ch!=null&&ch>=1.5&&ch<=9.5;
   const continuation=v5!=null&&v15!=null&&v5>=0.45&&v15>=0.20;
   const liquidity=(va!=null&&va>=2)||(to!=null&&to>=0.25);
   const reasons=[]; if(!independent)reasons.push('independent gate');if(!early)reasons.push('entry displacement');if(!continuation)reasons.push('5m/15m continuation');if(!liquidity)reasons.push('volume/float confirmation');
   return {pass:independent&&early&&continuation&&liquidity,reasons};
 }
 const base=window.processTrades;
 if(typeof base==='function')window.processTrades=function(){
   const st=state(),tr=existingTrades(),open=tr.filter(z=>String(z.status||'').toLowerCase()==='open').length;
   if(st.entries>=MAX_DAILY_ENTRIES||open>=MAX_OPEN)return;
   const old=window.eligible;
   try{window.eligible=function(x){
     if(!old?.(x))return false;const t=String(x?.Ticker||'').toUpperCase(),a=assess(x);if(!a.pass)return false;
     const last=st.lastEntry[t]?new Date(st.lastEntry[t]).getTime():0;if(last&&Date.now()-last<COOLDOWN_MIN*60000)return false;
     return true;
   };const before=existingTrades().length,res=base(),afterTrades=existingTrades();
   if(afterTrades.length>before){for(const z of afterTrades.slice(before)){const t=String(z.ticker||z.Ticker||'').toUpperCase();st.entries++;st.lastEntry[t]=new Date().toISOString()}save(st)}return res;
   }finally{window.eligible=old}
 };
 function banner(){let s=document.querySelector('[data-labsafety34]');if(!s){s=document.createElement('section');s.dataset.labsafety34='1';s.className='hero';document.querySelector('#tradesView')?.prepend(s)}const st=state();s.innerHTML='<h2>LAB Safety V34 · Capital Preservation</h2><p>تم إيقاف over-trading: حد أقصى 6 دخولات/جلسة، صفقتان مفتوحتان، و45 دقيقة cooldown للسهم. الدخول يحتاج Independent PASS + حركة 1.5–9.5% فقط + استمرار موجب 5m/15m + تأكيد volume/float. الاكتشاف وحده لا يعني BUY.</p><div class="status"><span class="chip">Entries '+st.entries+'/'+MAX_DAILY_ENTRIES+'</span><span class="chip warn">Research / Paper only</span></div>'}
 window.TAGXLabSafetyV34={assess,state};banner();
})();