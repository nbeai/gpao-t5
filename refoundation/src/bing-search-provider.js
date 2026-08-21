import { parseHTML } from 'linkedom';

const ENDPOINT = 'https://www.bing.com/search';
const MAX_BYTES = 2_000_000;

function decodedBingUrl(raw) {
  try {
    const parsed = new URL(String(raw ?? ''), ENDPOINT);
    const encoded = parsed.hostname.endsWith('bing.com') ? parsed.searchParams.get('u') : null;
    let value = parsed.href;
    if (encoded?.startsWith('a1')) {
      try { value = Buffer.from(encoded.slice(2), 'base64url').toString('utf8'); } catch { /* use href */ }
    }
    const final = new URL(value);
    if (!['http:', 'https:'].includes(final.protocol) || final.username || final.password) return null;
    if (final.hostname.endsWith('bing.com') && final.pathname.startsWith('/ck/')) return null;
    final.hash = ''; return final.href;
  } catch { return null; }
}

function text(node) { return String(node?.textContent ?? '').replace(/\s+/gu, ' ').trim(); }

export function bingHtmlResults(html, limit = 8) {
  const { document } = parseHTML(String(html ?? '')); const rows = []; const seen = new Set();
  for (const item of document.querySelectorAll('li.b_algo')) {
    const link = item.querySelector('h2 a'); const url = decodedBingUrl(link?.getAttribute('href'));
    if (!url || seen.has(url)) continue; seen.add(url);
    rows.push({ title: text(link), url, snippet: text(item.querySelector('.b_caption p, .b_snippet')), sourceType: 'web' });
    if (rows.length >= limit) break;
  }
  return rows;
}

export function makeBingSearchProvider({ fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  return {
    id: 'bing', label: 'Bing', async available() { return { available: true }; },
    async search(query, { limit = 8, domains = [], signal } = {}) {
      const terms = String(query ?? '').trim();
      const url = new URL(ENDPOINT); url.searchParams.set('q', terms); url.searchParams.set('count', String(Math.min(20, limit)));
      const timeout = AbortSignal.timeout(timeoutMs); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetchImpl(url, { signal: combined, headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
      } });
      if (!response.ok) throw new Error(`Bing search ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw new Error('Bing search response is too large');
      const rows = bingHtmlResults(bytes.toString('utf8'), limit);
      if (!rows.length) throw new Error('Bing search returned no source candidates');
      return rows;
    },
  };
}
