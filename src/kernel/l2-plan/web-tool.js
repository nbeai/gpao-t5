// L2 · WebToolDescriptor (P6-2 Slice-2). web.collect를 계약으로 확장한다.
// 핵심 불변식(깊은 감사): 웹 도구는 "검색했다/봤다"고 말하기 전에 반드시 source evidence가 있어야 한다.
//   출처 없는 성공은 계약 위반이다. assertWebEvidence가 이를 코드로 강제한다.
// 스크래핑 정책: 읽기 전용 · 대량수집 금지 · 외부 전송 금지 · 출처 원장 필수.
// (외부 소스 Watchlist는 감사 참고 자료일 뿐 여기 구현을 대체하지 않는다.)
import { defineTool } from './tool-descriptor.js';

// 웹 fetch 상태 — 로그인벽/차단/robots/봇벽을 성공과 분리한다(정직한 실패 분류).
export const WEB_FETCH_STATES = Object.freeze(['ok', 'login_wall', 'blocked', 'robots_disallow', 'bot_wall', 'timeout']);
// 브라우저 세션 개념.
/**
 * 출처 계약을 못 지킨 실행의 **사용자면 사실**. 한 자리에 둔다 —
 * 실행이 이걸 쓰고(ToolRunner), 답 검사가 이걸로 판정한다(읽은척차단).
 * 두 곳이 각자 문자열을 들고 있으면 조용히 갈라져 방어가 꺼진다.
 */
export const SOURCE_CONTRACT_FAILED = '출처를 확인하지 못해 결과를 신뢰할 수 없어요.';

export const SESSION_MODES = Object.freeze(['anonymous', 'authenticated', 'user_approved']);

/** 스크래핑 정책(고정). */
export function webSourcePolicy() {
  return { readOnly: true, noMassCollect: true, noExternalSend: true, sourceLedgerRequired: true };
}

/**
 * WebToolDescriptor 생성 — ToolDescriptor + 웹 계약(inputSchema·sourcePolicy·sessionMode).
 * @param {Object} d
 */
