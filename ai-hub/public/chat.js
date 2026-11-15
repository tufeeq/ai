// AI Hub — chat page logic (ES module, no dependencies).
// Strict CSP: no inline script/style, and model output is rendered with textContent only.

/* ───────────────────────── Strings ───────────────────────── */

const I18N = {
  ar: {
    product: 'مركز الذكاء',
    tagline: 'مساعدك الخاص، يعمل على خادمك.',
    keyLabel: 'مفتاح الوصول',
    keyPlaceholder: 'hub_…',
    keyHelp: 'يُحفظ المفتاح في هذه الجلسة فقط ويُمسح عند إغلاق التبويب.',
    enter: 'دخول',
    checking: 'جارٍ التحقق…',
    langSwitch: 'Switch to English',
    langLabel: 'English',
    admin: 'لوحة الإدارة',
    signOut: 'خروج',
    projects: 'المشاريع',
    newChat: 'محادثة جديدة',
    conversation: 'المحادثة',
    inputLabel: 'رسالتك',
    inputPlaceholder: 'اكتب رسالتك…',
    send: 'إرسال',
    stop: 'إيقاف',
    hint: 'Enter للإرسال · Shift+Enter لسطر جديد',
    emptyTitle: 'بماذا أساعدك؟',
    emptySubGeneral: 'اسأل عن أي شيء، أو ابدأ بأحد الاقتراحات.',
    emptySubProject: 'الأسئلة هنا تُجاب من معرفة مشروع «{name}».',
    sources: 'المصادر',
    copy: 'نسخ',
    copied: 'تم النسخ',
    code: 'كود',
    metaTokens: '{n} رمز',
    metaSeconds: '{s} ث',
    stopped: 'أُوقف الرد.',
    roleAdmin: 'مدير',
    roleProject: 'مفتاح مشروع',
    signedInAs: 'دخلت باسم {name} · {role}',
    generalName: 'عام',
    statusChecking: 'جارٍ الفحص…',
    statusReady: 'جاهز',
    statusPulling: 'جارٍ تنزيل النموذج…',
    statusNotReady: 'النموذج غير جاهز',
    statusUnreachable: 'تعذّر الاتصال',
    liveThinking: 'المساعد يكتب…',
    liveDone: 'اكتمل الرد.',
    errKeyEmpty: 'أدخل مفتاح الوصول.',
    err401: 'المفتاح غير صحيح أو مُلغى.',
    errExpired: 'انتهت صلاحية المفتاح أو أُلغي. أدخله من جديد.',
    err403: 'هذا المفتاح لا يملك صلاحية لهذا المشروع.',
    err429: 'طلبات كثيرة. حاول بعد {s} ثانية.',
    err429Plain: 'طلبات كثيرة. حاول بعد قليل.',
    errNetwork: 'تعذّر الوصول إلى الخادم. تحقق من الاتصال ثم أعد المحاولة.',
    errServer: 'حدث خطأ في الخادم ({status}).',
    errEmpty: 'لم يصل رد من النموذج. أعد المحاولة.',
    errInterrupted: 'انقطع الاتصال قبل اكتمال الرد.',
    errProjects: 'تعذّر تحميل المشاريع.',
    errGeneric: 'حدث خطأ غير متوقع.',
    suggestGeneral: [
      'اشرح لي فكرة معقدة بلغة بسيطة',
      'لخّص نصاً سألصقه لك في نقاط واضحة',
      'اكتب مسودة رسالة بريد مهنية وقصيرة',
      'ساعدني في ترتيب مهام هذا الأسبوع',
    ],
    suggestProject: [
      'ما هو {name} باختصار؟',
      'ما الذي تعرفه عن طريقة عمل {name}؟',
      'من أين أبدأ إذا أردت العمل على {name}؟',
      'اقترح أسئلة مفيدة أطرحها عن {name}',
    ],
  },
  en: {
    product: 'AI Hub',
    tagline: 'Your private assistant, running on your own server.',
    keyLabel: 'Access key',
    keyPlaceholder: 'hub_…',
    keyHelp: 'The key is kept for this session only and cleared when the tab closes.',
    enter: 'Enter',
    checking: 'Checking…',
    langSwitch: 'التبديل إلى العربية',
    langLabel: 'العربية',
    admin: 'Admin',
    signOut: 'Sign out',
    projects: 'Projects',
    newChat: 'New chat',
    conversation: 'Conversation',
    inputLabel: 'Your message',
    inputPlaceholder: 'Write a message…',
    send: 'Send',
    stop: 'Stop',
    hint: 'Enter to send · Shift+Enter for a new line',
    emptyTitle: 'What can I help with?',
    emptySubGeneral: 'Ask anything, or start from a suggestion.',
    emptySubProject: 'Answers here draw on the “{name}” project knowledge.',
    sources: 'Sources',
    copy: 'Copy',
    copied: 'Copied',
    code: 'code',
    metaTokens: '{n} tokens',
    metaSeconds: '{s} s',
    stopped: 'Response stopped.',
    roleAdmin: 'admin',
    roleProject: 'project key',
    signedInAs: 'Signed in as {name} · {role}',
    generalName: 'General',
    statusChecking: 'Checking…',
    statusReady: 'Ready',
    statusPulling: 'Downloading model…',
    statusNotReady: 'Model not ready',
    statusUnreachable: 'Unreachable',
    liveThinking: 'Assistant is writing…',
    liveDone: 'Response complete.',
    errKeyEmpty: 'Enter your access key.',
    err401: 'That key is invalid or has been revoked.',
    errExpired: 'Your key expired or was revoked. Enter it again.',
    err403: 'This key is not allowed to use that project.',
    err429: 'Too many requests. Try again in {s} seconds.',
    err429Plain: 'Too many requests. Try again shortly.',
    errNetwork: 'Could not reach the server. Check the connection and try again.',
    errServer: 'The server returned an error ({status}).',
    errEmpty: 'The model returned no answer. Try again.',
    errInterrupted: 'The connection dropped before the answer finished.',
    errProjects: 'Could not load projects.',
    errGeneric: 'Something went wrong.',
    suggestGeneral: [
      'Explain a complex idea in plain language',
      'Summarise a text I will paste into clear points',
      'Draft a short, professional email',
      'Help me organise this week’s tasks',
    ],
    suggestProject: [
      'What is {name}, in brief?',
      'What do you know about how {name} works?',
      'Where should I start if I want to work on {name}?',
      'Suggest useful questions to ask about {name}',
    ],
  },
};

