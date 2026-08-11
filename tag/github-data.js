(() => {
  async function loadGitHubFinviz() {
    const s = document.getElementById('finvizStatus');
    const b = document.getElementById('dataBadge');
    if (s) { s.className = 'connector-status'; s.textContent = 'جاري تحميل أحدث بيانات Finviz من GitHub…'; }
    try {
      const r = await fetch('./data/finviz.json?ts=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('Data file not ready yet');
      const payload = await r.json();
      const finvizRows = Array.isArray(payload.data) ? payload.data : (Array.isArray(payload.rows) ? payload.rows : []);
      if (!finvizRows.length) throw new Error('No Finviz rows found');
      if (typeof normalizeFinviz !== 'function') throw new Error('TAG Finviz parser is not ready');
      rows = normalizeFinviz(finvizRows);
      render();
      if (b) { b.textContent = '● DATA: FINVIZ'; b.classList.add('connected'); }
      if (s) { s.className = 'connector-status ok'; s.textContent = `Finviz متصل عبر GitHub Actions · ${finvizRows.length} سهم · آخر تحديث ${new Date(payload.updatedAt).toLocaleString()}`; }
    } catch (e) {
      if (s) { s.className = 'connector-status err'; s.textContent = 'تعذر تحميل بيانات Finviz: ' + e.message; }
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('connectFinviz');
    if (btn) { btn.textContent = 'تحميل أحدث بيانات Finviz'; btn.onclick = loadGitHubFinviz; }
    const token = document.getElementById('finvizToken'); if (token) token.closest('label').style.display = 'none';
    const url = document.getElementById('finvizUrl'); if (url) url.closest('label').style.display = 'none';
    ['toggleToken','forgetToken'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
    const remember = document.getElementById('rememberToken'); if(remember) remember.closest('label').style.display='none';
    const s = document.getElementById('finvizStatus'); if(s) s.textContent = 'الربط عبر GitHub Actions؛ لا حاجة إلى Vercel أو إدخال Token في الصفحة.';
  });
})();