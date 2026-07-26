// L3 · WebCollector — 실제 웹 수집 어댑터(P6-5). WebToolDescriptor(§6.6) 계약을 실행한다.
// 핵심 불변식: 봤으면 출처(SourceEvidence)를 반드시 남기고, 못 봤으면(로그인벽·봇벽·robots·차단)
//   내용·출처 없이 정직하게 상태만 돌린다. ToolRunner가 assertWebEvidence로 이를 강제한다.
// 정책: 읽기 전용(GET) · 대량수집 금지(validateWebInput maxPages cap) · 외부 전송 없음.
// 안전 규율: fetchImpl 주입 가능 — 테스트는 실네트워크 대신 로컬 서버/스텁을 쓴다.
import { validateWebInput, makeSourceEvidence, classifyWebFetch, MIN_READABLE_CHARS } from '../kernel/l2-plan/web-tool.js';
import { withTimeout } from './with-timeout.js';
import { makeWebSearch, searchConnectionSuggestion } from './web-search.js';
import { extractTitle, extractDescription, extractReadable, extractLinks, extractHydrationText } from './readable.js';

/**
 * HTTP 응답 → fetchState. 코드 + 본문 신호로 로그인벽/봇벽/robots/차단을 성공과 분리한다.
 * 200이어도 로그인·캡차 페이지를 200으로 주는 사이트가 있어 본문 신호를 함께 본다.
 * @param {number} status
 * @param {{body?:string}} [ctx]
 * @returns {'ok'|'login_wall'|'bot_wall'|'robots_disallow'|'blocked'}
 */
export function httpToFetchState(status, ctx = {}) {
  if (status === 401) return 'login_wall';
  if (status === 429) return 'bot_wall';
  if (status === 403) {
    const sig = classifyWebFetch({ body: ctx.body }); // 봇벽/캡차 신호면 bot_wall, 아니면 접근차단
    return sig === 'ok' ? 'blocked' : sig;
  }
  if (status >= 400) return 'blocked';
  if (status >= 200 && status < 300) {
    // 건진 본문 길이를 함께 넘긴다 — 실제로 읽었으면 벽으로 판정하지 않는다.
    return classifyWebFetch({ body: ctx.body, readableChars: ctx.readableChars });
  }
  return 'blocked'; // 3xx 미해결·기타
}

// 의존성 0의 최소 HTML 파싱(제목·발췌). 대량 파서 도입은 과잉 — 발췌 지문만 있으면 출처 계약 충족.

// 사용자 대신 페이지를 여는 도구의 신원. **robots.txt 는 계속 지킨다**(사이트의 명시적 거부는 존중).
// UA 는 다르다: 봇 식별자를 밝히면 네이버 등 주요 서비스가 429 로 막는데(실측), 그 페이지는 사용자가
// 자기 폰으로 열면 보이는 공개 페이지다. T5 는 크롤러가 아니라 **사용자 요청 1건을 대신 여는** 도구다.
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  + ' (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const FETCH_HEADERS = {
  'user-agent': BROWSER_UA,
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/**
 * 한국 서비스는 데스크톱 주소가 자바스크립트로 그리는 껍데기라 읽히지 않는다. **모바일 주소는 내용을
 * HTML 로 준다**(오너 지시 + 실측: map.naver.com 은 robots 차단, m.place.naver.com 은 허용·본문 있음).
 * 사례 하드코딩이 아니라 "그 서비스가 모바일 SSR 을 준다"는 사실을 반영한 읽기 전략이다.
 */
export function preferReadableUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return raw; }
  const host = u.hostname.toLowerCase();
  // 네이버 지도/플레이스: 지도 경로의 place id 를 모바일 플레이스 주소로.
  if (host === 'map.naver.com' || host === 'naver.me') {
    const id = u.pathname.match(/place\/(\d+)/)?.[1] ?? u.searchParams.get('id');
    if (id) return `https://m.place.naver.com/place/${id}/home`;
  }
  if (host === 'place.naver.com') return `https://m.place.naver.com${u.pathname}${u.search}`;
  // 그 외 네이버 계열은 모바일 호스트가 같은 경로를 SSR 로 준다.
  if (/^(search|blog|news|cafe|shopping)\.naver\.com$/.test(host)) {
    return `https://m.${host}${u.pathname}${u.search}`;
  }
  return raw;
}

