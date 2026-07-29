// L5 · T-cell replay 계약 (TG-0, 명세 §5.3) — 승격 전 재현 검증의 자료 계약.
// positive(되는 곳) · negative(안 되는 곳) · boundary(경계)를 **함께** 본다 — 효과와 침범을 같이.
import { randomUUID } from 'node:crypto';

export const REPLAY_KINDS = Object.freeze(['positive', 'negative', 'boundary']);

/** @returns {import('./tcell-replay.js').ReplayCase} */
export function makeReplayCase(input = {}) {
  return {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    sourceRefs: [...(input.sourceRefs ?? [])],
    inputFacts: input.inputFacts ?? {},
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
  if (!REPLAY_KINDS.includes(rc?.kind)) errors.push(`replay 종류가 계약 밖이에요: ${rc?.kind}`);
  if (!(rc?.sourceRefs?.length)) errors.push('sourceRefs 없는 replay 는 재현이 아니라 상상이에요');
  if (!(rc?.expected?.mustHold?.length) && !(rc?.expected?.mustNotHappen?.length)) {
    errors.push('기대(mustHold/mustNotHappen)가 비어 있어요');
  }
  return { ok: errors.length === 0, errors };
}
