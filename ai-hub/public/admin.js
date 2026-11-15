// AI Hub — admin dashboard (served at /admin).
// Strict CSP: no inline script/style, no CDN. All DOM is built with
// createElement/textContent; API data never goes through innerHTML.

const STORAGE_KEY = 'aihub_admin_key';
const LANG_KEY = 'aihub_lang';
const REFRESH_MS = 30000;
const REQUEST_TIMEOUT_MS = 20000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PROJECT_RE = /^[a-z0-9-]{1,40}$/;

/* ------------------------------------------------------------------ */
/* Dictionary                                                          */
/* ------------------------------------------------------------------ */

const I18N = {
  ar: {
    doc_title: 'مركز الذكاء — لوحة الإدارة',
    skip: 'تخطَّ إلى المحتوى',
    brand: 'مركز الذكاء',
    brand_sub: 'لوحة الإدارة',
    brand_home: 'مركز الذكاء — العودة إلى المحادثة',
    nav_label: 'التنقل',
    nav_chat: 'المحادثة',
    signout: 'تسجيل الخروج',
    footer: 'مركز الذكاء — نموذج مفتوح المصدر يعمل على خادمك.',

    gate_eyebrow: 'دخول المشرف',
    gate_title: 'أدخل مفتاح المشرف',
    gate_lead: 'هذه اللوحة تدير المفاتيح وتعرض حالة النموذج والاستخدام. المفتاح يُحفظ في هذه الجلسة فقط ويُمسح عند إغلاق التبويب.',
    gate_label: 'مفتاح المشرف',
    gate_submit: 'دخول',
    gate_checking: 'جارٍ التحقق…',
    gate_hint: 'يُطبع المفتاح في سجلّ الخادم عند أول تشغيل، أو يُضبط عبر المتغيّر ADMIN_KEY.',
    gate_empty: 'أدخل المفتاح أولًا.',

    status_eyebrow: 'الآن',
    status_title: 'حالة الخدمة',
    refresh: 'تحديث',
    updated_at: 'آخر تحديث {time}',
    st_model: 'النموذج',
    st_ready: 'جاهز',
    st_pulling: 'جارٍ التنزيل',
    st_down: 'غير جاهز',
    st_unknown: 'غير معروف',
    st_ctx: 'نافذة السياق {n} رمز',
    st_uptime: 'مدة التشغيل',
    st_uptime_sub: 'منذ آخر إعادة تشغيل',
    st_chunks: 'مقاطع المعرفة',
    st_chunks_built: 'بُنيت في {date}',
    st_chunks_none: 'لا يوجد فهرس معرفة بعد',
    st_projects: 'المشاريع',
    st_projects_sub: 'معرّفة في projects.json',
    st_version: 'الإصدار',
    st_rpm: 'الحد {n} طلب/دقيقة لكل مفتاح',
    u_d: 'ي', u_h: 'س', u_m: 'د',
    u_lt_min: 'أقل من دقيقة',

    usage_eyebrow: 'الاستخدام',
    usage_title: 'الطلبات والرموز',
    days_label: 'الفترة',
    days_n: '{n} يومًا',
    days_7: '7 أيام',
    saved_label: 'التوفير التقديري',
    saved_badge: 'تقدير',
    saved_note: 'تقدير وليس فاتورة حقيقية: عدد الرموز خلال آخر {days} يومًا مضروبًا في أسعار مرجعية — {in} لكل مليون رمز إدخال و{out} لكل مليون رمز إخراج. النموذج يعمل على خادمك دون رسوم لكل رمز.',
    saved_note_noref: 'تقدير وليس فاتورة حقيقية: عدد الرموز مضروبًا في أسعار مرجعية يحددها الخادم.',
    t_requests: 'الطلبات',
    t_errors: 'الأخطاء',
    t_errors_rate: '{pct} من الطلبات',
    t_in: 'رموز الإدخال',
    t_out: 'رموز الإخراج',
    t_per_day: 'بمعدل {n} يوميًا',
    chart_title: 'الطلبات يوميًا',
    chart_label: 'مخطط أعمدة لعدد الطلبات في كل يوم. استخدم السهمين للتنقل بين الأيام.',
    chart_empty: 'لا توجد طلبات في هذه الفترة',
    chart_hint: 'مرّر المؤشر على عمود، أو ركّز على المخطط واستخدم السهمين لعرض تفاصيل اليوم.',
    chart_tip: '{date}: {n} طلب',
    chart_read: '{date} — {n} طلب · {tok} رمز · {usd} تقديري',
    chart_peak: 'الذروة {n} في اليوم',
    projects_title: 'حسب المشروع',
    p_project: 'المشروع',
    p_requests: 'الطلبات',
    p_in: 'رموز الإدخال',
    p_out: 'رموز الإخراج',
    p_saved: 'التوفير التقديري',
    p_empty: 'لا يوجد استخدام مسجّل في هذه الفترة.',

    keys_eyebrow: 'الوصول',
    keys_title: 'مفاتيح المشاريع',
    create_title: 'مفتاح جديد',
    create_name: 'اسم المفتاح',
    create_name_ph: 'مثال: خادم الإنتاج',
    create_project: 'المشروع',
    create_submit: 'إنشاء المفتاح',
    create_busy: 'جارٍ الإنشاء…',
    create_name_req: 'اكتب اسمًا للمفتاح.',
    create_project_req: 'اختر مشروعًا صالحًا.',
    create_nokey: 'أُنشئ المفتاح لكن الخادم لم يُرجع قيمته. ألغِه وأنشئ مفتاحًا آخر.',
    newkey_title: 'المفتاح الجديد «{name}»',
    newkey_warn: 'انسخه الآن واحفظه في مكان آمن. لن يُعرض مرة أخرى — الخادم يحتفظ ببصمته فقط.',
    newkey_done: 'حفظته، أخفِ المفتاح',
    copy: 'نسخ',
    copied: 'تم النسخ',
    copy_failed: 'تعذّر النسخ — حدّد النص وانسخه يدويًا',
    list_title: 'المفاتيح الحالية',
    k_name: 'الاسم',
    k_project: 'المشروع',
    k_created: 'تاريخ الإنشاء',
    k_status: 'الحالة',
    k_actions: 'إجراء',
    k_active: 'فعّال',
    k_revoked: 'ملغى',
    k_revoke: 'إلغاء المفتاح',
    k_confirm_q: 'إلغاء نهائي؟',
    k_confirm_yes: 'نعم، ألغِه',
    k_confirm_no: 'تراجع',
    k_revoking: 'جارٍ الإلغاء…',
    k_empty: 'لا توجد مفاتيح بعد. أنشئ مفتاحًا لأول مشروع.',
    k_count: '{active} فعّال من {total}',
    all_projects: 'كل المشاريع',

    connect_eyebrow: 'الربط',
    connect_title: 'اربط مشروعًا',
    connect_lead: 'أي عميل متوافق مع OpenAI يعمل مباشرة: غيّر عنوان الأساس وضع مفتاح المشروع مكان مفتاح OpenAI.',
    connect_base: 'عنوان الأساس',
    connect_hint: 'استخدم مفتاح مشروع من القسم أعلاه — لا تضع مفتاح المشرف داخل تطبيقاتك.',
    snippet_env: '# متغيّرات البيئة في مشروعك',
    snippet_key: '<مفتاح-المشروع>',
    snippet_test: '# اختبار سريع',

    loading: 'جارٍ التحميل…',
    err_401: 'المفتاح غير صحيح أو أُلغي.',
    err_403: 'هذا المفتاح ليس مفتاح المشرف. لوحة الإدارة تتطلب مفتاح المشرف.',
    err_429: 'طلبات كثيرة. حاول مجددًا بعد {sec} ثانية.',
    err_429_nosec: 'طلبات كثيرة. انتظر قليلًا ثم حاول مجددًا.',
    err_network: 'تعذّر الوصول إلى الخادم. تحقق من الاتصال ومن أن الخدمة تعمل.',
    err_timeout: 'انتهت مهلة الطلب. الخادم لم يردّ في الوقت المتوقع.',
    err_400: 'الطلب غير صالح.',
    err_404: 'العنصر غير موجود.',
    err_server: 'خطأ في الخادم ({status}).',
    err_expired: 'انتهت صلاحية الجلسة أو تغيّر مفتاح المشرف. أدخل المفتاح مجددًا.',
    err_detail: 'تفاصيل الخادم: ',
  },
  en: {
    doc_title: 'AI Hub — Admin',
    skip: 'Skip to content',
    brand: 'AI Hub',
    brand_sub: 'Admin dashboard',
    brand_home: 'AI Hub — back to chat',
    nav_label: 'Navigation',
    nav_chat: 'Chat',
    signout: 'Sign out',
    footer: 'AI Hub — an open-source model running on your own server.',

    gate_eyebrow: 'Admin access',
    gate_title: 'Enter the admin key',
    gate_lead: 'This dashboard manages keys and shows model status and usage. The key is kept for this session only and cleared when the tab closes.',
    gate_label: 'Admin key',
    gate_submit: 'Sign in',
    gate_checking: 'Checking…',
    gate_hint: 'The key is printed in the server log on first start, or set through the ADMIN_KEY variable.',
    gate_empty: 'Enter the key first.',

    status_eyebrow: 'Right now',
    status_title: 'Service status',
    refresh: 'Refresh',
    updated_at: 'Updated {time}',
    st_model: 'Model',
    st_ready: 'Ready',
    st_pulling: 'Downloading',
    st_down: 'Not ready',
    st_unknown: 'Unknown',
    st_ctx: 'Context window {n} tokens',
    st_uptime: 'Uptime',
    st_uptime_sub: 'Since the last restart',
    st_chunks: 'Knowledge chunks',
    st_chunks_built: 'Built {date}',
    st_chunks_none: 'No knowledge index yet',
    st_projects: 'Projects',
    st_projects_sub: 'Defined in projects.json',
    st_version: 'Version',
    st_rpm: 'Limit {n} requests/min per key',
    u_d: 'd', u_h: 'h', u_m: 'm',
    u_lt_min: 'Under a minute',

    usage_eyebrow: 'Usage',
    usage_title: 'Requests and tokens',
    days_label: 'Period',
    days_n: '{n} days',
    days_7: '7 days',
    saved_label: 'Estimated saved',
    saved_badge: 'Estimate',
    saved_note: 'An estimate, not a real bill: tokens over the last {days} days multiplied by reference prices — {in} per 1M input tokens and {out} per 1M output tokens. The model runs on your server with no per-token charge.',
    saved_note_noref: 'An estimate, not a real bill: tokens multiplied by reference prices set on the server.',
    t_requests: 'Requests',
    t_errors: 'Errors',
    t_errors_rate: '{pct} of requests',
    t_in: 'Input tokens',
    t_out: 'Output tokens',
    t_per_day: '{n} per day on average',
    chart_title: 'Requests per day',
    chart_label: 'Bar chart of requests for each day. Use the arrow keys to move between days.',
    chart_empty: 'No requests in this period',
    chart_hint: 'Hover a bar, or focus the chart and use the arrow keys, to see a day in detail.',
    chart_tip: '{date}: {n} requests',
    chart_read: '{date} — {n} requests · {tok} tokens · {usd} estimated',
    chart_peak: 'Peak {n} in a day',
    projects_title: 'By project',
    p_project: 'Project',
    p_requests: 'Requests',
    p_in: 'Input tokens',
    p_out: 'Output tokens',
    p_saved: 'Estimated saved',
    p_empty: 'No usage recorded in this period.',

    keys_eyebrow: 'Access',
    keys_title: 'Project keys',
    create_title: 'New key',
    create_name: 'Key name',
    create_name_ph: 'e.g. production server',
    create_project: 'Project',
    create_submit: 'Create key',
    create_busy: 'Creating…',
    create_name_req: 'Give the key a name.',
    create_project_req: 'Choose a valid project.',
    create_nokey: 'The key was created but the server did not return its value. Revoke it and create another.',
    newkey_title: 'New key “{name}”',
    newkey_warn: 'Copy it now and store it somewhere safe. It will not be shown again — the server keeps only its hash.',
    newkey_done: 'Saved it, hide the key',
    copy: 'Copy',
    copied: 'Copied',
    copy_failed: 'Copy failed — select the text and copy it manually',
    list_title: 'Existing keys',
    k_name: 'Name',
    k_project: 'Project',
    k_created: 'Created',
    k_status: 'Status',
    k_actions: 'Action',
    k_active: 'Active',
    k_revoked: 'Revoked',
    k_revoke: 'Revoke',
    k_confirm_q: 'Revoke for good?',
    k_confirm_yes: 'Yes, revoke',
    k_confirm_no: 'Keep',
    k_revoking: 'Revoking…',
    k_empty: 'No keys yet. Create one for your first project.',
    k_count: '{active} active of {total}',
    all_projects: 'All projects',

    connect_eyebrow: 'Connect',
    connect_title: 'Connect a project',
    connect_lead: 'Any OpenAI-compatible client works as is: change the base URL and use a project key in place of the OpenAI key.',
    connect_base: 'Base URL',
    connect_hint: 'Use a project key from the section above — never put the admin key inside your apps.',
    snippet_env: '# Environment variables in your project',
    snippet_key: '<project-key>',
    snippet_test: '# Quick test',

    loading: 'Loading…',
    err_401: 'That key is wrong or has been revoked.',
    err_403: 'That is not the admin key. The dashboard needs the admin key.',
    err_429: 'Too many requests. Try again in {sec} seconds.',
    err_429_nosec: 'Too many requests. Wait a moment and try again.',
    err_network: 'Could not reach the server. Check your connection and that the service is running.',
    err_timeout: 'The request timed out. The server did not answer in time.',
    err_400: 'The request was not valid.',
    err_404: 'That item no longer exists.',
    err_server: 'Server error ({status}).',
    err_expired: 'The session ended or the admin key changed. Enter the key again.',
    err_detail: 'Server detail: ',
  },
};

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  lang: 'ar',
  key: '',
  status: null,
  statusAt: null,
  usage: null,
  days: 30,
  keys: null,
  projects: [],
  newKey: null,       // { key, name } — shown once, never stored
  confirmId: null,    // key id awaiting revoke confirmation
  revokingId: null,
  activeBar: -1,
  errors: { gate: null, status: null, usage: null, keys: null, create: null },
  busy: { gate: false, create: false },
};

