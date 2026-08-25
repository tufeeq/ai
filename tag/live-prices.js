'use strict';

(function(){
  const POLL_MS = 45000;
  let timer = null;
  let liveMeta = null;

  function n(v){
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  function sessionLabel(s){
    return ({
      'pre-market':'PRE',
      'regular':'LIVE',
      'after-hours':'AFTER',
      'closed':'CLOSED'
    })[s] || 'LIVE';
  }

  function sessionArabic(s){
    return ({
      'pre-market':'ما قبل الافتتاح',
      'regular':'الجلسة',
      'after-hours':'بعد الإغلاق',
      'closed':'مغلق'
    })[s] || 'حي';
  }

  function mergeLive(payload){
    const quotes = payload && payload.quotes ? payload.quotes : {};
    if(!Array.isArray(rows) || !rows.length) return 0;
    let merged = 0;
    for(const row of rows){
      const q = quotes[row.ticker];
      if(!q) continue;
      const livePrice = n(q.price);
      const prevClose = n(q.previousClose);
      const regular = n(q.regularMarketPrice);
      const pre = n(q.preMarketPrice);
      const after = n(q.afterHoursPrice);
      const session = q.session || payload.marketClockSession || 'closed';

      row.liveSession = session;
      row.liveTimestampET = q.timestampET || payload.updatedAtET || null;
      row.liveSource = q.source || payload.source || 'live';
      row.regularMarketPrice = regular;
      row.preMarketPrice = pre;
      row.afterHoursPrice = after;

      if(prevClose !== null) row.prevClose = prevClose;
      if(n(q.preMarketChangePct) !== null) row.pmChange = n(q.preMarketChangePct);
      if(n(q.afterHoursChangePct) !== null) row.ahChange = n(q.afterHoursChangePct);
      if(n(q.preMarketVolume) !== null) row.pmVolume = n(q.preMarketVolume);
      if(n(q.afterHoursVolume) !== null) row.ahVolume = n(q.afterHoursVolume);

      if(livePrice !== null){
        row.price = livePrice;
        const cp = n(q.changePct);
        if(cp !== null) row.changePct = cp;
        merged++;
      }
    }
    liveMeta = payload;
    return merged;
  }

  function decoratePrices(){
    if(!Array.isArray(analyzed)) return;
    const map = new Map(analyzed.map(x => [x.ticker, x]));
    document.querySelectorAll('#scannerBody tr[data-ticker]').forEach(tr => {
      const x = map.get(tr.dataset.ticker);
      if(!x) return;
      const cells = tr.querySelectorAll('td');
      if(cells.length < 3) return;
      const p = Number.isFinite(x.price) ? '$' + fmt(x.price, x.price < 1 ? 3 : 2) : '—';
      const badge = x.liveSession ? `<span class="session-badge session-${esc(x.liveSession)}">${sessionLabel(x.liveSession)}</span>` : '';
      const when = x.liveTimestampET ? new Date(x.liveTimestampET).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}) + ' ET' : '';
      cells[1].innerHTML = `<div class="live-price-wrap"><strong>${p}</strong>${badge}<small>${esc(when)}</small></div>`;
    });

    const badge = document.querySelector('#dataBadge');
    if(badge && liveMeta){
      const s = liveMeta.marketClockSession || 'closed';
      badge.textContent = `● الأسعار: ${sessionArabic(s)} · ${liveMeta.count || 0} حي`;
      badge.classList.add('connected');
    }
  }

  async function refreshLivePrices(){
    try{
      const r = await fetch(`./data/live-quotes.json?v=${Date.now()}`, {cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload = await r.json();
      const count = mergeLive(payload);
      if(count){
        render();
        decoratePrices();
        const log = document.querySelector('#integrityLog');
        if(log){
          const stamp = payload.updatedAtET ? new Date(payload.updatedAtET).toLocaleString('ar-SA',{timeZone:'America/New_York'}) : '—';
          log.insertAdjacentHTML('afterbegin', `<div class="log-item">Live feed · ${count} سعر · ${esc(sessionArabic(payload.marketClockSession))} · ${esc(stamp)} ET</div>`);
        }
      }
    }catch(e){
      const status = document.querySelector('#finvizStatus');
      if(status) status.textContent = `${status.textContent} · تعذر تحديث الأسعار الحية الآن`;
    }
  }

  function installStyles(){
    if(document.querySelector('#tagx-live-price-style')) return;
    const st = document.createElement('style');
    st.id = 'tagx-live-price-style';
    st.textContent = `
      .live-price-wrap{display:flex;align-items:center;gap:6px;flex-wrap:wrap;white-space:nowrap}
      .live-price-wrap small{display:block;width:100%;opacity:.65;font-size:10px;direction:ltr;text-align:right}
      .session-badge{font-size:10px;font-weight:800;padding:2px 6px;border-radius:999px;border:1px solid currentColor;line-height:1.2}
      .session-pre-market{color:#d69e2e}.session-regular{color:#38a169}.session-after-hours{color:#805ad5}.session-closed{color:#718096}
    `;
    document.head.appendChild(st);
  }

  function start(){
    installStyles();
    setTimeout(refreshLivePrices, 1200);
    timer = setInterval(refreshLivePrices, POLL_MS);
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden) refreshLivePrices();
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
