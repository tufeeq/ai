import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKnowledge, tokenize } from '../src/knowledge.mjs';

let dir;
let indexPath;

const CHUNKS = [
  {
    id: 'tagit-1',
    project: 'tagit',
    source: 'tag/README.md',
    title: 'Momentum scanner',
    text: 'The scanner ranks stocks by relative volume and momentum during the premarket session.',
  },
  {
    id: 'tagit-2',
    project: 'tagit',
    source: 'tag/docs/ar.md',
    title: 'تحليل الأسهم',
    text: 'يعرض النظام قراءة السيولة والزخم لكل سهم، مع ملخص عن الاستثمار والمخاطر.',
  },
  {
    id: 'operon-1',
    project: 'operon',
    source: 'operon/README.md',
    title: 'Workflow engine',
    text: 'Operon schedules workflow tasks and tracks momentum of every operations team.',
  },
  {
    id: 'general-1',
    project: 'general',
    source: 'docs/hub.md',
    title: 'Gateway overview',
    text: 'The gateway exposes an OpenAI compatible endpoint so projects stop paying per token. Momentum of adoption matters.',
  },
  {
    id: 'general-2',
    project: 'general',
    source: 'docs/hub-ar.md',
    title: 'مُقَدِّمَة',
    text: 'المنصّة تخدم جميع المشاريع عبر بوابة واحدة، وتدعم اللغة العربية والإنجليزية.',
  },
];

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-hub-knowledge-'));
  indexPath = join(dir, 'index.json');
  writeFileSync(indexPath, JSON.stringify({ builtAt: '2026-01-01T00:00:00.000Z', chunks: CHUNKS }));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const load = (path = indexPath) => createKnowledge({ config: { knowledgePath: path } });

test('tokenize: lowercases, splits on non letters/digits, drops short tokens and stop words', () => {
  assert.deepEqual(tokenize('The Quick-Brown fox, v2 & a GPT4!'), ['quick', 'brown', 'fox', 'v2', 'gpt4']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
});

test('tokenize: Arabic normalisation', () => {
  // tashkeel + tatweel stripped
  assert.deepEqual(tokenize('مُقَدِّمَة'), tokenize('مقدمه'));
  assert.deepEqual(tokenize('الاســـتثمار'), ['الاستثمار']);
  // alef variants unified
  assert.deepEqual(tokenize('الإستثمار'), ['الاستثمار']);
  assert.deepEqual(tokenize('أسهم آمنة'), ['اسهم', 'امنه']);
  // alef maqsura → ya, ta marbuta → ha
  assert.deepEqual(tokenize('مستشفى'), ['مستشفي']);
  assert.deepEqual(tokenize('السيولة'), ['السيوله']);
  // Arabic stop words dropped (including ones that need normalising)
  assert.deepEqual(tokenize('ما هي السيولة في السوق؟ و إلى أين'), ['السيوله', 'السوق']);
});

test('search: English query returns ranked, well-shaped results', async () => {
  const kb = await load();
  const hits = kb.search('premarket relative volume');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].source, 'tag/README.md');
  assert.deepEqual(Object.keys(hits[0]).sort(), ['project', 'score', 'source', 'text', 'title']);
  assert.equal(hits[0].project, 'tagit');
  assert.equal(hits[0].title, 'Momentum scanner');
  assert.equal(hits[0].text, CHUNKS[0].text);
  for (let i = 0; i < hits.length; i++) {
    assert.ok(hits[i].score > 0);
    if (i > 0) assert.ok(hits[i - 1].score >= hits[i].score);
  }
});

test('search: case-insensitive and title is indexed with a boost', async () => {
  const kb = await load();
  // "momentum" is in the body of three chunks but in the title of only one.
  const hits = kb.search('MOMENTUM');
  assert.equal(hits.length, 3);
  assert.equal(hits[0].title, 'Momentum scanner');
  // Title-only term still matches.
  const titleOnly = kb.search('overview');
  assert.equal(titleOnly.length, 1);
  assert.equal(titleOnly[0].source, 'docs/hub.md');
});

test('search: Arabic query', async () => {
  const kb = await load();
  const hits = kb.search('قراءة السيولة والزخم');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].source, 'tag/docs/ar.md');
});

test('search: Arabic normalisation matches spelling variants', async () => {
  const kb = await load();
  // hamza-under-alef variant matches the bare-alef form in the text
  const a = kb.search('الإستثمار');
  assert.equal(a.length, 1);
  assert.equal(a[0].source, 'tag/docs/ar.md');
  // fully vocalised query matches unvocalised text
  const b = kb.search('السُّيُولَة');
  assert.equal(b.length, 1);
  assert.equal(b[0].source, 'tag/docs/ar.md');
  // unvocalised query matches vocalised title; ta marbuta vs ha
  const c = kb.search('مقدمه');
  assert.equal(c.length, 1);
  assert.equal(c[0].source, 'docs/hub-ar.md');
  // shadda in the text ("المنصّة") vs plain query
  const d = kb.search('المنصة');
  assert.equal(d.length, 1);
  assert.equal(d[0].source, 'docs/hub-ar.md');
});