/* ───────────────────────── State ───────────────────────── */

const KEY_STORE = 'aihub.key';
const LANG_STORE = 'aihub.lang';
const HEALTH_INTERVAL_MS = 20000;
const MAX_HISTORY = 24;

const state = {
  lang: 'ar',
  key: '',
  me: null,
  projects: [],
  projectId: 'general',
  conversations: new Map(), // projectId -> message[] (memory only)
  streaming: null, // { controller, msg, projectId }
  health: { kind: 'checking', model: '' },
  gateError: null, // { key, vars } so it re-translates on language switch
  healthTimer: 0,
};

const nodes = new WeakMap(); // message object -> { el, body, foot }

const $ = (id) => document.getElementById(id);
const dom = {
  gate: $('gate'),
  gateForm: $('gateForm'),
  keyInput: $('keyInput'),
  gateError: $('gateError'),
  gateSubmit: $('gateSubmit'),
  app: $('app'),
  status: $('status'),
  statusText: $('statusText'),
  adminLink: $('adminLink'),
  signOut: $('signOut'),
  projectList: $('projectList'),
  whoami: $('whoami'),
  projectTitle: $('projectTitle'),
  projectDesc: $('projectDesc'),
  newChat: $('newChat'),
  scroller: $('scroller'),
  empty: $('empty'),
  emptySub: $('emptySub'),
  suggestions: $('suggestions'),
  messages: $('messages'),
  composer: $('composer'),
  input: $('input'),
  sendBtn: $('sendBtn'),
  stopBtn: $('stopBtn'),
  live: $('live'),
};

/* ───────────────────────── Helpers ───────────────────────── */

