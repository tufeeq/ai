'use strict';
(function(){
  const BUILD='TAG551';
  const URL='../tag500/versions.json';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function ensureStyles(){
    if(document.getElementById('tag551-release-history-style')) return;
    const s=document.createElement('style');
    s.id='tag551-release-history-style';
    s.textContent='.release-history-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}.release-history-tools input{min-width:180px;flex:1;background:#07121d;border:1px solid #29445b;color:#eef4f8;border-radius:10px;padding:8px 10px}.release-history-list{margin-top:10px;max-height:360px;overflow:auto;display:grid;gap:7px;padding-inline-end:3px}.release-history-item{border:1px solid #20364a;background:#081522;border-radius:10px;padding:9px 11px}.release-history-item.current{border-color:#4c7ba2}.release-history-item strong{display:inline-block;min-width:66px}.release-history-item small{color:#8fa9bd;margin-inline-start:8px}.release-history-item p{margin:5px 0 0;color:#b9c9d8;font-size:12px;line-height:1.55}.release-history-count{font-size:12px;color:#8fa9bd}.release-history-error{margin-top:9px;color:#f3b3b3;font-size:12px}';
    document.head.appendChild(s);
  }
  function host(){return document.querySelector('.release-box');}
  function render(data){
    const box=host(); if(!box) return;
    ensureStyles();
    const current=String(data?.current||document.body.dataset.tagRelease||BUILD);
    const releases=Array.isArray(data?.releases)?data.releases:[];
    let region=box.querySelector('[data-release-history-551]');
    if(!region){
      region=document.createElement('div');region.dataset.releaseHistory551='1';
      box.appendChild(region);
    }
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
  async function load(){
    const box=host(); if(!box) return;
    try{
      const sep=URL.includes('?')?'&':'?';
      const r=await fetch(URL+sep+'ts='+Date.now(),{cache:'no-store'});
      if(!r.ok) throw new Error('HTTP '+r.status);
      render(await r.json());
    }catch(e){
      ensureStyles();
      let region=box.querySelector('[data-release-history-551]');
      if(!region){region=document.createElement('div');region.dataset.releaseHistory551='1';box.appendChild(region);}
      region.innerHTML=`<div class="release-history-error">تعذر تحميل سجل الإصدارات الكامل: ${esc(e.message)}. الإصدار الحالي يبقى ظاهرًا أعلاه.</div>`;
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',load); else load();
  window.TAG500ReleaseHistory={build:BUILD,load,render};
  window.dispatchEvent(new CustomEvent('tag500:runtime-ready',{detail:{layer:'releaseHistory',build:BUILD}}));
})();