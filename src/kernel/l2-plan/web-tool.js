// L2 · WebToolDescriptor (P6-2 Slice-2). web.collect를 계약으로 확장한다.
// 핵심 불변식(깊은 감사): 웹 도구는 "검색했다/봤다"고 말하기 전에 반드시 source evidence가 있어야 한다.
//   출처 없는 성공은 계약 위반이다. assertWebEvidence가 이를 코드로 강제한다.
// 스크래핑 정책: 읽기 전용 · 대량수집 금지 · 외부 전송 금지 · 출처 원장 필수.
// (외부 소스 Watchlist는 감사 참고 자료일 뿐 여기 구현을 대체하지 않는다.)
import { defineTool } from './tool-descriptor.js';

// 웹 fetch 상태 — 로그인벽/차단/robots/봇벽을 성공과 분리한다(정직한 실패 분류).
export const WEB_FETCH_STATES = Object.freeze(['ok', 'login_wall', 'blocked', 'robots_disallow', 'bot_wall', 'timeout']);
// 브라우저 세션 개념.
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
  const base = defineTool({
    id: d.id ?? 'web.collect',
    label: d.label ?? '웹 자료 수집',
    owner: 'core',
    availability: d.availability ?? [{ kind: 'connected' }],
    toolKind: 'read', // 읽기 전용 — send/write 아님
    needsApproval: false, // 공개 읽기는 A0. user_approved 세션은 별도 승인(auth≠approval)
  });
  return {
    ...base,
    inputSchema: {
      url: 'string?', searchQuery: 'string?', depth: 'number?',
      allowedDomains: 'string[]?', maxPages: 'number?',
    },
    sourcePolicy: webSourcePolicy(),
    sessionMode: d.sessionMode ?? 'anonymous',
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
  const hasTarget = (typeof input.url === 'string' && input.url) || (typeof input.searchQuery === 'string' && input.searchQuery);
  if (!hasTarget) return { ok: false, reason: 'url 또는 searchQuery 필요' };
  const maxPages = Math.min(Number(input.maxPages ?? 1) || 1, MAX_PAGES_CAP); // 대량수집 금지
  const depth = Math.min(Number(input.depth ?? 0) || 0, MAX_DEPTH_CAP);
  const allowedDomains = Array.isArray(input.allowedDomains) ? input.allowedDomains : undefined;
  // url이 allowedDomains 밖이면 거부(경계).
  if (input.url && allowedDomains && !allowedDomains.some((dom) => String(input.url).includes(dom))) {
    return { ok: false, reason: 'allowedDomains 밖 url' };
  }
  return { ok: true, normalized: { url: input.url, searchQuery: input.searchQuery, depth, maxPages, allowedDomains } };
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
  return {
    sourceUrl: p.sourceUrl,
    fetchedAt: p.now ?? Date.now(),
    title: p.title ?? '',
    excerptHash: djb2(String(p.excerpt ?? '')),
    confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
  };
}

/**
 * 핵심 불변식 강제: 웹 도구가 내용을 담은 성공을 돌려주려면 sources가 있어야 한다.
 * 출처 없는 "성공"은 계약 위반 — throw 하여 못 쓴 것을 쓴 척하지 못하게 한다.
 * @param {{result?:*, sources?:object[], blocked?:boolean, fetchState?:string}} out
 * @returns {{result?:*, sources:object[], userSafeSummary?:string}|{blocked:boolean}}
 */
export function assertWebEvidence(out) {
  if (out?.blocked || (out?.fetchState && out.fetchState !== 'ok')) return out; // 실패/차단은 내용 없음 — 통과
  const hasContent = out?.result !== undefined;
  const hasSources = Array.isArray(out?.sources) && out.sources.length > 0;
  if (hasContent && !hasSources) {
    throw new Error('web contract 위반: 출처(sources) 없이 성공 결과를 반환할 수 없다');
  }
  return out;
}

/**
 * 웹 fetch 원시 결과 → 상태 분류(로그인벽/차단/robots/봇벽 분리).
 * @param {{status?:string, body?:string}} raw
 */
export function classifyWebFetch(raw = {}) {
  const s = String(raw.status ?? raw.body ?? '').toLowerCase();
  if (/login|signin|sign in|로그인/.test(s)) return 'login_wall';
  if (/robots|disallow/.test(s)) return 'robots_disallow';
  if (/captcha|bot|봇|are you human/.test(s)) return 'bot_wall';
  if (/timeout|timed out/.test(s)) return 'timeout';
  if (/blocked|forbidden|403|접근|차단/.test(s)) return 'blocked';
  return 'ok';
}
