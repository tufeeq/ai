'use strict';
(function(){
  const BUILD=()=>String(document.body?.dataset?.tagRelease||'TAG500');
  const REFRESH_MS=2*60*1000;
  const STARTUP_RETRY_MS=30*1000;
  const STALE_MIN=20;
  let busy=false,lastAttempt=0,lastSuccess=0,lastError='',failures=0;
  const baseLoad=window.loadData;

  function etParts(ts){
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date(ts||Date.now())).map(p=>[p.type,p.value]));
  }
  function premarketStartupWindow(){
    const p=etParts(Date.now());
    if(['Sat','Sun'].includes(p.weekday)) return false;
    const m=Number(p.hour)*60+Number(p.minute);
    return m>=240&&m<250;
  }
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
    const state=window.TAG500State||{};
    const canonicalRows=Array.isArray(state.rows)?state.rows:(Array.isArray(window.rows)?window.rows:[]);
    const hasRows=canonicalRows.length>0;
    const failed=meta.dataOrigin==='failed'||meta.name==='none'||!meta.updated||!hasRows;
    const age=ageMinutes();
    const stale=age===null||age>STALE_MIN||meta.fresh===false;
    const startupGrace=Boolean(premarketStartupWindow()&&(failed||!hasRows||meta.sessionAligned===false||meta.sourceSession==='CLOSED'||meta.sourceSession==='FINAL'));
    return {ok:!failed&&!stale&&!startupGrace,failed,stale,startupGrace,age,hasRows,origin:meta.dataOrigin||'unknown'};
  }
  function health(){
    const outcome=loadOutcome();
    return {build:BUILD(),busy,lastAttempt,lastSuccess,lastError,failures,ageMinutes:outcome.age,stale:outcome.stale,startupGrace:outcome.startupGrace,source:sourceName(),dataOrigin:outcome.origin,hasRows:outcome.hasRows};
  }
  function esc(v){return String(v??'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));}
  function paint(reason){
    const h=health();
    const badge=document.querySelector('#dataBadge');
    const note=document.querySelector('#refresh530Note');
    if(badge){
      badge.title=`${BUILD()} · source=${h.source} · age=${h.ageMinutes===null?'?':h.ageMinutes.toFixed(1)+'m'} · failures=${h.failures}`;
      if(h.stale||h.failures>0||!h.hasRows||h.startupGrace) badge.classList.remove('live');
      if(h.startupGrace) badge.textContent='● PRE: بانتظار أول لقطة جلسة جديدة';
    }
    if(note){
      const age=h.ageMinutes===null?'غير معروف':h.ageMinutes.toFixed(1)+'د';
      const ok=h.lastSuccess?new Date(h.lastSuccess).toLocaleTimeString('ar-SA'):'—';
      const attempt=h.lastAttempt?new Date(h.lastAttempt).toLocaleTimeString('ar-SA'):'—';
      const state=h.startupGrace?'⏳ بداية Pre-market — بانتظار أول لقطة PM حديثة؛ التنفيذ محجوب':!h.hasRows?'⚠ لا توجد بيانات سوق قابلة للاستخدام':h.stale?'⚠ البيانات قديمة/غير مؤرخة':h.failures?'⚠ آخر تحديث لم ينتج لقطة صالحة':'✓ التحديث سليم';
      note.innerHTML=`<strong>${state}</strong> · عمر اللقطة ${age} · آخر نجاح فعلي ${ok} · آخر محاولة ${attempt} · المصدر ${esc(h.source)}${h.failures?` · إخفاقات متتالية ${h.failures}`:''}${reason?' · '+esc(reason):''}${h.lastError?`<br><small>${esc(h.lastError)}</small>`:''}`;
    }
  }
  async function trackedLoad(){
    if(typeof baseLoad!=='function') throw new Error('LOAD_DATA_UNAVAILABLE');
    lastAttempt=Date.now();
    const out=await baseLoad.apply(this,arguments);
    const outcome=loadOutcome();
    if(outcome.startupGrace){
      lastError='WAITING_FIRST_PREMARKET_SNAPSHOT';
      failures=0;
      paint('إعادة المحاولة السريعة مفعلة حتى تصل أول لقطة PM');
      return out;
    }
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
    catch(e){
      const startup=premarketStartupWindow();
      if(startup){failures=0;lastError='WAITING_FIRST_PREMARKET_SNAPSHOT';paint('أول لقطة PM لم تصل بعد');}
      else{failures+=1;lastError=e?.message||String(e);paint('فشل التحديث');console.error(BUILD()+' refresh failed',e);}
    }
    finally{busy=false;paint(reason);}
  }
  function mount(){
    document.querySelector('#refresh517Note')?.remove();
    if(!document.querySelector('#refresh530Note')){
      const status=document.querySelector('#finvizStatus');
      if(status){
        const n=document.createElement('div');n.id='refresh530Note';n.className='release-note';n.style.marginTop='6px';n.textContent=BUILD()+' · Refresh Health يتحقق من صلاحية اللقطة، لا مجرد اكتمال الطلب';status.after(n);
      }
    }
    setInterval(()=>{if(document.visibilityState==='visible') guardedRefresh('تحديث دوري'); else paint('الصفحة بالخلفية');},REFRESH_MS);
    setInterval(()=>{const o=loadOutcome();if(document.visibilityState==='visible'&&o.startupGrace) guardedRefresh('Cold-start retry 30s');},STARTUP_RETRY_MS);
    setInterval(()=>paint(''),15000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastAttempt>60*1000) guardedRefresh('عودة للصفحة');});
    window.addEventListener('focus',()=>{if(Date.now()-lastAttempt>60*1000) guardedRefresh('عودة للنافذة');});
    paint('جاهز');
  }
  if(typeof baseLoad==='function') window.loadData=trackedLoad;
  window.TAG500RefreshHealth={get build(){return BUILD();},getState:health,refresh:guardedRefresh,premarketStartupWindow};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
