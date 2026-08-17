'use strict';
(function(){
  const BUILD='TAG530';
  const REFRESH_MS=2*60*1000;
  const STALE_MIN=20;
  let busy=false,lastAttempt=0,lastSuccess=0,lastError='',failures=0;
  const baseLoad=window.loadData;

  function ageMinutes(){
    const u=window.sourceMeta?.updated;
    if(!u) return null;
    const ts=new Date(u).getTime();
    return Number.isFinite(ts)?Math.max(0,(Date.now()-ts)/60000):null;
  }
  function sourceName(){
    return window.__TAG500_DATA_SOURCE__?.label||window.__TAG500_DATA_SOURCE__?.mode||window.sourceMeta?.dataOrigin||window.sourceMeta?.name||'غير معروف';
  }
  function loadOutcome(){
    const meta=window.sourceMeta||{};
    const hasRows=Array.isArray(window.rows)&&window.rows.length>0;
    const failed=meta.dataOrigin==='failed'||meta.name==='none'||!meta.updated||!hasRows;
    const age=ageMinutes();
    const stale=age===null||age>STALE_MIN||meta.fresh===false;
    return {ok:!failed&&!stale,failed,stale,age,hasRows,origin:meta.dataOrigin||'unknown'};
  }
  function health(){
    const outcome=loadOutcome();
    return {build:BUILD,busy,lastAttempt,lastSuccess,lastError,failures,ageMinutes:outcome.age,stale:outcome.stale,source:sourceName(),dataOrigin:outcome.origin,hasRows:outcome.hasRows};
  }
  function paint(reason){
    const h=health();
    const badge=document.querySelector('#dataBadge');
    const note=document.querySelector('#refresh530Note');
    if(badge){
      badge.title=`${BUILD} · source=${h.source} · age=${h.ageMinutes===null?'?':h.ageMinutes.toFixed(1)+'m'} · failures=${h.failures}`;
      if(h.stale||h.failures>0||!h.hasRows) badge.classList.remove('live');
    }
    if(note){
      const age=h.ageMinutes===null?'غير معروف':h.ageMinutes.toFixed(1)+'د';
      const ok=h.lastSuccess?new Date(h.lastSuccess).toLocaleTimeString('ar-SA'):'—';
      const attempt=h.lastAttempt?new Date(h.lastAttempt).toLocaleTimeString('ar-SA'):'—';
      const state=!h.hasRows?'⚠ لا توجد بيانات سوق قابلة للاستخدام':h.stale?'⚠ البيانات قديمة/غير مؤرخة':h.failures?'⚠ آخر تحديث لم ينتج لقطة صالحة':'✓ التحديث سليم';
      note.innerHTML=`<strong>${state}</strong> · عمر اللقطة ${age} · آخر نجاح فعلي ${ok} · آخر محاولة ${attempt} · المصدر ${h.source}${h.failures?` · إخفاقات متتالية ${h.failures}`:''}${reason?' · '+reason:''}${h.lastError?`<br><small>${String(h.lastError).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}</small>`:''}`;
    }
  }
  async function trackedLoad(){
    if(typeof baseLoad!=='function') throw new Error('LOAD_DATA_UNAVAILABLE');
    lastAttempt=Date.now();
    const out=await baseLoad.apply(this,arguments);
    const outcome=loadOutcome();
    if(!outcome.ok){
      failures+=1;
      lastError=outcome.failed?'DATA_ROUTE_FAILED_OR_EMPTY':outcome.stale?'STALE_MARKET_SNAPSHOT':'REFRESH_NOT_USABLE';
      paint('التحديث لم ينتج لقطة قابلة للاستخدام');
      return out;
    }
    lastSuccess=Date.now();failures=0;lastError='';
    paint('تم التحديث بنجاح');
    return out;
  }
  async function guardedRefresh(reason){
    if(busy||typeof window.loadData!=='function') return;
    busy=true;
    try{await window.loadData();}
    catch(e){failures+=1;lastError=e?.message||String(e);paint('فشل التحديث');console.error(BUILD+' refresh failed',e);}
    finally{busy=false;paint(reason);}
  }
  function mount(){
    document.querySelector('#refresh517Note')?.remove();
    if(!document.querySelector('#refresh530Note')){
      const status=document.querySelector('#finvizStatus');
      if(status){
        const n=document.createElement('div');n.id='refresh530Note';n.className='release-note';n.style.marginTop='6px';n.textContent=BUILD+' · Refresh Health يتحقق من صلاحية اللقطة، لا مجرد اكتمال الطلب';status.after(n);
      }
    }
    setInterval(()=>{if(document.visibilityState==='visible') guardedRefresh('تحديث دوري'); else paint('الصفحة بالخلفية');},REFRESH_MS);
    setInterval(()=>paint(''),15000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastAttempt>60*1000) guardedRefresh('عودة للصفحة');});
    window.addEventListener('focus',()=>{if(Date.now()-lastAttempt>60*1000) guardedRefresh('عودة للنافذة');});
    paint('جاهز');
  }
  if(typeof baseLoad==='function') window.loadData=trackedLoad;
  window.TAG500RefreshHealth={build:BUILD,getState:health,refresh:guardedRefresh};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();