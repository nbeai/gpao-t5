// L3 · WebCollector — 실제 웹 수집 어댑터(P6-5). WebToolDescriptor(§6.6) 계약을 실행한다.
// 핵심 불변식: 봤으면 출처(SourceEvidence)를 반드시 남기고, 못 봤으면(로그인벽·봇벽·robots·차단)
//   내용·출처 없이 정직하게 상태만 돌린다. ToolRunner가 assertWebEvidence로 이를 강제한다.
// 정책: 읽기 전용(GET) · 대량수집 금지(validateWebInput maxPages cap) · 외부 전송 없음.
// 안전 규율: fetchImpl 주입 가능 — 테스트는 실네트워크 대신 로컬 서버/스텁을 쓴다.
import { validateWebInput, makeSourceEvidence, classifyWebFetch, MIN_READABLE_CHARS } from '../kernel/l2-plan/web-tool.js';
import { withTimeout } from './with-timeout.js';
import { sameSiteLinks } from '../kernel/l0-evidence/working-state.js';
import { makeWebSearch, searchConnectionSuggestion } from './web-search.js';
import { 검색드라이버 } from './search-slot.js';
import { makeHostManners, waitPhrase } from './host-manners.js';
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
  // 429 는 **봇 차단이 아니다** — 너무 자주 물어서 서버가 물러서라고 한 것이다.
  // 예전엔 bot_wall 로 묶어 "봇 차단이 걸려 있어요"라고 말했다(오너 지적). 사실이 아니고,
  // 사용자는 "이 사이트는 원래 안 되나 보다"로 오해한다. 잠시 뒤면 되는 일이다.
  if (status === 429 || status === 503) return 'rate_limited';
  if (status === 403) {
    const sig = classifyWebFetch({ body: ctx.body }); // 봇벽/캡차 신호면 bot_wall, 아니면 접근차단
    return sig === 'ok' ? 'blocked' : sig;
  }
  if (status >= 400) return 'blocked';
  if (status >= 200 && status < 300) {
    // 건진 본문을 **그대로** 넘긴다. 길이만 넘기면 판정은 원본 HTML 을 훑게 되고,
    // 메뉴의 "로그인" 낱말 하나로 공개 페이지가 벽이 된다(라이브 2026-08-05).
    return classifyWebFetch({ body: ctx.body, readable: ctx.readable, readableChars: ctx.readableChars });
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

const isoDate = (value) => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};

/** 최신성 비교에 쓰는 공개 문서 메타데이터. 날짜를 추측하지 않고 선언된 값만 읽는다. */
export function extractDocumentDates(html, headers) {
  const text = String(html ?? '');
  let publishedAt; let modifiedAt; let dateSource;
  const take = (kind, value, source) => {
    const normalized = isoDate(value);
    if (!normalized) return;
    if (kind === 'published' && !publishedAt) publishedAt = normalized;
    if (kind === 'modified' && !modifiedAt) modifiedAt = normalized;
    if (!dateSource) dateSource = source;
  };
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    take('published', value.datePublished, 'json_ld');
    take('modified', value.dateModified, 'json_ld');
    Object.values(value).forEach(walk);
  };
  for (const match of text.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(match[1])); } catch { /* 깨진 구조화 데이터는 사실로 쓰지 않는다 */ }
  }
  for (const tag of text.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)]
      .map((m) => [m[1].toLowerCase(), m[2]]));
    const key = String(attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key === 'article:published_time' || key === 'datepublished') take('published', attrs.content, 'meta');
    if (key === 'article:modified_time' || key === 'datemodified') take('modified', attrs.content, 'meta');
  }
  if (!publishedAt) {
    const time = /<time\b[^>]*datetime=["']([^"']+)["']/i.exec(text)?.[1];
    take('published', time, 'time');
  }
  if (!modifiedAt) take('modified', headers?.get?.('last-modified'), 'last_modified');
  return { ...(publishedAt ? { publishedAt } : {}), ...(modifiedAt ? { modifiedAt } : {}), ...(dateSource ? { dateSource } : {}) };
}

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
  rate_limited: '그 사이트에 너무 자주 물어봐서 잠시 막혔어요.',
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
/**
 * **본문의 어느 자리를 줄 것인가** — 파일 손의 `문` 과 같은 계약(`local-file.js`).
 *
 * 조용히 자르지 않는다. 얼마나 있고, 어디까지 줬고, 다음은 어디서 이어지는지 함께 낸다.
 *
 * **창 크기는 모델에게 실제로 닿는 크기여야 한다.** 재료 조립(`compactResult`)이 1,200자에서
 * 접으므로, 창을 그보다 크게 주면 **뒷단이 다시 접고 무엇이 접혔는지 아무도 모른다** —
 * 그게 그날 사고의 모양이었다(4,588자가 1,183자로 접히며 온도표가 통째로 사라졌다).
 * 그래서 창은 접히지 않을 만큼으로 두고, 부족하면 **문으로 더 부른다.**
 */
