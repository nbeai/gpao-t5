// L1 · 턴 사실 조립기 (TG-5A, 감사 2026-07-29 · 종료 행렬 1·2·3) — **admission 의 판단 재료를 한 곳에서 만든다.**
//
// 감사 실측: admission 호출은 있었는데 재료(project·subject·facts·충돌·행동 등급)를 채우는
// 생산 코드가 없어, 실제 세포가 전부 `scope_unknown`/`boundary_not_satisfied` 로 거절됐다.
// "호출은 연결했지만 판단 재료는 연결하지 않은 상태" — 그 뿌리를 여기서 닫는다.
//
// 종료 행렬 세 건이 이 파일의 뼈대다:
//  1. **시간 범위가 고정된 턴 사실만.** 세션 누적 원장 전체를 사실로 쓰면 세 턴 전 실패가
//     영원히 `실패 직후` 로 매치된다 — 원리가 사라진 상황을 근거로 계속 입장한다.
//  2. **지시 관계는 세 값이다**(reinforces / contradicts / unknown). 사용자가 세포와 **같은**
//     원칙을 다시 말한 것은 충돌이 아니라 **강화**다. 예전 코드는 그걸 거절했다.
//  3. **모델 전 맥락 역할과 계획 뒤 권한·값 역할을 분리한다.** `intent.authorityBoundary` 는
//     정규식 추정이다 — 확정 권한으로 쓰지 않는다. 계획이 실제로 선 뒤에만 등급이 사실이 된다.

import { FACT_ATOMS } from './fact-atoms.js';

/** 행동 등급 — 커널이 이미 판정한 이번 턴의 authority 경계를 그대로 쓴다(별도 판정 금지). */
const TIER = Object.freeze(['A0', 'A1', 'A2', 'A3']);

/**
 * 행렬 1 · **사실의 시간 창.**
 *
 * 창은 **직전 턴 하나**다. 그 밖의 영수증은 사실이 되지 않는다 — 세 턴 전 실패가 영원히
 * `실패 직후` 로 매치되던 감사 재현이 여기서 닫힌다.
 *
 * 왜 "이번 턴"이 없는가: **admission 이 도는 모든 자리는 실행 앞이다**(모델 호출 앞, 계획 뒤·
 * 실행 앞, 승인 소비 뒤·executePlan 앞). 그래서 "이번 턴이 만든 영수증"은 구조적으로 항상 0건이다.
 * 그 창을 만들어 두면 영원히 비는 죽은 코드가 된다(절대 원칙 7). 실행 뒤 판정이 실제로
 * 필요해지는 단계(TG-5B)에서 그때 만든다.
 */
export const TURN_FACT_WINDOWS = Object.freeze(['previous_turn']);

/**
 * 행렬 3 · admission 단계 — **재료가 다르면 열 수 있는 역할도 다르다.**
 *  `pre_model`  : 모델 호출 전. 계획이 없고 등급은 정규식 추정뿐 → **맥락 역할만**.
 *  `post_plan`  : 계획이 선 뒤·실행 전. 커널이 판정한 등급과 실제 도구·대상이 있다 → 권한·값 역할까지.
 */
export const ADMISSION_STAGES = Object.freeze(['pre_model', 'post_plan']);

const 문자열 = (v) => (typeof v === 'string' && v ? v : null);

/**
 * 행렬 1 · **고정 시간창 안의 영수증만** 사실이 된다.
 *
 * 문구를 두 벌 만든다. 원리의 어휘(`실패 직후`)와 창의 어휘(`직전 턴 실패`)는 층이 다르다 —
 * 모델이 추출한 원리는 자연어로 "실패 직후"라고 쓰고, 다음 턴이 그 직후다. 둘을 함께 두면
 * **원리가 실제로 매칭되면서도** 창은 여전히 직전 턴으로 고정된다. 감쇠는 창이 지키지
 * 문구가 지키는 것이 아니다.
 */
function 영수증사실(out, receipts, sessionId, base) {
  receipts.forEach((rec, i) => {
    const ref = `ledger:${sessionId ?? ''}:${base + i}`;
    const 실패 = Boolean(rec?.failureState && rec.failureState !== 'none');
    // **원자 id 를 함께 생산한다**(§0-C-2) — 추출 모델이 자유문 경계를 이 id 에 결합하고,
    // admission 은 문구가 아니라 id 로 대조한다. 문구와 id 의 단일 원천은 FACT_ATOMS 다.
    const push = (atomId) => out.push({
      fact: FACT_ATOMS[atomId].fact, atom: atomId, ref, window: 'previous_turn',
    });
    push(실패 ? 'after_failure' : 'after_success');            // 원리가 쓰는 어휘
    push(실패 ? 'prev_turn_failure' : 'prev_turn_success');    // 창이 쓰는 어휘
    if (문자열(rec?.action)) out.push({ fact: `${rec.action}`, atom: null, ref, window: 'previous_turn' });
    if (실패 && 문자열(rec?.failureState)) out.push({ fact: `실패 종류:${rec.failureState}`, atom: null, ref, window: 'previous_turn' });
  });
}

