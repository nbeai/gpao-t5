// 턴 오케스트레이터 — Work Chat 한 턴의 심장.
// 흐름(감사 지정): 발화 → SelfState → Intent → (fast_chat | ActionPlan → Authority → 실행 → Receipt)
//                 → Truth Ledger → 다음 안전 행동.
// 판정 기준: 사용자는 채팅만 한다고 느끼지만, 뒤에서 자기파악·권한·원장·복구가 자연스럽게 돈다.
import { buildSelfState, selfStateSummary } from './l0-evidence/self-state.js';
import { TruthLedger, projectReceipts } from './l0-evidence/ledger.js';
import { blockedReceipt } from './l0-evidence/tool-receipt.js';
import { toolLabel } from './tool-labels.js';
import { interpret } from './l1-intent/intent.js';
import { buildTaskContext } from './l1-intent/task-context.js';
import { buildActionPlan } from './l2-plan/action-plan.js';
import { isExecutionAllowed } from './l2-plan/authority.js';
import { decideFollowUp } from './l2-plan/follow-up.js';
import { admitInboundEvent } from './l1-intent/inbound-gate.js';
import { detectCandidate, admittedContext, isRelevant } from './l1-intent/context-mesh.js';
import { detectAutomationCandidate } from './l5-growth/automation.js';
import { APPROVAL_TTL_MS } from './contracts.js';

// 시간 소스 — 테스트는 ctx.now 주입으로 결정적으로 제어(만료 시나리오). 미주입 시 실시간.
function nowMs(ctx) { return ctx.now ? ctx.now() : Date.now(); }

/**
 * @typedef {Object} TurnInput
 * @property {string} [text]                    사용자 발화
 * @property {string} [approve]                 승인할 보류 계획 id(재해석 없이 그 계획을 이어받음)
 * @property {string} [reject]                  거부할 보류 계획 id
 * @property {string} [runningTask]             진행 중 작업(있으면 follow-up 판정)
 * @property {boolean} [conflict]               새 지시가 진행 작업과 충돌하는지
 */

/**
 * @typedef {Object} TurnContext
 * @property {Object} env                       SelfState 조립 입력(model, connections)
 * @property {import('../runtime/model-client.js').ModelClient} model
 * @property {import('../runtime/tool-runner.js').ToolRunner} tools
 * @property {TruthLedger} [ledger]
 * @property {Map<string, {intent:Object, plan:Object}>} [pending]  보류 계획 보관(서버 소유)
 */

/**
 * @param {TurnInput} input
 * @param {TurnContext} ctx
 */
