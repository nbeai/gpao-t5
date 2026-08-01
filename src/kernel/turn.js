// 턴 오케스트레이터 — Work Chat 한 턴의 심장.
// 흐름(감사 지정): 발화 → SelfState → Intent → (fast_chat | ActionPlan → Authority → 실행 → Receipt)
//                 → Truth Ledger → 다음 안전 행동.
// 판정 기준: 사용자는 채팅만 한다고 느끼지만, 뒤에서 자기파악·권한·원장·복구가 자연스럽게 돈다.
import { buildSelfState, selfStateSummary } from './l0-evidence/self-state.js';
import { detectSelfNaming } from './l1-intent/self-naming.js';
import { externalReality } from './l1-intent/external-service.js';
import { selfhoodLookup, selectSelfhoodDetail, soulVoice } from './l1-intent/selfhood-lookup.js';
import { buildCapabilityFacts, capabilityCounts } from './capabilities.js';
import { DEFAULT_IDENTITY } from './identity.js';
import { TruthLedger, projectReceipts } from './l0-evidence/ledger.js';
import { blockedReceipt } from './l0-evidence/tool-receipt.js';
import { toolLabel, withParticle } from './tool-labels.js';
import { interpret } from './l1-intent/intent.js';
import { buildTaskContext } from './l1-intent/task-context.js';
import { buildActionPlan, toolActionKind } from './l2-plan/action-plan.js';
import { isExecutionAllowed, decideAutoGrant } from './l2-plan/authority.js';
import { decideFollowUp } from './l2-plan/follow-up.js';
import { admitInboundEvent } from './l1-intent/inbound-gate.js';
import { detectCandidate, admittedEntries, dropHistoryDuplicates, isRelevant } from './l1-intent/context-mesh.js';
import { shownFromRendered, citedFromShown } from './l5-growth/tcell-shown.js';
import { detectAutomationCandidate } from './l5-growth/automation.js';
import { parseSend, resolveSendTarget } from './l1-intent/send-parse.js';
import { parseFileRequest, fileClarifyQuestion } from './l1-intent/file-parse.js';
import { callsToIntentParts } from './l2-plan/tool-schema.js';
import { modelSchemasFor, splitModelControlCalls } from './l2-plan/model-control.js';
import {
  bindDeliverableReceipt, fileWorkIsInPlay, parseDeliverableJudgment, unsatisfiedDeliverables,
} from './l2-plan/work-contract.js';
import { nextRung, rungMessage, 읽은척차단, 호출지문 } from './l2-plan/recovery-ladder.js';
import { deriveWorkingState, workingStateFacts } from './l0-evidence/working-state.js';
import { resolveResponseSurface } from './l0-evidence/response-surface.js';
import { detectPersonalToolRequest } from './l2-plan/personal-tool.js';
import { resolveCapability } from './l2-plan/capability-resolution.js';
import { defaultTargetFor } from './l5-growth/task-trace.js';
import { applicableSkill, skillInfluence } from './l5-growth/skill-learning.js';
import { APPROVAL_TTL_MS, DEFAULT_APPROVAL_MODE , isSendTool } from './contracts.js';

// 시간 소스 — 테스트는 ctx.now 주입으로 결정적으로 제어(만료 시나리오). 미주입 시 실시간.
function nowMs(ctx) { return ctx.now ? ctx.now() : Date.now(); }

/**
 * P6-W3 · **지금 볼 수 있는 자리.** 매 턴 사실로 준다 — 도구를 부를 때만 알 수 있게 두면
 * 사용자가 "폴더를 어떻게 알려주면 돼?"라고 물었을 때 모델이 도구를 안 부르고 답한다.
 * 실측에서 그때 경로를 복사해 오라고 시켰다(원장: 그 턴 도구 호출 0건).
 * 손이 없거나 못 읽으면 **아무 말도 안 한다**(지어내지 않는다).
 */
async function 볼수있는자리(ctx) {
  try { return await ctx.tools?.tools?.['local.locate']?.places?.(); } catch { return undefined; }
}

// 한 턴에 손을 이어 쓸 수 있는 횟수. 상한의 목적은 무한 루프·비용 폭주 방지다.
// H08 라이브 실측(2026-08-01): 실제 파일 목적은 자리 찾기(이름 승계 실패 포함 1~2걸음) →
// 최종본 판별 → 읽기 → 별도 결과물 쓰기로 4걸음을 정직하게 넘는다. 4에서는 모델이 일을
// 정확히 알고도 "손을 다 써서 다음 턴에 하겠다"며 멈췄다 — t5demo-idle 과 같은 병(손 부족).
// 되풀이는 지문(호출지문)이 따로 막으므로, 상한은 목적 완주가 걸리지 않는 6으로 둔다.
const MAX_TOOL_STEPS = 6;

async function fileDeliverablesFor({ model, tc, calls, intent }) {
  const intentHasFileWork = intent?.neededTools?.some((id) => id === 'local.file' || id === 'local.locate');
  if (!fileWorkIsInPlay(calls) && !intentHasFileWork) return { assessment: 'not_applicable', deliverables: [] };
  // 모델이 처음부터 쓰기를 골랐다면 그 호출 자체가 결과 형태의 구조 판단이다.
  if (calls.some((call) => call?.name === 'local.file' && call?.args?.action === 'write')) {
    return {
      assessment: 'file',
      deliverables: [{ id: 'primary-file-output', kind: 'file', operation: 'write', binding: 'direct' }],
    };
  }
  // 읽기·찾기는 결과물이 아니라 재료일 수도 있다. 사용자 문구 규칙으로 맞히지 않고
  // 요청 전체를 본 모델에게 전용 구조 판단을 맡긴다. 형식을 못 지키면 한 번만 다시 묻는다.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const out = await model.respond({ ...tc, workContractAssessment: { kind: 'file' } }, { effort: 'medium' });
    const judgment = parseDeliverableJudgment(typeof out === 'string' ? out : out?.text);
    if (judgment === 'file') {
      return {
        assessment: 'file',
        deliverables: [{ id: 'primary-file-output', kind: 'file', operation: 'write', binding: 'derived' }],
      };
    }
    if (judgment === 'chat') return { assessment: 'chat', deliverables: [] };
  }
  // 판단 불능을 CHAT 으로 꾸미지 않는다. 사용자 답은 막지 않되 완료 상태는 만들지 않는다.
  return { assessment: 'unknown', deliverables: [] };
}

function 확정된전송미리보기(preview, args = {}) {
  if (!preview) return preview;
  const { scope: _미확정대상, ...rest } = preview;
  return {
    ...rest,
    where: args.targetLabel ?? args.target,
    what: args.text ?? args.request,
  };
}

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
  // **한 손이 막혔다고 턴이 막힌 게 아니다.**
  // 라이브 실측(c217a0c6): 같은 턴에 local.locate 는 자료를 찾았고 local.file 만 범위 밖으로
  // 막혔는데, 막힌 손의 다음 길이 턴 전체의 다음 길로 올라가 최종 답변을 지배했다 —
  // T5 는 "폴더를 통째로 복사해 주세요"라고 답했고 다음 턴에 그 파일들을 전부 읽었다.
  // 해낸 손이 있으면 막힌 손의 다음 길은 **이 턴의 다음 길이 아니다.** 무엇이 왜 막혔는지는
  // 영수증에 그대로 남고(원장), 다음 계단은 사다리가 도구 종류를 보고 정한다.
  const 해낸손 = receipts.some((r) => r && (r.failureState ?? 'none') === 'none');
  if (해낸손) return undefined;
  const fromTool = receipts.map((r) => r.nextSafeAction).find((x) => typeof x === 'string' && x.trim());
  if (fromTool) return fromTool;
  const blocked = receipts.find((r) => r.failureState && r.failureState !== 'none');
  return blocked ? '다른 방법으로 이어가 볼까요?' : undefined;
}

/**
 * 이번 턴의 **다음 길** 한 줄. 도구 말과 사다리 중 어느 쪽이 먼저인가 — 이걸 잘못 정해서
 * 라이브에서 T5 가 "폴더를 통째로 복사해 주세요"라고 답했다(c217a0c6).
 *
 * 예전 규칙은 "도구 말이 무조건 먼저"였고, 그럴 이유가 있었다: 사다리가 도구 종류를 모른 채
 * 웹 문구를 파일 실패에 씌웠다. 지금은 사다리가 **실패 종류와 지금 있는 손**을 함께 본다.
 *   · 사다리가 종류를 알아본 계단이면(`from !== 'blocked'`) 그쪽이 더 정확하다 — 손까지 보고 골랐다.
 *   · 종류를 못 알아본 일반 계단이면 예전대로 도구가 남긴 말이 먼저다(도구가 더 잘 안다).
 */
/**
 * 사용자에게 **일을 시키는** 말. 우리가 만든 문구에만 쓰는 자기 검열이다 — 사용자 말을 해석하는
 * 게 아니라, 우리 손이 뱉은 문장이 경계를 넘었는지 본다.
 */
// 활용형을 놓치면 경계가 아니라 장식이 된다 — `옮기`만 넣었더니 "옮겨 주세요"가 그대로 샜다.
const 시키는말 = /옮[기겨]|복사(해|하)|붙여넣|Finder|파인더|직접 (열어|실행해)|터미널에서/;

export function 다음길(receipts, 있는손) {
  const 계단 = nextRung(receipts, 있는손);
  const 알아본계단 = 계단 && 계단.from !== 'blocked' ? rungMessage(계단) : undefined;

  // **한 도구의 한계를 T5 전체의 한계로 말하지 않는다.** 이 흐름에서 같은 병이 두 번 났다:
  //   · locate 가 이름을 자리로 못 바꿔서 → "경로를 복사해서 알려주세요"
  //   · file 이 범위 밖이라 막혀서       → "그 폴더로 옮겨 주세요"
  // 둘 다 다음 턴에 다른 손으로 실제로 해냈다. 도구는 자기 한계만 알지 T5 를 모른다 —
  // 그래서 **경계를 여기서 친다.** 도구가 늘어도, 새 도구가 무슨 문장을 뱉든 이 경계는 그대로다:
  // 이번 턴에 막히지 않은 손이 하나라도 있으면, 사용자를 시키는 문장은 다음 길이 될 수 없다.
  const 막힌손 = new Set(
    receipts.filter((r) => r && (r.failureState ?? 'none') !== 'none')
      .map((r) => r.actualCall?.tool).filter(Boolean),
  );
  const 다른손있음 = (있는손 ?? []).some((id) => !막힌손.has(id));
  const 도구말 = userSafeNextAction(receipts);
  const 쓸도구말 = 도구말 && 다른손있음 && 시키는말.test(도구말) ? undefined : 도구말;

  return 알아본계단 ?? 쓸도구말 ?? rungMessage(계단);
}

/**
 * C 감사 F6.2 · 걸음 하나의 실패를 상태에 남길 막힘 문장으로.
 * 성공 걸음은 undefined — 그때 deriveWorkingState 의 기존 계약(성공하면 막힘을 푼다)이 돈다.
 * 이 걸음의 실패를 앞세우되, 되풀이 확전 판정은 이번 턴 전체 원장으로 한다.
 */
function 걸음막힘(rec, turnReceipts, hands) {
  if ((rec?.failureState ?? 'none') === 'none') return undefined;
  const ladder = nextRung([rec, ...(turnReceipts ?? []).filter((r) => r && r !== rec)], hands);
  return ladder ? rungMessage(ladder) : rec.userSafeSummary;
}

