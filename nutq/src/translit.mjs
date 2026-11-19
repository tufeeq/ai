// Rule-based Arabic -> Latin pronunciation for learners.
//
// Works from vocalised Arabic (with harakat). Uses the pausal form that people
// actually say: final short vowels and -un/-in endings are dropped, -an is kept.
// Convention (shown to the user in the page's key):
//   aa ee oo long vowels · ' hamza · 3 ع · H ح · kh خ · gh غ · q ق · th ث · dh ذ
//   S D T Z ص ض ط ظ · doubled letter = shadda

const FATHA = 'َ', DAMMA = 'ُ', KASRA = 'ِ', SUKUN = 'ْ', SHADDA = 'ّ';
const FATHATAN = 'ً', DAMMATAN = 'ٌ', KASRATAN = 'ٍ', DAGGER = 'ٰ';
const TATWEEL = 'ـ';
const MARKS = new Set([FATHA, DAMMA, KASRA, SUKUN, SHADDA, FATHATAN, DAMMATAN, KASRATAN, DAGGER]);
const SHORT = { [FATHA]: 'a', [DAMMA]: 'u', [KASRA]: 'i' };

const CONS = {
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'H', 'خ': 'kh', 'د': 'd', 'ذ': 'dh',
  'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 'S', 'ض': 'D', 'ط': 'T', 'ظ': 'Z',
  'ع': '3', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'ء': "'", 'ؤ': "'", 'ئ': "'", 'پ': 'p', 'گ': 'g', 'چ': 'ch', 'ڤ': 'v',
};
const SUN = new Set([...'تثدذرزسشصضطظلن']);
const ALIFS = new Set(['ا', 'ٱ']);
const PUNCT = { '،': ',', '؟': '?', '؛': ';', '.': '.', ',': ',', '?': '?', '!': '!', ':': ':', ';': ';' };

export function isArabicLetter(ch) {
  return /[ء-يٱپچڤگ]/.test(ch);
}

function parse(word) {
  const units = [];
  for (const ch of word) {
    if (ch === TATWEEL) continue;
    if (MARKS.has(ch)) {
      if (units.length) units[units.length - 1].m.push(ch);
      continue;
    }
    units.push({ c: ch, m: [] });
  }
  return units;
}

function unparse(units) {
  return units.map((u) => u.c + u.m.join('')).join('');
}

// Drop final short vowels / -un / -in on the last letter (keep -an and shadda).
function pausalUnits(units) {
  if (!units.length) return units;
  const out = units.map((u) => ({ c: u.c, m: [...u.m] }));
  const last = out[out.length - 1];
  const drop = new Set([FATHA, DAMMA, KASRA, DAMMATAN, KASRATAN]);
  last.m = last.m.filter((m) => !drop.has(m));
  return out;
}

function splitPunct(token) {
  const m = token.match(/^([^\u0621-\u065F\u0670-\u06D3\w]*)(.*?)([^\u0621-\u065F\u0670-\u06D3\w]*)$/u);
  return m ? { lead: m[1], core: m[2], trail: m[3] } : { lead: '', core: token, trail: '' };
}

function latinPunct(s) {
  return [...s].map((c) => PUNCT[c] ?? '').join('');
}

/** Arabic text in pausal (spoken) form, with full marks otherwise kept. */
export function pausalize(text) {
  return String(text)
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const { lead, core, trail } = splitPunct(tok);
      return lead + unparse(pausalUnits(parse(core))) + trail;
    })
    .join(' ');
}

/** Share of Arabic consonants that carry a vowel mark — low means "unvocalised". */
export function vowelDensity(text) {
  let letters = 0, marked = 0;
  for (const tok of String(text).split(/\s+/)) {
    const units = parse(splitPunct(tok).core);
    units.forEach((u, i) => {
      if (!isArabicLetter(u.c) || 'اٱىةويآ'.includes(u.c)) return;
      if (i === units.length - 1) return; // last letter is often left bare in pausal form
      letters++;
      if (u.m.some((m) => m !== SHADDA)) marked++;
    });
  }
  return letters ? marked / letters : 0;
}

const hasVowel = (m) => m.some((x) => x === FATHA || x === DAMMA || x === KASRA || x === FATHATAN || x === DAMMATAN || x === KASRATAN || x === DAGGER);

function vowelOf(m) {
  if (m.includes(DAGGER)) return 'aa';
  if (m.includes(FATHATAN)) return 'an';
  if (m.includes(DAMMATAN)) return 'un';
  if (m.includes(KASRATAN)) return 'in';
  for (const x of m) if (SHORT[x]) return SHORT[x];
  return '';
}

const ALLAH = { 'الله': 'allaah', 'لله': 'lillaah', 'بالله': 'billaah', 'والله': 'wallaah', 'فالله': 'fallaah', 'تالله': 'tallaah' };

