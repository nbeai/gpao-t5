// L5 · 가역 감쇠 (S5-4 · 계획 §4.5·§4.9) — **내리는 것보다 잘못 내리지 않는 것이 먼저다.**
//
// 기억을 내리는 기능은 잘못 만들면 말귀를 좋게 하는 게 아니라 멀쩡한 기억을 조용히 죽인다.
// 사용자는 자기가 시킨 일이 왜 어느 날부터 안 되는지 알 수 없게 되고, 그건 T5 가 할 수 있는
// 가장 나쁜 배신이다. 그래서 이 파일은 다음 넷을 구조로 지킨다.
//
//   ① **삭제가 아니다.** 문장도 신분도 그대로 남고 표식만 붙는다 — 언제든 그대로 돌아온다.
//   ② **미사용은 근거가 아니다.** 안 쓴 기억과 틀린 기억은 다른 것이다(§4.10).
//      오래됐다는 이유로 내리지 않는다. 근거는 **독립된 정정 상관** 하나뿐이다.
//   ③ **문턱은 독립 2회 고정.** `cite` 확신이 붙어도 낮아지지 않는다 — 그러면 모델의
//      자기보고가 뒷문으로 감쇠 조건이 된다.
//   · pin 은 자동 감쇠에서 면제된다. 사용자가 붙들어 둔 것을 OS 가 임의로 내리지 않는다.
//   · 신호가 없는 것은 "문제 없음"이 아니라 **모르는 상태**다. 어느 쪽으로도 움직이지 않는다.
import { CORRELATION_MIN } from './tcell-correction.js';

/** §4.10 계열 상한. 한 번에 몰아 내리면 사용자는 무슨 일이 났는지 알 수 없다. */
export const DECAY_CAPS = Object.freeze({
  perRun: 3, // 한 번에 내릴 수 있는 항목 수
});

const 감쇠됨 = (e) => Number.isFinite(e?.decayedAt);

/**
 * 지금 내려야 할 것을 내린다. **근거는 독립 정정 상관뿐이다.**
 *
 * 이미 한 번 판단이 끝난 상관으로 다시 내리지 않는다(복원 → 즉시 재감쇠의 무한 왕복 금지).
 * 복원 뒤에 **새로** 쌓인 정정이 다시 문턱을 넘으면 그때는 내려간다.
 *
 * @param {{promoted?:object[], correctionCorrelation?:object[]}} memory 제자리에서 바꾼다
 * @param {{now:number}} p
 * @returns {{decayed:Array<{ref:string, kind:string, correlations:number}>}}
 */
export function applyDecay(memory, { now } = {}) {
  const 상관들 = memory?.correctionCorrelation ?? [];
  const decayed = [];

  for (const c of 상관들) {
    if (decayed.length >= DECAY_CAPS.perRun) break;
    const turns = c.turns ?? [];
    const e = (memory.promoted ?? []).find((x) => (x.candidateId ?? x.principleId) === c.ref);
    if (!e || 감쇠됨(e)) continue;
    if (e.pinned) continue; // 사용자가 붙들어 둔 것은 OS 가 내리지 않는다

    // 이 상관으로 이미 한 번 판단했는가. 복원은 "이 근거로는 내리지 않는다"는 사용자의 답이다.
    const 판단선 = e.decayJudgedUpTo ?? 0;
    // 시각을 모르는 상관은 **새것으로 치지 않는다.** 불확실하면 안 내리는 쪽으로 기운다 —
    // 잘못 내리는 것이 안 내리는 것보다 나쁘다.
    const 새정정 = turns.filter((t) => Number.isFinite(t.at) && t.at > 판단선);
    const 셀것 = 판단선 ? 새정정 : turns;
    // **문턱은 여기 한 곳뿐이다.** 두 군데에 두면 하나가 무너져도 다른 하나가 가려 주는데,
    // 그러면 무너진 사실을 아무도 모른다. 확신 종류(`cited`/`claimed`)는 보지 않는다 —
    // 보는 순간 모델의 자기보고가 뒷문으로 감쇠 조건이 된다.
    if (셀것.length < CORRELATION_MIN) continue;

    e.decayedAt = now;
    e.decayReason = `correction_correlation:${셀것.length}`;
    decayed.push({ ref: c.ref, kind: c.kind, correlations: 셀것.length });
  }
  return { decayed };
}

/**
 * 되돌린다. 표식만 걷으면 그대로 돌아온다 — 문장도 신분도 애초에 지운 적이 없다.
 * 그리고 **이 근거로는 다시 내리지 않는다**고 표시한다(사용자의 답을 기억한다).
 */
export function restoreDecayed(memory, ref, { now } = {}) {
  const e = (memory?.promoted ?? []).find((x) => (x.candidateId ?? x.principleId) === ref);
  if (!e || !감쇠됨(e)) return { ok: false, reason: 'not_decayed' };
  delete e.decayedAt;
  delete e.decayReason;
  e.restoredAt = now;
  // 지금까지 쌓인 정정은 사용자가 "그래도 두라"고 답한 것이다 — 같은 근거로 또 내리지 않는다.
  e.decayJudgedUpTo = now;
  return { ok: true, entry: e };
}

/** 지금 내려가 있는 것들(표면이 보여줄 목록). */
export function decayedEntries(memory) {
  return (memory?.promoted ?? []).filter(감쇠됨).map((e) => ({
    ref: e.candidateId ?? e.principleId,
    kind: e.kind,
    statement: e.statement,
    decayedAt: e.decayedAt,
    reason: e.decayReason ?? null,
  }));
}