let refreshTimer = null;
let usageSeq = 0;
let resizeTimer = null;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

function t(key, vars) {
  const table = I18N[state.lang] || I18N.ar;
  let text = table[key] ?? I18N.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** createElement helper. Never sets a `style` attribute. */
function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [name, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = String(value);
      else if (name === 'on') {
        for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
      } else node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

function svgEl(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== null && value !== undefined) node.setAttribute(name, String(value));
    }
  }
  if (text !== undefined) node.textContent = String(text);
  return node;
}

/**
 * Fills `target` from a dictionary template, wrapping every {placeholder}
 * value in an LTR-isolated <bdi class="num"> so figures stay readable in RTL.
 */
function fillTemplate(target, template, values) {
  target.replaceChildren();
  const parts = String(template).split(/\{(\w+)\}/);
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      if (part) target.append(document.createTextNode(part));
    } else {
      target.append(el('bdi', { class: 'num', text: values[part] ?? '' }));
    }
  });
  return target;
}

const toNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// Figures always use Latin digits so they line up (tabular) in both languages.
const nfInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nfCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const fmtInt = (value) => nfInt.format(Math.round(toNum(value)));
const fmtBig = (value) => (toNum(value) >= 1e6 ? nfCompact.format(toNum(value)) : fmtInt(value));

