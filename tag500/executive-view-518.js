'use strict';
(function(){
  const BUILD='TAG522';
  let mode='EXECUTIVE';
  function actionCode(z){return z?.actionability?.code||'X';}
  function visible(z){
    if(mode==='RESEARCH') return true;
    return z?.valid===true && z?.sharia==='VERIFIED' && ['A','B'].includes(actionCode(z));
  }
  function ensureSessionClock(){
    if(window.TAG500SessionClock||document.querySelector('script[data-tag519-session]')) return;
    const s=document.createElement('script');
    s.src='../tag500/session-state-519.js?v=522';s.dataset.tag519Session='1';document.head.appendChild(s);
  }
  function ensureCatalystRelevance(){
    if(document.querySelector('script[data-tag522-relevance]')) return;
    const s=document.createElement('script');
    s.src='../tag500/catalyst-relevance-522.js?v=522';s.dataset.tag522Relevance='1';s.async=false;
    s.onload=()=>{
      try{
        if(typeof rows!=='undefined'&&Array.isArray(rows)&&rows.length&&typeof analyze==='function'){
          analyzed=rows.map(analyze);
          if(typeof render==='function') render();
        }
      }catch(e){console.warn('TAG522 relevance rerender skipped',e);}
    };
    document.head.appendChild(s);
  }
  function paintVersion(){
    const b=document.querySelector('#versionBadge');if(b)b.textContent=BUILD;
    const f=document.querySelector('footer strong');if(f)f.textContent=BUILD;
    document.title=BUILD+' — منصة TAG500';
    const summary=document.querySelector('.release-box summary');if(summary)summary.textContent='سجل الإصدار · '+BUILD;
    const note=document.querySelector('.release-note');if(note&&note.closest('.release-box'))note.textContent='TAG522: أضاف Catalyst Relevance Gate لمنع أخبار تطابق الرمز لفظيًا لكنها لا تخص الشركة من دخول Catalyst Clock أو رفع Actionability. يستفيد من اسم الشركة في Finviz والرمز ككيان، ويبقي النتائج غير المرتبطة خارج Catalyst credit. لا تغيير في thresholds ولا ادعاء أداء غير مثبت.';
  }
  function ensureControls(){
    const row=document.querySelector('.control-row');
    if(!row||document.querySelector('#viewMode518')) return;
    const wrap=document.createElement('label');
    wrap.innerHTML='وضع العرض<select id="viewMode518"><option value="EXECUTIVE">تنفيذي — فرص مؤهلة فقط</option><option value="RESEARCH">بحث — جميع الحالات</option></select>';
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
  function apply(){
    paintVersion();ensureSessionClock();ensureCatalystRelevance();ensureControls();
    const select=document.querySelector('#viewMode518');
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
      let note=document.querySelector('#view518Note');
      if(!note){
        note=document.createElement('div');note.id='view518Note';note.className='release-note';note.style.margin='8px 0 0';
        body.closest('.table-panel')?.querySelector('.section-head')?.appendChild(note);
      }
      if(note){
        const total=all.length;
        note.innerHTML=mode==='EXECUTIVE'
          ? `<strong>Executive Mode:</strong> VERIFIED + A/B فقط · ظاهر ${shown} من ${total}. <span style="color:#8fa9bd">${blockerSummary(all,shown)}</span>`
          : `<strong>Research Mode:</strong> جميع الحالات للبحث والتدقيق؛ غير المؤهل لا يتحول إلى فرصة تنفيذية. <span style="color:#8fa9bd">${blockerSummary(all,shown)}</span>`;
      }
    }
    const top=document.querySelector('#topOpportunity');
    if(top) top.dataset.viewMode=mode;
  }
  function bind(){
    ensureControls();paintVersion();ensureSessionClock();ensureCatalystRelevance();
    const s=document.querySelector('#viewMode518');
    if(s&&!s.dataset.bound518){
      s.dataset.bound518='1';
      s.addEventListener('change',()=>{mode=s.value;apply();});
    }
    apply();
  }
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){baseRender();queueMicrotask(bind);};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind); else bind();
  window.TAG500ViewMode={build:BUILD,getMode:()=>mode,setMode:(m)=>{mode=m==='RESEARCH'?'RESEARCH':'EXECUTIVE';const s=document.querySelector('#viewMode518');if(s)s.value=mode;apply();}};
})();