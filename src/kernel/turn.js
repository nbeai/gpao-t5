// 턴 오케스트레이터 — Work Chat 한 턴의 심장.
// 흐름(감사 지정): 발화 → SelfState → Intent → (fast_chat | ActionPlan → Authority → 실행 → Receipt)
//                 → Truth Ledger → 다음 안전 행동.
// 판정 기준: 사용자는 채팅만 한다고 느끼지만, 뒤에서 자기파악·권한·원장·복구가 자연스럽게 돈다.
import { buildSelfState, selfStateSummary } from './l0-evidence/self-state.js';
import { detectSelfNaming } from './l1-intent/self-naming.js';
import { selfhoodLookup, selectSelfhoodDetail } from './l1-intent/selfhood-lookup.js';
import { buildCapabilityFacts, capabilityCounts } from './capabilities.js';
import { DEFAULT_IDENTITY } from './identity.js';
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
import { parseSend } from './l1-intent/send-parse.js';
import { parseFileRequest, fileClarifyQuestion } from './l1-intent/file-parse.js';
import { toolSchemasFor, callsToIntentParts } from './l2-plan/tool-schema.js';
import { nextRung, rungMessage } from './l2-plan/recovery-ladder.js';
import { updateWorkingState } from './l0-evidence/working-state.js';
import { detectPersonalToolRequest } from './l2-plan/personal-tool.js';
import { resolveCapability } from './l2-plan/capability-resolution.js';
import { defaultTargetFor } from './l5-growth/task-trace.js';
import { applicableSkill, skillInfluence } from './l5-growth/skill-learning.js';
import { APPROVAL_TTL_MS, DEFAULT_APPROVAL_MODE } from './contracts.js';

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
/**
 * 모델이 끝내 문장을 못 만들었을 때 **원장의 사실로** 답을 만든다. 빈 답은 사용자에게 먹통으로
 * 보인다 — 무엇을 시도했고 왜 막혔는지, 그리고 지금 할 수 있는 것을 말한다(막다른 답 금지).
 */
/**
 * 사용자에게 보일 "다음에 할 수 있는 것". 도구가 남긴 사용자면 문장을 쓰고, 없으면 한 줄로 만든다.
 * 내부 계획 문자열은 여기 오지 않는다 — 그게 화면에 찍히면 사용자는 무슨 말인지 알 수 없다.
 */
export function userSafeNextAction(receipts = []) {
  const fromTool = receipts.map((r) => r.nextSafeAction).find((x) => typeof x === 'string' && x.trim());
  if (fromTool) return fromTool;
  const blocked = receipts.find((r) => r.failureState && r.failureState !== 'none');
  return blocked ? '다른 방법으로 이어가 볼까요?' : undefined;
}

export function fallbackReplyFrom(receipts = []) {
  const blocked = receipts.filter((r) => r.failureState && r.failureState !== 'none');
  if (!blocked.length) return '방금 요청은 처리했는데 설명을 만들지 못했어요. 다시 한 번 말씀해 주시겠어요?';
  const what = blocked.map((r) => r.userSafeSummary).filter(Boolean).join(' ');
  const next = blocked.map((r) => r.nextSafeAction).filter(Boolean)[0];
  return `${what}${next ? ` ${next}` : ''}`.trim();
}