test('search: project filter keeps that project plus general', async () => {
  const kb = await load();
  const all = kb.search('momentum', { k: 10 });
  assert.deepEqual(all.map((h) => h.project).sort(), ['general', 'operon', 'tagit']);

  const tagit = kb.search('momentum', { project: 'tagit', k: 10 });
  assert.deepEqual(tagit.map((h) => h.project).sort(), ['general', 'tagit']);

  const operon = kb.search('momentum', { project: 'operon', k: 10 });
  assert.deepEqual(operon.map((h) => h.project).sort(), ['general', 'operon']);

  const general = kb.search('momentum', { project: 'general', k: 10 });
  assert.deepEqual(general.map((h) => h.project), ['general']);

  // Unknown project still sees general chunks only.
  const unknown = kb.search('momentum', { project: 'nope', k: 10 });
  assert.deepEqual(unknown.map((h) => h.project), ['general']);

  // A term that exists only in another project is filtered out entirely.
  assert.deepEqual(kb.search('workflow', { project: 'tagit' }), []);
});

test('search: k limit and default', async () => {
  const kb = await load();
  assert.equal(kb.search('momentum', { k: 1 }).length, 1);
  assert.equal(kb.search('momentum', { k: 2 }).length, 2);
  assert.equal(kb.search('momentum', { k: 0 }).length, 0);
  assert.equal(kb.search('momentum').length, 3);
  // Top-1 equals the head of the full ranking.
  assert.equal(kb.search('momentum', { k: 1 })[0].source, kb.search('momentum')[0].source);
});

test('search: empty / stop-word-only / unmatched queries return []', async () => {
  const kb = await load();
  assert.deepEqual(kb.search(''), []);
  assert.deepEqual(kb.search('   '), []);
  assert.deepEqual(kb.search('the of and'), []);
  assert.deepEqual(kb.search('?!'), []);
  assert.deepEqual(kb.search('zzzunknownterm'), []);
  assert.deepEqual(kb.search(undefined), []);
  assert.deepEqual(kb.search(null), []);
});

test('search: repeated queries are stable (no state leaks between calls)', async () => {
  const kb = await load();
  const first = kb.search('momentum scanner gateway', { k: 10 });
  kb.search('workflow', { project: 'operon' });
  const second = kb.search('momentum scanner gateway', { k: 10 });
  assert.deepEqual(second, first);
});

test('stats: counts, builtAt and per-project totals', async () => {
  const kb = await load();
  assert.deepEqual(kb.stats(), {
    chunks: 5,
    builtAt: '2026-01-01T00:00:00.000Z',
    projects: { tagit: 2, operon: 1, general: 2 },
  });
});

test('missing file yields an empty index', async () => {
  const kb = await load(join(dir, 'does-not-exist.json'));
  assert.deepEqual(kb.stats(), { chunks: 0, builtAt: null, projects: {} });
  assert.deepEqual(kb.search('momentum'), []);
});

test('invalid or malformed files yield an empty index', async () => {
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.deepEqual((await load(bad)).stats(), { chunks: 0, builtAt: null, projects: {} });

  const wrongShape = join(dir, 'shape.json');
  writeFileSync(wrongShape, JSON.stringify({ builtAt: 'x', chunks: 'nope' }));
  assert.equal((await load(wrongShape)).stats().chunks, 0);

  const arr = join(dir, 'arr.json');
  writeFileSync(arr, '[]');
  assert.equal((await load(arr)).stats().chunks, 0);

  // Missing config path must not crash either.
  const none = await createKnowledge({ config: {} });
  assert.deepEqual(none.search('anything'), []);
});

test('bad chunk entries are skipped, missing project defaults to general', async () => {
  const p = join(dir, 'mixed.json');
  writeFileSync(
    p,
    JSON.stringify({
      builtAt: '2026-02-02T00:00:00.000Z',
      chunks: [
        null,
        42,
        { id: 'x', project: 'tagit' },
        { id: 'y', source: 's.md', title: 'Orphan', text: 'orphan chunk without project' },
        { id: 'z', project: 'tagit', source: 't.md', title: 'Ok', text: 'valid chunk' },
      ],
    }),
  );
  const kb = await load(p);
  assert.deepEqual(kb.stats().projects, { general: 1, tagit: 1 });
  const hits = kb.search('orphan', { project: 'tagit' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].project, 'general');
});

test('performance: ~5000 chunks, search stays well under 20 ms', async () => {
  const words = [
    'gateway', 'token', 'model', 'stream', 'liquidity', 'momentum', 'volume', 'workflow',
    'schedule', 'invoice', 'margin', 'السيولة', 'الاستثمار', 'السوق', 'المشروع', 'التحليل',
    'report', 'dashboard', 'key', 'usage', 'project', 'knowledge', 'search', 'index',
  ];
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const projects = ['general', 'tagit', 'operon', 'marginos', 'myai'];
  const chunks = [];
  for (let i = 0; i < 5000; i++) {
    const parts = [];
    for (let j = 0; j < 120; j++) parts.push(words[Math.floor(rnd() * words.length)] + (rnd() < 0.3 ? i % 50 : ''));
    chunks.push({
      id: `c${i}`,
      project: projects[i % projects.length],
      source: `doc-${i}.md`,
      title: `Section ${i} ${words[i % words.length]}`,
      text: parts.join(' '),
    });
  }
  const p = join(dir, 'big.json');
  writeFileSync(p, JSON.stringify({ builtAt: 'now', chunks }));
  const kb = await load(p);
  assert.equal(kb.stats().chunks, 5000);

  const queries = ['liquidity momentum volume', 'تحليل السيولة في السوق', 'gateway token usage dashboard', 'الإستثمار'];
  for (const q of queries) kb.search(q, { project: 'tagit' }); // warm-up
  const runs = 40;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) {
    const hits = kb.search(queries[i % queries.length], { project: i % 2 ? 'tagit' : undefined, k: 5 });
    assert.ok(hits.length > 0 && hits.length <= 5);
  }
  const avg = (performance.now() - t0) / runs;
  assert.ok(avg < 20, `average search took ${avg.toFixed(2)} ms`);
});
