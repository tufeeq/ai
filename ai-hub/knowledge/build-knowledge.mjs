#!/usr/bin/env node
// Builds the AI Hub knowledge index from the human documentation in the repo.
//
//   node ai-hub/knowledge/build-knowledge.mjs [--root <dir>] [--out <file>] [--quiet]
//
// Output (see SPEC.md, "knowledge"):
//   { builtAt, chunks: [{ id, project, source, title, text }] }
//
// Zero dependencies. File contents are treated purely as data: nothing read
// from a document is ever executed, fetched or interpreted as configuration.

import { readFileSync, readdirSync, lstatSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PROJECTS = ['general', 'tagit', 'operon', 'marginos', 'myai', 'dont-chaos'];

// Top-level folder → project.
export const FOLDER_PROJECT = Object.freeze({
  tag: 'tagit',
  tag10: 'tagit',
  tagit: 'tagit',
  'tagit-lab': 'tagit',
  'tagit-next': 'tagit',
  tagit10: 'tagit',
  tagx: 'tagit',
  tagx2: 'tagit',
  operon: 'operon',
  marginos: 'marginos',
  'dont-chaos': 'dont-chaos',
});

// The only ai-hub documents that belong in the index (SPEC.md is the build
// contract, not user documentation).
const AI_HUB_DOCS = new Set(['ai-hub/README.md', 'ai-hub/DEPLOY.md']);

export const LIMITS = Object.freeze({
  maxFileBytes: 300 * 1024,
  maxChunkChars: 900,
  minChunkChars: 80,
  maxChunksPerFile: 120,
  maxIndexBytes: 1.5 * 1024 * 1024,
  maxFenceLines: 40,
});

// Folders holding generated material rather than documentation: data, report(s),
// audit(s) (also "trade-audits" etc.), history, results, logs.
const EXCLUDED_DIR = /(^|[-_.])(data|reports?|audits?|history|results?|logs?)$/i;
const ALWAYS_SKIPPED_DIR = new Set(['node_modules', '.git']);
// Generated log files such as devlog.md, run-log.md, build.log.md.
const LOG_FILE = /(^|[-_.])(dev|run|build|training)?logs?([-_.]|$)/i;

// Obvious credential shapes. A chunk matching any of these is dropped.
// Patterns are deliberately strict so that prose such as "task-completion" or
// "Authorization: Bearer <key>" is not flagged.
export const SECRET_PATTERNS = Object.freeze([
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/, // OpenAI-style keys
  /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/,
  /(?<![A-Za-z0-9])hub_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/, // AI Hub keys
  /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![0-9A-Z])/, // AWS access key id
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/, // Google API key
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // "Bearer <token>" only when the token looks real (long, has letters and digits).
  /Bearer\s+(?=[A-Za-z0-9._~+/-]*[0-9])(?=[A-Za-z0-9._~+/-]*[A-Za-z])[A-Za-z0-9._~+/-]{24,}/,
]);

