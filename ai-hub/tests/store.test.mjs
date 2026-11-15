import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore } from '../src/store.mjs';

const STORE_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'store.mjs'),
).href;

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-hub-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('creates dataDir recursively', (t) => {
  const dir = path.join(tmpDir(t), 'a', 'b', 'c');
  createStore({ dataDir: dir });
  assert.ok(fs.statSync(dir).isDirectory());
});

test('requires dataDir', () => {
  assert.throws(() => createStore({}), TypeError);
  assert.throws(() => createStore(), TypeError);
});

test('get returns fallback when missing and keeps it as the live value', (t) => {
  const store = createStore({ dataDir: tmpDir(t) });
  const fallback = [];
  const value = store.get('keys', fallback);
  assert.equal(value, fallback);
  value.push({ id: 1 });
  assert.deepEqual(store.get('keys', ['other']), [{ id: 1 }]);
});

test('set/flush/get round trip across store instances', async (t) => {
  const dir = tmpDir(t);
  const a = createStore({ dataDir: dir });
  const data = { list: [1, 2, 3], text: 'مرحبا', nested: { ok: true } };
  a.set('things', data);
  assert.equal(a.get('things'), data, 'set value is live immediately');
  await a.flush();

  const b = createStore({ dataDir: dir });
  assert.deepEqual(b.get('things', null), data);
  assert.equal(b.get('things'), b.get('things'), 'loaded once, same reference');
});

test('get loads only once from disk', async (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'cfg.json'), '{"v":1}');
  const store = createStore({ dataDir: dir });
  assert.deepEqual(store.get('cfg', {}), { v: 1 });
  fs.writeFileSync(path.join(dir, 'cfg.json'), '{"v":2}');
  assert.deepEqual(store.get('cfg', {}), { v: 1 });
});

test('write is debounced and atomic (no tmp files left, valid JSON)', async (t) => {
  const dir = tmpDir(t);
  const store = createStore({ dataDir: dir });
  const file = path.join(dir, 'state.json');

  store.set('state', { n: 1 });
  store.set('state', { n: 2 });
  assert.equal(fs.existsSync(file), false, 'nothing written synchronously');

  await store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 2 });
  assert.deepEqual(fs.readdirSync(dir), ['state.json'], 'tmp file renamed away');

  // Overwrite keeps the file valid and still leaves no tmp files.
  store.set('state', { n: 3 });
  await store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 3 });
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('debounced write happens without an explicit flush', async (t) => {
  const dir = tmpDir(t);
  const store = createStore({ dataDir: dir, debounceMs: 20 });
  store.set('auto', { a: 1 });
  const file = path.join(dir, 'auto.json');
  for (let i = 0; i < 100 && !fs.existsSync(file); i++) await sleep(20);
  await store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
});

test('flush resolves with nothing pending and handles several collections', async (t) => {
  const dir = tmpDir(t);
  const store = createStore({ dataDir: dir });
  await store.flush();
  store.set('one', 1);
  store.set('two', [2]);
  await Promise.all([store.flush(), store.flush()]);
  assert.equal(fs.readFileSync(path.join(dir, 'one.json'), 'utf8').trim(), '1');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'two.json'), 'utf8')), [2]);
});

test('flush rejects when a value cannot be serialised, and recovers later', async (t) => {
  const dir = tmpDir(t);
  const store = createStore({ dataDir: dir });
  const circular = {};
  circular.self = circular;
  store.set('bad', circular);
  await assert.rejects(store.flush());
  assert.deepEqual(fs.readdirSync(dir), [], 'no partial or tmp file');
  store.set('bad', { fixed: true });
  await store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'bad.json'), 'utf8')), { fixed: true });
});

test('corrupt file falls back and is preserved as .corrupt-<ts>', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'keys.json');
  fs.writeFileSync(file, '{"broken": ');
  const store = createStore({ dataDir: dir });

  const origError = console.error;
  console.error = () => {};
  t.after(() => { console.error = origError; });
  const value = store.get('keys', []);
  console.error = origError;

  assert.deepEqual(value, []);
  const kept = fs.readdirSync(dir).filter((f) => /^keys\.json\.corrupt-\d+/.test(f));
  assert.equal(kept.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, kept[0]), 'utf8'), '{"broken": ');
  assert.equal(fs.existsSync(file), false);

  // A later write produces a healthy file and leaves the corrupt copy alone.
  store.set('keys', [{ id: 'k1' }]);
  await store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [{ id: 'k1' }]);
  assert.ok(fs.existsSync(path.join(dir, kept[0])));
});

