import { parseHTML } from 'linkedom';

const CONTAINER_TAGS = new Set(['article', 'li', 'tr', 'section', 'div']);
const TEXT_FIELD_TAGS = new Set(['a', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'strong', 'td', 'th', 'time']);

function compact(value, maximum = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

function safeClass(value) { return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u.test(value); }

function selectorFor(element, { container = false } = {}) {
  const tag = String(element?.localName ?? '').toLowerCase();
  if (!(container ? CONTAINER_TAGS : TEXT_FIELD_TAGS).has(tag)) return null;
  const classes = [...(element.classList ?? [])].filter(safeClass).slice(0, 3);
  if (!classes.length && container && !['article', 'tr'].includes(tag)) return null;
  return `${tag}${classes.map((name) => `.${name}`).join('')}`;
}

function relativeFieldSelector(element, itemRoot) {
  const own = selectorFor(element); if (!own) return null;
  if (own.includes('.')) return own;
  const parent = element.parentElement;
  if (!parent || parent === itemRoot) return own;
  const parentTag = String(parent.localName ?? '').toLowerCase();
  const parentClasses = [...(parent.classList ?? [])].filter(safeClass).slice(0, 2);
  const parentSelector = parentClasses.length
    ? `${parentTag}${parentClasses.map((name) => `.${name}`).join('')}`
    : TEXT_FIELD_TAGS.has(parentTag) ? parentTag : null;
  return parentSelector ? `${parentSelector} ${own}` : own;
}

function value(element, source, attribute = null) {
  return compact(source === 'attribute' ? element?.getAttribute(attribute) ?? '' : element?.textContent ?? '');
}

function fieldCandidates(items) {
  const signatures = new Map(); const first = items[0];
  for (const element of [...first.querySelectorAll('*')].slice(0, 100)) {
    const selector = relativeFieldSelector(element, first);
    if (!selector || signatures.has(selector)) continue;
    signatures.set(selector, { selector });
  }
  const output = [];
  for (const { selector } of signatures.values()) {
    const matches = items.map((item) => item.querySelector(selector));
    const attributes = ['title', 'href', 'datetime'].filter((name) => matches.some((item) => item?.hasAttribute(name)));
    for (const candidate of [{ source: 'text', attribute: null },
      ...attributes.map((attribute) => ({ source: 'attribute', attribute }))]) {
      const samples = matches.map((item) => value(item, candidate.source, candidate.attribute)).filter(Boolean).slice(0, 3);
      const populated = matches.filter((item) => value(item, candidate.source, candidate.attribute)).length;
      if (!samples.length) continue;
      output.push({ selector, source: candidate.source, attribute: candidate.attribute,
        populated, total: items.length, samples });
    }
  }
  return output.sort((left, right) => right.populated - left.populated
    || Number(right.source === 'attribute') - Number(left.source === 'attribute')
    || left.selector.localeCompare(right.selector)).slice(0, 16);
}

function pagination(document, pageUrl) {
  const links = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    const text = compact(anchor.textContent, 80); const rel = compact(anchor.getAttribute('rel'), 40).toLowerCase();
    const classes = [...(anchor.classList ?? [])].join(' ').toLowerCase();
    const raw = anchor.getAttribute('href'); let url;
    try { url = new URL(raw, pageUrl).href; } catch { continue; }
    const next = rel.split(/\s+/u).includes('next') || /(?:^|\s)next(?:\s|$)/u.test(classes)
      || /^(?:next|다음|›|»)/iu.test(text);
    const numbered = /(?:page[-_/=]|[?&](?:page|p)=)\d+/iu.test(url);
    if (!next && !numbered) continue;
    links.push({ text, url, relation: next ? 'next' : 'numbered_candidate' });
    if (links.length >= 12) break;
  }
  return links;
}

export function inspectWebCollectionStructure({ html, url, maximumCandidates = 6 } = {}) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 4_000_000) throw new TypeError('structure HTML is invalid');
  let page;
  try { page = new URL(String(url ?? '')); } catch { throw new TypeError('structure URL is invalid'); }
  if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password) throw new TypeError('structure URL is invalid');
  const { document } = parseHTML(html); const groups = new Map();
  for (const element of document.querySelectorAll('article,li,tr,section,div')) {
    const selector = selectorFor(element, { container: true });
    if (!selector) continue;
    if (!groups.has(selector)) groups.set(selector, []);
    const values = groups.get(selector); if (values.length < 250) values.push(element);
  }
  const candidates = [...groups.entries()].filter(([, items]) => items.length >= 2 && items.length <= 200)
    .map(([itemSelector, items]) => ({ itemSelector, itemCount: items.length,
      fields: fieldCandidates(items), sampleItemCount: Math.min(3, items.length) }))
    .filter((candidate) => candidate.fields.length >= 2)
    .sort((left, right) => right.fields.filter((field) => field.populated === field.total).length
      - left.fields.filter((field) => field.populated === field.total).length
      || right.itemCount - left.itemCount || left.itemSelector.localeCompare(right.itemSelector))
    .slice(0, Math.max(1, Math.min(10, Number(maximumCandidates) || 6)));
  const canonicalRaw = document.querySelector('link[rel~="canonical"]')?.getAttribute('href');
  let canonicalUrl = null;
  if (canonicalRaw) { try { canonicalUrl = new URL(canonicalRaw, page.href).href; } catch { canonicalUrl = null; } }
  return { state: candidates.length ? 'structure_observed' : 'structure_unresolved',
    page: { requestedUrl: page.href, canonicalUrl }, candidates,
    pagination: pagination(document, page.href), scriptsExecuted: 0,
    contentIncluded: candidates.some((candidate) => candidate.fields.some((field) => field.samples.length)),
    trust: 'untrusted_external', instructionAuthority: 'none' };
}