function fmtUSD(value) {
  const n = toNum(value);
  const digits = n > 0 && n < 1 ? 4 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: digits,
  }).format(n);
}

function dateLocale() {
  return state.lang === 'ar' ? 'ar-u-nu-latn-ca-gregory' : 'en-GB';
}

function fmtDate(value, options) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(dateLocale(), options || { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

// `day` is a UTC bucket (YYYY-MM-DD), so format it in UTC.
function fmtDay(day, withYear) {
  const options = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (withYear) options.year = 'numeric';
  return fmtDate(`${day}T00:00:00Z`, options);
}

function fmtUptime(seconds) {
  const sec = Math.max(0, Math.floor(toNum(seconds)));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (!d && !h && !m) return t('u_lt_min');
  const parts = [];
  if (d) parts.push(`${d} ${t('u_d')}`);
  if (h || d) parts.push(`${h} ${t('u_h')}`);
  if (!d) parts.push(`${m} ${t('u_m')}`);
  return parts.join(' ');
}

function storageGet(storage, name) {
  try { return storage.getItem(name) || ''; } catch { return ''; }
}
function storageSet(storage, name, value) {
  try { storage.setItem(name, value); } catch { /* storage unavailable: keep in memory only */ }
}
function storageRemove(storage, name) {
  try { storage.removeItem(name); } catch { /* ignore */ }
}
function sessionStore() {
  try { return window.sessionStorage; } catch { return null; }
}
function localStore() {
  try { return window.localStorage; } catch { return null; }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const area = el('textarea', { class: 'clip-helper', readonly: true, 'aria-hidden': 'true', tabindex: '-1' });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Copy with inline button feedback (no dialogs). */
async function copyWithFeedback(button, text) {
  const ok = await copyText(text);
  button.textContent = t(ok ? 'copied' : 'copy_failed');
  window.setTimeout(() => { button.textContent = t('copy'); }, 2200);
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(kind, { status = 0, retryAfter = 0, detail = '' } = {}) {
    super(kind);
    this.kind = kind;       // '401' | '403' | '429' | '400' | '404' | 'server' | 'network' | 'timeout' | 'expired' | dictionary key
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

async function api(path, { method = 'GET', body, key } = {}) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${key ?? state.key}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(err && err.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    window.clearTimeout(timer);
  }

  let data = null;
  try { data = await response.json(); } catch { data = null; }

  if (response.ok) return data;

  const detail = data && data.error && typeof data.error.message === 'string' ? data.error.message.slice(0, 200) : '';
  const info = { status: response.status, detail, retryAfter: Math.ceil(toNum(response.headers.get('Retry-After'))) };
  if (response.status === 401) throw new ApiError('401', info);
  if (response.status === 403) throw new ApiError('403', info);
  if (response.status === 429) throw new ApiError('429', info);
  if (response.status === 404) throw new ApiError('404', info);
  if (response.status >= 400 && response.status < 500) throw new ApiError('400', info);
  throw new ApiError('server', info);
}

function errorText(err) {
  if (!err) return '';
  switch (err.kind) {
    case '401': return t('err_401');
    case '403': return t('err_403');
    case '429': return err.retryAfter > 0 ? t('err_429', { sec: err.retryAfter }) : t('err_429_nosec');
    case '404': return t('err_404');
    case '400': return t('err_400');
    case 'server': return t('err_server', { status: err.status || 500 });
    case 'network': return t('err_network');
    case 'timeout': return t('err_timeout');
    case 'expired': return t('err_expired');
    default: return t(err.kind);
  }
}

function renderNotice(id, err) {
  const box = $(id);
  if (!box) return;
  box.replaceChildren();
  if (!err) { box.hidden = true; return; }
  box.append(el('span', { text: errorText(err) }));
  // Server-provided detail is shown as plain text for 400/5xx only.
  if (err.detail && (err.kind === '400' || err.kind === 'server')) {
    box.append(el('span', { text: ' ' }), el('span', { class: 'hint', text: t('err_detail') }), el('bdi', { class: 'hint', text: err.detail }));
  }
  box.hidden = false;
}

/** Any 401 after sign-in means the key is no longer valid: go back to the gate. */
function handleAuthLoss(err) {
  if (err instanceof ApiError && err.kind === '401' && state.key) {
    signOut(new ApiError('expired'));
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Language                                                            */
/* ------------------------------------------------------------------ */

function applyLang() {
  const root = document.documentElement;
  root.lang = state.lang;
  root.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('doc_title');

  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));

  const toggle = $('lang-toggle');
  toggle.textContent = state.lang === 'ar' ? 'English' : 'العربية';
  toggle.lang = state.lang === 'ar' ? 'en' : 'ar';

  for (const button of document.querySelectorAll('#days-seg .seg-btn')) {
    const n = Number(button.dataset.days);
    button.textContent = n === 7 ? t('days_7') : t('days_n', { n });
  }
  renderAll();
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderAll() {
  renderGate();
  renderStatus();
  renderUsage();
  renderProjectOptions();
  renderNewKey();
  renderKeys();
  renderConnect();
  renderNotice('create-error', state.errors.create);
  $('key-submit').textContent = t(state.busy.create ? 'create_busy' : 'create_submit');
}

function renderGate() {
  renderNotice('gate-error', state.errors.gate);
  const submit = $('gate-submit');
  submit.disabled = state.busy.gate;
  submit.textContent = t(state.busy.gate ? 'gate_checking' : 'gate_submit');
}

function showGate() {
  $('dash').hidden = true;
  $('gate').hidden = false;
  $('signout').hidden = true;
  renderGate();
}

function showDash() {
  $('gate').hidden = true;
  $('dash').hidden = false;
  $('signout').hidden = false;
}

function statCard({ label, value, sub, extraClass, valueClass, valueNode, valueTitle }) {
  const valueEl = valueNode || el('p', { class: `stat-value num${valueClass ? ` ${valueClass}` : ''}`, text: value, title: valueTitle });
  return el('div', { class: `card stat${extraClass ? ` ${extraClass}` : ''}` },
    el('p', { class: 'stat-label', text: label }),
    valueEl,
    sub ? (typeof sub === 'string' ? el('p', { class: 'stat-sub', text: sub }) : sub) : null);
}

function renderStatus() {
  renderNotice('status-error', state.errors.status);
  const host = $('status-cards');
  const s = state.status;

  $('status-updated').textContent = state.statusAt
    ? t('updated_at', { time: fmtDate(state.statusAt, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) })
    : '';

  if (!s) {
    host.replaceChildren(el('div', { class: 'card stat' }, el('p', { class: 'stat-sub', text: state.errors.status ? '—' : t('loading') })));
    return;
  }

  const llm = s.llm && typeof s.llm === 'object' ? s.llm : {};
  const config = s.config && typeof s.config === 'object' ? s.config : {};
  const knowledge = s.knowledge && typeof s.knowledge === 'object' ? s.knowledge : {};
  const modelName = String(llm.defaultModel || config.model || '—');

  let pillClass = 'is-down';
  let pillText = t('st_down');
  if (llm.defaultModelReady === true) { pillClass = 'is-ready'; pillText = t('st_ready'); }
  else if (llm.pulling === true) { pillClass = 'is-pulling'; pillText = t('st_pulling'); }
  else if (s.llm === undefined || s.llm === null) { pillClass = 'is-muted'; pillText = t('st_unknown'); }

  const modelSub = el('p', { class: 'stat-sub' });
  if (pillClass === 'is-down' && typeof llm.error === 'string' && llm.error) {
    modelSub.append(el('bdi', { text: llm.error.slice(0, 160) }));
  } else if (config.numCtx !== undefined) {
    fillTemplate(modelSub, t('st_ctx'), { n: fmtInt(config.numCtx) });
  }

  const modelValue = el('div', { class: 'stat-row' },
    el('p', { class: 'stat-value is-text mono num', text: modelName }),
    el('span', { class: `pill ${pillClass}`, text: pillText }));

  const chunkCount = toNum(knowledge.chunks);
  const builtAt = knowledge.builtAt ? fmtDate(knowledge.builtAt) : '';
  const chunksSub = el('p', { class: 'stat-sub' });
  if (builtAt && builtAt !== '—') fillTemplate(chunksSub, t('st_chunks_built'), { date: builtAt });
  else chunksSub.textContent = chunkCount ? '' : t('st_chunks_none');

  const projectsCount = typeof s.projects === 'number' ? s.projects
    : Array.isArray(s.projects) ? s.projects.length : toNum(s.projects);

  const versionSub = el('p', { class: 'stat-sub' });
  if (config.rateLimitRpm !== undefined) fillTemplate(versionSub, t('st_rpm'), { n: fmtInt(config.rateLimitRpm) });

  host.replaceChildren(
    statCard({ label: t('st_model'), valueNode: modelValue, sub: modelSub, extraClass: 'stat-model' }),
    statCard({ label: t('st_uptime'), value: fmtUptime(s.uptimeSec), sub: t('st_uptime_sub'), valueClass: 'is-text' }),
    statCard({ label: t('st_chunks'), value: fmtInt(chunkCount), sub: chunksSub }),
    statCard({ label: t('st_projects'), value: fmtInt(projectsCount), sub: t('st_projects_sub') }),
    statCard({ label: t('st_version'), value: s.version ? `v${String(s.version).replace(/^v/i, '')}` : '—', sub: versionSub, valueClass: 'is-text mono' }),
  );
}

function renderUsage() {
  renderNotice('usage-error', state.errors.usage);
  for (const button of document.querySelectorAll('#days-seg .seg-btn')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.days) === state.days));
  }

  const u = state.usage;
  const totals = u && u.totals && typeof u.totals === 'object' ? u.totals : null;
  const reference = u && u.reference && typeof u.reference === 'object' ? u.reference : null;
  const days = u ? toNum(u.days) || state.days : state.days;

  // Headline estimate.
  $('saved-value').textContent = totals ? fmtUSD(totals.savedUSD) : '—';
  const note = $('saved-note');
  if (reference && reference.inPerM !== undefined && reference.outPerM !== undefined) {
    fillTemplate(note, t('saved_note'), { days: fmtInt(days), in: fmtUSD(reference.inPerM), out: fmtUSD(reference.outPerM) });
  } else {
    note.textContent = t('saved_note_noref');
  }

  // Totals.
  const totalsHost = $('totals');
  if (!totals) {
    const placeholder = (label) => statCard({ label, value: '—' });
    totalsHost.replaceChildren(placeholder(t('t_requests')), placeholder(t('t_errors')), placeholder(t('t_in')), placeholder(t('t_out')));
  } else {
    const requests = toNum(totals.requests);
    const errors = toNum(totals.errors);
    const perDay = el('p', { class: 'stat-sub' });
    fillTemplate(perDay, t('t_per_day'), { n: nfCompact.format(Math.round((requests / Math.max(1, days)) * 10) / 10) });
    const errorRate = el('p', { class: 'stat-sub' });
    if (requests > 0) fillTemplate(errorRate, t('t_errors_rate'), { pct: `${(Math.round((errors / requests) * 1000) / 10).toFixed(1)}%` });
    totalsHost.replaceChildren(
      statCard({ label: t('t_requests'), value: fmtBig(requests), valueTitle: fmtInt(requests), sub: perDay }),
      statCard({ label: t('t_errors'), value: fmtBig(errors), valueTitle: fmtInt(errors), sub: errorRate, valueClass: errors > 0 ? 'is-bad' : '' }),
      statCard({ label: t('t_in'), value: fmtBig(totals.promptTokens), valueTitle: fmtInt(totals.promptTokens) }),
      statCard({ label: t('t_out'), value: fmtBig(totals.completionTokens), valueTitle: fmtInt(totals.completionTokens) }),
    );
  }

  renderChart();
  renderProjectsTable();
}

/** Picks an integer axis top/step so gridlines land on whole request counts. */
function niceScale(max) {
  if (!(max > 0)) return { top: 4, step: 1 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const mult = [1, 2, 5, 10].find((m) => m * pow >= raw) || 10;
  const step = Math.max(1, mult * pow);
  return { top: step * Math.ceil(max / step), step };
}

function chartDays() {
  const list = state.usage && Array.isArray(state.usage.byDay) ? state.usage.byDay : [];
  return list.filter((d) => d && typeof d.day === 'string');
}

function renderChart() {
  const host = $('chart');
  const days = chartDays();
  const range = $('chart-range');
  state.activeBar = -1;

  if (!state.usage) {
    host.replaceChildren(el('p', { class: 'empty', text: state.errors.usage ? '—' : t('loading') }));
    range.textContent = '';
    setReadout(-1);
    return;
  }

  const rtl = document.documentElement.dir === 'rtl';
  const W = Math.max(260, Math.floor(host.clientWidth || 640));
  const H = W < 480 ? 200 : 260;
  const mTop = 14;
  const mBottom = 30;
  const mAxis = 44;   // side that carries the y-axis labels (inline-start)
  const mFar = 10;
  const left = rtl ? mFar : mAxis;
  const right = rtl ? W - mAxis : W - mFar;
  const plotW = right - left;
  const plotH = H - mTop - mBottom;
  const baseY = mTop + plotH;

  const values = days.map((d) => toNum(d.requests));
  const max = values.length ? Math.max(...values) : 0;
  const { top, step } = niceScale(max);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: '0',
    'aria-label': t('chart_label'), 'aria-describedby': 'chart-readout', focusable: 'true',
  });

  // Gridlines + y-axis labels (axis sits on the inline-start side).
  for (let v = 0; v <= top; v += step) {
    const y = Math.round(baseY - (v / top) * plotH) + 0.5;
    svg.append(svgEl('line', { class: v === 0 ? 'chart-base' : 'chart-grid', x1: left, x2: right, y1: y, y2: y }));
    svg.append(svgEl('text', {
      class: 'chart-y', x: rtl ? right + 8 : left - 8, y: y + 4, 'text-anchor': rtl ? 'start' : 'end',
    }, v >= 10000 ? nfCompact.format(v) : fmtInt(v)));
  }

  // Bars: oldest day at the inline-start edge (right in RTL, left in LTR).
  const n = days.length;
  const slot = n ? plotW / n : plotW;
  const barW = Math.min(28, Math.max(1.5, slot * 0.66));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 68))));

  days.forEach((d, i) => {
    const x0 = rtl ? right - (i + 1) * slot : left + i * slot;
    const value = values[i];
    const col = svgEl('g', { class: 'chart-col', 'data-index': i });
    col.append(svgEl('title', null, t('chart_tip', { date: fmtDay(d.day, true), n: fmtInt(value) })));
    col.append(svgEl('rect', { class: 'chart-hit', x: x0, y: mTop, width: slot, height: plotH }));
    if (value > 0) {
      const h = Math.max(2, (value / top) * plotH);
      col.append(svgEl('rect', {
        class: 'chart-bar', x: x0 + (slot - barW) / 2, y: baseY - h, width: barW, height: h, rx: Math.min(3, barW / 2),
      }));
    }
    col.addEventListener('mouseenter', () => setActiveBar(i));
    col.addEventListener('click', () => setActiveBar(i));
    svg.append(col);

    if (i % labelEvery === 0) {
      svg.append(svgEl('text', { class: 'chart-x', x: x0 + slot / 2, y: H - 9, 'text-anchor': 'middle' }, fmtDay(d.day, false)));
    }
  });

  if (max === 0) {
    svg.append(svgEl('text', { class: 'chart-empty', x: left + plotW / 2, y: mTop + plotH / 2, 'text-anchor': 'middle' }, t('chart_empty')));
  }

  svg.addEventListener('mouseleave', () => { if (document.activeElement !== svg) setActiveBar(-1); });
  svg.addEventListener('focus', () => { if (state.activeBar < 0 && n) setActiveBar(n - 1); });
  svg.addEventListener('blur', () => setActiveBar(-1));
  svg.addEventListener('keydown', (event) => {
    if (!n) return;
    const current = state.activeBar < 0 ? n - 1 : state.activeBar;
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';   // towards newer days
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next = current;
    if (event.key === forward) next = Math.min(n - 1, current + 1);
    else if (event.key === back) next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else return;
    event.preventDefault();
    setActiveBar(next);
  });

  host.replaceChildren(svg);
  fillTemplate(range, t('chart_peak'), { n: fmtInt(max) });
  setReadout(-1);
}