export function defineWebTool(d = {}) {
  const sessionMode = d.sessionMode ?? 'anonymous';
  // auth ≠ approval을 세션모드로 계약화(감사 보정):
  //  - anonymous     : 공개 읽기. [connected], 승인 불요.
  //  - authenticated : 저장된 자격으로 접속. [connected, auth](availability 축), 승인 불요.
  //  - user_approved : 사용자 승인 세션. 공개 읽기와 다르다 → needsApproval:true(approval 축).
  const availability = d.availability
    ?? (sessionMode === 'authenticated' ? [{ kind: 'connected' }, { kind: 'auth' }] : [{ kind: 'connected' }]);
  const base = defineTool({
    id: d.id ?? 'web.collect',
    label: d.label ?? '웹 자료 수집',
    owner: 'core',
    availability,
    toolKind: 'read', // 읽기 전용 — send/write 아님
    needsApproval: sessionMode === 'user_approved', // 사용자 승인 세션만 승인 경계
    // 하는 일은 **구현과 함께** 적는다. 라벨만 주면 모델이 없는 하위 기능을 지어낸다
    // (오너 실사용 2026-07-26: "다중 페이지 순회·CSV 내보내기"를 약속했지만 전부 미구현이었다).
    // P2-9: **못 하는 것도 능력의 일부다.** 이 도구가 어디까지인지 여기 없으면, 모델은 리뷰탭이나
    // 무한스크롤 뒤를 못 읽은 이유를 스스로 지어낸다(실측: "수집이 제한돼서" — 제한된 적 없다).
    //
    // P2-10 정정(2026-07-27): 예전 문장은 여기서 **브라우저를 띄워 조작하는 손이 없다고 단언**
    // 했다. 그 뒤 `browser.observe`·`browser.act` 가 배선됐는데도 이 줄이 안 바뀌어서,
    // 같은 능력 목록 안에서 web.collect 는 "그런 손 없다", browser.observe 는 "화면을 연다"고
    // 서로 다른 말을 했다. **있는 손을 없다고 말하는 것**이고, 모델이 둘 중 하나를 믿게 된다.
    //
    // 그래서 규칙을 세운다: **한 도구의 능력 설명은 다른 도구의 부재를 주장하지 않는다.**
    // 자기 한계만 말하고, 그 일을 하는 손이 따로 있으면 **그 손을 가리킨다.** 어떤 손이 실제로
    // 붙어 있는지는 도구함(선언 ⊆ 손)이 이미 아는 사실이고, 여기서 흉내 내면 두 진실이 된다.
    // `limits` 계약이 이 약속을 게이트가 검사할 수 있게 만든다(scripts/gate.mjs ③).
    capability: d.capability
      ?? '주소를 주면 그 페이지를 읽고, 주소가 없으면 찾아서 읽는다(읽기 전용). 읽은 내용은 출처와 함께 준다.'
        + ' 로그인이 필요하거나 수집을 막은 페이지는 읽지 못한다.'
        + ' 페이지를 **열어서 눌러 보지는 못한다** — 자바스크립트로 그려지거나 버튼·탭·더보기·스크롤 뒤에 있는'
        + ' 내용은 이 도구로는 들어오지 않는다. 그건 `browser.observe` 가 한다(실제 화면을 열어서 본다).'
        + ' 주소를 직접 받으면 그 주소로는 여기서도 읽을 수 있다.',
    operatorFact: d.operatorFact ?? '공개 웹 자료를 직접 찾아 읽고, 읽은 근거를 남긴다.',
    // 부정 주장은 **계약으로 선언한다** — 게이트가 "이 한계를 이미 다른 손이 하고 있지 않은가"를
    // 매번 검사할 수 있게. coveredBy 가 배선돼 있으면 능력 설명이 그 손을 가리켜야 한다.
    limits: d.limits ?? [
      { says: '로그인이 필요하거나 수집을 막은 페이지는 읽지 못한다' }, // 덮는 손 없음 = 진짜 한계
      { says: '자바스크립트로 그려지거나 버튼·탭 뒤에 있는 내용은 못 읽는다', coveredBy: 'browser.observe' },
    ],
    // 모델 노출 스키마(1축: 선언 한 자리). 설명이 정확해야 모델이 제대로 고른다 — 예전엔 "웹에서
    // 찾아 읽는다"라고만 해서 모델이 검색까지 이 도구로 하려다 robots·로그인벽에 막혀 빈손으로
    // 끝났다(오너 실사용: 네이버 지도). 검색은 모델 내장 검색이 더 강하다 — 역할을 나눠 준다.
    schema: {
      description: '주소의 원문을 직접 읽는다(빠르다).'
        + ' **사용자가 주소(URL)를 준 경우 먼저 이걸로 읽는다** — 기억이나 검색 요약이 아니라'
        + ' 그 페이지의 실제 내용을 읽고, 출처가 기록으로 남는다.'
        + ' 주소 없이 하는 일반 검색은 네 내장 검색이 더 낫다(그건 이 도구 없이 한다).'
        + ' robots 로 수집을 막은 곳, 로그인이 필요한 곳은 읽지 못한다.'
        // P2-10: 브라우저 손이 생겼다. 이 문장이 없으면 모델이 "반드시 web.collect"로 굳어
        // JS 로 그리는 화면에서 빈손으로 끝난다(실측: 사용자가 "브라우저로 열어"라고 했는데도
        // web.collect 를 골랐다). 도구끼리 서로를 알아야 흐름이 이어진다.
        + ' **자바스크립트로 그리는 화면(지도·SNS·탭이 있는 페이지)은 여기서 안 보인다** —'
        + ' 그럴 때나 사용자가 화면을 보라고 하면 `browser.observe` 로 실제 화면을 연다.',
      parameters: {
        type: 'object',
        properties: {
          request: { type: 'string', description: '찾을 것(검색어) 또는 읽을 주소' },
          selectionGoal: {
            type: 'string', enum: ['first_readable', 'latest_evidence'],
            description: '일반 읽기는 first_readable. 현재·최신·최근 사실을 묻는 경우 latest_evidence로 상위 후보의 발행·수정 시각을 비교한다.',
          },
        },
        required: ['request'],
      },
    },
  });
  return {
    ...base,
    inputSchema: {
      url: 'string?', searchQuery: 'string?', depth: 'number?',
      allowedDomains: 'string[]?', maxPages: 'number?', selectionGoal: 'first_readable|latest_evidence?',
    },
    sourcePolicy: webSourcePolicy(),
    // **계약을 손 사실로도 내보낸다.** sourcePolicy 안에만 있으면 selfState 로 못 가고,
    // 답 검사가 "출처를 못 댔다"를 판정할 근거가 없다(실측 2026-08-03).
    sourceLedgerRequired: webSourcePolicy().sourceLedgerRequired === true,
    sessionMode,
  };
}

// 정책 상한(대량수집 금지). 최소 슬라이스의 안전값.
const MAX_PAGES_CAP = 5;
const MAX_DEPTH_CAP = 2;

/**
 * 웹 입력 검증 — url 또는 searchQuery 중 하나 필수, maxPages/depth 상한, allowedDomains 경계.
 * @returns {{ok:boolean, reason?:string, normalized?:object}}
 */
