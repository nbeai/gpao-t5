// L5 · T-cell Replay 엔진 (TG-4, 명세 §9·§10) — 승격 전 재현 검증과 상태 전이.
//
// 이 파일의 절대 경계:
//  · **replay 는 아무것도 실행하지 않는다.** 도구·손·네트워크를 받지 않는다(인자에 없다).
//    계획과 authority 결정까지만 비교한다(§9.3). 실행이 필요한 검증은 replay 가 아니다.
//  · 통계는 진리 점수도 권한 점수도 아니다(§10.1). 높은 점수가 A2/A3 를 자동 승인하지 않는다.
//  · positive 만 통과한 원리는 승격하지 못한다 — 되는 곳만 본 원리는 검증된 것이 아니다.
//  · authority case 실패는 격리다(점수와 무관).
//  · 모든 판정 함수는 total function — 임의 입력에 던지지 않는다(TG-0~3 에서 배운 계약).
import { validateTCell, influenceCeilingFor } from './tcell-core.js';
import { makeReplayResult, validateReplayCase } from './tcell-replay.js';

/** v1 보수적 초기값 — 한 곳에만 둔다. 변경은 replay 와 감사 근거를 요구한다(§10.2). */
export const TCELL_THRESHOLDS = Object.freeze({
  candidateDistinctTurns: 2,
  limitedMinEligibleOutcomes: 5,
  limitedMinWilsonLowerBound: 0.50,
  stableMinEligibleOutcomes: 12,
  stableMinWilsonLowerBound: 0.70,
  stableMaxCorrectionRate: 0.10,
  compressionMinStableMembers: 3,
});