function setActiveBar(index) {
  state.activeBar = index;
  for (const col of document.querySelectorAll('#chart .chart-col')) {
    col.classList.toggle('is-active', Number(col.getAttribute('data-index')) === index);
  }
  setReadout(index);
}

function setReadout(index) {
  const out = $('chart-readout');
  const d = index >= 0 ? chartDays()[index] : null;
  if (!d) {
    out.textContent = state.usage ? t('chart_hint') : '';
    return;
  }
  fillTemplate(out, t('chart_read'), {
    date: fmtDay(d.day, true),
    n: fmtInt(d.requests),
    tok: fmtInt(toNum(d.promptTokens) + toNum(d.completionTokens)),
    usd: fmtUSD(d.savedUSD),
  });
}

function buildTable(columns, rows) {
  const head = el('tr');
  for (const column of columns) {
    head.append(el('th', { scope: 'col', class: column.num ? 'is-num' : column.actions ? 'is-actions' : null, text: column.label }));
  }
  const body = el('tbody');
  for (const row of rows) body.append(row);
  return el('table', { class: 'table' }, el('thead', null, head), body);
}

function renderProjectsTable() {
  const host = $('projects-table');
  if (!state.usage) {
    host.replaceChildren(el('p', { class: 'empty', text: state.errors.usage ? '—' : t('loading') }));
    return;
  }
  const list = (Array.isArray(state.usage.byProject) ? state.usage.byProject : [])
    .filter((p) => p && typeof p === 'object')
    .slice()
    .sort((a, b) => toNum(b.requests) - toNum(a.requests));
  if (!list.length) {
    host.replaceChildren(el('p', { class: 'empty', text: t('p_empty') }));
    return;
  }
  const columns = [
    { label: t('p_project') },
    { label: t('p_requests'), num: true },
    { label: t('p_in'), num: true },
    { label: t('p_out'), num: true },
    { label: t('p_saved'), num: true },
  ];
  const rows = list.map((p) => el('tr', null,
    el('td', { 'data-label': columns[0].label }, el('span', { class: 'tag', text: String(p.project ?? '—') })),
    el('td', { class: 'is-num num', 'data-label': columns[1].label, text: fmtInt(p.requests) }),
    el('td', { class: 'is-num num', 'data-label': columns[2].label, text: fmtInt(p.promptTokens) }),
    el('td', { class: 'is-num num', 'data-label': columns[3].label, text: fmtInt(p.completionTokens) }),
    el('td', { class: 'is-num num', 'data-label': columns[4].label, text: fmtUSD(p.savedUSD) })));
  host.replaceChildren(buildTable(columns, rows));
}

