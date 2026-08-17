'use strict';
(function(){
  const BUILD='TAG527';
  let mode='EXECUTIVE';
  function actionCode(z){return z?.actionability?.code||'X';}
  function visible(z){
    if(mode==='RESEARCH') return true;
    return z?.valid===true && z?.sharia==='VERIFIED' && ['A','B'].includes(actionCode(z));
  }
  function paintVersion(){
    const b=document.querySelector('#versionBadge');if(b)b.textContent=BUILD;
    const f=document.querySelector('footer strong');if(f)f.textContent=BUILD;
    document.title=BUILD+' — منصة TAG500';
  }
  function ensureControls(){
    const row=document.querySelector('.control-row');
    if(!row||document.querySelector('#viewMode527')) return;
    const wrap=document.createElement('label');
    wrap.innerHTML='وضع العرض<select id="viewMode527"><option value="EXECUTIVE">تنفيذي — فرص مؤهلة فقط</option><option value="RESEARCH">بحث — جميع الحالات</option></select>';
    row.prepend(wrap);
    const s=document.querySelector('#shariaFilter');
    if(s) s.value='VERIFIED';
  }
  function blockerSummary(all,shown){
    const stale=window.sourceMeta?.fresh===false;
    const unverified=all.filter(z=>z?.sharia==='UNVERIFIED').length;
    const excluded=all.filter(z=>z?.sharia==='EXCLUDED').length;
    const verified=all.filter(z=>z?.sharia==='VERIFIED').length;
    const notAB=all.filter(z=>z?.sharia==='VERIFIED'&&!['A','B'].includes(actionCode(z))).length;
    const incomplete=all.filter(z=>z?.dataComplete===false||z?.stage==='DATA_INSUFFICIENT').length;
    const lateOrigin=all.filter(z=>['LATE','VERY_LATE'].includes(z?.signalOrigin?.class)).length;
    const irrelevantNews=all.filter(z=>(z?.catalystNewsTimelineRawCount||0)>0&&(z?.catalystNewsTimeline||[]).length===0).length;
    const reasons=[];
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
  function runtimeHealth(){
    const required=[
      ['temporal',window.TAG500Temporal],
      ['signal-origin',window.TAG500SignalOrigin],
      ['catalyst-clock',window.TAG500CatalystClock],
      ['catalyst-quality',window.TAG500CatalystQuality],
      ['catalyst-score',window.TAG500CatalystScoreIntegrity],
      ['actionability',window.TAG500Actionability],
      ['data-bridge',window.TAG500DataBridge],
      ['refresh-health',window.TAG500RefreshHealth],
      ['session-clock',window.TAG500SessionClock]
    ];
    const missing=required.filter(([,v])=>!v).map(([n])=>n);
    return {ok:missing.length===0,missing};
  }
  function apply(){
    paintVersion();ensureControls();
    const select=document.querySelector('#viewMode527');
    if(select) mode=select.value||mode;
    const all=window.analyzed||[];
    const map=new Map(all.map(z=>[z.ticker,z]));
    const body=document.querySelector('#scannerBody');
    if(body){
      let shown=0;
      for(const tr of body.querySelectorAll('tr[data-ticker]')){
        const z=map.get(tr.dataset.ticker);
        const show=mode==='RESEARCH'||visible(z);
        tr.hidden=!show;
        if(show) shown++;
      }
      let note=document.querySelector('#view527Note');
      if(!note){
        note=document.createElement('div');note.id='view527Note';note.className='release-note';note.style.margin='8px 0 0';
        body.closest('.table-panel')?.querySelector('.section-head')?.appendChild(note);
      }
      if(note){
        const total=all.length;
        note.innerHTML=mode==='EXECUTIVE'
          ? `<strong>Executive Mode:</strong> VERIFIED + A/B فقط · ظاهر ${shown} من ${total}. <span style="color:#8fa9bd">${blockerSummary(all,shown)}</span>`
          : `<strong>Research Mode:</strong> جميع الحالات للبحث والتدقيق؛ غير المؤهل لا يتحول إلى فرصة تنفيذية. <span style="color:#8fa9bd">${blockerSummary(all,shown)}</span>`;
      }
    }
    const health=runtimeHealth();
    const log=document.querySelector('#integrityLog');
    if(log&&!document.querySelector('#runtime527Health')){
      const item=document.createElement('div');item.id='runtime527Health';item.className='log-item';
      item.innerHTML=health.ok?`Runtime ${BUILD}: ✓ الطبقات المطلوبة محمّلة دون حقن ديناميكي لطبقات قديمة.`:`Runtime ${BUILD}: ⚠ طبقات مفقودة: ${health.missing.join(', ')}. التحقق التنفيذي يبقى fail-closed.`;
      log.appendChild(item);
    }
    if(!health.ok){
      for(const z of all){z.valid=false;z.runtimeBlocked=true;}
      const top=document.querySelector('#topOpportunity');
      if(top){top.classList.add('empty');top.textContent='تم حجب الفرص التنفيذية: runtime غير مكتمل. راجع سجل سلامة البيانات.';}
    }
  }
  function bind(){
    ensureControls();paintVersion();
    const s=document.querySelector('#viewMode527');
    if(s&&!s.dataset.bound527){
      s.dataset.bound527='1';
      s.addEventListener('change',()=>{mode=s.value;apply();});
    }
    apply();
  }
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){baseRender();queueMicrotask(bind);};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind); else bind();
  window.TAG500ExecutiveView={build:BUILD,getMode:()=>mode,setMode:(m)=>{mode=m==='RESEARCH'?'RESEARCH':'EXECUTIVE';const s=document.querySelector('#viewMode527');if(s)s.value=mode;apply();},runtimeHealth};
})();
