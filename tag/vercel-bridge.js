(() => {
  const status = () => document.getElementById('finvizStatus');
  const badge = () => document.getElementById('dataBadge');

  async function connectServer() {
    const s = status();
    s.className = 'connector-status';
    s.textContent = 'جاري الاتصال الآمن عبر Vercel…';
    try {
      const r = await fetch('/api/finviz', { cache: 'no-store' });
      const text = await r.text();
      if (!r.ok) {
        let msg = text;
        try { msg = JSON.parse(text).error || msg; } catch (_) {}
        throw new Error(msg);
      }
      if (typeof loadFinvizText !== 'function') throw new Error('TAG parser is not ready');
      await loadFinvizText(text, 'Finviz via Vercel');
      badge().textContent = '● DATA: FINVIZ LIVE';
      badge().classList.add('connected');
      s.className = 'connector-status ok';
      s.textContent = 'متصل عبر Vercel. Finviz Token محفوظ على الخادم ولا يصل إلى المتصفح.';
    } catch (e) {
      s.className = 'connector-status err';
      s.textContent = 'اتصال Vercel غير مكتمل: ' + e.message;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('connectFinviz');
    if (btn) {
      btn.textContent = 'اتصال آمن عبر Vercel';
      btn.onclick = connectServer;
    }
    const token = document.getElementById('finvizToken');
    const url = document.getElementById('finvizUrl');
    const toggle = document.getElementById('toggleToken');
    const remember = document.getElementById('rememberToken');
    const forget = document.getElementById('forgetToken');
    if (token) token.closest('label').style.display = 'none';
    if (url) url.closest('label').style.display = 'none';
    if (toggle) toggle.style.display = 'none';
    if (remember) remember.closest('label').style.display = 'none';
    if (forget) forget.style.display = 'none';
    const s = status();
    if (s) s.textContent = 'الاتصال الآن يتم عبر Vercel Serverless؛ لا حاجة لإدخال Token في المتصفح.';
  });
})();