// freeform 요청문에서 첫 http(s) URL을 뽑는다(turn은 generic하게 {request}만 넘긴다 — 웹 로직은 여기서).
function extractUrl(text) {
  const m = /(https?:\/\/[^\s"'<>]+)/i.exec(String(text ?? ''));
  return m ? m[1] : undefined;
}

const WALL_MESSAGE = {
  login_wall: '로그인이 필요한 페이지예요.',
  bot_wall: '봇 차단이 걸려 있어요.',
  robots_disallow: '그 사이트가 수집을 허용하지 않아요.',
  blocked: '그 사이트가 접근을 막고 있어요.',
  timeout: '그 페이지를 불러오지 못했어요.',
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 실제 웹 수집 도구 핸들러를 만든다. WebToolDescriptor 계약(sourceLedgerRequired)을 켠다.
 * @param {{fetchImpl?:Function, robotsCheck?:(url:string)=>Promise<boolean>, now?:()=>number, timeoutMs?:number}} [deps]
 * @returns {{sourceLedgerRequired:true, handler:(args:*)=>Promise<object>}}
 */
export function makeWebCollector(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const { robotsCheck, now } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Phase 0-2: 주소가 없으면 **찾아서 실제로 읽는다**. 검색만 하고 스니펫으로 답하지 않는다 —
  // T5 가 직접 읽은 페이지만 출처가 된다(§ 출처 원장 계약, assertWebEvidence).
  const search = deps.search ?? makeWebSearch({
    fetchImpl, timeoutMs,
    apiKey: deps.searchApiKey,
    instanceUrl: deps.searchInstanceUrl,
  });
  return {
    sourceLedgerRequired: true, // ToolRunner가 출처 없는 성공·내용 담은 실패를 막는다
    robotsCheck,                // 배선됐는지 밖에서 확인할 수 있게 노출(안 넘기면 검사가 통째로 안 돈다)
    async handler(args) {
      // turn은 generic하게 {request}만 넘기므로, url이 없으면 요청문에서 URL을 뽑아 본다.
      const norm = { ...(args ?? {}), url: args?.url ?? extractUrl(args?.request) };
      const v = validateWebInput(norm);
      if (!v.ok) return { blocked: true, fetchState: 'blocked', userSafeSummary: `수집할 수 없어요: ${v.reason}` };
      let { url } = v.normalized;
      let foundVia = null;
      let candidates = [];

      // 주소가 없으면 찾아본다(말귀: "주소를 주면 읽고, 없으면 찾아서 읽는다").
      if (!url) {
        const q = String(args?.query ?? args?.request ?? '').trim();
        const found = await search.search(q);
        if (found.state !== 'ok') {
          // **작동하는 경로가 없을 때만** 연결을 권한다. 되는 경로가 있으면 이 문구는 만들어지지 않는다.
          const suggest = searchConnectionSuggestion({ searchState: found.state, hasKey: Boolean(deps.searchApiKey) });
          return {
            blocked: true, fetchState: 'blocked',
            userSafeSummary: suggest?.userSafeSummary ?? '무엇을 찾을지 알려주시면 찾아볼게요.',
            nextSafeAction: suggest?.nextSafeAction,
          };
        }
        candidates = found.results.slice(0, 3).map((r) => r.url); // 첫 결과가 막히면 다음 후보로
        url = candidates[0];
        foundVia = { provider: found.providerLabel, query: q, candidates: found.results.slice(0, 5) };
      }

      // 찾아서 읽는 경우 첫 후보가 막힐 수 있다(로그인벽·봇벽). **다음 후보로 넘어간다** —
      // 하나 막혔다고 "못 찾았다"고 하면 막다른 답이 된다(실사용에서 첫 결과가 봇벽이었다).
      // 읽기 쉬운 주소가 있으면 그것으로 바꾼다(데스크톱 SPA → 모바일 SSR). 원래 주소도 남겨 둔다 —
      // 모바일이 막히면 원래 주소로 다시 시도한다(한 번 바꿨다고 길을 잃지 않게).
      const tryUrls = (candidates.length ? candidates : [url])
        .flatMap((u) => { const better = preferReadableUrl(u); return better === u ? [u] : [better, u]; });
      let res, body, fetchState, lastState = 'blocked';
      for (const candidate of tryUrls) {
        // robots 는 **후보마다** 확인한다. 원래 주소로만 보면, 바꾼 주소가 허용인데도 시도조차 못 한다
        // (실측: map.naver.com 은 차단이지만 m.place.naver.com 은 허용이었다).
        if (robotsCheck) {
          let allowed = true;
          try { allowed = await robotsCheck(candidate); } catch { allowed = false; }
          if (!allowed) { lastState = 'robots_disallow'; res = null; continue; }
        }
        try {
          const controller = new AbortController();
          ({ res, body } = await withTimeout(async () => {
            const r = await fetchImpl(candidate, { redirect: 'follow', headers: FETCH_HEADERS, signal: controller.signal });
            const b = await r.text();
            return { res: r, body: b };
          }, timeoutMs, controller));
        } catch (e) {
          lastState = 'timeout';
          res = null;
          continue; // 이 후보는 못 읽었다 — 다음 후보로
        }
        // 본문을 먼저 뽑아 보고 판정한다 — 건진 게 있으면 벽이 아니다(로그인 링크 하나로 막던 오판 수정).
        const probe = extractReadable(body);
        const probeChars = Math.max((probe.markdown ?? '').length, extractHydrationText(body, { maxChars: 400 }).length);
        fetchState = httpToFetchState(res.status, { body, readableChars: probeChars });
        if (fetchState === 'ok') { url = candidate; break; }
        lastState = fetchState;
        res = null;
      }
      if (!res || fetchState !== 'ok') {
        // 못 봤다 — 내용·출처 없이 상태만. "못 본 걸 본 척" 금지. 다음 행동은 준다.
        return {
          blocked: true,
          fetchState: lastState,
          userSafeSummary: WALL_MESSAGE[lastState] ?? WALL_MESSAGE.blocked,
          nextSafeAction: candidates.length
            ? '다른 자료로 다시 찾아볼까요? 보고 싶은 페이지 주소를 주시면 그건 바로 읽을 수 있어요.'
            : '주소를 다시 확인해 주시겠어요?',
        };
      }

      // 봤다 — 출처 근거(SourceEvidence)를 반드시 만든다.
      // 추출 품질(Phase 0-2b, 기준: Crawl4AI "LLM-ready Markdown"): 껍데기를 걷고 제목·문단·목록·
      // 표의 구조를 남긴다. 앞 500자를 자르면 네비게이션·쿠키 배너가 본문이 된다(이전 동작).
      const title = extractTitle(body);
      const description = extractDescription(body);
      let { markdown, blocks } = extractReadable(body);
      // 껍데기만 온 페이지(SPA)면 HTML 안에 심긴 초기 상태에서 읽을 것을 건진다. 브라우저를 띄우지
      // 않고도 대부분 읽힌다(실측: 네이버 플레이스의 상호·주소·메뉴가 전부 HTML 안에 있었다).
      if ((markdown ?? '').length < MIN_READABLE_CHARS) {
        const hydrated = extractHydrationText(body);
        if (hydrated.length > (markdown ?? '').length) { markdown = hydrated; blocks = 0; }
      }
      const links = extractLinks(body, res.url || url);
      const excerpt = description || markdown.slice(0, 500); // 출처 근거용 짧은 발췌
      const source = makeSourceEvidence({ sourceUrl: res.url || url, title, excerpt, confidence: 0.6, now: now?.() });
      return {
        result: {
          title, excerpt, description, markdown, blocks, links,
          // P2-9: **사후 기록**이다 — 발화에서 예측한 분류가 아니라 실제로 무엇을 했는가.
          // 둘이면 충분하다. 큰 분류 체계(routeKind 11개)는 만들지 않는다(§24 · 절대원칙 8).
          surfaceAction: foundVia ? 'search_then_read' : 'read_url',
          ...(foundVia ? { foundVia } : {}),
        },
        sources: [source],
        // 찾아서 읽었으면 "찾아서 읽었다"고 말한다 — 검색만 하고 아는 척하지 않는다.
        userSafeSummary: foundVia
          ? `찾아서 읽었어요${title ? `: ${title}` : ''}.`
          : `공개 자료로 확인했어요${title ? `: ${title}` : ''}.`,
      };
    },
  };
}