function renderProjectOptions() {
  const select = $('key-project');
  const previous = select.value;
  const list = state.projects.length ? state.projects : [{ id: 'general', name: 'General', nameAr: 'عام' }];
  select.replaceChildren();
  for (const project of list) {
    const label = state.lang === 'ar' ? (project.nameAr || project.name || project.id) : (project.name || project.id);
    const text = label && label !== project.id ? `${label} (${project.id})` : project.id;
    select.append(el('option', { value: project.id, text }));
  }
  if (previous && list.some((p) => p.id === previous)) select.value = previous;
}

function renderNewKey() {
  const box = $('new-key');
  box.replaceChildren();
  if (!state.newKey) { box.hidden = true; return; }

  const copyButton = el('button', { type: 'button', class: 'btn btn-primary btn-small', text: t('copy') });
  copyButton.addEventListener('click', () => { if (state.newKey) copyWithFeedback(copyButton, state.newKey.key); });
  const doneButton = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: t('newkey_done') });
  doneButton.addEventListener('click', () => { state.newKey = null; renderNewKey(); $('key-name').focus(); });

  box.append(
    el('p', { class: 'keybox-title', text: t('newkey_title', { name: state.newKey.name }) }),
    el('code', { class: 'keybox-key', tabindex: '0', text: state.newKey.key }),
    el('p', { class: 'keybox-warn', text: t('newkey_warn') }),
    el('div', { class: 'keybox-actions' }, copyButton, doneButton),
  );
  box.hidden = false;
}

