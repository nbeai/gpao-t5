// L5 · T-cell Replay 엔진 (TG-4, 명세 §9·§10 + 감사 2026-07-29) — 검증된 사실 묶음만 판정한다.
//
// 이 파일의 절대 경계:
//  · **replay 는 아무것도 실행하지 않는다.** 도구·손·네트워크·파일을 인자로도 import 로도 받지
//    않는다. 계획과 authority 결정까지만 비교한다(§9.3).
//  · **자료가 없으면 통과가 아니라 `insufficient_evidence` 다.** 감사 재현: mustNotHappen 만 있는
//    사례가 "안 돌려서 실패가 없다"로 통과했고, baseline·candidate 가 둘 다 없어도 counterfactual 이
//    통과했다. 이제 실행 증거가 없는 사례는 판정 자체가 성립하지 않는다.
//  · 통계는 진리 점수도 권한 점수도 아니다(§10.1). 점수가 A2/A3 를 자동 승인하지 않는다.
//  · **상태는 한 계단씩만 오른다.** rolled_back·quarantined 는 자동 부활하지 않는다.
//  · 모든 판정 함수는 total function — 임의 입력에 던지지 않는다.
import { validateTCell, influenceCeilingFor, MATURITY_LEVELS } from './tcell-core.js';
import { makeReplayResult, validateReplayCase, REPLAY_KINDS } from './tcell-replay.js';

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

/** 성숙도 계단 — 한 번에 한 칸(§10.2). 이 순서 밖은 전이가 아니다. */
export const MATURITY_LADDER = Object.freeze(['M0_observed', 'M1_candidate', 'M2_replayed', 'M3_limited', 'M4_stable', 'M5_compressed']);
/** 자동으로 되살아나지 않는 종착 상태 — 부활은 새 근거로 다시 시작해야 한다. */
export const TERMINAL_STATES = Object.freeze(['rolled_back', 'quarantined']);

/** 마찰 지표 전체(§0.1 효과 판정) — 늘면 성장이 아니다. 하나라도 빠뜨리지 않는다. */
export const FRICTION_METRICS = Object.freeze([
  'unnecessaryQuestions', 'unnecessaryConfirmations', 'clicks', 'userInterventions',
  'userCorrections', 'wrongContextIntrusions', 'wrongToolChoices', 'wrongTargetChoices',
  'missedApprovals', 'turnsToSuccess', 'toolCalls',
]);

/**
 * 비교에 **반드시 있어야 하는 측정값**(감사 2026-07-29): 하나라도 없거나 수가 아니면
 * "나빠진 게 없다"가 아니라 **판정 불가**다. 빈 baseline/candidate 가 통과하던 구멍을 닫는다.
 */
export const REQUIRED_COMPARISON_METRICS = Object.freeze(['activeTargetAccuracy', ...FRICTION_METRICS]);

const 수 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 관찰된 범위에서 얼마나 잘 예측했는가(§10.1). 외부 통계 라이브러리 없이. */
export function wilsonLowerBound(successes, total, z = 1.96) {
  const s = 수(Number(successes)); const n = 수(Number(total)); const zz = 수(Number(z));
  if (s === null || n === null || zz === null || zz <= 0 || n <= 0) return 0; // 잘못된 z 는 NaN 대신 0
  const hit = Math.min(Math.max(s, 0), n);
  const p = hit / n;
  const z2 = zz * zz;
  const v = (p + z2 / (2 * n) - zz * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0;
}

/**
 * 성공 판정(§10.1) — **단순 exit 0 도, 개선 주장만도 아니다.**
 * 원리가 개선을 예측했고, 그 개선이 실제로 관찰됐고, 정정·권한 위반·wrong-anchor 가 없어야 성공이다.
 */
export function isSuccessfulOutcome(outcome = {}) {
  if (outcome?.authorityViolated === true) return false;
  if (outcome?.userCorrected === true) return false;
  if (outcome?.wrongAnchor === true) return false;
  if (outcome?.predictedImprovement !== true) return false; // 예측 없는 개선은 이 원리의 공이 아니다
  return outcome?.improvementObserved === true;
}

/**
 * 실사용 결과들을 effect counter 로 접는 **단일 통로**(감사 P2: 두 진실 금지).
 * 성공 판정·집계·Wilson 이 한 함수에서 나온다.
 */
export function foldOutcomes(outcomes = []) {
  const list = Array.isArray(outcomes) ? outcomes : [];
  const effect = {
    eligibleCount: 0, successCount: 0, failureCount: 0, userCorrectionCount: 0,
    wilsonLowerBound: 0, sameFailureRecurrenceCount: 0, authorityViolationCount: 0,
  };
  const 실패지문 = new Map();
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    effect.eligibleCount += 1;
    if (o.authorityViolated === true) effect.authorityViolationCount += 1;
    if (o.userCorrected === true) effect.userCorrectionCount += 1;
    if (isSuccessfulOutcome(o)) { effect.successCount += 1; continue; }
    effect.failureCount += 1;
    const key = String(o.failureKind ?? '');
    if (key) {
      const n = (실패지문.get(key) ?? 0) + 1;
      실패지문.set(key, n);
      if (n >= 2) effect.sameFailureRecurrenceCount += 1;
    }
  }
  effect.wilsonLowerBound = wilsonLowerBound(effect.successCount, effect.eligibleCount);
  return effect;
}