export function fallbackReplyFrom(receipts = []) {
  const blocked = receipts.filter((r) => r.failureState && r.failureState !== 'none');
  if (!blocked.length) return '방금 요청은 처리했는데 설명을 만들지 못했어요. 다시 한 번 말씀해 주시겠어요?';
  const what = blocked.map((r) => r.userSafeSummary).filter(Boolean).join(' ');
  const next = blocked.map((r) => r.nextSafeAction).filter(Boolean)[0];
  return `${what}${next ? ` ${next}` : ''}`.trim();
}

/**
 * **도구 현실이 바뀌면 그 현실에서 파생되는 표면을 한 번에 다시 만든다.**
 *
 * 판단하지 않고 도구를 추천하지도 않는다. 살아 있는 레지스트리와 연결 상태를 다시 읽어
 * **같은 현실의 투영본들**을 함께 만드는 일만 한다. 하나만 갱신하면 같은 턴 안에서
 * 표면마다 다른 현실을 보게 된다 — 그게 오늘 여러 번 겪은 병이다.
 *
 * 변화 감지를 두지 않는다. 도구 id 목록이나 **개수 비교는 교체를 놓친다**(하나 내리고 하나
 * 올리면 개수가 같다. 같은 id 로 세션·스키마만 갈리는 재연결도 못 잡는다). 지금 손은 스무 개
 * 남짓이고 한 턴의 실행 횟수도 상한이 있어 매번 다시 만드는 비용이 아주 작다 —
 * 이 단계에서는 영리한 감지 장치보다 정확성이 낫다. 성능이 **실제로 측정될 때**
 * 레지스트리에 `capabilityRevision` 을 두고 편입·교체·해제마다 올린다(오너 판정 2026-07-28).
 *
 * @returns {{selfState:object, summary:object}}
 */
function refreshRuntimeReality(ctx) {
  const selfState = buildSelfState(ctx.env, { tools: ctx.tools });
  // executableKinds 는 **런타임에서 온다** — 커널이 어떤 방식을 실행할 수 있는지 짐작하면
  // 그 짐작이 곧 거짓말이 된다(모델은 그걸 현실로 읽는다).
  ctx.externalReality = externalReality({
    connectors: ctx.connectors, selfState, executableKinds: ctx.executableKinds,
  });
  const capCounts = capabilityCounts(buildCapabilityFacts(selfState));
  if (ctx.selfhood) ctx.selfhood = { ...ctx.selfhood, capabilityCounts: capCounts };
  // 모델에게 가는 도구 스키마는 `modelSchemasFor(selfState)` 가 이 selfState 에서 파생한다.
  return { selfState, summary: selfStateSummary(selfState), capCounts };
}

/**
 * **한 대화에 살아 있는 승인 요청은 하나다.**
 *
 * 실측(오너 라이브 2026-07-28, G-1B): 승인하지 않고 서버를 재시작한 뒤 `아까 하던 거 이어줘`
 * 라고 했더니 T5 는 원래 업무를 정확히 이어받았지만 **새 승인 카드를 하나 더** 만들었다.
 * 화면에 같은 일을 묻는 카드가 둘 남았고, 둘 다 누르자 `connector.declare` 가 **두 번** 돌았다.
 * 이번엔 선언이 같은 id 를 덮어써서 피해가 없었지만, 전송·생성처럼 되돌릴 수 없는 행동이면
 * 그대로 두 번 나간다.
 *
 * 턴은 첫 승인에서 멈추므로 **동시에 둘이 살아 있을 이유가 없다.** 새 대기를 만들 때 이전
 * 대기는 지난 것이 된다(화면은 이미 `지난 승인 요청`으로 표시할 줄 안다 — 죽은 버튼 금지).
 * 한 계획 안의 여러 승인은 `needsApproval` 배열 하나에 들어가므로 이 규칙에 걸리지 않는다.
 */
function 이전대기를지난것으로(ctx) {
  ctx.pending?.clear?.();
}

/**
 * **빈 답을 사용자에게 돌려주지 않는다 — 최종 답을 만드는 모든 경로가 여기를 지난다.**
 *
 * 라이브에서 25턴 중 7턴이 빈 답이었다. 모델이 그 턴을 통제 호출(기억 제안·철회)에만 쓰고
 * 텍스트를 안 내면 그대로 사용자에게 갔고, 그 요청은 **다음 턴 답에 합쳐져** 나왔다 —
 * 사용자는 한 번 무시당하고 다음 턴에 두 개를 한꺼번에 받는다.
 *
 * 원인은 답을 만드는 자리가 둘인데 **계약이 하나가 아니었던 것**이다. 도구 경로에는 재시도가
 * 있었고 빠른 경로에는 없었다. 그래서 재시도를 늘리는 대신 자리를 하나로 모은다.
 *
 * 재시도는 **도구 없이** 간다(다시 쥐여 주면 또 고르고 또 텍스트가 없을 수 있다) 그리고
 * **같은 스트리밍 계약**으로 간다 — 하필 이 답만 조각으로 안 흐르면 사용자는 제일 오래
 * 기다린 자리에서 제일 늦게 본다.
 */
async function 답완성({ reply, tc, ctx, search, receipts = [] }) {
  // H09 P0(거짓 성공): 이번 턴 읽기가 전패했는데 답이 내용을 서술하면, 그 답 대신 영수증의
  // 정직한 사실이 나간다. 판정 근거는 원장이다 — 성공 영수증이 하나라도 있으면 개입하지 않는다
  // (부분 성공 턴의 오차단 방지 — 경계·검사는 recovery-ladder, 관통은 이 단일 확정 지점).
  const 거짓성공 = 읽은척차단(receipts, reply);
  if (거짓성공?.blocked) return 거짓성공.정직한답;
  if (String(reply ?? '').trim()) return reply;
  const retry = await ctx.model.respond({ ...tc, toolBudgetSpent: true }, {
    onDelta: ctx.onAnswerDelta, search, effort: 'medium',
  });
  const 다시 = (typeof retry === 'string' ? retry : retry?.text ?? '').trim();
  return 다시 || fallbackReplyFrom(receipts);
}

/**
 * **화면에 이미 나간 조각과 지속되는 최종 답은 같은 사실이어야 한다**(H 진단 계열 ④).
 *
 * 도구 턴이 스트리밍되면 한 턴 안의 여러 모델 호출이 조각을 흘릴 수 있다 — 모델이 도구를
 * 고르며 이미 한 말("잠깐 볼게요")도 사용자 화면에 나갔다. 나간 말은 물릴 수 없으므로 버리지
 * 않는다(승인 카드의 `지금까지` 와 같은 원리). 이 원장이 그 누적을 들고 있다가, 최종 답이
 * 정해지는 자리에서 `미리보기정렬` 로 둘을 하나의 사실로 만든다.
 */
function 미리보기원장(ctx) {
  if (!ctx.onAnswerDelta || ctx.미리보기) return;
  const raw = ctx.onAnswerDelta;
  const pv = {
    shown: '',
    emit(piece) {
      const p = String(piece ?? '');
      if (!p) return;
      pv.shown += p;
      try { raw(p); } catch { /* 화면 갱신 실패가 응답을 깨지 않는다 */ }
    },
  };
  ctx.onAnswerDelta = (piece) => pv.emit(piece);
  ctx.미리보기 = pv;
}

/**
 * 최종 답과 미리보기 누적을 정렬한다. 네 경우뿐이다:
 *   · 같다 → 그대로 · 아직 아무 것도 안 나감 → 답 전체를 한 조각으로 내보냄(완료 전에 도착)
 *   · 답이 누적을 이어 감 → 남은 꼬리만 내보냄 · 누적이 답으로 끝남(중간 말 + 최종 답이 전부
 *     흐른 경우) → 나간 말을 버리지 않고 누적 전체가 답이 된다
 * 그 밖(중간에 흐른 말과 무관한 답이 계산된 경우)은 나간 말 뒤에 답을 잇는다 — 화면을 물릴 수
 * 없으므로 답이 화면을 따라온다.
 */
function 미리보기정렬(reply, pv) {
  const 답 = String(reply ?? '');
  if (!pv) return 답;
  if (!pv.shown) { pv.emit(답); return 답; }
  if (답 === pv.shown) return 답;
  if (답.startsWith(pv.shown)) { pv.emit(답.slice(pv.shown.length)); return 답; }
  if (pv.shown.endsWith(답)) return pv.shown;
  const 이은답 = 답.trim() ? `${pv.shown}\n\n${답.trim()}` : pv.shown;
  pv.emit(이은답.slice(pv.shown.length));
  return 이은답;
}