function t(key, vars) {
  const dict = I18N[state.lang] || I18N.ar;
  let str = dict[key];
  if (typeof str !== 'string') str = typeof I18N.en[key] === 'string' ? I18N.en[key] : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) str = str.split(`{${name}}`).join(String(value));
  }
  return str;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function storageGet(store, key) {
  try {
    return store.getItem(key) || '';
  } catch {
    return '';
  }
}

function storageSet(store, key, value) {
  try {
    if (value) store.setItem(key, value);
    else store.removeItem(key);
  } catch {
    /* storage unavailable (private mode / blocked): keep working in memory */
  }
}

function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function localStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function saveKey(value) {
  const store = sessionStore();
  if (store) storageSet(store, KEY_STORE, value);
}

function loadKey() {
  const store = sessionStore();
  return store ? storageGet(store, KEY_STORE) : '';
}

function formatNumber(n) {
  try {
    return new Intl.NumberFormat('en-US').format(n);
  } catch {
    return String(n);
  }
}

class ApiError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code || '';
    this.retryAfter = retryAfter || 0;
  }
}

async function toApiError(res) {
  let code = '';
  let message = '';
  try {
    const body = await res.json();
    const err = body && body.error;
    if (err && typeof err === 'object') {
      code = typeof err.code === 'string' ? err.code : '';
      message = typeof err.message === 'string' ? err.message : '';
    } else if (typeof err === 'string') {
      message = err;
    }
  } catch {
    /* non-JSON error body */
  }
  const retryAfter = Math.max(0, Math.ceil(Number(res.headers.get('Retry-After')) || 0));
  return new ApiError(res.status, code, message, retryAfter);
}

async function api(path, { key = state.key, signal } = {}) {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

/** Maps any failure to a translatable descriptor { key, vars } or { text }. */
function describeError(err) {
  if (err instanceof ApiError) {
    if (err.status === 401) return { key: 'err401' };
    if (err.status === 403) return { key: 'err403' };
    if (err.status === 429) {
      return err.retryAfter > 0 ? { key: 'err429', vars: { s: err.retryAfter } } : { key: 'err429Plain' };
    }
    return { key: 'errServer', vars: { status: err.status } };
  }
  return { key: 'errNetwork' };
}

function errorText(desc) {
  if (!desc) return '';
  if (desc.key) return t(desc.key, desc.vars);
  return desc.text || t('errGeneric');
}

/* ───────────────────────── Language ───────────────────────── */

function applyStaticStrings() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('product');
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  }
  for (const node of document.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.setAttribute('title', t(node.dataset.i18nTitle));
  }
  for (const node of document.querySelectorAll('.js-lang-label')) node.textContent = t('langLabel');
  dom.newChat.setAttribute('aria-label', t('newChat'));
}

function setLang(lang) {
  state.lang = lang === 'en' ? 'en' : 'ar';
  const store = localStore();
  if (store) storageSet(store, LANG_STORE, state.lang);
  applyStaticStrings();
  renderGateError();
  renderStatus();
  renderWhoami();
  renderProjects();
  renderStageHead();
  renderConversation();
}

/* ───────────────────────── Gate ───────────────────────── */

function renderGateError() {
  const text = errorText(state.gateError);
  dom.gateError.textContent = text;
  dom.gateError.hidden = !text;
}

function setGateBusy(busy) {
  dom.gateSubmit.disabled = busy;
  dom.keyInput.readOnly = busy;
  const label = dom.gateSubmit.querySelector('span');
  if (label) label.textContent = busy ? t('checking') : t('enter');
}

function showGate(errorDesc) {
  state.gateError = errorDesc || null;
  dom.app.hidden = true;
  dom.gate.hidden = false;
  renderGateError();
  setGateBusy(false);
  dom.keyInput.value = '';
  dom.keyInput.focus();
}

function resetSession() {
  if (state.streaming) state.streaming.controller.abort();
  state.streaming = null;
  state.key = '';
  state.me = null;
  state.projects = [];
  state.projectId = 'general';
  state.conversations.clear();
  saveKey('');
  dom.messages.replaceChildren();
  dom.input.value = '';
  dom.adminLink.hidden = true;
  stopHealthPolling();
}

