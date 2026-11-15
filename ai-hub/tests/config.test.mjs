import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loadConfig returns the documented defaults', () => {
  const c = loadConfig({});
  assert.equal(c.port, 8080);
  assert.equal(c.dataDir, './data');
  assert.equal(c.ollamaUrl, 'http://ollama:11434');
  assert.equal(c.model, 'gemma3:4b');
  assert.equal(c.numCtx, 4096);
  assert.equal(c.llmTimeoutMs, 180000);
  assert.equal(c.adminKey, '');
  assert.equal(c.rateLimitRpm, 60);
  assert.equal(c.maxBodyBytes, 1000000);
  assert.equal(c.refPriceInPerM, 2.5);
  assert.equal(c.refPriceOutPerM, 10);
  assert.equal(c.knowledgePath, path.join(ROOT, 'knowledge', 'index.json'));
  assert.equal(c.projectsPath, path.join(ROOT, 'projects.json'));
  assert.equal(c.publicDir, path.join(ROOT, 'public'));
  assert.equal(c.autoPullModel, true);
});

test('loadConfig exposes exactly the contract fields', () => {
  assert.deepEqual(Object.keys(loadConfig({})).sort(), [
    'adminKey', 'autoPullModel', 'dataDir', 'knowledgePath', 'llmTimeoutMs', 'maxBodyBytes',
    'model', 'numCtx', 'ollamaUrl', 'port', 'projectsPath', 'publicDir', 'rateLimitRpm',
    'refPriceInPerM', 'refPriceOutPerM', 'version',
  ]);
});

test('loadConfig reads every env override', () => {
  const c = loadConfig({
    PORT: '9090',
    DATA_DIR: '/var/hub',
    OLLAMA_URL: 'http://127.0.0.1:11434/',
    AI_MODEL: 'llama3.2:3b',
    AI_NUM_CTX: '8192',
    LLM_TIMEOUT_MS: '5000',
    ADMIN_KEY: '  secret-admin  ',
    RATE_LIMIT_RPM: '5',
    MAX_BODY_BYTES: '2048',
    REF_PRICE_IN_PER_M: '0.15',
    REF_PRICE_OUT_PER_M: '0.6',
    KNOWLEDGE_PATH: '/tmp/k.json',
    PROJECTS_PATH: '/tmp/p.json',
    AUTO_PULL_MODEL: 'false',
  });
  assert.equal(c.port, 9090);
  assert.equal(c.dataDir, '/var/hub');
  assert.equal(c.ollamaUrl, 'http://127.0.0.1:11434'); // trailing slash removed
  assert.equal(c.model, 'llama3.2:3b');
  assert.equal(c.numCtx, 8192);
  assert.equal(c.llmTimeoutMs, 5000);
  assert.equal(c.adminKey, 'secret-admin');
  assert.equal(c.rateLimitRpm, 5);
  assert.equal(c.maxBodyBytes, 2048);
  assert.equal(c.refPriceInPerM, 0.15);
  assert.equal(c.refPriceOutPerM, 0.6);
  assert.equal(c.knowledgePath, '/tmp/k.json');
  assert.equal(c.projectsPath, '/tmp/p.json');
  assert.equal(c.autoPullModel, false);
});

test('invalid or empty values fall back to defaults', () => {
  const c = loadConfig({
    PORT: 'abc',
    AI_NUM_CTX: '-5',
    LLM_TIMEOUT_MS: '',
    RATE_LIMIT_RPM: '0',
    MAX_BODY_BYTES: '1e6',
    REF_PRICE_IN_PER_M: 'free',
    REF_PRICE_OUT_PER_M: '-1',
    AUTO_PULL_MODEL: 'maybe',
    AI_MODEL: '   ',
    DATA_DIR: '',
  });
  assert.equal(c.port, 8080);
  assert.equal(c.numCtx, 4096);
  assert.equal(c.llmTimeoutMs, 180000);
  assert.equal(c.rateLimitRpm, 60);
  assert.equal(c.maxBodyBytes, 1000000);
  assert.equal(c.refPriceInPerM, 2.5);
  assert.equal(c.refPriceOutPerM, 10);
  assert.equal(c.autoPullModel, true);
  assert.equal(c.model, 'gemma3:4b');
  assert.equal(c.dataDir, './data');
  assert.equal(loadConfig({ PORT: '70000' }).port, 8080);
  assert.equal(loadConfig({ PORT: '0' }).port, 0);
});

test('autoPullModel accepts common boolean spellings', () => {
  for (const v of ['0', 'false', 'FALSE', 'no', 'off']) {
    assert.equal(loadConfig({ AUTO_PULL_MODEL: v }).autoPullModel, false, v);
  }
  for (const v of ['1', 'true', 'True', 'yes', 'on']) {
    assert.equal(loadConfig({ AUTO_PULL_MODEL: v }).autoPullModel, true, v);
  }
});

test('config is frozen', () => {
  const c = loadConfig({});
  assert.ok(Object.isFrozen(c));
  assert.throws(() => { c.port = 1; }, TypeError);
});

test('version comes from package.json', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(loadConfig({}).version, pkg.version);
  assert.equal(pkg.version, '1.0.0');
});

test('package.json keeps the zero-dependency contract', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'ai-hub');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.start, 'node server.mjs');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test('loadConfig defaults to process.env', () => {
  const c = loadConfig();
  assert.equal(typeof c.port, 'number');
  assert.equal(typeof c.model, 'string');
});