export async function runTurn(input, ctx) {
  // 3축: 이번 턴의 응답 표면. **맨 위에서 한 번만** 정한다 — 승인 재개(executePlan 직행) 경로도
  // 같은 표면을 쓴다. 채널마다 커널을 나누지 않는다(같은 커널, 표면만 다르다).
  ctx.surface = resolveResponseSurface(input);
  // 계열 ④: 이 턴에 화면으로 나가는 조각을 한 원장이 든다 — 최종 답이 그 누적을 따라온다.
  미리보기원장(ctx);
  const ledger = ctx.ledger ?? new TruthLedger();
  if (!ctx.pending) ctx.pending = new Map();
  // **새 요청이면 허락은 새로 받는다.** 승인 면제는 한 요청 안에서만 이어진다 —
  // ctx 는 턴을 넘어 살아 있으므로 여기서 비우지 않으면 다음 요청까지 조용히 넘어간다.
  if (typeof input.text === 'string' && input.text.trim()) {
    ctx.허락한손 = undefined;
    // **새 발화는 이전 승인을 지난 것으로 만든다.**
    //
    // 실측(오너 라이브 G 행렬 2026-07-29): 승인 대기 중에 `아, 잠깐. 그건 됐고 지금 몇 시야?`
    // 라고 했더니 시간은 정확히 답했는데 **이전 승인 카드가 그대로 살아 있었다.** 사용자는
    // 그만두라고 말했는데 누르면 실행되는 버튼이 남은 것이다.
    //
    // 예전에는 **새 승인을 만들 때만** 지난 것으로 바꿨다. 그래서 새 발화가 승인 작업을 만들지
    // 않으면(질문·잡담·화제 전환) 옛 승인이 계속 살아남았다.
    //
    // 새 발화의 뜻을 정규식으로 맞히지 않는다 — 수정일 수도, 질문일 수도, 취소일 수도 있다.
    // 대신 **옛 스냅샷을 무효화하고**, 이어갈 필요가 있으면 모델이 최신 맥락으로 새 승인을
    // 만들게 한다(G-1B 에서 `이어줘` 가 그렇게 도는 것을 확인했다). 승인은 버튼으로만 오므로
    // 이 규칙이 "응, 해줘" 같은 말을 가로채지도 않는다.
    이전대기를지난것으로(ctx);
  }
  // P5-B-0.5: **판정하지 않고 현실만 싣는다.** 어느 서비스 얘기인지, 어느 길이 자연스러운지는
  // 모델이 고른다(§24). 조립부마다 따로 만들면 같은 턴인데 표면마다 다른 현실을 보게 된다.
  // executePlan 은 input 을 안 받으므로 ctx 에 실어 둔다(askedFrom 과 같은 이유).
  const { selfState, summary } = refreshRuntimeReality(ctx);

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
  // 말투는 **매 턴** 간다 — 그게 "한 대화 안에서 일관된 목소리"의 근거다. 정체·능력 상세는
  // 지금처럼 물어봤을 때만(다이어트). SOUL.md 는 사용자가 고치는 문서이고, 말투 구역을 지우면
  // 아무 것도 안 실린다 — 그게 사용자의 주도권이다.
  const voice = soulVoice(ctx.selfhoodDocs?.soul);
  const selfhood = { identity, capabilityCounts: capCounts, selfhoodDetail, voice };
  ctx.identityUpdate = identityUpdate; // executePlan 경계를 넘겨 결과에 함께 실린다
  ctx.selfhood = selfhood;
  // **어느 자리에서 물었는가.** 실행 루프 중간에 승인이 필요해질 수도 있어서(executePlan 은
  // input 을 안 받는다) 여기서 ctx 에 실어 둔다 — 결과가 요청이 온 자리로 돌아가는 계약(L9).
  ctx.askedFrom = input.channel ? { channel: input.channel } : undefined;

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
    // **원래 물어본 자리를 잃지 않는다.** 방에서 시킨 일을 화면에서 승인해도, 그 뒤 걸음에서
    // 승인이 또 필요해지면 그 카드도 방으로 가야 한다(L9 — 결과는 요청이 온 자리로).
    ctx.askedFrom = saved.askedFrom ?? ctx.askedFrom;
    // **이 요청에서 이미 허락한 손을 기억한다.** 실측(오너 라이브 2026-07-28, D):
    // "노션에서 회의록 찾아줘" 한 마디에 승인 카드가 네 번 떴다 — 같은 손이 인자만 바꿔
    // 다시 물었기 때문이다. 두 번째 카드는 첫 번째와 **같은 질문**이라 사용자가 새로 판단할
    // 것이 없다. 그렇게 묻는 것은 확인이 아니라 절차가 되고, 사용자는 읽지 않고 누르게 된다.
    // 범위는 **이 요청 안에서만**이다. 요청이 바뀌면 맥락도 바뀌므로 다시 묻는다.
    ctx.허락한손 = new Set(saved.허락한손 ?? []);
    // 승인 재개 시 게이트에서 계산한 admitted·sendArgs를 함께 이어받는다(맥락·정밀 전송 인자 유지).
    return executePlan(saved.intent, saved.plan, selfState, ctx, ledger, summary, saved.admitted ?? [], saved.sendArgs);
  }

  // B) 승인 거부 — 안전 정지. 실행하지 않고 초안·상태를 보존한다.
  //
  // **모든 거절을 전송 취소처럼 말하지 않는다.** 실측(오너 라이브 2026-07-28): 파일 저장을
  // 거절했는데 "보내지 않았어요. 초안은 그대로 있어요"라고 답했다. 보내는 일이 아니었다.
  // 커널은 무슨 도구였는지 몰라야 하므로, 건너뛴 일은 **도구가 승인 카드에 쓴 자기 말**
  // (approvalPreview.impact)을 그대로 인용한다 — 여기서 문장을 새로 짓지 않는다.
  if (input.reject) {
    const 거절된것 = ctx.pending.get(input.reject);
    const 손 = 거절된것?.plan?.toolsToUse?.[0] ?? 거절된것?.plan?.needsApproval?.[0]?.action;
    const 인자 = 거절된것?.sendArgs?.[손] ?? 거절된것?.intent?.toolArgs?.[손] ?? {};
    // 도구가 **자기 취소 문장**을 선언했으면 그것이 먼저다(코덱스 65cb808 의 계약).
    // 없으면 도구가 승인 카드에 쓴 자기 말을 인용한다 — 커널은 무슨 도구였는지 몰라야 하고,
    // 여기서 종류로 갈라 문장을 짓지 않는다(그게 "모든 거절이 전송" 이 된 원인이다).
    const 건너뛴일 = (거절된것?.plan?.needsApproval ?? [])
      .map((g) => g.approvalPreview?.impact).filter(Boolean)[0];
    ctx.pending.delete(input.reject);
    const reply = ctx.tools?.tools?.[손]?.cancelledSummary?.(인자)
      ?? (건너뛴일 ? `안 했어요. 아무것도 바뀌지 않았어요. (건너뛴 일: ${건너뛴일})`
        : '안 했어요. 아무것도 바뀌지 않았어요.');
    return { kind: 'reply', reply, selfStateSummary: summary };
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
  // S5-1(§4.5): 신분을 단 채로 만들고, 렌더에는 문장만 쓴다. **같은 배열**이라 보인 것과
  // 기록한 것이 갈릴 수 없다 — 렌더 뒤에 다시 계산하면 언젠가 다른 답이 나온다.
  // 채널 중복 제거(§5-K): 원천 발화가 이번 이력에 이미 실리면 기억 블록으로 재공급하지
  // 않는다 — 렌더 전에 거르므로 shown 도 같은 사실을 본다(같은 배열 원칙 그대로).
  const admittedRich = dropHistoryDuplicates(
    admittedEntries(ctx.memory ?? {}, input.text ?? ''), ctx.recentTurns ?? []);
  const admitted = [
    ...(goalRelevant ? [`현재 목표: ${ctx.activeGoal.understoodTask}`] : []),
    ...admittedRich.map((e) => e.statement),
  ];
  // 이 턴에 **실제로 모델 앞에 놓인** 것들의 신분. 현재 목표는 기억이 아니므로 세지 않는다.
  const 렌더재료 = {
    렌더된: [...admitted, ...(ctx.carryableWork ?? [])],
    후보들: [...admittedRich, ...(ctx.carryableWorkEntries ?? [])],
  };
  // S5-2: 모델이 "이걸 참고했다"고 주장하면 여기에 담긴다. **사실이 아니라 주장이다.**
  let modelCitedRefs = null;
  // S5-3: 모델이 "지금 사용자가 앞 답을 고치고 있다"고 알려주면 여기에 담긴다.
  // Runtime 은 낱말로 판정하지 않는다 — 모델이 안 알려주면 아무 일도 일어나지 않는다.
  let memoryCorrection = null;
  // W2: 스킬·자동화·에이전트 제안도 기억 통제와 같은 생명주기를 탄다. 실행 호출이 아니라
  // 후보 제출이며, 어느 모델 호출 경로에서 나왔든 턴 결과의 소비자까지 잃지 않고 운반한다.
  let skillProposal = null;
  let automationProposal = null;
  let agentProposal = null;
  const 통제제안받기 = (분리) => {
    if (분리?.skillProposal) skillProposal = 분리.skillProposal;
    if (분리?.automationProposal) automationProposal = 분리.automationProposal;
    if (분리?.agentProposal) agentProposal = 분리.agentProposal;
  };
  const 통제제안 = () => ({ skillProposal, automationProposal, agentProposal });
  const shownMemoryRefs = shownFromRendered({
    turnRef: input.turnRef ?? null,
    ...렌더재료,
    at: ctx.now ?? 0,
  });
  // H(오너 감사 2026-07-29): **의미 포착은 모델이 한다.** 모델이 memory.propose 로 제출한 후보가
  // 우선이고, 아래 정규식(detectCandidate)은 모델이 도구를 못 고를 때(미연결·도구 미지원)의
  // 보조 신호로 내려간다. 후보는 어느 쪽이든 영향 0 — 반영은 사용자 확인 뒤에만(§5).
  let memorySuggestion = detectCandidate(input.text ?? '');
  // S1: 기억 철회는 모델의 통제 호출로만 온다(정규식 감지 없음 — 의미 판단은 모델의 것).
  let memoryWithdrawal = null;
  // 2.0-C: "이거 쓸 수 있게 준비해줘" → 개인 도구 후보(자동 등록 아님). 원래 요청을 보존(복귀 경로).
  const toolCandidate = detectPersonalToolRequest(input.text ?? '');

  // 2) **모호함은 정규식이 판정하지 않는다**(P2-8, §24 · §0 「앞」).
  //
  // 예전엔 여기서 `intent.needsClarification` 이면 **모델을 부르기도 전에** 하드코딩 문장으로
  // 되물었다("무엇을 말씀하시는 걸까요? (직전 대화 / 특정 파일 / 할 일)"). 라이브 실측:
  //   "그거 정리해줘" → clarify(하드코딩 문장)
  //   "이거 요약해줘" → 팔식당을 정확히 요약        ← 같은 대화·같은 모호함
  // 갈린 이유는 하나뿐이었다 — "정리"는 ACTION_SIGNALS 정규식에 있고 "요약"은 없었다.
  // 정규식 단어 하나로 하나는 되묻고 하나는 완벽히 답했다. **모델은 할 수 있었다.**
  //
  // 정규식을 손보는 건 같은 병이다(다음 단어에서 또 난다). 우리는 비킨다 — "그거"가 무엇인지는
  // workingState 가 사실로 주고, 그래도 모르면 모델이 헌장 <질문>대로 하나만 짧게 묻는다.
  // 안전은 안 풀린다: 실행 승인은 여기가 아니라 authority(A2·A3·safetyFloor)가 따로 잡는다.

  // P2-5b: **도구 선택을 모델에게.** 분기 전에 한 번 묻는다 — 정규식(answerMode)이 "행동이 아니다"라고
  // 판단한 말에도 손이 필요할 수 있다("오늘 날씨" 사건). 모델이 도구를 고르면 아래 계획·승인·실행
  // 경로로 내려가고, 안 고르면 그 응답이 곧 답이다(추가 호출 없음).
  let modelChosen = null;
  let earlyReply = null;
  // 이 턴의 문맥을 블록 밖에서도 쓴다 — 승인으로 멈출 때 **한 번 더 말하게** 하려면 필요하다.
  let earlyTc;
  let earlyWantedWeb = false;
  {
    const tc = earlyTc = buildTaskContext({
      externalReality: ctx.externalReality,
      intent, selfState, admittedContext: admitted, recentTurns: ctx.recentTurns,
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
      // 3축: 지금 이 답이 어디로 나가는가(웹/메신저). 같은 커널, 표면만 다르다.
      surface: ctx.surface,
      nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
      // 자기 파악 세 번째 축: **지금 이 대화에서 어디까지 왔는가**. 이게 없으면 "리뷰 읽어봐"의
      // "리뷰"가 무엇인지 몰라 엉뚱한 것을 검색한다(오너 실사용).
      workingState: ctx.workingState,
      ...selfhood,
    });
    // 모델이 스스로 찾을 수 있으면 켜 두고 판단은 모델에 맡긴다(§24 — 우리가 목록으로 미리 맞히지 않는다).
    const wantedWeb = earlyWantedWeb = Boolean(intent.neededTools?.includes('web.collect')) || Boolean(ctx.modelSupportsSearch);
    const out = await ctx.model.respond(tc, {
      onDelta: intent.answerMode === 'fast_chat' && !influence ? ctx.onAnswerDelta : undefined,
      search: wantedWeb,
      // **도구를 함께 주는 호출에는 낮은 강도를 쓰지 않는다.** 낮으면 모델이 "방금 읽은 자료" 같은
      // 사실을 안 보고 표면 단어로 인자를 만든다 — 실측: 팔식당 페이지를 읽은 다음 턴의 "리뷰"를
      // 그냥 "리뷰"로 검색해 **책 리뷰 쓰는 방법**을 읽어 왔다. 잘못된 인자는 오염된 사실을 만들고,
      // 오염된 사실은 다음 턴까지 번진다. 속도보다 이해가 먼저다(절대 원칙 §0).
      effort: 'medium',
      tools: modelSchemasFor(selfState),
    });
    earlyReply = typeof out === 'string' ? out : out?.text ?? '';
    // **모든 모델 호출 결과는 이 한 경계를 지난다** — 통제 호출(기억 후보 등)은 실행이 아니므로
    // 여기서 분리되어 후보 채널로만 가고, 나머지만 계획·승인·실행으로 간다.
    const 분리 = splitModelControlCalls(typeof out === 'string' ? [] : (out?.toolCalls ?? []));
    통제제안받기(분리);
    if (분리.memorySuggestion) memorySuggestion = 분리.memorySuggestion;
    if (분리.memoryWithdrawal) memoryWithdrawal = 분리.memoryWithdrawal;
    // 주장을 **보인 것에 대조**해 신분으로 바꾼다. 대조 못 한 것은 신분을 얻지 못한다.
    if (분리.memoryCitation) {
      const 대조 = citedFromShown({ ...렌더재료, used: 분리.memoryCitation.used });
      if (대조.refs.length) modelCitedRefs = 대조.refs;
    }
    if (분리.memoryCorrection) memoryCorrection = 분리.memoryCorrection;
    if (분리.rest.length) modelChosen = 분리.rest;
  }

  // 완료 형태 판단은 fast path 보다 먼저 선다. 모델이 첫 응답에서 손을 고르지 않았다는 이유로
  // 파일 산출물 요청이 대화 답만 남기고 빠져나가면, 바로 막으려던 H08 실패가 재발한다.
  const completionContract = await fileDeliverablesFor({
    model: ctx.model, tc: earlyTc, calls: modelChosen ?? [], intent,
  });

  // 3) fast path — 손이 필요 없다고 모델이 판단했다. 이미 받은 답을 그대로 준다(추가 호출 없음).
  if (!modelChosen && intent.answerMode === 'fast_chat' && !influence
      && (completionContract.assessment === 'not_applicable' || completionContract.assessment === 'chat')) {
    // 도구를 안 쓴 턴도 **대화의 한 턴이다.** 여기서 상태를 안 넘기면 턴 수가 멈춰서, 옛 대상이
    // 영원히 "방금 읽은 자료"로 남는다 — 감쇠가 필요한 바로 그 턴(화제 전환)에 감쇠가 안 돈다.
    // 라이브 실측에서 드러났다: 팔식당 뒤로 파이썬 얘기를 네 턴 해도 여전히 "방금 팔식당"이었다.
    const idleState = deriveWorkingState(ctx.workingState, { receipts: [], places: await 볼수있는자리(ctx) });
    return {
      kind: 'reply',
      // 빈 답을 그대로 돌려주던 자리다(H 진단 계열 ③ · P1). 계열 ④: 화면에 나간 조각과 정렬.
      reply: 미리보기정렬(await 답완성({ reply: earlyReply, tc: earlyTc, ctx, search: earlyWantedWeb }), ctx.미리보기),
      shownMemoryRefs, // S5-1: 손을 안 쓴 턴도 **모델 앞에 놓인 것**은 같다
      modelCitedRefs,  // S5-2: 모델의 주장(사용 사실 아님)
      memoryCorrection, // S5-3: 정정 신호(상관의 재료)
      ...통제제안(),
      workingState: idleState,
      contextShown: workingStateFacts(idleState),
      identityUpdate, // P-ID-1: 사용자가 지어 준 이름 — 서버가 지속한다
      selfStateSummary: summary, // 칩은 접힌 채(대화 점유 금지)
      ledger: { confirmed: [], unconfirmed: [], estimated: [] },
      memorySuggestion,
      memoryWithdrawal,
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
    // 1축: 우리가 **실제로 보여준** 도구만 받아들인다(selfState 파생 — 수동 맵 없음).
    const parts = callsToIntentParts(modelChosen, selfState);
    if (parts.neededTools.length) {
      planIntent = { ...planIntent, neededTools: parts.neededTools, fileOp: parts.fileOp ?? planIntent.fileOp };
      modelToolArgs = parts.toolArgs;
      // 등급 판정도 **모델이 고른 인자**를 본다. 안 실어 보내면 계획 단계가 빈 인자로 판정해
      // 위험한 작업이 자동으로 새어 나간다(local.process 의 start 가 그렇게 승인 없이 실행됐다).
      planIntent = { ...planIntent, toolArgs: parts.toolArgs };
    }
  }
  planIntent = {
    ...planIntent,
    deliverableAssessment: completionContract.assessment,
    ...(completionContract.deliverables.length ? { deliverables: completionContract.deliverables } : {}),
  };
  if (planIntent.neededTools?.includes('local.file') && !planIntent.fileOp) {
    planIntent = { ...planIntent, fileOp: parseFileRequest(input.text ?? '') };
  }
  // P6-T2: 명령의 등급은 **돌려 봐야 안다.** 계획을 세우기 전에 probe 로 한 번 돌린다 —
  // 쓰기·네트워크·비밀읽기가 커널에서 막힌 상태라 승인 없이 돌려도 영향이 0 이다(그래서 안전하다).
  //   · 아무것도 안 바꿨다 → 그 자체가 증명이라 A0 로 그냥 진행한다.
  //   · 뭔가 바꾸려다 막혔다 → A2 승인 카드로 간다. 승인 뒤에만 granted 로 실제 실행한다.
  // 위험 명령 목록으로 알아맞히지 않는 이유는 실측이다 — 목록은 find -delete 하나에 뚫린다.
  if (planIntent.neededTools?.includes('local.terminal')) {
    const asked = modelToolArgs?.['local.terminal'];
    const command = typeof asked?.command === 'string' ? asked.command.trim() : '';
    if (command) {
      const probed = await ctx.tools?.tools?.['local.terminal']?.probe?.(command, { cwd: asked.cwd });
      planIntent = {
        ...planIntent,
        // probe 를 못 돌렸으면 `changes` 를 비워 둔다 — 미상은 승인으로 간다(read 로 흘리지 않는다).
        // probe 결과를 **그대로 싣는다.** 안 그러면 도구가 같은 명령을 한 번 더 돌린다 —
        // 느린 것보다, `date`·`ls` 처럼 두 번 돌리면 답이 달라지는 명령에서 사용자에게 보인 것과
        // 원장에 남은 것이 갈라지는 게 문제다(두 진실 금지).
        terminalOp: {
          command, cwd: probed?.cwd ?? asked.cwd, changes: probed?.changes,
          granted: probed?.changes === true, probeResult: probed?.probe,
        },
      };
    }
  }
  // 승인 카드에 실을 사실을 **도구에게 물어 둔다.** 도구별 if 가 아니라 계약 하나다 —
  // 새 도구가 previewOf 를 내면 그대로 카드에 실린다(안 내면 예전 문구로 떨어진다).
  const toolPreviews = {};
  for (const id of planIntent.neededTools ?? []) {
    const 인자 = id === 'local.terminal' ? planIntent.terminalOp : (planIntent.toolArgs?.[id] ?? planIntent.fileOp);
    const pv = ctx.tools?.tools?.[id]?.previewOf?.(인자 ?? {});
    if (pv) toolPreviews[id] = pv;
  }
  if (Object.keys(toolPreviews).length) planIntent = { ...planIntent, toolPreviews };
  // 승인보다 먼저, 그 도구가 **지금의 실제 선언과 상태에서 요청할 수 있는 일인지**만 확인한다.
  // 이 계약은 실행이나 외부 확인을 하지 않는다. 도구가 "불가능"을 알리면 승인 카드로
  // 포장하지 않고 그 사실을 원장과 모델에 넘긴다. 그래야 사용자는 존재하지 않는 일을
  // 허락하지 않고, 모델은 그 사실 위에서 다음 길을 판단한다.
  for (const id of planIntent.neededTools ?? []) {
    const args = id === 'local.terminal' ? planIntent.terminalOp : (planIntent.toolArgs?.[id] ?? planIntent.fileOp ?? {});
    const eligibility = await ctx.tools?.tools?.[id]?.approvalEligibility?.(args);
    if (eligibility && eligibility.allowed === false) {
      const rec = blockedReceipt(
        `${toolLabel(id, selfState)} 실행`, id,
        eligibility.userSafeSummary ?? '지금은 이 요청을 실행할 수 없어요.',
        eligibility.nextSafeAction,
        eligibility.diagnostic,
      );
      ledger.append(rec);
      const workingState = deriveWorkingState(ctx.workingState, {
        places: await 볼수있는자리(ctx), receipts: [rec],
      });
      // 이 자리는 모델에게 추론을 대신시키는 곳이 아니다. 아직 존재를 확인하지 못한 연결을
      // 승인 카드로 꾸미지 않았다는 **실행 사실**을 먼저 보존한다. 그 사실은 다음 턴의
      // TaskContext와 원장에 올라가므로 모델은 그 위에서 다음 길을 판단한다.
      const reply = [rec.userSafeSummary, rec.nextSafeAction].filter(Boolean).join(' ');
      return {
        kind: 'reply', reply, workingState, contextShown: workingStateFacts(workingState),
        selfStateSummary: summary, ledger: projectReceipts([rec]), followUp, memorySuggestion, memoryWithdrawal,
        shownMemoryRefs, modelCitedRefs, memoryCorrection,
      };
    }
  }
  // S1 충돌 해소(오너 판정 2026-07-31) — **같은 발화에서 더 구체적인 의도가 확정된 경우에만**
  // 정규식 폴백의 파일 undo 오탐을 걷는다. "방금 기억한 선호는 취소해줘"는 기억 철회인데
  // `취소해` 가 파일 도구 신호로도 읽혀, 기억을 지우고도 "파일 작업을 되돌릴까요?" 승인이
  // 함께 떴다(봉인 실측 H04 오라우팅의 잔재, S1 라이브 3/3 재현).
  // 범위: 모델이 memory.withdraw 를 실제로 부른 턴 + 모델이 파일 도구를 직접 고르지 않은 경우뿐.
  // 파일 되돌리기 능력 자체는 그대로다 — 모델이 고르거나 다른 발화면 평소처럼 승인을 거친다.
  if (memoryWithdrawal && !modelChosen?.length
      && planIntent.neededTools?.includes('local.file') && planIntent.fileOp?.action === 'undo') {
    const 남은손 = planIntent.neededTools.filter((x) => x !== 'local.file');
    planIntent = { ...planIntent, neededTools: 남은손, fileOp: undefined };
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
      memoryWithdrawal,
        followUp,
        usedSkill: ctx.usedSkill, // 스킬이 도구를 골랐으면 묻는 자리에서도 그 사실을 숨기지 않는다
      };
    }
    sendArgs = { ...(sendArgs ?? {}), 'local.file': parsedFile };
  }
  // 승인 판정이 본 것과 **같은 사실**로 실행한다. granted 는 probe 가 막혔을 때만 참이고,
  // 그 실행은 위 승인 게이트를 통과해야만 일어난다(여기서 참이라고 바로 도는 게 아니다).
  if (planIntent.terminalOp) {
    sendArgs = { ...(sendArgs ?? {}), 'local.terminal': planIntent.terminalOp };
  }
  const sendGrant = pendingGrants.find((g) => isSendTool(g.action, selfState));
  if (sendGrant) {
    // P2-5b: 모델이 보낼 내용·대상을 이미 골랐으면 그것을 쓴다(문장 재파싱보다 정확하다).
    const fromModel = modelToolArgs?.[sendGrant.action];
    const parsed = fromModel?.text
      ? { text: fromModel.text, message: fromModel.text, target: fromModel.target, ambiguous: !fromModel.target, clarifyReason: fromModel.target ? null : 'no_target' }
      : parseSend(input.text ?? '', sendGrant.action);
    // P6-7 후반: 대상을 **실행할 수 있는 사실**로 확정한다. 라벨("오너")·자기 지칭("내 텔레그램")은
    // 그 채널의 허용된 대화 목록(ctx.channelTargets — 서버가 공급하는 현실)으로만 풀린다. 이게 없어서
    // 라이브(2026-07-29 F)에서 "내 텔레그램으로 보내줘"가 영원히 확정될 수 없었다.
    const 아는곳 = ctx.channelTargets?.[sendGrant.action] ?? [];
    const 확정 = resolveSendTarget({ target: parsed.target || null, text: input.text, known: 아는곳 });
    if (확정) {
      parsed.target = 확정.target; parsed.targetLabel = 확정.label;
      if (parsed.clarifyReason === 'no_target') { parsed.ambiguous = false; parsed.clarifyReason = null; }
    }
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
        // P2 봉인 검사에서 걸린 것: 여기가 이렇게 물었다 —
        //   "어디로 보낼지 알려주세요. (텔레그램 전송의 채널/받는 사람)"
        // 괄호 안에 **내부 구조가 그대로 노출**됐다. 완료 기준 ③("승인/복구 안내가 정책문처럼
        // 보이지 않는다") 위반이다. 멈추는 것 자체는 안전이므로 그대로 두고, **말만 사람 말로** 한다.
        // 아는 곳(허용된 대화)이 있으면 **실제 선택지를 사실로** 준다 — 사용자가 이름을 지어내
        // 맞히게 두지 않는다(막다른 질문 금지).
        question: parsed.clarifyReason === 'no_message'
          ? '어떤 내용을 보낼까요?'
          : `${withParticle(toolLabel(sendGrant.action, selfState), '로')} 어디에 보낼까요?`
            + (아는곳.length ? ` 지금 바로 보낼 수 있는 곳: ${아는곳.map((k) => k.label ?? k.target).join(' · ')}` : ''),
        selfStateSummary: summary,
        memorySuggestion,
      memoryWithdrawal,
        capabilityResolution: resolveCapability({ text: input.text, sendClarify: { reason: parsed.clarifyReason, label: toolLabel(sendGrant.action, selfState), toolId: sendGrant.action } }),
        followUp,
      };
    }
    // 전송 인자만 갈아끼운다 — 통째로 덮으면 같은 턴의 다른 도구 인자(web.collect 등)가 사라진다.
    // targetLabel 은 화면·미리보기용 사람 말이다 — 실행은 target(실행 값)만 쓴다.
    sendArgs = {
      ...(sendArgs ?? {}),
      [sendGrant.action]: {
        target: parsed.target, text: parsed.message,
        ...(parsed.targetLabel ? { targetLabel: parsed.targetLabel } : {}),
      },
    };
    // 승인 카드가 "어디에/무엇을/되돌리기"를 사용자 언어로 보이도록 preview를 채운다.
    const 보이는대상 = parsed.targetLabel ?? parsed.target;
    // 대상이 확정되면 미확정 상태를 설명하던 scope는 폐기한다. 같은 카드에
    // "받는 곳 미정"과 "오너"가 함께 있으면 표면이 어느 쪽을 그리든 객체에는 두 진실이 남는다.
    sendGrant.approvalPreview = 확정된전송미리보기(sendGrant.approvalPreview, {
      target: parsed.target,
      targetLabel: parsed.targetLabel,
      text: parsed.message,
    });
    // P6-15: 승인 이유의 "무엇이 바뀌는지"를 구체 대상·내용으로 채운다(사용자 언어).
    sendGrant.reason = { ...sendGrant.reason, whatChanges: `${보이는대상}에 "${parsed.message}"를 실제로 보내요.` };
  }

  if (pendingGrants.length) {
    // 고유 pendingId: 서버가 newId(예: UUID)를 주입하면 지속 pending 간 충돌 없음.
    // 미주입 시(단위 테스트) 카운터 폴백. Approval Lifecycle: 만료 시각을 함께 보관.
    const pendingId = ctx.newId ? ctx.newId() : `p${(ctx._seq = (ctx._seq ?? 0) + 1)}`;
    // admitted를 pending에 함께 보존한다 — 승인 재개 실행에서 이미 계산한 맥락을 잃지 않게(감사 소보정).
    이전대기를지난것으로(ctx);
    ctx.pending.set(pendingId, {
      intent, plan, admitted, sendArgs,
      // **결과는 요청이 온 자리로 돌아간다.** 승인은 표면을 건너뛸 수 있어도(방에서 시켰는데
      // 화면에서 승인) 결과까지 건너뛰면 안 된다 — 라이브 실측: 방에서 시키고 방에서
      // "확인해 주시면 이어서 할게요"를 들은 뒤 화면에서 승인했는데, 방은 영영 조용했다.
      // 어느 표면이 물었는지만 봉인한다. 어디로 보낼지(방 id)와 보내는 일은 서버가 안다.
      askedFrom: input.channel ? { channel: input.channel } : undefined,
      // 이 요청에서 허락받은 손. 계획 경로와 걸음 경로가 **같은 규칙**을 써야 한다 —
      // 한쪽만 면제하면 같은 요청인데 어느 길로 왔느냐에 따라 묻는 횟수가 달라진다.
      허락한손: [...(ctx.허락한손 ?? []), ...pendingGrants.map((g) => g.action).filter(Boolean)],
      grantScope: { kind: 'once', expiresAt: nowMs(ctx) + APPROVAL_TTL_MS },
    });
    // **멈출 때도 말한다.** 라이브 실측(ae1d3ea8): 사용자가 "작업용SSD"라고만 답한 턴에서
    // 승인 카드만 뜨고 T5 는 한 마디도 안 했다 — 사용자에겐 먹통으로 보인다. 카드에는 명령
    // 원문이 있지만, 그건 "무엇을 이해했고 왜 멈췄는지"가 아니다.
    //   · 모델이 도구를 고르며 이미 한 말이 있으면 **그걸 버리지 않는다**(toolCalls 를 버렸던
    //     것과 같은 자리의 거울상이다 — 그때도 모델은 옳게 말했는데 우리가 버렸다).
    //   · 없으면 손을 빼고 한 번 더 묻는다. 고를 것이 없으니 모델은 지금까지의 사실로 말한다.
    let 멈춤설명 = (earlyReply ?? '').trim();
    if (!멈춤설명 && earlyTc) {
      const 라벨 = toolLabel(pendingGrants[0].action, selfState);
      const out = await ctx.model.respond(
        {
          ...earlyTc,
          // **"실행 전이다"가 "못 한다"로 번역되지 않게 사실을 끝까지 적는다.**
          // 라이브 실측(56a6ae67 · f374fb16): 이 자리에서 모델이 이렇게 답했다 —
          //   "확인받을 일은 아니고 … 지금 이 대화창에는 로컬 파일 실행 도구가 붙어 있지 않아서
          //    제가 실제 생성까지는 못 했어요. 직접 만들면 내용은 이것만 넣으면 됩니다."
          // 세 겹으로 틀렸다: 확인이 필요한데 아니라고 했고, 있는 손을 없다고 했고, 사용자에게 시켰다.
          // 원인은 금지문 부족이 아니라 **현실 부족**이었다(아래 tools 와 이 문장이 그 현실이다).
          recoveryHint: `${withParticle(라벨, '은')} 실행 전에 확인을 받는 일이에요.`
            + ' 지금은 확인을 요청하는 중이고, 승인하면 **내가 직접 실행한다.**'
            + ' 내 손으로 되는 일이다 — 사용자에게 대신 하라고 하지 않는다.',
        },
        // **손 목록을 함께 준다.** 안 주면 모델이 "이 경로에는 도구가 안 붙어 있다"고 읽는다
        // (실측). 여기서 모델이 도구를 또 고르면 그 선택은 쓰지 않는다 — 우리는 문장만 가져간다.
        { effort: 'medium', tools: modelSchemasFor(selfState) },
      ).catch(() => null);
      멈춤설명 = (typeof out === 'string' ? out : out?.text ?? '').trim();
      // 이 호출도 같은 분리 경계를 지난다 — 도구 선택은 버려도 통제 호출(기억 후보)은 잃지 않는다.
      const 분리멈춤 = splitModelControlCalls(typeof out === 'string' ? [] : (out?.toolCalls ?? []));
      통제제안받기(분리멈춤);
      if (분리멈춤.memorySuggestion) memorySuggestion = 분리멈춤.memorySuggestion;
      if (분리멈춤.memoryWithdrawal) memoryWithdrawal = 분리멈춤.memoryWithdrawal;
    }
    return {
      kind: 'approval',
      pendingId,
      // 카드와 **함께** 나가는 사람 말. 없으면 필드 자체를 안 만든다(빈 말풍선 금지).
      ...(멈춤설명 ? { reply: 멈춤설명 } : {}),
      approvalMode, // P6-15: 현재 승인 모드(조용한 표면 — 정책 아님, 판단을 보여줄 뿐)
      // action = 매칭용 id(비표시), label = 사용자 표시명. 화면엔 label 만 쓴다.
      pending: pendingGrants.map((g) => ({
        action: g.action,
        label: toolLabel(g.action, selfState),
        tier: g.tier,
        safetyFloor: g.safetyFloor ?? false,
        preview: g.approvalPreview,
        reason: g.reason, // P6-15: 왜 필요한지/무엇이 바뀌는지/되돌릴 수 있는지(사용자 언어)
      })),
      understoodTask: plan.understoodTask,
      selfStateSummary: summary,
      followUp,
      memorySuggestion,
      memoryWithdrawal,
      automationSuggestion,
      ...통제제안(),
      capabilityResolution: resolveCapability({ text: input.text, permission: { label: toolLabel(pendingGrants[0].action, selfState), action: pendingGrants[0].action } }),
    };
  }

  // 4b) 승인 필요 없음 → 바로 실행.
  const result = await executePlan(intent, plan, selfState, ctx, ledger, summary, admitted, sendArgs);
  // S5-1(§4.5): 이 턴에 **실제로 모델 앞에 놓인** 것의 신분. 렌더를 아는 쪽이 붙인다 —
  // `executePlan` 은 무엇이 렌더됐는지 모른다. 사용자면에는 나가지 않는다(서버가 저장에만 쓴다).
  result.shownMemoryRefs = shownMemoryRefs;
  result.modelCitedRefs = modelCitedRefs;
  result.memoryCorrection = memoryCorrection;
  // executePlan 의 다단계 호출에서 온 제안은 ctx 를 통해 돌아온다.
  if (ctx.제안된스킬) { skillProposal = ctx.제안된스킬; ctx.제안된스킬 = undefined; }
  if (ctx.제안된자동화) { automationProposal = ctx.제안된자동화; ctx.제안된자동화 = undefined; }
  if (ctx.제안된에이전트) { agentProposal = ctx.제안된에이전트; ctx.제안된에이전트 = undefined; }
  Object.assign(result, 통제제안());
  result.followUp = followUp;
  // 걸음 경로에서 모델이 제출한 기억 후보가 있으면 그것이 우선이다(ctx 로 실려 온다).
  if (ctx.제안된기억) { memorySuggestion = ctx.제안된기억; ctx.제안된기억 = undefined; }
  result.memorySuggestion = memorySuggestion;
  result.memoryWithdrawal = memoryWithdrawal; // 제안과 같은 자리에서 철회도 전달한다
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