export function containsSecret(text) {
  const s = String(text);
  return SECRET_PATTERNS.some((re) => re.test(s));
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** True when any folder of the repo-relative path is excluded from the index. */
export function isExcludedPath(relPath) {
  const parts = toPosix(relPath).split('/');
  const file = parts.pop() || '';
  for (const dir of parts) {
    if (ALWAYS_SKIPPED_DIR.has(dir) || dir.startsWith('.') || EXCLUDED_DIR.test(dir)) return true;
  }
  return LOG_FILE.test(file.replace(/\.md$/i, ''));
}

/**
 * Maps a repo-relative path to its project id, or null when the file must not
 * be indexed (not markdown, unmapped folder, excluded folder, ai-hub internals).
 */
export function mapProject(relPath) {
  const rel = toPosix(relPath);
  if (!rel || !/\.md$/i.test(rel)) return null;
  if (rel === 'README.md') return 'myai';
  const parts = rel.split('/');
  if (parts.length < 2) return null; // other root-level files are not documentation
  if (parts[0] === 'ai-hub') return AI_HUB_DOCS.has(rel) ? 'general' : null;
  if (isExcludedPath(rel)) return null;
  return Object.hasOwn(FOLDER_PROJECT, parts[0]) ? FOLDER_PROJECT[parts[0]] : null;
}

/** Lower number = more important; files are dropped from the highest number down. */
export function filePriority(relPath) {
  const rel = toPosix(relPath);
  const base = path.posix.basename(rel).replace(/\.md$/i, '').toUpperCase();
  if (base === 'README') return 0;
  if (/^(PRODUCT|PRODUCTION|ARCHITECTURE|VALIDATION|WEBAPP|CONTINUOUS_LEARNING|DEPLOY)$/.test(base)) return 1;
  if (/BRIEF/.test(base)) return 2;
  if (/(^|\/)docs\//i.test(rel)) return 3;
  return 4;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const HTML_TAGS =
  /<\/?(?:br|hr|p|div|span|a|details|summary|sub|sup|b|i|u|em|strong|center|kbd|picture|source|table|thead|tbody|tr|td|th|h[1-6]|ul|ol|li)\b[^>]*>/gi;

/**
 * Removes material that is noise for retrieval: front matter, HTML comments,
 * images, long code fences, layout HTML. Short code fences keep their content.
 * Returns markdown text with line structure preserved.
 */
export function cleanMarkdown(markdown, { maxFenceLines = LIMITS.maxFenceLines } = {}) {
  let md = String(markdown ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  md = md.replace(/^---\n[\s\S]*?\n---\n/, ''); // YAML front matter
  md = md.replace(/<!--[\s\S]*?(?:-->|$)/g, ''); // HTML comments (also unterminated)
  md = md.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // ![alt](src)
  md = md.replace(/!\[[^\]]*\]\[[^\]]*\]/g, ''); // ![alt][ref]
  md = md.replace(/<img\b[^>]*>/gi, '');
  md = md.replace(/\[\s*\]\([^)]*\)/g, ''); // links left empty by removed badges

  const out = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) {
      out.push({ text: lines[i], code: false });
      continue;
    }
    const marker = open[1];
    const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
    const body = [];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) body.push(lines[j++]);
    if (body.length <= maxFenceLines) {
      out.push({ text: '', code: false });
      for (const line of body) out.push({ text: line, code: true });
      out.push({ text: '', code: false });
    }
    i = j; // skip the closing fence (or end of file when unterminated)
  }
  return out;
}

function cleanInline(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)[^)]*\)/g, (m, label, url) => (label === url ? url : `${label} (${url})`))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // relative links keep only their label
    .replace(HTML_TAGS, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}

