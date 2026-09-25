// Escaping template literals plus a keyed DOM morph, so re-rendering keeps
// focus, typed values, open disclosures and scroll positions intact.

class Html {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Mark a string as already-safe markup. */
export const raw = (s) => new Html(String(s));

function part(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(part).join('');
  return escape(value);
}

/** Tagged template: interpolations are escaped unless produced by html`` or raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Html(out);
}

/** Only http(s) links are rendered; anything else becomes an inert "#". */
export function safeUrl(u) {
  try {
    const url = new URL(u);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}

// ---- DOM morph -------------------------------------------------------------

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || n.id || '' : '');
const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

/** Replace `target`'s children with `markup`, reusing existing nodes where possible. */
export function morph(target, markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup);
  morphChildren(target, template.content);
}

function morphChildren(parent, next) {
  const keyed = new Map();
  for (const child of parent.childNodes) {
    const k = keyOf(child);
    if (k) keyed.set(k, child);
  }
  let cursor = parent.firstChild;
  for (const fresh of [...next.childNodes]) {
    const k = keyOf(fresh);
    let match = null;
    if (k) {
      match = keyed.get(k) ?? null;
      keyed.delete(k);
    } else if (cursor && !keyOf(cursor)) {
      match = cursor;
    }
    if (match && sameKind(match, fresh)) {
      if (match === cursor) cursor = cursor.nextSibling;
      else parent.insertBefore(match, cursor);
      morphNode(match, fresh);
    } else {
      parent.insertBefore(fresh, cursor);
    }
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
}

function morphNode(node, fresh) {
  if (node.nodeType === 3 || node.nodeType === 8) {
    if (node.nodeValue !== fresh.nodeValue) node.nodeValue = fresh.nodeValue;
    return;
  }
  if (node.nodeType !== 1) return;
  const focused = node === document.activeElement;
  for (const { name } of [...node.attributes]) {
    // `open` on <details> belongs to the user once rendered.
    if (!fresh.hasAttribute(name) && !(name === 'open' && node.tagName === 'DETAILS')) node.removeAttribute(name);
  }
  for (const { name, value } of [...fresh.attributes]) {
    if (name === 'open' && node.tagName === 'DETAILS') continue;
    if (focused && name === 'value') continue;
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  if ((node.tagName === 'INPUT' || node.tagName === 'SELECT') && !focused) {
    const want = fresh.getAttribute('value') ?? '';
    if (node.tagName === 'INPUT' && node.value !== want) node.value = want;
  }
  morphChildren(node, fresh);
}
