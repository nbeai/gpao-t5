// L3 · WebSearchTool — **찾는 손.** 읽는 손(`web.collect`)에서 갈라 나온다.
//
// 왜 나누는가(오너 라이브 2026-08-05):
//   `web.collect{request}` 한 칸에 **"찾을 것"과 "읽을 주소"가 섞여** 있었고, 검색하면
//   자동으로 첫 결과를 읽었다. 그래서 **모델이 "후보만 보여 줘"를 부를 수 없었다.**
//
//   같은 질문을 비교군(Claude Code)에 던져 재 보니 차이는 도구가 아니라 **순서**였다 —
//   비교군은 목록을 보고 **출처를 고르고**, T5 는 첫 결과를 읽고 막히면 **질의 문구를 바꿨다**
//   (실제로 세 번 다 문구만 바꿨다: `장중` → `마감` → 날짜 붙이기).
//   같은 코드로 6턴을 돌려 4턴만 맞은 것도 여기다 — 첫 결과가 좋은 날엔 맞고 아닌 날엔 틀린다.
//   **고를 기회가 없으니 고를 수가 없었다.**
//
// 그래서 이 손이 하는 일은 하나다: **후보를 그대로 보여 준다.** 어느 것이 답인지 정하지 않는다.
// 커널은 목적을 잃지 않게 할 뿐 무엇이 답인지 판정하지 않는다(§1.2 · 절대원칙 8).
//
// **읽지 않는다.** 한 줄로 편하게 첫 결과를 열어 주고 싶어지는 자리인데, 그러면 갈라 놓고
// 도로 붙이는 것이다 — 고르는 자리가 다시 사라진다. 읽기는 `web.collect` 가 한다.
import { makeWebSearch, searchConnectionSuggestion } from './web-search.js';
import { 검색드라이버 } from './search-slot.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** 목록에 얼마나 실을 것인가. 고르려면 여러 개가 보여야 하고, 그렇다고 다 실으면 재료가 밀린다. */
const 보여줄개수 = 8;

/**
 * 찾는 손을 만든다.
 * @param {{search?:object, fetchImpl?:Function, timeoutMs?:number, searchApiKey?:string, searchInstanceUrl?:string}} [deps]
 */
export function makeWebSearchTool(deps = {}) {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // **드라이버 목록은 슬롯에서 온다**(S8) — 읽는 손과 같은 자리를 쓴다.
  // 두 손이 각자 다른 목록을 들면 "붙였는데 한쪽에서만 돈다"가 된다.
  const search = deps.search ?? makeWebSearch({
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    timeoutMs,
    providers: deps.searchProviders ?? 검색드라이버(),
    apiKey: deps.searchApiKey,
    instanceUrl: deps.searchInstanceUrl,
  });
  return {
    // **출처 원장 계약은 안 건다.** 이 손은 아무것도 읽지 않았으므로 "읽은 근거"가 없는 게 맞다.
    // 대신 아래 `읽은상태: '후보만'` 이 그 사실을 명시한다 — 없는 계약을 흉내 내는 대신,
    // 무엇을 얻었는지를 스스로 밝힌다.
    sourceLedgerRequired: false,
    async handler(args) {
      const q = String(args?.query ?? args?.request ?? '').trim();
      if (!q) {
        return {
          blocked: true, fetchState: 'blocked',
          userSafeSummary: '무엇을 찾을지 알려주시면 찾아볼게요.',
          nextSafeAction: '찾을 말을 주시거나, 읽을 페이지 주소를 주시면 바로 읽을게요.',
          다음수단: [{ 방법: 'search', 왜: '찾을 말을 정해 다시 찾는다' }],
        };
      }
      const found = await search.search(q);
      if (found.state !== 'ok') {
        // **작동하는 경로가 없을 때만** 연결을 권한다(오너 지시 — `web-search.js` 머리말).
        const suggest = searchConnectionSuggestion({ searchState: found.state, hasKey: Boolean(deps.searchApiKey) });
        return {
          blocked: true, fetchState: 'blocked',
          userSafeSummary: suggest?.userSafeSummary ?? '지금은 웹에서 찾아보지 못했어요.',
          nextSafeAction: suggest?.nextSafeAction ?? '읽을 페이지 주소를 주시면 그건 바로 읽을 수 있어요.',
          // 못 찾았어도 **길은 남는다** — 주소를 알면 읽는 손이 바로 연다.
          다음수단: [{ 방법: 'search', 왜: '다른 말로 다시 찾는다' }],
        };
      }
      const 후보 = found.results.slice(0, 보여줄개수).map((r, i) => ({
        순위: i + 1, title: r.title ?? '', url: r.url, snippet: r.snippet ?? '',
      }));
      return {
        result: {
          검색어: q,
          provider: found.providerLabel ?? found.provider,
          후보,
          // **무엇을 얻었나.** 후보 목록이지 페이지 내용이 아니다. 이 한 칸이 없으면
          // 커널의 거짓 성공 게이트가 검색 성공을 "읽었다"로 세어 통째로 꺼진다(§4.7).
          읽은상태: '후보만',
          다음수단: [
            ...후보.map((c) => ({ 방법: 'read_url', url: c.url, 왜: `${c.순위}위: ${c.title || c.url}` })),
            { 방법: 'search', 왜: '다른 말로 다시 찾는다' },
          ],
        },
        // 영수증까지 그대로 흘려보낸다 — 읽기 성공과 섞이지 않게.
        읽은상태: '후보만',
        userSafeSummary: `‘${q}’ 로 ${후보.length}곳을 찾았어요(${found.providerLabel ?? found.provider}). 아직 열어 보지는 않았어요.`,
      };
    },
  };
}
