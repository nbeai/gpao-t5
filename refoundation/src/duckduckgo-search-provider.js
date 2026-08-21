import { parseHTML } from 'linkedom';

const ENDPOINT = 'https://html.duckduckgo.com/html/';
const MAX_BYTES = 2_000_000;

function resultUrl(raw) {
  let value = String(raw ?? '').trim();
  if (value.startsWith('//')) value = `https:${value}`;
  try {
    const parsed = new URL(value, ENDPOINT);
    const redirected = parsed.searchParams.get('uddg');
    if (redirected) value = decodeURIComponent(redirected);
    const final = new URL(value);
    if (!['http:', 'https:'].includes(final.protocol) || final.username || final.password) return null;
    final.hash = '';
    return final.href;
  } catch { return null; }
}

function text(node) {
  return String(node?.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

export function duckDuckGoHtmlResults(html, limit = 8) {
  const { document } = parseHTML(String(html ?? ''));
  const rows = [];
  const seen = new Set();
  for (const link of document.querySelectorAll('.result__a, a[data-testid="result-title-a"]')) {
    const url = resultUrl(link.getAttribute('href'));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const container = link.closest('.result') ?? link.parentElement?.parentElement;
    const snippet = text(container?.querySelector('.result__snippet, [data-result="snippet"]'));
    rows.push({ title: text(link), url, snippet, sourceType: 'web' });
    if (rows.length >= limit) break;
  }
  return rows;
}

async function boundedText(response) {
  const raw = await response.arrayBuffer();
  if (raw.byteLength > MAX_BYTES) throw new Error('DuckDuckGo search response is too large');
  return new TextDecoder().decode(raw);
}

export function makeDuckDuckGoSearchProvider({ fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  return {
    id: 'duckduckgo', label: 'DuckDuckGo',
    async available() { return { available: true }; },
    async search(query, { limit = 8, domains = [], signal } = {}) {
      const terms = String(query ?? '').trim();
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const url = new URL(ENDPOINT); url.searchParams.set('q', terms);
      const response = await fetchImpl(url, {
        method: 'GET', signal: combined,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Mozilla/5.0 (compatible; GPAO-T5/0.1; +https://localhost)',
          'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
        },
      });
      if (!response.ok) throw new Error(`DuckDuckGo search ${response.status}`);
      const rows = duckDuckGoHtmlResults(await boundedText(response), limit);
      if (!rows.length) throw new Error('DuckDuckGo search returned no source candidates');
      return rows;
    },
  };
}
