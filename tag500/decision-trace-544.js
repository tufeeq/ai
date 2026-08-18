'use strict';
(function(){
  const RELEASE='TAG544';
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const pct=v=>Number.isFinite(+v)?`${+v>=0?'+':''}${(+v).toFixed(1)}%`:'—';
  const num=v=>Number.isFinite(+v)?+v:null;
  function action(z){return z?.actionability?.code||'X';}
  function origin(z){return z?.signalOrigin?.class||z?.originClass||'UNKNOWN';}
  function temporal(z){return z?.centralTemporal||z?.temporal||{};}
  function catalyst(z){return z?.catalystClock||z?.catalystTimeline||{};}
  function eligible(z){const h=window.TAG500ExecutiveView?.runtimeHealth?.();return Boolean((h?.ok??true)&&z?.valid===true&&z?.sharia==='VERIFIED'&&['A','B'].includes(action(z)));}
  function training(z){const m=window.sourceMeta||{};const r=['RECONCILED','MATCHED','FINAL_RECONCILED','VERIFIED_FINAL'].includes(String(m.reconciliation||m.finalSnapshotReconciliation||'').toUpperCase());return Boolean(r&&Number(m.independentSourceCount||0)>=2&&m.trainingEligible!==false&&z?.dataComplete!==false);}
  function whyNow(z){
    const bits=[],t=temporal(z),c=catalyst(z),o=origin(z);
    if(['EARLY','EARLY_CONFIRMED','EARLY_PENDING'].includes(o)) bits.push('أصل الإشارة مبكر');
    if(Number.isFinite(num(t.slope))&&num(t.slope)>0) bits.push(`Persistence ${num(t.slope).toFixed(1)} ن/س`);
    if(Number.isFinite(num(t.retention))&&num(t.retention)>=0.65) bits.push(`Retention ${(num(t.retention)*100).toFixed(0)}%`);
    if(Number.isFinite(num(z.rvol))&&num(z.rvol)>=2) bits.push(`RVOL ${num(z.rvol).toFixed(1)}×`);
    if(Number.isFinite(num(z.turnover))&&num(z.turnover)>=0.5) bits.push(`Float ${num(z.turnover).toFixed(1)}×`);
    const code=String(c.code||z?.catalystCode||'');
    if(['FRESH_PRE_SIGNAL','RECENT_PRE_SIGNAL'].includes(code)) bits.push('محفز صحيح التوقيت');
    else if(['NO_RELEVANT_NEWS_VERIFIED','NO_NEWS_VERIFIED','NO_RELEVANT_NEWS','NO_NEWS'].includes(code)) bits.push('No-News path موثق');
    return bits.slice(0,4);
  }
  function blockers(z){
    const out=[],m=window.sourceMeta||{},c=catalyst(z);
    if(m.fresh===false) out.push('لقطة سوق قديمة');
    if(m.sessionAligned===false) out.push('جلسة المصدر غير متطابقة');
    if(z?.sharia==='UNVERIFIED') out.push('شرعية غير متحققة');
    if(z?.sharia==='EXCLUDED') out.push('مستبعد شرعيًا');
    if(['LATE','VERY_LATE'].includes(origin(z))) out.push('أصل الإشارة متأخر');
    if(z?.stage==='EXHAUSTION') out.push('إنهاك');
    if(z?.dataComplete===false||z?.stage==='DATA_INSUFFICIENT') out.push('مدخلات ناقصة');
    if(c?.code==='ENRICHMENT_STALE'||z?.enrichmentFresh===false) out.push('Catalyst sweep قديم/غير متزامن');
    if(c?.attributionError===true||c?.code==='POST_SIGNAL_ONLY') out.push('Catalyst Attribution Error');
    if(!['A','B'].includes(action(z))&&z?.sharia==='VERIFIED') out.push(`Actionability ${action(z)}`);
    const cq=z?.catalystQuality||{}; if(cq?.eligible===false) out.push('المحفز غير مؤهل للـscore');
    return out.slice(0,4);
  }
  function card(z,rank){
    const yes=eligible(z),train=training(z),now=whyNow(z),no=blockers(z);
    return `<article class="dt-card ${yes?'dt-ok':'dt-watch'}"><div class="dt-head"><div><span class="dt-rank">#${rank}</span> <strong>${esc(z.ticker)}</strong> <span class="dt-stage">${esc(z.stage||'—')}</span></div><strong>${Number.isFinite(num(z.score))?Math.round(num(z.score)):'—'}</strong></div><div class="dt-meta"><span>${pct(z.changePct)}</span><span>${esc(origin(z))}</span><span>Action ${esc(action(z))}</span><span>${yes?'تنفيذي':'بحث/مراقبة'}</span><span>${train?'Training ✓':'Training blocked'}</span></div><div class="dt-cols"><div><b>لماذا الآن</b><p>${now.length?now.map(esc).join(' · '):'لا يوجد تأكيد مبكر كافٍ بعد'}</p></div><div><b>ما الذي يمنعها</b><p>${no.length?no.map(esc).join(' · '):'لا يوجد مانع رئيسي ظاهر'}</p></div></div></article>`;
  }
  function renderTrace(){
    const all=Array.isArray(window.analyzed)?window.analyzed:[];let host=document.querySelector('#decisionTrace544')||document.querySelector('#decisionTrace543');
    if(!host){host=document.createElement('section');host.className='panel decision-trace';const a=document.querySelector('#radarSection')||document.querySelector('#opportunities');a?.parentNode?.insertBefore(host,a?.nextSibling||null);} host.id='decisionTrace544';
    const ranked=[...all].sort((a,b)=>{const ea=eligible(a)?1:0,eb=eligible(b)?1:0;if(eb!==ea)return eb-ea;const aa=['A','B'].includes(action(a))?1:0,ab=['A','B'].includes(action(b))?1:0;if(ab!==aa)return ab-aa;return(num(b.score)??-1)-(num(a.score)??-1);}).slice(0,3);
    const m=window.sourceMeta||{};const status=`${m.fresh===false?'STALE':'Freshness ✓'} · ${m.sessionAligned===false?'SESSION MISMATCH':'Session ✓'} · Sources ${Number(m.independentSourceCount||0)} · ${esc(m.reconciliation||m.finalSnapshotReconciliation||'Reconciliation pending')}`;
    host.innerHTML=`<div class="section-head"><div><h3>مسار القرار — Decision Trace</h3><p>يلخّص سبب القوة وسبب الحجب، بما في ذلك No-News الموثق وحداثة Catalyst sweep. لا يحوّل intraperiod إلى حقيقة تدريبية.</p></div><span class="dt-status">${status}</span></div><div class="dt-grid">${ranked.length?ranked.map((z,i)=>card(z,i+1)).join(''):'<div class="empty">لا توجد حالات قابلة للعرض بعد.</div>'}</div>`;
  }
  const baseRender=window.render;if(typeof baseRender==='function'&&!baseRender.__tag544){const wrapped=function(){const r=baseRender.apply(this,arguments);queueMicrotask(renderTrace);return r;};wrapped.__tag544=true;window.render=wrapped;}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>queueMicrotask(renderTrace));else queueMicrotask(renderTrace);
  window.addEventListener('tag500:runtime-ready',renderTrace);
  window.TAG500DecisionTrace={release:RELEASE,render:renderTrace};
})();