// ── 검증된 사실 묶음 ────────────────────────────────────────────────────
/**
 * VerifiedReplayPacket — **판정에 필요한 사실이 전부 갖춰졌음을 스스로 증명하는 묶음**(감사).
 * 느슨한 불리언(overallPassed·transferPassed)을 받지 않는다. 실행 증거·근거 저장소·
 * baseline/candidate·확인 근거를 함께 들고 온다.
 */
/**
 * @typedef {Object} EvidenceStore 근거 조회기 — **주장이 아니라 저장된 사실을 돌려준다.**
 * @property {(ref:string)=>object|null} get 참조로 실제 기록(ObservationEvent·확인·transfer)을 돌려준다
 */

export function makeVerifiedReplayPacket(p = {}) {
  return {
    cases: Array.isArray(p.cases) ? p.cases : [],
    // **참조만 받는다.** 실행 결과·확인·transfer 의 내용은 전부 저장소가 말한다(감사 2026-07-29).
    // 호출자가 `facts.held` 를 주장해 통과시키던 마지막 구멍을 닫는다.
    executionRefs: Array.isArray(p.executionRefs) ? p.executionRefs.filter((r) => typeof r === 'string') : [],
    evidenceStore: p.evidenceStore ?? null,
    // 주의(전수 점검 2026-07-29): baseline/candidate 는 **아직 호출자가 주는 측정값**이다.
    // 감사 지정 범위 밖이라 이번에 바꾸지 않고 드러내 둔다 — 통합 시 기록 조회로 올릴 후보.
    baseline: p.baseline ?? null,
    candidate: p.candidate ?? null,
    transferRef: typeof p.transferRef === 'string' ? p.transferRef : null,
    userConfirmationRef: typeof p.userConfirmationRef === 'string' ? p.userConfirmationRef : null,
    now: 수(p.now) ?? 0,
  };
}

/** 기록 종류 — 조회된 기록이 **무엇인지**까지 맞아야 인정한다(형태만 닮은 객체 차단). */
export const EVIDENCE_KINDS = Object.freeze({
  execution: 'replay_execution', confirmation: 'user_confirmation', transfer: 'transfer_replay',
});

/**
 * 조회된 기록이 이 세포·이 계보의 것인지 확인한다 — **필드가 없으면 불일치와 같다**(감사).
 * `tcellId` 없는 기록이 인정되던 구멍을 닫는다.
 */
function 계보검사(rec, { kind, cell, 계보, caseId }) {
  const bad = [];
  if (!rec || typeof rec !== 'object') return ['기록 없음'];
  if (rec.kind !== kind) bad.push(`kind≠${kind}`);
  if (typeof rec.tcellId !== 'string' || !rec.tcellId) bad.push('tcellId 없음');
  else if (cell?.id && rec.tcellId !== cell.id) bad.push('다른 세포의 기록');
  if (수(rec.at ?? rec.executedAt) === null) bad.push('시각 없음');
  const refs = Array.isArray(rec.sourceRefs) ? rec.sourceRefs
    : (Array.isArray(rec.caseRefs) ? rec.caseRefs : null);
  if (!refs || !refs.length) bad.push('원본 참조 없음');
  else if (계보 && 계보.size && rec.sourceRefs) {
    for (const r of rec.sourceRefs) if (!계보.has(r)) bad.push(`계보 밖 근거:${r}`);
  }
  if (caseId !== undefined && rec.caseId !== caseId) bad.push('사례 불일치');
  return bad;
}