function wordToLatin(word, { beforeArticle = false } = {}) {
  const bare = [...word].filter((ch) => !MARKS.has(ch) && ch !== TATWEEL).join('').replace(/ٱ/g, 'ا');
  if (ALLAH[bare]) return ALLAH[bare];
  let units = pausalUnits(parse(word));
  if (!units.length) return '';
  let out = '';
  let i = 0;

  // Prefixes wa- fa- bi- ka- li- joined to the article: wal-, bil-, lil-, was-salaam
  let prefix = '';
  const prefixMap = { 'و': 'wa', 'ف': 'fa', 'ب': 'bi', 'ك': 'ka' };
  if (prefixMap[units[0].c] && units[1] && ALIFS.has(units[1].c) && units[2]?.c === 'ل' && units.length > 3) {
    prefix = prefixMap[units[0].c];
    i = 1;
  } else if (units[0].c === 'ل' && units[1]?.c === 'ل' && units.length > 2) {
    // لِلْ = li + al
    prefix = 'li';
    units = [{ c: 'ل', m: [] }, { c: 'ا', m: [] }, ...units.slice(1)];
    i = 1;
  }

  // Definite article
  if (ALIFS.has(units[i]?.c) && units[i + 1]?.c === 'ل' && i + 2 < units.length) {
    const next = units[i + 2];
    const head = prefix ? prefix : 'a';
    if (SUN.has(next.c) && next.c !== 'ل') {
      out += head + CONS[next.c] + '-';
    } else {
      out += head + 'l-';
    }
    if (SUN.has(next.c)) next.m = next.m.filter((x) => x !== SHADDA);
    i += 2;
  } else if (prefix) {
    // prefix without article was a false match — restart plainly
    i = 0;
    units = pausalUnits(parse(word));
  }

  const start = i;
  let prevV = null; // last short vowel emitted: 'a' | 'u' | 'i' | null
  let skipAlif = false;

  for (; i < units.length; i++) {
    const { c, m } = units[i];
    const isLast = i === units.length - 1;
    const atStart = i === start && out === '';

    if (ALIFS.has(c)) {
      if (skipAlif) { skipAlif = false; continue; }
      if (atStart) { out += vowelOf(m) || 'i'; prevV = null; continue; }
      out += prevV === 'a' ? 'a' : 'aa';
      prevV = null;
      continue;
    }
    if (c === 'ى') { out += prevV === 'a' ? 'a' : 'aa'; prevV = null; continue; }
    if (c === 'آ') { out += atStart ? 'aa' : "'aa"; prevV = null; continue; }
    if (c === 'أ' || c === 'إ') {
      if (!atStart) out += "'";
      let v = vowelOf(m) || (c === 'إ' ? 'i' : 'a');
      if (m.includes(SUKUN)) v = '';
      out += v;
      prevV = v.length === 1 ? v : null;
      if (m.includes(FATHATAN)) skipAlif = true;
      continue;
    }
    if (c === 'ة') {
      if (!isLast) { out += 't' + vowelOf(m); continue; }
      if (beforeArticle) out += prevV === 'a' ? 't' : 'at';
      else if (m.includes(FATHATAN)) out += prevV === 'a' ? 'tan' : 'atan';
      else if (prevV !== 'a') out += 'a';
      prevV = null;
      continue;
    }
    if (c === 'و' || c === 'ي') {
      const longV = c === 'و' ? 'u' : 'i';
      const longOut = c === 'و' ? 'oo' : 'ee';
      const bare = !hasVowel(m) && !m.includes(SHADDA);
      if (bare && prevV === longV) {
        out = out.slice(0, -1) + longOut;
        prevV = null;
        continue;
      }
      if (bare && !m.includes(SUKUN) && prevV === null && !atStart && i > start && isArabicLetter(units[i - 1].c) && !ALIFS.has(units[i - 1].c)) {
        // unvocalised long vowel after a bare consonant
        out += longOut;
        prevV = null;
        continue;
      }
      // consonant w / y (also the aw / ay diphthongs)
    }

    let tr = c === 'و' ? 'w' : c === 'ي' ? 'y' : CONS[c];
    if (tr === undefined) { out += c; prevV = null; continue; }
    if (atStart && tr === "'") tr = '';
    if (m.includes(SHADDA)) tr = tr + tr;
    const v = m.includes(SUKUN) ? '' : vowelOf(m);
    out += tr + v;
    prevV = v.length === 1 ? v : null;
    if (m.includes(FATHATAN)) skipAlif = true;
  }
  return out;
}

/** Whole phrase -> Latin pronunciation. */
export function transliterate(text) {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  return tokens
    .map((tok, idx) => {
      const { lead, core, trail } = splitPunct(tok);
      const nextCore = tokens[idx + 1] ? splitPunct(tokens[idx + 1]).core : '';
      const nextUnits = parse(nextCore);
      const beforeArticle = !trail && ALIFS.has(nextUnits[0]?.c) && nextUnits[1]?.c === 'ل';
      return latinPunct(lead) + wordToLatin(core, { beforeArticle }) + latinPunct(trail);
    })
    .join(' ')
    .replace(/\s+([,?!.;:])/g, '$1');
}

const TIPS = [
  { test: /ع/, tip: "3 (ع) — squeeze your throat and say “a”. Don’t skip it; it changes the word." },
  { test: /ح/, tip: "H (ح) — a strong, breathy h from the middle of the throat, like fogging a mirror." },
  { test: /ق/, tip: "q (ق) — a k made far back in the throat, not at the front of the mouth." },
  { test: /خ/, tip: "kh (خ) — like the ch in Scottish “loch” or German “Bach”." },
  { test: /غ/, tip: "gh (غ) — a soft gargle, close to the French r." },
  { test: /[صضطظ]/, tip: "Capital S D T Z — say s, d, t, z with a heavy, full mouth: tongue low, sound deeper." },
  { test: /[ءأإؤئ]/, tip: "' (hamza) — a quick catch in the throat, like the break in “uh‑oh”." },
  { test: /ث/, tip: "th (ث) — as in “think”." },
  { test: /ذ/, tip: "dh (ذ) — as in “this”." },
  { test: /ر/, tip: "r — tap or roll it, like Spanish “pero”." },
  { test: /ّ/, tip: "A doubled letter (bb, mm…) is held a beat longer — it can change the meaning." },
];

/** Up to `max` pronunciation tips for the sounds that appear in this text. */
export function tipsFor(arabic, max = 3) {
  return TIPS.filter((t) => t.test.test(arabic)).slice(0, max).map((t) => t.tip);
}
