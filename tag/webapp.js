(()=>{
  const $=s=>document.querySelector(s);
  const stateKey='tag8:webapp:filters';
  const fmtAge=ts=>{const t=Date.parse(ts||'');if(!Number.isFinite(t))return 'غير معروف';const m=Math.max(0,Math.round((Date.now()-t)/60000));return m<1?'الآن':m<60?`${m} د`:`${Math.floor(m/60)} س ${m%60} د`;};
  const getTs=o=>o?.updatedAt||o?.snapshotTimestampUTC||o?.generatedAt||o?.timestampUTC||o?.timestamp||null;
  const loadJson=async path=>{const r=await fetch(`${path}?ts=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();};

  function mountAppBar(){
    const main=$('main.layout'); if(!main||$('#appCommandBar'))return;
    const bar=document.createElement('section');bar.id='appCommandBar';bar.className='app-command-bar';
    bar.innerHTML=`<div class="app-command-left"><button id="appRefresh" class="primary">↻ تحديث مباشر</button><button id="installApp" class="app-secondary" hidden>تثبيت التطبيق</button><span id="appSyncState" class="app-sync">فحص المصادر…</span></div><nav class="dashboard-quicknav" aria-label="تنقل سريع"><a href="#opportunities">الفرص</a><a href="#marketRadar">الرادار</a><a href="#dataHealth">البيانات</a><a href="#analysisTools">التحليل</a></nav><div class="app-command-right"><span class="kbd-hint">/ بحث</span><span class="kbd-hint">R تحديث</span></div>`;
    main.insertBefore(bar,main.firstChild);
    $('#appRefresh').onclick=async()=>{const b=$('#appRefresh');b.disabled=true;b.textContent='… جاري التحديث';try{if(typeof window.loadGitHubFinviz==='function')await window.loadGitHubFinviz();await refreshHealth();}finally{b.disabled=false;b.textContent='↻ تحديث مباشر';}};
  }

  function optimizeLayout(){
    const main=$('main.layout');if(!main)return;
    const hero=$('.hero'),note=$('.tag8-note')?.closest('.panel'),finviz=$('.panel.finviz'),metrics=$('#summaryCards'),visual=$('.visual-grid'),controls=$('.controls'),table=$('.table-panel'),grid=$('.grid-two');
    if(finviz)finviz.classList.add('compact-source');
    if(visual)visual.id='marketRadar'; if(table)table.id='opportunities'; if(grid)grid.id='analysisTools';
    // Put decision KPIs and market view before data plumbing.
    if(hero&&metrics)hero.insertAdjacentElement('afterend',metrics);
    if(metrics&&visual)metrics.insertAdjacentElement('afterend',visual);
    if(visual&&controls)visual.insertAdjacentElement('afterend',controls);
    if(controls&&table)controls.insertAdjacentElement('afterend',table);
    // Keep the safety note close to data-health, not between user and the decision surface.
    if(table&&finviz)table.insertAdjacentElement('afterend',finviz);
    const health=$('#sourceHealth');if(health){health.id='dataHealth';finviz?.insertAdjacentElement('afterend',health);}
    if(health&&note)health.insertAdjacentElement('afterend',note);
  }

  function mountHealth(){
    if($('#sourceHealth')||$('#dataHealth'))return;
    const finviz=$('.panel.finviz');if(!finviz)return;
    const el=document.createElement('section');el.id='sourceHealth';el.className='panel source-health';
    el.innerHTML=`<div class="section-head"><div><h3>صحة مصادر البيانات</h3><p>السعر والأخبار والإفصاحات والمصالحة النهائية — مع عمر كل مصدر.</p></div><span id="healthSummary" class="health-summary">جاري الفحص…</span></div><div id="healthGrid" class="health-grid"></div>`;
    finviz.insertAdjacentElement('afterend',el);
  }

  async function refreshHealth(){
    const specs=[['Finviz / Market','./data/finviz.json','market'],['Yahoo + News + SEC','./data/enrichment.json','enrichment'],['Final Reconciliation','./data/final-reconciliation.json','reconciliation']];
    const results=await Promise.all(specs.map(async ([name,path,type])=>{
      try{const data=await loadJson(path);const ts=getTs(data);const age=ts?Math.max(0,(Date.now()-Date.parse(ts))/60000):null;let status='ok',detail='متاح';
        if(type==='market'&&age!==null&&age>15){status='warn';detail='متقادم للتداول اللحظي';}
        if(type==='reconciliation'){const rec=data?.status||data?.finalSnapshotReconciliation||data?.reconciliationStatus||'';if(!/reconciled/i.test(String(rec))){status='warn';detail='المصالحة النهائية غير مكتملة';}}
        const count=data?.count??data?.rows?.length??data?.data?.length??data?.tickers?.length??data?.results?.length??null;
        return {name,status,detail,age:fmtAge(ts),count};
      }catch(e){return {name,status:'err',detail:'غير متاح',age:'—',count:null};}
    }));
    const grid=$('#healthGrid');if(grid)grid.innerHTML=results.map(x=>`<article class="source-card ${x.status}"><div><span class="source-dot"></span><strong>${x.name}</strong></div><b>${x.detail}</b><small>العمر: ${x.age}${x.count!==null?` · ${x.count.toLocaleString()} سجل`:''}</small></article>`).join('');
    const errors=results.filter(x=>x.status==='err').length,warns=results.filter(x=>x.status==='warn').length;
    const hs=$('#healthSummary');if(hs){hs.textContent=errors?'خلل في مصدر':warns?'تحتاج مراجعة':'المصادر تعمل';hs.className=`health-summary ${errors?'err':warns?'warn':'ok'}`;}
    const sync=$('#appSyncState');if(sync)sync.textContent=`آخر فحص ${new Date().toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'})}`;
  }

  function persistFilters(){const q=$('#search'),s=$('#stageFilter'),h=$('#shariaFilter');if(!q||!s||!h)return;localStorage.setItem(stateKey,JSON.stringify({q:q.value,stage:s.value,sharia:h.value}));}
  function restoreFilters(){try{const v=JSON.parse(localStorage.getItem(stateKey)||'{}');if($('#search')&&v.q)$('#search').value=v.q;if($('#stageFilter')&&v.stage)$('#stageFilter').value=v.stage;if($('#shariaFilter')&&v.sharia)$('#shariaFilter').value=v.sharia;if(typeof window.render==='function')window.render();}catch(e){}}
  function wireFilters(){['#search','#stageFilter','#shariaFilter'].forEach(s=>$(s)?.addEventListener('input',persistFilters));}
  function wireRouting(){document.addEventListener('click',e=>{const tr=e.target.closest?.('.stock-row');if(tr?.dataset?.ticker)history.replaceState(null,'',`#stock=${encodeURIComponent(tr.dataset.ticker)}`);});window.addEventListener('hashchange',()=>{const m=location.hash.match(/stock=([^&]+)/);if(m&&typeof window.openTAG8Drawer==='function')window.openTAG8Drawer(decodeURIComponent(m[1]).toUpperCase());});setTimeout(()=>window.dispatchEvent(new Event('hashchange')),1000);}
  function wireKeyboard(){document.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){e.preventDefault();$('#search')?.focus();}if((e.key==='r'||e.key==='R')&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName))$('#appRefresh')?.click();if(e.key==='Escape'){const d=$('#stockDrawer');if(d?.classList.contains('open')){d.classList.remove('open');document.body.classList.remove('drawer-open');history.replaceState(null,'',location.pathname);}}});}
  let deferredInstall=null;
  function wireInstall(){window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;const b=$('#installApp');if(b)b.hidden=false;});document.addEventListener('click',async e=>{if(e.target?.id==='installApp'&&deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;e.target.hidden=true;}});}
  function registerSW(){if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js').catch(()=>{});}

  window.addEventListener('DOMContentLoaded',()=>{mountAppBar();mountHealth();optimizeLayout();restoreFilters();wireFilters();wireRouting();wireKeyboard();wireInstall();registerSW();refreshHealth();setInterval(refreshHealth,60000);});
})();