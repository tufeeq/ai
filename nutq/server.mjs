// Nutq — English → Arabic with learner pronunciation and Azure neural voices.
// Zero npm dependencies (Node 22). Translation: AI Hub. Voices: Azure AI Speech.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translate } from './src/ai.mjs';
import { VOICES, SPEEDS, synthesize } from './src/azure.mjs';
import { transliterate, pausalize, vowelDensity, tipsFor } from './src/translit.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 8080),
    dataDir: env.DATA_DIR || join(ROOT, 'data'),
    aiBaseUrl: env.AI_BASE_URL || 'https://ai.tryn.cc/v1',
    aiApiKey: env.AI_API_KEY || '',
    aiModel: env.AI_MODEL || 'gpt-4o-mini',
    aiTimeoutMs: Number(env.AI_TIMEOUT_MS || 180000),
    azureKey: env.AZURE_SPEECH_KEY || '',
    azureRegion: env.AZURE_SPEECH_REGION || '',
    azureEndpoint: env.AZURE_SPEECH_ENDPOINT || '',
    defaultVoice: VOICES.some((v) => v.id === env.DEFAULT_VOICE) ? env.DEFAULT_VOICE : 'ar-SA-HamedNeural',
    maxChars: Number(env.MAX_INPUT_CHARS || 200),
    translateRpm: Number(env.TRANSLATE_RPM || 10),
    audioRpm: Number(env.AUDIO_RPM || 60),
  };
}

// ---------- small helpers ----------
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(payload);
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

async function readJson(req, limit = 4096) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('request too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

function clientIp(req) {
  // Behind Dokploy's Traefik the real client is the first X-Forwarded-For entry.
  const xff = req.headers['x-forwarded-for'];
  return (typeof xff === 'string' && xff.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}

export function makeLimiter(perMinute) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const arr = (hits.get(key) || []).filter((t) => now - t < 60000);
    if (arr.length >= perMinute) { hits.set(key, arr); return false; }
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
    return true;
  };
}

// ---------- core: build the learner result ----------
export function buildResult(model) {
  const arabic = pausalize(model.arabic);
  const vocalised = vowelDensity(arabic) >= 0.5;
  const words = (model.words.length ? model.words : arabic.split(/\s+/).map((ar) => ({ ar, en: '' }))).map((w) => {
    const ar = pausalize(w.ar).replace(/[،؟؛.!?,]/g, '');
    return { ar, tr: vocalised && vowelDensity(ar) >= 0.5 ? transliterate(ar) : '', en: w.en };
  });
  return {
    arabic,
    translit: vocalised ? transliterate(arabic) : model.translit,
    translitSource: vocalised ? 'rules' : 'model',
    words,
    tips: tipsFor(arabic),
  };
}

