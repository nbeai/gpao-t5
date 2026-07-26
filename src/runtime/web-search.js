// L3 · 웹 검색 (Phase 0-2) — URL 없이도 찾는다.
//
// 계층(오너 결정): ①모델 내장 검색 → ②무키 폴백 → ③키 연결. **위에서 되면 아래로 안 간다.**
//
// **절대 규칙(오너 지시)**: 작동하는 경로가 하나라도 있으면 "검색 연결하세요"를 절대 말하지 않는다.
//   연결 권유는 1층·2층이 **모두** 실패했을 때만 만들어진다. 이건 테스트로 강제한다.
//   이유: 되는데도 설정을 요구하면 §15("설정을 공부하지 않아도")를 정면으로 어긴다.
//
// 실측(2026-07-26): 무키 경로는 환경·시점에 따라 막힌다 — DuckDuckGo HTML 은 anomaly/challenge
//   페이지(202)를, 공개 SearXNG 인스턴스는 429/403/비JSON 을 돌려줬다. 그래서 무키는 **되면 쓰고
//   안 되면 조용히 다음 층**으로 넘어간다. 되는 날에는 아무 설정 없이 검색이 된다.
import { withTimeout } from './with-timeout.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** 검색 결과 한 건(사용자면 표시 + 출처 원장에 그대로 쓰인다). */
function result(title, url, snippet) {
  return { title: String(title ?? '').trim(), url, snippet: String(snippet ?? '').trim().slice(0, 400) };
}

// ── 무키: DuckDuckGo(HTML) ────────────────────────────────────────────────
// 공식 API 가 아니다. 차단되면 결과 대신 anomaly/challenge 페이지가 온다 — 그걸 **성공으로 읽지 않는다**.
const duckduckgo = {
  id: 'duckduckgo',
  keyless: true,
  label: '덕덕고',
  async run(query, { fetchImpl, timeoutMs }) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const html = await withTimeout(async () => {
      const r = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: controller.signal });
      return r.status >= 200 && r.status < 300 ? r.text() : '';
    }, timeoutMs, controller);
    if (!html || /anomaly|challenge|captcha/i.test(html.slice(0, 4000))) return null; // 차단 — 다음 층으로
    const out = [];
    // result__a 앵커에서 제목·주소를, result__snippet 에서 요약을 뽑는다.
    const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    for (const m of html.matchAll(re)) {
      const href = decodeDdgHref(m[1]);
      if (!href) continue;
      out.push(result(stripTags(m[2]), href, ''));
      if (out.length >= 8) break;
    }
    return out.length ? out : null;
  },
};

/** DDG 는 실제 주소를 uddg 파라미터로 감싼다. 못 풀면 버린다(가짜 주소를 출처로 남기지 않는다). */
function decodeDdgHref(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const real = u.searchParams.get('uddg');
    const target = real ? decodeURIComponent(real) : href;
    return /^https?:\/\//.test(target) && !/duckduckgo\.com/.test(target) ? target : null;
  } catch { return null; }
}

const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// ── 무키: SearXNG(사용자가 인스턴스를 가진 경우) ──────────────────────────
const searxng = {
  id: 'searxng',
  keyless: true,
  label: 'SearXNG',
  needsInstance: true,
  async run(query, { fetchImpl, timeoutMs, instanceUrl }) {
    if (!instanceUrl) return null;
    const url = `${instanceUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`;
    const controller = new AbortController();
    const json = await withTimeout(async () => {
      const r = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: controller.signal });
      if (r.status < 200 || r.status >= 300) return null;
      try { return await r.json(); } catch { return null; } // 인스턴스가 JSON 을 끈 경우
    }, timeoutMs, controller);
    const rows = json?.results ?? [];
    const out = rows.slice(0, 8).map((r) => result(r.title, r.url, r.content));
    return out.length ? out : null;
  },
};

// ── 키: Tavily ────────────────────────────────────────────────────────────
const tavily = {
  id: 'tavily',
  keyless: false,
  label: 'Tavily',
  async run(query, { fetchImpl, timeoutMs, apiKey }) {
    if (!apiKey) return null;
    const controller = new AbortController();
    const json = await withTimeout(async () => {
      const r = await fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: 8 }),
        signal: controller.signal,
      });
      if (r.status < 200 || r.status >= 300) return null;
      try { return await r.json(); } catch { return null; }
    }, timeoutMs, controller);
    const rows = json?.results ?? [];
    const out = rows.map((r) => result(r.title, r.url, r.content));
    return out.length ? out : null;
  },
};

export const SEARCH_PROVIDERS = Object.freeze({ duckduckgo, searxng, tavily });

/**
 * 검색기를 만든다. 순서: 무키(덕덕고 → SearXNG) → 키(Tavily).
 * 모델 내장 검색(1층)은 여기 오지 않는다 — 호출부가 그 경우 아예 부르지 않는다.
 * @param {{apiKey?:string, instanceUrl?:string, fetchImpl?:Function, timeoutMs?:number}} deps
 */
export function makeWebSearch(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const order = [duckduckgo, searxng, tavily];
  return {
    /** @param {string} query */
    async search(query) {
      const q = String(query ?? '').trim();
      if (!q) return { state: 'empty_query', tried: [] };
      const tried = [];
      for (const p of order) {
        if (p.id === 'tavily' && !deps.apiKey) continue;       // 키 없으면 시도 자체를 안 한다
        if (p.id === 'searxng' && !deps.instanceUrl) continue; // 인스턴스 없으면 마찬가지
        tried.push(p.id);
        let rows = null;
        try {
          rows = await p.run(q, { fetchImpl, timeoutMs, apiKey: deps.apiKey, instanceUrl: deps.instanceUrl });
        } catch { rows = null; } // 한 층이 죽어도 다음 층으로(막다른 답 금지)
        if (rows?.length) return { state: 'ok', provider: p.id, providerLabel: p.label, results: rows, tried };
      }
      return { state: 'unavailable', tried };
    },
    /** 키 연결 없이 시도할 수 있는 경로가 있는가(권유 판단에 쓴다). */
    hasKeylessPath: () => true, // 덕덕고는 항상 시도한다(되는 날엔 설정 0)
    hasKeyedPath: () => Boolean(deps.apiKey),
  };
}

/**
 * **연결 권유는 여기서만 만든다.** 작동하는 경로가 있으면 절대 만들지 않는다(오너 지시).
 * @param {{modelNativeSearch?:boolean, searchState?:string, hasKey?:boolean}} p
 * @returns {{userSafeSummary:string, nextSafeAction:string}|null}
 */
export function searchConnectionSuggestion(p = {}) {
  if (p.modelNativeSearch) return null;              // 1층이 되면 권유 금지
  if (p.searchState === 'ok') return null;           // 2층이 됐으면 권유 금지
  if (p.hasKey) return null;                         // 이미 연결돼 있으면 권유 금지
  if (p.searchState !== 'unavailable') return null;  // 실패가 확정되지 않았으면 말하지 않는다
  return {
    userSafeSummary: '지금은 웹에서 찾아보지 못했어요.',
    nextSafeAction: '검색을 연결하면 바로 찾아드릴 수 있어요(무료로 시작할 수 있어요). 아니면 주소를 주시면 그 페이지는 바로 읽을 수 있어요.',
  };
}
