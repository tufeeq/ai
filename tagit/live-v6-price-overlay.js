(() => {
  const FEED = 'https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json';
  const EVERY_MS = 5000;
  const FRESH_QUOTE_MS = 90000;
  const DELAYED_QUOTE_MS = 180000;
  const previous = new Map();

  const num = v => (v == null || v === '' || !Number.isFinite(+v)) ? null : +v;
  const fmtPrice = v => {
    const x = num(v);
    if (x == null) return '—';
    return '$' + x.toLocaleString('en-US', { maximumFractionDigits: x < 1 ? 4 : 2 });
  };
  const fmtPct = v => {
    const x = num(v);
    if (x == null) return '—';
    return `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
  };
  const stampOf = x => x?.timestampET || x?.timestampUTC || x?.quoteTime || null;
  const quoteAgeMs = (x, feed) => {
    const raw = stampOf(x) || feed?.updatedAtUTC || feed?.updatedAtET;
    const t = Date.parse(raw || '');
    return Number.isFinite(t) ? Math.max(0, Date.now() - t) : Infinity;
  };
  const byTicker = feed => {
    const m = new Map();
    for (const lane of ['earlyCandidates','emergingCandidates','accumulationCandidates']) {
      for (const x of feed?.[lane] || []) if (x?.ticker) m.set(String(x.ticker).toUpperCase(), x);
    }
    if (Array.isArray(feed?.quotes)) {
      for (const x of feed.quotes) if (x?.ticker) m.set(String(x.ticker).toUpperCase(), x);
    } else if (feed?.quotes && typeof feed.quotes === 'object') {
      for (const [k, x] of Object.entries(feed.quotes)) m.set(String(x?.ticker || k).toUpperCase(), x);
    }
    return m;
  };

  function ensureStyles() {
    if (document.getElementById('tagit-price-overlay-style')) return;
    const s = document.createElement('style');
    s.id = 'tagit-price-overlay-style';
    s.textContent = `
      .opp .price-row b,.opp .price-row span{transition:color .18s ease,transform .18s ease,background .18s ease}
      .opp.quote-up .price-row b{color:#39d98a;transform:translateY(-1px)}
      .opp.quote-down .price-row b{color:#ff6b6b;transform:translateY(1px)}
      .opp .quote-age{font-size:10px;opacity:.75;margin-inline-start:7px;white-space:nowrap}
      .opp .quote-age.fresh{color:#49d99b;opacity:.95}
      .opp .quote-age.delayed{color:#ffb84d;opacity:1}
      .opp .quote-age.stale{color:#ff6b6b;opacity:1}
    `;
    document.head.appendChild(s);
  }

  function patchCard(card, row, feed) {
    const symbol = String(card.dataset.symbol || '').toUpperCase();
    const price = num(row?.price);
    const change = num(row?.changePct);
    if (!symbol || price == null) return;

    const priceEl = card.querySelector('.price-row b');
    const changeEl = card.querySelector('.price-row span');
    if (!priceEl || !changeEl) return;

    const old = previous.get(symbol);
    card.classList.remove('quote-up', 'quote-down');
    if (old != null && price !== old) {
      card.classList.add(price > old ? 'quote-up' : 'quote-down');
      setTimeout(() => card.classList.remove('quote-up', 'quote-down'), 550);
    }
    previous.set(symbol, price);

    priceEl.textContent = fmtPrice(price);
    changeEl.textContent = fmtPct(change);
    changeEl.classList.toggle('pos', change != null && change >= 0);
    changeEl.classList.toggle('neg', change != null && change < 0);

    let age = card.querySelector('.quote-age');
    if (!age) {
      age = document.createElement('small');
      age.className = 'quote-age';
      card.querySelector('.price-row')?.appendChild(age);
    }
    const ms = quoteAgeMs(row, feed);
    const sec = Number.isFinite(ms) ? Math.round(ms / 1000) : null;
    age.textContent = sec == null ? 'age —' : sec < 60 ? `${sec}s` : `${(sec / 60).toFixed(1)}m`;
    age.classList.remove('fresh', 'delayed', 'stale');
    age.classList.add(ms <= FRESH_QUOTE_MS ? 'fresh' : ms <= DELAYED_QUOTE_MS ? 'delayed' : 'stale');
    card.dataset.quoteAgeMs = Number.isFinite(ms) ? String(Math.round(ms)) : '';
  }

  async function tick() {
    try {
      const r = await fetch(`${FEED}?priceOverlay=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const feed = await r.json();
      const map = byTicker(feed);
      document.querySelectorAll('.opp[data-symbol]').forEach(card => {
        const row = map.get(String(card.dataset.symbol || '').toUpperCase());
        if (row) patchCard(card, row, feed);
      });
    } catch (e) {
      console.warn('TAGit quote overlay:', e);
    }
  }

  ensureStyles();
  setInterval(tick, EVERY_MS);
  setTimeout(tick, 900);
})();
