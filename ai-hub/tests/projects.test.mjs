import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProjects } from '../src/projects.mjs';

const SHIPPED = fileURLToPath(new URL('../projects.json', import.meta.url));
const SHIPPED_IDS = ['general', 'tagit', 'operon', 'marginos', 'myai', 'dont-chaos'];

function withFile(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-hub-projects-'));
  const path = join(dir, 'projects.json');
  try {
    if (content !== undefined) {
      writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
    }
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SAMPLE = [
  {
    id: 'alpha',
    name: 'Alpha',
    nameAr: 'ألفا',
    description: 'Alpha project.',
    descriptionAr: 'مشروع ألفا.',
    systemPrompt: 'ALPHA EN',
    systemPromptAr: 'ALPHA AR',
  },
  {
    id: 'general',
    name: 'General',
    nameAr: 'عام',
    description: 'General.',
    descriptionAr: 'عام.',
    systemPrompt: 'GENERAL EN',
    systemPromptAr: 'GENERAL AR',
  },
  { id: 'en-only', name: 'English only', systemPrompt: 'ONLY EN' },
  { id: 'no-prompt', name: 'No prompt' },
];

test('list() hides prompts and puts general first', () => {
  withFile(SAMPLE, (projectsPath) => {
    const projects = createProjects({ config: { projectsPath } });
    const list = projects.list();
    assert.deepEqual(list.map((p) => p.id), ['general', 'alpha', 'en-only', 'no-prompt']);
    for (const p of list) {
      assert.deepEqual(Object.keys(p), ['id', 'name', 'nameAr', 'description', 'descriptionAr']);
      assert.equal('systemPrompt' in p, false);
      assert.equal('systemPromptAr' in p, false);
    }
    assert.deepEqual(list[1], {
      id: 'alpha',
      name: 'Alpha',
      nameAr: 'ألفا',
      description: 'Alpha project.',
      descriptionAr: 'مشروع ألفا.',
    });
  });
});

test('list() and get() return copies that cannot corrupt the registry', () => {
  withFile(SAMPLE, (projectsPath) => {
    const projects = createProjects({ config: { projectsPath } });
    projects.list()[0].name = 'changed';
    projects.get('alpha').systemPrompt = 'changed';
    assert.equal(projects.list()[0].name, 'General');
    assert.equal(projects.get('alpha').systemPrompt, 'ALPHA EN');
  });
});

test('get() returns the full project or null', () => {
  withFile(SAMPLE, (projectsPath) => {
    const projects = createProjects({ config: { projectsPath } });
    assert.deepEqual(projects.get('alpha'), SAMPLE[0]);
    assert.equal(projects.get('general').systemPrompt, 'GENERAL EN');
    assert.equal(projects.get('missing'), null);
    assert.equal(projects.get(undefined), null);
    assert.equal(projects.get(42), null);
    assert.equal(projects.get('__proto__'), null);
  });
});

test('systemPrompt() picks the language and falls back to general', () => {
  withFile(SAMPLE, (projectsPath) => {
    const projects = createProjects({ config: { projectsPath } });
    assert.equal(projects.systemPrompt('alpha', 'en'), 'ALPHA EN');
    assert.equal(projects.systemPrompt('alpha', 'ar'), 'ALPHA AR');
    // Unknown language and omitted language mean English.
    assert.equal(projects.systemPrompt('alpha', 'fr'), 'ALPHA EN');
    assert.equal(projects.systemPrompt('alpha'), 'ALPHA EN');
    // Unknown project falls back to general in the requested language.
    assert.equal(projects.systemPrompt('missing', 'en'), 'GENERAL EN');
    assert.equal(projects.systemPrompt('missing', 'ar'), 'GENERAL AR');
    assert.equal(projects.systemPrompt(undefined, 'ar'), 'GENERAL AR');
    // Project without an Arabic prompt keeps its own English prompt.
    assert.equal(projects.systemPrompt('en-only', 'ar'), 'ONLY EN');
    // Project without any prompt falls back to general.
    assert.equal(projects.systemPrompt('no-prompt', 'en'), 'GENERAL EN');
    assert.equal(projects.systemPrompt('no-prompt', 'ar'), 'GENERAL AR');
  });
});

test('general is added when the file does not define it', () => {
  withFile([SAMPLE[0]], (projectsPath) => {
    const projects = createProjects({ config: { projectsPath } });
    assert.deepEqual(projects.list().map((p) => p.id), ['general', 'alpha']);
    assert.ok(projects.get('general').systemPrompt.length > 0);
    assert.equal(projects.systemPrompt('missing', 'en'), projects.get('general').systemPrompt);
    assert.equal(projects.systemPrompt('missing', 'ar'), projects.get('general').systemPromptAr);
  });
});

test('invalid and duplicate entries are skipped', () => {
  const entries = [
    null,
    'text',
    { name: 'no id' },
    { id: 'Bad Id!' },
    SAMPLE[0],
    { id: 'alpha', name: 'Duplicate', systemPrompt: 'DUP' },
  ];
  withFile(entries, (projectsPath) => {
    const projects = createProjects({ config: { projectsPath } });
    assert.deepEqual(projects.list().map((p) => p.id), ['general', 'alpha']);
    assert.equal(projects.get('alpha').name, 'Alpha');
  });
});

test('broken, non-array or missing file falls back to built-in general only', () => {
  const check = (projectsPath) => {
    const projects = createProjects({ config: { projectsPath } });
    const list = projects.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'general');
    const general = projects.get('general');
    assert.ok(general.systemPrompt.length > 0);
    assert.ok(general.systemPromptAr.length > 0);
    assert.equal(projects.systemPrompt('tagit', 'en'), general.systemPrompt);
    assert.equal(projects.systemPrompt('tagit', 'ar'), general.systemPromptAr);
    assert.equal(projects.get('tagit'), null);
  };
  withFile('{ this is not json', check);
  withFile('{"unexpected":"shape"}', check);
  withFile('', check);
  withFile(undefined, check); // file never created
});

test('shipped projects.json parses and contains the six projects', () => {
  const raw = JSON.parse(readFileSync(SHIPPED, 'utf8'));
  assert.ok(Array.isArray(raw));
  assert.deepEqual(raw.map((p) => p.id), SHIPPED_IDS);

  const fields = ['id', 'name', 'nameAr', 'description', 'descriptionAr', 'systemPrompt', 'systemPromptAr'];
  for (const p of raw) {
    for (const f of fields) {
      assert.equal(typeof p[f], 'string', `${p.id}.${f} must be a string`);
      assert.ok(p[f].trim().length > 0, `${p.id}.${f} must not be empty`);
    }
    for (const f of ['systemPrompt', 'systemPromptAr']) {
      const lines = p[f].split('\n').length;
      assert.ok(lines >= 5 && lines <= 9, `${p.id}.${f} has ${lines} lines, expected 5-9`);
    }
    // Arabic fields must actually contain Arabic script.
    for (const f of ['nameAr', 'descriptionAr', 'systemPromptAr']) {
      assert.match(p[f], /[؀-ۿ]/, `${p.id}.${f} must contain Arabic text`);
    }
  }

  const projects = createProjects({ config: { projectsPath: SHIPPED } });
  assert.deepEqual(projects.list().map((p) => p.id), SHIPPED_IDS);
  for (const id of SHIPPED_IDS) {
    const full = projects.get(id);
    assert.equal(projects.systemPrompt(id, 'en'), full.systemPrompt);
    assert.equal(projects.systemPrompt(id, 'ar'), full.systemPromptAr);
  }
});

test('shipped tagit prompt keeps the research-only guardrails', () => {
  const projects = createProjects({ config: { projectsPath: SHIPPED } });
  const en = projects.systemPrompt('tagit', 'en');
  assert.match(en, /research framing only/i);
  assert.match(en, /never give a buy or sell recommendation/i);
  assert.match(en, /never guarantee, promise or imply a profit/i);
  assert.match(en, /never invent prices, news or filings/i);
  const ar = projects.systemPrompt('tagit', 'ar');
  assert.match(ar, /بحثي فقط/);
  assert.match(ar, /توصية بالشراء أو البيع/);
  assert.match(ar, /لا تضمن ربحًا/);
  assert.match(ar, /لا تختلق أسعارًا أو أخبارًا أو إفصاحات/);
});

test('defaults to the shipped projects.json when config has no projectsPath', () => {
  const projects = createProjects({ config: {} });
  assert.deepEqual(projects.list().map((p) => p.id), SHIPPED_IDS);
});