/** 저장소 조회 — get 이 없으면 조회 불가(빈 결과가 아니라 불가다). */
function 조회(store, ref) {
  if (!store || typeof store.get !== 'function' || typeof ref !== 'string' || !ref) return undefined;
  try { return store.get(ref) ?? null; } catch { return null; }
}

/** 묶음 자체의 완결성 — 빠진 것은 실패가 아니라 **판정 불가**다. */
export function validateReplayPacket(packet, cell) {
  const missing = [];
  const pk = packet ?? {};
  const store = pk.evidenceStore;
  if (!store || typeof store.get !== 'function') missing.push('evidenceStore.get');
  if (!Array.isArray(pk.cases) || !pk.cases.length) missing.push('cases');
  if (!Array.isArray(pk.executionRefs)) missing.push('executionRefs');
  if (!MATURITY_LEVELS.includes(cell?.state)) missing.push('cell.state');

  // 필수 측정값이 하나라도 없거나 수가 아니면 비교 자체가 성립하지 않는다.
  for (const side of ['baseline', 'candidate']) {
    const m = pk[side];
    if (!m || typeof m !== 'object') { missing.push(side); continue; }
    for (const k of REQUIRED_COMPARISON_METRICS) if (수(m[k]) === null) missing.push(`${side}.${k}`);
  }

  // **세포의 근거 계보** — 이 세포가 딛고 선 관찰들. 사례·실행·확인·transfer 는 이 계보 안이어야 한다.
  const 계보 = new Set(Array.isArray(cell?.trace?.observationRefs) ? cell.trace.observationRefs : []);
  for (const ref of 계보) {
    if (!조회(store, ref)) missing.push(`observation:${ref}`); // 존재하지 않는 근거
  }
  for (const rc of Array.isArray(pk.cases) ? pk.cases : []) {
    if (!validateReplayCase(rc).ok) { missing.push(`case:${rc?.id ?? '?'}`); continue; }
    for (const sref of rc.sourceRefs ?? []) {
      if (!조회(store, sref)) missing.push(`case.sourceRef:${sref}`);       // 지어낸 사례 근거
      else if (계보.size && !계보.has(sref)) missing.push(`case.lineage:${sref}`); // 남의 근거로 만든 사례
    }
    // **실행 결과도 저장소가 말한다**(감사 3차): packet 의 주장이 아니라 조회된 기록이어야 한다.
    const 실행기록 = (pk.executionRefs ?? []).map((r) => 조회(store, r)).filter(Boolean)
      .find((e) => e?.caseId === rc.id);
    if (!실행기록) { missing.push(`execution:${rc.id}`); continue; } // 안 돌린 사례는 통과가 아니다
    const bad = 계보검사(실행기록, { kind: EVIDENCE_KINDS.execution, cell, 계보, caseId: rc.id });
    if (bad.length) missing.push(`execution.lineage:${rc.id}(${bad[0]})`);
    const f = 실행기록.facts;
    if (!f || !Array.isArray(f.held) || !Array.isArray(f.happened)) missing.push(`execution.facts:${rc.id}`);
  }
  // 사용자 확인·transfer 는 **참조로 조회된 기록**이어야 한다(주장 금지).
  if (pk.userConfirmationRef) {
    const rec = 조회(store, pk.userConfirmationRef);
    if (!rec) missing.push(`confirmation:${pk.userConfirmationRef}`);
    else {
      const bad = 계보검사(rec, { kind: EVIDENCE_KINDS.confirmation, cell, 계보 });
      if (bad.length) missing.push(`confirmation.content(${bad[0]})`);
      else if (rec.confirmed !== true) missing.push('confirmation.content(확인 아님)');
    }
  }
  if (pk.transferRef) {
    const rec = 조회(store, pk.transferRef);
    if (!rec) missing.push(`transfer:${pk.transferRef}`);
    else {
      const bad = 계보검사(rec, { kind: EVIDENCE_KINDS.transfer, cell, 계보 });
      if (bad.length) missing.push(`transfer.content(${bad[0]})`);
      else if (rec.executed !== true || typeof rec.passed !== 'boolean') missing.push('transfer.content(실행 아님)');
    }
  }
  return { ok: missing.length === 0, missing };
}

