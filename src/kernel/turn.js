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

/**
 * @typedef {Object} TurnInput
 * @property {string} text                     사용자 발화
 * @property {string[]} [approvedActions]       이번 턴에 승인된 행동 label
 * @property {string} [runningTask]             진행 중 작업(있으면 follow-up 판정)
 * @property {boolean} [conflict]               새 지시가 진행 작업과 충돌하는지
 */

/**
 * @typedef {Object} TurnContext
 * @property {Object} env                       SelfState 조립 입력(model, connections)
 * @property {import('../runtime/model-client.js').ModelClient} model
 * @property {import('../runtime/tool-runner.js').ToolRunner} tools
 * @property {TruthLedger} [ledger]
 */

/**
 * @param {TurnInput} input
 * @param {TurnContext} ctx
 */
export async function runTurn(input, ctx) {
  const ledger = ctx.ledger ?? new TruthLedger();
  const selfState = buildSelfState(ctx.env);
  const summary = selfStateSummary(selfState);

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

  // 2) 확인 필요 → 실행 전 멈추고 묻는다(방법 나열 금지).
  if (intent.needsClarification) {
    return {
      kind: 'clarify',
      question: '무엇을 말씀하시는 걸까요? (직전 대화 / 특정 파일 / 할 일) 중에 알려 주세요.',
      selfStateSummary: summary,
      followUp,
    };
  }

  // 3) fast path — 도구·외부효과 없음. 무겁게 태우지 않는다(자연스러움 보존).
  if (intent.answerMode === 'fast_chat') {
    const tc = buildTaskContext({ intent, selfState });
    const reply = await ctx.model.respond(tc);
    return {
      kind: 'reply',
      reply,
      selfStateSummary: summary, // 칩은 접힌 채(대화 점유 금지)
      ledger: ledger.project(),
      followUp,
    };
  }

  // 4) complex path — 계획 → 권한 게이트 → 실행 → 원장.
  const plan = buildActionPlan({ intent, selfState });

  // 4a) A2·A3 미승인 행동이 있으면 실행 전 멈춘다(외부효과 게이트, 헌법 §3-6).
  const approvedSet = new Set(input.approvedActions ?? []);
  const pending = plan.needsApproval.filter(
    (g) => !isExecutionAllowed({ ...g, granted: g.granted || approvedSet.has(g.action) }),
  );
  if (pending.length) {
    return {
      kind: 'approval',
      // action = 매칭용 id(비표시), label = 사용자 표시명. 화면엔 label 만 쓴다.
      pending: pending.map((g) => ({
        action: g.action,
        label: toolLabel(g.action),
        tier: g.tier,
        preview: g.approvalPreview,
      })),
      plan,
      selfStateSummary: summary,
      followUp,
    };
  }

  // 4b) 승인된/자동 도구를 실제 실행하고 receipt 를 남긴다.
  //     이번 턴 receipt 만 따로 모은다 — 세션 원장(감사용)과 턴 응답(사용자용)을 분리한다.
  /** @type {import('../contracts.js').ToolReceipt[]} */
  const turnReceipts = [];
  for (const toolId of plan.toolsToUse) {
    const rec = await ctx.tools.run(toolId, { request: intent.currentRequest }, selfState);
    ledger.append(rec);
    turnReceipts.push(rec);
  }
  // 4c) 필요하지만 실행 불가한 도구는 조용히 넘기지 않는다(죽은 버튼 금지, 헌법 §4.2).
  //     못 쓴 도구를 쓴 척하지 않고, 막힘 + 다음 안전 행동으로 정직하게 남긴다(S15).
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
  }

  // 5) 이번 턴 실행 사실만 모델 입력에 사실로 담아 답을 만든다(진단면 제외, 이전 턴 비혼입).
  const tc = buildTaskContext({ intent, selfState, plan, receipts: turnReceipts });
  const reply = await ctx.model.respond(tc);
  const projection = projectReceipts(turnReceipts);

  return {
    kind: 'reply',
    reply,
    selfStateSummary: summary,
    ledger: projection,
    // 막다른 답 금지: 확인 못 한 게 있으면 다음 안전 행동을 끌어올린다.
    nextSafeAction:
      projection.unconfirmed.length ? plan.recoveryCriteria : undefined,
    followUp,
  };
}