function renderKeys() {
  renderNotice('keys-error', state.errors.keys);
  const host = $('keys-table');
  const count = $('keys-count');

  if (!state.keys) {
    host.replaceChildren(el('p', { class: 'empty', text: state.errors.keys ? '—' : t('loading') }));
    count.textContent = '';
    return;
  }
  const list = state.keys.slice().sort((a, b) => {
    if (Boolean(a.revoked) !== Boolean(b.revoked)) return a.revoked ? 1 : -1;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  const active = list.filter((k) => !k.revoked).length;
  count.textContent = list.length ? t('k_count', { active: fmtInt(active), total: fmtInt(list.length) }) : '';

  if (!list.length) {
    host.replaceChildren(el('p', { class: 'empty', text: t('k_empty') }));
    return;
  }

  const columns = [
    { label: t('k_name') }, { label: t('k_project') }, { label: t('k_created') },
    { label: t('k_status') }, { label: t('k_actions'), actions: true },
  ];
  const rows = list.map((k) => {
    const id = String(k.id ?? '');
    const project = k.project === '*' ? t('all_projects') : String(k.project ?? '—');
    const actions = el('td', { class: 'is-actions', 'data-label': columns[4].label });

    if (!k.revoked && id) {
      if (state.revokingId === id) {
        actions.append(el('span', { class: 'confirm-text', text: t('k_revoking') }));
      } else if (state.confirmId === id) {
        const yes = el('button', { type: 'button', class: 'btn btn-danger btn-small', 'data-confirm': id, text: t('k_confirm_yes') });
        yes.addEventListener('click', () => revokeKey(id));
        const no = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: t('k_confirm_no') });
        no.addEventListener('click', () => { state.confirmId = null; renderKeys(); focusRevoke(id); });
        actions.append(el('span', { class: 'confirm', role: 'group', 'aria-label': t('k_confirm_q') },
          el('span', { class: 'confirm-text', text: t('k_confirm_q') }), yes, no));
      } else {
        const revoke = el('button', {
          type: 'button', class: 'btn btn-danger btn-small', 'data-revoke': id,
          'aria-label': `${t('k_revoke')}: ${String(k.name ?? id)}`, text: t('k_revoke'),
        });
        revoke.addEventListener('click', () => {
          state.confirmId = id;
          renderKeys();
          const target = document.querySelector(`#keys-table [data-confirm="${cssEscape(id)}"]`);
          if (target) target.focus();
        });
        actions.append(revoke);
      }
    }

    return el('tr', { class: k.revoked ? 'row-revoked' : null },
      el('td', { 'data-label': columns[0].label }, el('bdi', { class: 'cell-strong', text: String(k.name ?? '—') })),
      el('td', { 'data-label': columns[1].label }, el('span', { class: 'tag', text: project })),
      el('td', { class: 'num', 'data-label': columns[2].label, text: k.createdAt ? fmtDate(k.createdAt) : '—' }),
      el('td', { 'data-label': columns[3].label },
        el('span', { class: k.revoked ? 'state-revoked' : 'state-active', text: t(k.revoked ? 'k_revoked' : 'k_active') })),
      actions);
  });
  host.replaceChildren(buildTable(columns, rows));
}