async function signIn(candidate) {
  setGateBusy(true);
  state.gateError = null;
  renderGateError();
  try {
    const me = await api('/api/me', { key: candidate });
    state.key = candidate;
    state.me = me && typeof me === 'object' ? me : {};
    saveKey(candidate);
    await enterApp();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) saveKey('');
    state.gateError = describeError(err);
    renderGateError();
    dom.keyInput.focus();
  } finally {
    setGateBusy(false);
  }
}

async function enterApp() {
  dom.gate.hidden = true;
  dom.app.hidden = false;
  dom.keyInput.value = '';
  dom.adminLink.hidden = !(state.me && state.me.role === 'admin');
  renderWhoami();
  await loadProjects();
  if (!state.key) return; // key was rejected while loading projects
  renderStageHead();
  renderConversation();
  updateComposer();
  startHealthPolling();
  dom.input.focus();
}

function renderWhoami() {
  const me = state.me;
  if (!me) {
    dom.whoami.textContent = '';
    return;
  }
  const role = me.role === 'admin' ? t('roleAdmin') : t('roleProject');
  const name = typeof me.name === 'string' && me.name ? me.name : role;
  dom.whoami.textContent = t('signedInAs', { name, role });
}

/* ───────────────────────── Projects ───────────────────────── */

function fallbackProjects() {
  return [{ id: 'general', name: I18N.en.generalName, nameAr: I18N.ar.generalName, description: '', descriptionAr: '' }];
}

async function loadProjects() {
  let list = [];
  try {
    const data = await api('/api/projects');
    const raw = Array.isArray(data) ? data : data && Array.isArray(data.projects) ? data.projects : [];
    list = raw.filter((p) => p && typeof p.id === 'string' && p.id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      resetSession();
      showGate({ key: 'errExpired' });
      return;
    }
  }
  if (!list.length) list = fallbackProjects();
  state.projects = list;
  if (!list.some((p) => p.id === state.projectId)) {
    state.projectId = list.some((p) => p.id === 'general') ? 'general' : list[0].id;
  }
  renderProjects();
}

function currentProject() {
  return state.projects.find((p) => p.id === state.projectId) || null;
}

function projectName(p) {
  if (!p) return '';
  const ar = typeof p.nameAr === 'string' ? p.nameAr : '';
  const en = typeof p.name === 'string' ? p.name : '';
  return (state.lang === 'ar' ? ar || en : en || ar) || p.id;
}

function projectDescription(p) {
  if (!p) return '';
  const ar = typeof p.descriptionAr === 'string' ? p.descriptionAr : '';
  const en = typeof p.description === 'string' ? p.description : '';
  return state.lang === 'ar' ? ar || en : en || ar;
}

function renderProjects() {
  const frag = document.createDocumentFragment();
  for (const p of state.projects) {
    const li = el('li');
    const btn = el('button', 'project');
    btn.type = 'button';
    btn.dataset.project = p.id;
    if (p.id === state.projectId) btn.setAttribute('aria-current', 'true');
    const name = el('span', 'project-name', projectName(p));
    name.dir = 'auto';
    btn.append(name);
    const desc = projectDescription(p);
    if (desc) {
      const d = el('span', 'project-desc', desc);
      d.dir = 'auto';
      btn.append(d);
      btn.title = desc;
    }
    li.append(btn);
    frag.append(li);
  }
  dom.projectList.replaceChildren(frag);
}

function renderStageHead() {
  const p = currentProject();
  dom.projectTitle.textContent = projectName(p);
  const desc = projectDescription(p);
  dom.projectDesc.textContent = desc;
  dom.projectDesc.hidden = !desc;
}

