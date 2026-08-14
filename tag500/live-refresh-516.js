'use strict';
(function(){
  const BUILD='TAG516';
  const REFRESH_MS=2*60*1000;
  let busy=false,lastRun=0;
  const baseLoad=window.loadData;
  async function guardedRefresh(reason){
    if(busy||typeof window.loadData!=='function') return;
    busy=true;lastRun=Date.now();
    try{await window.loadData();}
    catch(e){console.error(BUILD+' refresh failed',e);}
    finally{busy=false;updateAge(reason);}
  }
  function updateAge(reason){
    const b=document.querySelector('#dataBadge');
    const u=window.sourceMeta?.updated;
    if(!b||!u) return;
    const ts=new Date(u).getTime();
    if(!Number.isFinite(ts)) return;
    const age=Math.max(0,(Date.now()-ts)/60000);
    b.title=`${BUILD} · عمر اللقطة ${age.toFixed(1)} دقيقة · تحديث تلقائي كل دقيقتين عند ظهور الصفحة`;
    const note=document.querySelector('#refresh516Note');
    if(note) note.textContent=`عمر اللقطة الآن ${age.toFixed(1)}د · آخر فحص تلقائي ${lastRun?new Date(lastRun).toLocaleTimeString('ar-SA'):'—'}${reason?' · '+reason:''}`;
  }
  function mount(){
    if(!document.querySelector('#refresh516Note')){
      const status=document.querySelector('#finvizStatus');
      if(status){
        const n=document.createElement('div');n.id='refresh516Note';n.className='release-note';n.style.marginTop='6px';n.textContent='TAG516 · مراقبة حداثة البيانات مفعلة';status.after(n);
      }
    }
    setInterval(()=>{if(document.visibilityState==='visible') guardedRefresh('تحديث دوري'); else updateAge('الصفحة بالخلفية');},REFRESH_MS);
    setInterval(()=>updateAge(''),15*1000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastRun>60*1000) guardedRefresh('عودة للصفحة');});
    window.addEventListener('focus',()=>{if(Date.now()-lastRun>60*1000) guardedRefresh('عودة للنافذة');});
    updateAge('جاهز');
  }
  if(typeof baseLoad==='function'){
    window.loadData=async function(){const r=await baseLoad.apply(this,arguments);updateAge('تحديث يدوي/أساسي');return r;};
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();