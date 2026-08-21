import { parseHTML } from 'linkedom';

const ENDPOINT = 'https://search.naver.com/search.naver';
const MAX_BYTES = 3_000_000;

function balancedObjectEnd(source, start) {
  let depth = 0; let quoted = false; let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return index + 1;
  }
  return -1;
}

function plain(value) {
  const { document } = parseHTML(`<html><body>${String(value ?? '')}</body></html>`);
  return String(document.body?.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

function safeUrl(raw) {
  try { const url = new URL(String(raw ?? '')); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null; url.hash = ''; return url.href; }
  catch { return null; }
}

export function naverHtmlResults(html, limit = 8) {
  const source = String(html ?? ''); const marker = '"templateId":"webItem"';
  const rows = []; const seen = new Set(); let offset = 0;
  while (rows.length < limit) {
    const at = source.indexOf(marker, offset); if (at < 0) break; offset = at + marker.length;
    let start = source.lastIndexOf('{', at); let parsed = null;
    for (let attempts = 0; attempts < 1_000 && start >= Math.max(0, at - 100_000); attempts += 1) {
      const end = balancedObjectEnd(source, start);
      if (end > at) {
        try { const candidate = JSON.parse(source.slice(start, end)); if (candidate.templateId === 'webItem') { parsed = candidate; break; } }
        catch { /* try the next enclosing object */ }
      }
      start = source.lastIndexOf('{', start - 1);
    }
    const props = parsed?.props; const url = safeUrl(props?.href);
    if (!url || seen.has(url)) continue; seen.add(url);
    rows.push({ title: plain(props.title), url, snippet: plain(props.bodyText), sourceType: 'web',
      ...(props.images?.[0]?.imageSrc ? { imageUrl: safeUrl(props.images[0].imageSrc) } : {}) });
  }
  return rows;
}

export function makeNaverSearchProvider({ fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  return {
    id: 'naver', label: 'Naver Search', async available() { return { available: true }; },
    async search(query, { limit = 8, domains = [], signal } = {}) {
      const terms = String(query ?? '').trim();
      const url = new URL(ENDPOINT); url.searchParams.set('where', 'web'); url.searchParams.set('query', terms);
      const timeout = AbortSignal.timeout(timeoutMs); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetchImpl(url, { signal: combined, headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
      } });
      if (!response.ok) throw new Error(`Naver search ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > MAX_BYTES) throw new Error('Naver search response is too large');
      const rows = naverHtmlResults(bytes.toString('utf8'), limit); if (!rows.length) throw new Error('Naver search returned no source candidates');
      return rows;
    },
  };
}
