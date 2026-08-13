(()=>{
  const $=s=>document.querySelector(s);
  const numericFields=['price','changePct','volume','avgVolume','float','pmChange','ahChange','ahVolume','spreadPct','catalystAgeHours'];
  const labels={price:'السعر',changePct:'التغير %',volume:'الحجم',avgVolume:'متوسط الحجم',float:'الفلوت',pmChange:'قبل الافتتاح %',ahChange:'بعد الإغلاق %',ahVolume:'حجم AH',spreadPct:'Spread %',catalystAgeHours:'عمر المحفز'};
  const fmt=(v,d=2)=>Number.isFinite(+v)?Number(v).toLocaleString('en-US',{maximumFractionDigits:d}):'غير متوفر';
  let enrichmentCache=null;

  function cleanNumber(v){
    const s=String(v??'').trim();
    if(!s)return null;
    const m=s.replace(/[$,%]/g,'').replace(/,/g,'').match(/^(-?[\d.]+)\s*([KMBT])?$/i);
    if(!m)return null;
    const mult={K:1e3,M:1e6,B:1e9,T:1e12};
    const n=Number(m[1])*(mult[(m[2]||'').toUpperCase()]||1);
    return Number.isFinite(n)?n:null;
  }
  function findLiveRow(ticker){
    try{return (typeof rows!=='undefined'?rows:[]).find(r=>String(r.ticker||r.Ticker||'').toUpperCase()===ticker)||null;}catch(e){return null;}
  }
  async function enrichment(){
    if(enrichmentCache)return enrichmentCache;
    try{const r=await fetch(`./data/enrichment.json?ts=${Date.now()}`,{cache:'no-store'});if(!r.ok)return null;enrichmentCache=await r.json();return enrichmentCache;}catch(e){return null;}
  }
  function recursiveTickerLookup(obj,ticker,depth=0){
    if(!obj||depth>5)return null;
    if(Array.isArray(obj)){
      for(const x of obj){const hit=recursiveTickerLookup(x,ticker,depth+1);if(hit)return hit;}
      return null;
    }
    if(typeof obj!=='object')return null;
    const symbol=String(obj.ticker||obj.Ticker||obj.symbol||obj.Symbol||'').toUpperCase();
    if(symbol===ticker)return obj;
    if(obj[ticker]&&typeof obj[ticker]==='object')return obj[ticker];
    for(const v of Object.values(obj)){if(v&&typeof v==='object'){const hit=recursiveTickerLookup(v,ticker,depth+1);if(hit)return hit;}}
    return null;
  }
  function val(o,...keys){for(const k of keys){if(o&&o[k]!==undefined&&o[k]!==null&&o[k]!=='')return o[k];}return null;}
  function mergeSource(live,enr){
    const market=enr?.market||enr?.quote||enr?.yahoo||enr?.price||{};
    return {
      price: val(live,'price') ?? val(market,'price','regularMarketPrice','postMarketPrice','preMarketPrice') ?? val(enr,'price','regularMarketPrice'),
      changePct: val(live,'changePct') ?? val(market,'changePct','regularMarketChangePercent','postMarketChangePercent','preMarketChangePercent') ?? val(enr,'changePct'),
      volume: val(live,'volume') ?? val(market,'volume','regularMarketVolume') ?? val(enr,'volume'),
      avgVolume: val(live,'avgVolume') ?? val(market,'avgVolume','averageDailyVolume10Day','averageVolume') ?? val(enr,'avgVolume'),
      float: val(live,'float') ?? val(market,'float','floatShares') ?? val(enr,'float','floatShares'),
      pmChange: val(live,'pmChange') ?? val(market,'preMarketChangePercent','pmChange') ?? val(enr,'pmChange'),
      ahChange: val(live,'ahChange') ?? val(market,'postMarketChangePercent','afterHoursChangePercent','ahChange') ?? val(enr,'ahChange'),
      ahVolume: val(live,'ahVolume') ?? val(market,'postMarketVolume','afterHoursVolume','ahVolume') ?? val(enr,'ahVolume'),
      spreadPct: val(live,'spreadPct') ?? val(enr,'spreadPct'),
      catalystAgeHours: val(live,'catalystAgeHours') ?? val(enr,'catalystAgeHours'),
      sharia: val(live,'sharia') ?? val(enr,'sharia') ?? 'UNVERIFIED'
    };
  }
  function setField(form,name,value,source){
    const el=form.elements[name]; if(!el)return;
    if(value===null||value===undefined||value===''){el.value='';el.dataset.source='missing';return;}
    el.value=typeof value==='number'?String(value):String(value).replace('%','');
    el.dataset.source=source;
  }
  function paintSources(form){
    numericFields.forEach(name=>{
      const el=form.elements[name];if(!el)return;
      const label=el.closest('label');if(!label)return;
      let badge=label.querySelector('.field-source');
      if(!badge){badge=document.createElement('small');badge.className='field-source';label.appendChild(badge);}
      const s=el.dataset.source||'manual';
      badge.textContent=s==='live'?'بيانات السوق':s==='enriched'?'مصدر ثانٍ':s==='missing'?'غير متوفر':'إدخال يدوي';
      badge.className=`field-source source-${s}`;
    });
  }
  async function loadTicker(form){
    const ticker=String(form.elements.ticker?.value||'').trim().toUpperCase();
    if(!ticker)return;
    const status=$('#manualAnalyzerStatus'); if(status)status.textContent='جاري جلب بيانات السهم…';
    const live=findLiveRow(ticker);
    const e=await enrichment();
    const enr=recursiveTickerLookup(e,ticker);
    const merged=mergeSource(live,enr);
    numericFields.forEach(name=>setField(form,name,merged[name],live&&live[name]!==undefined&&live[name]!==null?'live':(enr?'enriched':'missing')));
    if(form.elements.sharia)form.elements.sharia.value=['VERIFIED','UNVERIFIED','EXCLUDED'].includes(String(merged.sharia).toUpperCase())?String(merged.sharia).toUpperCase():'UNVERIFIED';
    paintSources(form);
    if(status){
      const sources=[live?'Finviz/TAG market snapshot':null,enr?'enrichment source':null].filter(Boolean);
      status.textContent=sources.length?`تم تحميل ${ticker} من ${sources.join(' + ')}. راجع توقيت البيانات قبل القرار.`:`لم أجد ${ticker} في البيانات الحالية. أدخل القيم يدويًا؛ لن يتم اختلاق الحقول الناقصة.`;
    }
  }
  function readForm(form){
    const o={ticker:String(form.elements.ticker?.value||'').trim().toUpperCase(),sharia:String(form.elements.sharia?.value||'UNVERIFIED').toUpperCase()};
    const missing=[];
    numericFields.forEach(k=>{const v=cleanNumber(form.elements[k]?.value);o[k]=v===null?undefined:v;if(v===null)missing.push(k);});
    return {o,missing};
  }
  function renderResult(o,missing){
    const box=$('#analysisResult');if(!box)return;
    const required=['price','changePct','volume','avgVolume'];
    const absent=required.filter(k=>!Number.isFinite(o[k]));
    if(absent.length){
      box.classList.remove('empty');
      box.innerHTML=`<div class="manual-error"><strong>لا يمكن إصدار تحليل موثوق بعد.</strong><p>الحقول الأساسية المفقودة: ${absent.map(k=>labels[k]).join('، ')}.</p><small>TAG لن يحول الحقول الفارغة إلى صفر ولن يستخدم بيانات المثال السابق.</small></div>`;
      return;
    }
    const z=window.TAG8?.analyze?window.TAG8.analyze(o):(typeof window.analyze==='function'?window.analyze(o):null);
    if(!z){box.innerHTML='<div class="manual-error">محرك TAG8 غير متاح.</div>';return;}
    const t=z.targets||{};
    const missingText=missing.length?missing.map(k=>labels[k]).join('، '):'لا يوجد';
    const stage=window.TAG8?.stageLabel?window.TAG8.stageLabel(z.stage):z.stage;
    box.classList.remove('empty');
    box.innerHTML=`<div class="manual-result-head"><div><small>${o.ticker} · تحليل بالقيم المعروضة فقط</small><h3>${stage}</h3></div><strong>${fmt(z.score,0)}/100</strong></div>
      <div class="manual-result-grid"><div><small>السعر</small><b>$${fmt(z.price,4)}</b></div><div><small>التغير</small><b>${z.changePct>=0?'+':''}${fmt(z.changePct,2)}%</b></div><div><small>RVOL</small><b>${fmt(z.rvol,2)}×</b></div><div><small>المخاطر</small><b>${fmt(z.risk,0)}/100</b></div><div><small>جودة البيانات</small><b>${fmt(z.dataQuality,0)}%</b></div><div><small>T2</small><b>${Number.isFinite(t.t2)?'$'+fmt(t.t2,4):'غير متوفر'}</b></div></div>
      <div class="manual-provenance"><strong>القرار:</strong> ${z.decision||'مراقبة'}<br><strong>حقول ناقصة:</strong> ${missingText}<br><strong>تنبيه:</strong> الحقول الناقصة تخفض جودة البيانات ولا تُفترض قيمها.</div>`;
  }
  function replaceForm(){
    const old=$('#analyzerForm');if(!old||old.dataset.fixed==='1')return;
    const form=old.cloneNode(true);old.replaceWith(form);form.dataset.fixed='1';
    numericFields.forEach(k=>{const el=form.elements[k];if(el){el.value='';el.dataset.source='missing';}});
    if(form.elements.ticker)form.elements.ticker.value='';
    if(form.elements.sharia)form.elements.sharia.value='UNVERIFIED';
    const btn=form.querySelector('button[type="submit"],button.primary');if(btn)btn.textContent='حلل بالقيم الحالية';
    const load=document.createElement('button');load.type='button';load.id='loadTickerData';load.className='app-secondary wide';load.textContent='جلب بيانات السهم الحالية';form.appendChild(load);
    const status=document.createElement('div');status.id='manualAnalyzerStatus';status.className='manual-analyzer-status wide';status.textContent='اكتب الرمز ثم اجلب البيانات الحالية أو أدخل القيم يدويًا.';form.appendChild(status);
    paintSources(form);
    load.onclick=()=>loadTicker(form);
    form.elements.ticker?.addEventListener('change',()=>loadTicker(form));
    numericFields.forEach(k=>form.elements[k]?.addEventListener('input',e=>{e.target.dataset.source='manual';paintSources(form);}));
    form.addEventListener('submit',e=>{e.preventDefault();const {o,missing}=readForm(form);renderResult(o,missing);});
  }
  window.addEventListener('DOMContentLoaded',()=>setTimeout(replaceForm,0));
})();