export function validateWebInput(input = {}) {
  // Phase 0-2: 검색어도 대상이다(주소가 없으면 찾아서 읽는다). query·searchQuery·request 를 모두 받는다.
  const q = input.searchQuery ?? input.query ?? input.request;
  const hasTarget = (typeof input.url === 'string' && input.url) || (typeof q === 'string' && q.trim());
  if (!hasTarget) return { ok: false, reason: 'url 또는 searchQuery 필요' };
  const maxPages = Math.min(Number(input.maxPages ?? 1) || 1, MAX_PAGES_CAP); // 대량수집 금지
  const depth = Math.min(Number(input.depth ?? 0) || 0, MAX_DEPTH_CAP);
  const allowedDomains = Array.isArray(input.allowedDomains) ? input.allowedDomains : undefined;
  const selectionGoal = input.selectionGoal ?? 'first_readable';
  if (!['first_readable', 'latest_evidence'].includes(selectionGoal)) {
    return { ok: false, reason: 'selectionGoal invalid' };
  }
  // url은 hostname 기준으로 검증한다 — 문자열 includes는 ?next=a.com 같은 우회에 뚫린다(감사 보정).
  if (input.url) {
    let host;
    try { host = new URL(input.url).hostname.toLowerCase(); } catch { return { ok: false, reason: 'invalid url' }; }
    if (allowedDomains) {
      // exact host 또는 subdomain(*.dom)만 허용.
      const allowed = allowedDomains.some((dom) => {
        const d = String(dom).toLowerCase();
        return host === d || host.endsWith('.' + d);
      });
      if (!allowed) return { ok: false, reason: 'allowedDomains 밖 host' };
    }
  }
  return { ok: true, normalized: { url: input.url, searchQuery: input.searchQuery, depth, maxPages, allowedDomains, selectionGoal } };
}

// 짧은 결정적 해시(excerpt 지문). crypto 없이 djb2.
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * SourceEvidence 생성(출처 계약). "검색했다"의 근거.
 * @param {{sourceUrl:string, title?:string, excerpt?:string, confidence?:number, now?:number}} p
 * @returns {{sourceUrl:string, fetchedAt:number, title:string, excerptHash:string, confidence:number}}
 */
export function makeSourceEvidence(p) {
  if (!p || typeof p.sourceUrl !== 'string' || !p.sourceUrl) throw new TypeError('sourceEvidence: sourceUrl 필수');
  // confidence는 0~1로 clamp(범위 밖 값 방지, 감사 선택 보정).
  const c = typeof p.confidence === 'number' ? p.confidence : 0.5;
  return {
    sourceUrl: p.sourceUrl,
    fetchedAt: p.now ?? Date.now(),
    title: p.title ?? '',
    excerptHash: djb2(String(p.excerpt ?? '')),
    confidence: Math.max(0, Math.min(1, c)),
  };
}

/**
 * 핵심 불변식 강제: 웹 도구가 내용을 담은 성공을 돌려주려면 sources가 있어야 한다.
 * 출처 없는 "성공"은 계약 위반 — throw 하여 못 쓴 것을 쓴 척하지 못하게 한다.
 * @param {{result?:*, sources?:object[], blocked?:boolean, fetchState?:string}} out
 * @returns {{result?:*, sources:object[], userSafeSummary?:string}|{blocked:boolean}}
 */
export function assertWebEvidence(out) {
  const hasContent = out?.result !== undefined;
  const hasSources = Array.isArray(out?.sources) && out.sources.length > 0;
  const isFailure = out?.blocked === true || (out?.fetchState && out.fetchState !== 'ok');
  if (isFailure) {
    // 실패/차단/로그인벽/robots/봇벽/타임아웃은 내용·출처를 함께 담을 수 없다(성공처럼 섞이면 안 됨).
    // userSafeSummary·nextSafeAction만 허용(감사 보정 2).
    if (hasContent || hasSources) {
      throw new Error('web contract 위반: 실패/차단 상태는 result·sources를 담을 수 없다');
    }
    return out;
  }
  // 성공: 내용이 있으면 출처가 반드시 있어야 한다("검색했다/봤다"를 출처 없이 말 못 함).
  if (hasContent && !hasSources) {
    throw new Error('web contract 위반: 출처(sources) 없이 성공 결과를 반환할 수 없다');
  }
  return out;
}

/**
 * 웹 fetch 원시 결과 → 상태 분류(로그인벽/차단/robots/봇벽 분리).
 * @param {{status?:string, body?:string}} raw
 */
// 이만큼 건졌으면 "봤다"고 본다. 너무 낮으면 껍데기를 본문으로 오인하고, 너무 높으면 짧은 정상
// 페이지를 벽으로 오인한다.
export const MIN_READABLE_CHARS = 200;

export function classifyWebFetch(raw = {}) {
  // **본문을 실제로 건졌으면 그건 읽은 것이다.** 예전엔 본문 어딘가에 "로그인" 단어가 하나만 있어도
  // login_wall 로 판정했다 — 위키백과처럼 누구나 읽는 페이지도 전부 막힌 것으로 처리됐다(실측).
  // 한국 사이트 대부분에 로그인 링크가 있으니 사실상 2층 수집이 통째로 죽어 있었다.
  // 벽은 "아무것도 못 건졌는데 벽 신호만 있을 때" 판정한다.
  if (typeof raw.readableChars === 'number' && raw.readableChars >= MIN_READABLE_CHARS) return 'ok';
  const s = String(raw.status ?? raw.body ?? '').toLowerCase();
  if (/login|signin|sign in|로그인/.test(s)) return 'login_wall';
  if (/robots|disallow/.test(s)) return 'robots_disallow';
  if (/captcha|bot|봇|are you human/.test(s)) return 'bot_wall';
  if (/timeout|timed out/.test(s)) return 'timeout';
  if (/blocked|forbidden|403|접근|차단/.test(s)) return 'blocked';
  return 'ok';
}
