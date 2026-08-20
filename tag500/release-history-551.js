'use strict';
(function(){
  const releaseFromPage=()=>String(document.body?.dataset?.tagRelease||document.documentElement?.dataset?.tagRelease||'TAG500');
  function setRelease(build){if(!build)return;document.body.dataset.tagRelease=build;document.title=`${build} — منصة TAG500`;const badge=document.querySelector('#versionBadge');if(badge)badge.textContent=build;const footer=document.querySelector('footer strong');if(footer)footer.textContent=build;const summary=document.querySelector('.release-box summary');if(summary)summary.textContent=`سجل الإصدارات · ${build}`;}
  const LEDGER_URL='../tag500/versions.json';
  const JOURNAL_URL='../tag500/release-journal.json';
  const CURRENT_URL='../tag500/current-release.json';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));

  function applyReleaseIdentity(){setRelease(releaseFromPage());}

  function installFinalStateGate(){
    const baseRender=window.render;
    const build=releaseFromPage();
    if(typeof baseRender!=='function'){
      window.TAG500StateFinalizer={build,ready:false,error:'RENDER_MISSING'};
      return;
    }
    let finalGeneration=0;
    window.render=function(){
      const result=baseRender.apply(this,arguments);
      const state=window.TAG500State&&typeof window.TAG500State==='object'?window.TAG500State:{};
      const analyzed=Array.isArray(window.analyzed)?window.analyzed:(Array.isArray(state.analyzed)?state.analyzed:[]);
      const rows=Array.isArray(window.rows)?window.rows:(Array.isArray(state.rows)?state.rows:[]);
      finalGeneration+=1;
      const currentBuild=releaseFromPage();
      window.TAG500State={...state,build:currentBuild,phase:'FINAL',finalGeneration,rows,analyzed,analyzedCount:analyzed.length,finalizedAt:new Date().toISOString()};
      window.dispatchEvent(new CustomEvent('tag500:state-final',{detail:{build:currentBuild,finalGeneration,analyzedCount:analyzed.length}}));
      return result;
    };
    window.TAG500StateFinalizer={build,ready:true,source:'outermost-render-finalizer',releaseAuthority:'current-release-then-page'};
  }

  function ensureStyles(){
    if(document.getElementById('tag558-release-history-style')) return;
    const s=document.createElement('style');
    s.id='tag558-release-history-style';
    s.textContent='.release-history-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}.release-history-tools input{min-width:180px;flex:1;background:#07121d;border:1px solid #29445b;color:#eef4f8;border-radius:10px;padding:8px 10px}.release-history-list{margin-top:10px;max-height:360px;overflow:auto;display:grid;gap:7px;padding-inline-end:3px}.release-history-item{border:1px solid #20364a;background:#081522;border-radius:10px;padding:9px 11px}.release-history-item.current{border-color:#4c7ba2}.release-history-item strong{display:inline-block;min-width:66px}.release-history-item small{color:#8fa9bd;margin-inline-start:8px}.release-history-item p{margin:5px 0 0;color:#b9c9d8;font-size:12px;line-height:1.55}.release-history-count{font-size:12px;color:#8fa9bd}.release-history-error{margin-top:9px;color:#f3b3b3;font-size:12px}';
    document.head.appendChild(s);
  }
  function host(){return document.querySelector('.release-box');}
  function render(data){
    const box=host(); if(!box) return;
    ensureStyles();
    const current=String(data?.current||releaseFromPage());
    setRelease(current);
    const note=box.querySelector('.release-note');
    if(note&&data?.currentSummary)note.textContent=`${current}: ${String(data.currentSummary)}`;
    const releases=Array.isArray(data?.releases)?data.releases:[];
    let region=box.querySelector('[data-release-history]');
    if(!region){region=document.createElement('div');region.dataset.releaseHistory='1';box.appendChild(region);}
    region.innerHTML=`<div class="release-history-tools"><input type="search" data-release-search placeholder="ابحث برقم الإصدار أو التغيير"><span class="release-history-count" data-release-count></span></div><div class="release-history-list" data-release-list></div>`;
    const input=region.querySelector('[data-release-search]'),list=region.querySelector('[data-release-list]'),count=region.querySelector('[data-release-count]');
    function paint(){
      const q=String(input.value||'').trim().toLowerCase();
      const filtered=releases.filter(r=>!q||String(r.version||'').toLowerCase().includes(q)||String(r.summary||'').toLowerCase().includes(q)||String(r.date||'').includes(q)).slice().reverse();
      count.textContent=`${filtered.length} / ${releases.length} إصدار`;
      list.innerHTML=filtered.map(r=>`<article class="release-history-item ${String(r.version)===current?'current':''}"><div><strong>${esc(r.version)}</strong><small>${esc(r.date||'')}</small>${String(r.version)===current?' <span class="release-chip">الحالي</span>':''}</div><p>${esc(r.summary||'بدون ملخص')}</p></article>`).join('')||'<div class="release-history-error">لا توجد نتائج مطابقة.</div>';
    }
    input.addEventListener('input',paint);paint();
  }
  async function fetchJSON(url){const sep=url.includes('?')?'&':'?';const r=await fetch(url+sep+'ts='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status+' '+url);return r.json();}
  function mergeReleases(base,journal){
    const byVersion=new Map();
    for(const r of [...(Array.isArray(base)?base:[]),...(Array.isArray(journal)?journal:[])]){
      if(!r?.version)continue;
      byVersion.set(String(r.version),r);
    }
    return [...byVersion.values()].sort((a,b)=>{
      const na=Number(String(a.version||'').replace(/\D/g,''))||0;
      const nb=Number(String(b.version||'').replace(/\D/g,''))||0;
      return na-nb;
    });
  }
  async function ensureReleaseLayers(current){
    const n=Number(String(current||'').replace(/\D/g,''))||0;
    if(n<574||window.TAG500FinalSnapshotAuthority||document.querySelector('script[data-tag500-final-authority]'))return;
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=`../tag500/final-snapshot-authority-574.js?v=${n}`;
      s.dataset.tag500FinalAuthority=String(n);
      s.onload=resolve;
      s.onerror=()=>reject(new Error('FINAL_SNAPSHOT_AUTHORITY_LOAD_FAILED'));
      document.body.appendChild(s);
    });
    window.dispatchEvent(new CustomEvent('tag500:runtime-ready',{detail:{layer:'finalSnapshotAuthority',build:current}}));
    if(typeof loadData==='function') await loadData();
  }
  async function load(){
    const box=host(); if(!box) return;
    try{
      const [ledger,currentMeta,journal]=await Promise.all([
        fetchJSON(LEDGER_URL),
        fetchJSON(CURRENT_URL).catch(()=>null),
        fetchJSON(JOURNAL_URL).catch(()=>({releases:[]}))
      ]);
      const releases=mergeReleases(ledger?.releases,journal?.releases);
      let current=String(currentMeta?.current||ledger?.current||releaseFromPage());
      if(currentMeta?.current&&!releases.some(r=>String(r.version)===String(currentMeta.current))){
        releases.push({version:String(currentMeta.current),date:String(currentMeta.updatedAt||'').slice(0,10),summary:String(currentMeta.summary||'')});
      }
      render({...ledger,current,releases,currentSummary:String(currentMeta?.summary||'')});
      await ensureReleaseLayers(current);
    }catch(e){
      ensureStyles();
      let region=box.querySelector('[data-release-history]');
      if(!region){region=document.createElement('div');region.dataset.releaseHistory='1';box.appendChild(region);}
      region.innerHTML=`<div class="release-history-error">تعذر تحميل سجل الإصدارات الكامل: ${esc(e.message)}. الإصدار الحالي يبقى ظاهرًا أعلاه.</div>`;
    }
  }

  applyReleaseIdentity();
  installFinalStateGate();
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',load); else load();
  window.TAG500ReleaseHistory={get build(){return releaseFromPage();},load,render,mergeReleases,ensureReleaseLayers,releaseAuthority:'current-release-then-ledger-plus-journal-then-page'};
  window.dispatchEvent(new CustomEvent('tag500:runtime-ready',{detail:{layer:'releaseHistoryAndStateFinalizer',build:releaseFromPage()}}));
})();