/**
 * 이번 턴의 구조화된 사실들 — 세포 경계(`validWhen`/`invalidWhen`)와 대조될 재료.
 * 사실 문구는 **원리가 쓰는 어휘**와 같은 층이어야 대조가 성립한다.
 */
function 사실들({ ledgerWindow, intent, plan, sessionId, surface, awaiting, stage }) {
  const out = [];
  const push = (fact, ref, atom = null) => { if (fact) out.push({ fact, atom, ref: ref ?? null, window: 'this_turn' }); };
  const 원자push = (atomId, ref) => push(FACT_ATOMS[atomId].fact, ref, atomId);

  // 행렬 1: 창 밖은 아예 만들지 않는다(필터가 아니라 생산 자체를 막는다).
  영수증사실(out, ledgerWindow?.previousTurn ?? [], sessionId, ledgerWindow?.previousTurnStart ?? 0);

  // 이번 턴의 목적·대상 — 원리가 "어떤 일에서" 유효한지를 판정할 재료.
  if (문자열(intent?.goal)) push(`목적:${intent.goal}`, `intent:${sessionId ?? ''}`);
  for (const t of Array.isArray(intent?.neededTools) ? intent.neededTools : []) {
    push(`도구 필요:${t}`, `intent:${sessionId ?? ''}`);
  }
  // **계획 사실은 계획이 실제로 선 뒤에만 만든다**(행렬 3). pre_model 에서 `plan` 은 없거나
  // 추정이다 — 그걸 사실로 만들면 admission 이 추정 위에서 판정한다.
  if (stage === 'post_plan') {
    for (const t of Array.isArray(plan?.toolsToUse) ? plan.toolsToUse : []) {
      push(`도구 사용:${t}`, `plan:${sessionId ?? ''}`);
    }
    if ((plan?.needsApproval ?? []).length) 원자push('approval_pending', `plan:${sessionId ?? ''}`);
  }
  if (awaiting) 원자push('work_resumed', `session:${sessionId ?? ''}`);
  if (문자열(surface?.responseSurface)) push(`표면:${surface.responseSurface}`, `session:${sessionId ?? ''}`);
  // 행렬 5: 승인·거절도 같은 경계를 지난다 — 그 턴의 사실은 "무엇이 소비됐는가"다.
  if (intent?.approvalOutcome === 'approved') 원자push('approval_approved', `session:${sessionId ?? ''}`);
  else if (intent?.approvalOutcome === 'rejected') 원자push('approval_rejected', `session:${sessionId ?? ''}`);
  return out;
}

/**
 * 행렬 4 · grant 조회 키 — **행동·대상·범위 세 요소로만** 만들어진다.
 * admission 은 이 키로 원장을 조회하고, 조회된 grant 의 세 요소를 **다시** 대조한다
 * (키가 맞아도 내용이 다르면 거절 — 키 자체는 주장이지 사실이 아니다).
 */
export function grantKey({ action, target, scope } = {}) {
  const a = 문자열(action); const t = 문자열(target); const s = 문자열(scope);
  return (a && t && s) ? `grant:${a}:${t}:${s}` : null;
}

/**
 * §0-C-3 · **공통 대상 신분** — 도구 종류로 갈라 붙이는 대신, 인자의 대상 필드 하나의 계약이다.
 * 전송류는 `target`, 파일류는 `path`, 수신자형은 `to` — 이 셋 밖의 도구는 대상 신분을 만들 수
 * 없고, 그러면 grant 키도 만들어지지 않아 **매번 다시 묻는다**(모르는 대상에 권한을 열지 않는다).
 */
export function grantTargetOf(args = {}) {
  return 문자열(args?.target) ?? 문자열(args?.path) ?? 문자열(args?.to) ?? null;
}

/**
 * 행렬 3 · 이번 턴 행동 등급 — **커널 판정만 사실이다.**
 * `pre_model` 에서는 계획이 없으므로 `tierKnown:false`(판정 불가)다. 정규식 추정치는
 * 참고로만 싣고(`estimatedTier`), admission 은 그것으로 권한을 열지 않는다.
 */
