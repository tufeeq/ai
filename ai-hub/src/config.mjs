// Configuration loader. Everything comes from the environment; nothing secret
// is ever read from the repository.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the ai-hub folder (parent of src/). */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function str(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed;
}

function int(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = str(value, null);
  if (raw === null || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}

function num(value, fallback, { min = 0 } = {}) {
  const raw = str(value, null);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function bool(value, fallback) {
  const raw = str(value, null);
  if (raw === null) return fallback;
  const v = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

/**
 * Build the frozen configuration object from an env-like object.
 * Invalid or empty values silently fall back to the documented defaults.
 */
export function loadConfig(env = process.env) {
  const e = env || {};
  return Object.freeze({
    port: int(e.PORT, 8080, { min: 0, max: 65535 }),
    dataDir: str(e.DATA_DIR, './data'),
    ollamaUrl: str(e.OLLAMA_URL, 'http://ollama:11434').replace(/\/+$/, ''),
    model: str(e.AI_MODEL, 'gemma3:4b'),
    numCtx: int(e.AI_NUM_CTX, 4096),
    // Threads the model may use. Must match the container's CPU cap: more threads than CPUs makes inference far slower. 0 = let Ollama decide.
    numThread: int(e.AI_NUM_THREAD, 0),
    llmTimeoutMs: int(e.LLM_TIMEOUT_MS, 180000),
    adminKey: str(e.ADMIN_KEY, ''),
    rateLimitRpm: int(e.RATE_LIMIT_RPM, 60),
    maxBodyBytes: int(e.MAX_BODY_BYTES, 1000000),
    refPriceInPerM: num(e.REF_PRICE_IN_PER_M, 2.5),
    refPriceOutPerM: num(e.REF_PRICE_OUT_PER_M, 10),
    knowledgePath: str(e.KNOWLEDGE_PATH, path.join(ROOT_DIR, 'knowledge', 'index.json')),
    projectsPath: str(e.PROJECTS_PATH, path.join(ROOT_DIR, 'projects.json')),
    publicDir: path.join(ROOT_DIR, 'public'),
    autoPullModel: bool(e.AUTO_PULL_MODEL, true),
    version: readVersion(),
  });
}