function cssEscape(value) {
  return window.CSS && typeof window.CSS.escape === 'function' ? window.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

function focusRevoke(id) {
  const target = document.querySelector(`#keys-table [data-revoke="${cssEscape(id)}"]`);
  if (target) target.focus();
}

function renderConnect() {
  const base = `${window.location.origin}/v1`;
  const model = (state.status && ((state.status.llm && state.status.llm.defaultModel) || (state.status.config && state.status.config.model))) || 'gemma3:4b';
  $('base-url').textContent = base;
  $('snippet').textContent = [
    t('snippet_env'),
    `OPENAI_BASE_URL=${base}`,
    `OPENAI_API_KEY=${t('snippet_key')}`,
    '',
    t('snippet_test'),
    `curl ${base}/chat/completions \\`,
    '  -H "Authorization: Bearer $OPENAI_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"model":"${String(model).replace(/["'\\]/g, '')}","messages":[{"role":"user","content":"ping"}]}'`,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

async function loadStatus() {
  try {
    state.status = await api('/api/admin/status');
    state.statusAt = new Date();
    state.errors.status = null;
  } catch (err) {
    if (handleAuthLoss(err)) return;
    state.errors.status = err;
  }
  renderStatus();
  renderConnect();
}

async function loadUsage() {
  const seq = ++usageSeq;
  const days = state.days;
  try {
    const data = await api(`/api/admin/usage?days=${encodeURIComponent(days)}`);
    if (seq !== usageSeq) return; // a newer period was requested meanwhile
    state.usage = data && typeof data === 'object' ? data : null;
    state.errors.usage = null;
  } catch (err) {
    if (seq !== usageSeq) return;
    if (handleAuthLoss(err)) return;
    state.errors.usage = err;
  }
  renderUsage();
}

function normaliseList(data, field) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[field])) return data[field];
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

async function loadKeys() {
  try {
    const data = await api('/api/admin/keys');
    state.keys = normaliseList(data, 'keys').filter((k) => k && typeof k === 'object');
    state.errors.keys = null;
  } catch (err) {
    if (handleAuthLoss(err)) return;
    state.errors.keys = err;
  }
  renderKeys();
}

async function loadProjects() {
  try {
    const data = await api('/api/projects');
    state.projects = normaliseList(data, 'projects')
      .filter((p) => p && typeof p.id === 'string' && PROJECT_RE.test(p.id))
      .map((p) => ({ id: p.id, name: typeof p.name === 'string' ? p.name : '', nameAr: typeof p.nameAr === 'string' ? p.nameAr : '' }));
  } catch (err) {
    if (handleAuthLoss(err)) return;
    state.projects = []; // falls back to "general" only
  }
  renderProjectOptions();
}