test('appendLine/readLines: order, limit, bad lines skipped', (t) => {
  const dir = tmpDir(t);
  const store = createStore({ dataDir: dir });
  assert.deepEqual(store.readLines('usage'), [], 'missing file -> empty');

  for (let i = 1; i <= 5; i++) store.appendLine('usage', { i });
  const file = path.join(dir, 'usage.jsonl');
  assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 5, 'written synchronously');

  fs.appendFileSync(file, 'not json\n\n{"half":\n42\nnull\n');
  store.appendLine('usage', { i: 6 });

  assert.deepEqual(store.readLines('usage').map((x) => x.i), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(store.readLines('usage', { limit: 2 }).map((x) => x.i), [5, 6]);
  assert.deepEqual(store.readLines('usage', { limit: 100 }).length, 6);
  assert.deepEqual(store.readLines('usage', { limit: 0 }), []);
});

test('appendLine repairs an unterminated last line left by a crash', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'log.jsonl'), '{"i":1}\n{"i":2');
  const store = createStore({ dataDir: dir });
  store.appendLine('log', { i: 3 });
  // The truncated line is lost, but the new one is not glued onto it.
  assert.deepEqual(store.readLines('log').map((x) => x.i), [1, 3]);
});

test('appendLine rejects non-objects', (t) => {
  const store = createStore({ dataDir: tmpDir(t) });
  assert.throws(() => store.appendLine('log', 'text'), TypeError);
  assert.throws(() => store.appendLine('log', null), TypeError);
  assert.throws(() => store.appendLine('log', undefined), TypeError);
});

test('jsonl rotates past the size limit and readLines still sees recent history', (t) => {
  const dir = tmpDir(t);
  const store = createStore({ dataDir: dir, maxLinesBytes: 200 });
  for (let i = 1; i <= 40; i++) store.appendLine('events', { i, pad: 'x'.repeat(20) });

  const files = fs.readdirSync(dir);
  const rotated = files.filter((f) => /^events\.\d+\.jsonl$/.test(f));
  assert.ok(rotated.length >= 2, 'rotated files exist');
  assert.ok(files.includes('events.jsonl'));
  for (const f of files) assert.ok(fs.statSync(path.join(dir, f)).size <= 200, `${f} within limit`);

  assert.deepEqual(store.readLines('events').map((x) => x.i), Array.from({ length: 40 }, (_, k) => k + 1));
  assert.deepEqual(store.readLines('events', { limit: 7 }).map((x) => x.i), [34, 35, 36, 37, 38, 39, 40]);

  // Rotation state survives a restart.
  const again = createStore({ dataDir: dir, maxLinesBytes: 200 });
  again.appendLine('events', { i: 41, pad: 'x'.repeat(20) });
  assert.equal(again.readLines('events', { limit: 1 })[0].i, 41);
});

test('invalid names throw on every method', (t) => {
  const store = createStore({ dataDir: tmpDir(t) });
  const bad = ['', 'Keys', 'a b', '../etc', 'a/b', 'a.b', 'a_b', 'عربي', null, undefined, 5, {}];
  for (const name of bad) {
    assert.throws(() => store.get(name, 1), TypeError, `get ${String(name)}`);
    assert.throws(() => store.set(name, 1), TypeError, `set ${String(name)}`);
    assert.throws(() => store.appendLine(name, {}), TypeError, `appendLine ${String(name)}`);
    assert.throws(() => store.readLines(name), TypeError, `readLines ${String(name)}`);
  }
  for (const name of ['keys', 'usage-2', '0', 'a-b-c']) {
    assert.doesNotThrow(() => store.get(name, null));
  }
});

test('set rejects undefined', (t) => {
  const store = createStore({ dataDir: tmpDir(t) });
  assert.throws(() => store.set('x', undefined), TypeError);
});

test('pending write timer does not keep the process alive', (t) => {
  const dir = tmpDir(t);
  const script = `
    import { createStore } from ${JSON.stringify(STORE_URL)};
    const store = createStore({ dataDir: ${JSON.stringify(dir)}, debounceMs: 30000 });
    store.set('pending', { a: 1 });
  `;
  const started = Date.now();
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 20000 });
  assert.equal(res.status, 0, String(res.stderr));
  assert.ok(Date.now() - started < 15000, 'child exited without waiting for the timer');
  assert.equal(fs.existsSync(path.join(dir, 'pending.json')), false);
});