const 기본창 = 900;
function 읽기창(본문, args = {}) {
  const 총 = String(본문 ?? '').length;
  const 시작0 = Number(args?.offset);
  const 시작 = Number.isInteger(시작0) && 시작0 > 0 ? Math.min(시작0, 총) : 0;
  const 몇자0 = Number(args?.limit);
  const 몇자 = Number.isInteger(몇자0) && 몇자0 > 0 ? 몇자0 : 기본창;
  const 끝 = Math.min(시작 + 몇자, 총);
  return { 시작, 끝, 총, ...(끝 < 총 ? { 다음: 끝 } : {}) };
}

/**
 * **무엇을 어디서 읽었는가** — 사용자가 판단할 수 있는 한 토막.
 *
 * 제목만으로는 못 믿는다("Today"). 주소만으로는 못 읽는다. 둘 다, 그러나 **경로는 빼고**.
 * 전체 주소는 원장에 그대로 남는다 — 여기는 사람이 읽는 자리다.
 */
function 읽은곳말(title, sources = []) {
  let 어디;
  try { 어디 = new URL(sources?.[0]?.sourceUrl ?? '').hostname.replace(/^www\./, ''); } catch { 어디 = ''; }
  if (title && 어디) return `: ${title} (${어디})`;
  if (어디) return ` — ${어디}`;
  return title ? `: ${title}` : '';
}