function selectProject(id) {
  if (id === state.projectId || !state.projects.some((p) => p.id === id)) return;
  if (state.streaming) state.streaming.controller.abort();
  state.projectId = id;
  renderProjects();
  renderStageHead();
  renderConversation();
  const active = dom.projectList.querySelector('[aria-current="true"]');
  if (active && typeof active.scrollIntoView === 'function') {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  dom.input.focus();
}

/* ───────────────────────── Health pill ───────────────────────── */

async function pollHealth() {
  if (document.hidden) return;
  let next = { kind: 'unreachable', model: state.health.model };
  try {
    const opts = { cache: 'no-store', headers: { Accept: 'application/json' } };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      opts.signal = AbortSignal.timeout(8000);
    }
    const res = await fetch('/health', opts);
    if (res.ok) {
      const data = await res.json();
      const llm = (data && data.llm) || {};
      const model = typeof llm.defaultModel === 'string' ? llm.defaultModel : '';
      if (llm.pulling) next = { kind: 'pulling', model };
      else if (llm.ok && llm.defaultModelReady) next = { kind: 'ready', model };
      else next = { kind: 'notready', model };
    }
  } catch {
    /* network failure or timeout -> unreachable */
  }
  state.health = next;
  renderStatus();
}

function renderStatus() {
  const { kind, model } = state.health;
  const labels = {
    checking: 'statusChecking',
    ready: 'statusReady',
    pulling: 'statusPulling',
    notready: 'statusNotReady',
    unreachable: 'statusUnreachable',
  };
  const label = t(labels[kind] || 'statusChecking');
  const signature = `${kind}|${model}|${state.lang}`;
  if (dom.status.dataset.signature === signature) return; // avoid re-announcing an unchanged status
  dom.status.dataset.signature = signature;
  dom.status.dataset.state = kind;
  dom.statusText.replaceChildren(document.createTextNode(label));
  if (model && kind === 'ready') {
    const name = el('bdi', null, model);
    name.dir = 'ltr';
    dom.statusText.append(document.createTextNode(' · '), name);
  }
  dom.status.title = model ? `${label} · ${model}` : label;
}

function startHealthPolling() {
  stopHealthPolling();
  pollHealth();
  state.healthTimer = window.setInterval(pollHealth, HEALTH_INTERVAL_MS);
}

function stopHealthPolling() {
  if (state.healthTimer) window.clearInterval(state.healthTimer);
  state.healthTimer = 0;
}

/* ───────────────────────── Safe markdown subset ───────────────────────── */
// Everything is built with createElement + textContent. Model output never reaches innerHTML.

const INLINE_RE = /`([^`\n]+)`|\*\*(?=\S)([^\n]*?\S)\*\*/g;

function appendInline(parent, text, allowBold = true) {
  let last = 0;
  const re = new RegExp(INLINE_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2] !== undefined && !allowBold) continue;
    if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      const code = el('code', 'inline-code', m[1]);
      code.dir = 'ltr';
      parent.append(code);
    } else {
      const strong = el('strong');
      appendInline(strong, m[2], false);
      parent.append(strong);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

function codeBlock(code, lang) {
  const wrap = el('div', 'code');
  wrap.dir = 'ltr';
  const bar = el('div', 'code-bar');
  bar.append(el('span', 'code-lang', lang || t('code')));
  const copy = el('button', 'code-copy', t('copy'));
  copy.type = 'button';
  bar.append(copy);
  const pre = el('pre');
  pre.dir = 'ltr';
  pre.append(el('code', null, code));
  wrap.append(bar, pre);
  return wrap;
}

function renderMarkdown(source) {
  const frag = document.createDocumentFragment();
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  let list = null;
  let listKind = '';

  const flushPara = () => {
    if (!para.length) return;
    const p = el('p');
    p.dir = 'auto';
    para.forEach((line, i) => {
      if (i) p.append(el('br'));
      appendInline(p, line);
    });
    frag.append(p);
    para = [];
  };
  const flushList = () => {
    if (list) frag.append(list);
    list = null;
    listKind = '';
  };
  const addItem = (kind, text, start) => {
    flushPara();
    if (!list || listKind !== kind) {
      flushList();
      list = el(kind);
      listKind = kind;
      if (kind === 'ol' && start > 1) list.start = start;
    }
    const li = el('li');
    li.dir = 'auto';
    appendInline(li, text);
    list.append(li);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const fence = /^\s*```+(.*)$/.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const lang = (/[\w+#.-]+/.exec(fence[1]) || [''])[0].slice(0, 24);
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      frag.append(codeBlock(body.join('\n'), lang));
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara();
      flushList();
      frag.append(el('hr'));
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const h = el(heading[1].length <= 2 ? 'h3' : 'h4');
      h.dir = 'auto';
      appendInline(h, heading[2]);
      frag.append(h);
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      addItem('ul', bullet[1], 0);
      continue;
    }

    const ordered = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      addItem('ol', ordered[2], Number(ordered[1]));
      continue;
    }

    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return frag;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = el('textarea', 'sr-only');
    area.value = text;
    area.setAttribute('readonly', '');
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ───────────────────────── Conversation rendering ───────────────────────── */

