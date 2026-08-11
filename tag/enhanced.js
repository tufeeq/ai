(() => {
  const oldNormalize = window.normalizeFinviz;
  const num = v => {
    if (typeof v === 'number') return v;
    const s = String(v ?? '').replace(/[$,%]/g,'').trim();
    const m = s.match(/^(-?[\d.]+)\s*([KMBT])?$/i);
    if (!m) return Number(s) || 0;
    const p={K:1e3,M:1e6,B:1e9,T:1e12};
    return Number(m[1])*(p[(m[2]||'').toUpperCase()]||1);
  };
  const pct = v => num(v);
  const pickRaw = (o, names) => {
    for (const k of Object.keys(o||{})) {
      const key = k.toLowerCase().replace(/[^a-z0-9]/g,'');
      if (names.includes(key)) return o[k];
    }
    return '';
  };
  window.normalizeFinviz = function(raw){
    const base = oldNormalize(raw);
    const byTicker = new Map(raw.map(o=>[String(o.Ticker||o.Symbol||'').toUpperCase(),o]));
    return base.map(x=>{
      const o=byTicker.get(x.ticker)||{};
      return {...x, raw:o,
        company:pickRaw(o,['company']), sector:pickRaw(o,['sector']), industry:pickRaw(o,['industry']), country:pickRaw(o,['country']),
        marketCap:num(pickRaw(o,['marketcap'])), sharesOutstanding:num(pickRaw(o,['shoutstand','sharesoutstanding','sharesoutstd'])),
        float:num(pickRaw(o,['shsfloat','sharesfloat','float']))||x.float,
        shortFloat:pct(pickRaw(o,['shortfloat'])), shortRatio:num(pickRaw(o,['shortratio'])),
        relVolume:num(pickRaw(o,['relvolume','relativevolume'])), targetPrice:num(pickRaw(o,['targetprice'])),
        perfWeek:pct(pickRaw(o,['perfweek'])), perfMonth:pct(pickRaw(o,['perfmonth'])), perfQuarter:pct(pickRaw(o,['perfquarter'])), perfYear:pct(pickRaw(o,['perfyear'])),
        rsi:num(pickRaw(o,['rsi14','rsi'])), atr:num(pickRaw(o,['atr'])), volatility:pickRaw(o,['volatility']), earnings:pickRaw(o,['earnings']),
        analystRec:pickRaw(o,['recom','recommendation','analystrecommendation'])
      };
    });
  };

  function estimateUpside(x){
    const base = x.score*.34 + x.continuation*.29 + x.ignition*.18 - x.exhaustion*.24;
    const squeeze = Math.min(22,(x.shortFloat||0)*.35) + Math.min(12,Math.max(0,(x.turnover||0)-1)*5);
    const momentum = Math.min(18,Math.max(0,x.rvol-1)*1.8);
    return Math.max(0,Math.min(150, base*.9 + squeeze + momentum));
  }
  window.TAGExpectedUpside = estimateUpside;

  let sortKey='score', sortDir='desc';
  function ensureUI(){
    const controls=document.querySelector('.control-row');
    if(controls && !document.getElementById('sortKey')){
      controls.insertAdjacentHTML('beforeend',`<label>ترتيب الجدول<select id="sortKey"><option value="score">TAG Score</option><option value="expectedUpside">الارتفاع المتوقع</option><option value="changePct">التغير</option><option value="rvol">RVOL</option><option value="turnover">Float Turnover</option><option value="shortFloat">Short Float</option><option value="float">Float</option></select></label><button id="sortDir">↓ تنازلي</button>`);
      document.getElementById('sortKey').addEventListener('change',e=>{sortKey=e.target.value; render();});
      document.getElementById('sortDir').addEventListener('click',()=>{sortDir=sortDir==='desc'?'asc':'desc';document.getElementById('sortDir').textContent=sortDir==='desc'?'↓ تنازلي':'↑ تصاعدي';render();});
    }
    if(!document.getElementById('stockDrawer')){
      document.body.insertAdjacentHTML('beforeend',`<div id="stockDrawer" class="stock-drawer" aria-hidden="true"><div class="drawer-backdrop"></div><aside class="drawer-panel"><button class="drawer-close">×</button><div id="drawerContent"></div></aside></div>`);
      document.querySelector('.drawer-close').addEventListener('click',closeDrawer);
      document.querySelector('.drawer-backdrop').addEventListener('click',closeDrawer);
    }
  }
  function closeDrawer(){const d=document.getElementById('stockDrawer');d.classList.remove('open');d.setAttribute('aria-hidden','true');}
  const fmt=v=>v?Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(v):'—';
  const val=(v,s='')=>(v!==undefined&&v!==null&&v!==''&&v!==0)?`${v}${s}`:'—';
  function squeezeScore(x){return Math.min(100,(x.shortFloat||0)*2.1 + Math.min(30,(x.rvol||0)*5)+Math.min(20,(x.turnover||0)*10));}
  function openDrawer(ticker){
    const raw=rows.find(r=>r.ticker===ticker); if(!raw)return;
    const x=analyze(raw), up=estimateUpside(x), sq=squeezeScore(x);
    const finviz=`https://finviz.com/quote.ashx?t=${encodeURIComponent(x.ticker)}`;
    document.getElementById('drawerContent').innerHTML=`
      <div class="drawer-head"><div><div class="drawer-ticker">${x.ticker}</div><h2>${x.company||'Company details'}</h2><p>${[x.sector,x.industry,x.country].filter(Boolean).join(' · ')}</p></div><div class="upside-card"><small>TAG Expected Upside*</small><strong>+${up.toFixed(0)}%</strong><span>Scenario estimate</span></div></div>
      <div class="detail-grid">
        <div><span>السعر</span><b>$${x.price||'—'}</b></div><div><span>TAG Score</span><b>${x.score.toFixed(0)}</b></div><div><span>القيمة السوقية</span><b>${fmt(x.marketCap)}</b></div><div><span>Shares Outstanding</span><b>${fmt(x.sharesOutstanding)}</b></div>
        <div><span>Float</span><b>${fmt(x.float)}</b></div><div><span>Short Float</span><b>${val(x.shortFloat?.toFixed?.(1),'%')}</b></div><div><span>Short Ratio</span><b>${val(x.shortRatio?.toFixed?.(1))}</b></div><div><span>Squeeze Pressure</span><b>${sq.toFixed(0)}/100</b></div>
        <div><span>RVOL</span><b>${x.rvol.toFixed(1)}×</b></div><div><span>Float Turnover</span><b>${x.turnover.toFixed(1)}×</b></div><div><span>RSI</span><b>${val(x.rsi?.toFixed?.(0))}</b></div><div><span>ATR</span><b>${val(x.atr?.toFixed?.(2))}</b></div>
      </div>
      <section class="drawer-section"><h3>TAG Signal Stack</h3>${[['Early Regime',x.early],['Ignition',x.ignition],['Continuation',x.continuation],['Exhaustion',x.exhaustion],['Squeeze',sq]].map(([k,v])=>`<div class="detail-bar"><span>${k}</span><i><b style="width:${Math.min(100,v)}%"></b></i><em>${v.toFixed(0)}</em></div>`).join('')}</section>
      <section class="drawer-section"><h3>السجل السعري</h3><div class="history-grid"><div>1W <b>${val(x.perfWeek?.toFixed?.(1),'%')}</b></div><div>1M <b>${val(x.perfMonth?.toFixed?.(1),'%')}</b></div><div>3M <b>${val(x.perfQuarter?.toFixed?.(1),'%')}</b></div><div>1Y <b>${val(x.perfYear?.toFixed?.(1),'%')}</b></div></div></section>
      <section class="drawer-section"><h3>المحفزات والأخبار</h3><p>الأخبار التفصيلية ليست جزءًا من Screener CSV الحالي. افتح صفحة Finviz للسهم للوصول إلى أحدث الأخبار والإفصاحات المرتبطة به.</p><a class="drawer-link" href="${finviz}" target="_blank" rel="noopener">فتح أخبار وتحليل ${x.ticker} في Finviz ↗</a></section>
      <section class="drawer-section"><h3>ملاحظات المخاطر</h3><p>${x.reasons.join(' · ')||'لا توجد إشارة استثنائية.'}</p><p class="drawer-note">* نسبة الارتفاع المتوقعة هي تقدير سيناريو من نموذج TAG5 وليست سعرًا مستهدفًا أو ضمانًا لحدوث الارتفاع.</p></section>`;
    const d=document.getElementById('stockDrawer');d.classList.add('open');d.setAttribute('aria-hidden','false');
  }

  const oldRender=window.render;
  window.render=function(){
    oldRender(); ensureUI();
    const body=document.getElementById('scannerBody'); if(!body)return;
    const q=document.querySelector('#search').value.trim().toUpperCase(), sf=document.querySelector('#stageFilter').value, sh=document.querySelector('#shariaFilter').value;
    let out=rows.map(analyze).map(x=>({...x,expectedUpside:estimateUpside(x)})).filter(x=>(!q||x.ticker.includes(q))&&(sf==='all'||x.stage===sf)&&(sh==='all'||x.sharia===sh));
    out.sort((a,b)=>{const av=Number(a[sortKey])||0,bv=Number(b[sortKey])||0;return sortDir==='desc'?bv-av:av-bv;});
    const head=document.querySelector('.table-wrap thead tr');
    if(head && !head.querySelector('[data-upside]')){const th=document.createElement('th');th.dataset.upside='1';th.textContent='Expected ↑';head.insertBefore(th,head.children[4]);}
    body.innerHTML=out.map(x=>`<tr data-ticker="${x.ticker}" class="interactive-row"><td class="ticker">${x.ticker}</td><td>$${num(x.price).toFixed(x.price<1?3:2)}</td><td class="${x.changePct>=0?'pos':'neg'}">${x.changePct>=0?'+':''}${x.changePct.toFixed(1)}%</td><td class="score">${x.score.toFixed(0)}</td><td class="expected-up">+${x.expectedUpside.toFixed(0)}%</td><td><span class="pill p-${x.stage.toLowerCase()}">${x.stage}</span></td><td>${x.ignition.toFixed(0)}</td><td>${x.continuation.toFixed(0)}</td><td>${x.exhaustion.toFixed(0)}</td><td>${x.rvol.toFixed(1)}×</td><td>${x.turnover.toFixed(1)}×</td><td><span class="pill p-${x.sharia.toLowerCase()}">${x.sharia}</span></td><td>${x.reasons.join(' · ')||'—'}</td></tr>`).join('')||'<tr><td colspan="13">لا توجد نتائج مطابقة.</td></tr>';
    body.querySelectorAll('tr[data-ticker]').forEach(tr=>tr.addEventListener('click',()=>openDrawer(tr.dataset.ticker)));
  };
  document.addEventListener('DOMContentLoaded',ensureUI);
})();