/** 서로 다른 turn 근거 수 — **영수증 개수가 아니라 턴 신분**으로 센다(감사 P1). */
/**
 * 서로 다른 turn 근거 수 — **호출자가 건넨 객체가 아니라 저장소에서 조회한 관찰**로 센다(감사).
 * 임의 turnId 두 개를 넘겨 2턴으로 인정받던 구멍을 닫는다.
 */
export function distinctTurnsOf(cell, evidenceStore) {
  const refs = Array.isArray(cell?.trace?.observationRefs) ? cell.trace.observationRefs : [];
  const turns = new Set();
  let 신분없음 = 0;
  for (const ref of refs) {
    const o = 조회(evidenceStore, ref);
    if (!o) { 신분없음 += 1; continue; }
    const id = o?.turnId ?? null;
    if (id === null || id === undefined || id === '') { 신분없음 += 1; continue; }
    turns.add(`${o.sessionId ?? ''}#${id}`);
  }
  return { count: turns.size, unidentified: 신분없음 };
}

// ── replay 종류(§9.1) — 전부 **판정만** 한다 ──────────────────────────────
/** ① structural: 필수 필드·trace(실제 근거 존재)·boundary·authority 계약. */
export function structuralReplay(cell, evidenceStore = null) {
  // 근거 저장소가 없으면 trace 를 확인할 수 없다 — 확인 못 한 것은 통과가 아니다.
  if (!evidenceStore || typeof evidenceStore.get !== 'function') {
    return { kind: 'structural', passed: false, insufficient: true, errors: ['근거 저장소 없이는 trace 를 확인할 수 없어요'] };
  }
  // validateTCell 은 has() 계약을 쓴다 — 조회기로 만들어 넘긴다(한 저장소, 두 표현 금지).
  const v = validateTCell(cell, { has: (r) => Boolean(조회(evidenceStore, r)) });
  return { kind: 'structural', passed: v.ok, errors: v.errors ?? [] };
}

/** 한 사례 판정 — **실행 증거가 없으면 통과가 아니라 판정 불가**다. */
function 사례판정(rc, execution) {
  const v = validateReplayCase(rc);
  if (!v.ok) return { id: rc?.id ?? null, kind: rc?.kind ?? null, passed: false, insufficient: true, errors: v.errors };
  if (!execution || 수(execution.executedAt) === null) {
    return { id: rc.id, kind: rc.kind, passed: false, insufficient: true, errors: ['이 사례는 실행되지 않았어요'] };
  }
  const facts = execution.facts ?? {};
  const held = Array.isArray(facts.held) ? facts.held : null;
  const happened = Array.isArray(facts.happened) ? facts.happened : null;
  if (held === null || happened === null) {
    return { id: rc.id, kind: rc.kind, passed: false, insufficient: true, errors: ['실행 사실(held/happened)이 기록되지 않았어요'] };
  }
  const errors = [];
  for (const must of rc.expected?.mustHold ?? []) if (!held.includes(must)) errors.push(`성립해야 할 것이 없다: ${must}`);
  for (const never of rc.expected?.mustNotHappen ?? []) if (happened.includes(never)) errors.push(`일어나면 안 되는 일이 일어났다: ${never}`);
  if (rc.expected?.expectedInfluenceRole && facts.influenceRole !== rc.expected.expectedInfluenceRole) {
    errors.push(`영향 역할이 다르다: ${facts.influenceRole} ≠ ${rc.expected.expectedInfluenceRole}`);
  }
  if (rc.expected?.expectedActionKind && facts.actionKind !== rc.expected.expectedActionKind) {
    errors.push(`행동 종류가 다르다: ${facts.actionKind} ≠ ${rc.expected.expectedActionKind}`);
  }
  return { id: rc.id, kind: rc.kind, passed: errors.length === 0, errors };
}

/**
 * ③ counterfactual — baseline vs candidate(§9.3). **둘 다 있어야 비교다.**
 * 마찰 지표 전체를 본다. 하나라도 늘면 통과가 아니다(정확도가 올라도).
 */
