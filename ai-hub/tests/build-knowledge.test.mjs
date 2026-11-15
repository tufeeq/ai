import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROJECTS,
  LIMITS,
  mapProject,
  isExcludedPath,
  filePriority,
  chunkMarkdown,
  containsSecret,
  listSources,
  buildIndex,
  serializeIndex,
  main,
} from '../knowledge/build-knowledge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(HERE, '..', 'knowledge', 'index.json');

const para = (seed, n) => Array.from({ length: n }, (_, i) => `${seed} sentence number ${i} about the product.`).join(' ');

function makeRepo(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hub-knowledge-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

// ---------------------------------------------------------------- mapProject

test('mapProject maps every TAG folder to tagit', () => {
  for (const dir of ['tag', 'tag10', 'tagit', 'tagit-lab', 'tagit-next', 'tagit10', 'tagx', 'tagx2']) {
    assert.equal(mapProject(`${dir}/README.md`), 'tagit', dir);
  }
  assert.equal(mapProject('tagx/github-intelligence/sweep.md'), 'tagit');
  assert.equal(mapProject('tagit-lab/docs/guide.md'), 'tagit');
});

test('mapProject maps the other projects and the root README', () => {
  assert.equal(mapProject('operon/VALIDATION.md'), 'operon');
  assert.equal(mapProject('marginos/PRODUCT.md'), 'marginos');
  assert.equal(mapProject('dont-chaos/README.md'), 'dont-chaos');
  assert.equal(mapProject('README.md'), 'myai');
  assert.equal(mapProject('./README.md'), 'myai');
  assert.equal(mapProject('ai-hub/README.md'), 'general');
  assert.equal(mapProject('ai-hub/DEPLOY.md'), 'general');
  assert.equal(mapProject('operon\\README.md'), 'operon');
});

test('mapProject rejects files that must not be indexed', () => {
  assert.equal(mapProject('ai-hub/SPEC.md'), null);
  assert.equal(mapProject('ai-hub/clients/README.md'), null);
  assert.equal(mapProject('NOTES.md'), null);
  assert.equal(mapProject('unknown/README.md'), null);
  assert.equal(mapProject('tag/app.js'), null);
  assert.equal(mapProject('tag/data/devlog/2026.md'), null);
  assert.equal(mapProject('tagit-next/reports/audit.md'), null);
  assert.equal(mapProject('tagx/trade-audits/x.md'), null);
  assert.equal(mapProject('tagit10/history/explosive/x.md'), null);
  assert.equal(mapProject('tagit-lab/results/summary.md'), null);
  assert.equal(mapProject('operon/node_modules/pkg/README.md'), null);
  assert.equal(mapProject('operon/.git/README.md'), null);
  assert.equal(mapProject('tag/devlog.md'), null);
  assert.equal(mapProject(''), null);
});

test('every mapped project is a known project id', () => {
  const samples = ['README.md', 'tag/README.md', 'operon/README.md', 'marginos/README.md', 'dont-chaos/README.md', 'ai-hub/README.md'];
  for (const s of samples) assert.ok(PROJECTS.includes(mapProject(s)), s);
});

test('isExcludedPath and filePriority', () => {
  assert.equal(isExcludedPath('tag/model/audits/a.md'), true);
  assert.equal(isExcludedPath('tag/research/notes.md'), false);
  assert.equal(isExcludedPath('tagit-next/AGENTS-BRIEF.md'), false);
  assert.ok(filePriority('operon/README.md') < filePriority('operon/PRODUCT.md'));
  assert.ok(filePriority('operon/PRODUCT.md') < filePriority('tagit-next/AGENTS-BRIEF.md'));
  assert.ok(filePriority('tagit-next/AGENTS-BRIEF.md') < filePriority('tagx/github-intelligence/x.md'));
});

// -------------------------------------------------------------- chunkMarkdown

test('chunkMarkdown splits by heading and builds "<file title> › <heading>" titles', () => {
  const md = [
    '# My Product',
    '',
    para('Intro', 3),
    '',
    '## Install **now**',
    '',
    para('Install', 3),
    '',
    'Setup Guide',
    '===========',
    '',
    para('Setext', 3),
  ].join('\n');
  const chunks = chunkMarkdown(md);
  assert.deepEqual(
    chunks.map((c) => c.title),
    ['My Product', 'My Product › Install now', 'My Product › Setup Guide'],
  );
  assert.ok(chunks[0].text.startsWith('Intro sentence number 0'));
  assert.ok(!chunks[1].text.includes('#'));
});

test('chunkMarkdown keeps chunks near 900 chars and never cuts a word', () => {
  const words = new Set();
  const paragraphs = [];
  for (let p = 0; p < 12; p++) {
    const ws = Array.from({ length: 60 }, (_, i) => `word${p}x${i}`);
    ws.forEach((w) => words.add(w));
    paragraphs.push(ws.join(' '));
  }
  const oneHugeLine = Array.from({ length: 500 }, (_, i) => `tok${i}`);
  oneHugeLine.forEach((w) => words.add(w));
  const md = `# Doc\n\n${paragraphs.join('\n\n')}\n\n${oneHugeLine.join(' ')}\n`;
  const chunks = chunkMarkdown(md);
  assert.ok(chunks.length > 5);
  for (const c of chunks) {
    assert.ok(c.text.length <= LIMITS.maxChunkChars + LIMITS.minChunkChars, `too long: ${c.text.length}`);
    assert.ok(c.text.length >= LIMITS.minChunkChars, `too short: ${c.text.length}`);
    for (const token of c.text.split(/\s+/)) assert.ok(words.has(token), `cut word: ${token}`);
  }
  // Nothing lost, order preserved.
  assert.deepEqual(chunks.flatMap((c) => c.text.split(/\s+/)), [...paragraphs.flatMap((p) => p.split(' ')), ...oneHugeLine]);
});

test('chunkMarkdown strips long code fences, comments and images, keeps short code', () => {
  const longCode = Array.from({ length: 45 }, (_, i) => `const longLine${i} = ${i};`).join('\n');
  const md = [
    '# Title',
    '',
    '<!-- hidden',
    'comment SECRET_NOTE -->',
    para('Visible', 3),
    '![diagram](img/arch.png) <img src="x.png" alt="x"> [![badge](b.svg)](https://ci.example)',
    '',
    '```js',
    longCode,
    '```',
    '',
    '```bash',
    '# not a heading',
    'npm   start',
    '```',
    '',
    para('After', 3),
  ].join('\n');
  const chunks = chunkMarkdown(md);
  const all = chunks.map((c) => c.text).join('\n');
  assert.ok(!all.includes('SECRET_NOTE'));
  assert.ok(!all.includes('longLine'));
  assert.ok(!all.includes('arch.png') && !all.includes('<img') && !all.includes('b.svg'));
  assert.ok(!all.includes('```'));
  assert.ok(all.includes('npm start'));
  assert.ok(all.includes('# not a heading'));
  assert.ok(all.includes('After sentence number 2'));
  assert.ok(chunks.every((c) => c.title === 'Title'));
});

test('chunkMarkdown collapses whitespace and drops table rules', () => {
  const md = `# T\n\n| a   |   b |\n|-----|:---:|\n| ${'x'.repeat(50)} |   ${'y'.repeat(50)} |\n\n\n\nline   with\t\ttabs and    spaces ${'z'.repeat(40)}\n`;
  const [chunk] = chunkMarkdown(md);
  assert.ok(!/[ \t]{2,}/.test(chunk.text));
  assert.ok(!/\n{2,}/.test(chunk.text));
  assert.ok(!chunk.text.includes('---'));
  assert.ok(chunk.text.includes('| a | b |'));
});

test('chunkMarkdown never emits chunks under 80 chars; short sections move forward', () => {
  assert.deepEqual(chunkMarkdown('# Tiny\n\nToo short.\n'), []);
  assert.deepEqual(chunkMarkdown(''), []);
  const md = `# Doc\n\n## Run\n\nnpm start\n\n## Details\n\n${para('Details', 3)}\n`;
  const chunks = chunkMarkdown(md);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].title, 'Doc › Details');
  assert.ok(chunks[0].text.startsWith('Run: npm start'));
  for (const c of chunks) assert.ok(c.text.length >= 80);
});

