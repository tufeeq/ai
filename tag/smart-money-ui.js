(() => {
  let intelligence={tickers:{},updatedAt:null,sources:{}};
  const n=v=>{const x=parseFloat(String(v??'').replace(/[+$,%×]/g,'').replace(/,/g,''));return Number.isFinite(x)?x:null};
  async function load(){
    try{const r=await fetch('./data/smart-money.json?ts='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);intelligence=await r.json();window.TAGXSmartMoneyData=intelligence;renderStatus();augment();}
    catch(e){renderStatus('Smart Money: بانتظار أول تحديث SEC');}
  }
  function renderStatus(msg){
    let b=document.getElementById('smartMoneyBadge');
    if(!b){b=document.createElement('span');b.id='smartMoneyBadge';b.className='badge';document.querySelector('.badges')?.appendChild(b)}
    b.textContent=msg||`● Smart Money: ${intelligence.tickerCount||0} رمز`;
    if(!msg)b.classList.add('connected');
  }
  function rowInput(tr){
    const td=[...tr.children];
    return {Change:n(td[2]?.textContent), 'Rel Volume':n(td[7]?.textContent), Volume:null, Float:null};
  }
  function external(t){return intelligence.tickers?.[t]||{};}
  function augment(){
    const table=document.querySelector('.table-panel table');if(!table)return;
    const hr=table.querySelector('thead tr');
    if(hr&&!hr.querySelector('[data-sm-head]')){
      const a=document.createElement('th');a.dataset.smHead='1';a.textContent='Smart $';
      const b=document.createElement('th');b.dataset.smHead='1';b.textContent='Ignition';
      hr.insertBefore(b,hr.children[4]||null);hr.insertBefore(a,b);
    }
    table.querySelectorAll('tbody tr[data-ticker]').forEach(tr=>{
      tr.querySelectorAll('[data-sm-cell]').forEach(x=>x.remove());
      const ticker=tr.dataset.ticker;const ext=external(ticker);const s=window.TAGXSmartMoney?.score(rowInput(tr),ext);
      if(!s)return;
      const a=document.createElement('td');a.dataset.smCell='1';a.className='score';a.textContent=s.smartMoneyScore.toFixed(0);a.title=`Flow ${s.components.flow} | Inst ${s.components.institutional} | Insider ${s.components.insider} | Data ${s.components.dataConfidence}`;
      const b=document.createElement('td');b.dataset.smCell='1';b.innerHTML=`<span class="pill">${s.ignitionProbability.toFixed(0)}%</span>`;b.title=s.state;
      tr.insertBefore(b,tr.children[4]||null);tr.insertBefore(a,b);
    });
    enhanceAnalysis();
  }
  function enhanceAnalysis(){
    const box=document.getElementById('analysisResult');if(!box||box.classList.contains('empty'))return;
    const ticker=box.querySelector('.ticker')?.textContent?.trim().toUpperCase();if(!ticker)return;
    box.querySelectorAll('.smart-money-detail').forEach(x=>x.remove());
    const ext=external(ticker);const s=window.TAGXSmartMoney?.score({},ext);if(!s)return;
    const managers=(ext.institutional?.managers||[]).slice(0,4).map(x=>x.name).join('، ')||'لا يوجد تطابق 13F حالي';
    const d=document.createElement('div');d.className='smart-money-detail';
    d.innerHTML=`<p><strong>Smart Money:</strong> ${s.smartMoneyScore.toFixed(0)}/100 · <strong>Ignition:</strong> ${s.ignitionProbability.toFixed(0)}% · ${s.state}</p><p><strong>مؤسسات 13F:</strong> ${managers}</p><p><strong>Form 4 حديث:</strong> ${ext.insider?.recentForm4Count||0} · <strong>ثقة البيانات:</strong> ${s.components.dataConfidence.toFixed(0)}%</p>`;
    box.appendChild(d);
  }
  const obs=new MutationObserver(()=>augment());
  document.addEventListener('DOMContentLoaded',()=>{const body=document.getElementById('scannerBody');if(body)obs.observe(body,{childList:true});const analysis=document.getElementById('analysisResult');if(analysis)obs.observe(analysis,{childList:true,subtree:true});load();setInterval(load,10*60*1000)});
})();
