'use strict';
(() => {
  let key = sessionStorage.getItem('mh_admin') || '';
  const $ = (id) => document.getElementById(id);
  const KINDS = {
    reset_request: 'طلب إعادة تعيين', reset_consume: 'استخدام رابط', password_changed: 'إشعار تغيير',
    send: 'رسالة تلقائية', project_created: 'إنشاء مشروع', key_rotated: 'تجديد مفتاح',
  };

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${res.status}`), { status: res.status });
    return data;
  }

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const kid of kids) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid ?? '')));
    return n;
  };

  function showKey(k) {
    $('newKey').textContent = k;
    $('keyBox').hidden = false;
    $('keyBox').scrollIntoView({ behavior: 'smooth' });
  }

  async function load() {
    const [{ projects }, status] = await Promise.all([api('GET', '/admin/api/projects'), api('GET', '/admin/api/status')]);
    const s = $('smtpStatus');
    s.textContent = status.smtp.ok ? 'متصل' : `غير متصل (${status.smtp.error})`;
    s.className = `value ${status.smtp.ok ? 'ok' : 'bad'}`;
    $('projectCount').textContent = projects.length;
    $('eventCount').textContent = projects.reduce((a, p) => a + p.events_24h, 0);

    const tbody = $('projects');
    tbody.replaceChildren(...projects.map((p) => el('tr', {},
      el('td', {}, el('span', { class: 'swatch', style: `background:${p.brand_color}` }), p.name, ' ', el('code', { class: 'ltr' }, p.id)),
      el('td', {}, p.from_name, ' ', el('span', { class: 'ltr muted' }, `<${p.from_email}>`)),
      el('td', {}, el('span', { class: 'ltr' }, p.reset_url)),
      el('td', {}, `${p.events_24h}`, p.failures_24h ? el('span', { class: 'error' }, ` (${p.failures_24h} فشل)`) : ''),
      el('td', {}, el('span', { class: `pill ${p.disabled ? 'off' : ''}` }, p.disabled ? 'موقوف' : 'يعمل')),
      el('td', {},
        el('button', { class: 'ghost', type: 'button', onclick: async () => {
          if (!confirm(`تجديد مفتاح ${p.name}؟ المفتاح الحالي سيتوقف فورًا.`)) return;
          showKey((await api('POST', `/admin/api/projects/${p.id}/rotate-key`)).api_key);
        } }, 'تجديد المفتاح'), ' ',
        el('button', { class: 'ghost warn', type: 'button', onclick: async () => {
          await api('PATCH', `/admin/api/projects/${p.id}`, { disabled: !p.disabled }); load();
        } }, p.disabled ? 'تشغيل' : 'إيقاف')),
    )));

    $('events').replaceChildren(...status.recent.map((e) => el('li', {},
      el('span', { class: 'k' }, KINDS[e.kind] || e.kind), el('code', {}, e.project_id || ''),
      e.ok ? '' : el('span', { class: 'f' }, e.detail || 'فشل'),
      el('time', {}, new Date(e.at).toLocaleString('ar-SA-u-nu-latn')))));
  }

  async function enter() {
    try {
      await load();
      sessionStorage.setItem('mh_admin', key);
      $('login').hidden = true; $('app').hidden = false;
    } catch (e) {
      sessionStorage.removeItem('mh_admin');
      $('loginError').textContent = e.status === 401 ? 'المفتاح غير صحيح.' : `تعذّر الدخول: ${e.message}`;
      $('loginError').hidden = false;
    }
  }

  $('loginForm').addEventListener('submit', (ev) => { ev.preventDefault(); key = $('adminKey').value.trim(); $('adminKey').value = ''; enter(); });
  $('copyKey').addEventListener('click', () => navigator.clipboard.writeText($('newKey').textContent));
  $('createForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    for (const k of Object.keys(data)) if (data[k] === '') delete data[k];
    try {
      $('createError').hidden = true;
      showKey((await api('POST', '/admin/api/projects', data)).api_key);
      ev.target.reset(); load();
    } catch (e) { $('createError').textContent = e.message; $('createError').hidden = false; }
  });

  if (key) enter();
})();
