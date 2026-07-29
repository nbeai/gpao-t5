// L5 · T-Sphere 계약 (TG-0, 명세 §5.4) — 같은 중심으로 수렴하는 세포들의 묶음.
// 압축(M5)은 여기서 일어나되, 원본 trace 를 잃지 않는다(tcell-core.assertCompressionSafe).
import { randomUUID } from 'node:crypto';

export const TSPHERE_STATES = Object.freeze(['soft', 'forming', 'stable', 'split_required', 'merge_candidate']);

export const TCELL_RELATIONS = Object.freeze([
  'supports', 'contradicts', 'refines', 'narrows', 'expands', 'precedes', 'depends_on', 'same_center',
]);

/** @returns {import('./t-sphere.js').TSphere} */
export function makeTSphere(input = {}) {
  return {
    id: input.id ?? randomUUID(),
    centerPoint: input.centerPoint ?? '',
    memberIds: [...(input.memberIds ?? [])],
    relations: [...(input.relations ?? [])],
    stability: input.stability ?? 0,
    state: input.state ?? 'soft',
    compressedCellId: input.compressedCellId ?? null,
    traceRefs: [...(input.traceRefs ?? [])],
  };
}

/** @returns {{ok:boolean, errors:string[]}} */
export function validateTSphere(sphere) {
  const errors = [];
  if (!TSPHERE_STATES.includes(sphere?.state)) errors.push(`상태가 계약 밖이에요: ${sphere?.state}`);
  if (!sphere?.centerPoint) errors.push('중심(centerPoint)이 비어 있어요');
  if (!(sphere?.memberIds?.length)) errors.push('구성 세포가 없어요');
  if (!(sphere?.stability >= 0 && sphere?.stability <= 1)) errors.push('stability 는 0..1 이에요');
  for (const rel of sphere?.relations ?? []) {
    if (!TCELL_RELATIONS.includes(rel?.kind)) errors.push(`관계 종류가 계약 밖이에요: ${rel?.kind}`);
  }
  return { ok: errors.length === 0, errors };
}
