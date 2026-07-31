// L5 · 정정 상관 (S5-3 · 계획 §4.5) — **통계지 사실이 아니다.**
//
// 사용자가 고친 턴에서, 직전 관련 턴의 `shown ∩ cited` 항목에 표식을 남긴다. 그 표식이
// 말하는 것은 "이 기억이 틀렸다"가 아니라 **"이 기억이 보였고, 모델이 참고했다고 주장한
// 자리에서, 사용자가 고쳤다"** 는 상관뿐이다. 셋 다 다른 사실이고 여기서 섞지 않는다.
//
// 그래서 한 번으로는 아무 일도 일어나지 않는다. 한 번의 정정은 기억이 나빠서가 아니라
// 사용자가 마음을 바꿔서, 상황이 달라져서, 모델이 다른 데서 틀려서일 수 있다. **독립된 두
// 턴**에서 같은 항목이 걸릴 때에만 "들여다볼 만하다"가 된다 — 그것도 감쇠가 아니라 후보다.
//
// 정정 여부는 **모델이 알려준다.** 낱말 규칙("아니야"·"틀렸어")을 여기 두지 않는다. 그건
// 의미 판단을 규칙으로 대체하는 것이고, 사용자가 "아니 그거 말고 이것도"라고 웃으며 말할 때
// 바로 무너진다. 규칙이 조용히 틀리는 것보다 모델이 말해 주지 않아 아무 일도 안 하는 편이 낫다.

/** 이만큼의 **독립된** 상관이 쌓여야 들여다볼 후보가 된다(§4.5 "독립 상관 2회 전 자동 감쇠 금지"). */
export const CORRELATION_MIN = 2;

/** 무한 성장 금지 — 오래된 것부터 걷는다. */
export const CORRELATION_CAP = 100;

const 같은턴 = (a, b) => a?.sessionId === b?.sessionId && a?.turnSeq === b?.turnSeq;

/**
 * 이 정정 턴이 가리키는 **직전 관련 턴**. 같은 대화에서, 이 턴보다 앞서고, **보이고 인용까지
 * 된 것이 있는** 가장 최근 기록이다. 없으면 null — 가리킬 것이 없으면 상관도 없다.
 */
function 직전관련턴(shownRefs = [], turnRef) {
  const 후보 = shownRefs
    .filter((x) => x.turnRef?.sessionId === turnRef?.sessionId)
    .filter((x) => Number.isInteger(x.turnRef?.turnSeq) && x.turnRef.turnSeq < turnRef.turnSeq)
    .filter((x) => (x.modelCitedRefs ?? []).length);
  if (!후보.length) return null;
  return 후보.reduce((a, b) => (b.turnRef.turnSeq > a.turnRef.turnSeq ? b : a));
}

/**
 * 정정 신호를 상관으로 옮긴다. **`shown ∩ cited` 에만** 남는다.
 *
 * 인용은 보인 것의 부분집합이라(S5-2 구조) 교집합은 곧 인용이지만, 저장이 어쩌다 어긋나도
 * 여기서 한 번 더 교차한다 — 보인 적 없는 것에 상관을 남기면 그 위의 모든 판단이 거짓이 된다.
 *
 * @param {{shownRefs?:object[], correctionCorrelation?:object[]}} memory
 * @param {{turnRef:{sessionId:string,turnSeq:number}, at?:number}} p 정정이 일어난 턴
 * @returns {object[]} 갱신된 상관 목록(호출자가 저장한다)
 */
export function correlateCorrection(memory, { turnRef, at = 0 } = {}) {
  const 현재 = (memory?.correctionCorrelation ?? []).map((x) => ({ ...x, turns: [...x.turns] }));
  if (!turnRef?.sessionId || !Number.isInteger(turnRef?.turnSeq)) return 현재;

  const 관련 = 직전관련턴(memory?.shownRefs ?? [], turnRef);
  if (!관련) return 현재;

  const 보인것 = new Set((관련.refs ?? []).map((r) => r.ref));
  const 교집합 = (관련.modelCitedRefs ?? []).filter((r) => 보인것.has(r.ref));

  for (const r of 교집합) {
    let 칸 = 현재.find((x) => x.ref === r.ref);
    if (!칸) { 칸 = { ref: r.ref, kind: r.kind, turns: [] }; 현재.push(칸); }
    // 같은 정정 턴은 몇 번을 말해도 하나다 — 중복이 통계를 부풀리면 감쇠가 쉬워진다.
    if (칸.turns.some((t) => 같은턴(t, turnRef))) continue;
    칸.turns.push({ ...turnRef, at });
  }
  return 현재.slice(-CORRELATION_CAP);
}

/**
 * 지금 **들여다볼 만한** 항목. 이건 감쇠가 아니라 후보 목록이다 — 실제로 내리는 일은
 * 이 파일이 하지 않는다(가역 경로와 사용자면이 서 있어야 한다).
 */
export function decayCandidates(memory, { min = CORRELATION_MIN } = {}) {
  return (memory?.correctionCorrelation ?? [])
    .filter((x) => (x.turns?.length ?? 0) >= min)
    .map((x) => ({ ref: x.ref, kind: x.kind, correlations: x.turns.length }));
}
