'use strict';
(function(){
  const RELEASE='TAGX 1.3';
  const DATA_URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/sharia.json';
  const HARD_EXCLUDE=[
    /\bbanks?\b/i,/credit services/i,/consumer finance/i,/mortgage finance/i,/insurance/i,/reinsurance/i,
    /gambl/i,/casino/i,/lottery/i,/alcohol/i,/brew(er|ery|ing)/i,/winery|wineries/i,/distill/i,
    /tobacco/i,/cigarette/i,/adult entertainment/i,/porn/i,/marijuana|cannabis/i
  ];
  const INSTRUMENT_EXCLUDE=[/\betf\b/i,/exchange[- ]traded fund/i,/\b2x\b/i,/\b3x\b/i,/leveraged/i,/inverse/i];
  const AMBIGUOUS=[/shell compan/i,/blank check/i,/\bspac\b/i,/capital markets/i,/asset management/i,/investment management/i];
  const state={rows:{},updatedAt:null,source:null};
  function text(x){return [x?.Company,x?.Sector,x?.Industry].filter(Boolean).join(' · ')}
  function local(x){
    const s=text(x);
    if(HARD_EXCLUDE.some(r=>r.test(s))||INSTRUMENT_EXCLUDE.some(r=>r.test(s))){return{status:'EXCLUDED',emoji:'🔴',labelAr:'غير متوافق',confidence:'HIGH',activityStatus:'FAIL',activityReason:'النشاط/الأداة الظاهرة تقع ضمن الاستبعادات الشرعية الصريحة في الفحص الآلي.',financialStatus:'NOT_EVALUATED',methodology:'AAOIFI-style research screen'}}
    if(AMBIGUOUS.some(r=>r.test(s))){return{status:'UNVERIFIED',emoji:'🟡',labelAr:'غير متحقق',confidence:'LOW',activityStatus:'AMBIGUOUS',activityReason:'النشاط يحتاج تحققًا يدويًا أو ماليًا إضافيًا قبل اعتباره متوافقًا.',financialStatus:'UNVERIFIED',methodology:'AAOIFI-style research screen'}}
    return{status:'UNVERIFIED',emoji:'🟡',labelAr:'غير متحقق',confidence:'MEDIUM',activityStatus:'PASS',activityReason:'لا يظهر نشاط محظور صريح من Company/Sector/Industry، لكن الفحص المالي الكامل غير مكتمل.',financialStatus:'UNVERIFIED',methodology:'AAOIFI-style research screen'};
  }
  function info(x){
    const t=String(x?.Ticker||x?.ticker||'').toUpperCase();
    const e=state.rows?.[t];
    if(e){
      const st=String(e.status||'UNVERIFIED').toUpperCase();
      return {...e,status:st,emoji:e.emoji||(st==='VERIFIED'?'🟢':st==='EXCLUDED'?'🔴':'🟡'),labelAr:e.labelAr||(st==='VERIFIED'?'متوافق':st==='EXCLUDED'?'غير متوافق':'غير متحقق')};
    }
    return local(x);
  }
  function badge(i){const c=i.status==='VERIFIED'?'ok':i.status==='EXCLUDED'?'bad':'warn';return `<span class="chip ${c}" style="display:inline-flex;align-items:center;gap:5px;padding:5px 9px">${i.emoji} ${i.labelAr}</span>`}
  function fmt(v){if(v==null||!Number.isFinite(+v))return'—';return (+v).toFixed(1)+'%'}
  function decorate(){
    document.querySelectorAll('#topOpps .opp[data-ticker]').forEach(card=>{const x=rowMap.get(card.dataset.ticker);if(!x)return;const i=info(x);let el=card.querySelector('.sharia13');if(!el){el=document.createElement('div');el.className='sharia13';el.style.marginTop='8px';const why=card.querySelector('.why');card.insertBefore(el,why||null)}el.innerHTML=badge(i)+(i.status!=='VERIFIED'?'<span class="sub" style="margin-inline-start:7px">Research Only</span>':'')});
    document.querySelectorAll('#radarRows tr[data-ticker]').forEach(tr=>{const x=rowMap.get(tr.dataset.ticker);if(!x)return;const td=tr.lastElementChild;if(td)td.innerHTML=badge(info(x))});
    const counts={VERIFIED:0,UNVERIFIED:0,EXCLUDED:0};rows.forEach(x=>{const s=info(x).status;counts[s]=(counts[s]||0)+1});
    const st=document.querySelector('#status');if(st){let c=st.querySelector('[data-sharia-summary]');if(!c){c=document.createElement('span');c.dataset.shariaSummary='1';c.className='chip';st.appendChild(c)}c.innerHTML=`🟢 ${counts.VERIFIED||0} · 🟡 ${counts.UNVERIFIED||0} · 🔴 ${counts.EXCLUDED||0}`}
  }
  async function loadData(){try{const r=await fetch(DATA_URL+'?v='+Date.now(),{cache:'no-store'});if(r.ok){const j=await r.json();state.rows=j.rows||{};state.updatedAt=j.updatedAt||null;state.source=j.source||null}}catch{}try{render()}catch{}decorate()}
  try{
    const oldSharia=sharia;
    sharia=function(x){return info(x).status};
    const oldRender=render;
    render=function(){oldRender();decorate()};
    const oldOpen=openStock;
    openStock=function(ticker){oldOpen(ticker);const x=rowMap.get(ticker);if(!x)return;const i=info(x);const body=document.querySelector('#drawerBody');if(!body)return;const boxes=[...body.querySelectorAll('.detail-box')];for(const b of boxes){if(b.querySelector('small')?.textContent.trim()==='الشرعية'){const v=b.querySelector('b');if(v)v.innerHTML=badge(i)}}let sec=body.querySelector('[data-sharia-detail]');if(!sec){sec=document.createElement('div');sec.className='section';sec.dataset.shariaDetail='1';const grid=body.querySelector('.detail-grid');(grid?.parentNode||body).insertBefore(sec,grid?.nextSibling||body.firstChild)}const f=i.financial||{};sec.innerHTML=`<h4>التوافق مع الشريعة</h4><div class="riskline">${badge(i)}<br><b>النشاط:</b> ${esc(i.activityReason||i.activity?.reason||'—')}<br><b>الفحص المالي:</b> ${esc(i.financialStatus||f.status||'UNVERIFIED')}<br><b>الدين/القيمة السوقية:</b> ${fmt(f.debtToMarketCapPct??i.debtToMarketCapPct)} · الحد البحثي 30%<br><b>النقد والأوراق ذات العائد/القيمة السوقية:</b> ${fmt(f.cashSecuritiesToMarketCapPct??i.cashSecuritiesToMarketCapPct)} · الحد البحثي 30%<br><b>الدخل غير المباح/الإيراد:</b> ${fmt(f.nonPermissibleIncomePct??i.nonPermissibleIncomePct)} · الحد البحثي 5%<br><b>الثقة:</b> ${esc(i.confidence||'—')} · <b>آخر فحص:</b> ${window.TAGXProjectionV12?.gregorianDate?.(i.checkedAt||state.updatedAt)||esc(i.checkedAt||state.updatedAt||'—')}<br><span class="sub">فحص آلي AAOIFI-style للبحث ودعم القرار، وليس فتوى أو شهادة شرعية رسمية. الحالة الخضراء لا تظهر إلا عند اكتمال شروط التحقق المحددة؛ النقص يبقى 🟡 غير متحقق.</span></div>`}
  }catch(e){console.error('TAGX sharia v13 hook',e)}
  window.TAGXShariaV13={release:RELEASE,info,state};
  loadData();
})();