test('chunkMarkdown preserves Arabic text and is deterministic', () => {
  const sentence = 'هذا المحرك يجيب عن سؤال واحد قبل أي تطوير آخر، ويعمل بالكامل على مصادر مجانية.';
  const md = `# مختبر الإشارات\n\n## التشغيل\n\n${Array(30).fill(sentence).join(' ')}\n`;
  const a = chunkMarkdown(md);
  const b = chunkMarkdown(md);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 2);
  assert.equal(a[0].title, 'مختبر الإشارات › التشغيل');
  const arabicWords = new Set(sentence.split(' '));
  for (const c of a) for (const w of c.text.split(/\s+/)) assert.ok(arabicWords.has(w), `cut word: ${w}`);
});

test('chunkMarkdown uses fileTitle fallback and maxChunks', () => {
  const md = `${para('No heading', 4)}\n\n## A\n\n${para('A', 4)}\n\n## B\n\n${para('B', 4)}\n`;
  const chunks = chunkMarkdown(md, { fileTitle: 'notes' });
  assert.deepEqual(chunks.map((c) => c.title), ['notes', 'notes › A', 'notes › B']);
  assert.equal(chunkMarkdown(md, { maxChunks: 2 }).length, 2);
});

// ------------------------------------------------------------------- secrets