export function counterfactualReplay(baseline, candidate) {
  if (!baseline || !candidate || typeof baseline !== 'object' || typeof candidate !== 'object') {
    return { kind: 'counterfactual', passed: false, insufficient: true, regressions: [], errors: ['비교할 baseline/candidate 가 없어요'] };
  }
  // **빈 객체는 "나빠진 게 없다"가 아니다.** 필수 측정값이 없으면 비교 자체가 성립하지 않는다.
  const 결측 = [];
  for (const k of REQUIRED_COMPARISON_METRICS) {
    if (수(baseline[k]) === null) 결측.push(`baseline.${k}`);
    if (수(candidate[k]) === null) 결측.push(`candidate.${k}`);
  }
  if (결측.length) return { kind: 'counterfactual', passed: false, insufficient: true, regressions: [], errors: [`측정값 없음: ${결측.slice(0, 4).join(', ')}`] };
  const regressions = [];
  for (const k of FRICTION_METRICS) {
    const b = 수(baseline[k]); const c = 수(candidate[k]);
    if (b === null || c === null) continue; // 없는 지표는 비교하지 않는다(있는 것만 정직하게)
    if (c > b) regressions.push({ metric: k, baseline: b, candidate: c });
  }
  const bAcc = 수(baseline.activeTargetAccuracy); const cAcc = 수(candidate.activeTargetAccuracy);
  if (bAcc !== null && cAcc !== null && cAcc < bAcc) regressions.push({ metric: 'activeTargetAccuracy', baseline: bAcc, candidate: cAcc });
  return { kind: 'counterfactual', passed: regressions.length === 0, regressions };
}

// 행동과 연결되는 원리 종류 — 이 종류는 authority 사례 없이 검증됐다고 하지 않는다.
const 행동원리종류 = Object.freeze(['execution', 'automation', 'authority', 'workflow']);
const 행동과연결된원리 = (cell) => 행동원리종류.includes(cell?.principle?.type);
const authority사례인가 = (c) => Boolean(c?.expected?.expectedActionKind) || c?.authority === true;

/** 최소 suite 요건(§9.2) — 행동과 연결되는 원리는 authority case 도 필수. */
export function minimumSuiteGaps(cell, cases = []) {
  const list = Array.isArray(cases) ? cases : [];
  const kinds = new Set(list.map((c) => c?.kind).filter((k) => REPLAY_KINDS.includes(k)));
  const gaps = [];
  for (const need of ['positive', 'negative', 'boundary']) if (!kinds.has(need)) gaps.push(need);
  if (행동과연결된원리(cell) && !list.some(authority사례인가)) gaps.push('authority');
  return gaps;
}

/**
 * 전체 suite — **검증된 묶음만 받는다.** 자료가 없으면 verdict 는 `insufficient_evidence` 이고
 * overallPassed 는 false 다(통과 아님).
 * @returns {object & {verdict:'passed'|'failed'|'insufficient_evidence', gaps:string[]}}
 */
export function runReplaySuite(cell, packet) {
  const pk = makeVerifiedReplayPacket(packet ?? {});
  const 완결 = validateReplayPacket(pk, cell);
  const gaps = minimumSuiteGaps(cell, pk.cases);
  const st = structuralReplay(cell, pk.evidenceStore);
  const 실행기록들 = (pk.executionRefs ?? []).map((r) => 조회(pk.evidenceStore, r)).filter(Boolean);
  const results = pk.cases.map((rc) => 사례판정(rc, 실행기록들.find((e) => e?.caseId === rc?.id)));
  const cf = counterfactualReplay(pk.baseline, pk.candidate);
  const authorityResults = results.filter((r, i) => authority사례인가(pk.cases[i]));
  const 행동연결 = 행동과연결된원리(cell);

  const 종류통과 = (k) => {
    const 해당 = results.filter((r) => r.kind === k);
    return 해당.length > 0 && 해당.every((r) => r.passed);
  };
  const base = makeReplayResult({
    tcellId: cell?.id ?? null,
    candidateVersionId: cell?.growth?.previousVersionId ?? null,
    caseResults: results,
    positivePassed: 종류통과('positive') && cf.passed,
    negativePassed: 종류통과('negative'),
    boundaryPassed: 종류통과('boundary'),
    authorityPassed: (행동연결 ? authorityResults.length > 0 : true) && authorityResults.every((r) => r.passed),
    tracePassed: st.passed,
    createdAt: pk.now,
  });
  const 판정불가 = !완결.ok || st.insufficient === true || cf.insufficient === true || results.some((r) => r.insufficient === true);
  const overallPassed = base.overallPassed && gaps.length === 0 && !판정불가;
  return {
    ...base,
    overallPassed,
    verdict: 판정불가 ? 'insufficient_evidence' : (overallPassed ? 'passed' : 'failed'),
    gaps,
    missing: 완결.missing,
    structural: st,
    counterfactual: cf,
    // transfer 는 **조회된 기록**이 통과라고 말할 때만 통과다(호출자 주장 금지).
    transferPassed: (() => {
      const t = 조회(pk.evidenceStore, pk.transferRef);
      if (!t || 계보검사(t, { kind: EVIDENCE_KINDS.transfer, cell, 계보: new Set(cell?.trace?.observationRefs ?? []) }).length) return false;
      return t.executed === true && t.passed === true;
    })(),
    caseRefs: pk.cases.map((c) => c?.id).filter(Boolean),
  };
}