export function makeWebCollector(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const { robotsCheck, now } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Phase 0-2: 주소가 없으면 **찾아서 실제로 읽는다**. 검색만 하고 스니펫으로 답하지 않는다 —
  // T5 가 직접 읽은 페이지만 출처가 된다(§ 출처 원장 계약, assertWebEvidence).
  // **드라이버 목록은 슬롯에서 온다**(S8). 안 넘기면 `web-search.js` 의 기본 배열로 떨어지고,
  // 그러면 새 검색기를 붙이려고 그 파일을 고쳐야 한다 — 인자 자리만 있고 등록할 자리가 없던
  // 그 상태가 **슬롯이 아니라 이음매**였다.
  const search = deps.search ?? makeWebSearch({
    fetchImpl, timeoutMs,
    providers: deps.searchProviders ?? 검색드라이버(),
    apiKey: deps.searchApiKey,
    instanceUrl: deps.searchInstanceUrl,
  });
  // P2-11: 사이트에 대한 예의. 같은 곳에 연달아 묻지 않고, 한 번 읽은 것은 다시 안 읽고,
  // 429 를 받으면 물러선다. 우회가 아니라 **우리가 429 를 만들지 않는 것**이다.
  const manners = deps.manners ?? makeHostManners();
  return {
    /** 읽은 페이지가 다음 턴의 대상이다 — 이어갈 같은 사이트 길까지 함께(계약: subjectOf). */
    subjectOf(rec) {
      const src = rec?.sources?.[0];
      if (!src?.sourceUrl) return null;
      return {
        key: src.sourceUrl, kind: 'web',
        label: src.title || rec.result?.title || src.sourceUrl,
        detail: src.sourceUrl,
        links: sameSiteLinks(src.sourceUrl, rec.result?.links),
      };
    },
    sourceLedgerRequired: true, // ToolRunner가 출처 없는 성공·내용 담은 실패를 막는다
    robotsCheck,                // 배선됐는지 밖에서 확인할 수 있게 노출(안 넘기면 검사가 통째로 안 돈다)
    manners,                    // 브라우저 손과 **같은 예의를 공유**한다(두 손이 따로 놀지 않게)
    async handler(args) {
      // turn은 generic하게 {request}만 넘기므로, url이 없으면 요청문에서 URL을 뽑아 본다.
      const norm = { ...(args ?? {}), url: args?.url ?? extractUrl(args?.request) };
      const v = validateWebInput(norm);
      if (!v.ok) return { blocked: true, fetchState: 'blocked', userSafeSummary: `수집할 수 없어요: ${v.reason}` };
      let { url, selectionGoal } = v.normalized;
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
      const groups = (candidates.length ? candidates : [url]).map((original, rank) => {
        const better = preferReadableUrl(original);
        return { original, rank: rank + 1, urls: better === original ? [original] : [better, original] };
      });
      const reads = [];
      let lastState = 'blocked';
      // **무엇을 실제로 시도했고 어디서 막혔나.** 둘 다 확인된 사실이다 — 못 본 페이지의
      // *내용*은 사실이 아니지만, *어디를 열어 봤고 무슨 벽이었나*는 우리가 밟은 것이다.
      // 이게 없으면 다음 수가 방금 막힌 곳을 다시 가리키고, 모델은 같은 벽에 두 번 부딪힌다.
      const 시도한주소 = new Set();
      const 막힌곳 = [];
      const 못읽음 = (url, state) => {
        lastState = state;
        if (!막힌곳.some((x) => x.url === url)) 막힌곳.push({ url, fetchState: state });
      };
      // **한 장을 여는가, 여러 장을 훑는가.** robots 는 뒤쪽에만 건다(아래 주석 참고).
      // 사용자가 물어서 여는 **첫 장**은 사용자가 직접 여는 것과 같다 — 거기엔 안 건다.
      // 두 번째 장부터는 우리가 스스로 더 보는 것이고, 그게 크롤이다.
      const 훑는중 = () => reads.length > 0;
      for (const group of groups) {
        let read = null;
        for (const candidate of group.urls) {
          let res; let body; let fetchState;
        // robots 는 **후보마다** 확인한다. 원래 주소로만 보면, 바꾼 주소가 허용인데도 시도조차 못 한다
        // (실측: map.naver.com 은 차단이지만 m.place.naver.com 은 허용이었다).
        // **robots 는 크롤러 규칙이다 — 사용자를 대신해 한 장 여는 것을 막는 규칙이 아니다.**
        //
        // 라이브(오너 2026-08-05): `오늘 한국 증시 상황 알려줘` 에 네이버 금융이 robots 로
        // 거부해 T5 가 웹을 못 쓰고 **사용자에게 지수를 알려 달라**고 요구했다(§0 정면 위반).
        // 오너: *"robots 내용은 법적 강제가 아니야. 이걸 지키는 걸 원칙으로 하면 정말 많은
        // 웹검색 및 서치 기능이 무용지물이 된다."* 맞다. 그리고 이 파일 위쪽 주석에 이미
        // 모순이 있었다 — "robots 를 지킨다" 옆에 "T5 는 크롤러가 아니라 **사용자 요청 1건을
        // 대신 여는** 도구다". 사용자가 자기 폰으로 열면 보이는 페이지다.
        //
        // 그래서 경계를 옮긴다. 막지 않는 것은 **지금 이 요청 한 건**이고,
        // **여러 장을 훑는 확장 탐색은 여전히 지킨다** — 그건 크롤이기 때문이다.
        // 예의(요청 간격·429 물러서기)는 다른 축이고 그대로다: 우리가 부하를 만들지 않는다.
        if (robotsCheck && 훑는중()) {
          let allowed = true;
          try { allowed = await robotsCheck(candidate); } catch { allowed = false; }
          if (!allowed) { 못읽음(candidate, 'robots_disallow'); continue; }
        }
        시도한주소.add(candidate);
        // ① 최근에 읽은 것은 **다시 열지 않는다.** 오늘 같은 주소를 열 번 넘게 다시 열어
        //    429 를 자초했다 — 그게 이 줄이 생긴 이유다.
        const hit = manners.cached(candidate);
        if (hit) { body = hit.value.body; res = hit.value.res; fetchState = 'ok'; }
        // ② 그 사이트가 쉬라고 했으면 **쉰다.** 시도조차 하지 않는다(제한을 더 늘리지 않게).
        const cooling = manners.coolingMs(candidate);
        if (!res && cooling > 0) { 못읽음(candidate, 'rate_limited'); continue; }
        // ③ 같은 곳에 연달아 묻지 않는다.
        if (!res) {
          await manners.pace(candidate);
          try {
            const controller = new AbortController();
            ({ res, body } = await withTimeout(async () => {
              const r = await fetchImpl(candidate, { redirect: 'follow', headers: FETCH_HEADERS, signal: controller.signal });
              const b = await r.text();
              return { res: r, body: b };
            }, timeoutMs, controller));
          } catch (e) {
            못읽음(candidate, 'timeout');
            continue; // 이 후보는 못 읽었다 — 다음 후보로
          }
        }
        if (res.status === 429 || res.status === 503) {
          manners.noteRateLimited(candidate, res.headers?.get?.('retry-after'));
          못읽음(candidate, 'rate_limited');
          continue;
        }
        // 본문을 먼저 뽑아 보고 판정한다 — 건진 게 있으면 벽이 아니다(로그인 링크 하나로 막던 오판 수정).
        const probe = extractReadable(body);
        // 벽 판정에 **원본 HTML 을 넘기지 않는다.** 넘기면 메뉴의 "로그인" 낱말 하나로
        // 공개 페이지가 벽이 되고, 여기서 걸리면 본문을 아예 안 읽는다 — 라이브에서
        // `오늘 코스피` 가 "로그인이 필요하다"로 끝난 자리다. 건진 알맹이로만 잰다.
        const 심긴맛보기 = extractHydrationText(body, { maxChars: 400 });
        const probeChars = Math.max(probe.살은글자 ?? 0, 심긴맛보기.length);
        fetchState = httpToFetchState(res.status, {
          body, readable: `${probe.알맹이글 ?? ''}\n${심긴맛보기}`, readableChars: probeChars,
        });
        // 껍데기는 **벽이 아니다** — 읽어는 봐야 다음 수단(링크·창)을 모델에게 줄 수 있다.
        if (fetchState === 'ok' || fetchState === 'shell') {
          manners.noteOk(candidate);
          manners.remember(candidate, { res, body }); // 다음에 같은 주소를 또 열지 않게
          read = { res, body, url: candidate, original: group.original, rank: group.rank };
          break;
        }
        못읽음(candidate, fetchState);
        }
        if (read) reads.push(read);
        if (read && selectionGoal !== 'latest_evidence') break;
      }
      // **안 가 본 후보.** 검색기가 실제로 돌려준 목록이고, 우리가 열어 보지 않은 곳이다.
      // 성공·실패 양쪽이 **같은 계산**을 쓴다 — 자리마다 따로 적으면 한쪽이 언젠가 빠지고,
      // 실제로 빠져 있던 쪽이 하필 **막힌 쪽**이었다(아래 주석).
      //
      // 이미 열어 본 곳은 뺀다. 방금 벽이었던 곳을 "다음 수"로 다시 내미는 것은 수가 아니다.
      // 다만 **robots 로 안 연 곳은 빼지 않는다** — 우리가 훑기를 접은 것이지 벽이 아니고,
      // 모델이 그 주소를 직접 읽기로 부르면 그건 사용자 대신 여는 한 장이라 열린다(0d82bed).
      // 무엇을 시도해 무슨 벽이었는지는 `막힌곳` 에 그대로 남으므로 판단 재료는 줄지 않는다.
      const 안가본후보 = (더뺄것 = []) => (foundVia?.candidates ?? [])
        .filter((c) => c.url && !시도한주소.has(c.url) && !더뺄것.includes(c.url))
        .slice(0, 5)
        .map((c) => ({ title: c.title ?? '', url: c.url }));
      const 후보로가는수 = (후보) => 후보.map((c) => ({
        방법: 'read_url', url: c.url, 왜: `검색에서 같이 나온 곳: ${c.title || c.url}`,
      }));
      // **검색은 늘 남아 있는 수다.** 주소 하나가 막혔다고 길이 끝나면 그게 막다른 답이다.
      const 다시찾기 = { 방법: 'search', 왜: '다른 자료로 검색을 다시 한다' };

      if (!reads.length) {
        // 못 봤다 — **내용·출처는 없다**(못 본 걸 본 척 금지). 그러나 **사실은 준다.**
        //
        // 라이브(오너 2026-08-05) `오늘 한국 증시 상황 알려줘`: 검색이 후보 다섯을 줬는데
        // 앞의 셋이 막혔다. 그러자 T5 는 *"대신 제가 아는 경로로 찾아볼게요"* 라 해 놓고
        // **아무 데도 안 갔다.** 손이 이미 나머지 후보를 쥐고 있었는데 한 칸도 안 나갔기 때문이다.
        //
        // 구멍의 모양은 이랬다 — `다음수단`·`다른후보` 를 **읽기에 성공한 뒤에만** 만들었다.
        // 그래서 **다음 수가 정확히 필요한 자리에서만 다음 수가 없었다.** 뒤집힌 것이다.
        //
        // 실패한 호출의 *내용*을 안 싣는 계약은 옳고 그대로 둔다. 그런데 안 가 본 후보는
        // 막힌 페이지의 내용이 아니라 **검색기가 실제로 돌려준 목록**이다. 확인된 사실이고,
        // 이걸 같이 버린 것이 구멍이었다. 어디로 갈지는 여기서 정하지 않는다 — 모델이 둔다.
        const 다른후보 = 안가본후보();
        return {
          blocked: true,
          fetchState: lastState,
          ...(다른후보.length ? { 다른후보 } : {}),
          다음수단: [...후보로가는수(다른후보), 다시찾기],
          ...(막힌곳.length ? { 막힌곳 } : {}),
          userSafeSummary: WALL_MESSAGE[lastState] ?? WALL_MESSAGE.blocked,
          // 속도 제한은 **잠시 뒤면 되는 일**이다. "안 되는 사이트"로 오해하게 두지 않는다.
          nextSafeAction: lastState === 'rate_limited'
              ? `${waitPhrase(manners.coolingMs(groups[0]?.urls?.[0])) || '잠시'} 뒤에 다시 열어 볼까요? 그동안 아는 범위로 정리해 드릴 수도 있어요.`
            : (candidates.length
              ? '다른 자료로 다시 찾아볼까요? 보고 싶은 페이지 주소를 주시면 그건 바로 읽을 수 있어요.'
              : '주소를 다시 확인해 주시겠어요?'),
        };
      }

      // 봤다 — 출처 근거(SourceEvidence)를 반드시 만든다.
      // 추출 품질(Phase 0-2b, 기준: Crawl4AI "LLM-ready Markdown"): 껍데기를 걷고 제목·문단·목록·
      // 표의 구조를 남긴다. 앞 500자를 자르면 네비게이션·쿠키 배너가 본문이 된다(이전 동작).
      const pages = reads.map((read) => {
        const title = extractTitle(read.body);
        const description = extractDescription(read.body);
        let { markdown, blocks, 살은글자, 알맹이글 } = extractReadable(read.body);
      // 요즘 페이지는 본문을 태그가 아니라 **스크립트 안 JSON** 으로 준다. 브라우저를 안 띄우고도
      // 대부분 읽힌다(실측: 네이버 플레이스의 상호·주소·메뉴가 전부 HTML 안에 있었다).
      //
      // 예전엔 `태그 글이 짧을 때만` 그걸 봤다. 라이브(2026-08-05) 사고가 거기서 났다:
      //     extractReadable → 757자   (전부 알림 배너·쿠키 문구)
      //     MIN_READABLE_CHARS(200) 을 넘으니 **심긴 데이터는 아예 안 봤다**
      // 그날 기온은 그 JSON 안에 있었고(`"temp":"35°"`), 모델은 하나도 못 받은 채 계절 상식으로
      // 지어냈다. **길이로 "본문이 있다"를 판정하면 껍데기 문구가 본문 자격을 딴다.**
      //
      // 그래서 **고르지 않는다** — 둘 다 준다. 태그 글이 먼저, 심긴 데이터가 뒤.
      // 길면 버리는 게 아니라 창(`readWindow`)으로 닿는다.
      const 심긴것 = extractHydrationText(read.body);
      if (심긴것) {
        markdown = (markdown ?? '').length < MIN_READABLE_CHARS
          ? 심긴것
          : `${markdown}\n\n${심긴것}`;
        살은글자 += 심긴것.length;   // 스크립트에 심긴 데이터는 메뉴가 아니다 — 알맹이다
        알맹이글 = `${알맹이글}\n${심긴것}`;
      }
        const resolvedUrl = read.res.url || read.url;
        const links = extractLinks(read.body, resolvedUrl);
        const dates = extractDocumentDates(read.body, read.res.headers);
        return { ...read, title, description, markdown, blocks, 살은글자, 알맹이글, links, resolvedUrl, ...dates };
      });
      const timestamp = (page) => Date.parse(page.publishedAt ?? page.modifiedAt ?? '');
      const selected = selectionGoal === 'latest_evidence'
        ? pages.reduce((best, page) => Number.isFinite(timestamp(page)) && (!Number.isFinite(timestamp(best)) || timestamp(page) > timestamp(best)) ? page : best, pages[0])
        : pages[0];
      const { title, description, markdown: 본문전체, blocks, 살은글자, 알맹이글, links } = selected;
      // **웹도 문을 갖는다**(라이브 2026-08-05). 본문이 길면 조용히 접히는 것이 아니라
      // **창을 옮겨 더 읽을 수 있어야 한다** — `local.file list` 가 이미 그렇게 한다.
      // 그날 사고: 본문 4,588자가 재료 조립에서 1,183자로 접히며 **온도표가 통째로 가운데**라
      // 모델이 본 온도값이 0개였다. 폭염경보(37.9°C·체감 43.7°C) 날에 "31도, 얇은 우산"이 나갔다.
      // 상한을 올리는 것은 실측으로 이미 기각됐다(1200→6000 을 써도 이름은 3분의 1) —
      // 그때 세운 답이 **문**이고, 웹 손만 그 문이 없었다.
      const 창 = 읽기창(본문전체, args);
      const markdown = 본문전체.slice(창.시작, 창.끝);
      const excerpt = description || markdown.slice(0, 500); // 출처 근거용 짧은 발췌
      const sources = pages.map((page) => makeSourceEvidence({
        sourceUrl: page.resolvedUrl, title: page.title,
        excerpt: page.description || page.markdown.slice(0, 500), confidence: 0.6, now: now?.(),
      }));
      const comparisonCandidates = selectionGoal === 'latest_evidence' ? pages.map((page) => ({
        rank: page.rank, title: page.title, url: page.resolvedUrl,
        excerpt: (page.description || page.markdown).slice(0, 240),
        ...(page.publishedAt ? { publishedAt: page.publishedAt } : {}),
        ...(page.modifiedAt ? { modifiedAt: page.modifiedAt } : {}),
        ...(page.dateSource ? { dateSource: page.dateSource } : {}),
      })) : undefined;
      // **멈추지 않는다**(오너 2026-08-05): *"해당 사이트가 로그인을 구체적으로 요구하는
      // 허들로 제시하지 않으면 멈춰서는 안 되지!"*
      //
      // 그날 `오늘 코스피, 코스닥 상황 알려줘` 에 T5 가 "로그인이 필요하다"며 멈췄다. 막힌 게
      // 아니라 **메뉴뿐인 페이지를 읽고** 메뉴 안의 "로그인" 낱말을 벽으로 오해한 것이었다.
      //
      // 그래서 어떤 결과든 **막다른 답이 되지 않게** 두 가지를 함께 싣는다:
      //   `읽은상태` — 알맹이를 얻었나(ok), 껍데기였나(shell), 사이트가 정말 요구했나(login_wall)
      //   `다음수단` — 지금 바로 부를 수 있는 다른 길(같은 사이트의 다른 자리, 다른 검색어)
      // 창(`readWindow`)이 "같은 페이지의 뒷부분"을 주는 것과 같은 계약을, **목적을 이룰 다른
      // 길**로 넓힌 것이다. 커널은 무엇이 옳은지 정하지 않는다 — 쓸 수 있는 수를 주고 모델이 둔다.
      const 읽은상태 = classifyWebFetch({ readable: 알맹이글, readableChars: 살은글자 });
      // **읽었다고 끊지 않는다.** 라이브(2026-08-05) `오늘 한국 증시 상황은 어때?`:
      // 검색 첫 결과가 마케팅 페이지였고 알맹이 602자(회사 소개·주소)를 건져 `ok` 가 됐다.
      // 지수 숫자는 0개였는데 다음 수가 끊겨, 모델은 **사용자에게 대신 찾아보라고 넘겼다.**
      //
      // "알맹이가 있다"와 "물은 것의 답이 있다"는 다르다. 그렇다고 **커널이 관련성을 재면
      // 안 된다** — 내용 판정은 심문의 부활이다(절대원칙 8). 그러니 재지 않고 **끊지 않는다.**
      // 관련 없다는 판단은 모델이 하고, 커널은 둘 수 있는 수를 늘 열어 둔다.
      // 막힌 쪽과 **같은 계산**을 쓴다(위 `안가본후보`). 예전엔 이 자리에만 있었고, 그래서
      // 성공한 턴에는 다음 수가 넉넉하고 막힌 턴에는 하나도 없었다.
      const 다른후보 = 안가본후보([selected.resolvedUrl, selected.url]);
      const 다음수단 = [
        ...(Number.isInteger(창.다음) ? [{ 방법: 'read_more', offset: 창.다음, 왜: '이 페이지의 뒷부분이 남았다' }] : []),
        // **검색으로 왔으면 나머지 후보가 살아 있다.** 첫 개가 답이라고 커널이 정하지 않는다.
        ...후보로가는수(다른후보),
        ...links.slice(0, 5).map((l) => ({ 방법: 'read_url', url: l.url, 왜: `이 페이지가 가리키는 곳: ${l.text}` })),
        다시찾기,
      ];
      return {
        result: {
          title, excerpt, description, markdown, blocks, links,
          // **무엇을 얻었고 무엇이 없나.** 이게 없으면 모델은 읽은 줄 알고 그 위에 지어낸다.
          읽은상태, substanceChars: 살은글자, 다음수단,
          ...(다른후보.length ? { 다른후보 } : {}),
          // P2-9: **사후 기록**이다 — 발화에서 예측한 분류가 아니라 실제로 무엇을 했는가.
          // 둘이면 충분하다. 큰 분류 체계(routeKind 11개)는 만들지 않는다(§24 · 절대원칙 8).
          // **얼마나 있고 어디까지 줬는지.** 모델이 다음을 부를 수 있어야 막다른 답이 안 된다.
          readWindow: 창,
          surfaceAction: foundVia ? 'search_then_read' : 'read_url',
          ...(foundVia ? { foundVia } : {}),
          ...(comparisonCandidates ? { comparisonCandidates } : {}),
        },
        sources,
        // 찾아서 읽었으면 "찾아서 읽었다"고 말한다 — 검색만 하고 아는 척하지 않는다.
        //
        // **어디서 읽었는지도 말한다**(라이브 2026-08-05). `오늘 날씨 어때?` 에 T5 가 실제
        // 시간별 기온을 읽고 정확히 답했는데, 화면에는 `찾아서 읽었어요: Today` 만 떴다.
        // 제목이 "Today" 뿐이라 사용자는 **그게 서울 날씨인지 오늘 날짜 안내인지 광고인지**
        // 알 수 없었다 — 오너가 "답변이 정상이 아닌 것 같다"고 한 자리다.
        // 답은 정상이었고 **근거 표시가 판단 불가능**했다. 거짓말은 아니지만 **아는 것보다
        // 덜 말한 것**이다 — 어디서 읽었는지는 `sources[].sourceUrl` 에 그대로 있었다.
        //
        // 경로까지 싣지는 않는다. 사용자면 문장은 읽는 것이지 복사하는 것이 아니고,
        // 전체 주소는 원장에 남는다.
        userSafeSummary: `${읽은상태 === 'shell' ? '열어 봤는데 메뉴뿐이라 알맹이가 없었어요' : (foundVia ? '찾아서 읽었어요' : '공개 자료로 확인했어요')}`
          + `${읽은곳말(title, sources)}.`
          // **얼마나 읽었는지도 말한다.** 조용히 자르지 않는 계약은 사용자면에서도 선다.
          + `${Number.isInteger(창.다음) ? ` 본문 ${창.총}자 중 ${창.끝}자까지 읽었어요.` : ''}`,
      };
    },
  };
}