export async function runTurn(input, ctx) {
  const ledger = ctx.ledger ?? new TruthLedger();
  if (!ctx.pending) ctx.pending = new Map();
  const selfState = buildSelfState(ctx.env);
  const summary = selfStateSummary(selfState);

  // A) 승인 재개 — 재해석하지 않고 보관된 봉인 계획을 그대로 이어받는다(감사 지적 수정).
  if (input.approve) {
    const saved = ctx.pending.get(input.approve);
    if (!saved) {
      return { kind: 'reply', reply: '그 승인 요청을 찾지 못했어요. 다시 말씀해 주세요.', selfStateSummary: summary };
    }
    // 승인 만료 — 재시작·시간경과로 만료된 승인은 이어실행하지 않고 정직하게 재승인을 요청한다
    // (죽은 버튼 금지, 무단 지연 실행 금지). Approval Lifecycle Contract.
    if (saved.grantScope?.expiresAt && nowMs(ctx) > saved.grantScope.expiresAt) {
      ctx.pending.delete(input.approve);
      return { kind: 'reply', reply: '이 승인 요청은 시간이 지나 만료됐어요. 다시 말씀해 주시면 새로 확인할게요.', selfStateSummary: summary };
    }
    ctx.pending.delete(input.approve);
    // 승인 재개 시 게이트에서 계산한 admitted를 함께 이어받는다 — 승격된 맥락을 잃지 않게(감사 소보정).
    return executePlan(saved.intent, saved.plan, selfState, ctx, ledger, summary, saved.admitted ?? []);
  }

  // B) 승인 거부 — 안전 정지. 실행하지 않고 초안·상태를 보존한다.
  if (input.reject) {
    ctx.pending.delete(input.reject);
    return { kind: 'reply', reply: '보내지 않았어요. 초안은 그대로 있어요.', selfStateSummary: summary };
  }

  // C) Relevance Gate(§1.5) — 외부·비요청 이벤트만 거른다. user_chat(기본)·trusted_runtime_event은
  //    우회한다. 비respond면 턴을 열지 않고 조용히 종료(사용자 설명문 없음, 안티 대시보드).
  const gate = admitInboundEvent({
    source: input.source ?? 'user_chat',
    triggerSignals: input.triggerSignals,
    keepAsContext: input.keepAsContext,
  });
  if (gate.disposition !== 'respond') {
    return {
      kind: 'gated',
      disposition: gate.disposition,
      admittedAsContext: gate.admittedAsContext,
      selfStateSummary: summary,
    };
  }

  // 0) 진행 중 작업이 있으면 follow-up 을 먼저 판정한다(새 지시를 놓치지 않는다).
  let followUp;
  if (input.runningTask) {
    followUp = decideFollowUp({
      runningTask: input.runningTask,
      incomingInput: input.text,
      conflict: input.conflict,
    });
  }

  // 1) 말귀
  const intent = interpret(input.text, { selfState });

  // 1.5) Context Mesh — 좁은 맥락 입장 + 기억 승격 후보(P6-1).
  //   admitted: 현재 목표 + 승격되어 영향 가능하고 이번 요청에 관련된 기억만(라우터가 raw 기억 안 씀).
  //   memorySuggestion: 후보만 표면화(자동 승격 아님). operating_principle은 replay 전 영향 0(§5).
  // activeGoal도 이번 발화와 관련/후속일 때만 입장한다 — 무관한 발화에 목표를 주입하면 현재요청우선
  // 위반이다(감사 보정). broad memory, narrow influence.
  const goalRelevant = ctx.activeGoal?.understoodTask && isRelevant(ctx.activeGoal.understoodTask, input.text ?? '');
  const admitted = [
    ...(goalRelevant ? [`현재 목표: ${ctx.activeGoal.understoodTask}`] : []),
    ...admittedContext(ctx.memory ?? {}, input.text ?? ''),
  ];
  const memorySuggestion = detectCandidate(input.text ?? '');

  // 2) 확인 필요 → 실행 전 멈추고 묻는다(방법 나열 금지).
  if (intent.needsClarification) {
    return {
      kind: 'clarify',
      question: '무엇을 말씀하시는 걸까요? (직전 대화 / 특정 파일 / 할 일) 중에 알려 주세요.',
      selfStateSummary: summary,
      memorySuggestion,
      followUp,
    };
  }

  // 3) fast path — 도구·외부효과 없음. 무겁게 태우지 않는다(자연스러움 보존).
  if (intent.answerMode === 'fast_chat') {
    const tc = buildTaskContext({ intent, selfState, admittedContext: admitted });
    const reply = await ctx.model.respond(tc);
    return {
      kind: 'reply',
      reply,
      selfStateSummary: summary, // 칩은 접힌 채(대화 점유 금지)
      ledger: { confirmed: [], unconfirmed: [], estimated: [] },
      memorySuggestion,
      followUp,
    };
  }

  // 4) complex path — 계획 → 권한 게이트 → 실행 → 원장.
  const plan = buildActionPlan({ intent, selfState });

  // 4-auto) 반복 신호가 있으면 자동화 후보만 조용히 표면화(P6-3). 후보는 실행이 아니다 —
  //   승인 전 영향 0. action은 계획의 첫 도구를 재사용. 외부 전송 도구면 승인 경계(A2)를 상속.
  const primaryTool = plan.toolsToUse?.[0] ?? plan.needsApproval?.[0]?.action ?? null;
  const automationSuggestion = detectAutomationCandidate(
    input.text ?? '',
    primaryTool ? { tool: primaryTool, args: { request: intent.currentRequest ?? input.text } } : null,
  );

  // 4a) A2·A3 미승인 행동이 있으면 실행 전 멈춘다(외부효과 게이트, 헌법 §3-6).
  //     보류 계획을 서버가 보관하고 id 만 사용자에게 준다 — 승인 시 이 계획을 이어받는다.
  const pendingGrants = plan.needsApproval.filter((g) => !isExecutionAllowed(g));
  if (pendingGrants.length) {
    // 고유 pendingId: 서버가 newId(예: UUID)를 주입하면 지속 pending 간 충돌 없음.
    // 미주입 시(단위 테스트) 카운터 폴백. Approval Lifecycle: 만료 시각을 함께 보관.
    const pendingId = ctx.newId ? ctx.newId() : `p${(ctx._seq = (ctx._seq ?? 0) + 1)}`;
    // admitted를 pending에 함께 보존한다 — 승인 재개 실행에서 이미 계산한 맥락을 잃지 않게(감사 소보정).
    ctx.pending.set(pendingId, { intent, plan, admitted, grantScope: { kind: 'once', expiresAt: nowMs(ctx) + APPROVAL_TTL_MS } });
    return {
      kind: 'approval',
      pendingId,
      // action = 매칭용 id(비표시), label = 사용자 표시명. 화면엔 label 만 쓴다.
      pending: pendingGrants.map((g) => ({
        action: g.action,
        label: toolLabel(g.action),
        tier: g.tier,
        preview: g.approvalPreview,
      })),
      understoodTask: plan.understoodTask,
      selfStateSummary: summary,
      followUp,
      memorySuggestion,
      automationSuggestion,
    };
  }

  // 4b) 승인 필요 없음 → 바로 실행.
  const result = await executePlan(intent, plan, selfState, ctx, ledger, summary, admitted);
  result.followUp = followUp;
  result.memorySuggestion = memorySuggestion;
  result.automationSuggestion = automationSuggestion;
  return result;
}