function conversation(projectId = state.projectId) {
  let conv = state.conversations.get(projectId);
  if (!conv) {
    conv = [];
    state.conversations.set(projectId, conv);
  }
  return conv;
}

function nearBottom() {
  const s = dom.scroller;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 96;
}

function scrollToBottom() {
  dom.scroller.scrollTop = dom.scroller.scrollHeight;
}

function buildFoot(msg) {
  const sources = Array.isArray(msg.sources) ? msg.sources : [];
  const seen = new Set();
  const unique = [];
  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    const title = typeof s.title === 'string' ? s.title : '';
    const path = typeof s.source === 'string' ? s.source : '';
    if (!title && !path) continue;
    const id = `${title}\u0000${path}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push({ title, path });
  }

  const metaParts = [];
  const u = msg.usage && typeof msg.usage === 'object' ? msg.usage : null;
  if (u) {
    const prompt = Number(u.promptTokens ?? u.prompt_tokens) || 0;
    const completion = Number(u.completionTokens ?? u.completion_tokens) || 0;
    const total = Number(u.totalTokens ?? u.total_tokens) || prompt + completion;
    const ms = Number(u.ms) || 0;
    if (total > 0) metaParts.push(t('metaTokens', { n: formatNumber(total) }));
    if (ms > 0) metaParts.push(t('metaSeconds', { s: (ms / 1000).toFixed(1) }));
  }

  if (!unique.length && !metaParts.length) return null;
  const foot = el('div', 'msg-foot');
  if (unique.length) {
    foot.append(el('p', 'sources-label', t('sources')));
    const ul = el('ul', 'sources');
    for (const s of unique) {
      const li = el('li', 'chip');
      if (s.title) {
        const title = el('span', 'chip-title', s.title);
        title.dir = 'auto';
        li.append(title);
      }
      if (s.path) {
        const path = el('span', 'chip-path', s.path);
        path.dir = 'ltr';
        li.append(path);
      }
      li.title = [s.title, s.path].filter(Boolean).join(' — ');
      ul.append(li);
    }
    foot.append(ul);
  }
  if (metaParts.length) foot.append(el('p', 'msg-meta', metaParts.join(' · ')));
  return foot;
}

function fillAssistant(msg, ref) {
  const body = ref.body;
  const parts = [];
  if (msg.content) parts.push(renderMarkdown(msg.content));
  if (msg.pending && !msg.content) {
    const typing = el('span', 'typing');
    typing.append(el('span'), el('span'), el('span'));
    typing.setAttribute('aria-hidden', 'true');
    parts.push(typing);
  }
  if (msg.error) {
    const err = el('p', 'msg-error', errorText(msg.error));
    err.dir = 'auto';
    parts.push(err);
  }
  if (msg.stopped) parts.push(el('p', 'msg-note', t('stopped')));
  body.replaceChildren(...parts);

  if (ref.foot) ref.foot.remove();
  ref.foot = msg.pending ? null : buildFoot(msg);
  if (ref.foot) ref.el.append(ref.foot);
}

function buildMessage(msg) {
  if (msg.role === 'user') {
    const node = el('div', 'msg msg-user', msg.content);
    node.dir = 'auto';
    nodes.set(msg, { el: node, body: node, foot: null });
    return node;
  }
  const node = el('article', 'msg msg-assistant');
  const body = el('div', 'msg-body');
  node.append(body);
  const ref = { el: node, body, foot: null };
  nodes.set(msg, ref);
  fillAssistant(msg, ref);
  return node;
}

function refreshMessage(msg) {
  const ref = nodes.get(msg);
  if (!ref || !ref.el.isConnected) return;
  const stick = nearBottom();
  fillAssistant(msg, ref);
  if (stick) scrollToBottom();
}

function renderEmpty() {
  const p = currentProject();
  const isGeneral = !p || p.id === 'general';
  const name = projectName(p);
  dom.emptySub.textContent = isGeneral ? t('emptySubGeneral') : t('emptySubProject', { name });
  const dict = I18N[state.lang] || I18N.ar;
  const prompts = isGeneral ? dict.suggestGeneral : dict.suggestProject.map((s) => s.split('{name}').join(name));
  const frag = document.createDocumentFragment();
  for (const prompt of prompts) {
    const li = el('li');
    const btn = el('button', 'suggestion');
    btn.type = 'button';
    const label = el('span', null, prompt);
    label.dir = 'auto';
    btn.append(label);
    li.append(btn);
    frag.append(li);
  }
  dom.suggestions.replaceChildren(frag);
}

function renderConversation() {
  const conv = conversation();
  const isEmpty = conv.length === 0;
  dom.empty.hidden = !isEmpty;
  if (isEmpty) renderEmpty();
  const frag = document.createDocumentFragment();
  for (const msg of conv) frag.append(buildMessage(msg));
  dom.messages.replaceChildren(frag);
  scrollToBottom();
}

/* ───────────────────────── Composer ───────────────────────── */

function autoGrow() {
  // CSSOM writes are allowed under style-src 'self' (only style attributes/elements are blocked).
  dom.input.style.height = 'auto';
  dom.input.style.height = `${dom.input.scrollHeight}px`;
}

function updateComposer() {
  const busy = Boolean(state.streaming);
  dom.sendBtn.hidden = busy;
  dom.stopBtn.hidden = !busy;
  dom.sendBtn.disabled = busy || !dom.input.value.trim();
}

function announce(text) {
  dom.live.textContent = text;
}

/* ───────────────────────── Chat (SSE over fetch) ───────────────────────── */

function historyFor(conv) {
  return conv
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));
}

async function sendMessage(text) {
  const content = String(text || '').trim();
  if (!content || state.streaming || !state.key) return;

  const projectId = state.projectId;
  const conv = conversation(projectId);
  const userMsg = { role: 'user', content };
  conv.push(userMsg);
  const payloadMessages = historyFor(conv);
  const reply = { role: 'assistant', content: '', pending: true, sources: [], usage: null, error: null, stopped: false };
  conv.push(reply);

  dom.empty.hidden = true;
  dom.messages.append(buildMessage(userMsg), buildMessage(reply));
  scrollToBottom();

  const controller = new AbortController();
  state.streaming = { controller, msg: reply, projectId };
  updateComposer();
  announce(t('liveThinking'));

  let frame = 0;
  const scheduleRender = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      refreshMessage(reply);
    });
  };

  let finished = false;
  let unauthorized = false;

  const handleEvent = (evt) => {
    if (!evt || typeof evt !== 'object') return;
    if (typeof evt.delta === 'string' && evt.delta) {
      reply.content += evt.delta;
      scheduleRender();
    }
    if (evt.error) {
      const e = evt.error;
      const message = typeof e === 'string' ? e : e && typeof e.message === 'string' ? e.message : '';
      reply.error = message ? { text: message } : { key: 'errGeneric' };
      finished = true;
    }
    if (evt.done) {
      if (Array.isArray(evt.sources)) reply.sources = evt.sources;
      if (evt.usage && typeof evt.usage === 'object') reply.usage = evt.usage;
      finished = true;
    }
  };

  const handleLine = (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith('data:')) return; // comments / heartbeats / blank separators
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      handleEvent(JSON.parse(data));
    } catch {
      /* ignore a malformed line rather than break the stream */
    }
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${state.key}`,
      },
      body: JSON.stringify({ project: projectId, messages: payloadMessages, lang: state.lang, stream: true }),
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await toApiError(res);
      unauthorized = err.status === 401;
      const known = err.status === 401 || err.status === 403 || err.status === 429;
      reply.error = !known && err.message ? { text: err.message } : describeError(err);
      finished = true;
    } else if (!(res.headers.get('Content-Type') || '').includes('text/event-stream') || !res.body) {
      // Server answered without streaming: { content, sources, usage }.
      const data = await res.json();
      if (data && typeof data.content === 'string') reply.content = data.content;
      handleEvent({ done: true, sources: data && data.sources, usage: data && data.usage });
      if (data && data.error) handleEvent({ error: data.error });
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          handleLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
        }
      }
      buffer += decoder.decode();
      if (buffer) handleLine(buffer);
    }

    if (!finished) reply.error = { key: reply.content ? 'errInterrupted' : 'errEmpty' };
    else if (!reply.error && !reply.content.trim()) reply.error = { key: 'errEmpty' };
  } catch (err) {
    if (controller.signal.aborted || (err && err.name === 'AbortError')) {
      reply.stopped = true;
    } else {
      reply.error = { key: reply.content ? 'errInterrupted' : 'errNetwork' };
    }
  } finally {
    if (frame) window.cancelAnimationFrame(frame);
    reply.pending = false;
    if (state.streaming && state.streaming.msg === reply) state.streaming = null;
    refreshMessage(reply);
    updateComposer();
    announce(reply.error ? errorText(reply.error) : reply.stopped ? t('stopped') : t('liveDone'));
  }

  if (unauthorized) {
    resetSession();
    showGate({ key: 'errExpired' });
  }
}