test('containsSecret flags credential shapes but not ordinary prose', () => {
  assert.equal(containsSecret(`key sk-${'a1B2'.repeat(8)}`), true);
  assert.equal(containsSecret(`token ghp_${'a1B2'.repeat(9)}`), true);
  assert.equal(containsSecret(`Authorization: Bearer ${'abc123XYZ'.repeat(4)}`), true);
  assert.equal(containsSecret('-----BEGIN RSA PRIVATE KEY-----'), true);
  assert.equal(containsSecret('Measure task-completion interaction count'), false);
  assert.equal(containsSecret('risk-on/off from SPY'), false);
  assert.equal(containsSecret('Send Authorization: Bearer <key> or Bearer $AI_HUB_KEY'), false);
  assert.equal(containsSecret('set ALPACA_API_KEY_ID in the environment'), false);
});

// ---------------------------------------------------------------- buildIndex

test('buildIndex walks a repo, applies exclusions, stable ids and ordering', () => {
  const fakeKey = `sk-${'z9Y8'.repeat(8)}`;
  const root = makeRepo({
    'README.md': `# MyAI\n\n${para('Root', 4)}\n`,
    'NOTES.md': `# Notes\n\n${para('Notes', 4)}\n`,
    'operon/README.md': `# Operon\n\n${para('Operon', 4)}\n\n## Keys\n\n${para('Leak', 3)} ${fakeKey}\n`,
    'operon/data/dump.md': `# Dump\n\n${para('Dump', 4)}\n`,
    'operon/node_modules/x/README.md': `# X\n\n${para('X', 4)}\n`,
    'tag/README.md': `# Tag\n\n${para('Tag', 4)}\n`,
    'tagx2/docs/guide.md': `# Guide\n\n${para('Guide', 4)}\n`,
    'tagit/reports/r.md': `# R\n\n${para('R', 4)}\n`,
    'marginos/BIG.md': `# Big\n\n${'word '.repeat(70000)}\n`,
    'ai-hub/SPEC.md': `# Spec\n\n${para('Spec', 4)}\n`,
    'ai-hub/README.md': `# AI Hub\n\n${para('Hub', 4)}\n`,
    'other/README.md': `# Other\n\n${para('Other', 4)}\n`,
  });
  try {
    assert.deepEqual(listSources(root), [
      'README.md',
      'ai-hub/README.md',
      'marginos/BIG.md',
      'operon/README.md',
      'tag/README.md',
      'tagx2/docs/guide.md',
    ]);
    const { index, report } = buildIndex({ root, builtAt: '2026-01-01T00:00:00.000Z' });
    assert.equal(index.builtAt, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(
      [...new Set(index.chunks.map((c) => c.source))],
      ['ai-hub/README.md', 'tag/README.md', 'tagx2/docs/guide.md', 'operon/README.md', 'README.md'],
    );
    assert.equal(index.chunks[0].id, 'general:ai-hub/README.md#1');
    assert.ok(index.chunks.some((c) => c.id === 'operon:operon/README.md#1'));
    assert.ok(!JSON.stringify(index).includes(fakeKey));
    assert.deepEqual(report.secretChunks, ['operon:operon/README.md#2']);
    assert.ok(report.skipped.some((s) => s.source === 'marginos/BIG.md'));
    assert.equal(new Set(index.chunks.map((c) => c.id)).size, index.chunks.length);

    // Deterministic for a fixed builtAt.
    const again = buildIndex({ root, builtAt: '2026-01-01T00:00:00.000Z' });
    assert.equal(serializeIndex(again.index), serializeIndex(index));
    assert.deepEqual(JSON.parse(serializeIndex(index)), index);

    // Size cap drops the least important file first and reports it.
    const capped = buildIndex({ root, builtAt: 'x', limits: { maxIndexBytes: 900 } });
    assert.ok(capped.report.bytes <= 900);
    assert.equal(capped.report.dropped[0].source, 'tagx2/docs/guide.md');

    // Per-file chunk cap.
    const few = buildIndex({ root, builtAt: 'x', limits: { maxChunksPerFile: 1, maxChunkChars: 120 } });
    assert.ok(few.report.truncated.length > 0);
    assert.ok(few.report.files.every((f) => f.chunks <= 1));

    // CLI entry writes the file without touching anything else.
    const out = path.join(root, 'out', 'index.json');
    const lines = [];
    main(['--root', root, '--out', out], (l) => lines.push(l));
    const written = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(written.chunks.length, index.chunks.length);
    assert.ok(lines.some((l) => /chunks:/.test(l)));
    assert.ok(!lines.join('\n').includes(fakeKey));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------- shipped file

test('shipped knowledge/index.json parses and every chunk has the five fields', () => {
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  assert.equal(typeof index.builtAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(index.builtAt)));
  assert.ok(Array.isArray(index.chunks) && index.chunks.length > 0);
  const ids = new Set();
  for (const chunk of index.chunks) {
    assert.deepEqual(Object.keys(chunk), ['id', 'project', 'source', 'title', 'text']);
    for (const field of ['id', 'project', 'source', 'title', 'text']) {
      assert.equal(typeof chunk[field], 'string', `${chunk.id}.${field}`);
      assert.ok(chunk[field].length > 0, `${chunk.id}.${field} empty`);
    }
    assert.ok(PROJECTS.includes(chunk.project), chunk.project);
    assert.equal(mapProject(chunk.source), chunk.project, chunk.source);
    assert.match(chunk.id, new RegExp(`^${chunk.project}:.+#\\d+$`));
    assert.ok(chunk.id.startsWith(`${chunk.project}:${chunk.source}#`));
    assert.ok(chunk.text.length >= LIMITS.minChunkChars);
    assert.ok(!containsSecret(chunk.text), `secret-like text in ${chunk.id}`);
    assert.ok(!chunk.text.includes('�'), `broken UTF-8 in ${chunk.id}`);
    assert.ok(!ids.has(chunk.id), `duplicate id ${chunk.id}`);
    ids.add(chunk.id);
  }
  assert.ok(Buffer.byteLength(readFileSync(INDEX_PATH)) < LIMITS.maxIndexBytes);
  assert.ok(index.chunks.some((c) => /[؀-ۿ]/.test(c.text)), 'expected Arabic text to be preserved');
});
