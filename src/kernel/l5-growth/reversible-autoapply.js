// L5 · **가역 학습 자동 반영 판정**(결정문 §12).
//
// 지금까지 T5 는 사용자가 "이건 기억해둬" 라고 **직접 말한 것**까지 카드로 다시 물었다.
// `promote_memory` 가 안전 바닥에 들어 있어 어느 승인 모드에서도 자동으로 통과하지 못했기 때문이다.
// 그런데 그 승인이 지키는 경계가 무엇인지 따져보면 아무것도 없었다 — 로컬 저장이고, 되돌리기
// 경로(`/memory/rollback`)와 영수증과 "반영 중 기억" 표면이 이미 있고, 기억은 권한이 아니다.
//
// 절대원칙 §0-A-2 의 판정 그대로다: **어느 경계를 지키는지 설명할 수 없는 확인은 안전 기능이 아니라
// 사용자 마찰 회귀다.** 그래서 자동성은 사전 승인이 아니라 **되돌림**으로 지킨다.
//
// 네 조건을 **모두** 만족할 때만 자동 반영한다(§12):
//   ① 가역성 — 되돌리기 경로가 실제로 있다
//   ② 영향 한계 — 표현·선호 수준이고 외부 전송·삭제·결제·게시·새 권한을 만들지 않는다
//   ③ 범위 확정 — 사용자가 밝힌 범위다(전역 추정이 아니다)
//   ④ 사용자 소유권 — 설정의 통합 표면에서 보고 고치고 되돌릴 수 있다
//
// 하나라도 어긋나면 **카드를 띄우지 않고** 후보로 남긴다. 실제 영향·권한 경계가 나타나는 순간에만
// 기존 Authority 가 최소로 묻는다(§12 금지 항목의 처리 규칙).
import { looksLikeSecret } from '../l0-evidence/tcell-observation.js';

/** 자동 반영이 가능한 기억 종류 — 운영 원리는 replay 를 지나야 하므로 여기 없다. */
const 자동가능종류 = new Set(['preference']);

/**
 * @param {object} entry 기억 후보(makeCandidate 결과)
 * @param {{explicit?:boolean, rollbackable?:boolean}} [ctx]
 *   `explicit` — 이번 턴 사용자 발화에서 나온 **구조화된 지시**인가(추정 학습이 아니라).
 * @returns {{ok:boolean, reason:string}} 사유는 추적용 코드다(사용자 카드가 아니다).
 */
export function autoApplicable(entry, ctx = {}) {
  if (!entry || typeof entry !== 'object') return { ok: false, reason: 'no_entry' };
  // ② 영향 한계 — 운영 원리·자동화는 여기로 오지 않는다.
  if (!자동가능종류.has(entry.kind)) return { ok: false, reason: 'kind_needs_verification' };
  // ③ 범위 확정 — 사용자가 이번 턴에 **직접 말한** 것만. 추정은 뒤에서 replay 를 거친다.
  if (ctx.explicit !== true) return { ok: false, reason: 'inferred_not_explicit' };
  const 문장 = typeof entry.statement === 'string' ? entry.statement.trim() : '';
  if (!문장) return { ok: false, reason: 'empty_statement' };
  // 비밀·민감은 자동 영향 금지(§12 금지 1항). 카드로 올리지도 않는다 — 그냥 담지 않는다.
  if (looksLikeSecret(문장)) return { ok: false, reason: 'secret_shaped' };
  // ① 가역성 — 되돌릴 수 없으면 자동으로 하지 않는다. 자동성은 되돌림이 있어야 산다.
  if (ctx.rollbackable !== true) return { ok: false, reason: 'not_reversible' };
  return { ok: true, reason: 'explicit_reversible' };
}