function cleanHeading(text) {
  return cleanInline(text)
    .replace(/\s+#+\s*$/, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Splits text longer than `max` on the coarsest boundary available: lines,
// then sentences, then words. A single word longer than `max` stays whole.
function splitText(text, max) {
  if (text.length <= max) return [text];
  const levels = [
    [/\n+/, '\n'],
    [/(?<=[.!?؟;؛:،])\s+/u, ' '],
    [/\s+/, ' '],
  ];
  for (const [re, joiner] of levels) {
    const parts = text.split(re).filter(Boolean);
    if (parts.length > 1) {
      return pack(parts.flatMap((part) => splitText(part, max)), max, joiner);
    }
  }
  return [text];
}

function pack(pieces, max, joiner) {
  const out = [];
  let current = '';
  for (const piece of pieces) {
    if (!current) current = piece;
    else if (current.length + joiner.length + piece.length <= max) current += joiner + piece;
    else {
      out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Splits a markdown document into retrieval chunks.
 * Returns [{ title, text }] in document order. `title` is
 * "<file title> › <heading>" (just the file title before the first sub-heading).
 */
export function chunkMarkdown(markdown, options = {}) {
  const maxChars = options.maxChars ?? LIMITS.maxChunkChars;
  const minChars = options.minChars ?? LIMITS.minChunkChars;
  const maxChunks = options.maxChunks ?? Infinity;
  const lines = cleanMarkdown(markdown, options);

  // 1. Sections by heading (ATX "# x" and setext "x\n===").
  const sections = [{ heading: '', level: 0, lines: [] }];
  let docTitle = '';
  for (let i = 0; i < lines.length; i++) {
    const { text, code } = lines[i];
    let heading = null;
    if (!code) {
      const atx = /^ {0,3}(#{1,6})\s+(.*)$/.exec(text);
      const next = lines[i + 1];
      if (atx) heading = { level: atx[1].length, text: cleanHeading(atx[2]) };
      else if (text.trim() && next && !next.code && /^=+\s*$/.test(next.text) && !/^\s*\|/.test(text)) {
        heading = { level: 1, text: cleanHeading(text) };
        i++;
      }
    }
    if (heading && heading.text) {
      if (heading.level === 1 && !docTitle) docTitle = heading.text;
      sections.push({ heading: heading.text, level: heading.level, lines: [] });
    } else if (!heading) {
      sections[sections.length - 1].lines.push(lines[i]);
    }
  }
  const fileTitle = cleanHeading(options.fileTitle || docTitle || 'Document');

  // 2. Paragraphs per section, then pack into chunks.
  const chunks = [];
  let carry = ''; // text of a section too short to stand alone, moved forward
  for (const section of sections) {
    const paragraphs = [];
    let current = [];
    const flush = () => {
      if (current.length) paragraphs.push(current.join('\n'));
      current = [];
    };
    for (const line of section.lines) {
      const raw = line.code ? line.text.replace(/[^\S\n]+/g, ' ').trim() : cleanInline(line.text);
      if (!raw) flush();
      else if (!line.code && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(raw)) continue; // table rule
      else if (!line.code && /^([-*_])(\s*\1){2,}$/.test(raw)) flush(); // horizontal rule
      else current.push(raw);
    }
    flush();
    if (carry) {
      paragraphs.unshift(carry);
      carry = '';
    }
    if (!paragraphs.length) continue;

    const blocks = paragraphs.flatMap((p) => splitText(p, maxChars));
    const packed = pack(blocks, maxChars, '\n');
    // A short tail joins the previous chunk instead of being lost.
    if (packed.length > 1 && packed[packed.length - 1].length < minChars) {
      const tail = packed.pop();
      packed[packed.length - 1] += '\n' + tail;
    }
    const isDocLevel = !section.heading || section.heading === fileTitle;
    const title = isDocLevel ? fileTitle : `${fileTitle} › ${section.heading}`;
    if (packed.length === 1 && packed[0].length < minChars) {
      carry = section.heading && !isDocLevel ? `${section.heading}: ${packed[0]}` : packed[0];
      continue;
    }
    for (const text of packed) chunks.push({ title, text });
  }
  if (carry && chunks.length) chunks[chunks.length - 1].text += '\n' + carry;
  else if (carry.length >= minChars) chunks.push({ title: fileTitle, text: carry });

  return chunks.slice(0, maxChunks);
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Lists indexable markdown files under `root` as sorted repo-relative paths. */
export function listSources(root) {
  const found = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => compare(a.name, b.name));
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue; // never follow links out of the repo
      if (entry.isDirectory()) {
        if (!rel && !(entry.name === 'ai-hub' || Object.hasOwn(FOLDER_PROJECT, entry.name))) continue;
        if (rel === '' && entry.name === 'ai-hub') continue; // handled explicitly below
        if (ALWAYS_SKIPPED_DIR.has(entry.name) || entry.name.startsWith('.') || EXCLUDED_DIR.test(entry.name)) continue;
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && mapProject(childRel)) {
        found.push(childRel);
      }
    }
  };
  walk(root, '');
  for (const rel of AI_HUB_DOCS) {
    try {
      if (lstatSync(path.join(root, rel)).isFile()) found.push(rel);
    } catch {
      // optional documents: skip silently when missing
    }
  }
  return [...new Set(found)].sort(compare);
}

export function serializeIndex(index) {
  const rows = index.chunks.map((chunk) => JSON.stringify(chunk));
  return `{"builtAt":${JSON.stringify(index.builtAt)},"chunks":[\n${rows.join(',\n')}\n]}\n`;
}

/**
 * Builds the index object from the documentation under `root`.
 * Returns { index, report } where report describes what was included,
 * truncated, skipped and dropped.
 */
export function buildIndex({ root, builtAt, limits = {} } = {}) {
  const lim = { ...LIMITS, ...limits };
  const report = { files: [], skipped: [], truncated: [], secretChunks: [], dropped: [], bytes: 0 };
  let files = [];

  for (const source of listSources(root)) {
    const project = mapProject(source);
    const abs = path.join(root, source);
    let size;
    try {
      size = lstatSync(abs).size;
    } catch {
      continue;
    }
    if (size > lim.maxFileBytes) {
      report.skipped.push({ source, reason: `larger than ${lim.maxFileBytes} bytes (${size})` });
      continue;
    }
    let raw;
    try {
      raw = readFileSync(abs, 'utf8');
    } catch (err) {
      report.skipped.push({ source, reason: `unreadable (${err.code || 'error'})` });
      continue;
    }
    const fallbackTitle = `${source.replace(/\.md$/i, '')}`;
    let pieces = chunkMarkdown(raw, { maxChars: lim.maxChunkChars, minChars: lim.minChunkChars, maxFenceLines: lim.maxFenceLines });
    if (pieces.length && pieces[0].title.startsWith('Document')) {
      pieces = pieces.map((p) => ({ ...p, title: fallbackTitle + p.title.slice('Document'.length) }));
    }
    if (pieces.length > lim.maxChunksPerFile) {
      report.truncated.push({ source, kept: lim.maxChunksPerFile, of: pieces.length });
      pieces = pieces.slice(0, lim.maxChunksPerFile);
    }
    const chunks = [];
    pieces.forEach((piece, i) => {
      const id = `${project}:${source}#${i + 1}`;
      if (containsSecret(piece.text) || containsSecret(piece.title)) {
        report.secretChunks.push(id); // id only; the content is never printed
        return;
      }
      chunks.push({ id, project, source, title: piece.title, text: piece.text });
    });
    if (!chunks.length) {
      report.skipped.push({ source, reason: 'no usable text' });
      continue;
    }
    files.push({ source, project, size, chunks });
  }

  const order = (f) => PROJECTS.indexOf(f.project);
  files.sort((a, b) => order(a) - order(b) || compare(a.source, b.source));

  const stamp = builtAt || new Date().toISOString();
  const assemble = () => ({ builtAt: stamp, chunks: files.flatMap((f) => f.chunks) });
  let index = assemble();
  let bytes = Buffer.byteLength(serializeIndex(index));
  while (bytes > lim.maxIndexBytes && files.length) {
    // Drop the least important file; among equals, the largest.
    const victim = [...files].sort(
      (a, b) => filePriority(b.source) - filePriority(a.source) || b.size - a.size || compare(a.source, b.source),
    )[0];
    files = files.filter((f) => f !== victim);
    report.dropped.push({ source: victim.source, chunks: victim.chunks.length, bytes: victim.size });
    index = assemble();
    bytes = Buffer.byteLength(serializeIndex(index));
  }

  report.files = files.map((f) => ({ source: f.source, project: f.project, chunks: f.chunks.length }));
  report.bytes = bytes;
  return { index, report };
}

function parseArgs(argv) {
  const args = { root: path.resolve(SCRIPT_DIR, '..', '..'), out: path.join(SCRIPT_DIR, 'index.json'), quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) args.root = path.resolve(argv[++i]);
    else if (arg === '--out' && argv[i + 1]) args.out = path.resolve(argv[++i]);
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return args;
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  if (args.help) {
    log('Usage: node build-knowledge.mjs [--root <repo dir>] [--out <index.json>] [--quiet]');
    return null;
  }
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const builtAt = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : undefined;
  const { index, report } = buildIndex({ root: args.root, builtAt });
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, serializeIndex(index), 'utf8');

  if (!args.quiet) {
    const perProject = {};
    for (const chunk of index.chunks) perProject[chunk.project] = (perProject[chunk.project] || 0) + 1;
    log(`Knowledge index: ${args.out}`);
    log(`  root:   ${args.root}`);
    log(`  files:  ${report.files.length}`);
    log(`  chunks: ${index.chunks.length}`);
    for (const project of PROJECTS) log(`    ${project.padEnd(11)} ${perProject[project] || 0}`);
    log(`  bytes:  ${report.bytes} (limit ${LIMITS.maxIndexBytes})`);
    for (const s of report.skipped) log(`  skipped: ${s.source} — ${s.reason}`);
    for (const t of report.truncated) log(`  truncated: ${t.source} — kept ${t.kept} of ${t.of} chunks`);
    for (const id of report.secretChunks) log(`  excluded (looks like a credential): ${id}`);
    for (const d of report.dropped) log(`  dropped for size: ${d.source} (${d.chunks} chunks, ${d.bytes} bytes)`);
  }
  return { index, report };
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  try {
    main();
  } catch (err) {
    console.error(`build-knowledge failed: ${err.message}`);
    process.exitCode = 1;
  }
}
