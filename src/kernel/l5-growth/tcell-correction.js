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
 * 이 정정 턴이 가리키는 **직전 관련 턴**. 같은 대화에서, 이 턴보다 앞서고, **무엇인가 보인**
 * 가장 최근 기록이다. 없으면 null — 보여준 것이 없으면 고칠 대상도 없다.
 *
 * 예전에는 "인용까지 된 턴"만 봤다. 그런데 실측에서 `memory.cite` 호출률이 낮아(지정 시나리오
 * 0/3), 인용을 필수로 두면 상관이 **모델이 그날 인용을 했느냐**에 좌우된다. 그래서 근거를
 * **보인 것 + 정정의 지목**으로 옮기고, 인용은 확신을 높이는 보조로만 쓴다(범위 판정).
 */
function 직전관련턴(shownRefs = [], turnRef) {
  const 후보 = shownRefs
    .filter((x) => x.turnRef?.sessionId === turnRef?.sessionId)
    .filter((x) => Number.isInteger(x.turnRef?.turnSeq) && x.turnRef.turnSeq < turnRef.turnSeq)
    .filter((x) => (x.refs ?? []).length);
  if (!후보.length) return null;
  return 후보.reduce((a, b) => (b.turnRef.turnSeq > a.turnRef.turnSeq ? b : a));
}

/**
 * 정정 신호를 상관으로 옮긴다. **모델이 지목한 것이 직전 턴에 실제로 보였을 때만** 남는다.
 *
 * 지목이 없으면 아무 데도 표식하지 않는다 — 무엇을 고치는지 모르면서 아무 기억에나 표를
 * 남기면, 그 위의 판단이 전부 엉뚱한 것을 겨눈다. 보인 적 없는 것·다른 대화·허공 지목은
 * 대조에서 떨어진다(신분을 얻지 못한다).
 *
 * 인용(cite)은 **확신을 높이는 보조**일 뿐이다. 있으면 `cited`, 없으면 `claimed` 로 남기되
 * **문턱은 바꾸지 않는다** — 그러면 인용이 뒷문으로 감쇠 조건이 된다.
 *
 * @param {{shownRefs?:object[], correctionCorrelation?:object[]}} memory
 * @param {{turnRef:{sessionId:string,turnSeq:number}, target?:string, at?:number}} p
 * @returns {object[]} 갱신된 상관 목록(호출자가 저장한다)
 */
export function correlateCorrection(memory, { turnRef, target, at = 0 } = {}) {
  const 현재 = (memory?.correctionCorrelation ?? []).map((x) => ({ ...x, turns: [...x.turns] }));
  if (!turnRef?.sessionId || !Number.isInteger(turnRef?.turnSeq)) return 현재;
  const 지목 = String(target ?? '').trim();
  if (!지목) return 현재; // 무엇을 고치는지 모르면 표식하지 않는다

  const 관련 = 직전관련턴(memory?.shownRefs ?? [], turnRef);
  if (!관련) return 현재;

  const 맞은것 = (관련.refs ?? []).find((r) => r.statement === 지목);
  if (!맞은것) return 현재; // 보인 적 없는 것·허공 지목

  const 인용됨 = (관련.modelCitedRefs ?? []).some((r) => r.ref === 맞은것.ref);
  let 칸 = 현재.find((x) => x.ref === 맞은것.ref);
  if (!칸) { 칸 = { ref: 맞은것.ref, kind: 맞은것.kind, turns: [] }; 현재.push(칸); }
  // 같은 정정 턴은 몇 번을 말해도 하나다 — 중복이 통계를 부풀리면 감쇠가 쉬워진다.
  if (!칸.turns.some((t) => 같은턴(t, turnRef))) {
    칸.turns.push({ ...turnRef, at, confidence: 인용됨 ? 'cited' : 'claimed' });
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
    // 근거 종류는 남기되 **문턱을 바꾸지 않는다** — 인용이 있다고 한 번에 후보가 되지 않는다.
    .map((x) => ({
      ref: x.ref, kind: x.kind, correlations: x.turns.length,
      confidence: x.turns.map((t) => t.confidence ?? 'claimed'),
    }));
}
