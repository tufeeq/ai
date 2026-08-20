'use strict';
(function(){
  const FALLBACK_BUILD='TAG571';
  let mode='EXECUTIVE';
  function buildId(){return document.body?.dataset?.tagRelease||document.querySelector('#versionBadge')?.textContent?.trim()||FALLBACK_BUILD;}
  function actionCode(z){return z?.actionability?.code||'X';}
  function runtimeHealth(){
    const required=[
      ['temporal',window.TAG500Temporal],
      ['signal-origin',window.TAG500SignalOrigin],
      ['catalyst-clock',window.TAG500CatalystClock],
      ['catalyst-quality',window.TAG500CatalystQuality],
      ['catalyst-score',window.TAG500CatalystScoreIntegrity],
      ['actionability',window.TAG500Actionability],
      ['data-bridge',window.TAG500DataBridge||window.TAG500_DATA_BRIDGE],
      ['refresh-health',window.TAG500RefreshHealth],
      ['session-clock',window.TAG500SessionClock],
      ['runtime-safety',window.TAG500RuntimeSafety]
    ];
    const missing=required.filter(([,v])=>!v).map(([n])=>n);
    const critical=Array.isArray(window.TAG500RuntimeSafety?.critical)?window.TAG500RuntimeSafety.critical:[];
    return {ok:missing.length===0&&window.TAG500RuntimeSafety?.ok!==false,missing,critical,build:buildId()};
  }
  function visible(z,healthOk){
    if(mode==='RESEARCH') return true;
    return healthOk && z?.valid===true && z?.sharia==='VERIFIED' && ['A','B'].includes(actionCode(z));
  }
  function paintVersion(){
    const build=buildId();
    const b=document.querySelector('#versionBadge');if(b&&b.textContent.trim()!==build)b.textContent=build;
    const f=document.querySelector('footer strong');if(f&&f.textContent.trim()!==build)f.textContent=build;
    if(!document.title.startsWith(build+' —')) document.title=build+' — منصة TAG500';
  }
  function ensureControls(){
    const row=document.querySelector('.control-row');
    if(!row||document.querySelector('#viewMode533')) return;
    document.querySelector('#viewMode530')?.closest('label')?.remove();
    document.querySelector('#viewMode528')?.closest('label')?.remove();
    document.querySelector('#viewMode527')?.closest('label')?.remove();
    const wrap=document.createElement('label');
    wrap.innerHTML='وضع العرض<select id="viewMode533"><option value="EXECUTIVE">تنفيذي — فرص مؤهلة فقط</option><option value="RESEARCH">بحث — جميع الحالات</option></select>';
    row.prepend(wrap);
    const s=document.querySelector('#shariaFilter');if(s)s.value='VERIFIED';
  }
  function blockerSummary(all,shown,health){
    const stale=window.sourceMeta?.fresh===false;
    const unverified=all.filter(z=>z?.sharia==='UNVERIFIED').length;
    const excluded=all.filter(z=>z?.sharia==='EXCLUDED').length;
    const verified=all.filter(z=>z?.sharia==='VERIFIED').length;
    const notAB=all.filter(z=>z?.sharia==='VERIFIED'&&!['A','B'].includes(actionCode(z))).length;
    const incomplete=all.filter(z=>z?.dataComplete===false||z?.stage==='DATA_INSUFFICIENT').length;
    const lateOrigin=all.filter(z=>['LATE','VERY_LATE'].includes(z?.signalOrigin?.class)).length;
    const irrelevantNews=all.filter(z=>(z?.catalystNewsTimelineRawCount||0)>0&&(z?.catalystNewsTimeline||[]).length===0).length;
    const reasons=[];
    if(!health.ok&&health.critical?.length) reasons.push(`Runtime error: ${health.critical.length} حرج`);
    if(health.missing.length) reasons.push('Runtime ناقص: '+health.missing.join(', '));
    if(stale) reasons.push('البيانات قديمة — الترتيب التنفيذي متوقف');
    if(unverified) reasons.push(`${unverified} غير متحقق شرعيًا`);
    if(excluded) reasons.push(`${excluded} مستبعد شرعيًا`);
    if(notAB) reasons.push(`${notAB} شرعي مؤكد لكنه خارج A/B`);
    if(incomplete) reasons.push(`${incomplete} ناقص المدخلات`);
    if(lateOrigin) reasons.push(`${lateOrigin} ظهر متأخرًا`);
    if(irrelevantNews) reasons.push(`${irrelevantNews} نتائج أخبار غير مرتبطة تم حجبها`);
    if(!shown&&verified===0) reasons.unshift('لا توجد أسهم VERIFIED في التغذية الحالية');
    return reasons.length?reasons.join(' · '):'لا توجد عوائق رئيسية ظاهرة';
  }
  function apply(){
    paintVersion();ensureControls();
    const select=document.querySelector('#viewMode533');if(select)mode=select.value||mode;
    const all=window.analyzed||[];
    const map=new Map(all.map(z=>[z.ticker,z]));
    const health=runtimeHealth();
    const body=document.querySelector('#scannerBody');
    if(body){
      let shown=0;
      for(const tr of body.querySelectorAll('tr[data-ticker]')){
        const z=map.get(tr.dataset.ticker);
        const show=mode==='RESEARCH'||visible(z,health.ok);
        tr.hidden=!show;if(show)shown++;
      }
      document.querySelector('#view530Note')?.remove();
      document.querySelector('#view528Note')?.remove();
      document.querySelector('#view527Note')?.remove();
      let note=document.querySelector('#view533Note');
      if(!note){note=document.createElement('div');note.id='view533Note';note.className='release-note';note.style.margin='8px 0 0';body.closest('.table-panel')?.querySelector('.section-head')?.appendChild(note);}
      if(note){const total=all.length;note.innerHTML=mode==='EXECUTIVE'?`<strong>Executive Mode:</strong> VERIFIED + A/B فقط · ظاهر ${shown} من ${total}. <span style="color:#8fa9bd">${blockerSummary(all,shown,health)}</span>`:`<strong>Research Mode:</strong> جميع الحالات للبحث والتدقيق؛ غير المؤهل لا يتحول إلى فرصة تنفيذية. <span style="color:#8fa9bd">${blockerSummary(all,shown,health)}</span>`;}
    }
    const log=document.querySelector('#integrityLog');
    document.querySelector('#runtime530Health')?.remove();
    document.querySelector('#runtime528Health')?.remove();
    document.querySelector('#runtime527Health')?.remove();
    let item=document.querySelector('#runtime533Health');
    if(log&&!item){item=document.createElement('div');item.id='runtime533Health';item.className='log-item';log.appendChild(item);}
    if(item){
      if(health.ok)item.innerHTML=`Runtime ${health.build}: ✓ الطبقات المطلوبة محمّلة ولا توجد أخطاء runtime حرجة.`;
      else if(health.critical?.length)item.innerHTML=`Runtime ${health.build}: ⚠ FAIL-CLOSED بسبب ${health.critical.length} خطأ runtime حرج. Executive Mode محجوب دون تعديل z.valid.`;
      else item.innerHTML=`Runtime ${health.build}: ⚠ طبقات مفقودة: ${health.missing.join(', ')}. Executive Mode محجوب مؤقتًا دون تعديل z.valid.`;
    }
    if(!health.ok&&mode==='EXECUTIVE'){
      const top=document.querySelector('#topOpportunity');
      if(top){top.classList.add('empty');top.textContent='تم حجب الفرص التنفيذية مؤقتًا: runtime غير سليم. راجع سجل سلامة البيانات.';}
    }
  }
  function bind(){
    ensureControls();paintVersion();
    const s=document.querySelector('#viewMode533');
    if(s&&!s.dataset.bound533){s.dataset.bound533='1';s.addEventListener('change',()=>{mode=s.value;apply();});}
    apply();
  }
  const baseRender=window.render;
  if(typeof baseRender==='function')window.render=function(){baseRender();queueMicrotask(bind);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
  window.addEventListener('tag500:runtime-ready',apply);
  window.addEventListener('tag500:runtime-safety',apply);
  window.TAG500ExecutiveView={build:buildId(),getMode:()=>mode,setMode:(m)=>{mode=m==='RESEARCH'?'RESEARCH':'EXECUTIVE';const s=document.querySelector('#viewMode533');if(s)s.value=mode;apply();},runtimeHealth,apply};
})();