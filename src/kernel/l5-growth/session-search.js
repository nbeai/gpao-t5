// L5 · Session Search (P6-17 Slice-1) — 과거 세션/대화 검색.
// **안전 불변식(핵심): 검색 결과는 raw 상태로 라우터·answer에 섞이지 않는다.**
//   검색 결과는 candidate로만 나오고, T5 admission(context-mesh)을 통과(userConfirmed)해야
//   이후 대화에 영향을 준다. "많이 찾음"이 아니라 "찾은 걸 사용자가 admit해야 영향".
// 재사용: context-mesh의 isRelevant(질의어 매치)·makeCandidate/isInfluenceEligible(승격 게이트).
import { isRelevant } from '../l1-intent/context-mesh.js';

// 검색에서 나온 회수 맥락의 kind. preference처럼 userConfirmed 전엔 영향 0(context-mesh 게이트가 강제).
export const RECALLED_KIND = 'recalled_context';

// transcript 엔트리에서 사람이 읽는 텍스트만 뽑는다(user 발화 / assistant reply). 진단면·내부구조 제외.
function entryText(entry) {
  if (!entry) return '';
  if (typeof entry.text === 'string') return entry.text;
  const r = entry.result;
  if (r && typeof r.reply === 'string') return r.reply;
  return '';
}

function matchRange(text, query) {
  const lower = text.toLocaleLowerCase();
  const q = query.toLocaleLowerCase();
  let at = lower.indexOf(q);
  let length = q.length;
  if (at < 0) {
    const found = q.split(/\s+/).filter(Boolean)
      .map((part) => ({ at: lower.indexOf(part), length: part.length }))
      .filter((x) => x.at >= 0).sort((a, b) => a.at - b.at)[0];
    if (found) ({ at, length } = found);
  }
  return at < 0 ? null : { at, length };
}

function clipAround(text, query, n = 180) {
  const t = String(text ?? '').trim();
  const matched = matchRange(t, query);
  if (!matched) return { snippet: t.length > n ? `${t.slice(0, n)}…` : t };
  const room = Math.max(0, n - matched.length);
  const start = Math.max(0, Math.min(matched.at - Math.floor(room / 2), t.length - n));
  const end = Math.min(t.length, start + n);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < t.length ? '…' : '';
  return {
    snippet: `${prefix}${t.slice(start, end)}${suffix}`,
    matchStart: prefix.length + matched.at - start,
    matchLength: matched.length,
    matchText: t.slice(matched.at, matched.at + matched.length),
  };
}

/**
 * 세션 transcript에서 질의어에 걸리는 조각을 찾는다(결정적 키워드 매치, 모델 아님).
 * 자기 과거 대화 회수라 세션 경계를 넘어 찾는다(가시성 경계 아님 — 영향 경계는 admission이 담당).
 * @param {Array<{id:string,title?:string,transcript?:Array}>} sessions
 * @param {string} query
 * @returns {Array<{sessionId:string, title?:string, role:string, snippet:string}>}
 */
export function searchTranscripts(sessions, query) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const hits = [];
  for (const s of sessions ?? []) {
    for (const [entryIndex, entry] of (s.transcript ?? []).entries()) {
      const text = entryText(entry);
      // isRelevant(질의어, 대화텍스트): 질의 단어가 대화에 나타나면 히트(조사 근사 포함).
      if (text && isRelevant(q, text)) {
        hits.push({ sessionId: s.id, title: s.title, role: entry.role, entryIndex, ...clipAround(text, q) });
      }
    }
  }
  return hits;
}

/**
 * 검색 히트 → admission 후보(ContextAdmissionPacket 호환). **admitted=false, 영향 0.**
 * context-mesh의 isInfluenceEligible이 userConfirmed 전엔 false를 주므로 라우터에 안 샌다.
 * @param {{sessionId:string, title?:string, role:string, snippet:string}} hit
 * @param {string} candidateId
 */
export function makeSearchCandidate(hit, candidateId) {
  return {
    candidateId,
    kind: RECALLED_KIND,
    statement: hit.snippet,
    source: {
      sessionId: hit.sessionId, title: hit.title, role: hit.role,
      entryIndex: hit.entryIndex, matchStart: hit.matchStart, matchLength: hit.matchLength, matchText: hit.matchText,
    }, // 출처(어느 대화의 어느 대목에서 왔는지)
    admitted: false,
    replayPassed: false,
    userConfirmed: false, // 사용자가 "이 맥락 써도 돼"라고 admit하기 전엔 영향 0
    rollbackable: true,
  };
}

/**
 * 검색 결과를 후보 목록으로 투영(모두 admitted:false). 서버·UI 표면이 이걸 보여준다 —
 * turn 모델 입력(admittedContext)에는 넣지 않는다.
 * @param {ReturnType<typeof searchTranscripts>} hits
 * @param {(i:number)=>string} idFor  결정적 id 발급(서버는 UUID, 테스트는 인덱스)
 */
export function projectSearchCandidates(hits, idFor) {
  return (hits ?? []).map((h, i) => makeSearchCandidate(h, idFor ? idFor(i) : `sc${i}`));
}
