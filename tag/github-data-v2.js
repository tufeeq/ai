(() => {
  async function loadGitHubFinviz() {
    const s=document.getElementById('finvizStatus');
    const b=document.getElementById('dataBadge');
    if(s){s.className='connector-status';s.textContent='جاري تحميل أحدث بيانات Finviz…';}
    try{
      const r=await fetch('./data/finviz.json?ts='+Date.now(),{cache:'no-store'});
      if(!r.ok) throw new Error('Data file HTTP '+r.status);
      const payload=await r.json();
      const finvizRows=Array.isArray(payload.data)?payload.data:(Array.isArray(payload.rows)?payload.rows:[]);
      if(!finvizRows.length) throw new Error('No Finviz rows found');
      if(typeof normalizeFinviz!=='function') throw new Error('TAG parser unavailable');
      rows=normalizeFinviz(finvizRows);
      render();
      if(b){b.textContent='● DATA: FINVIZ';b.classList.add('connected');}
      if(s){s.className='connector-status ok';s.textContent=`Finviz متصل · ${finvizRows.length} سهم · آخر تحديث ${new Date(payload.updatedAt).toLocaleString()}`;}
    }catch(e){if(s){s.className='connector-status err';s.textContent='تعذر تحميل بيانات Finviz: '+e.message;}}
  }
  window.addEventListener('DOMContentLoaded',()=>{
    const btn=document.getElementById('connectFinviz');if(btn){btn.textContent='تحميل أحدث بيانات Finviz';btn.onclick=loadGitHubFinviz;}
    ['finvizToken','finvizUrl'].forEach(id=>{const el=document.getElementById(id);if(el&&el.closest('label'))el.closest('label').style.display='none';});
    ['toggleToken','forgetToken'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    const remember=document.getElementById('rememberToken');if(remember&&remember.closest('label'))remember.closest('label').style.display='none';
    const s=document.getElementById('finvizStatus');if(s)s.textContent='جاهز لتحميل بيانات Finviz من GitHub Actions.';
    setTimeout(loadGitHubFinviz,250);
  });
})();