export async function runTurn(input, ctx) {
  const ledger = ctx.ledger ?? new TruthLedger();
  if (!ctx.pending) ctx.pending = new Map();
  const selfState = buildSelfState(ctx.env);
  const summary = selfStateSummary(selfState);

  // P-ID-1 자기인지 — 어떤 모델이 붙든 매 턴 자기가 무엇인지·어디까지 되는지 안다(헌법 §5).
  //   · 이름을 지어 주면 **이번 턴부터** 그 이름으로 답한다(지속은 서버가 identityUpdate 로).
  //   · 상시로는 개수 요약만 싣고, 물어봤을 때만 문서에서 대목을 꺼낸다(계획서 Phase 2 다이어트).
  const naming = detectSelfNaming(input.text ?? '');
  const identity = naming ? { ...(ctx.identity ?? DEFAULT_IDENTITY), name: naming.name, named: true }
    : (ctx.identity ?? DEFAULT_IDENTITY);
  const identityUpdate = naming ? { name: naming.name } : undefined;
  const capCounts = capabilityCounts(buildCapabilityFacts(selfState));
  const lookup = selfhoodLookup(input.text ?? '');
  const selfhoodDetail = lookup.needed ? selectSelfhoodDetail(ctx.selfhoodDocs ?? {}, lookup.sections) : undefined;
  const selfhood = { identity, capabilityCounts: capCounts, selfhoodDetail };
  ctx.identityUpdate = identityUpdate; // executePlan 경계를 넘겨 결과에 함께 실린다
  ctx.selfhood = selfhood;

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
    // 승인 재개 시 게이트에서 계산한 admitted·sendArgs를 함께 이어받는다(맥락·정밀 전송 인자 유지).
    return executePlan(saved.intent, saved.plan, selfState, ctx, ledger, summary, saved.admitted ?? [], saved.sendArgs);
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
    // Phase 0-5: 채널이 선언한 수신 정책·연결 상태를 게이트가 실제로 소비한다(선언만 하면 장식이다).
    channelPolicy: input.channelPolicy,
    channelConnected: input.channelConnected,
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

  // Phase 0-4: 승격된 스킬이 **말귀를 넓힌다**. 일반 규칙이 못 알아듣는 표현이라도 배운 작업의
  //   트리거와 맞으면 그것 자체가 실행 신호다 — 그게 "배웠다"의 뜻이다(계획서 Phase 7).
  //   이걸 fast_chat 판정 뒤에 두면 스킬이 구경도 못 한다(테스트에서 실제로 그랬다).
  //   **영향만 준다**: 도구를 정해 줄 뿐 실행 권한은 그대로 — 외부 전송이면 여전히 A2 를 받는다.
  const skill = applicableSkill(ctx.skills, input.text ?? '');
  const influence = skillInfluence(skill);
  ctx.usedSkill = influence ? { id: influence.skillId, label: influence.label } : undefined;

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
  // 2.0-C: "이거 쓸 수 있게 준비해줘" → 개인 도구 후보(자동 등록 아님). 원래 요청을 보존(복귀 경로).
  const toolCandidate = detectPersonalToolRequest(input.text ?? '');

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

  // P2-5b: **도구 선택을 모델에게.** 분기 전에 한 번 묻는다 — 정규식(answerMode)이 "행동이 아니다"라고
  // 판단한 말에도 손이 필요할 수 있다("오늘 날씨" 사건). 모델이 도구를 고르면 아래 계획·승인·실행
  // 경로로 내려가고, 안 고르면 그 응답이 곧 답이다(추가 호출 없음).
  let modelChosen = null;
  let earlyReply = null;
  {
    const tc = buildTaskContext({
      intent, selfState, admittedContext: admitted, recentTurns: ctx.recentTurns,
      nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
      // 자기 파악 세 번째 축: **지금 이 대화에서 어디까지 왔는가**. 이게 없으면 "리뷰 읽어봐"의
      // "리뷰"가 무엇인지 몰라 엉뚱한 것을 검색한다(오너 실사용).
      workingState: ctx.workingState,
      ...selfhood,
    });
    // 모델이 스스로 찾을 수 있으면 켜 두고 판단은 모델에 맡긴다(§24 — 우리가 목록으로 미리 맞히지 않는다).
    const wantedWeb = Boolean(intent.neededTools?.includes('web.collect')) || Boolean(ctx.modelSupportsSearch);
    const out = await ctx.model.respond(tc, {
      onDelta: intent.answerMode === 'fast_chat' && !influence ? ctx.onAnswerDelta : undefined,
      search: wantedWeb,
      // **도구를 함께 주는 호출에는 낮은 강도를 쓰지 않는다.** 낮으면 모델이 "방금 읽은 자료" 같은
      // 사실을 안 보고 표면 단어로 인자를 만든다 — 실측: 팔식당 페이지를 읽은 다음 턴의 "리뷰"를
      // 그냥 "리뷰"로 검색해 **책 리뷰 쓰는 방법**을 읽어 왔다. 잘못된 인자는 오염된 사실을 만들고,
      // 오염된 사실은 다음 턴까지 번진다. 속도보다 이해가 먼저다(절대 원칙 §0).
      effort: 'medium',
      tools: toolSchemasFor(selfState),
    });
    earlyReply = typeof out === 'string' ? out : out?.text ?? '';
    const chosen = typeof out === 'string' ? [] : (out?.toolCalls ?? []);
    if (chosen.length) modelChosen = chosen;
  }

  // 3) fast path — 손이 필요 없다고 모델이 판단했다. 이미 받은 답을 그대로 준다(추가 호출 없음).
  if (!modelChosen && intent.answerMode === 'fast_chat' && !influence) {
    return {
      kind: 'reply',
      reply: earlyReply,
      identityUpdate, // P-ID-1: 사용자가 지어 준 이름 — 서버가 지속한다
      selfStateSummary: summary, // 칩은 접힌 채(대화 점유 금지)
      ledger: { confirmed: [], unconfirmed: [], estimated: [] },
      memorySuggestion,
      toolCandidate,
      capabilityResolution: resolveCapability({ text: input.text, toolCandidate }),
      followUp,
    };
  }

  // 4) complex path — 계획 → 권한 게이트 → 실행 → 원장.
  // P6-15: 승인 모드(세션 설정). 저위험 통과 강도만 조절하고 안전 바닥은 불변. 미설정 시 smart.
  const approvalMode = ctx.approvalMode ?? DEFAULT_APPROVAL_MODE;
  // Phase 0-2: 모델이 내장 검색을 하면 T5 가 같은 일을 또 하지 않는다(중복 실행·실패 원장 방지).
  //   실사용에서 1층이 답을 만들었는데 2층도 돌아 "로그인이 필요한 페이지예요"가 원장에 남았다.
  //   OpenClaw 도 내장 검색이 있으면 관리형 검색 도구를 억제한다(같은 원리).
  let planIntent = ctx.modelSupportsSearch && intent.neededTools?.includes('web.collect')
    ? { ...intent, neededTools: intent.neededTools.filter((id) => id !== 'web.collect') }
    : intent;

  if (influence?.tool && !planIntent.neededTools?.includes(influence.tool)) {
    planIntent = { ...planIntent, neededTools: [...(planIntent.neededTools ?? []), influence.tool] };
  }
  // **승인 판정과 실행 인자는 같은 파싱 하나에서 나와야 한다.** 예전엔 승인은 `intent.fileOp` 를,
  // 실행 인자는 아래에서 원문을 다시 파싱해 만들었다. 스킬이 `local.file` 을 밀어 넣으면 fileOp 가
  // 없어 권한은 read 로 통과하는데 실행은 delete 를 했다 — 두 진실이 갈라진 자리에서 안전 바닥이 샜다.
  // P2-5b: 모델이 고른 도구가 있으면 **그것이 우선**이다. 정규식은 모델이 못 고를 때의 폴백이다
  // (모델 미연결·도구 호출 미지원 provider). 판정·승인·실행은 아래 그대로 — 경계는 안 바뀐다.
  let modelToolArgs;
  if (modelChosen?.length) {
    const parts = callsToIntentParts(modelChosen);
    if (parts.neededTools.length) {
      planIntent = { ...planIntent, neededTools: parts.neededTools, fileOp: parts.fileOp ?? planIntent.fileOp };
      modelToolArgs = parts.toolArgs;
    }
  }
  if (planIntent.neededTools?.includes('local.file') && !planIntent.fileOp) {
    planIntent = { ...planIntent, fileOp: parseFileRequest(input.text ?? '') };
  }
  const plan = buildActionPlan({ intent: planIntent, selfState, mode: approvalMode });

  // 4-auto) 반복 신호가 있으면 자동화 후보만 조용히 표면화(P6-3). 후보는 실행이 아니다 —
  //   승인 전 영향 0. action은 계획의 첫 도구를 재사용. 외부 전송 도구면 승인 경계(A2)를 상속.
  const primaryTool = plan.toolsToUse?.[0] ?? plan.needsApproval?.[0]?.action ?? null;
  // 자동화 후보의 인자도 **이번 턴이 이해한 작업 그대로**여야 한다. 원문만 실으면 나중에 tick 이
  // 돌 때 도구가 그 문장을 못 읽고 기본 동작(목록 보기)을 하고는 성공으로 기록한다 — 승인받은
  // 자동화가 엉뚱한 일을 조용히 반복하는 것이다(감사 지적).
  const primaryArgs = primaryTool === 'local.file' && planIntent.fileOp
    ? { ...planIntent.fileOp, request: intent.currentRequest ?? input.text }
    : { request: intent.currentRequest ?? input.text };
  const automationSuggestion = detectAutomationCandidate(
    input.text ?? '',
    primaryTool ? { tool: primaryTool, args: primaryArgs } : null,
  );

  // 4a) A2·A3 미승인 행동이 있으면 실행 전 멈춘다(외부효과 게이트, 헌법 §3-6).
  //     보류 계획을 서버가 보관하고 id 만 사용자에게 준다 — 승인 시 이 계획을 이어받는다.
  const pendingGrants = plan.needsApproval.filter((g) => !isExecutionAllowed(g));

  // P6-7: send류는 보낼 내용·대상을 지시 문장과 분리한다(문장 전체를 그대로 보내지 않는다).
  //   대상·내용이 애매하면 실행/승인 전에 짧게 확인한다. 명확하면 승인 preview를 어디에/무엇을로 채운다.
  // toolArgs: { [toolId]: {...} } — 도구별 정밀 인자. send 는 parseSend, 파일은 parseFileRequest 가 채운다.
  // 문장 전체를 그대로 도구에 넘기지 않는다(같은 원리를 도구 종류마다 반복 — 일반형).
  // P2-6b: **모델이 고른 인자가 실행 인자의 바닥이다.** 여기가 비어 있어서 라이브에서 이런 일이 났다:
  //   턴2 "리뷰 내용들 읽어보고" → 모델은 `web.collect{request:'…/review/visitor'}` 를 정확히 골랐는데
  //   실행부는 그걸 버리고 발화 원문("리뷰 내용들 읽어보고 …")을 검색해 **책 리뷰 쓰는 방법** 블로그를
  //   읽었다. 턴1이 멀쩡했던 건 우연이다 — 그땐 발화 원문 안에 주소가 들어 있었다.
  //   §24: 코드는 경계와 사실, 모델은 이해와 선택. 모델이 이해해서 고른 것을 정규식으로 되돌리지 않는다.
  //   아래 파일·전송 파싱은 모델이 못 고를 때(미연결·도구호출 미지원)의 폴백으로 이 위에 얹힌다.
  let sendArgs = modelToolArgs && Object.keys(modelToolArgs).length ? { ...modelToolArgs } : undefined;

  // Phase 0-1: 파일 작업 인자. 도구만 만들면 커널이 "무엇을 하라"고 말해줄 수 없다(실사용에서 드러남).
  // 인자는 **권한 판정이 본 것과 같은 파싱**을 그대로 쓴다(다시 파싱하지 않는다 — 두 진실 금지).
  if (plan.toolsToUse?.includes('local.file') || plan.needsApproval?.some((g) => g.action === 'local.file')) {
    const parsedFile = planIntent.fileOp ?? parseFileRequest(input.text ?? '');
    if (parsedFile.ambiguous) {
      // 실행 전에 한 가지만 묻는다(막다른 답 금지).
      return {
        kind: 'clarify',
        question: fileClarifyQuestion(parsedFile),
        selfStateSummary: summary,
        memorySuggestion,
        followUp,
        usedSkill: ctx.usedSkill, // 스킬이 도구를 골랐으면 묻는 자리에서도 그 사실을 숨기지 않는다
      };
    }
    sendArgs = { ...(sendArgs ?? {}), 'local.file': parsedFile };
  }
  const sendGrant = pendingGrants.find((g) => selfState.connectedTools.find((t) => t.id === g.action)?.toolKind === 'send');
  if (sendGrant) {
    // P2-5b: 모델이 보낼 내용·대상을 이미 골랐으면 그것을 쓴다(문장 재파싱보다 정확하다).
    const fromModel = modelToolArgs?.[sendGrant.action];
    const parsed = fromModel?.text
      ? { text: fromModel.text, message: fromModel.text, target: fromModel.target, ambiguous: !fromModel.target, clarifyReason: fromModel.target ? null : 'no_target' }
      : parseSend(input.text ?? '', sendGrant.action);
    // P6-11: 대상이 없지만 학습된 기본 대상(승인·replay 통과분)이 있으면 채운다 → 다음부터 "어디로?" 질문 축소.
    //   승인(A2)은 그대로다. broad memory, narrow influence: 승격된 좁은 것만 영향을 준다.
    if (parsed.clarifyReason === 'no_target') {
      const def = defaultTargetFor(ctx.defaults, sendGrant.action);
      if (def) { parsed.target = def; parsed.ambiguous = false; parsed.clarifyReason = null; parsed.usedDefault = true; }
    }
    if (parsed.ambiguous) {
      return {
        kind: 'clarify',
        usedSkill: ctx.usedSkill, // 스킬이 도구를 골랐으면 그 사실을 숨기지 않는다
        question: parsed.clarifyReason === 'no_message'
          ? '무엇을 보낼지 알려주세요. (보낼 내용)'
          : `어디로 보낼지 알려주세요. (${toolLabel(sendGrant.action)}의 채널/받는 사람)`,
        selfStateSummary: summary,
        memorySuggestion,
        capabilityResolution: resolveCapability({ text: input.text, sendClarify: { reason: parsed.clarifyReason, label: toolLabel(sendGrant.action), toolId: sendGrant.action } }),
        followUp,
      };
    }
    // 전송 인자만 갈아끼운다 — 통째로 덮으면 같은 턴의 다른 도구 인자(web.collect 등)가 사라진다.
    sendArgs = { ...(sendArgs ?? {}), [sendGrant.action]: { target: parsed.target, text: parsed.message } };
    // 승인 카드가 "어디에/무엇을/되돌리기"를 사용자 언어로 보이도록 preview를 채운다.
    sendGrant.approvalPreview = { ...sendGrant.approvalPreview, where: parsed.target, what: parsed.message };
    // P6-15: 승인 이유의 "무엇이 바뀌는지"를 구체 대상·내용으로 채운다(사용자 언어).
    sendGrant.reason = { ...sendGrant.reason, whatChanges: `${parsed.target}에 "${parsed.message}"를 실제로 보내요.` };
  }

  if (pendingGrants.length) {
    // 고유 pendingId: 서버가 newId(예: UUID)를 주입하면 지속 pending 간 충돌 없음.
    // 미주입 시(단위 테스트) 카운터 폴백. Approval Lifecycle: 만료 시각을 함께 보관.
    const pendingId = ctx.newId ? ctx.newId() : `p${(ctx._seq = (ctx._seq ?? 0) + 1)}`;
    // admitted를 pending에 함께 보존한다 — 승인 재개 실행에서 이미 계산한 맥락을 잃지 않게(감사 소보정).
    ctx.pending.set(pendingId, { intent, plan, admitted, sendArgs, grantScope: { kind: 'once', expiresAt: nowMs(ctx) + APPROVAL_TTL_MS } });
    return {
      kind: 'approval',
      pendingId,
      approvalMode, // P6-15: 현재 승인 모드(조용한 표면 — 정책 아님, 판단을 보여줄 뿐)
      // action = 매칭용 id(비표시), label = 사용자 표시명. 화면엔 label 만 쓴다.
      pending: pendingGrants.map((g) => ({
        action: g.action,
        label: toolLabel(g.action),
        tier: g.tier,
        safetyFloor: g.safetyFloor ?? false,
        preview: g.approvalPreview,
        reason: g.reason, // P6-15: 왜 필요한지/무엇이 바뀌는지/되돌릴 수 있는지(사용자 언어)
      })),
      understoodTask: plan.understoodTask,
      selfStateSummary: summary,
      followUp,
      memorySuggestion,
      automationSuggestion,
      capabilityResolution: resolveCapability({ text: input.text, permission: { label: toolLabel(pendingGrants[0].action), action: pendingGrants[0].action } }),
    };
  }

  // 4b) 승인 필요 없음 → 바로 실행.
  const result = await executePlan(intent, plan, selfState, ctx, ledger, summary, admitted, sendArgs);
  result.followUp = followUp;
  result.memorySuggestion = memorySuggestion;
  result.automationSuggestion = automationSuggestion;
  result.toolCandidate = toolCandidate;
  // 2.0-C-0: 부족 능력 신호(연결/도구)를 통합 패킷으로. 커넥터가 우선(작업 직접 차단), 없으면 도구 준비.
  result.capabilityResolution = resolveCapability({ text: input.text, connectionNeeded: result.connectionNeeded, toolCandidate });
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
async function executePlan(intent, plan, selfState, ctx, ledger, summary, admitted = [], sendArgs) {
  // 이번 턴 receipt 만 따로 모은다 — 세션 원장(감사용)과 턴 응답(사용자용)을 분리한다.
  /** @type {import('../contracts.js').ToolReceipt[]} */
  const turnReceipts = [];
  let sentVia; // P6-11: 승인된 send 실행 사실(도구·대상) — 서버가 TaskTrace로 기록하고 학습 후보를 제안한다.
  for (const toolId of plan.toolsToUse) {
    await ctx.emit?.('tool_progress', { text: `${toolLabel(toolId)} 실행 중이에요` }); // P6-12: 진행 상태(사고 원문 아님)
    // P6-7: send류는 분리된 {target, text}로 실행한다(문장 전체를 그대로 보내지 않는다). 그 외엔 요청 원문.
    const args = sendArgs?.[toolId] ?? { request: intent.currentRequest };
    const rec = await ctx.tools.run(toolId, args, selfState);
    ledger.append(rec);
    turnReceipts.push(rec);
    // 출처가 있으면 근거 추가를 알린다(evidence_added) — 웹 도구가 "확인했다"의 근거를 남긴 순간.
    if (rec.sources?.length) await ctx.emit?.('evidence_added', { count: rec.sources.length });
    // P6-11 학습 + P6-14 전달 원장: 전달 수단·대상·산출물·전달 결과를 함께 실어 보낸다(생성≠전달 분리).
    if (sendArgs?.[toolId]?.target && !sentVia) {
      sentVia = { tool: toolId, target: sendArgs[toolId].target, text: sendArgs[toolId].text, failureState: rec.failureState, userSafeSummary: rec.userSafeSummary };
    }
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
  await ctx.emit?.('trace_status', { text: '답변을 정리하고 있어요' }); // P6-12: 사용자 언어 상태
  const ladder = nextRung(turnReceipts);
  // 이번 턴에 **실제로 한 일**을 상태에 얹는다(모델 추정이 아니라 영수증 기록만).
  const workingState = updateWorkingState(ctx.workingState, {
    receipts: turnReceipts,
    blocked: ladder ? rungMessage(ladder) : undefined,
  });
  const tc = buildTaskContext({
    intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted,
    recentTurns: ctx.recentTurns, nativeSearch: Boolean(ctx.modelSupportsSearch),
    modelProviderId: ctx.modelProviderId, workingState,
    // 막힌 게 있으면 **다음에 무엇을 하면 되는지**를 사실로 준다(막다른 답 금지).
    recoveryHint: rungMessage(ladder),
    ...(ctx.selfhood ?? {}),
  });
  // Phase 0-2 1층: 이 턴이 웹을 필요로 했으면 모델 내장 검색을 켠다. 모델이 자기 인프라로 찾아
  // 읽으므로 스크래핑 차단(robots·로그인벽)에 걸리지 않는다 — 실측에서 2층은 자주 막혔다.
  // 모델이 스스로 찾을 수 있으면 **켜 두고 모델이 판단하게 한다.** 예전엔 우리 말귀가 web.collect
  // 를 골랐을 때만 켜서, "오늘 날씨 알려줘"처럼 검색 신호가 없는 말에는 모델이 도구 없이 답하다가
  // "웹 조회가 연결되어 있지 않습니다"라고 했다 — 되는데 못 한다고 말한 것이다(오너 실사용).
  // 우리가 목록으로 미리 맞히려 하면 날씨·환율·뉴스… 사례가 끝없이 늘어난다(누더기 금지).
  const wantedWeb = Boolean(intent.neededTools?.includes('web.collect')) || Boolean(ctx.modelSupportsSearch);
  // 최종 답변. 도구 목록도 함께 주되(안 주면 "그 도구가 없다"고 말한다), **모델이 또 도구를 고르면
  // 텍스트가 비어 나온다.** 그걸 그대로 내보내 빈 답이 네 번 연속 나갔다(오너 실사용, 내가 만든 버그).
  //   · 한 번은 다시 시도한다(도구 없이) — 실행 사실은 이미 프롬프트에 있으니 모델이 설명할 수 있다.
  //   · 그래도 비면 원장의 사실로 정직한 문장을 만든다. **빈 답은 절대 내보내지 않는다.**
  // P2-6 사다리: 막힌 게 있으면 **다음 계단을 정해** 최종 답변에 사실로 실어 준다.
  //   "안 됩니다"로 끝내지 않는다 — 우리 수집이 막혔으면 모델이 자기 경로로 찾고, 사람만 할 수
  //   있는 일이면 최소 단계를 부탁하고, 범위 밖이면 범위를 넓히자고 제안한다(오너 지시).
  const step = nextRung(turnReceipts);
  const finalOut = await ctx.model.respond(tc, {
    onDelta: ctx.onAnswerDelta,
    // 우리 도구가 막혔으면 모델 내장 검색을 켜서 **다른 경로로 이어가게** 한다.
    search: wantedWeb || Boolean(step?.useModelSearch && ctx.modelSupportsSearch),
    effort: 'medium',
    tools: toolSchemasFor(selfState),
  });
  let reply = typeof finalOut === 'string' ? finalOut : finalOut?.text ?? '';
  if (!reply.trim()) {
    // 도구를 빼고 한 번 더. 이번엔 고를 것이 없으니 모델은 지금까지의 사실로 답한다.
    // 내장 검색은 켜 둔다 — 우리 수집이 막혔어도 모델은 자기 인프라로 찾을 수 있다(막다른 답 금지).
    const retry = await ctx.model.respond(tc, { search: wantedWeb, effort: 'medium' });
    reply = (typeof retry === 'string' ? retry : retry?.text ?? '').trim();
  }
  if (!reply.trim()) reply = fallbackReplyFrom(turnReceipts);
  const projection = projectReceipts(turnReceipts);

  return {
    kind: 'reply',
    reply,
    identityUpdate: ctx.identityUpdate, // P-ID-1: 승인 재개 경로에서도 이름 지정을 잃지 않는다
    usedSkill: ctx.usedSkill,           // Phase 0-4: 어떤 배운 작업이 도왔는지(조용히 바뀌지 않는다)
    selfStateSummary: summary,
    ledger: projection,
    // 막다른 답 금지: 확인 못 한 게 있으면 다음 안전 행동을 끌어올린다.
    // **영수증의 사용자면 문장을 쓴다.** 예전엔 계획의 `recoveryCriteria`(내부 문자열)를 그대로
    // 올려서 사용자 화면에 "다음: 실패 시 무엇이 안전하고 다음 안전 행동을 제시한다"가 찍혔다
    // (오너 실사용). 내부 계약 문구는 사용자면에 절대 나가지 않는다(§7 사용자면/진단면 분리).
    nextSafeAction: projection.unconfirmed.length ? userSafeNextAction(turnReceipts) : undefined,
    // 현재 목표 유지(P6-1): 서버가 session.activeGoal 로 지속해 세션 간 좁게 복원한다.
    goal: { understoodTask: plan.understoodTask, successCriteria: plan.successCriteria },
    // 자기 파악 세 번째 축 — 서버가 세션에 지속해 다음 턴이 "그거"를 이어받는다.
    workingState,
    // 2.0-B: 연결이 필요한 도구가 있으면 채팅 안 연결 안내 카드로(원래 작업 보존).
    connectionNeeded,
    // P6-11: 승인된 send 실행 사실 — 서버가 학습(TaskTrace·DefaultTarget 후보)에 쓴다.
    sentVia,
  };
}
