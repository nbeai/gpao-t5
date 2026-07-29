// L1 · 턴 사실 조립기 (TG-5A, 감사 2026-07-29) — **admission 의 판단 재료를 한 곳에서 만든다.**
//
// 감사 실측: admission 호출은 이었는데 재료(project·subject·facts·충돌·행동 등급)를 채우는
// 생산 코드가 없어, 실제 세포가 전부 `scope_unknown`/`boundary_not_satisfied` 로 거절됐다.
// "호출은 연결했지만 판단 재료는 연결하지 않은 상태" — 그 뿌리를 여기서 닫는다.
//
// 규칙: **이번 턴에 실제로 참인 것만** 사실로 만든다. 각 사실은 참조(ref)를 갖는다.
// 지어낸 사실은 원리를 잘못 입장시키고, 빠진 사실은 원리를 영영 못 들어오게 한다.

/** 행동 등급 — 커널이 이미 판정한 이번 턴의 authority 경계를 그대로 쓴다(별도 판정 금지). */
const TIER = Object.freeze(['A0', 'A1', 'A2', 'A3']);

const 문자열 = (v) => (typeof v === 'string' && v ? v : null);

/**
 * 이번 턴의 구조화된 사실들 — 세포 경계(`validWhen`/`invalidWhen`)와 대조될 재료.
 * 사실 문구는 **원리가 쓰는 어휘**와 같은 층이어야 대조가 성립한다.
 */
function 사실들({ receipts = [], intent, plan, sessionId, ledgerStart = 0, surface, awaiting }) {
  const out = [];
  const push = (fact, ref) => { if (fact) out.push({ fact, ref: ref ?? null }); };

  receipts.forEach((rec, i) => {
    const ref = `ledger:${sessionId ?? ''}:${ledgerStart + i}`;
    const 실패 = Boolean(rec?.failureState && rec.failureState !== 'none');
    push(실패 ? '실패 직후' : '실행 성공 직후', ref);
    if (문자열(rec?.action)) push(`${rec.action}`, ref);
    if (실패 && 문자열(rec?.failureState)) push(`실패 종류:${rec.failureState}`, ref);
  });

  // 이번 턴의 목적·대상 — 원리가 "어떤 일에서" 유효한지를 판정할 재료.
  if (문자열(intent?.goal)) push(`목적:${intent.goal}`, `intent:${sessionId ?? ''}`);
  for (const t of Array.isArray(intent?.neededTools) ? intent.neededTools : []) {
    push(`도구 필요:${t}`, `intent:${sessionId ?? ''}`);
  }
  for (const t of Array.isArray(plan?.toolsToUse) ? plan.toolsToUse : []) {
    push(`도구 사용:${t}`, `plan:${sessionId ?? ''}`);
  }
  if ((plan?.needsApproval ?? []).length) push('승인 대기', `plan:${sessionId ?? ''}`);
  if (awaiting) push('이어받은 작업 있음', `session:${sessionId ?? ''}`);
  if (문자열(surface?.responseSurface)) push(`표면:${surface.responseSurface}`, `session:${sessionId ?? ''}`);
  return out;
}

/**
 * **단일 턴 사실 조립기** — admission 이 필요로 하는 모든 판단 재료를 한 번에 만든다.
 * @param {{
 *   input?:object, intent?:object, plan?:object, selfState?:object, workingState?:object,
 *   receipts?:object[], ledgerStart?:number, sessionId?:string, workspaceId?:string,
 *   surface?:object, awaiting?:boolean, memorySuggestion?:object, pendingApprovals?:object
 * }} p
 * @returns {{requestFacts:object, authorityFacts:object}}
 */
export function buildTurnFacts(p = {}) {
  const sessionId = 문자열(p.sessionId);
  // **범위 식별자** — project 는 이 데이터 자리(작업 공간), subject 는 이번 턴의 주 대상.
  // 둘 다 실제 값이 없으면 null 로 둔다(모르면서 아는 척하지 않는다 — scope_unknown 이 옳다).
  const project = 문자열(p.workspaceId);
  const 이번턴대상 = (Array.isArray(p.workingState?.subjects) ? p.workingState.subjects : [])
    .filter((s) => s?.lastTurn === p.workingState?.turnNo);
  const subject = 문자열(이번턴대상[0]?.key) ?? 문자열(p.intent?.subjectOf?.key) ?? null;

  const facts = 사실들({
    receipts: p.receipts ?? [], intent: p.intent, plan: p.plan, sessionId,
    ledgerStart: p.ledgerStart ?? 0, surface: p.surface, awaiting: p.awaiting,
  });

  // **현재 지시 우선** — 사용자가 이번 턴에 명시한 원칙이 있으면, 그와 다른 원리는 충돌이다.
  // 구조화된 신호(memory.propose / detectCandidate)만 쓴다. 원문 추측은 하지 않는다.
  const 지시 = p.memorySuggestion?.kind === 'operating_principle' ? p.memorySuggestion : null;
  const contradicts = [];
  if (문자열(지시?.statement)) contradicts.push(지시.statement);

  // **행동 등급은 커널이 이미 판정한 이번 턴의 경계**다(admission 이 다시 추정하지 않는다).
  const tier = TIER.includes(p.intent?.authorityBoundary) ? p.intent.authorityBoundary : 'A0';
  const 승인대기 = Object.values(p.pendingApprovals ?? {})[0] ?? null;
  const 첫손 = (p.plan?.toolsToUse ?? [])[0] ?? null;

  return {
    requestFacts: {
      project, subject, facts, contradicts,
      userDirective: Boolean(지시),
      confirmationRefs: p.confirmationRefs ?? {},
      sameTurn: true,
    },
    authorityFacts: {
      // 모르는 권한을 저위험으로 두지 않는다 — 커널 판정이 없으면 A0 가 아니라 **판정 불가**로
      // 다루도록 tierKnown 을 함께 준다(호출부가 이걸 보고 A2 이상 원리를 막는다).
      actionTier: tier,
      tierKnown: TIER.includes(p.intent?.authorityBoundary),
      actionKind: 문자열(첫손),
      target: 문자열(승인대기?.target) ?? 문자열(p.intent?.sendTarget?.target),
      scope: project ? `project:${project}` : null,
      grantRef: 문자열(승인대기?.grantRef) ?? null,
    },
  };
}