/** 관찰된 범위에서 얼마나 잘 예측했는가(§10.1). 외부 통계 라이브러리 없이. */
export function wilsonLowerBound(successes, total, z = 1.96) {
  const s = Number(successes); const n = Number(total);
  if (!Number.isFinite(s) || !Number.isFinite(n) || n <= 0) return 0;
  const hit = Math.min(Math.max(s, 0), n);
  const p = hit / n;
  const z2 = z * z;
  const v = (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
  return Math.min(Math.max(v, 0), 1);
}

/**
 * 성공 판정(§10.1) — **단순 exit 0 이 아니다.** 원리가 예측한 개선이 실제로 일어났고,
 * 사용자 정정·권한 위반·wrong-anchor 가 없을 때만 성공이다.
 * @param {{predictedImprovement?:boolean, improvementObserved?:boolean, userCorrected?:boolean,
 *          authorityViolated?:boolean, wrongAnchor?:boolean, toolExitOk?:boolean}} outcome
 */
export function isSuccessfulOutcome(outcome = {}) {
  if (outcome?.authorityViolated === true) return false;
  if (outcome?.userCorrected === true) return false;
  if (outcome?.wrongAnchor === true) return false;
  return outcome?.improvementObserved === true; // 도구 성공만으로는 성공이 아니다
}

// ── replay 종류(§9.1) — 전부 **판정만** 한다 ──────────────────────────────
/** ① structural: 필수 필드·trace·boundary·authority 계약. */
export function structuralReplay(cell) {
  const v = validateTCell(cell);
  return { kind: 'structural', passed: v.ok, errors: v.errors ?? [] };
}

/** 한 사례의 기대 대조 — 기대는 사례가 들고 있고, 실행 사실은 호출자가 공급한다. */
function 사례판정(rc, observedFacts = {}) {
  const v = validateReplayCase(rc);
  if (!v.ok) return { id: rc?.id ?? null, kind: rc?.kind ?? null, passed: false, errors: v.errors };
  const facts = observedFacts?.[rc.id] ?? {};
  const errors = [];
  for (const must of rc.expected?.mustHold ?? []) {
    if (!(facts.held ?? []).includes(must)) errors.push(`성립해야 할 것이 없다: ${must}`);
  }
  for (const never of rc.expected?.mustNotHappen ?? []) {
    if ((facts.happened ?? []).includes(never)) errors.push(`일어나면 안 되는 일이 일어났다: ${never}`);
  }
  if (rc.expected?.expectedInfluenceRole && facts.influenceRole !== rc.expected.expectedInfluenceRole) {
    errors.push(`영향 역할이 다르다: ${facts.influenceRole} ≠ ${rc.expected.expectedInfluenceRole}`);
  }
  if (rc.expected?.expectedActionKind && facts.actionKind !== rc.expected.expectedActionKind) {
    errors.push(`행동 종류가 다르다: ${facts.actionKind} ≠ ${rc.expected.expectedActionKind}`);
  }
  return { id: rc.id, kind: rc.kind, passed: errors.length === 0, errors };
}

/** ②③④⑤ historical/counterfactual/transfer/boundary — 사례 종류별 판정 묶음. */
export function replayCases(cases = [], observedFacts = {}) {
  return (Array.isArray(cases) ? cases : []).map((rc) => 사례판정(rc, observedFacts));
}

/**
 * ③ counterfactual — baseline(승격 원리만) vs candidate(+후보 shadow) 비교(§9.3).
 * **실행하지 않는다**: 계획·authority 결정 수치만 받는다. 나빠지면 통과가 아니다.
 */
export function counterfactualReplay(baseline = {}, candidate = {}) {
  const 나쁨 = ['wrongContextIntrusions', 'unnecessaryQuestions', 'missedApprovals', 'wrongTargetChoices', 'userCorrections', 'turnsToSuccess', 'toolCalls'];
  const regressions = [];
  for (const k of 나쁨) {
    const b = Number(baseline?.[k] ?? 0); const c = Number(candidate?.[k] ?? 0);
    if (Number.isFinite(b) && Number.isFinite(c) && c > b) regressions.push({ metric: k, baseline: b, candidate: c });
  }
  const bAcc = Number(baseline?.activeTargetAccuracy ?? 0);
  const cAcc = Number(candidate?.activeTargetAccuracy ?? 0);
  if (Number.isFinite(bAcc) && Number.isFinite(cAcc) && cAcc < bAcc) {
    regressions.push({ metric: 'activeTargetAccuracy', baseline: bAcc, candidate: cAcc });
  }
  // 마찰이 늘면 성장이 아니다(원칙 0-A-1·명세 §0.1 효과 판정).
  return { kind: 'counterfactual', passed: regressions.length === 0, regressions };
}

// 행동과 연결되는 원리 종류 — 이 종류는 authority 사례 없이는 검증됐다고 하지 않는다.
const 행동원리종류 = Object.freeze(['execution', 'automation', 'authority', 'workflow']);
const 행동과연결된원리 = (cell) => 행동원리종류.includes(cell?.principle?.type);

/** 최소 suite 요건(§9.2) — 행동과 연결되는 원리는 authority case 도 필수. */
export function minimumSuiteGaps(cell, cases = []) {
  const kinds = new Set((Array.isArray(cases) ? cases : []).map((c) => c?.kind));
  const gaps = [];
  for (const need of ['positive', 'negative', 'boundary']) if (!kinds.has(need)) gaps.push(need);
  const 행동연결 = 행동과연결된원리(cell);
  const authorityCases = (Array.isArray(cases) ? cases : []).filter((c) => (c?.expected?.expectedActionKind) || c?.authority === true);
  if (행동연결 && !authorityCases.length) gaps.push('authority');
  return gaps;
}

/**
 * 전체 suite 실행 — 다섯 축을 함께 채운다. **positive 만으로는 통과가 없다.**
 * @param {object} cell
 * @param {object[]} cases
 * @param {{observedFacts?:object, baseline?:object, candidate?:object, now?:number}} [ctx]
 * @returns {import('./tcell-replay.js').ReplayResult & {gaps:string[], caseResults:object[], counterfactual:object}}
 */
export function runReplaySuite(cell, cases = [], ctx = {}) {
  const st = structuralReplay(cell);
  const gaps = minimumSuiteGaps(cell, cases);
  const results = replayCases(cases, ctx.observedFacts ?? {});
  const 종류통과 = (k) => {
    const 해당 = results.filter((r) => r.kind === k);
    return 해당.length > 0 && 해당.every((r) => r.passed);
  };
  const 안전한사례 = Array.isArray(cases) ? cases : [];
  const authorityResults = results.filter((r, i) => (안전한사례[i]?.expected?.expectedActionKind) || 안전한사례[i]?.authority === true);
  const 행동연결 = 행동과연결된원리(cell);
  const cf = counterfactualReplay(ctx.baseline ?? {}, ctx.candidate ?? {});

  const result = makeReplayResult({
    tcellId: cell?.id ?? null,
    candidateVersionId: cell?.growth?.previousVersionId ?? null,
    caseResults: results,
    // 사례가 없으면 통과가 아니다 — "안 돌려서 실패가 없다"는 통과가 아니다.
    positivePassed: 종류통과('positive') && cf.passed,
    negativePassed: 종류통과('negative'),
    boundaryPassed: 종류통과('boundary'),
    // 행동과 연결되지 않는 원리는 authority case 가 없어도 되지만, 있으면 반드시 통과해야 한다.
    authorityPassed: (행동연결 ? authorityResults.length > 0 : true) && authorityResults.every((r) => r.passed),
    tracePassed: st.passed,
    createdAt: ctx.now ?? 0,
  });
  // 빠진 사례가 있으면 전체 통과가 아니다(§9.2 최소 suite).
  const overallPassed = result.overallPassed && gaps.length === 0;
  return { ...result, overallPassed, gaps, structural: st, counterfactual: cf };
}

/**
 * 상태 전이(§10.2) — **점수가 권한을 만들지 않는다.**
 * authority 위반이 하나라도 있으면 점수와 무관하게 격리다.
 * @param {object} cell
 * @param {{replay?:object, transferPassed?:boolean, userConfirmed?:boolean, distinctTurns?:number}} [facts]
 * @returns {{state:string, reason:string, allowedInfluence:string[]}}
 */
export function decideTransition(cell, facts = {}) {
  const 격리 = (reason) => ({ state: 'quarantined', reason, allowedInfluence: ['none'] });
  const e = cell?.effect ?? {};
  const violations = Number(e.authorityViolationCount ?? 0);
  if (!Number.isFinite(violations) || violations > 0) return 격리('권한 위반이 있어요');
  const st = structuralReplay(cell);
  if (!st.passed) return 격리('계약 검증을 지나지 못했어요');
  const replay = facts.replay ?? null;
  if (replay && replay.authorityPassed === false) return 격리('authority 사례가 실패했어요');

  const eligible = Number(e.eligibleCount ?? 0);
  const wilson = wilsonLowerBound(e.successCount ?? 0, eligible);
  const correctionRate = eligible > 0 ? Number(e.userCorrectionCount ?? 0) / eligible : 0;
  const T = TCELL_THRESHOLDS;

  // M1 → M2: replay 전원 통과 + (확인이 필요한 종류면) 사용자 확인까지.
  if (!replay?.overallPassed) {
    return { state: 'M1_candidate', reason: 'replay 전원 통과 전이에요', allowedInfluence: influenceCeilingFor('M1_candidate') };
  }
  if (cell?.authority?.requiresUserConfirmation === true && facts.userConfirmed !== true) {
    return { state: 'M1_candidate', reason: '사용자 확인이 필요해요', allowedInfluence: influenceCeilingFor('M1_candidate') };
  }
  // 서로 다른 2개 이상 turn 근거가 없으면 M1 까지만(§8).
  const distinct = Number(facts.distinctTurns ?? new Set(cell?.trace?.observationRefs ?? []).size);
  if (!(distinct >= T.candidateDistinctTurns)) {
    return { state: 'M1_candidate', reason: '서로 다른 turn 근거가 아직 부족해요', allowedInfluence: influenceCeilingFor('M1_candidate') };
  }
  // M2 → M3 → M4 는 **관찰된 결과 수와 예측력**이 열지, 확신이 열지 않는다.
  if (eligible >= T.stableMinEligibleOutcomes && wilson >= T.stableMinWilsonLowerBound
    && correctionRate <= T.stableMaxCorrectionRate && facts.transferPassed === true) {
    return { state: 'M4_stable', reason: '반복 실사용 효과가 확인됐어요', allowedInfluence: influenceCeilingFor('M4_stable') };
  }
  if (eligible >= T.limitedMinEligibleOutcomes && wilson >= T.limitedMinWilsonLowerBound) {
    return { state: 'M3_limited', reason: '지정 범위에서 효과가 확인됐어요', allowedInfluence: influenceCeilingFor('M3_limited') };
  }
  return { state: 'M2_replayed', reason: 'replay 는 통과했고 실사용 결과를 모으는 중이에요', allowedInfluence: influenceCeilingFor('M2_replayed') };
}

/**
 * 전이를 세포에 적용(순수) — **authority tier 는 건드리지 않는다.**
 * 성숙도가 올라도 A2/A3 승인 요구는 그대로다(§4.3 불변식).
 */
export function applyTransition(cell, decision) {
  const before = cell?.authority ?? {};
  return {
    ...cell,
    state: decision?.state ?? cell?.state,
    authority: {
      ...before,
      allowedInfluence: [...(decision?.allowedInfluence ?? ['none'])],
      // 승격이 승인 요구를 끄지 못한다. 사용자 확인은 사용자만 끈다.
      requiresUserConfirmation: before.requiresUserConfirmation,
      mustNotOverrideCurrentRequest: true,
      prohibitedActionKinds: [...(before.prohibitedActionKinds ?? [])],
    },
    effect: { ...(cell?.effect ?? {}), wilsonLowerBound: wilsonLowerBound(cell?.effect?.successCount ?? 0, cell?.effect?.eligibleCount ?? 0) },
  };
}
