const $ = (id) => document.getElementById(id);
const EXAMPLES = ['Hello', 'Thank you very much', 'Where is the mosque?', 'How much is this?', "I don't understand", 'Good morning'];
const SPK = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';

let dialect = 'msa';
let current = null;
let config = { tts: false, voices: [] };
const audio = $('audio');
let playingBtn = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---- setup ----
for (const t of EXAMPLES) {
  const b = el('button', 'chip', t);
  b.type = 'button';
  b.onclick = () => { $('inp').value = t; run(); };
  $('chips').appendChild(b);
}
for (const b of document.querySelectorAll('#dial button')) {
  b.onclick = () => {
    document.querySelectorAll('#dial button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    dialect = b.dataset.v;
  };
}
$('inp').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); }
});
$('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });

function savedVoice() {
  try { return localStorage.getItem('nutq.voice'); } catch { return null; }
}
$('voice').onchange = () => { try { localStorage.setItem('nutq.voice', $('voice').value); } catch {} };

fetch('/api/config').then((r) => r.json()).then((c) => {
  config = c;
  const pick = savedVoice();
  for (const v of c.voices) {
    const o = el('option', null, `${v.label} · ${v.region} ${v.gender === 'female' ? '♀' : '♂'}`);
    o.value = v.id;
    if (v.id === (c.voices.some((x) => x.id === pick) ? pick : c.defaultVoice)) o.selected = true;
    $('voice').appendChild(o);
  }
  if (!c.ai) $('status').textContent = 'Translation is not set up on the server yet.';
}).catch(() => {});

// ---- translate ----
let slowTimer = null;
async function run() {
  const text = $('inp').value.trim();
  $('err').textContent = '';
  if (!text) return;
  $('go').disabled = true;
  $('go').innerHTML = '<span class="spin"></span>';
  $('status').textContent = 'Translating…';
  slowTimer = setTimeout(() => { $('status').textContent = 'Still working — new phrases can take up to a minute.'; }, 6000);
  try {
    const r = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, dialect }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    current = data;
    render(data);
    $('status').textContent = '';
  } catch (e) {
    $('status').textContent = '';
    $('err').textContent = e.message || 'Something went wrong. Please try again.';
  } finally {
    clearTimeout(slowTimer);
    $('go').disabled = false;
    $('go').textContent = 'Translate';
  }
}

function render(r) {
  $('ar').textContent = r.arabic;
  $('tr').textContent = r.translit || '';
  const words = Array.isArray(r.words) ? r.words : [];
  $('wordsSect').hidden = words.length < 2;
  $('words').replaceChildren(...words.map((w, i) => {
    const row = el('div', 'w');
    const ar = el('div', 'war', w.ar);
    ar.lang = 'ar'; ar.dir = 'rtl';
    const mid = el('div');
    if (w.tr) mid.appendChild(el('div', 'wtr', w.tr));
    if (w.en) mid.appendChild(el('div', 'wen', w.en));
    row.append(ar, mid);
    if (config.tts) {
      const b = el('button', 'mini');
      b.type = 'button';
      b.innerHTML = SPK;
      b.setAttribute('aria-label', `Listen to ${w.tr || w.ar}`);
      b.onclick = () => play(String(i), 'slow', b);
      row.appendChild(b);
    } else {
      row.appendChild(el('span'));
    }
    return row;
  }));
  const tips = Array.isArray(r.tips) ? r.tips : [];
  $('tipsSect').hidden = !tips.length;
  $('tips').replaceChildren(...tips.map((t) => el('li', null, t)));
  for (const id of ['pNormal', 'pSlow', 'voice']) $(id).hidden = !config.tts;
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- audio ----
function play(part, speed, btn) {
  if (!current) return;
  const voice = $('voice').value;
  const src = `/api/audio/${current.id}/${part}.mp3?voice=${encodeURIComponent(voice)}&speed=${speed}`;
  if (playingBtn) playingBtn.classList.remove('playing');
  playingBtn = btn;
  btn.classList.add('playing');
  audio.src = src;
  audio.play().catch(() => {
    btn.classList.remove('playing');
    $('err').textContent = 'Could not play the audio. Please try again.';
  });
}
audio.addEventListener('ended', () => playingBtn && playingBtn.classList.remove('playing'));
audio.addEventListener('error', () => {
  if (playingBtn) playingBtn.classList.remove('playing');
  if (audio.src) $('err').textContent = 'The voice service did not answer. Please try again.';
});
$('pNormal').onclick = () => play('all', 'normal', $('pNormal'));
$('pSlow').onclick = () => play('all', 'slow', $('pSlow'));
$('copy').onclick = async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(`${current.arabic}\n${current.translit}`);
    $('copy').textContent = 'Copied ✓';
    setTimeout(() => { $('copy').textContent = 'Copy'; }, 1500);
  } catch {}
};