/**
 * 상태 전이(§10.2) — **한 계단씩만.** 점수가 권한을 만들지 않고, 종착 상태는 자동 부활하지 않는다.
 * @param {object} cell
 * @param {object} packet VerifiedReplayPacket (느슨한 불리언은 받지 않는다)
 */
function decideTransition(cell, packet) {
  const 머무름 = (reason, state) => ({ state, reason, allowedInfluence: influenceCeilingFor(state) });
  const 격리 = (reason) => ({ state: 'quarantined', reason, allowedInfluence: ['none'] });
  const cur = cell?.state;
  if (!MATURITY_LEVELS.includes(cur)) return 격리('상태가 계약 밖이에요');
  // **종착 상태는 자동으로 되살아나지 않는다**(감사 P1).
  if (TERMINAL_STATES.includes(cur)) {
    return { state: cur, reason: '되돌렸거나 격리된 원리는 자동으로 되살아나지 않아요', allowedInfluence: ['none'] };
  }
  const e = cell?.effect ?? {};
  const violations = Number(e.authorityViolationCount ?? 0);
  if (!Number.isFinite(violations) || violations > 0) return 격리('권한 위반이 있어요');

  const replay = runReplaySuite(cell, packet);
  if (replay.verdict === 'insufficient_evidence') {
    return { ...머무름(`판정에 필요한 자료가 없어요(${[...replay.missing, ...replay.gaps].slice(0, 3).join(', ')})`, cur), replay };
  }
  if (replay.authorityPassed === false) return { ...격리('authority 사례가 실패했어요'), replay };
  if (!replay.overallPassed) return { ...머무름('replay 를 전원 통과하지 못했어요', cur), replay };
  if (cell?.authority?.requiresUserConfirmation === true) {
    const 확인 = 조회(packet?.evidenceStore, packet?.userConfirmationRef);
    const 나쁨 = 확인 ? 계보검사(확인, { kind: EVIDENCE_KINDS.confirmation, cell, 계보: new Set(cell?.trace?.observationRefs ?? []) }) : ['기록 없음'];
    if (나쁨.length || 확인.confirmed !== true) return { ...머무름('사용자 확인이 필요해요', cur), replay };
  }

  const idx = MATURITY_LADDER.indexOf(cur);
  if (idx < 0) return { ...격리('계단 밖의 상태예요'), replay };
  const 다음 = MATURITY_LADDER[Math.min(idx + 1, MATURITY_LADDER.length - 1)];
  const 한칸 = (reason) => ({ state: 다음, reason, allowedInfluence: influenceCeilingFor(다음), replay });

  const T = TCELL_THRESHOLDS;
  const eligible = Number(e.eligibleCount ?? 0);
  const wilson = wilsonLowerBound(e.successCount ?? 0, eligible);
  const correctionRate = eligible > 0 ? Number(e.userCorrectionCount ?? 0) / eligible : 1;
  const { count: turns } = distinctTurnsOf(cell, packet?.evidenceStore);

  if (cur === 'M1_candidate') {
    if (turns < T.candidateDistinctTurns) return { ...머무름(`서로 다른 turn 근거가 ${turns}개예요`, cur), replay };
    return 한칸('replay 를 전원 통과했어요');
  }
  if (cur === 'M2_replayed') {
    if (!(eligible >= T.limitedMinEligibleOutcomes && wilson >= T.limitedMinWilsonLowerBound)) {
      return { ...머무름('실사용 결과를 더 모으는 중이에요', cur), replay };
    }
    return 한칸('지정 범위에서 효과가 확인됐어요');
  }
  if (cur === 'M3_limited') {
    if (!(eligible >= T.stableMinEligibleOutcomes && wilson >= T.stableMinWilsonLowerBound
      && correctionRate <= T.stableMaxCorrectionRate && replay.transferPassed === true)) {
      return { ...머무름('안정 원리 기준을 아직 못 채웠어요', cur), replay };
    }
    return 한칸('반복 실사용 효과가 확인됐어요');
  }
  // M4 → M5(압축)는 sphere 계약의 몫이다 — 여기서 혼자 올리지 않는다.
  return { ...머무름('현재 단계를 유지해요', cur), replay };
}

