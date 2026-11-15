// Tiny file-backed store: JSON collections (debounced atomic writes) and
// append-only JSONL logs. Node built-ins only.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const NAME_RE = /^[a-z0-9-]+$/;
const DEFAULT_DEBOUNCE_MS = 200;
const DEFAULT_MAX_LINES_BYTES = 20 * 1024 * 1024; // rotate .jsonl beyond 20 MB
const RETRY_MS = 5000; // delay before retrying a failed background write
const STALE_TMP_MS = 60_000;
const TMP_RE = /^\.[a-z0-9-]+\.json\.\d+\.\d+\.tmp$/;

function assertName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new TypeError(`store: invalid collection name ${JSON.stringify(name)} (must match ${NAME_RE})`);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.dataDir            directory holding all files (created if missing)
 * @param {number} [opts.debounceMs]       write debounce, default 200 ms
 * @param {number} [opts.maxLinesBytes]    .jsonl rotation threshold, default 20 MB
 */
export function createStore({ dataDir, debounceMs = DEFAULT_DEBOUNCE_MS, maxLinesBytes = DEFAULT_MAX_LINES_BYTES } = {}) {
  if (typeof dataDir !== 'string' || dataDir === '') {
    throw new TypeError('store: dataDir is required');
  }
  const dir = path.resolve(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  removeStaleTmpFiles();

  const cache = new Map();     // name -> live value (presence means "loaded")
  const dirty = new Set();     // names with unwritten changes
  const lineSizes = new Map(); // name -> current byte size of <name>.jsonl
  let timer = null;
  let chain = Promise.resolve(); // serialises writes
  let tmpSeq = 0;

  const jsonPath = (name) => path.join(dir, `${name}.json`);
  const linesPath = (name) => path.join(dir, `${name}.jsonl`);

  function removeStaleTmpFiles() {
    try {
      const now = Date.now();
      for (const file of fs.readdirSync(dir)) {
        if (!TMP_RE.test(file)) continue;
        const full = path.join(dir, file);
        try {
          if (now - fs.statSync(full).mtimeMs > STALE_TMP_MS) fs.unlinkSync(full);
        } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }

  // Keep a corrupt file for inspection instead of deleting/overwriting it.
  function quarantine(file) {
    let target = `${file}.corrupt-${Date.now()}`;
    for (let i = 1; fs.existsSync(target); i++) target = `${file}.corrupt-${Date.now()}-${i}`;
    try {
      fs.renameSync(file, target);
    } catch {
      try { fs.copyFileSync(file, target); } catch (err) {
        console.error(`store: could not preserve corrupt file ${file}: ${err.message}`);
        return;
      }
    }
    console.error(`store: ${path.basename(file)} is corrupt, kept as ${path.basename(target)}`);
  }

  function load(name, fallback) {
    const file = jsonPath(name);
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`store: cannot read ${file}: ${err.message}`);
      return fallback;
    }
    try {
      return JSON.parse(raw);
    } catch {
      quarantine(file);
      return fallback;
    }
  }

  function get(name, fallback) {
    assertName(name);
    if (!cache.has(name)) cache.set(name, load(name, fallback));
    return cache.get(name);
  }

  function schedule(ms) {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush().catch((err) => console.error(`store: write failed: ${err.message}`));
    }, ms);
    timer.unref?.(); // never keep the process alive
  }

  function set(name, value) {
    assertName(name);
    if (value === undefined) throw new TypeError('store: value must not be undefined');
    cache.set(name, value);
    dirty.add(name);
    schedule(debounceMs);
  }

  async function writeAtomic(name, value) {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError(`store: collection "${name}" is not JSON-serialisable`);
    const tmp = path.join(dir, `.${name}.json.${process.pid}.${++tmpSeq}.tmp`);
    let fh;
    try {
      fh = await fsp.open(tmp, 'w', 0o600);
      await fh.writeFile(json + '\n', 'utf8');
      await fh.sync();
      await fh.close();
      fh = null;
      await fsp.rename(tmp, jsonPath(name));
    } catch (err) {
      if (fh) await fh.close().catch(() => {});
      await fsp.unlink(tmp).catch(() => {});
      throw err;
    }
    // Persist the rename itself; not supported on every platform.
    try {
      const dh = await fsp.open(dir, 'r');
      try { await dh.sync(); } finally { await dh.close(); }
    } catch { /* best effort */ }
  }

  async function writePending() {
    const names = [...dirty];
    dirty.clear();
    const errors = [];
    for (const name of names) {
      try {
        await writeAtomic(name, cache.get(name));
      } catch (err) {
        dirty.add(name); // keep it pending so it is retried
        errors.push(err);
      }
    }
    if (errors.length) {
      schedule(RETRY_MS);
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'store: several writes failed');
    }
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    const run = chain.then(writePending);
    chain = run.catch(() => {});
    return run;
  }

  function currentLinesSize(name, file) {
    if (lineSizes.has(name)) return lineSizes.get(name);
    let size = 0;
    try {
      size = fs.statSync(file).size;
      if (size > 0) {
        // Terminate a line left unfinished by a crash so the next one stays parseable.
        const fd = fs.openSync(file, 'r');
        const last = Buffer.alloc(1);
        try { fs.readSync(fd, last, 0, 1, size - 1); } finally { fs.closeSync(fd); }
        if (last[0] !== 0x0a) { fs.appendFileSync(file, '\n'); size += 1; }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    lineSizes.set(name, size);
    return size;
  }

  function rotate(name, file) {
    let ts = Date.now();
    let target = path.join(dir, `${name}.${ts}.jsonl`);
    while (fs.existsSync(target)) target = path.join(dir, `${name}.${++ts}.jsonl`);
    try {
      fs.renameSync(file, target);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    lineSizes.set(name, 0);
  }

  function appendLine(name, obj) {
    assertName(name);
    if (obj === null || typeof obj !== 'object') throw new TypeError('store: appendLine expects an object');
    const line = JSON.stringify(obj) + '\n';
    const bytes = Buffer.byteLength(line);
    const file = linesPath(name);
    let size = currentLinesSize(name, file);
    if (size > 0 && size + bytes > maxLinesBytes) {
      rotate(name, file);
      size = 0;
    }
    fs.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
    lineSizes.set(name, size + bytes);
  }

  // Rotated files of a collection, newest first.
  function rotatedFiles(name) {
    const re = new RegExp(`^${name}\\.(\\d+)\\.jsonl$`);
    let files;
    try { files = fs.readdirSync(dir); } catch { return []; }
    return files
      .map((f) => ({ f, m: re.exec(f) }))
      .filter((x) => x.m)
      .sort((a, b) => Number(b.m[1]) - Number(a.m[1]))
      .map((x) => path.join(dir, x.f));
  }

  // Collects valid lines of `file` from the end into `out` (newest first) until `limit`.
  function collectTail(file, out, limit) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`store: cannot read ${file}: ${err.message}`);
      return;
    }
    let end = raw.length;
    while (end > 0 && out.length < limit) {
      const start = raw.lastIndexOf('\n', end - 1) + 1;
      const text = raw.slice(start, end).trim();
      end = start - 1;
      if (!text) continue;
      try {
        const parsed = JSON.parse(text);
        if (parsed !== null && typeof parsed === 'object') out.push(parsed);
      } catch { /* skip bad line */ }
    }
  }

  function readLines(name, { limit = 10000 } = {}) {
    assertName(name);
    let max = Number(limit);
    if (Number.isNaN(max)) max = 10000;
    if (max <= 0) return [];
    const out = [];
    collectTail(linesPath(name), out, max);
    // Fall back to rotated files only when the live file holds fewer than `limit` lines.
    if (out.length < max) {
      for (const file of rotatedFiles(name)) {
        collectTail(file, out, max);
        if (out.length >= max) break;
      }
    }
    return out.reverse(); // oldest first, same order as written
  }

  return { get, set, appendLine, readLines, flush };
}