function loadAll() {
  return Promise.all([loadStatus(), loadUsage(), loadKeys(), loadProjects()]);
}

function startRefresh() {
  stopRefresh();
  refreshTimer = window.setInterval(() => {
    if (state.key && !document.hidden) loadStatus();
  }, REFRESH_MS);
}

function stopRefresh() {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function signIn(key, { fromStorage = false } = {}) {
  state.busy.gate = true;
  state.errors.gate = null;
  renderGate();
  try {
    const status = await api('/api/admin/status', { key });
    state.key = key;
    const store = sessionStore();
    if (store) storageSet(store, STORAGE_KEY, key);
    state.status = status;
    state.statusAt = new Date();
    state.errors.status = null;
    state.busy.gate = false;
    $('gate-key').value = '';
    showDash();
    renderAll();
    startRefresh();
    loadUsage();
    loadKeys();
    loadProjects();
  } catch (err) {
    state.busy.gate = false;
    // A stored key that is rejected is dropped; transient failures keep it for a retry.
    if (fromStorage && (err.kind === '401' || err.kind === '403')) {
      const store = sessionStore();
      if (store) storageRemove(store, STORAGE_KEY);
    }
    state.errors.gate = err instanceof ApiError ? err : new ApiError('network');
    showGate();
    if (!fromStorage) $('gate-key').focus();
  }
}

function signOut(error) {
  stopRefresh();
  usageSeq += 1;
  const store = sessionStore();
  if (store) storageRemove(store, STORAGE_KEY);
  Object.assign(state, {
    key: '', status: null, statusAt: null, usage: null, keys: null, projects: [],
    newKey: null, confirmId: null, revokingId: null, activeBar: -1,
  });
  state.errors = { gate: error || null, status: null, usage: null, keys: null, create: null };
  state.busy = { gate: false, create: false };
  $('key-form').reset();
  renderAll();
  showGate();
  $('gate-key').focus();
}

async function createKey(event) {
  event.preventDefault();
  if (state.busy.create) return;
  const nameInput = $('key-name');
  const name = nameInput.value.trim();
  const project = $('key-project').value;

  if (!name) {
    state.errors.create = new ApiError('create_name_req');
    renderNotice('create-error', state.errors.create);
    nameInput.focus();
    return;
  }
  if (!PROJECT_RE.test(project)) {
    state.errors.create = new ApiError('create_project_req');
    renderNotice('create-error', state.errors.create);
    return;
  }

  const submit = $('key-submit');
  state.busy.create = true;
  state.errors.create = null;
  renderNotice('create-error', null);
  submit.disabled = true;
  submit.textContent = t('create_busy');

  try {
    const data = await api('/api/admin/keys', { method: 'POST', body: { name, project } });
    const plain = data && typeof data.key === 'string' ? data.key
      : data && data.key && typeof data.key.key === 'string' ? data.key.key : '';
    if (plain) {
      state.newKey = { key: plain, name };
      nameInput.value = '';
    } else {
      state.errors.create = new ApiError('create_nokey');
    }
    renderNewKey();
    if (plain) {
      const shown = document.querySelector('#new-key .keybox-key');
      if (shown) shown.focus();
    }
    loadKeys();
  } catch (err) {
    if (handleAuthLoss(err)) return;
    state.errors.create = err;
  } finally {
    state.busy.create = false;
    submit.disabled = false;
    submit.textContent = t('create_submit');
    renderNotice('create-error', state.errors.create);
  }
}

async function revokeKey(id) {
  if (state.revokingId) return;
  state.revokingId = id;
  state.confirmId = null;
  renderKeys();
  try {
    await api(`/api/admin/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.errors.keys = null;
  } catch (err) {
    if (handleAuthLoss(err)) return;
    state.errors.keys = err;
  }
  state.revokingId = null;
  const failed = state.errors.keys;
  await loadKeys();
  if (failed && state.key) {
    state.errors.keys = failed; // keep the revoke failure visible after the reload
    renderKeys();
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function init() {
  const local = localStore();
  const savedLang = local ? storageGet(local, LANG_KEY) : '';
  state.lang = savedLang === 'en' ? 'en' : 'ar';

  $('lang-toggle').addEventListener('click', () => {
    state.lang = state.lang === 'ar' ? 'en' : 'ar';
    const store = localStore();
    if (store) storageSet(store, LANG_KEY, state.lang);
    applyLang();
  });

  $('gate-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.busy.gate) return;
    const key = $('gate-key').value.trim();
    if (!key) {
      state.errors.gate = new ApiError('gate_empty');
      renderGate();
      $('gate-key').focus();
      return;
    }
    signIn(key);
  });

  $('signout').addEventListener('click', () => signOut(null));
  $('refresh').addEventListener('click', () => { if (state.key) loadAll(); });

  for (const button of document.querySelectorAll('#days-seg .seg-btn')) {
    button.addEventListener('click', () => {
      const days = Number(button.dataset.days);
      if (!days || days === state.days) return;
      state.days = days;
      renderUsage();
      loadUsage();
    });
  }

  $('key-form').addEventListener('submit', createKey);
  $('copy-base').addEventListener('click', () => copyWithFeedback($('copy-base'), `${window.location.origin}/v1`));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.key) loadStatus();
  });

  // The chart is drawn at the container's pixel width, so redraw when it changes.
  const redraw = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { if (state.key && state.usage) renderChart(); }, 150);
  };
  if (typeof ResizeObserver === 'function') {
    let lastWidth = 0;
    new ResizeObserver((entries) => {
      const width = Math.floor(entries[0].contentRect.width);
      if (width !== lastWidth) { lastWidth = width; redraw(); }
    }).observe($('chart'));
  } else {
    window.addEventListener('resize', redraw);
  }

  applyLang();
  showGate();

  const session = sessionStore();
  const savedKey = session ? storageGet(session, STORAGE_KEY) : '';
  if (savedKey) signIn(savedKey, { fromStorage: true });
  else $('gate-key').focus();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