/**
 * 계획을 실제 실행하고 원장·응답을 만든다. 승인 게이트를 통과한 뒤(또는 승인 재개 시) 호출된다.
 * @param {Object} intent
 * @param {Object} plan
 * @param {import('../contracts.js').SelfStateSnapshot} selfState
 * @param {TurnContext} ctx
 * @param {TruthLedger} ledger
 * @param {Object} summary
 */
async function executePlan(intent, plan, selfState, ctx, ledger, summary, admitted = []) {
  // 이번 턴 receipt 만 따로 모은다 — 세션 원장(감사용)과 턴 응답(사용자용)을 분리한다.
  /** @type {import('../contracts.js').ToolReceipt[]} */
  const turnReceipts = [];
  for (const toolId of plan.toolsToUse) {
    const rec = await ctx.tools.run(toolId, { request: intent.currentRequest }, selfState);
    ledger.append(rec);
    turnReceipts.push(rec);
  }
  // 필요하지만 실행 불가한 도구는 조용히 넘기지 않는다(죽은 버튼 금지, 헌법 §4.2).
  // 2.0-B: 연결/자격 때문에 막힌 도구는 구조화해 표면화한다(채팅 안 '연결이 필요해요' 카드 → 도구함 안내).
  //   원래 작업(currentRequest)을 함께 보존해 연결 후 이어갈 pending context로 쓴다. 첫 도구만(누더기 방지).
  let connectionNeeded;
  for (const toolId of plan.blockedTools ?? []) {
    const label = toolLabel(toolId);
    const rec = blockedReceipt(
      `${label} 실행`,
      toolId,
      `${label}은(는) 아직 실행 준비가 안 됐어요.`,
      `${label} 연결/권한을 준비하면 이어서 할 수 있어요.`,
    );
    ledger.append(rec);
    turnReceipts.push(rec);
    if (!connectionNeeded) {
      const ct = selfState.connectedTools.find((t) => t.id === toolId);
      const status = ct?.status ?? 'needs_connection';
      // 연결·설정 계열(노랑)만 연결 안내로 잇는다. 완전 차단(빨강)은 연결로 안 풀리므로 제외.
      if (status === 'needs_auth' || status === 'needs_connection' || status === 'needs_config') {
        connectionNeeded = { toolId, label, requestText: intent.currentRequest };
      }
    }
  }

  // 이번 턴 실행 사실만 모델 입력에 사실로 담아 답을 만든다(진단면 제외, 이전 턴 비혼입).
  const tc = buildTaskContext({ intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted });
  const reply = await ctx.model.respond(tc);
  const projection = projectReceipts(turnReceipts);

  return {
    kind: 'reply',
    reply,
    selfStateSummary: summary,
    ledger: projection,
    // 막다른 답 금지: 확인 못 한 게 있으면 다음 안전 행동을 끌어올린다.
    nextSafeAction: projection.unconfirmed.length ? plan.recoveryCriteria : undefined,
    // 현재 목표 유지(P6-1): 서버가 session.activeGoal 로 지속해 세션 간 좁게 복원한다.
    goal: { understoodTask: plan.understoodTask, successCriteria: plan.successCriteria },
    // 2.0-B: 연결이 필요한 도구가 있으면 채팅 안 연결 안내 카드로(원래 작업 보존).
    connectionNeeded,
  };
}
