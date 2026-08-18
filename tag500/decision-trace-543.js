'use strict';
(function(){
  const RELEASE='TAG543';
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const pct=v=>Number.isFinite(+v)?`${+v>=0?'+':''}${(+v).toFixed(1)}%`:'—';
  const num=v=>Number.isFinite(+v)?+v:null;
  function action(z){return z?.actionability?.code||'X';}
  function origin(z){return z?.signalOrigin?.class||z?.originClass||'UNKNOWN';}
  function temporal(z){return z?.centralTemporal||z?.temporal||{};}
  function catalyst(z){return z?.catalystTimeline||z?.catalystClock||{};}
  function eligible(z){
    const health=window.TAG500ExecutiveView?.runtimeHealth?.();
    return Boolean((health?.ok??true)&&z?.valid===true&&z?.sharia==='VERIFIED'&&['A','B'].includes(action(z)));
  }
  function training(z){
    const meta=window.sourceMeta||{};
    const reconciled=['RECONCILED','MATCHED','FINAL_RECONCILED','VERIFIED_FINAL'].includes(String(meta.reconciliation||meta.finalSnapshotReconciliation||'').toUpperCase());
    const sources=Number(meta.independentSourceCount||0);
    return Boolean(reconciled&&sources>=2&&meta.trainingEligible!==false&&z?.dataComplete!==false);
  }
  function whyNow(z){
    const bits=[]; const t=temporal(z); const c=catalyst(z);
    const o=origin(z);
    if(o==='EARLY'||o==='EARLY_CONFIRMED'||o==='EARLY_PENDING') bits.push('أصل الإشارة مبكر');
    if(Number.isFinite(num(t.slope))&&num(t.slope)>0) bits.push(`Persistence ${num(t.slope).toFixed(1)} ن/س`);
    if(Number.isFinite(num(t.retention))&&num(t.retention)>=0.65) bits.push(`Retention ${(num(t.retention)*100).toFixed(0)}%`);
    if(Number.isFinite(num(z.rvol))&&num(z.rvol)>=2) bits.push(`RVOL ${num(z.rvol).toFixed(1)}×`);
    if(Number.isFinite(num(z.turnover))&&num(z.turnover)>=0.5) bits.push(`Float ${num(z.turnover).toFixed(1)}×`);
    const code=String(c.code||z?.catalystCode||'');
    if(['FRESH_PRE_SIGNAL','RECENT_PRE_SIGNAL'].includes(code)) bits.push('محفز صحيح التوقيت');
    else if(code==='NO_RELEVANT_NEWS'||code==='NO_NEWS') bits.push('No-News path');
    return bits.slice(0,4);
  }
  function blockers(z){
    const out=[]; const meta=window.sourceMeta||{};
    if(meta.fresh===false) out.push('لقطة سوق قديمة');
    if(meta.sessionAligned===false) out.push('جلسة المصدر غير متطابقة');
    if(z?.sharia==='UNVERIFIED') out.push('شرعية غير متحققة');
    if(z?.sharia==='EXCLUDED') out.push('مستبعد شرعيًا');
    if(['LATE','VERY_LATE'].includes(origin(z))) out.push('أصل الإشارة متأخر');
    if(z?.stage==='EXHAUSTION') out.push('إنهاك');
    if(z?.dataComplete===false||z?.stage==='DATA_INSUFFICIENT') out.push('مدخلات ناقصة');
    if(!['A','B'].includes(action(z))&&z?.sharia==='VERIFIED') out.push(`Actionability ${action(z)}`);
    const cq=z?.catalystQuality||{}; if(cq?.eligible===false) out.push('المحفز غير مؤهل للـscore');
    return out.slice(0,4);
  }
  function card(z,rank){
    const yes=eligible(z), train=training(z), now=whyNow(z), no=blockers(z);
    return `<article class="dt-card ${yes?'dt-ok':'dt-watch'}">
      <div class="dt-head"><div><span class="dt-rank">#${rank}</span> <strong>${esc(z.ticker)}</strong> <span class="dt-stage">${esc(z.stage||'—')}</span></div><strong>${Number.isFinite(num(z.score))?Math.round(num(z.score)):'—'}</strong></div>
      <div class="dt-meta"><span>${pct(z.changePct)}</span><span>${esc(origin(z))}</span><span>Action ${esc(action(z))}</span><span>${yes?'تنفيذي':'بحث/مراقبة'}</span><span>${train?'Training ✓':'Training blocked'}</span></div>
      <div class="dt-cols"><div><b>لماذا الآن</b><p>${now.length?now.map(esc).join(' · '):'لا يوجد تأكيد مبكر كافٍ بعد'}</p></div><div><b>ما الذي يمنعها</b><p>${no.length?no.map(esc).join(' · '):'لا يوجد مانع رئيسي ظاهر'}</p></div></div>
    </article>`;
  }
  function renderTrace(){
    const all=Array.isArray(window.analyzed)?window.analyzed:[];
    let host=document.querySelector('#decisionTrace543');
    if(!host){
      host=document.createElement('section'); host.id='decisionTrace543'; host.className='panel decision-trace';
      const anchor=document.querySelector('#radarSection')||document.querySelector('#opportunities');
      anchor?.parentNode?.insertBefore(host,anchor?.nextSibling||null);
    }
    const ranked=[...all].sort((a,b)=>{
      const ea=eligible(a)?1:0, eb=eligible(b)?1:0; if(eb!==ea)return eb-ea;
      const aa=['A','B'].includes(action(a))?1:0, ab=['A','B'].includes(action(b))?1:0; if(ab!==aa)return ab-aa;
      return (num(b.score)??-1)-(num(a.score)??-1);
    }).slice(0,3);
    const meta=window.sourceMeta||{};
    const status=`${meta.fresh===false?'STALE':'Freshness ✓'} · ${meta.sessionAligned===false?'SESSION MISMATCH':'Session ✓'} · Sources ${Number(meta.independentSourceCount||0)} · ${esc(meta.reconciliation||meta.finalSnapshotReconciliation||'Reconciliation pending')}`;
    host.innerHTML=`<div class="section-head"><div><h3>مسار القرار — Decision Trace</h3><p>يجمع أصل الإشارة، Persistence، المحفز، الشرعية وسلامة البيانات في مكان واحد. لا يحوّل intraperiod إلى حقيقة تدريبية.</p></div><span class="dt-status">${status}</span></div><div class="dt-grid">${ranked.length?ranked.map((z,i)=>card(z,i+1)).join(''):'<div class="empty">لا توجد حالات قابلة للعرض بعد.</div>'}</div>`;
  }
  const baseRender=window.render;
  if(typeof baseRender==='function'&&!baseRender.__tag543){
    const wrapped=function(){const r=baseRender.apply(this,arguments);queueMicrotask(renderTrace);return r;}; wrapped.__tag543=true; window.render=wrapped;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>queueMicrotask(renderTrace));else queueMicrotask(renderTrace);
  window.addEventListener('tag500:runtime-ready',renderTrace);
  window.TAG500DecisionTrace={release:RELEASE,render:renderTrace};
})();