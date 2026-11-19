import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, loadConfig, makeLimiter } from '../server.mjs';
import { buildSsml } from '../src/azure.mjs';
import { buildMessages, parseModelJson } from '../src/ai.mjs';

async function start(deps, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nutq-'));
  const cfg = loadConfig({ DATA_DIR: dir, AI_API_KEY: 'k', AZURE_SPEECH_KEY: 'a', AZURE_SPEECH_REGION: 'uaenorth', ...env });
  const srv = createServer(cfg, deps);
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, close: async () => { srv.close(); await rm(dir, { recursive: true, force: true }); } };
}

const MODEL = { arabic: 'شُكْرًا جَزِيلًا', translit: 'x', words: [{ ar: 'شُكْرًا', en: 'thanks' }, { ar: 'جَزِيلًا', en: 'very much' }] };

test('translate → audio end to end, with caching', async () => {
  let aiCalls = 0, ttsCalls = 0, lastTts;
  const s = await start({
    translate: async () => { aiCalls++; return MODEL; },
    synthesize: async (text, voice, speed) => { ttsCalls++; lastTts = { text, voice, speed }; return Buffer.from('ID3fake'); },
  });
  try {
    const r = await fetch(`${s.base}/api/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Thank you very much' }) });
    assert.equal(r.status, 200);
    const t = await r.json();
    assert.equal(t.translit, 'shukran jazeelan');
    assert.equal(t.translitSource, 'rules');
    assert.equal(t.words[1].tr, 'jazeelan');

    const again = await (await fetch(`${s.base}/api/translate`, { method: 'POST', body: JSON.stringify({ text: 'thank you   very much' }) })).json();
    assert.equal(again.cached, true);
    assert.equal(aiCalls, 1);

    const a = await fetch(`${s.base}/api/audio/${t.id}/all.mp3?voice=ar-SA-ZariyahNeural&speed=slow`);
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(lastTts, { text: 'شُكْرًا جَزِيلًا', voice: 'ar-SA-ZariyahNeural', speed: 'slow' });
    await fetch(`${s.base}/api/audio/${t.id}/all.mp3?voice=ar-SA-ZariyahNeural&speed=slow`);
    assert.equal(ttsCalls, 1, 'second play served from disk cache');

    const w = await fetch(`${s.base}/api/audio/${t.id}/1.mp3?voice=evil`);
    assert.equal(w.status, 200);
    assert.equal(lastTts.text, 'جَزِيلًا');
    assert.equal(lastTts.voice, 'ar-SA-HamedNeural', 'unknown voice falls back to default');

    assert.equal((await fetch(`${s.base}/api/audio/${t.id}/9.mp3`)).status, 404);
    assert.equal((await fetch(`${s.base}/api/audio/${'0'.repeat(32)}/all.mp3`)).status, 404);
  } finally { await s.close(); }
});

test('unvocalised model output falls back to the model transliteration', async () => {
  const s = await start({ translate: async () => ({ arabic: 'كيف حالك', translit: 'kayf haalak', words: [] }) });
  try {
    const t = await (await fetch(`${s.base}/api/translate`, { method: 'POST', body: JSON.stringify({ text: 'how are you' }) })).json();
    assert.equal(t.translit, 'kayf haalak');
    assert.equal(t.translitSource, 'model');
  } finally { await s.close(); }
});

test('input validation and errors', async () => {
  const s = await start({ translate: async () => { throw new Error('boom'); } });
  try {
    const post = (body) => fetch(`${s.base}/api/translate`, { method: 'POST', body });
    assert.equal((await post(JSON.stringify({ text: '' }))).status, 400);
    assert.equal((await post(JSON.stringify({ text: 'x'.repeat(201) }))).status, 400);
    assert.equal((await post('{bad')).status, 400);
    assert.equal((await post(JSON.stringify({ text: 'hi', pad: 'x'.repeat(5000) }))).status, 413);
    const e = await post(JSON.stringify({ text: 'hi' }));
    assert.equal(e.status, 502);
    assert.doesNotMatch((await e.json()).error, /boom/, 'internal errors are not leaked');
  } finally { await s.close(); }
});

test('missing keys report not configured', async () => {
  const s = await start({}, { AI_API_KEY: '', AZURE_SPEECH_KEY: '' });
  try {
    const c = await (await fetch(`${s.base}/api/config`)).json();
    assert.equal(c.ai, false);
    assert.equal(c.tts, false);
    assert.equal((await fetch(`${s.base}/api/translate`, { method: 'POST', body: '{"text":"hi"}' })).status, 503);
  } finally { await s.close(); }
});

test('static files and path traversal', async () => {
  const s = await start({});
  try {
    const r = await fetch(`${s.base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal((await fetch(`${s.base}/app.js`)).status, 200);
    assert.equal((await fetch(`${s.base}/..%2fserver.mjs`)).status, 404);
  } finally { await s.close(); }
});

test('rate limiter', () => {
  const lim = makeLimiter(2);
  assert.ok(lim('a', 0)); assert.ok(lim('a', 1)); assert.ok(!lim('a', 2));
  assert.ok(lim('b', 2));
  assert.ok(lim('a', 60001));
});

test('SSML escapes text and pins the voice locale', () => {
  const x = buildSsml('a<b & "c"', 'ar-EG-SalmaNeural', 'slow');
  assert.match(x, /xml:lang="ar-EG"/);
  assert.match(x, /a&lt;b &amp; &quot;c&quot;/);
  assert.match(x, /rate="-30%"/);
  assert.match(buildSsml('x', 'nope', 'weird'), /ar-SA-HamedNeural.*rate="0%"/);
});

test('model JSON parsing tolerates fences and chatter', () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Sure! {"a":2} hope it helps'), { a: 2 });
  assert.throws(() => parseModelJson('nope'));
  assert.equal(buildMessages('hi', 'saudi').at(-1).content, 'hi');
});
