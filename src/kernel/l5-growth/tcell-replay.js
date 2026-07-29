// L5 · T-cell replay 계약 (TG-0, 명세 §5.3) — 승격 전 재현 검증의 자료 계약.
// positive(되는 곳) · negative(안 되는 곳) · boundary(경계)를 **함께** 본다 — 효과와 침범을 같이.
import { randomUUID } from 'node:crypto';

/**
 * @typedef {Object} ReplayCase
 * @property {string} id
 * @property {'positive'|'negative'|'boundary'} kind
 * @property {string[]} sourceRefs
 * @property {Object} inputFacts
 * @property {{mustHold:string[], mustNotHappen:string[], expectedInfluenceRole:string|null, expectedActionKind:string|null}} expected
 *
 * @typedef {Object} ReplayResult
 * @property {string} id
 * @property {string|null} tcellId
 * @property {string|null} candidateVersionId
 * @property {Object[]} caseResults
 * @property {boolean} positivePassed
 * @property {boolean} negativePassed
 * @property {boolean} boundaryPassed
 * @property {boolean} authorityPassed
 * @property {boolean} tracePassed
 * @property {boolean} overallPassed
 * @property {number} createdAt
 */

export const REPLAY_KINDS = Object.freeze(['positive', 'negative', 'boundary']);

/** @returns {import('./tcell-replay.js').ReplayCase} */
export function makeReplayCase(input = {}) {
  return {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    sourceRefs: [...(input.sourceRefs ?? [])],
    inputFacts: input.inputFacts ?? {},
    // **권한 사례 표식**(§9.2). `minimumSuiteGaps` 가 `c.authority === true` 를 읽는데 공장이 그걸
    // 버리고 있었다 — 검사기가 요구하는 것을 생산자가 만들 수 없는 상태였다. 표식을 보존한다.
    ...(input.authority === true ? { authority: true } : {}),
    expected: {
      mustHold: [...(input.expected?.mustHold ?? [])],
      mustNotHappen: [...(input.expected?.mustNotHappen ?? [])],
      expectedInfluenceRole: input.expected?.expectedInfluenceRole ?? null,
      expectedActionKind: input.expected?.expectedActionKind ?? null,
    },
  };
}

/**
 * overallPassed 는 다섯 축의 **전원 통과**다(명세 §5.3 공식 그대로) — 부분 통과는 통과가 아니다.
 * @returns {import('./tcell-replay.js').ReplayResult}
 */
export function makeReplayResult(input = {}) {
  const flags = {
    positivePassed: input.positivePassed === true,
    negativePassed: input.negativePassed === true,
    boundaryPassed: input.boundaryPassed === true,
    authorityPassed: input.authorityPassed === true,
    tracePassed: input.tracePassed === true,
  };
  return {
    id: input.id ?? randomUUID(),
    tcellId: input.tcellId ?? null,
    candidateVersionId: input.candidateVersionId ?? null,
    caseResults: [...(input.caseResults ?? [])],
    ...flags,
    overallPassed: flags.positivePassed && flags.negativePassed && flags.boundaryPassed
      && flags.authorityPassed && flags.tracePassed,
    createdAt: input.createdAt ?? 0,
  };
}

/** @returns {{ok:boolean, errors:string[]}} */
export function validateReplayCase(rc) {
  const errors = [];
  try {
    if (!REPLAY_KINDS.includes(rc?.kind)) errors.push(`replay 종류가 계약 밖이에요: ${rc?.kind}`);
    const strA = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);
    if (!(strA(rc?.sourceRefs) && rc.sourceRefs.length)) errors.push('sourceRefs 없는 replay 는 재현이 아니라 상상이에요');
    if (!strA(rc?.expected?.mustHold ?? []) || !strA(rc?.expected?.mustNotHappen ?? [])) errors.push('기대 목록의 원소는 문자열이에요');
    const hold = Array.isArray(rc?.expected?.mustHold) ? rc.expected.mustHold : [];
    const not = Array.isArray(rc?.expected?.mustNotHappen) ? rc.expected.mustNotHappen : [];
    if (!hold.length && !not.length) errors.push('기대(mustHold/mustNotHappen)가 비어 있어요');
  } catch (e) { errors.push(`검증기 내부 오류: ${e?.message ?? e}`); }
  return { ok: errors.length === 0, errors };
}