function submitComposer() {
  const text = dom.input.value;
  if (!text.trim() || state.streaming) return;
  dom.input.value = '';
  autoGrow();
  updateComposer();
  sendMessage(text);
}

/* ───────────────────────── Events ───────────────────────── */

function bindEvents() {
  for (const btn of document.querySelectorAll('.js-lang')) {
    btn.addEventListener('click', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));
  }

  dom.gateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const candidate = dom.keyInput.value.trim() || loadKey();
    if (!candidate) {
      state.gateError = { key: 'errKeyEmpty' };
      renderGateError();
      dom.keyInput.focus();
      return;
    }
    signIn(candidate);
  });

  dom.signOut.addEventListener('click', () => {
    resetSession();
    showGate(null);
  });

  dom.projectList.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('.project') : null;
    if (btn && btn.dataset.project) selectProject(btn.dataset.project);
  });

  dom.newChat.addEventListener('click', () => {
    if (state.streaming) state.streaming.controller.abort();
    state.conversations.set(state.projectId, []);
    renderConversation();
    dom.input.focus();
  });

  dom.suggestions.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('.suggestion') : null;
    if (btn) sendMessage(btn.textContent);
  });

  dom.messages.addEventListener('click', async (event) => {
    const btn = event.target instanceof Element ? event.target.closest('.code-copy') : null;
    if (!btn) return;
    const block = btn.closest('.code');
    const code = block ? block.querySelector('pre code') : null;
    if (!code) return;
    const ok = await copyText(code.textContent || '');
    if (!ok) return;
    btn.textContent = t('copied');
    btn.dataset.copied = 'true';
    window.setTimeout(() => {
      if (!btn.isConnected) return;
      btn.textContent = t('copy');
      delete btn.dataset.copied;
    }, 1600);
  });

  dom.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    submitComposer();
  });

  dom.input.addEventListener('input', () => {
    autoGrow();
    updateComposer();
  });

  dom.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submitComposer();
  });

  dom.stopBtn.addEventListener('click', () => {
    if (state.streaming) state.streaming.controller.abort();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.key && !dom.app.hidden) pollHealth();
  });
}

/* ───────────────────────── Boot ───────────────────────── */

async function boot() {
  const store = localStore();
  const savedLang = store ? storageGet(store, LANG_STORE) : '';
  state.lang = savedLang === 'en' ? 'en' : 'ar';
  applyStaticStrings();
  renderStatus();
  bindEvents();

  const saved = loadKey();
  if (saved) {
    await signIn(saved);
    if (!state.key) dom.keyInput.focus();
  } else {
    dom.keyInput.focus();
  }
}

boot();
