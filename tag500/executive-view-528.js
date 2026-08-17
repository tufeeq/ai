'use strict';
(function(){
  const BUILD='TAG531';
  let mode='EXECUTIVE';
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
      ['session-clock',window.TAG500SessionClock]
    ];
    const missing=required.filter(([,v])=>!v).map(([n])=>n);
    return {ok:missing.length===0,missing};
  }
  function visible(z,healthOk){
    if(mode==='RESEARCH') return true;
    return healthOk && z?.valid===true && z?.sharia==='VERIFIED' && ['A','B'].includes(actionCode(z));
  }
  function paintVersion(){
    const b=document.querySelector('#versionBadge');if(b)b.textContent=BUILD;
    const f=document.querySelector('footer strong');if(f)f.textContent=BUILD;
    document.title=BUILD+' — منصة TAG500';
    const release=document.querySelector('.release-box');
    if(release){
      const summary=release.querySelector('summary');
      if(summary)summary.textContent='سجل الإصدار · '+BUILD;
      const chips=release.querySelector('.release-meta');
      if(chips)chips.innerHTML='<span class="release-chip">2026-08-17</span><span class="release-chip">Release consistency gate</span><span class="release-chip">Entrypoint/runtime registry aligned</span><span class="release-chip">Fail-closed preserved</span><span class="release-chip">No threshold retune</span>';
      const note=release.querySelector('.release-note');
      if(note)note.textContent='TAG531: يوحّد هوية الإصدار من نقطة الدخول إلى Runtime وسجل الإصدارات، ويضيف Release Consistency Gate يحجب Executive Mode عند ظهور نسخة هجينة أو mismatch بدل السماح بواجهة تبدو أحدث من الملفات الفعلية. لا تغيير في thresholds أو scoring.';
    }
  }
  function ensureControls(){
    const row=document.querySelector('.control-row');
    if(!row||document.querySelector('#viewMode531')) return;
    document.querySelector('#viewMode530')?.closest('label')?.remove();
    document.querySelector('#viewMode528')?.closest('label')?.remove();
    document.querySelector('#viewMode527')?.closest('label')?.remove();
    const wrap=document.createElement('label');
    wrap.innerHTML='وضع العرض<select id="viewMode531"><option value="EXECUTIVE">تنفيذي — فرص مؤهلة فقط</option><option value="RESEARCH">بحث — جميع الحالات</option></select>';
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
    if(!health.ok) reasons.push('Runtime ناقص: '+health.missing.join(', '));
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
    const select=document.querySelector('#viewMode531');if(select)mode=select.value||mode;
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
      let note=document.querySelector('#view531Note');
      if(!note){note=document.createElement('div');note.id='view531Note';note.className='release-note';note.style.margin='8px 0 0';body.closest('.table-panel')?.querySelector('.section-head')?.appendChild(note);}
      if(note){const total=all.length;note.innerHTML=mode==='EXECUTIVE'?`<strong>Executive Mode:</strong> VERIFIED + A/B فقط · ظاهر ${shown} من ${total}. <span style="color:#8fa9bd">${blockerSummary(all,shown,health)}</span>`:`<strong>Research Mode:</strong> جميع الحالات للبحث والتدقيق؛ غير المؤهل لا يتحول إلى فرصة تنفيذية. <span style="color:#8fa9bd">${blockerSummary(all,shown,health)}</span>`;}
    }
    const log=document.querySelector('#integrityLog');
    document.querySelector('#runtime530Health')?.remove();
    document.querySelector('#runtime528Health')?.remove();
    document.querySelector('#runtime527Health')?.remove();
    let item=document.querySelector('#runtime531Health');
    if(log&&!item){item=document.createElement('div');item.id='runtime531Health';item.className='log-item';log.appendChild(item);}
    if(item)item.innerHTML=health.ok?`Runtime ${BUILD}: ✓ الطبقات المطلوبة محمّلة؛ Refresh Health يتحقق من صلاحية اللقطة، وRelease Consistency يتحقق من هوية الإصدار.`:`Runtime ${BUILD}: ⚠ طبقات مفقودة: ${health.missing.join(', ')}. Executive Mode محجوب مؤقتًا دون تعديل z.valid.`;
    if(!health.ok&&mode==='EXECUTIVE'){
      const top=document.querySelector('#topOpportunity');
      if(top){top.classList.add('empty');top.textContent='تم حجب الفرص التنفيذية مؤقتًا: runtime غير مكتمل. لم يتم تغيير صلاحية الحالات الأصلية.';}
    }
  }
  function bind(){
    ensureControls();paintVersion();
    const s=document.querySelector('#viewMode531');
    if(s&&!s.dataset.bound531){s.dataset.bound531='1';s.addEventListener('change',()=>{mode=s.value;apply();});}
    apply();
  }
  const baseRender=window.render;
  if(typeof baseRender==='function')window.render=function(){baseRender();queueMicrotask(bind);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
  window.TAG500ExecutiveView={build:BUILD,getMode:()=>mode,setMode:(m)=>{mode=m==='RESEARCH'?'RESEARCH':'EXECUTIVE';const s=document.querySelector('#viewMode531');if(s)s.value=mode;apply();},runtimeHealth};
})();