/**
 * 전이를 세포에 적용 — **결정이 오염돼도 여기서 한 번 더 막는다**(감사 P2: 임의 decision 금지).
 * replay 상태·caseRefs·시각·effect 를 함께 갱신해 두 진실을 만들지 않는다.
 * @param {{outcomes?:object[], now?:number}} [opts] outcomes 를 주면 effect 를 같은 통로로 접는다
 */
function applyTransition(cell, decision, opts = {}) {
  const before = cell?.authority ?? {};
  const cur = cell?.state;
  const 목표 = MATURITY_LEVELS.includes(decision?.state) ? decision.state : cur;
  const curIdx = MATURITY_LADDER.indexOf(cur);
  const nextIdx = MATURITY_LADDER.indexOf(목표);
  let state = cur;
  if (TERMINAL_STATES.includes(cur)) state = TERMINAL_STATES.includes(목표) ? 목표 : cur; // 부활 금지
  else if (TERMINAL_STATES.includes(목표)) state = 목표;                                  // 격리·철회는 언제나
  else if (curIdx >= 0 && nextIdx >= 0 && nextIdx - curIdx <= 1) state = 목표;             // 한 칸까지만
  const ceiling = influenceCeilingFor(state);
  const 요청영향 = Array.isArray(decision?.allowedInfluence) ? decision.allowedInfluence : ['none'];
  const effect = opts.outcomes ? foldOutcomes(opts.outcomes) : { ...(cell?.effect ?? {}) };
  if (!opts.outcomes) effect.wilsonLowerBound = wilsonLowerBound(effect.successCount ?? 0, effect.eligibleCount ?? 0);
  const replay = decision?.replay ?? null;
  return {
    ...cell,
    state,
    authority: {
      ...before,
      // 상한을 넘는 영향은 잘라낸다 — 결정이 answer_anchor 를 주장해도 성숙도가 허락해야 한다.
      allowedInfluence: 요청영향.filter((r) => ceiling.includes(r)),
      requiresUserConfirmation: before.requiresUserConfirmation, // 승격이 승인 요구를 끄지 못한다
      mustNotOverrideCurrentRequest: true,
      prohibitedActionKinds: [...(before.prohibitedActionKinds ?? [])],
    },
    replay: replay
      ? {
        status: replay.verdict === 'passed'
          ? (replay.transferPassed === true ? 'passed_transfer' : 'passed_basic')
          : (replay.verdict === 'failed' ? 'failed' : 'untested'),
        caseRefs: [...(replay.caseRefs ?? [])],
        lastRunAt: 수(replay.createdAt) ?? 수(opts.now) ?? null,
      }
      : (cell?.replay ?? { status: 'untested', caseRefs: [], lastRunAt: null }),
    effect,
  };
}

/**
 * **단일 공개 통로**(감사 2026-07-29) — 판정과 적용을 나누어 열어 두지 않는다.
 * 예전엔 `applyTransition` 에 위조된 한 단계 decision 을 주면 replay 가 `untested` 인 채 승격됐다.
 * 이제 성숙도·replay·영향을 바꾸는 길은 여기 하나뿐이고, 결정은 **이 안에서 검증 packet 으로부터
 * 다시 계산**된다. 호출자가 만든 decision 은 받지 않는다.
 * @param {object} cell
 * @param {object} verifiedPacket makeVerifiedReplayPacket 형태(내용은 저장소로 확인된다)
 * @param {object[]} [outcomes] 실사용 결과 — 주면 effect 를 같은 통로로 접는다
 * @returns {{cell:object, decision:object, replay:object}}
 */
export function transitionCell(cell, verifiedPacket, outcomes) {
  const decision = decideTransition(cell, verifiedPacket);
  const next = applyTransition(cell, decision, outcomes ? { outcomes } : {});
  return { cell: next, decision, replay: decision.replay ?? null };
}