/**
 * **이미 붙은 것은 "하다 만 것"에서 뺀다.** 비밀 입력은 턴을 거치지 않고 전용 통로로 들어오므로
 * (값이 대화에 남지 않게 하려고 그렇게 만들었다) 그 성공은 영수증으로 오지 않는다. 그래서
 * 현재 연결 현실과 맞춰 봐야 한다 — 안 그러면 붙은 뒤에도 "붙이다 멈췄다"고 말하게 된다.
 */
function 이어받기정리(state, connectors = []) {
  if (!state?.awaiting?.length) return state;
  const 붙은것 = new Set((connectors ?? []).filter((c) => c.connected).map((c) => c.id));
  const awaiting = state.awaiting.filter((a) => {
    const id = String(a.key ?? "").replace(/^connector:/, "");
    return !붙은것.has(id);
  });
  if (awaiting.length === state.awaiting.length) return state;
  return { ...state, ...(awaiting.length ? { awaiting } : { awaiting: undefined }) };
}

async function executePlan(intent, plan, selfState, ctx, ledger, summary, admitted = [], sendArgs) {
  // **손이 늘거나 줄면 모델이 보는 현실도 그 자리에서 바뀐다.**
  //
  // 실측(오너 라이브 2026-07-28, G-1A): "컨텍스트세븐에서 리액트 훅 문서 찾아줘 + 주소" 에
  // T5 는 선언·연결까지 정확히 해내고(손 2개 편입) **그 손을 쓰지 않고 web.collect 로 답했다.**
  // 딥위키 재연결 회차에서도 같은 일이 났다. 모델이 익숙한 손을 고른 게 아니라 —
  // **새 손이 모델에게 보이지 않았다.**
  //
  // `selfState` 는 턴 시작 때 한 번 만든 사진인데, 편입은 `ctx.env.connections` 를 제자리에서
  // 갱신한다. 그래서 편입 뒤에도 `modelSchemasFor(selfState)` 는 옛 목록을 준다(재현 확인:
  // 편입 전 5개 → 편입 후 사진 5개 → 다시 만들면 6개). live-context 의 주석은 "그 턴부터
  // 모델이 본다"고 적혀 있었다 — 그 약속이 지켜지지 않았다.
  //
  // 도구 이름으로도, 개수로도 갈리지 않는다. **매번 다시 만든다**(refreshRuntimeReality 머리말).
  const 현실다시 = () => { ({ selfState, summary } = refreshRuntimeReality(ctx)); };
  // 이번 턴 receipt 만 따로 모은다 — 세션 원장(감사용)과 턴 응답(사용자용)을 분리한다.
  /** @type {import('../contracts.js').ToolReceipt[]} */
  const turnReceipts = [];
  let sentVia; // P6-11: 승인된 send 실행 사실(도구·대상) — 서버가 TaskTrace로 기록하고 학습 후보를 제안한다.
  for (const toolId of plan.toolsToUse) {
    await ctx.emit?.('tool_progress', { text: `${toolLabel(toolId, selfState)} 실행 중이에요` }); // P6-12: 진행 상태(사고 원문 아님)
    // P6-7: send류는 분리된 {target, text}로 실행한다(문장 전체를 그대로 보내지 않는다). 그 외엔 요청 원문.
    const args = sendArgs?.[toolId] ?? { request: intent.currentRequest };
    const rec = bindDeliverableReceipt(plan, await ctx.tools.run(toolId, args, selfState));
    현실다시();
    ledger.append(rec);
    turnReceipts.push(rec);
    // 출처가 있으면 근거 추가를 알린다(evidence_added) — 웹 도구가 "확인했다"의 근거를 남긴 순간.
    if (rec.sources?.length) await ctx.emit?.('evidence_added', { count: rec.sources.length });
    // P6-11 학습 + P6-14 전달 원장: 전달 수단·대상·산출물·전달 결과를 함께 실어 보낸다(생성≠전달 분리).
    // C7-ACTION-001: target 필드가 아니라 **toolKind==='send'** 만 전달이다 — local.process 의
    // {target}이 전달 원장에 "delivered"로 기록되고 기본 대상 학습까지 오염됐다(양 검증선 재현).
    if (isSendTool(toolId, selfState) && sendArgs?.[toolId]?.target && !sentVia) {
      sentVia = {
        tool: toolId,
        target: sendArgs[toolId].target,
        targetLabel: sendArgs[toolId].targetLabel,
        text: sendArgs[toolId].text,
        args: sendArgs[toolId], // 원 승인 인자 전체 — 재전달이 {text,target}로 재조립해 필드를 잃지 않게
        failureState: rec.failureState,
        userSafeSummary: rec.userSafeSummary,
      };
    }
  }
  // 필요하지만 실행 불가한 도구는 조용히 넘기지 않는다(죽은 버튼 금지, 헌법 §4.2).
  // 2.0-B: 연결/자격 때문에 막힌 도구는 구조화해 표면화한다(채팅 안 '연결이 필요해요' 카드 → 도구함 안내).
  //   원래 작업(currentRequest)을 함께 보존해 연결 후 이어갈 pending context로 쓴다. 첫 도구만(누더기 방지).
  let connectionNeeded;
  for (const toolId of plan.blockedTools ?? []) {
    const label = toolLabel(toolId, selfState);
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
  // 이번 턴에 이미 쓴 손+인자. 이어 쓰기가 같은 걸 또 밟지 않게 한다.
  // C 감사 F3.1/F3.2: 예전 지문(`command ?? path ?? request`)은 probe 부수 필드·키 순서에
  // 흔들렸고(과소 차단), `local.file` 의 action 을 못 봐 **읽고 나서 쓰는 정상 걸음**을
  // "같은 일 되풀이"로 끊었다(과대 차단). 사다리의 실패지문과 **같은 정규화 지문**을 쓴다.
  const 지문of = (toolId, args) => 호출지문(toolId, args);
  const rung = new Set(plan.toolsToUse.map((t) => 지문of(t, sendArgs?.[t] ?? { request: intent.currentRequest })));
  // **지금 있는 손**을 사다리에 함께 준다. 계단은 도구 종류만 보고 정할 수 없다 —
  // "다른 손으로 이어서 볼게요"는 그 손이 실제로 있을 때만 참이다(없으면 거짓 약속이 된다).
  // **복구 안내도 지금 손을 본다.** 한 번 계산해 두면 뒤 걸음에서 손이 늘거나 줄어도
  // "다음 길"이 옛 목록으로 안내한다 — 이미 붙은 손을 못 쓴다고 하거나 내린 손을 권한다.
  // `refreshRuntimeReality` 가 만든 현재 selfState 에서 매번 뽑는다(같은 현실의 투영본).
  const 있는손 = () => selfState.connectedTools.filter((t) => t.status === 'usable').map((t) => t.id);
  const ladder = nextRung(turnReceipts, 있는손());
  // 이번 턴에 **실제로 한 일**을 상태에 얹는다(모델 추정이 아니라 영수증 기록만).
  // receipt 가 진실이다 — workingState 는 여기서 파생되는 얇은 뷰다(별도 저장소 아님).
  let workingState = 이어받기정리(deriveWorkingState(ctx.workingState, {
    places: await 볼수있는자리(ctx),
    receipts: turnReceipts,
    blocked: ladder ? rungMessage(ladder) : undefined,
  }), ctx.connectors);
  let tc = buildTaskContext({
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
    externalReality: ctx.externalReality,
    intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted,
    surface: ctx.surface,
    recentTurns: ctx.recentTurns, nativeSearch: Boolean(ctx.modelSupportsSearch),
    modelProviderId: ctx.modelProviderId, workingState,
    toolStepsLeft: MAX_TOOL_STEPS, // 자기 상태 사실 — 거짓 소진("손 다 써서") 방지, H08 실측
    // 막힌 게 있으면 **다음에 무엇을 하면 되는지**를 사실로 준다(막다른 답 금지).
    // **도구가 남긴 말이 먼저다.** 도구는 자기가 왜 막혔는지 정확히 안다("제가 다루는 폴더 안에서
    // 못 찾았어요"). 사다리는 도구 종류를 모르는 일반 폴백이라, 앞세우면 파일 실패에 웹 문구가
    // 나간다 — 실측: 원장엔 정확한 문장이 있었는데 사다리가 덮어써서 모델이 터미널 명령을 시켰다.
    recoveryHint: 다음길(turnReceipts, 있는손()),
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
  const step = nextRung(turnReceipts, 있는손());

  // **표면 요청이 나왔으면 여기서 끝난다.** 공은 사용자에게 넘어갔다 — 값을 넣기 전까지는
  // 무엇을 더 물어도 같은 자리다. 실측(오너 2026-07-27): 여기서 모델에게 도구를 다시 쥐여
  // 줬더니 같은 손을 또 골라 **승인 카드가 두 번** 떴다. 그리고 그 모델 왕복이 그대로
  // **사용자가 멍하니 기다리는 공백**이었다. 도구가 낸 사람 말이 이미 있으니 그걸 쓴다
  // (원장의 사실이지 주입한 문구가 아니다 — fallbackReplyFrom 과 같은 자리).
  const 표면 = turnReceipts.find((r) => r.surfaceRequest);
  let finalOut = 표면
    ? { text: [표면.userSafeSummary, 표면.nextSafeAction].filter(Boolean).join(' ') }
    : await ctx.model.respond(tc, {
      onDelta: ctx.onAnswerDelta,
      // 우리 도구가 막혔으면 모델 내장 검색을 켜서 **다른 경로로 이어가게** 한다.
      search: wantedWeb || Boolean(step?.useModelSearch && ctx.modelSupportsSearch),
      effort: 'medium',
      tools: modelSchemasFor(selfState),
    });
  // ── P6-L · 한 턴 안에서 손을 이어 쓴다 ────────────────────────────────
  // 예전엔 여기서 `finalOut.toolCalls` 를 **버렸다.** 그래서 모델이 다음 걸음을 정확히 알고도
  // 걷지 못했다 — 실측: "package.json 존재만 확인됐고, 실제 테스트 명령은 아직 실행되지
  // 않았습니다"라고 답하며 사용자에게 `npm test` 를 대신 치라고 했다. 게을러서가 아니라
  // **손이 한 번밖에 안 나갔다.** 찾기→확인→실행이 말로 끊기는 자리가 여기였다.
  //
  // 새 안전 체계를 만들지 않는다. 걸음마다 기존 판정을 그대로 탄다:
  // toolActionKind → decideAutoGrant. 승인이 필요하면 **실행하지 않고 멈춘다.**
  let steps = 0;
  let 멈춘이유;
  // ActionPlan 의 결과 형태와 실제 실행 영수증을 한 자리에서 대조한다. 다른 도구가 우연히
  // 남긴 digest 는 파일 산출물이 아니며, local.file write 의 path+digest 만 충족으로 센다.
  const 산출물미충족 = () => unsatisfiedDeliverables(plan, turnReceipts).length > 0;
  let 산출물요청수 = 0;
  const 산출물이어가기 = async () => {
    if (!산출물미충족() || steps >= MAX_TOOL_STEPS || 산출물요청수 >= MAX_TOOL_STEPS) return false;
    const derived = (plan.deliverables ?? []).some((wanted) => wanted.binding === 'derived');
    // ActionPlan 이 요구한 것은 파일 손 일반이 아니라 **성공한 write 영수증**이다. 같은 전체
    // 스키마를 다시 주면 모델이 방금 끝낸 versions/read 를 되풀이한다. 작업 종류만 계약과
    // 맞추고, 경로·내용·원본 선택은 모델에 남긴다.
    const fileTools = modelSchemasFor(selfState).filter((tool) => tool.name === 'local.file').map((tool) => ({
      ...tool,
      parameters: {
        ...tool.parameters,
        properties: {
          ...tool.parameters.properties,
          action: { ...tool.parameters.properties.action, enum: ['write'] },
        },
        required: ['action', 'path', 'text', ...(derived ? ['source'] : [])],
      },
    }));
    if (!fileTools.length) { 멈춘이유 = '파일 결과물을 남길 손이 없어 멈췄어요'; return false; }
    산출물요청수 += 1;
    finalOut = await ctx.model.respond({ ...tc, unmetDeliverable: true }, {
      onDelta: ctx.onAnswerDelta, search: wantedWeb, effort: 'medium',
      tools: fileTools, requiredTool: 'local.file',
    });
    if (typeof finalOut === 'string' || !finalOut?.toolCalls?.length) {
      멈춘이유 = '파일 결과물 실행을 고르지 않아 멈췄어요';
      return false;
    }
    return true;
  };
  while (steps < MAX_TOOL_STEPS) {
    // 걸음도 같은 분리 경계를 지난다 — 통제 호출은 걸음이 아니다(실행·승인·원장에 안 탄다).
    // executePlan 은 결과를 직접 못 돌려주므로 ctx 로 실어 나른다.
    const 분리 = splitModelControlCalls(typeof finalOut === 'string' ? [] : (finalOut?.toolCalls ?? []));
    if (분리.memorySuggestion) ctx.제안된기억 = 분리.memorySuggestion;
    if (분리.skillProposal) ctx.제안된스킬 = 분리.skillProposal;
    if (분리.automationProposal) ctx.제안된자동화 = 분리.automationProposal;
    if (분리.agentProposal) ctx.제안된에이전트 = 분리.agentProposal;
    const next = 분리.rest;
    if (!next.length) {
      // 필요한 파일 산출물이 원장에 없는데 손이 남았다 — 읽기·탐색으로 끝났다고 말하지 않고
      // 파일 손 안에서 다음 행동을 고르게 한다. action·경로·내용 판단은 모델의 것이고,
      // 실행은 기존 승인·권한·중복·걸음 상한을 그대로 탄다. write 영수증이 생길 때까지 같은
      // 계약을 다시 대조하므로 "다음에 저장하겠다"는 말이 완료를 대신하지 못한다.
      if (await 산출물이어가기()) continue;
      break;
    }
    const parts = callsToIntentParts(next, selfState);
    const toolId = parts.neededTools?.[0];
    if (!toolId) break;
    const args = parts.toolArgs?.[toolId] ?? { request: intent.currentRequest };

    // 같은 손을 같은 인자로 두 번 쓰지 않는다 — 결과가 마음에 안 든다고 반복하면 제자리를 돈다.
    const 지문 = 지문of(toolId, args);
    if (rung.has(지문)) {
      // 반복 읽기는 실행하지 않는다. 다만 별도 파일 완료 계약까지 같이 버리지는 않는다.
      // 중복 방지와 완료 판정은 서로 다른 경계다.
      if (await 산출물이어가기()) continue;
      멈춘이유 = '같은 일을 되풀이하려 해서 멈췄어요';
      break;
    }
    rung.add(지문);

    // 첫 도구 호출과 마찬가지로, 이어 쓰는 도구도 승인 **전에** 현재 현실에서 가능한 요청인지
    // 확인한다. 이 자리가 없으면 앞선 탐색 뒤 모델이 실재하지 않는 연결을 골랐을 때, 사용자는
    // 존재하지 않는 연결을 승인하는 카드를 보게 된다. 도구가 낸 계약만 읽으므로 서비스별
    // 예외가 아니며, 막힌 사실은 다음 모델 판단에도 그대로 건넨다.
    const eligibility = await ctx.tools?.tools?.[toolId]?.approvalEligibility?.(args);
    if (eligibility && eligibility.allowed === false) {
      const rec = blockedReceipt(
        `${toolLabel(toolId, selfState)} 실행`, toolId,
        eligibility.userSafeSummary ?? '지금은 이 요청을 실행할 수 없어요.',
        eligibility.nextSafeAction,
        eligibility.diagnostic,
      );
      ledger.append(rec);
      turnReceipts.push(rec);
      steps += 1;
      // F6.1: 같은 사용자 턴 안의 파생이다 — turnNo 를 늙게 하지 않는다.
      // F6.2: 이 걸음은 막혔다 — 그 사실과 다음 길이 상태에 남아야 다음 턴이 이어받는다.
      workingState = 이어받기정리(deriveWorkingState(workingState, {
        receipts: [rec], withinTurn: true, blocked: 걸음막힘(rec, turnReceipts, 있는손()),
      }), ctx.connectors);
      tc = buildTaskContext({
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
        externalReality: ctx.externalReality,
        intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted,
        surface: ctx.surface, recentTurns: ctx.recentTurns,
        nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
        workingState,
        recoveryHint: 다음길(turnReceipts, 있는손()),
        toolStepsLeft: Math.max(MAX_TOOL_STEPS - steps, 0),
        ...(ctx.selfhood ?? {}),
      });
      finalOut = await ctx.model.respond(tc, {
        onDelta: ctx.onAnswerDelta, search: wantedWeb, effort: 'medium',
        ...(steps < MAX_TOOL_STEPS ? { tools: modelSchemasFor(selfState) } : {}),
      });
      continue;
    }

    // 등급 판정도 기존 것 그대로. 명령은 돌려 봐야 아니까 계획 때와 똑같이 probe 를 먼저 탄다.
    let 판정인자 = args;
    if (toolId === 'local.terminal' && typeof args.command === 'string') {
      const probed = await ctx.tools?.tools?.[toolId]?.probe?.(args.command, { cwd: args.cwd });
      판정인자 = { ...args, changes: probed?.changes, granted: probed?.changes === true, probeResult: probed?.probe };
    }
    const kind = toolActionKind({ toolId, args: 판정인자, selfState });
    // P6-7 · **계획 경로와 같은 계약을 걸음 경로에도.** 계획 경로(sendGrant)는 대상이 확정되기
    // 전에 전송을 승인으로 보내지 않는다 — 여기만 빠져 있어서, 모델이 도구 호출로 전송을 고르면
    // **빈 대상 카드**가 떴다(라이브 실측 2026-07-29 F: "내 텔레그램으로" → 받는 곳 미정 카드 →
    // 승인해도 실패 → 이어진 답이 뜨지 않을 승인 화면을 약속). 승인은 성공할 수 있는 일에만 청한다.
    if (isSendTool(toolId, selfState)) {
      const 아는곳 = ctx.channelTargets?.[toolId] ?? [];
      const 내용 = String(판정인자.text ?? 판정인자.request ?? '').trim() || null;
      let 대상 = String(판정인자.target ?? '').trim() || null;
      let 대상라벨;
      // executePlan 은 input 을 받지 않는다 — 사용자 원문은 intent.currentRequest 로 온다.
      const 확정 = resolveSendTarget({ target: 대상, text: intent.currentRequest ?? '', known: 아는곳 });
      if (확정) { 대상 = 확정.target; 대상라벨 = 확정.label; }
      if (!대상) {
        const def = defaultTargetFor(ctx.defaults, toolId);
        if (def) 대상 = def;
      }
      if (!내용 || !대상) {
        return {
          kind: 'clarify',
          question: !내용
            ? '어떤 내용을 보낼까요?'
            : `${withParticle(toolLabel(toolId, selfState), '로')} 어디에 보낼까요?`
              + (아는곳.length ? ` 지금 바로 보낼 수 있는 곳: ${아는곳.map((k) => k.label ?? k.target).join(' · ')}` : ''),
          selfStateSummary: summary,
          // 여기까지 걸은 사실은 버리지 않는다 — 다음 턴이 이어받는다.
          ledger: projectReceipts(turnReceipts),
          workingState,
          usedSkill: ctx.usedSkill,
        };
      }
      판정인자 = { ...판정인자, text: 내용, target: 대상, ...(대상라벨 ? { targetLabel: 대상라벨 } : {}) };
    }
    if (!decideAutoGrant({ kind }, ctx.approvalMode ?? 'smart')) {
      // **여기서 실행하지 않는다.** 승인은 사용자의 것이고, 이어 쓰기가 그 경계를 넘지 못한다.
      //
      // 예전엔 여기서 그냥 `break` 했다. 승인 대기를 만들지 않으니 **카드가 뜨지 않았고**,
      // 멈췄다는 사실이 사용자에게도 다음 턴에도 남지 않았다. 그래서 한 걸음짜리 쓰기
      // (메모 만들기)는 승인이 뜨는데 **읽고 나서 쓰는 일은 영원히 승인에 도달하지 못했다.**
      //
      // 사용자의 일은 거의 다 "읽고 나서 쓰기"다 — 찾아서 모으기, 훑어서 바꾸기, 읽어서 합치기.
      // 라이브 실측(2026-07-27) 세 과업이 전부 이 자리에서 끊겼고, 모델은 매번 다른 말로
      // 둘러댔다("복사 실행은 못 하지만" · "변환 도구가 연결되어 있지 않아" · "쓰기 실행 권한을
      // 이 응답 안에서는 못 잡아서"). 셋 다 사실이 아니다 — 손은 있었고, 런타임이 조용히 멈췄을 뿐이다.
      //
      // 새 안전 체계를 만들지 않는다. **계획 단계와 똑같은 것을 한 번 더 한다** — 이 걸음 하나를
      // 계획으로 만들어 봉인하고, 승인 재개가 그것을 그대로 이어받는다(executePlan 이 그 입구다).
      const 걸음intent = {
        ...intent,
        deliverables: plan.deliverables ?? [],
        neededTools: [toolId],
        toolArgs: { ...(intent.toolArgs ?? {}), [toolId]: 판정인자 },
        ...(toolId === 'local.terminal' ? { terminalOp: 판정인자 } : {}),
        ...(toolId === 'local.file' ? { fileOp: 판정인자 } : {}),
        // 도구가 낸 미리보기를 카드에 그대로 싣는다(무엇을·어디에가 없으면 승인이 아니다).
        toolPreviews: (() => {
          const raw = ctx.tools?.tools?.[toolId]?.previewOf?.(판정인자 ?? {});
          const pv = isSendTool(toolId, selfState)
            ? 확정된전송미리보기(raw, 판정인자)
            : raw;
          return pv ? { [toolId]: pv } : undefined;
        })(),
      };
      const 걸음plan = buildActionPlan({ intent: 걸음intent, selfState, mode: ctx.approvalMode ?? 'smart' });
      // 이 요청에서 이미 허락받은 손이면 다시 묻지 않는다(같은 질문을 두 번 하지 않는다).
      // 손이 **다르면** 다른 결정이므로 그때는 묻는다 — 면제되는 것은 같은 손뿐이다.
      const grants = ctx.허락한손?.has(toolId) ? [] : (걸음plan.needsApproval ?? []);
      if (grants.length) {
        const pendingId = ctx.newId ? ctx.newId() : `p${(ctx._seq = (ctx._seq ?? 0) + 1)}`;
        이전대기를지난것으로(ctx);
        ctx.pending.set(pendingId, {
          intent: 걸음intent, plan: 걸음plan, admitted,
          // **판정한 인자를 그대로 실행 인자로 봉인한다.** executePlan 은 실행할 때 `sendArgs`
          // 에서 인자를 꺼낸다(570줄) — 여기에 안 실으면 승인 뒤 `{request: 발화원문}` 으로
          // 실행돼 엉뚱한 일이 된다. 판정과 실행이 **같은 인자**를 봐야 한다(두 진실 금지).
          sendArgs: { ...(sendArgs ?? {}), [toolId]: 판정인자 },
          askedFrom: ctx.askedFrom,
          // 지금까지 이 요청에서 허락받은 손 — 승인 뒤에도 이어져야 같은 질문을 안 한다.
          허락한손: [...(ctx.허락한손 ?? []), toolId],
          grantScope: { kind: 'once', expiresAt: nowMs(ctx) + APPROVAL_TTL_MS },
        });
        // **여기까지 한 일을 버리지 않는다.** 모델이 도구를 고르며 이미 한 말이 있으면 그게
        // 사용자 말이다(64a7634). 없으면 원장의 사실로 만든다 — 빈 카드만 뜨면 먹통으로 보인다.
        const 지금까지 = (typeof finalOut === 'string' ? '' : finalOut?.text ?? '').trim();
        return {
          kind: 'approval',
          pendingId,
          ...(지금까지 ? { reply: 지금까지 } : {}),
          approvalMode: ctx.approvalMode ?? 'smart',
          pending: grants.map((g) => ({
            action: g.action,
            label: toolLabel(g.action, selfState),
            tier: g.tier,
            safetyFloor: g.safetyFloor ?? false,
            preview: g.approvalPreview,
            reason: g.reason,
          })),
          understoodTask: plan.understoodTask,
          selfStateSummary: summary,
          // 이미 한 걸음들은 원장에 남았다 — 승인 화면에서도 보여야 "찾긴 찾았구나"를 안다.
          ledger: projectReceipts(turnReceipts),
          goal: { understoodTask: plan.understoodTask, successCriteria: plan.successCriteria },
          workingState,
          contextShown: workingStateFacts(workingState),
        };
      }
      // 계획으로 못 만들면(도구가 승인 대상이 아니라고 나오면) 예전처럼 멈추되 사실은 남긴다.
      멈춘이유 = `${toolLabel(toolId, selfState)} 은(는) 먼저 확인을 받아야 해서 여기서 멈췄어요`;
      break;
    }

    await ctx.emit?.('tool_progress', { text: `${toolLabel(toolId, selfState)} 실행 중이에요` });
    const rec = bindDeliverableReceipt(plan, await ctx.tools.run(toolId, 판정인자, selfState));
    현실다시();
    ledger.append(rec);          // 모든 걸음이 원장에 남는다
    turnReceipts.push(rec);
    steps += 1;

    // **표면 요청이 나오면 공은 사용자에게 넘어간다 — 그 턴은 여기서 멈춘다.**
    // 실측(오너, 2026-07-27): 비밀 입력창을 띄웠는데 모델이 그걸 실패로 보고 같은 손을
    // 다시 골랐다. 그래서 **승인 카드가 두 번** 떴다. 더 부른다고 될 일이 아니다 —
    // 사용자가 값을 넣기 전까지는 무엇을 해도 같은 자리다.
    if (rec.surfaceRequest) { 멈춘이유 = undefined; break; }

    // 사실이 늘었으니 상태·문맥을 다시 만든 뒤 이어서 묻는다(이전 걸음 결과 위에서 판단하게).
    // F6.1: 걸음 파생은 같은 사용자 턴이다(turnNo 불변). F6.2: 이 걸음이 실패면 그 실패의
    // 사다리를 blocked 로 남긴다 — 성공 걸음이면 blocked 를 넘기지 않아, 앞선 막힘이 실제로
    // 풀렸을 때 상태도 함께 풀린다(거짓 막힘 금지 — deriveWorkingState 의 기존 계약 그대로).
    workingState = 이어받기정리(deriveWorkingState(workingState, {
      receipts: [rec], withinTurn: true, blocked: 걸음막힘(rec, turnReceipts, 있는손()),
    }), ctx.connectors);
    tc = buildTaskContext({
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
      externalReality: ctx.externalReality,
      intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted,
      surface: ctx.surface, recentTurns: ctx.recentTurns,
      nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
      workingState,
      recoveryHint: 다음길(turnReceipts, 있는손()),
      toolStepsLeft: Math.max(MAX_TOOL_STEPS - steps, 0), // 남았으면 남았다는 사실(H08 실측)
      // **손을 조용히 거두면 모델은 "손이 없다"로 읽는다.** 실측(오너 라이브 2026-07-28):
      // "t5demo-idle 꺼줘" 에서 T5 가 대상을 정확히 찾아 놓고 **"터미널 손이 열리지 않아
      // 제가 직접 끄지는 못했어요 — 터미널에서 kill 4356 실행하면 됩니다"** 라고 답했다.
      // 터미널은 있었다. 같은 턴에 실제로 돌기까지 했다. 상한에 닿아 손을 뺐을 뿐이다.
      // 같은 실패가 깃허브에서도 났다("저장소 목록 도구가 안 떠 있어").
      //
      // 없앤 것과 이번 턴에 못 쓰는 것은 다른 사실이다. 그 차이를 안 주면 모델은 빈칸을
      // "능력 없음"으로 메우고, 그 다음 문장은 늘 사용자에게 떠넘기는 말이 된다.
      ...(steps >= MAX_TOOL_STEPS ? { toolBudgetSpent: true } : {}),
      ...(ctx.selfhood ?? {}),
    });
    finalOut = await ctx.model.respond(tc, {
      onDelta: ctx.onAnswerDelta, search: wantedWeb, effort: 'medium',
      // 상한에 닿았으면 손을 거둔다 — 더 고를 수 없으니 지금까지의 사실로 답하게 된다.
      ...(steps < MAX_TOOL_STEPS ? { tools: modelSchemasFor(selfState) } : {}),
    });
  }
  // 상한·승인·되풀이로 멈췄으면 **여기까지 한 일과 다음 할 일**을 정직하게 말하게 한다.
  if (steps >= MAX_TOOL_STEPS && !멈춘이유) 멈춘이유 = '한 번에 할 수 있는 만큼 하고 멈췄어요';
  // 산출물 의무 미이행은 완료가 아니다 — 계획과 원장(영수증)의 불일치가 기계 사실이다.
  if (!멈춘이유 && 산출물미충족()) {
    멈춘이유 = '만들기로 한 파일 산출물이 아직 만들어지지 않았어요';
  }

  let reply = typeof finalOut === 'string' ? finalOut : finalOut?.text ?? '';
  if (멈춘이유 && !reply.trim()) reply = '';
  // 도구를 빼고 한 번 더 묻는 자리 — **빠른 경로와 같은 계약을 쓴다**(`답완성`).
  // 손을 빼는 이유는 `toolBudgetSpent` 로 함께 간다. 안 그러면 모델이 "손이 없다"고 답한다 —
  // 같은 실패가 깃허브와 t5demo-idle 에서 실제로 났다(실측 2026-07-28).
  reply = await 답완성({ reply, tc, ctx, search: wantedWeb, receipts: turnReceipts });
  // 계열 ④: 도중에 화면으로 나간 말(도구를 고르며 한 말 포함)을 버리지 않는다 — 답이 화면을 따라온다.
  reply = 미리보기정렬(reply, ctx.미리보기);
  // H09 P0 는 화면 정렬보다 세다: 스트리밍으로 이미 나간 거짓 서술을 정렬이 되살리면, 지속되는
  // 답에서만큼은 원장의 정직한 사실이 이긴다(나간 조각 보존 계약의 유일한 예외 — 거짓 성공).
  const 거짓성공정렬후 = 읽은척차단(turnReceipts, reply);
  if (거짓성공정렬후?.blocked) reply = 거짓성공정렬후.정직한답;
  const projection = projectReceipts(turnReceipts);

  // **끝난 일은 끝났다고 남긴다.** 실측(오너 라이브 G 행렬 2026-07-29): 저장까지 실제로 끝낸 뒤
  // `아까 그거 이어줘` 하자 같은 파일을 다시 쓰는 승인 카드가 떴다. 현재 상태에 "방금 다룬
  // 파일"은 있어도 **"그 요청은 완료됨"이 없었기 때문**이다.
  //
  // 완료는 **실행 결과로** 정한다(모델 말이 아니라): 미확인 0 · 대기 승인 0 · 기다리는 표면 0 ·
  // 막힘 없음 · 실제로 성공한 실행이 하나 이상. 하나라도 어긋나면 완료가 아니다 —
  // 읽기만 일부 된 미완료를 완료로 부르면 그게 더 나쁜 거짓말이다.
  const 실제로한일 = turnReceipts.filter((r) => (r?.failureState ?? 'none') === 'none');
  // **중단한 것은 끝난 것이 아니다.** 런타임은 왜 멈췄는지 이미 안다(같은 일 되풀이 · 도구 상한 ·
  // 승인 대상으로 못 만듦). 그 사실을 완료 판정에 잇지 않으면, 일부 도구가 성공했다는 이유로
  // 중간에 멈춘 일을 완료로 기록한다 — 그러면 다음 턴이 이어갈 자리를 잃는다(오너 감사 2026-07-29).
  const 끝났나 = !멈춘이유
    && plan.deliverableAssessment !== 'unknown'
    && projection.unconfirmed.length === 0
    && (ctx.pending?.size ?? 0) === 0
    && !(workingState.awaiting?.length)
    && !workingState.blocked
    && 실제로한일.length > 0;
  const 완료 = 끝났나 ? {
    status: 'completed',
    request: intent.currentRequest,
    completedTurn: workingState.turnNo,
    subjects: (workingState.subjects ?? []).filter((s) => s.lastTurn === workingState.turnNo)
      .map((s) => s.label).filter(Boolean).slice(0, 4),
  } : undefined;
  if (완료) workingState = { ...workingState, recentOutcome: 완료 };

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
    //
    // 그리고 **경계를 지나서 나간다.** 예전엔 여기만 `userSafeNextAction` 원문을 그대로 썼다 —
    // "한 도구의 한계를 T5 전체의 한계로 말하지 않는다"는 경계(`다음길`)가 모델 입력에만 걸리고
    // **사용자 화면은 그 경계를 안 탔다.** 그래서 방금 다른 손이 붙었는데도 화면에는
    // "그 폴더로 옮겨 주세요"가 그대로 남는다(관통 검사로 발견, 2026-07-28).
    // 같은 사실은 같은 경계를 지나야 한다 — 표면마다 다른 현실을 보게 하지 않는다.
    nextSafeAction: projection.unconfirmed.length ? 다음길(turnReceipts, 있는손()) : undefined,
    // 현재 목표 유지(P6-1): 서버가 session.activeGoal 로 지속해 세션 간 좁게 복원한다.
    // **끝났으면 명시적으로 해제한다.** 안 그러면 끝난 일이 계속 "현재 목표"로 남아
    // 다음 턴을 붙든다(실측: activeGoal 이 새 발화로 덮여 런타임이 "진행 중"처럼 말했다).
    goal: 완료 ? null : { understoodTask: plan.understoodTask, successCriteria: plan.successCriteria },
    // 자기 파악 세 번째 축 — 서버가 세션에 지속해 다음 턴이 "그거"를 이어받는다.
    workingState,
    // P2-7 2축: **모델이 이번 턴에 무엇을 현재 상태로 봤는가.** 엔진이 아니라 필드 하나다.
    // 왜 남기는가: 흐름이 어긋났을 때 프롬프트를 추측으로 고치다 세 번 헛짚었다(2026-07-27).
    // 라이브 요청을 눈으로 보고 나서야 원인이 드러났다 — 볼 수 없으면 또 추측하게 된다.
    // **사용자 화면에는 안 나간다.** 나중에 "무엇을 보고 그렇게 판단했나"(거버넌스·자가학습)가
    // 여기서 답해질 자리를 지금 막지 않으려는 것이다.
    contextShown: workingStateFacts(workingState),
    // 2.0-B: 연결이 필요한 도구가 있으면 채팅 안 연결 안내 카드로(원래 작업 보존).
    connectionNeeded,
    // P5-B-1B: 도구가 **사용자에게 열어 달라고 요청한 표면**(예: 비밀 입력창). 커널은 종류만 안다.
    // 이게 없으면 모델이 남은 길로 "키를 여기 붙여넣어 주세요"를 고른다 — 그 순간 비밀이
    // 대화 기록에 남는다. 길을 내주는 것이 금지문을 주입하는 것보다 확실하다.
    surfaceRequest: turnReceipts.find((r) => r.surfaceRequest)?.surfaceRequest,
    // P6-11: 승인된 send 실행 사실 — 서버가 학습(TaskTrace·DefaultTarget 후보)에 쓴다.
    sentVia,
  };
}
