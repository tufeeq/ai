'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json';
 const KEY='tagx-v35-continuation-proof';
 const MIN_CONFIRM_MIN=3, MAX_CONFIRM_MIN=18, MIN_EXTENSION=0.8, MAX_DRAWDOWN=-1.5;
 const n=v=>Number.isFinite(Number(v))?Number(v):null;
 const ageMin=t=>{const x=t?(Date.now()-new Date(t).getTime())/60000:1e9;return Number.isFinite(x)?x:1e9};
 function load(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}}
 function save(x){try{localStorage.setItem(KEY,JSON.stringify(x))}catch{}}
 let latest=null,approved=new Set(),detail=new Map();
 function update(live){
   latest=live;const st=load(),now=Date.now(),raw=Array.isArray(live.emergingCandidates)?live.emergingCandidates:[];
   approved=new Set();detail=new Map();
   for(const e of raw){
     const t=String(e.ticker||'').toUpperCase(),p=n(e.price),ch=n(e.changePct),v5=n(e.priceVelocity5mPct),v15=n(e.priceVelocity15mPct),va=n(e.volumeAcceleration5m),to=n(e.turnover5mPctFloat);
     if(!t||p==null)continue;
     let s=st[t];
     if(!s||!s.firstTs||now-new Date(s.firstTs).getTime()>6*3600000)s={firstTs:new Date().toISOString(),firstPrice:p,minPrice:p,maxPrice:p,obs:0};
     s.obs=(s.obs||0)+1;s.minPrice=Math.min(n(s.minPrice)??p,p);s.maxPrice=Math.max(n(s.maxPrice)??p,p);s.lastPrice=p;s.lastTs=new Date().toISOString();st[t]=s;
     const elapsed=(now-new Date(s.firstTs).getTime())/60000,ext=(p/s.firstPrice-1)*100,dd=(s.minPrice/s.firstPrice-1)*100;
     const fresh=ageMin(live.updatedAtUTC||live.updatedAtET)<=5&&String(live.dataConfidence||'').toUpperCase()==='HIGH';
     const independent=!!window.TAGXIndependenceV31?.isApproved?.(t);
     const timing=elapsed>=MIN_CONFIRM_MIN&&elapsed<=MAX_CONFIRM_MIN&&s.obs>=2;
     const displacement=ch!=null&&ch>=1.5&&ch<=8.0;
     const continuation=v5!=null&&v15!=null&&v5>=0.35&&v15>=0.20&&ext>=MIN_EXTENSION&&dd>=MAX_DRAWDOWN;
     const structure=(va!=null&&va>=2)||(to!=null&&to>=0.25);
     const pass=fresh&&independent&&timing&&displacement&&continuation&&structure;
     if(pass)approved.add(t);
     const reasons=[];if(!fresh)reasons.push('stale/low-confidence feed');if(!independent)reasons.push('independent confirmation missing');if(!timing)reasons.push('needs 3–18m confirmation window');if(!displacement)reasons.push('outside +1.5% to +8% entry window');if(!continuation)reasons.push('post-detection continuation not proven');if(!structure)reasons.push('volume/float confirmation missing');
     detail.set(t,{pass,elapsed,ext,dd,obs:s.obs,reasons});
   }
   for(const [t,s] of Object.entries(st))if(s.lastTs&&now-new Date(s.lastTs).getTime()>6*3600000)delete st[t];save(st);render(live);
 }
 function render(live){
   let sec=document.querySelector('[data-contproof35]');if(!sec){sec=document.createElement('section');sec.dataset.contproof35='1';sec.className='hero';const v=document.querySelector('#tradesView');if(v)v.prepend(sec)}
   const rows=[...detail.entries()].sort((a,b)=>(b[1].pass-a[1].pass)||b[1].ext-a[1].ext).slice(0,8),age=ageMin(live.updatedAtUTC||live.updatedAtET);
   sec.innerHTML='<h2>Continuation Proof Gate · V35</h2><p>الاكتشاف لا يفتح صفقة. السهم يجب أن يثبت امتدادًا بعد أول رصد، دون drawdown مبكر، خلال نافذة تأكيد سببية قبل أن يصبح LAB-eligible.</p><div class="status"><span class="chip '+(age<=5?'ok':'bad')+'">Feed '+Math.round(age)+'m</span><span class="chip">'+approved.size+' confirmed</span><span class="chip warn">Watch → Prove → Enter</span></div><div class="opps">'+(rows.length?rows.map(([t,x])=>'<article class="opp '+(x.pass?'best':'')+'"><div class="rank">'+(x.pass?'CONTINUATION PASS':'WAIT / REJECT')+'</div><div class="ticker">'+t+'</div><div class="meta">Observed '+x.elapsed.toFixed(1)+'m · post-detection '+(x.ext>=0?'+':'')+x.ext.toFixed(2)+'% · worst '+x.dd.toFixed(2)+'% · obs '+x.obs+'</div><div class="why">'+(x.pass?'Continuation proven after detection':x.reasons.join(' · '))+'</div></article>').join(''):'<div class="empty">لا توجد مرشحات يمكن تقييم استمرارها الآن.</div>')+'</div>';
 }
 const base=window.processTrades;
 if(typeof base==='function')window.processTrades=function(){
   const old=window.eligible;
   try{window.eligible=function(x){const t=String(x?.Ticker||x?.ticker||'').toUpperCase();return !!old?.(x)&&approved.has(t)};return base()}
   finally{window.eligible=old}
 };
 async function sync(){try{const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('live '+r.status);update(await r.json());if(typeof window.processTrades==='function')window.processTrades()}catch(e){approved=new Set();console.warn('TAGX V35 fail-closed',e)}}
 window.TAGXContinuationProofV35={sync,isApproved:t=>approved.has(String(t||'').toUpperCase()),detail:t=>detail.get(String(t||'').toUpperCase())};sync();setInterval(sync,30000);
})();