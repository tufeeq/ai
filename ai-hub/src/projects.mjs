// Project registry: names, descriptions and per-project system prompts.
// Loaded once from config.projectsPath (projects.json). The `general` project is
// always present and always first, even when the file is missing or invalid.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATH = fileURLToPath(new URL('../projects.json', import.meta.url));
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PUBLIC_FIELDS = ['id', 'name', 'nameAr', 'description', 'descriptionAr'];

// Built-in fallback used when projects.json has no usable `general` entry.
const BUILTIN_GENERAL = Object.freeze({
  id: 'general',
  name: 'General',
  nameAr: 'عام',
  description:
    "General bilingual assistant for the owner's ventures: drafting, analysis, summarising and coding help.",
  descriptionAr:
    'مساعد عام ثنائي اللغة لمشاريع المالك: الصياغة والتحليل والتلخيص والمساعدة في البرمجة.',
  systemPrompt: [
    "You are AI Hub, a capable bilingual (Arabic and English) assistant for the owner's ventures.",
    'You help with drafting, analysis, summarising and coding.',
    'When knowledge excerpts are provided and relevant, answer from them.',
    'If you do not know, or the excerpts do not cover the question, say so plainly; never invent facts, figures or sources.',
    'Answer in the language the user writes in.',
    'Be concise: give the answer first, then only the detail that is needed.',
  ].join('\n'),
  systemPromptAr: [
    'أنت «AI Hub»، مساعد متمكّن ثنائي اللغة (العربية والإنجليزية) لمشاريع المالك.',
    'تساعد في الصياغة والتحليل والتلخيص والبرمجة.',
    'إذا زُوِّدت بمقتطفات معرفية ذات صلة بالسؤال فاعتمد عليها في إجابتك.',
    'إذا لم تعرف الإجابة أو لم تغطِّ المقتطفات السؤال فقل ذلك بوضوح، ولا تختلق حقائق أو أرقامًا أو مصادر.',
    'أجب بلغة المستخدم.',
    'كن موجزًا: ابدأ بالإجابة ثم اذكر ما يلزم من التفاصيل فقط.',
  ].join('\n'),
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Returns a clean project object, or null when the entry is unusable.
function normalise(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = text(raw.id).toLowerCase();
  if (!ID_RE.test(id)) return null;
  const name = text(raw.name) || id;
  const description = text(raw.description);
  const systemPrompt = text(raw.systemPrompt);
  return {
    id,
    name,
    nameAr: text(raw.nameAr) || name,
    description,
    descriptionAr: text(raw.descriptionAr) || description,
    systemPrompt,
    systemPromptAr: text(raw.systemPromptAr),
  };
}

function readEntries(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.projects)) return parsed.projects;
  } catch {
    // Missing or corrupt file: fall through to the built-in project only.
  }
  return [];
}

export function createProjects({ config } = {}) {
  const path = (config && config.projectsPath) || DEFAULT_PATH;

  const byId = new Map();
  for (const raw of readEntries(path)) {
    const project = normalise(raw);
    if (project && !byId.has(project.id)) byId.set(project.id, project);
  }

  // `general` must exist, must have both prompts, and must come first.
  const fileGeneral = byId.get('general');
  byId.delete('general');
  const general = fileGeneral
    ? {
        ...fileGeneral,
        systemPrompt: fileGeneral.systemPrompt || BUILTIN_GENERAL.systemPrompt,
        systemPromptAr:
          fileGeneral.systemPromptAr ||
          (fileGeneral.systemPrompt ? '' : BUILTIN_GENERAL.systemPromptAr),
      }
    : { ...BUILTIN_GENERAL };

  const all = [general, ...byId.values()].map((p) => Object.freeze(p));
  const index = new Map(all.map((p) => [p.id, p]));

  function lookup(id) {
    return typeof id === 'string' ? index.get(id.trim().toLowerCase()) || null : null;
  }

  function isArabic(lang) {
    return typeof lang === 'string' && lang.trim().toLowerCase().startsWith('ar');
  }

  return {
    // Public view: never exposes system prompts.
    list() {
      return all.map((p) => Object.fromEntries(PUBLIC_FIELDS.map((f) => [f, p[f]])));
    },

    // Full project (including prompts) or null.
    get(id) {
      const project = lookup(id);
      return project ? { ...project } : null;
    },

    // System prompt for a project in the requested language. Unknown projects
    // and projects without a prompt fall back to `general`; a missing Arabic
    // prompt falls back to the English one.
    systemPrompt(id, lang = 'en') {
      const project = lookup(id);
      const candidates = isArabic(lang)
        ? [project?.systemPromptAr, project?.systemPrompt, general.systemPromptAr, general.systemPrompt]
        : [project?.systemPrompt, general.systemPrompt];
      return candidates.find((p) => typeof p === 'string' && p.length > 0) || BUILTIN_GENERAL.systemPrompt;
    },
  };
}