// ---------- server ----------
export function createServer(cfg, deps = {}) {
  const doTranslate = deps.translate || translate;
  const doSynth = deps.synthesize || synthesize;
  const tCache = join(cfg.dataDir, 'translations');
  const aCache = join(cfg.dataDir, 'audio');
  const ready = Promise.all([mkdir(tCache, { recursive: true }), mkdir(aCache, { recursive: true })]);
  const translateLimit = makeLimiter(cfg.translateRpm);
  const audioLimit = makeLimiter(cfg.audioRpm);
  const inflight = new Map();

  const ttsReady = () => Boolean(cfg.azureKey && (cfg.azureRegion || cfg.azureEndpoint));
  const aiReady = () => Boolean(cfg.aiApiKey);

  async function loadTranslation(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) return null;
    try { return JSON.parse(await readFile(join(tCache, id + '.json'), 'utf8')); } catch { return null; }
  }

  async function handleTranslate(req, res) {
    if (!translateLimit(clientIp(req))) return send(res, 429, { error: 'Too many requests — wait a minute and try again.' });
    const body = await readJson(req);
    const text = String(body.text ?? '').replace(/\s+/g, ' ').trim();
    const dialect = body.dialect === 'saudi' ? 'saudi' : 'msa';
    if (!text) return send(res, 400, { error: 'Type something to translate.' });
    if (text.length > cfg.maxChars) return send(res, 400, { error: `Please keep it under ${cfg.maxChars} characters.` });
    if (!aiReady()) return send(res, 503, { error: 'Translation is not configured on the server yet.' });

    const id = hash(`v1|${dialect}|${text.toLowerCase()}`);
    const cached = await loadTranslation(id);
    if (cached) return send(res, 200, { id, ...cached, cached: true });

    if (!inflight.has(id)) {
      inflight.set(id, (async () => {
        const model = await doTranslate(text, dialect, cfg);
        const result = { input: text, dialect, ...buildResult(model) };
        await writeFile(join(tCache, id + '.json'), JSON.stringify(result));
        return result;
      })().finally(() => inflight.delete(id)));
    }
    try {
      const result = await inflight.get(id);
      return send(res, 200, { id, ...result, cached: false });
    } catch (e) {
      console.error('translate failed:', e.message);
      const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
      return send(res, 502, { error: timeout ? 'The translator took too long. Please try again.' : 'Translation failed. Please try again.' });
    }
  }

  async function handleAudio(req, res, id, part, url) {
    if (!ttsReady()) return send(res, 503, { error: 'Voices are not configured on the server yet.' });
    if (!audioLimit(clientIp(req))) return send(res, 429, { error: 'Too many requests.' });
    const t = await loadTranslation(id);
    if (!t) return send(res, 404, { error: 'Unknown phrase.' });
    let text;
    if (part === 'all') text = t.arabic;
    else if (/^\d{1,3}$/.test(part) && t.words[Number(part)]) text = t.words[Number(part)].ar;
    else return send(res, 404, { error: 'Unknown part.' });
    const voice = VOICES.some((v) => v.id === url.searchParams.get('voice')) ? url.searchParams.get('voice') : cfg.defaultVoice;
    const speed = Object.hasOwn(SPEEDS, url.searchParams.get('speed') || '') ? url.searchParams.get('speed') : 'normal';

    const file = join(aCache, hash(`${voice}|${speed}|${text}`) + '.mp3');
    let audio;
    try { audio = await readFile(file); } catch {
      try {
        audio = await doSynth(text, voice, speed, cfg);
        await writeFile(file, audio);
      } catch (e) {
        console.error('tts failed:', e.message);
        return send(res, 502, { error: e.status === 401 || e.status === 403 ? 'Voice service key was rejected.' : 'Voice service failed.' });
      }
    }
    return send(res, 200, audio, { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' });
  }

  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const full = normalize(join(PUBLIC, rel));
    if (!full.startsWith(PUBLIC)) return send(res, 404, 'Not found');
    try {
      const data = await readFile(full);
      return send(res, 200, data, { 'content-type': TYPES[extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    } catch {
      return send(res, 404, 'Not found');
    }
  }

  return http.createServer(async (req, res) => {
    try {
      await ready;
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true, tts: ttsReady(), ai: aiReady() });
      if (req.method === 'GET' && p === '/api/config')
        return send(res, 200, { voices: VOICES, defaultVoice: cfg.defaultVoice, tts: ttsReady(), ai: aiReady(), maxChars: cfg.maxChars });
      if (req.method === 'POST' && p === '/api/translate') return await handleTranslate(req, res);
      const m = p.match(/^\/api\/audio\/([a-f0-9]{32})\/(all|\d{1,3})\.mp3$/);
      if (req.method === 'GET' && m) return await handleAudio(req, res, m[1], m[2], url);
      if (req.method === 'GET' && !p.startsWith('/api/')) return await serveStatic(res, p);
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
      if (!e.status) console.error(e);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const cfg = loadConfig();
  createServer(cfg).listen(cfg.port, () => {
    console.log(`nutq listening on :${cfg.port} — translation ${cfg.aiApiKey ? 'on' : 'OFF (set AI_API_KEY)'}, voices ${cfg.azureKey ? 'on' : 'OFF (set AZURE_SPEECH_KEY)'}`);
  });
}