function 등급판정(stage, { intent, plan }) {
  const 추정 = TIER.includes(intent?.authorityBoundary) ? intent.authorityBoundary : null;
  if (stage !== 'post_plan') {
    return { actionTier: null, tierKnown: false, tierSource: 'intent_estimate', estimatedTier: 추정 };
  }
  // 계획이 실제로 든 승인 경계가 이번 턴의 등급이다. 승인이 필요 없으면 A0·A1 구간이고,
  // 그 판정도 커널(buildActionPlan)이 이미 한 것이다 — 여기서 다시 추정하지 않는다.
  const 계획등급 = (plan?.needsApproval ?? [])
    .map((g) => g?.tier).filter((t) => TIER.includes(t))
    .sort((a, b) => TIER.indexOf(b) - TIER.indexOf(a))[0] ?? null;
  if (계획등급) return { actionTier: 계획등급, tierKnown: true, tierSource: 'plan', estimatedTier: 추정 };
  // 계획이 있고 승인 경계가 하나도 없다 = 커널이 "승인 없이 실행 가능"으로 판정한 것이다.
  if (plan) return { actionTier: 'A0', tierKnown: true, tierSource: 'plan', estimatedTier: 추정 };
  return { actionTier: null, tierKnown: false, tierSource: 'intent_estimate', estimatedTier: 추정 };
}

/**
 * **단일 턴 사실 조립기** — admission 이 필요로 하는 모든 판단 재료를 한 번에 만든다.
 * @param {{
 *   stage?:'pre_model'|'post_plan',
 *   ledgerWindow?:{previousTurn?:object[], previousTurnStart?:number},
 *   intent?:object, plan?:object, selfState?:object, workingState?:object,
 *   sessionId?:string, projectId?:string|null, surface?:object, awaiting?:boolean,
 *   memorySuggestion?:object, sendArgs?:object, confirmationRefs?:object
 * }} p
 * @returns {{requestFacts:object, authorityFacts:object}}
 */
export function buildTurnFacts(p = {}) {
  const stage = ADMISSION_STAGES.includes(p.stage) ? p.stage : 'pre_model';
  const sessionId = 문자열(p.sessionId);
  // **범위 식별자**(§0-C-1) — project 는 세션 저장 폴더가 아니라 **실제 작업의 확정 자리**다
  // (`currentPlaceOf(workingState)` — G 행렬이 확정한 「지금 자리」 사실). 자리가 확정되지 않은
  // 턴은 **null 로 둔다.** 추측으로 채우면 서로 다른 실제 프로젝트가 같은 project 로 뭉개지고,
  // 그 위의 범위 격리·anchor·admission 판정 전체가 거짓 위에 선다(나비).
  const project = 문자열(p.projectId);
  const 이번턴대상 = (Array.isArray(p.workingState?.subjects) ? p.workingState.subjects : [])
    .filter((s) => s?.lastTurn === p.workingState?.turnNo);
  const subject = 문자열(이번턴대상[0]?.key) ?? 문자열(p.intent?.subjectOf?.key) ?? null;

  const facts = 사실들({
    ledgerWindow: p.ledgerWindow, intent: p.intent, plan: p.plan, sessionId,
    surface: p.surface, awaiting: p.awaiting, stage,
  });

  // 행렬 2 · **현재 지시는 세 관계 중 하나다.** 사용자가 이번 턴에 명시한 원칙을 그대로 싣고,
  // 그것이 어떤 세포를 강화하는지·반박하는지는 admission 이 세포별로 판정한다.
  // 여기서 "지시가 있으면 전부 충돌"로 뭉개면 **같은 지시를 반복한 사용자가 자기 원칙을 죽인다.**
  // 구조화된 신호(memory.propose / detectCandidate)만 쓴다 — 원문 추측은 하지 않는다.
  const 지시 = p.memorySuggestion?.kind === 'operating_principle' ? p.memorySuggestion : null;
  const directives = 문자열(지시?.statement)
    ? [{ statement: 지시.statement, ref: `directive:${sessionId ?? ''}` }] : [];

  const 등급 = 등급판정(stage, { intent: p.intent, plan: p.plan });
  // **대상·행동은 계획의 사실**이다. pre_model 에는 없다 — 없는 것을 지어내지 않는다.
  const action = stage === 'post_plan'
    ? 문자열((p.plan?.toolsToUse ?? [])[0]) ?? 문자열((p.plan?.needsApproval ?? [])[0]?.action) : null;
  const target = stage === 'post_plan'
    ? grantTargetOf(p.sendArgs?.[action]) ?? 문자열(p.intent?.sendTarget?.target) : null;
  const scope = project ? `project:${project}` : null;

  return {
    stage,
    requestFacts: {
      project, subject, facts, directives,
      userDirective: Boolean(지시),
      confirmationRefs: p.confirmationRefs ?? {},
      sameTurn: true,
    },
    authorityFacts: {
      // 모르는 권한을 저위험으로 두지 않는다 — 커널 판정이 없으면 A0 가 아니라 **판정 불가**다
      // (호출부가 이걸 보고 계획·값 역할을 막는다).
      ...등급,
      actionKind: action,
      target,
      scope,
      // **pending 은 grant 가 아니다**(행렬 4) — 조회 키만 만들고, 실제 부여 여부는
      // admission 이 **부여된 권한 원장**에서 확인한다.
      grantRef: grantKey({ action, target, scope }),
    },
  };
}
