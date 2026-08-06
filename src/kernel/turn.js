// 턴 오케스트레이터 — Work Chat 한 턴의 심장.
// 흐름(감사 지정): 발화 → SelfState → Intent → (fast_chat | ActionPlan → Authority → 실행 → Receipt)
//                 → Truth Ledger → 다음 안전 행동.
// 판정 기준: 사용자는 채팅만 한다고 느끼지만, 뒤에서 자기파악·권한·원장·복구가 자연스럽게 돈다.
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { buildSelfState, selfStateSummary } from './l0-evidence/self-state.js';
import { detectSelfNaming } from './l1-intent/self-naming.js';
import { externalReality, realitySignature, realityDelta } from './l1-intent/external-service.js';
import { selfhoodLookup, selectSelfhoodDetail, soulVoice } from './l1-intent/selfhood-lookup.js';
import { buildCapabilityFacts, capabilityCounts } from './capabilities.js';
import { DEFAULT_IDENTITY } from './identity.js';
import { TruthLedger, projectReceipts } from './l0-evidence/ledger.js';
import { userFacingModelText, 확인된중간결과, 미리보기원장, 미리보기정렬 } from './turn-surface.js';
import { blockedReceipt, receipt } from './l0-evidence/tool-receipt.js';
import { toolLabel, withParticle } from './tool-labels.js';
import { interpret } from './l1-intent/intent.js';
import { buildTaskContext, 이번턴만그림 } from './l1-intent/task-context.js';
import { buildActionPlan, toolActionKind } from './l2-plan/action-plan.js';
import { 실행전판정, 승인면제, 걸음신분 } from './l2-plan/tool-boundary.js';
import { 손제시기록 } from './l2-plan/tool-offer.js';
import { dump손제시 } from '../runtime/prompt-dump.js';
import { isExecutionAllowed, decideAutoGrant, isSafetyFloor } from './l2-plan/authority.js';
import { decideFollowUp } from './l2-plan/follow-up.js';
import { admitInboundEvent } from './l1-intent/inbound-gate.js';
import { detectCandidate, admittedEntries, dropHistoryDuplicates, isRelevant } from './l1-intent/context-mesh.js';
import { shownFromRendered, citedFromShown } from './l5-growth/tcell-shown.js';
import { detectAutomationCandidate } from './l5-growth/automation.js';
import { parseSend, resolveSendTarget } from './l1-intent/send-parse.js';
import { parseFileRequest, fileClarifyQuestion } from './l1-intent/file-parse.js';
import { callsToIntentParts } from './l2-plan/tool-schema.js';
import {
  mergeWorkStateProposals, modelSchemasFor, splitModelControlCalls,
} from './l2-plan/model-control.js';
import {
  bindDeliverableReceipt, fileWorkIsInPlay, parseDeliverableJudgment, unsatisfiedDeliverables,
} from './l2-plan/work-contract.js';
import { nextRung, rungMessage, 읽은척차단, 호출지문 } from './l2-plan/recovery-ladder.js';
import { deriveWorkingState, workingStateFacts } from './l0-evidence/working-state.js';
import { resolveResponseSurface } from './l0-evidence/response-surface.js';
import { detectPersonalToolRequest } from './l2-plan/personal-tool.js';
import { resolveCapability } from './l2-plan/capability-resolution.js';
import { defaultTargetFor } from './l5-growth/task-trace.js';
import { isKnownCounterpart, rememberCounterpart } from './l2-plan/known-counterpart.js';
import { applicableSkill, skillInfluence } from './l5-growth/skill-learning.js';
import { APPROVAL_TTL_MS, isSendTool } from './contracts.js';
import { 심문허용 } from './model-sovereign.js';
import { 이월지문, 이월행동, 발화밖파괴 } from './l2-plan/carryover.js';
import { 턴예산, 가드레일신호, 예산소진, 소진사유 } from './turn-budget.js';
import { 완료주장검증 } from './l2-plan/exit-verification.js';

// 시간 소스 — 테스트는 ctx.now 주입으로 결정적으로 제어(만료 시나리오). 미주입 시 실시간.
function nowMs(ctx) { return ctx.now ? ctx.now() : Date.now(); }
function requestDigest(text) { return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16); }

function 동의후속(text = '') {
  const t = String(text).trim().replace(/[.,!?，。！？\s]/g, '');
  return /^(응|그래|좋아|ㅇㅇ|어|그렇게해|그렇게해줘|응그렇게해|응그렇게해줘|진행해|계속해|해줘|해)$/.test(t);
}

function 직전실행목표(recentTurns = [], selfState) {
  for (const turn of [...recentTurns].reverse()) {
    if (turn?.role !== 'user') continue;
    const prior = interpret(turn.text ?? '', { selfState });
    if (prior.neededTools?.length && prior.answerMode !== 'fast_chat') return prior;
  }
  return null;
}

/**
 * P90-1 정산 게이트. 최초 작업 후보는 호출 여부만 정하며 사건의 근거가 아니다.
 * activeGoal은 관련 없는 기억·선호 턴에도 붙는 추정 라벨이라 독립 게이트로 쓰지 않는다.
 * Receipt와 완료 계약도 입력 사실일 뿐 이 게이트를 단독으로 열지 않는다.
 */
export function stateReviewNeeded(signals = {}) {
  if (signals.phase !== 'settled' || signals.terminal !== true || signals.reported === true) return false;
  return signals.hasExistingWork === true
    || signals.hasCarryableProject === true
    || signals.durableWorkCandidate === true
    || signals.resumedApproval === true;
}

function runtimeFileArgs(args, request, roots = []) {
  if (!args || typeof args !== 'object' || !roots.length) return args;
  const requested = String(request ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
  const aliases = {
    Downloads: ['downloads', '다운로드', '다운로드폴더'],
    Documents: ['documents', '문서', '내문서'],
    Desktop: ['desktop', '바탕화면', '데스크톱', '데스크탑'],
  };
  const mapPath = (value) => {
    if (typeof value !== 'string' || !value.trim()) return value;
    const portable = value.replaceAll('\\', '/');
    for (const [name, names] of Object.entries(aliases)) {
      if (!names.some((alias) => requested.includes(alias))) continue;
      const root = roots.find((entry) => basename(entry).normalize('NFC').toLowerCase() === name.toLowerCase());
      if (!root) continue;
      const match = portable.match(new RegExp(`(?:^|/)${name}(?:/|$)(.*)$`, 'i'));
      if (match) return resolve(root, match[1] ?? '');
      const relative = names.find((alias) => portable.normalize('NFC').replace(/\s+/g, '').toLowerCase().startsWith(alias));
      if (relative) return resolve(root, portable.split('/').slice(1).join('/'));
      // 폴더를 명시한 이번 발화가 신분이다. 모델이 중간 폴더명까지 빼고 다른 홈 아래에
      // 파일명만 붙였어도, 그 추측 홈을 실행 사실로 쓰지 않고 명시된 표준 폴더에 결합한다.
      return resolve(root, basename(portable));
    }
    return value;
  };
  return { ...args, ...(args.path ? { path: mapPath(args.path) } : {}), ...(args.to ? { to: mapPath(args.to) } : {}) };
}

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
// **예전 고정 상한.** 이제 예산(`turn-budget.js`)이 두 축으로 센다 — 왕복(비용)과
// 걸음(폭주 방지). 이 값은 `산출물이어가기` 의 재요청 횟수 뒷단으로만 남는다.
// 왜 6 이 문제였는지는 `turn-budget.js` 머리말에 적혀 있다(비용 안 드는 축을 조였다).
const MAX_TOOL_STEPS = 6;
const WORK_DELIVERABLE_SCHEMA = Object.freeze({
  name: 'work.deliverable',
  description: '사용자의 요청 결과가 대화 답변인지, 실제 파일 생성·변경인지 구분한다.',
  parameters: {
    type: 'object',
    properties: { output: { type: 'string', enum: ['chat', 'file'] } },
    required: ['output'],
  },
});
async function fileDeliverablesFor({ model, tc, calls, intent }) {
  const intentHasFileWork = intent?.neededTools?.some((id) => id === 'local.file' || id === 'local.locate');
  if (!fileWorkIsInPlay(calls) && !intentHasFileWork) return { assessment: 'not_applicable', deliverables: [] };
  const directWrite = calls.some((call) => call?.name === 'local.file' && call?.args?.action === 'write');
  // **S1 슬라이스**(`T5_MODEL_SOVEREIGN=1`): FILE/CHAT 을 모델에게 따로 묻지 않는다.
  // 이 심문은 왕복 하나를 판정에 쓰면서 "결과가 파일인가"를 **행동 전에** 확정한다 —
  // 사용자 목적을 런타임이 미리 형식으로 못박는 자리다. 대신 모델이 이미 고른 것으로만 판단한다:
  // 쓰기를 골랐으면 파일 산출물이 결과이고(구조 사실), 아니면 아직 정해지지 않았다.
  // 미충족 사실은 실행 뒤 원장 대조가 그대로 말한다(강제는 기준선에서 이미 걷혔다).
  if (!심문허용()) {
    return directWrite
      ? { assessment: 'file', deliverables: [{ id: 'primary-file-output', kind: 'file', operation: 'write', binding: 'direct' }] }
      : { assessment: 'not_applicable', deliverables: [] };
  }
  // 쓰기 호출도 곧바로 사용자의 완료 의도로 간주하지 않는다. 실사용에서 모델이
  // "파일은 아직 만들지 마"를 보고도 write를 고른 적이 있다. 호출은 후보이고, 결과가
  // 파일이어야 하는지는 요청 전체를 보는 별도 판단으로 확정한다.
  // 읽기·찾기는 결과물이 아니라 재료일 수도 있다. 사용자 문구 규칙으로 맞히지 않고
  // 요청 전체를 본 모델에게 전용 구조 판단을 맡긴다. 형식을 못 지키면 한 번만 다시 묻는다.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // 구조 채널은 모델이 이미 쓰기를 고른 충돌 상황에만 필요하다. 읽기·탐색 흐름에서
    // 실행 도구를 하나 더 제시하면 다음 실제 걸음을 판정 응답으로 소비할 수 있다.
    // P90-2 실측(2026-08-02 · 로컬 파일 경로 6회): 이 판정이 전체 모델 시간의 **36.6%**를
    // 썼다. 본선 왕복 평균 4.62초인데 이 호출만 7.33초다 — 도구도 없고 답이 4글자인데 더 느리다.
    // 원인은 `directWrite` 가 아닐 때 **도구 없이 산문을 받아 정규식으로 읽던 것**이다.
    // 6회 중 2회는 파싱 안 되는 산문(47·49·55자)이 와서 재시도가 돌았고, 한 회는 두 번 다
    // 실패해 17초를 태우고 보수 폴백으로 떨어졌다.
    //
    // 예전 주석은 "읽기·탐색 흐름에서 실행 도구를 하나 더 제시하면 다음 실제 걸음을 판정
    // 응답으로 소비할 수 있다"고 걱정했다. 그 걱정은 **실행 도구를 함께 줄 때**의 것이다 —
    // 여기서 주는 것은 `{output:'chat'|'file'}` 하나뿐인 판정 스키마이고 requiredTool 로
    // 강제하므로, 모델이 고를 수 있는 실제 걸음이 애초에 목록에 없다.
    // 산문 파싱은 아래에서 폴백으로 그대로 남는다(구조 채널을 모르는 provider 대비).
    const out = await model.respond(
      { ...tc, workContractAssessment: { kind: 'file' } },
      { effort: 'medium', tools: [WORK_DELIVERABLE_SCHEMA], requiredTool: WORK_DELIVERABLE_SCHEMA.name },
    );
    const structured = typeof out === 'string' ? null
      : out?.toolCalls?.find((call) => call?.name === WORK_DELIVERABLE_SCHEMA.name
        && ['chat', 'file'].includes(call?.args?.output))?.args?.output;
    const judgment = structured === 'file' || structured === 'chat'
      ? structured : parseDeliverableJudgment(typeof out === 'string' ? out : out?.text);
    if (judgment === 'file') {
      return {
        assessment: 'file',
        deliverables: [{ id: 'primary-file-output', kind: 'file', operation: 'write', binding: directWrite ? 'direct' : 'derived' }],
      };
    }
    if (judgment === 'chat') return { assessment: 'chat', deliverables: [] };
  }
  // 구조 채널을 모르는 기존 provider는 직접 쓰기 호출이라는 보수적 계약을 유지한다.
  // 실제 모델이 CHAT을 구조로 반환한 경우에는 위에서 이미 쓰기 후보를 제거했다.
  if (directWrite) {
    return {
      assessment: 'file',
      deliverables: [{ id: 'primary-file-output', kind: 'file', operation: 'write', binding: 'direct' }],
    };
  }
  // 판단 불능을 CHAT 으로 꾸미지 않는다. 사용자 답은 막지 않되 완료 상태는 만들지 않는다.
  return { assessment: 'unknown', deliverables: [] };
}

/**
 * 파일 산출물 계약이 요구하는 쓰기 손. 일반 파일 스키마를 복제하지 않고 action 과 필수 결과만
 * 좁힌다. 파생 산출물은 원본 결합 근거(source)까지 있어야 기존 원본 보존 경계를 탄다.
 */
function fileWriteTools(selfState, modelControls, { derived = true } = {}) {
  return modelSchemasFor(selfState, modelControls)
    .filter((tool) => tool.name === 'local.file')
    .map((tool) => ({
      ...tool,
      parameters: {
        ...tool.parameters,
        properties: {
          ...tool.parameters.properties,
          // **출구를 하나로 잠그지 않는다.** `write` 만 허용하면 "정리"의 정답인 `move` 가
          // 목록에 없어, 모델이 낼 수 있는 유일한 write 가 쓰레기 로그 파일이 된다(실측 2026-08-03).
          //
          // 다만 **파생 산출물은 다르다.** "이 자료로 정리본을 만들어 줘"는 원본에서 파생된
          // 새 파일이 결과이고, `source` 가 없으면 원본 자리를 덮어쓸 수 있다(그 계약을 검사가
          // 지킨다). 그때는 좁힌 채로 둔다 — 넓히는 것이 목적이 아니라 **맞는 출구를 주는 것**이다.
          action: { ...tool.parameters.properties.action, enum: derived ? ['write'] : ['write', 'move', 'delete'] },
        },
        // `text`·`source` 는 write 에만 필요하다 — 필수로 걸면 move 를 아예 고를 수 없다.
        required: derived ? ['action', 'path', 'text', 'source'] : ['action', 'path'],
      },
    }));
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
 * **승인 카드에 "누구에게·무엇을"을 못 박는다.** (S6-c 4번)
 *
 * 두 경로가 각자 하던 일이다. 계획 경로만 했고 걸음 경로는 안 했다 — 밟은 사실(2026-08-05):
 * 같은 전송이 두 번째 왕복에 오면 카드가 이렇게 떴다.
 *   계획: `where:"민수" · what:"회의 30분 늦어요" · "민수에 …를 실제로 보내요"`
 *   걸음: `where 없음 · what 없음 · "텔레그램 전송 실행"`
 * 나가는 것은 양쪽 다 맞았다. **사용자가 무엇을 허락하는지 모른 채 누르는 것**이 갈렸다.
 * 이 파일이 이미 적어 둔 계약 그대로다: *"무엇을·어디에가 없으면 승인이 아니다."*
 *
 * 걸음 경로가 비었던 이유는 `확정된전송미리보기` 가 **손이 낸 미리보기가 있을 때만** 채우기
 * 때문이다. 계획 경로는 `grantFor` 가 만든 기본 카드가 있어 늘 채워졌다. 손이 `previewOf` 를
 * 안 내면(새 커넥터·주입된 어댑터) 걸음 경로만 빈 카드가 된다 — 손의 실수가 사용자에게 간다.
 * @param {object} grant  `grantFor` 가 만든 승인 대상(제자리에서 고친다)
 * @param {object} 인자   판정에 쓴 그 인자 — 실행될 값과 같다(두 진실 금지)
 */
function 전송카드확정(grant, 인자 = {}) {
  if (!grant) return grant;
  const 보이는대상 = 인자.targetLabel ?? 인자.target;
  const 보낼내용 = 인자.text ?? 인자.request;
  grant.approvalPreview = 확정된전송미리보기(grant.approvalPreview, 인자);
  if (보이는대상 || 보낼내용) {
    grant.reason = { ...grant.reason, whatChanges: `${보이는대상}에 "${보낼내용}"를 실제로 보내요.` };
  }
  return grant;
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
 * 원장은 시도한 실패까지 모두 보존한다. 다만 사용자에게 보이는 **이번 턴의 미해결 사실**은 다르다.
 * 잘못 짐작한 파일 자리에서 list 가 범위 밖으로 막힌 뒤, 같은 턴에 실제 자리를 찾아 같은 list 를
 * 성공했다면 앞 실패는 해결 과정이지 남은 다음 행동이 아니다. 보호 차단·쓰기 실패·다른 파일의
 * 실패는 숨기지 않는다. 오직 out_of_scope 탐색 실패와 뒤의 같은 도구+행동 성공만 해소한다.
 */
export function unresolvedTurnReceipts(receipts = []) {
  // **부른 것이든 못 부른 것이든 "무슨 호출이었나"는 하나다.** 실행한 것은 `actualCall`,
  // 부르지 않은 것은 `제안한호출` 에 있다(계약: 호출 안 했으면 actualCall 은 null).
  // 여기서 한 번에 읽는다 — 두 칸을 따로 훑으면 언젠가 한쪽이 빠지고, 빠진 그 경로로
  // "이미 했다"가 "아직 못 했다"로 잡혀 턴 전체가 미완료가 된다(실측 2026-08-04).
  const 무슨호출 = (rec) => rec?.actualCall ?? rec?.제안한호출 ?? null;
  return receipts.filter((rec, index) => {
    // **런타임이 "이미 했다"고 취소한 것은 미해결이 아니다.** 같은 손·같은 작업이 이번 턴에
    // 이미 성공했기 때문에 안 한 것이므로, 그 성공이 이것을 해결한다(아래 "뒤의 성공이 앞의
    // 실패를 해결한다"의 거울상). 이 구분이 없으면 다중 호출 중 하나가 중복이라는 이유로
    // 턴 전체가 미완료로 잡힌다(실측 2026-08-04, 승인 재개 정산이 안 열렸다).
    if (rec?.failureState === 'cancelled' && 무슨호출(rec)?.tool) {
      const 이미 = receipts.slice(0, index).some((앞) => (앞?.failureState ?? 'none') === 'none'
        && 앞?.actualCall?.tool === 무슨호출(rec).tool);
      if (이미) return false;
    }
    if ((rec?.failureState ?? 'none') === 'none' || rec?.scopeState !== 'out_of_scope') return true;
    const tool = 무슨호출(rec)?.tool;
    const action = 무슨호출(rec)?.args?.action;
    const failedPath = portableFilePath(무슨호출(rec)?.args?.path);
    if (!tool || !action) return true;
    return !receipts.slice(index + 1).some((later) => (
      (later?.failureState ?? 'none') === 'none'
      && later?.actualCall?.tool === tool
      && (
        later?.actualCall?.args?.action === action
        || (failedPath && portableFilePath(later?.actualCall?.args?.path)?.startsWith(`${failedPath}/`))
      )
    ));
  });
}

function portableFilePath(value) {
  const normalized = typeof value === 'string' ? value.replaceAll('\\', '/').replace(/\/+$/, '') : '';
  const match = normalized.match(/(?:^|\/)(Downloads|Documents|Desktop|GPAO-T5)(?:\/|$)(.*)$/);
  return match ? `${match[1]}/${match[2]}`.replace(/\/+$/, '') : undefined;
}

/** 최종 화면에서 이미 수행한 복구를 다시 약속하지 않는다. 실패 사실 자체는 원장에 남는다. */
export function finalNextSafeAction(receipts, hands) {
  const failures = receipts
    .map((rec, index) => ({ rec, index }))
    .filter(({ rec }) => (rec?.failureState ?? 'none') !== 'none');
  if (!failures.length) return undefined;
  const recovered = ({ rec, index }) => {
    if (rec.actualCall?.tool !== 'local.file' || rec.actualCall?.args?.action !== 'read') return false;
    const failedPath = portableFilePath(rec.actualCall?.args?.path);
    if (!failedPath) return false;
    const slash = failedPath.lastIndexOf('/');
    const parent = slash >= 0 ? failedPath.slice(0, slash) : '';
    const name = slash >= 0 ? failedPath.slice(slash + 1) : failedPath;
    return receipts.slice(index + 1).some((later) => {
      if ((later?.failureState ?? 'none') !== 'none') return false;
      if (later.actualCall?.tool === 'local.file' && later.actualCall?.args?.action === 'list') {
        return portableFilePath(later.actualCall?.args?.path) === parent;
      }
      return later.actualCall?.tool === 'local.locate' && later.actualCall?.args?.what === name;
    });
  };
  return failures.every(recovered) ? undefined : 다음길(receipts, hands);
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

/**
 * **막힌 손과 같은 것을 보면서 이번 턴에 안 막힌 손.** 없으면 `null` — 없는 손을 지어내지 않는다.
 * 축(`보는것`)은 descriptor 가 선언한다. 커널은 이름을 모른 채 축만 비교한다.
 */
function 옆손찾기(막힌손, 손들 = []) {
  const 축 = (id) => (손들.find((t) => t?.id === id) ?? {}).보는것;
  const 막힌축 = new Set([...막힌손].map(축).filter(Boolean));
  if (!막힌축.size) return null;
  const 옆 = 손들.find((t) => t?.id && !막힌손.has(t.id) && t.보는것 && 막힌축.has(t.보는것));
  return 옆 ? (옆.label ?? 옆.id) : null;
}

export function 다음길(receipts, 있는손, 손들 = []) {
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

  // **같은 것을 보는 다른 손을 가리킨다**(노드 ③ · 2026-08-06).
  //
  // `file-scope.js` 주석이 이 자리를 이미 적어 뒀다 — *"이 손은 다른 손이 있는지 모른다.
  // 다음 계단은 **손 목록을 아는 커널**이 정한다."* 커널은 손 목록을 알았지만
  // **어느 손이 같은 것을 보는지**를 몰랐다. 이제 손이 `보는것` 축을 선언한다.
  //
  // 라이브: `local.file` 이 작업 폴더 밖이라 막히자 T5 가 사용자에게 awk 명령을 줬다 —
  // 바로 앞 걸음에서 `local.terminal` 로 그 폴더를 실제로 봤는데도.
  const 같은것보는손 = 옆손찾기(막힌손, 손들);
  if (같은것보는손) {
    const 앞말 = 알아본계단 ?? 쓸도구말;
    return `${앞말 ? `${앞말} ` : ''}같은 것을 보는 손이 있어요 — ${같은것보는손}로 해 볼게요.`;
  }

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
  // **런타임이 스스로 건너뛴 것은 사용자면 답에 안 싣는다.**
  //
  // 라이브 실측(2026-08-04 사람 사용시험): 사용자가 페이지 하나를 물었는데 화면에
  // *"그 사이트가 수집을 허용하지 않아요. **방금 한 것과 같은 일이라 다시 하지 않았어요.**
  // 주소를 다시 확인해 주시겠어요?"* 가 나갔다. 가운데 문장은 **런타임이 스스로 두 번 부르려다
  // 스스로 건너뛴 내부 사정**이다. 사용자 기준으로는 처음 물은 것이라 **사실도 아니다** —
  // 사용자는 자기가 하지도 않은 반복을 했다고 읽는다.
  //
  // 원장에는 그대로 남고 모델도 받는다(조용한 축소 아님). **사용자면 문장에만 안 들어간다** —
  // 두 면은 원래 다른 계약이다. 다만 **그것뿐이면 빈 답을 주지 않는다**(그게 더 나쁘다).
  const 사람에게 = receipts.filter((r) => r.failureState !== 'cancelled');
  const 볼것 = 사람에게.length ? 사람에게 : receipts;
  const blocked = 볼것.filter((r) => r.failureState && r.failureState !== 'none');
  if (!blocked.length) {
    const done = 볼것.map((r) => r?.userSafeSummary).filter(Boolean).join(' ').trim();
    return done || '방금 요청은 처리했어요.';
  }
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
  // M5 연속성 ②: **이미 놓은 사실을 다시 새것처럼 놓지 않는다.** 사실은 하나도 빼지 않고
  // "그 뒤로 바뀐 것" 한 줄만 얹는다(빼는 길은 이미 실패한 길이다 — external-service.js 주석).
  // 대조는 여기서 한 번만 한다 — 판정을 모델에게 넘기면 그건 대조가 아니라 추측이다.
  const 이번지문 = realitySignature(ctx.externalReality);
  ctx.externalRealityDelta = realityDelta(ctx.지난현실지문 ?? null, 이번지문);
  ctx.지난현실지문 = 이번지문;
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
async function 답완성({ reply, tc, ctx, search, receipts = [], 출처계약손 = [] }) {
  // H09 P0(거짓 성공): 이번 턴 읽기가 전패했는데 답이 내용을 서술하면, 그 답 대신 영수증의
  // 정직한 사실이 나간다. 판정 근거는 원장이다 — 성공 영수증이 하나라도 있으면 개입하지 않는다
  // (부분 성공 턴의 오차단 방지 — 경계·검사는 recovery-ladder, 관통은 이 단일 확정 지점).
  const 거짓성공 = 읽은척차단(receipts, reply, { 출처계약손 });
  if (거짓성공?.blocked) return 거짓성공.정직한답;
  // **출구 검증은 여기 묶는다**(§2-C). `답완성` 은 답이 나가는 모든 자리가 지나는 한 문이다 —
  // 자리마다 적으면 언젠가 하나가 빠지고, 빠진 그 경로로 거짓 완료가 그대로 나간다.
  // 실측(2026-08-04): `executePlan` 에만 붙였더니 **손을 안 고른 턴**이 그 앞에서 돌아가
  // 그대로 통과했다 — 그게 정본이 말한 "말로만 끝남"의 바로 그 자리였다.
  if (String(reply ?? '').trim()) return 출구검증(userFacingModelText(reply), { tc, ctx, receipts });
  const retry = await ctx.model.respond({ ...tc, answerOnly: true }, {
    onDelta: ctx.onAnswerDelta, search, effort: 'medium',
  });
  const 다시 = userFacingModelText(typeof retry === 'string' ? retry : retry?.text ?? '');
  return 출구검증(다시 || fallbackReplyFrom(receipts), { tc, ctx, receipts });
}

/**
 * **출구 검증**(정본 §S5 H08 재개봉) — 완료 주장을 원장과 대조하고, 어긋나면 사용자에게
 * 보내지 않고 **모델에게 한 번 돌려준다.**
 *
 * 중간에서 강제하면 낼 것이 없을 때 억지로 무언가를 만들어 낸다(쓰레기 로그 파일, 실측
 * 2026-08-03). 그래서 강제는 걷고 검증만 출구로 옮겼다. **대필이 아니다** — 사실만 주고
 * 무엇을 말할지는 모델이 정한다.
 *
 * `답완성` 옆에 두는 이유: 답이 나가는 자리가 여럿이라 자리마다 적으면 언젠가 하나가 빠지고,
 * 빠진 그 경로로 거짓 완료가 그대로 나간다(구조원칙 §2-C).
 */
async function 출구검증(reply, { tc, ctx, receipts = [] }) {
  // **원장글**: 이 턴의 영수증 + 앞 턴 교환. 답이 가리킨 자리가 여기 없으면 지어낸 것이다.
  // 두 벌을 따로 만들지 않는다 — 모델이 받은 것과 같은 사실 위에서 대조한다.
  const 원장글 = JSON.stringify([receipts ?? [], tc?.turnExchange ?? []]);
  const 검증 = 완료주장검증({ reply, receipts, 원장글, 이미돌려줬나: Boolean(ctx.출구되돌림) });
  if (검증.일치) return reply;
  ctx.출구되돌림 = true;
  // **되돌림은 이어감이 아니라 대체다**(F-8). 안 물리면 서로 어긋나는 두 답이 한 답으로
  // 저장되고 그대로 사용자에게 간다 — 라이브에서 정확히 그렇게 나갔다.
  ctx.미리보기?.retract?.();
  // **검증이 답을 잡아먹지 않는다.** 이 왕복이 실패해도 답은 이미 만들어져 있다 —
  // 여기서 예외를 그대로 올리면 공급자가 한 번 트림한 것 때문에 멀쩡한 답이 통째로
  // "연결이 잠시 끊겼어요"로 바뀐다(라이브 실측 2026-08-04, `live:charter` 에서 잡혔다:
  // anthropic 이 빈 스트림을 냈고 그 예외가 답 경로 전체를 무너뜨렸다).
  //
  // 출구 검증은 **그물이지 관문이 아니다.** 그물이 찢어졌다고 지나가던 것을 버리지 않는다.
  const 다시 = await ctx.model.respond({
    ...tc,
    // 지시가 아니라 **원장의 사실**이다. `answerOnly` 로 손은 안 준다 — 지금 필요한 것은
    // 새 행동이 아니라 방금 한 일을 정직하게 말하는 것이다.
    answerOnly: true,
    completionMismatch: { 사실: 검증.모델에게, 실제바뀐수: 검증.실제 },
  }, { onDelta: ctx.onAnswerDelta, effort: 'medium' }).catch(() => null);
  const 고친답 = userFacingModelText(typeof 다시 === 'string' ? 다시 : (다시?.text ?? ''));
  return 고친답.trim() ? 고친답 : reply;
}


/**
 * **다 못 냈을 때만** 한 줄 남긴다.
 *
 * 라이브(오너 2026-08-05): 답이 `예를 들어 스윙이면` 에서 끊겼다. 나는 **"여기서 잘렸어요"라고
 * 말하는 것**으로 고쳤고 오너에게 질책받았다 — *"여기서 잘렸습니다라고 안내하는 게 무슨 소용이야.
 * 메시지를 두 번, 세 번에 나누어서 필요한 만큼 다 출력하게 해도 되잖아."*
 *
 * 맞다. 사용자는 증시 정보를 원했지 잘림 안내를 원한 게 아니다(최상위 §0).
 * 그래서 지금은 **공급자 층에서 이어 써서 완성한다**(`model-provider.js` · 실서비스가 하는 그대로).
 * 이 줄은 세 번 이어 쓰고도 못 끝낸 드문 경우에만 나간다 — 정직은 **낼 수 있는데 안 내고
 * 대신 하는 말**이 아니라, 정말 못 냈을 때 쓰는 것이다.
 */
function 잘림말붙이기(답, 잘렸나) {
  const 글 = String(답 ?? '');
  if (!잘렸나 || !글) return 답;
  return `${글.trimEnd()}\n\n— 남은 부분이 더 있어요. "이어서" 라고 하시면 마저 쓸게요.`;
}

export async function runTurn(input, ctx) {
  // 3축: 이번 턴의 응답 표면. **맨 위에서 한 번만** 정한다 — 승인 재개(executePlan 직행) 경로도
  // 같은 표면을 쓴다. 채널마다 커널을 나누지 않는다(같은 커널, 표면만 다르다).
  ctx.surface = resolveResponseSurface(input);
  // 계열 ④: 이 턴에 화면으로 나가는 조각을 한 원장이 든다 — 최종 답이 그 누적을 따라온다.
  미리보기원장(ctx);
  const ledger = ctx.ledger ?? new TruthLedger();
  if (!ctx.pending) ctx.pending = new Map();
  // ── **왕복은 이 작업의 모든 모델 호출이다** (오너 구속 계약 ① 2026-08-04) ──────────
  // 세는 자리를 아홉 군데(계획·심문 두 종·이어쓰기·산출물·최종 답·재시도)에 흩으면 언젠가
  // 하나가 빠지고, 그러면 "비용 축"이 실제 비용의 절반만 세게 된다 — 초안이 정확히 그랬다.
  // 모델 클라이언트를 **한 번 감싸** 여기 한 자리에서 센다. 모든 호출이 이 문을 지난다.
  if (!ctx.왕복계수붙임 && ctx.model?.respond) {
    const 원본모델 = ctx.model;
    ctx.model = Object.create(원본모델);
    ctx.model.respond = async (...a) => { ctx.왕복수 = (ctx.왕복수 ?? 0) + 1; return 원본모델.respond(...a); };
    ctx.왕복계수붙임 = true;
  }
  // **새 발화는 예산을 새로 연다. 승인 재개는 이어받는다** — 재개마다 0 이면 카드가 여러 번
  // 뜰 때 예산이 무한이 된다(같은 일을 계속 이어가는 것이므로 같은 예산 안에서 끝나야 한다).
  if (typeof input.text === 'string' && input.text.trim()) ctx.왕복수 = 0;
  // **새 요청이면 허락은 새로 받는다.** 승인 면제는 한 요청 안에서만 이어진다 —
  // ctx 는 턴을 넘어 살아 있으므로 여기서 비우지 않으면 다음 요청까지 조용히 넘어간다.
  if (typeof input.text === 'string' && input.text.trim()) {
    ctx.허락한손 = undefined;
    ctx.허락한걸음 = undefined;
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

  // **이 턴에 무엇을 줬고 무엇을 왜 걸렀는지를 남긴다**(S7 착수 조건 · 오너 지시 2026-08-05).
  //
  // *"안 준 손은 흔적이 없다."* 지금은 손 스물 몇 개 중 몇 개만 모델에게 가고, **안 준 사실이
  // 어디에도 안 남는다.** S7 은 그 집합을 상황에서 계산하는 칸이라, 틀려도 화면에 안 나타나고
  // "모델이 요즘 좀 이상한데"로만 보인다. S6 은 216칸 표가 잡았지만 여기는 잡을 표가 없다.
  //
  // 판정하지 않는다 — 이미 난 결정을 **볼 수 있게** 만들 뿐이다(S0 가 S1 을 살린 그 자리).
  // 덤프가 꺼져 있으면 아무 일도 하지 않는다(`promptDumpDir` 이 null 이면 즉시 반환).
  void dump손제시(손제시기록(selfState, ctx.modelControls ?? []), ctx.processEnv ?? process.env)
    .catch(() => null);   // 계측이 본선을 세우지 않는다

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
  const selfhood = {
    identity, capabilityCounts: capCounts, selfhoodDetail, voice,
    runtimeEnvironment: ctx.runtimeEnvironment,
    // **집 문서**(S4) — 사용자가 열어 고치는 지침·자기소개. 말투와 같은 수명(매 세션)이고
    // 같은 규율을 받는다: 사용자가 지우면 안 실린다. 그게 사용자의 주도권이다.
    ...(ctx.homeDocs && (ctx.homeDocs.지침 || ctx.homeDocs.사용자) ? { homeDocs: ctx.homeDocs } : {}),
  };
  ctx.identityUpdate = identityUpdate; // executePlan 경계를 넘겨 결과에 함께 실린다
  ctx.selfhood = selfhood;
  // **어느 자리에서 물었는가.** 실행 루프 중간에 승인이 필요해질 수도 있어서(executePlan 은
  // input 을 안 받는다) 여기서 ctx 에 실어 둔다 — 결과가 요청이 온 자리로 돌아가는 계약(L9).
  ctx.askedFrom = input.channel ? { channel: input.channel } : undefined;
  const workStateProposals = [];
  let workStateConflict = false;
  let workStateReported = false;
  const collectWorkState = (split) => {
    if (!split?.workStateSeen) return;
    workStateReported = true;
    if (split.workStateNoChange) return;
    if (!split.workStateProposal) {
      if ((split.workStateCandidateCount ?? 0) > 0) workStateConflict = true;
      return;
    }
    workStateProposals.push(split.workStateProposal);
    if (!mergeWorkStateProposals(workStateProposals)) workStateConflict = true;
  };
  const currentWorkStateProposal = () => (workStateConflict
    ? null : mergeWorkStateProposals(workStateProposals));
  ctx.collectWorkState = collectWorkState;
  ctx.workStateSnapshot = () => ({
    workStateProposal: currentWorkStateProposal(),
    workStateConflict,
    workStateReported,
  });
  // 승인 클릭에는 사용자 원문이 없다. 승인 뒤에도 같은 work.state 후보를 검증할 수 있도록
  // 최초 요청 원문을 pending에 함께 봉인한다.
  ctx.workStateSourceText = input.text ?? '';

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
    if (saved.workStateConflict) workStateConflict = true;
    else if (saved.workStateProposal) {
      workStateReported = true;
      workStateProposals.push(structuredClone(saved.workStateProposal));
    }
    if (saved.workStateReported === true) workStateReported = true;
    ctx.stateReviewSignals = {
      goalRelevant: false,
      resumedApproval: true,
      hasAdmittedContext: (saved.admitted ?? []).length > 0,
      hasMemoryState: (ctx.memory?.promoted ?? []).length > 0
        || (ctx.memory?.candidates ?? []).length > 0
        || (ctx.memory?.observed ?? []).length > 0,
    };
    ctx.workStateSourceText = saved.sourceInputText ?? '';
    // **앞서 한 걸음을 이어받는다.** 안 이어받으면 모델이 자기가 한 일을 잊는다(위 봉인 참조).
    ctx.이어받은걸음 = Array.isArray(saved.이미한걸음) ? saved.이미한걸음 : [];
    ctx.pending.delete(input.approve);
    // **원래 물어본 자리를 잃지 않는다.** 방에서 시킨 일을 화면에서 승인해도, 그 뒤 걸음에서
    // 승인이 또 필요해지면 그 카드도 방으로 가야 한다(L9 — 결과는 요청이 온 자리로).
    ctx.askedFrom = saved.askedFrom ?? ctx.askedFrom;
    // **헌장 ③ — 사람이 허락한 상대를 기억한다.** 여기가 유일한 저장 자리다:
    // `input.approve` 는 사용자가 카드를 직접 누른 경로이고, 그것만이 미래를 열 수 있다
    // (OpenClaw: `allow-always` 는 explicit-approval 에서만 커밋된다). 자동으로 흘러간 전송은
    // 아무 것도 새로 저장하지 않는다 — 저장은 사람이 처음 허락한 그 한 번에서만 생긴다.
    if (ctx.knownCounterparts instanceof Set) {
      for (const [toolId, args] of Object.entries(saved.sendArgs ?? {})) {
        if (isSendTool(toolId, selfState)) rememberCounterpart(ctx.knownCounterparts, toolId, args?.target);
      }
    }
    // **이 요청에서 이미 허락한 손을 기억한다.** 실측(오너 라이브 2026-07-28, D):
    // "노션에서 회의록 찾아줘" 한 마디에 승인 카드가 네 번 떴다 — 같은 손이 인자만 바꿔
    // 다시 물었기 때문이다. 두 번째 카드는 첫 번째와 **같은 질문**이라 사용자가 새로 판단할
    // 것이 없다. 그렇게 묻는 것은 확인이 아니라 절차가 되고, 사용자는 읽지 않고 누르게 된다.
    // 범위는 **이 요청 안에서만**이다. 요청이 바뀌면 맥락도 바뀌므로 다시 묻는다.
    ctx.허락한손 = new Set(saved.허락한손 ?? []);
    // **허락한 그 걸음**도 이어진다 — 안 이으면 승인 뒤 재시도가 다시 카드를 부른다(F-34).
    ctx.허락한걸음 = new Set(saved.허락한걸음 ?? []);
    // 승인 재개 시 게이트에서 계산한 admitted·sendArgs를 함께 이어받는다(맥락·정밀 전송 인자 유지).
    const result = await executePlan(
      saved.intent, saved.plan, selfState, ctx, ledger, summary, saved.admitted ?? [], saved.sendArgs,
      // **승인 재개에는 이월이 없다.** 재개는 새 발화가 아니라 사용자가 방금 본 그 카드의
      // 이어짐이다 — 여기서 이월을 다시 재면 사용자가 승인한 바로 그 행동이 또 카드로 돌아온다.
      saved.intent?.currentRequest, [], [], new Set(), saved.호출신분 ?? {},
    );
    result.workStateProposal = currentWorkStateProposal();
    return result;
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
  let intent = interpret(input.text, { selfState });
  if (!intent.neededTools?.length && 동의후속(input.text)) {
    const prior = 직전실행목표(ctx.recentTurns, selfState);
    if (prior) intent = { ...prior, currentRequest: input.text, desiredOutcome: prior.desiredOutcome };
  }

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
  ctx.stateReviewSignals = {
    goalRelevant: Boolean(goalRelevant),
    resumedApproval: false,
    hasMemoryState: (ctx.memory?.promoted ?? []).length > 0
      || (ctx.memory?.candidates ?? []).length > 0
      || (ctx.memory?.observed ?? []).length > 0,
  };
  // S5-1(§4.5): 신분을 단 채로 만들고, 렌더에는 문장만 쓴다. **같은 배열**이라 보인 것과
  // 기록한 것이 갈릴 수 없다 — 렌더 뒤에 다시 계산하면 언젠가 다른 답이 나온다.
  // 채널 중복 제거(§5-K): 원천 발화가 이번 이력에 이미 실리면 기억 블록으로 재공급하지
  // 않는다 — 렌더 전에 거르므로 shown 도 같은 사실을 본다(같은 배열 원칙 그대로).
  const admittedRich = dropHistoryDuplicates(
    admittedEntries(ctx.memory ?? {}, input.text ?? '', ctx.processEnv), ctx.recentTurns ?? []);
  const admitted = [
    ...(goalRelevant ? [`현재 목표: ${ctx.activeGoal.understoodTask}`] : []),
    ...admittedRich.map((e) => e.statement),
  ];
  // **신분도 함께 나른다**(노드 K · 판 ④). 문장만 가면 *"아침에 보리차를 마셨다"* 같은
  // **사실**이 저장된 **명령**과 같은 격리 딱지를 받고, 모델이 그걸 읽고 버린다.
  // `executePlan` 은 `admitted`(문장)만 인자로 받으므로 `ctx` 로 보낸다 — 같은 배열이라
  // 보인 것과 실린 것이 갈릴 수 없다.
  ctx.admittedRich = admittedRich;
  ctx.stateReviewSignals.hasAdmittedContext = admitted.length > 0;
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
  // **모델이 낸 질문.** 커널이 만든 되묻기와 한 자리를 놓고 다투지 않게 여기 하나만 둔다.
  let 물음 = null;
  const 통제제안받기 = (분리) => {
    // **모델이 물었다.** 어느 모델 호출에서 왔든 한 자리에 모은다 — 자리마다 따로 읽으면
    // 언젠가 하나가 빠지고, 빠진 그 자리에서 모델의 질문이 조용히 사라진다(§2-C).
    if (분리?.askUser && !물음) 물음 = 분리.askUser;
    if (분리?.skillProposal) skillProposal = 분리.skillProposal;
    if (분리?.automationProposal) automationProposal = 분리.automationProposal;
    // **만든 것을 모델이 알아야 한다**(판 ⑦). `executePlan` 안에서도 읽으려면 `ctx` 다.
    ctx.automationProposal = automationProposal;
    if (분리?.agentProposal) agentProposal = 분리.agentProposal;
    collectWorkState(분리);
  };
  const 통제제안 = () => ({
    skillProposal, automationProposal, agentProposal,
    workStateProposal: currentWorkStateProposal(),
  });
  const 승인통제제안 = () => ({ skillProposal, automationProposal, agentProposal });
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
  let 답잘림 = false;   // 상한에서 끊겼나(거짓 성공 금지 — 잘렸으면 잘렸다고 말한다)
  // 이 턴의 문맥을 블록 밖에서도 쓴다 — 승인으로 멈출 때 **한 번 더 말하게** 하려면 필요하다.
  let earlyTc;
  let earlyWantedWeb = false;
  {
    const tc = earlyTc = buildTaskContext({
      processEnv: ctx.processEnv,
      externalReality: ctx.externalReality, externalRealityDelta: ctx.externalRealityDelta,
      intent, selfState, admittedContext: admitted, admittedRich, automationProposal, recentTurns: ctx.recentTurns, priorExchange: ctx.priorExchange,
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
      // 3축: 지금 이 답이 어디로 나가는가(웹/메신저). 같은 커널, 표면만 다르다.
      surface: ctx.surface,
      nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
      // 자기 파악 세 번째 축: **지금 이 대화에서 어디까지 왔는가**. 이게 없으면 "리뷰 읽어봐"의
      // "리뷰"가 무엇인지 몰라 엉뚱한 것을 검색한다(오너 실사용).
      workingState: ctx.workingState,
      projectWorkState: ctx.projectWorkState,
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
      tools: modelSchemasFor(selfState, ctx.modelControls),
    });
    earlyReply = typeof out === 'string' ? out : out?.text ?? '';
    // **잘린 답을 다 쓴 답인 것처럼 내지 않는다**(절대 게이트 1 — 거짓 성공).
    // 라이브(오너 2026-08-05): 답이 `예를 들어 스윙이면` 에서 문장 한가운데 끊겼는데
    // T5 는 아무 말 없이 그대로 내보냈다. 사용자는 왜 끊겼는지 알 길이 없었다.
    // 종료 사유는 관측되고 있었지만 `onCallIdentity` 곁길로만 흘러 여기서 아무도 안 읽었다.
    if (out?.잘림) 답잘림 = true;
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

  // ── **묻는 일을 모델에게 돌려준다**(S8 ④) ────────────────────────────────
  //
  // 예전엔 커널이 자기 문장으로 되물었다(`fileClarifyQuestion` 등). 모델이 물었으면 **그
  // 질문이 나간다** — 커널이 갈아치우지 않는다(§1 소유의 분할: 말은 프로세스의 것이다).
  //
  // 그리고 **여기서 턴이 끝난다.** 같은 턴에 다른 손을 함께 골랐어도 실행하지 않는다 —
  // 물어 놓고 실행하면 사용자의 답이 도착하기 전에 효과가 나고, 그건 승인 전 효과의 사촌이다.
  // 실행을 안 하므로 뒤쪽 런타임 되묻기도 도달하지 않는다: **한 턴에 질문은 최대 하나**다.
  //
  // 손이 하나 늘었다고 질문이 늘면 그건 개선이 아니라 실패다(§3.1 · 오너 지시). 그래서
  // 늘리는 쪽 장치는 하나도 안 만들었다 — 모델이 안 부르면 이 자리는 통째로 안 돈다.
  if (물음) {
    return {
      kind: 'clarify',
      question: 물음.question,
      options: 물음.options,
      selfStateSummary: summary,
      shownMemoryRefs,
      modelCitedRefs,
      memoryCorrection,
      memorySuggestion,
      memoryWithdrawal,
      ...통제제안(),
      followUp,
      usedSkill: ctx.usedSkill,
    };
  }

  // ── **현재 요청 침해 0** — 심문이 아니라 승인 경계로 지킨다 ──────────────────
  //
  // 여기 있던 것은 심문(`currentRequestCalls`)이었다. 모델이 지난 턴의 미완료 행동과 지금
  // 요청 행동을 함께 냈을 때, 런타임이 **모델에게 되물어** 현재 것만 남기고 나머지를 버렸다.
  //
  // 걷어내는 근거는 실측이다(같은 코드·같은 문장·같은 437개 고정판, 2026-08-04):
  //   심문 켬 — 모델호출 18 · 토큰 178k · 무진전반복 4 · 이동 353
  //   심문 끔 — 모델호출  5 · 토큰  51k · 무진전반복 0 · 이동 367
  // 왕복만 먹은 게 아니다. 모델의 선택을 **조용히 버리면서** 모델이 자기 계획을 잃고 같은
  // 자리를 다시 밟게 만들었다. 계약 ①("모델이 낸 호출을 버리지 않는다")과 정면으로 어긋난다.
  //
  // 그래도 위험은 가설이 아니다 — 다중 호출 병합을 걷어내자 걸음 루프가 심문이 걷어내던
  // **과거 삭제를 다시 받아 실행했다**(`pc-hands-c-closure` #293).
  //
  // 그래서 **버리는 대신 보인다**: 지난 턴에 시도했다 못 끝낸 행동과 같은 지문이 이번 턴에
  // 다시 나오면, 되돌릴 수 있든 없든 자동으로 실행하지 않고 **승인 카드로 올린다.**
  // 왕복 0 · 모델의 선택은 안 버려짐 · 사용자가 정말 원했으면 한 번 누르면 끝.
  // 판단을 대신 하는 게 아니라 "이건 이번 발화가 아니라 지난 턴에서 왔다"는 사실만 세운다.
  const 이월된것 = 이월지문(ctx.priorExchange);
  // 이번 발화가 가리킨 자리 — 발화밖 파괴 판정의 유일한 기준이다(목록 없음).
  const 이번발화 = parseFileRequest(input.text ?? '');
  const 파괴판정 = (call) => ({
    kind: toolActionKind({ toolId: call?.name, args: call?.args, selfState }),
    대상: call?.args?.path ?? call?.args?.target,
  });

  // 완료 형태 판단은 fast path 보다 먼저 선다. 모델이 첫 응답에서 손을 고르지 않았다는 이유로
  // 파일 산출물 요청이 대화 답만 남기고 빠져나가면, 바로 막으려던 H08 실패가 재발한다.
  const completionContract = await fileDeliverablesFor({
    model: ctx.model, tc: earlyTc, calls: modelChosen ?? [], intent,
  });

  // CHAT 계약인데 모델이 대상 없는 파일 호출을 함께 냈다면, 그 불완전한 호출로 파일 이름을
  // 되묻지 않는다. 자료를 실제로 읽어야 하는 채팅이면 모델 호출에 path가 있어야 하고 그대로
  // 실행된다. 대상도 없고 파일 산출물도 아닌 호출만 버린 뒤 답을 완성한다.
  let chatDiscardedFileCall = false;
  if (completionContract.assessment === 'chat' && modelChosen?.length) {
    const usable = modelChosen.filter((call) => call?.name !== 'local.file'
      || (call?.args?.action !== 'write' && String(call?.args?.path ?? '').trim()));
    chatDiscardedFileCall = usable.length !== modelChosen.length;
    modelChosen = usable.length ? usable : null;
  }
  if (completionContract.assessment === 'chat' && !modelChosen) {
    // 파일 도구가 함께 보인 첫 호출의 "어떤 파일로 할까요?"도 정답으로 재사용하지 않는다.
    // CHAT으로 확정된 뒤에는 도구 없는 답 전용 호출이 실제 대화 초안을 만든다.
    earlyReply = '';
  }
  // 사용자가 앞서 읽은 자료를 "공지문 파일로 만들어줘"라고 하면, 본문을 다시 받아쓰게 하지
  // 않는다. FILE 계약이 섰고 애매한 것이 **본문뿐**일 때만 모델에게 쓰기 손을 구조로 요구한다.
  // 경로·내용·원본 선택은 모델의 몫이고, 반환된 호출은 아래의 기존 계획·권한·승인 경계를 탄다.
  if (!modelChosen && completionContract.assessment === 'file') {
    const parsed = parseFileRequest(input.text ?? '');
    if (parsed.action === 'write' && parsed.clarifyReason === 'no_content') {
      const writeTools = fileWriteTools(selfState, ctx.modelControls, { derived: true });
      if (writeTools.length) {
        const out = await ctx.model.respond({ ...earlyTc, unmetDeliverable: true }, {
          effort: 'medium', tools: writeTools, requiredTool: 'local.file',
        });
        const 분리 = splitModelControlCalls(typeof out === 'string' ? [] : (out?.toolCalls ?? []));
        통제제안받기(분리);
        if (분리.memorySuggestion) memorySuggestion = 분리.memorySuggestion;
        if (분리.memoryWithdrawal) memoryWithdrawal = 분리.memoryWithdrawal;
        if (분리.memoryCorrection) memoryCorrection = 분리.memoryCorrection;
        if (분리.rest.length) {
          modelChosen = 분리.rest;
          if (typeof out !== 'string' && out?.text) earlyReply = out.text;
        }
      }
    }
  }

  if (!modelChosen && intent.neededTools?.includes('local.file') && !chatDiscardedFileCall) {
    const fileTools = modelSchemasFor(selfState, ctx.modelControls).filter((t) => t.name === 'local.file');
    if (fileTools.length) {
      const out = await ctx.model.respond({ ...earlyTc, actionRequired: true }, {
        effort: 'medium', tools: fileTools, requiredTool: 'local.file',
      });
      const 분리 = splitModelControlCalls(typeof out === 'string' ? [] : (out?.toolCalls ?? []));
      통제제안받기(분리);
      if (분리.memorySuggestion) memorySuggestion = 분리.memorySuggestion;
      if (분리.memoryWithdrawal) memoryWithdrawal = 분리.memoryWithdrawal;
      if (분리.memoryCorrection) memoryCorrection = 분리.memoryCorrection;
      if (분리.rest.length) {
        modelChosen = 분리.rest;
        if (typeof out !== 'string' && out?.text) earlyReply = out.text;
      }
    }
  }

  // 3) fast path — 손이 필요 없다고 모델이 판단했다. 이미 받은 답을 그대로 준다(추가 호출 없음).
  if (!modelChosen && !influence
      && (completionContract.assessment === 'chat'
        || (intent.answerMode === 'fast_chat' && completionContract.assessment === 'not_applicable'))) {
    // 도구를 안 쓴 턴도 **대화의 한 턴이다.** 여기서 상태를 안 넘기면 턴 수가 멈춰서, 옛 대상이
    // 영원히 "방금 읽은 자료"로 남는다 — 감쇠가 필요한 바로 그 턴(화제 전환)에 감쇠가 안 돈다.
    // 라이브 실측에서 드러났다: 팔식당 뒤로 파이썬 얘기를 네 턴 해도 여전히 "방금 팔식당"이었다.
    const idleState = deriveWorkingState(ctx.workingState, { receipts: [], places: await 볼수있는자리(ctx) });
    return {
      kind: 'reply',
      // 빈 답을 그대로 돌려주던 자리다(H 진단 계열 ③ · P1). 계열 ④: 화면에 나간 조각과 정렬.
      reply: 잘림말붙이기(미리보기정렬(await 답완성({
        reply: earlyReply,
        tc: completionContract.assessment === 'chat' ? { ...earlyTc, chatOutputContract: true } : earlyTc,
        ctx, search: earlyWantedWeb,
      }), ctx.미리보기), 답잘림),
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
  // Phase 0-2: 모델이 내장 검색을 하면 T5 가 같은 일을 또 하지 않는다(중복 실행·실패 원장 방지).
  //   실사용에서 1층이 답을 만들었는데 2층도 돌아 "로그인이 필요한 페이지예요"가 원장에 남았다.
  //   OpenClaw 도 내장 검색이 있으면 관리형 검색 도구를 억제한다(같은 원리).
  let planIntent = ctx.modelSupportsSearch && intent.neededTools?.includes('web.collect')
    ? { ...intent, neededTools: intent.neededTools.filter((id) => id !== 'web.collect') }
    : intent;

  // 파일이라는 낱말은 있어도 전용 결과 판정이 CHAT 이고 모델도 파일 손을 고르지 않았다면,
  // 정규식 폴백이 그 판단을 뒤집지 못한다. 그래야 "대화에 먼저, 파일은 아직 만들지 마"가
  // 파일 이름 질문으로 바뀌지 않는다. 실제 파일 요청은 modelChosen 또는 FILE 판정으로 유지된다.
  if (completionContract.assessment === 'chat'
      && !modelChosen?.some((call) => call?.name === 'local.file')
      && planIntent.neededTools?.includes('local.file')) {
    planIntent = {
      ...planIntent,
      neededTools: planIntent.neededTools.filter((id) => id !== 'local.file'),
      fileOp: undefined,
    };
  }

  if (influence?.tool && !planIntent.neededTools?.includes(influence.tool)) {
    planIntent = { ...planIntent, neededTools: [...(planIntent.neededTools ?? []), influence.tool] };
  }
  // **승인 판정과 실행 인자는 같은 파싱 하나에서 나와야 한다.** 예전엔 승인은 `intent.fileOp` 를,
  // 실행 인자는 아래에서 원문을 다시 파싱해 만들었다. 스킬이 `local.file` 을 밀어 넣으면 fileOp 가
  // 없어 권한은 read 로 통과하는데 실행은 delete 를 했다 — 두 진실이 갈라진 자리에서 안전 바닥이 샜다.
  // P2-5b: 모델이 고른 도구가 있으면 **그것이 우선**이다. 정규식은 모델이 못 고를 때의 폴백이다
  // (모델 미연결·도구 호출 미지원 provider). 판정·승인·실행은 아래 그대로 — 경계는 안 바뀐다.
  let modelToolArgs;
  // ── 첫 응답의 호출도 **하나도 합치지 않는다** ────────────────────────────────
  //
  // 계획 경로(`executePlan`)는 `plan.toolsToUse` 를 돌며 **도구 하나당 인자 하나**를 실행한다.
  // 그래서 모델이 한 응답에 같은 손을 다섯 번 부르면 넷이 사라졌다(S1 회차 6 실측).
  //
  // 계획 경로의 기존 의미는 건드리지 않는다 — 손마다 **첫 호출**이 예전처럼 계획을 만들고
  // 승인·완료계약을 탄다. **나머지는 걸음 줄로 넘긴다**(`추가호출`). 거기서 호출 하나하나가
  // 같은 판정(probe → toolActionKind → decideAutoGrant)을 그대로 타고, 못 한 것은 사실로 남는다.
  /** @type {Array<{name:string, args:object, id?:string}>} */
  const 추가호출 = [];
  /** 우리가 안 보여준 손을 골랐다 — 예전엔 여기서 조용히 사라졌다. */
  const 없는손호출 = [];
  /** 손 이름 → 그 손을 부른 모델 호출의 공급자 신분. */
  const 계획호출신분 = {};
  if (modelChosen?.length) {
    const 보여준손 = new Set(modelSchemasFor(selfState, ctx.modelControls).map((t) => t.name));
    const 본것 = new Set();
    const 대표 = [];
    for (const call of modelChosen) {
      if (call?.name && !보여준손.has(call.name)) { 없는손호출.push(call); continue; }
      // **이월은 계획의 대표가 되지 않는다.** 계획 경로는 승인이 걸리면 턴 전체가 거기서 서는데,
      // 대표 자리에 지난 턴 행동이 앉으면 **이번 요청이 이월 하나 때문에 못 돈다** — 그게 심문이
      // 내던 병 그대로다(실측 2026-08-04, 이 검사가 처음 잡았다). 줄 뒤로 보내면 이번 요청이
      // 계획 경로에서 먼저 끝나고, 이월은 걸음 루프에서 승인 카드로 선다. 순서가 곧 계약이다.
      if (이월행동(call, 이월된것) || 발화밖파괴(파괴판정(call), 이번발화)) { 추가호출.push(call); continue; }
      if (call?.name && 본것.has(call.name)) { 추가호출.push(call); continue; }
      if (call?.name) 본것.add(call.name);
      대표.push(call);
      // 계획 경로가 실행할 대표 호출의 **공급자 신분**을 손 이름에 걸어 둔다. 계획은
      // `plan.toolsToUse`(손 이름)로 도는 구조라 여기서만 이어 붙일 수 있다.
      if (call?.name && call?.providerCallId) 계획호출신분[call.name] = { providerCallId: call.providerCallId };
    }
    modelChosen = 대표;
  }
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
  // **뒤로 미룬 손을 정규식이 대신 세우지 않는다**(S6-c 6번).
  //
  // 밟은 사실(2026-08-05): 지난 턴에 못 끝낸 삭제와 같은 지문을 모델이 다시 내면 위에서
  // `추가호출` 로 미룬다(이월은 계획의 대표가 되지 않는다). 그러면 `대표` 가 비고, **발화를
  // 다시 파싱한 폴백 의도가 그 자리에 앉았다.** "작업 폴더 정리 좀 도와줘" 는 작업이 모호해
  // 턴은 *"그 파일로 무엇을 할까요?"* 로 끝났다 — **모델이 이미 무엇을 할지 말했는데도.**
  // 미뤄 둔 걸음은 손도 못 댔고, 이월 카드는 뜨지 않았다.
  //
  // 바로 위(1281)가 이미 규칙을 적어 뒀다: *"모델이 이해해서 고른 것을 정규식으로 되돌리지
  // 않는다. 파싱은 모델이 **못 고를 때**의 폴백이다."* 모델은 골랐다 — 우리가 미뤘을 뿐이다.
  const 미뤄둔손 = new Set(추가호출.map((c) => c?.name).filter(Boolean));
  for (const c of modelChosen ?? []) 미뤄둔손.delete(c?.name);   // 대표로 선 손은 그대로 돈다
  if (미뤄둔손.size) {
    planIntent = {
      ...planIntent,
      neededTools: (planIntent.neededTools ?? []).filter((id) => !미뤄둔손.has(id)),
    };
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
      // **등급 판정은 경계 한 자리에서 한다**(S6-c 2번). 여기 같은 로직이 한 벌 더 있었다 —
      // probe 를 돌리고 `{changes, granted, probeResult}` 를 만드는 열 줄이 `tool-boundary.js`
      // 와 줄 단위로 같았다. 두 벌이면 한쪽만 고쳐지고, 실제로 그랬다:
      // **probe 가 풀어 준 자리(cwd)를 계획 경로만 챙기고 걸음 경로는 버렸다.**
      //
      // 경계가 지키는 계약은 그대로다:
      //   · probe 를 못 돌렸으면 `changes` 를 비워 둔다 — 미상은 승인으로 간다(read 로 안 흘린다).
      //   · probe 결과를 **그대로 싣는다.** 안 그러면 도구가 같은 명령을 한 번 더 돌린다 —
      //     느린 것보다, `date`·`ls` 처럼 두 번 돌리면 답이 달라지는 명령에서 사용자에게 보인 것과
      //     원장에 남은 것이 갈라지는 게 문제다(두 진실 금지).
      const { 판정인자: 터미널판정인자 } = await 실행전판정({
        toolId: 'local.terminal', args: { command, cwd: asked.cwd }, selfState, tools: ctx.tools,
      });
      planIntent = { ...planIntent, terminalOp: 터미널판정인자 };
    }
  }
  // 모델이 다른 사용자 홈을 짐작해도, 사용자가 이번 발화에서 직접 부른 표준 폴더라면
  // 현재 런타임이 실제로 연 루트로 맞춘다. 미리보기·승인·실행이 모두 같은 인자를 본다.
  const effectiveFileOp = planIntent.toolArgs?.['local.file'] ?? planIntent.fileOp;
  if (effectiveFileOp) {
    const normalizedFile = runtimeFileArgs(
      effectiveFileOp, input.text, ctx.tools?.tools?.['local.file']?.scopeRoots,
    );
    planIntent = {
      ...planIntent,
      fileOp: normalizedFile,
      toolArgs: { ...(planIntent.toolArgs ?? {}), 'local.file': normalizedFile },
    };
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
  /** 계획 단계에서 막힌 손과 그 사실 — **답이 아니라 이번 턴 모델에게 줄 재료다.** */
  const 계획막힘 = [];
  // 없는 손을 고른 사실을 남긴다. `callsToIntentParts` 는 "있는 척 금지"로 조용히 버리는데,
  // 버린 사실까지 없애면 모델은 자기가 시킨 것이 갔다고 믿은 채 답을 쓴다(오너 지시 2026-08-04).
  for (const [i, call] of 없는손호출.entries()) {
    계획막힘.push(receipt({
      intended: `${call?.name ?? '(이름 없음)'} 실행`,
      // **신분도 함께 남는다.** 공급자가 준 것이 있으면 그대로, 없으면 칸을 만들지 않는다.
      // T5 내부 상관용 `callRef` 는 언제나 붙인다 — 둘은 서로 다른 것이다.
      actualCall: {
        tool: call?.name, args: call?.args ?? {},
        ...(call?.providerCallId ? { providerCallId: call.providerCallId } : {}),
        callRef: `없는손${i + 1}`,
      },
      failureState: 'blocked',
      userSafeSummary: '그 손은 지금 없어요.',
      diagnosticTrace: { 순번: i + 1, tool: call?.name, reason: '없는손' },
    }));
  }
  const 계획막힌손 = new Set();
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
      // **막힌 사실은 답이 아니라 재료다** — 이 턴 안에서 모델에게 넘긴다(라이브 실측 2026-08-03).
      //
      // 예전엔 여기서 `return { kind:'reply', reply: 막힘문장 }` 으로 **턴을 끝냈다.** 주석은
      // "그 사실은 **다음 턴의** TaskContext와 원장에 올라가므로 모델은 그 위에서 다음 길을
      // 판단한다"고 적혀 있었다 — 즉 한 왕복을 통째로 태워 템플릿 한 문장만 말하고, 모델은
      // 다음 턴으로 미룬 것이다. 실측: "내 다운로드 폴더를 같이 정리해볼까?" 에 T5 는
      // "그 자리는 파일 도구의 작업 폴더 밖이에요"만 답하고 끝냈다. 모델은 한 마디도 못 했다.
      //
      // 사람이 일하는 방식이 아니다. 도구 하나가 안 되면 그 자리에서 다른 길을 찾지, 대화를
      // 끊고 다음 턴을 기약하지 않는다. 실행 사실을 보존한다는 목적은 그대로다 —
      // 원장에 남기는 것이 그 목적을 이미 달성한다. 끊는 것은 목적이 아니라 부작용이었다.
      //
      // 승인 카드로 꾸미지 않는다는 계약도 그대로다: 이 손은 계획에서 빠지므로 모델은 실행할 수
      // 없는 일을 고를 수 없고, 사용자는 성공할 수 없는 카드를 보지 않는다.
      계획막힘.push(rec);
      계획막힌손.add(id);
    }
  }
  // 막힌 손은 이번 턴 계획에서 뺀다 — 못 하는 일을 계획에 남기면 카드가 함정이 된다.
  if (계획막힌손.size) {
    planIntent = { ...planIntent, neededTools: (planIntent.neededTools ?? []).filter((x) => !계획막힌손.has(x)) };
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
  const plan = buildActionPlan({ intent: planIntent, selfState });
  // P90-1: 완료 계약은 실행 뒤 영수증을 보고 만들지 않는다. ActionPlan이 확정된 이 자리에서
  // WorkRef와 결합해 발급하고, 승인 재개도 이 봉인된 plan을 그대로 사용한다.
  if (plan.deliverableAssessment === 'file' && plan.deliverables.length
      && ctx.workRef && ctx.issueCompletionContractRef && input.turnRef) {
    const contract = {
      kind: 'file',
      sourceTurnRef: input.turnRef,
      deliverables: structuredClone(plan.deliverables),
    };
    plan.workRef = ctx.workRef;
    plan.completionContract = contract;
    plan.completionContractRef = await ctx.issueCompletionContractRef(contract);
  }

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
  let pendingGrants = plan.needsApproval.filter((g) => !isExecutionAllowed(g));

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
    // **헌장 ③ — 아는 상대에는 다시 묻지 않는다.** 승인 판정은 대상이 확정되기 **전에** 났다
    // (계획 단계에서는 어디로 보낼지 아직 모른다). 그래서 대상이 사실로 확정된 지금 다시 본다.
    // 사용자가 전에 이 상대에게 보내는 것을 직접 허락했다면 그 카드는 같은 질문의 반복이다.
    // **S6-b(2): 면제 판정은 경계 하나가 한다.** 계획 경로와 걸음 경로가 같은 함수를 쓴다 —
    // 그래야 "같은 요청인데 어느 길로 왔느냐"로 답이 갈리지 않는다(F-20 이 그 대가였다).
    // 적용하는 **방식**은 경로마다 다르다: 여기는 계획을 고쳐 자동 목록으로 옮기고,
    // 걸음 경로는 승인 분기에 애초에 안 들어가게 한다. **판정은 하나, 적용은 그 경로의 것.**
    // **게이트 사실도 같이 넘긴다.** 여기 오는 전송은 이월이 아니다 —
    // 이월·발화밖은 위(1069)에서 이미 걸러 `추가호출` 로 밀려났기 때문이다.
    // 그래도 **넘긴다**: 그 사실이 인자에 안 보이면 다음 사람이 "계획 경로는 게이트를 안 본다"로
    // 읽고, 위쪽 거르기가 언젠가 바뀌면 조용히 뚫린다. **판정이 하나면 인자도 하나여야 한다.**
    if (승인면제({
      toolId: sendGrant.action,
      판정인자: { target: parsed.target },
      허락한손: ctx.허락한손,
      knownCounterparts: ctx.knownCounterparts,
      전송인가: true,
      이번이월: 이월행동({ name: sendGrant.action, args: { target: parsed.target } }, 이월된것),
      발화밖: 발화밖파괴(파괴판정({ name: sendGrant.action, args: { target: parsed.target } }), 이번발화),
    }).면제) {
      plan.needsApproval = plan.needsApproval.filter((g) => g !== sendGrant);
      if (!plan.autoAllowed.includes(sendGrant.action)) plan.autoAllowed.push(sendGrant.action);
      pendingGrants = pendingGrants.filter((g) => g !== sendGrant);
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
    // 승인 카드가 "어디에/무엇을/되돌리기"를 사용자 언어로 보이도록 채운다.
    // 대상이 확정되면 미확정 상태를 설명하던 scope는 폐기한다. 같은 카드에
    // "받는 곳 미정"과 "오너"가 함께 있으면 표면이 어느 쪽을 그리든 객체에는 두 진실이 남는다.
    // **걸음 경로도 같은 함수를 쓴다** — 이 두 줄이 여기에만 있어서 걸음 카드가 비어 있었다.
    전송카드확정(sendGrant, { target: parsed.target, targetLabel: parsed.targetLabel, text: parsed.message });
  }

  if (pendingGrants.length) {
    // 고유 pendingId: 서버가 newId(예: UUID)를 주입하면 지속 pending 간 충돌 없음.
    // 미주입 시(단위 테스트) 카운터 폴백. Approval Lifecycle: 만료 시각을 함께 보관.
    const pendingId = ctx.newId ? ctx.newId() : `p${(ctx._seq = (ctx._seq ?? 0) + 1)}`;
    // admitted를 pending에 함께 보존한다 — 승인 재개 실행에서 이미 계산한 맥락을 잃지 않게(감사 소보정).
    이전대기를지난것으로(ctx);
    ctx.pending.set(pendingId, {
      intent, plan, admitted, sendArgs,
      // **최초 계획 승인도 신분을 봉인한다.** 걸음 경로에만 걸어 뒀다가, 첫 응답이 바로
      // 승인 경계인 흔한 경우("임시폴더 지워줘")에서 재개 뒤 신분이 끊겼다(실측 2026-08-04).
      // 사용자가 승인한 것이 **모델이 낸 그 호출**이라는 사실은 경계를 넘어 살아 있어야 한다.
      호출신분: 계획호출신분,
      workStateProposal: currentWorkStateProposal(),
      workStateConflict,
      workStateReported,
      sourceInputText: ctx.workStateSourceText,
      workRef: ctx.workRef ?? null,
      sourceTurnRef: input.turnRef ?? null,
      sourceRequestDigest: requestDigest(input.text),
      // **결과는 요청이 온 자리로 돌아간다.** 승인은 표면을 건너뛸 수 있어도(방에서 시켰는데
      // 화면에서 승인) 결과까지 건너뛰면 안 된다 — 라이브 실측: 방에서 시키고 방에서
      // "확인해 주시면 이어서 할게요"를 들은 뒤 화면에서 승인했는데, 방은 영영 조용했다.
      // 어느 표면이 물었는지만 봉인한다. 어디로 보낼지(방 id)와 보내는 일은 서버가 안다.
      askedFrom: input.channel ? { channel: input.channel } : undefined,
      // 이 요청에서 허락받은 손. 계획 경로와 걸음 경로가 **같은 규칙**을 써야 한다 —
      // 한쪽만 면제하면 같은 요청인데 어느 길로 왔느냐에 따라 묻는 횟수가 달라진다.
      허락한손: [...(ctx.허락한손 ?? []), ...pendingGrants.map((g) => g.action).filter(Boolean)],
      // **무엇을 허락했는지**까지 봉인한다. 손 이름만 남기면 재시도가 "허락 안 한 것"이 되고,
      // 그 자리에서 걸음이 죽는다(F-34 · 라이브 2026-08-05).
      허락한걸음: [...(ctx.허락한걸음 ?? []), ...pendingGrants.map((g) => 걸음신분({
        toolId: g.action, 판정인자: intent.toolArgs?.[g.action],
      })).filter(Boolean)],
      grantScope: { kind: 'once', expiresAt: nowMs(ctx) + APPROVAL_TTL_MS },
    });
    // **멈출 때도 말한다.** 라이브 실측(ae1d3ea8): 사용자가 "작업용SSD"라고만 답한 턴에서
    // 승인 카드만 뜨고 T5 는 한 마디도 안 했다 — 사용자에겐 먹통으로 보인다. 카드에는 명령
    // 원문이 있지만, 그건 "무엇을 이해했고 왜 멈췄는지"가 아니다.
    //   · 모델이 도구를 고르며 이미 한 말이 있으면 **그걸 버리지 않는다**(toolCalls 를 버렸던
    //     것과 같은 자리의 거울상이다 — 그때도 모델은 옳게 말했는데 우리가 버렸다).
    //   · 없으면 카드가 이미 확정한 사실을 짧게 말한다. 안내만 위해 모델을 다시 부르지 않는다.
    let 멈춤설명 = userFacingModelText(earlyReply);
    if (!멈춤설명) 멈춤설명 = pendingGrants[0]?.reason?.whatChanges
      ? `${pendingGrants[0].reason.whatChanges} 확인해 주시면 진행합니다.`
      : '확인해 주시면 이번 요청만 진행합니다.';
    return {
      kind: 'approval',
      pendingId,
      // 카드와 **함께** 나가는 사람 말. 없으면 필드 자체를 안 만든다(빈 말풍선 금지).
      ...(멈춤설명 ? { reply: 멈춤설명 } : {}),
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
      ...승인통제제안(),
      capabilityResolution: resolveCapability({ text: input.text, permission: { label: toolLabel(pendingGrants[0].action, selfState), action: pendingGrants[0].action } }),
    };
  }

  // 4b) 승인 필요 없음 → 바로 실행.
  const result = await executePlan(intent, plan, selfState, ctx, ledger, summary, admitted, sendArgs, input.text, 계획막힘, 추가호출, 이월된것, 계획호출신분);
  // 다음 턴이 이어받을 자리에 남긴다. 서버가 대화에 저장하면 재시작도 넘는다.
  // **화면 증거는 이번 턴만.** 이월하면 오너 화면이 계속 돈다(CU F-2 · 계획 §6).
  if (result?.turnExchange?.length) ctx.priorExchange = 이번턴만그림(result.turnExchange);
  // S5-1(§4.5): 이 턴에 **실제로 모델 앞에 놓인** 것의 신분. 렌더를 아는 쪽이 붙인다 —
  // `executePlan` 은 무엇이 렌더됐는지 모른다. 사용자면에는 나가지 않는다(서버가 저장에만 쓴다).
  result.shownMemoryRefs = shownMemoryRefs;
  result.modelCitedRefs = modelCitedRefs;
  result.memoryCorrection = memoryCorrection;
  // executePlan 의 다단계 호출에서 온 제안은 ctx 를 통해 돌아온다.
  if (ctx.제안된스킬) { skillProposal = ctx.제안된스킬; ctx.제안된스킬 = undefined; }
  if (ctx.제안된자동화) { automationProposal = ctx.제안된자동화; ctx.제안된자동화 = undefined; }
  if (ctx.제안된에이전트) { agentProposal = ctx.제안된에이전트; ctx.제안된에이전트 = undefined; }
  // 도구 걸음 중 승인이 생기면 work.state는 pending에 봉인된 채 승인 뒤에만 나간다.
  // 여기서 먼저 노출하면 승인 전/후가 서로 다른 사건 묶음으로 저장된다.
  if (result.kind === 'approval') Object.assign(result, 승인통제제안());
  else Object.assign(result, 통제제안());
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

async function executePlan(intent, plan, selfState, ctx, ledger, summary, admitted = [], sendArgs, requestText = intent.currentRequest, 앞선막힘 = [], 첫응답나머지 = [], 이월된것 = new Set(), 계획호출신분 = {}) {
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
  // 계획 단계에서 막힌 사실도 **이번 턴의 영수증**이다 — 여기 없으면 모델은 자기가 고른 손이
  // 왜 안 갔는지 모른 채 답을 쓴다(그래서 예전엔 아예 모델을 안 부르고 턴을 끝냈다).
  // 계획 단계의 막힘 + **승인으로 쪼개지기 전에 실제로 한 걸음**(둘 다 이번 턴의 사실이다).
  const 이어받은 = Array.isArray(ctx.이어받은걸음) ? ctx.이어받은걸음 : [];
  const turnReceipts = [...이어받은, ...앞선막힘.filter((r) => !이어받은.includes(r))];

  // **캡슐 안에서 돈 실행도 원장에 올린다**(S4). 캡슐은 손 하나로 보이지만 그 안에서 여러
  // 손이 실제로 돌았다 — 여기서 끊으면 사용자도 감사도 무슨 일이 있었는지 못 본다.
  //
  // 자리마다 적지 않고 **원장 입구 하나**에 묶는다(구조원칙 §2-C). `ledger.append` 는
  // 여섯 군데에서 불리고, 그중 하나만 빠져도 그 경로의 캡슐이 조용해진다.
  const 원장 = {
    ...ledger,
    entries: ledger.entries,
    append(rec) {
      for (const 안쪽 of rec?.result?.innerReceipts ?? []) ledger.append(안쪽);
      return ledger.append(rec);
    },
  };

  // ── 예산·가드레일 상태 (계획 경로보다 먼저 선다 — 거기서도 예산을 센다) ──────
  const 예산 = 턴예산(ctx.processEnv ?? process.env);
  // **외부효과 뒷단은 비용 모델이 아니다**(오너 구속 계약 ④). 되돌릴 수 있는 것과 없는 것을
  // 따로 센다 — 도구별 비용표를 만들지 않고 이미 있는 `reversible` 선언에서 파생한다.
  let 되돌릴수있는것쓴것 = 0;
  let 그밖쓴것 = 0;
  // **좁은 칸은 `reversible: false` 를 선언한 손만이다.**
  //
  // 한 번 "모르면 좁은 칸"으로 뒀다가 회귀 22건이 물었다(실측 2026-08-04): `reversible` 을
  // 선언하지 않은 손이 많아서(MCP·web.collect·일부 커넥터) 정상 읽기·탐색 흐름이 3에서 끊겼다.
  //
  // 이 뒷단이 막는 것은 **되돌릴 수 없는 외부효과의 폭주**이지 "모르는 것"이 아니다. 모르는 것은
  // 이미 승인 경계가 잡는다 — `toolActionKind` 가 미상을 승인으로 보내고 헌장 넷이 그 위에 선다.
  // 여기서 한 번 더 좁히면 안전이 아니라 마비가 된다(자동성이 의무다).
  const 되돌릴수있나 = (toolId) => selfState.connectedTools?.find((t) => t.id === toolId)?.reversible !== false;
  const 시작시각 = nowMs(ctx);
  // 사용자 취소는 예산과 무관하게 즉시다. 표면이 이 이음새를 채우면 큐 전체가 그 자리에서 선다.
  const 취소됐나 = () => Boolean(ctx.취소됐나?.() || ctx.abortSignal?.aborted);
  const 쓴것 = () => ({
    왕복쓴것: ctx.왕복수 ?? 0, 되돌릴수있는것쓴것, 그밖쓴것,
    지난ms: nowMs(ctx) - 시작시각, 취소됨: 취소됐나(),
  });
  const 예산사실 = () => ({
    // **모델 방의 사실**이다(계약 ④). 지시가 아니라 남은 양이다 — 어떻게 쓸지는 모델이 정한다.
    turnBudget: {
      왕복쓴것: ctx.왕복수 ?? 0, 왕복예산: 예산.왕복,
      되돌릴수있는것쓴것, 되돌릴수있는것예산: 예산.되돌릴수있는것,
      그밖쓴것, 그밖예산: 예산.그밖,
    },
    ...(가드레일신호(turnReceipts).length ? { guardrailNotes: 가드레일신호(turnReceipts) } : {}),
  });
  // **이번에 실행 중인 호출의 신분.** 계획 경로도 바로 아래 `계약실행`을 지나므로
  // 실행문맥보다 먼저 서야 한다.
  /** @type {{providerCallId?:string, callRef?:string}} */
  let 현재호출신분 = {};
  const 실행문맥 = () => ({
    currentRequest: intent.currentRequest,
    readScopeRoots: [...new Set(turnReceipts.flatMap((rec) => rec.readScopeRoots ?? []))],
    ...현재호출신분,
  });
  // **이번 턴의 화면 증거.** 영수증에는 안 싣는다(세션 파일로 디스크에 남는다) —
  // 여기 모았다가 교환에만 붙이고, 턴이 끝나면 사라진다(CU F-2 · 계획 §6 수명).
  const 이번턴그림 = new Map();
  const 계약실행 = async (toolId, args) => {
    // **열쇠는 영수증 자체다.** `callRef` 는 첫 호출(계획 경로)에는 없어서, 그걸 열쇠로 쓰면
    // 첫 클릭의 화면 증거가 조용히 사라진다(라이브에서 그랬다). 이름을 만들지 않는다 —
    // 손이 낸 그림을 받아 두었다가 **그 호출이 낸 영수증에 그대로 붙인다.**
    let 방금그림 = null;
    const 문맥 = () => ({ ...실행문맥(), 그림받기: (g) => { 방금그림 = g; } });
    const execute = async () => {
      const rec = bindDeliverableReceipt(plan, await ctx.tools.run(toolId, args, selfState, 문맥()));
      if (방금그림 && rec) { 이번턴그림.set(rec, 방금그림); 방금그림 = null; }
      return rec;
    };
    if (toolId !== 'local.file' || !plan.workRef || !plan.completionContract
      || !plan.completionContractRef || !ctx.runCompletionExecution) return execute();
    return ctx.runCompletionExecution({
      turnRef: plan.completionContract.sourceTurnRef,
      turnOrdinal: turnReceipts.length,
      workRef: plan.workRef,
      completionContract: plan.completionContract,
      completionContractRef: plan.completionContractRef,
      execute,
    });
  };
  let sentVia; // P6-11: 승인된 send 실행 사실(도구·대상) — 서버가 TaskTrace로 기록하고 학습 후보를 제안한다.
  // **못 한 호출을 사실로 남기는 자리 — 두 레인이 같이 쓴다.**
  // 예전엔 걸음 루프 안쪽에만 있었다. 그래서 계획 레인이 예산에 걸려 건너뛴 손은 이 어휘를
  // 쓸 수 없었고, 뒤늦게 남기면 **최종 답을 만든 뒤**라 모델에게 못 갔다(2026-08-05 밟음).
  // 사실의 모양을 두 벌로 만들지 않으려면 자리가 여기여야 한다.
  let 호출일련 = 0;
  const 못한호출남기기 = (호출, 왜, 사람말) => {
    const rec = receipt({
      intended: `${toolLabel(호출.tool, selfState)} 실행`,
      actualCall: null,
      제안한호출: {
        tool: 호출.tool, args: 호출.args ?? {},
        ...(호출.providerCallId ? { providerCallId: 호출.providerCallId } : {}),
        callRef: 호출.callId,
      },
      // **어휘를 정확히 쓴다.** 되풀이라 건너뛴 것은 *못 한 일*이 아니라 **런타임이 취소한 것**이고,
      // 같은 일이 이미 원장에 확인돼 있다. 처음엔 전부 `blocked` 로 세웠다가, 그것이 "아직 못 한
      // 일"로 잡혀 승인 재개 정산 게이트를 닫았다(`work-state-product` 가 잡았다, 2026-08-04).
      // 나머지(상한·승인대기·요청밖·없는손)는 실제로 **안 된 일**이므로 blocked 가 맞다 —
      // 사용자가 그 사실을 알아야 한다.
      failureState: 왜 === '되풀이' ? 'cancelled' : 'blocked',
      userSafeSummary: 사람말,
      // 진단면 — 모델이 낸 호출의 신분과 순서를 그대로 보존한다(오너 지시 2026-08-04).
      diagnosticTrace: { callId: 호출.callId, 순번: 호출.순번, tool: 호출.tool, reason: 왜 },
    });
    원장.append(rec);
    turnReceipts.push(rec);
    return rec;
  };


  for (const [순번, toolId] of plan.toolsToUse.entries()) {
    // **세기만 하고 안 보면 없는 것과 같다**(S6-c 9번).
    //
    // 계수기는 예전부터 두 레인이 같은 것을 올렸다(`되돌릴수있는것쓴것`·`그밖쓴것` 은 변수 하나).
    // 그런데 **보는 자리는 걸음 루프에만 있었다**(`while (!예산소진(...))`). 그래서 계획 레인은
    // 상한과 무관하게 `toolsToUse` 를 끝까지 돌았다 — 밟은 사실(2026-08-05):
    // 되돌릴 수 있는 손 예산 **1** 로 두고 손 셋을 내니 **셋 다 돌았다.**
    //
    // 위 주석이 "계획 경로 실행도 예산에 잡힌다"고 적어 둔 것은 **계수**까지였다. 계수는
    // 뒷단(걸음 루프)을 정확하게 만들었지만 이 레인 자신은 멈추지 않았다.
    // P6-7: send류는 분리된 {target, text}로 실행한다(문장 전체를 그대로 보내지 않는다). 그 외엔 요청 원문.
    const args = sendArgs?.[toolId] ?? { request: intent.currentRequest };
    if (예산소진(쓴것(), 예산)) {
      // **버리지 않고 남긴다.** 조용히 건너뛰면 모델은 자기가 시킨 것이 다 됐다고 믿고 답을 쓴다.
      못한호출남기기({ tool: toolId, args, callId: `p${순번 + 1}`, 순번: 순번 + 1,
        ...(계획호출신분?.[toolId]?.providerCallId
          ? { providerCallId: 계획호출신분[toolId].providerCallId } : {}) },
      '예산소진', 소진사유(쓴것(), 예산) ?? '한 번에 할 수 있는 만큼만 하고 나머지는 남겨 뒀어요.');
      continue;
    }
    현재호출신분 = { ...(계획호출신분?.[toolId] ?? {}), callRef: `p${순번 + 1}` };
    await ctx.emit?.('tool_progress', { text: `${toolLabel(toolId, selfState)} 실행 중이에요` }); // P6-12: 진행 상태(사고 원문 아님)
    const rec = await 계약실행(toolId, args);
    현실다시();
    // **계획 경로 실행도 예산에 잡힌다.** 걸음 루프에만 계수기를 달았더니 뒷단이 하나씩
    // 헐거워졌다(실측: 그밖 예산 2인데 3번 돌았다) — 왕복에서 겪은 것과 같은 병이다.
    if (되돌릴수있나(toolId)) 되돌릴수있는것쓴것 += 1; else 그밖쓴것 += 1;
    원장.append(rec);
    turnReceipts.push(rec);
    // 출처가 있으면 근거 추가를 알린다(evidence_added) — 웹 도구가 "확인했다"의 근거를 남긴 순간.
    if (rec.sources?.length) await ctx.emit?.('evidence_added', { count: rec.sources.length });
    await 확인된중간결과(ctx, rec, ledger);
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
      // 연결·권한이 없어 손이 안 선 자리다 — 사다리의 "준비되지 않았어요"가 사실이다.
      { tool: toolId, reason: 'not_executable' },
    );
    원장.append(rec);
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

  let steps = 0;      // 실제로 실행한 도구 걸음
  // **지금 있는 손**을 사다리에 함께 준다. 계단은 도구 종류만 보고 정할 수 없다 —
  // "다른 손으로 이어서 볼게요"는 그 손이 실제로 있을 때만 참이다(없으면 거짓 약속이 된다).
  // **복구 안내도 지금 손을 본다.** 한 번 계산해 두면 뒤 걸음에서 손이 늘거나 줄어도
  // "다음 길"이 옛 목록으로 안내한다 — 이미 붙은 손을 못 쓴다고 하거나 내린 손을 권한다.
  // `refreshRuntimeReality` 가 만든 현재 selfState 에서 매번 뽑는다(같은 현실의 투영본).
  const 있는손 = () => selfState.connectedTools.filter((t) => t.status === 'usable').map((t) => t.id);
  // **어느 손이 같은 것을 보는가** — 축(`보는것`)은 descriptor 가 선언하고 커널은 비교만 한다.
  // 커널이 손 목록을 직접 읽지 않는다(층 역전 금지) — selfState 가 든 것을 그대로 쓴다.
  const 손설명 = () => selfState.connectedTools.filter((t) => t.status === 'usable');
  // 출처가 **계약인** 손 — descriptor 가 선언한 사실 그대로. 답 검사가 "확인했다" 주장을
  // 이 사실로 판정한다(문구 규칙이 아니라 계약 한 줄).
  const 출처계약손목록 = () => selfState.connectedTools.filter((t) => t.sourceLedgerRequired).map((t) => t.id);
  const ladder = nextRung(turnReceipts, 있는손());
  // 이번 턴에 **실제로 한 일**을 상태에 얹는다(모델 추정이 아니라 영수증 기록만).
  // receipt 가 진실이다 — workingState 는 여기서 파생되는 얇은 뷰다(별도 저장소 아님).
  let workingState = 이어받기정리(deriveWorkingState(ctx.workingState, {
    places: await 볼수있는자리(ctx),
    receipts: turnReceipts,
    blocked: ladder ? rungMessage(ladder) : undefined,
  }), ctx.connectors);
  let tc = buildTaskContext({
    processEnv: ctx.processEnv,
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
    externalReality: ctx.externalReality, externalRealityDelta: ctx.externalRealityDelta,
    intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted, admittedRich: ctx.admittedRich, automationProposal: ctx.automationProposal,
    surface: ctx.surface,
    recentTurns: ctx.recentTurns, priorExchange: ctx.priorExchange, nativeSearch: Boolean(ctx.modelSupportsSearch),
    modelProviderId: ctx.modelProviderId, workingState, projectWorkState: ctx.projectWorkState,
    ...예산사실(),
    // 막힌 게 있으면 **다음에 무엇을 하면 되는지**를 사실로 준다(막다른 답 금지).
    // **도구가 남긴 말이 먼저다.** 도구는 자기가 왜 막혔는지 정확히 안다("제가 다루는 폴더 안에서
    // 못 찾았어요"). 사다리는 도구 종류를 모르는 일반 폴백이라, 앞세우면 파일 실패에 웹 문구가
    // 나간다 — 실측: 원장엔 정확한 문장이 있었는데 사다리가 덮어써서 모델이 터미널 명령을 시켰다.
    recoveryHint: 다음길(turnReceipts, 있는손(), 손설명()),
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
      tools: modelSchemasFor(selfState, ctx.modelControls),
    });
  // ── P6-L · 한 턴 안에서 손을 이어 쓴다 ────────────────────────────────
  // 예전엔 여기서 `finalOut.toolCalls` 를 **버렸다.** 그래서 모델이 다음 걸음을 정확히 알고도
  // 걷지 못했다 — 실측: "package.json 존재만 확인됐고, 실제 테스트 명령은 아직 실행되지
  // 않았습니다"라고 답하며 사용자에게 `npm test` 를 대신 치라고 했다. 게을러서가 아니라
  // **손이 한 번밖에 안 나갔다.** 찾기→확인→실행이 말로 끊기는 자리가 여기였다.
  //
  // 새 안전 체계를 만들지 않는다. 걸음마다 기존 판정을 그대로 탄다:
  // toolActionKind → decideAutoGrant. 승인이 필요하면 **실행하지 않고 멈춘다.**
  // 왕복 수는 `runTurn` 의 계수 래퍼가 ctx 에 쌓는다 — 여기서 따로 세지 않는다(두 진실 금지).

  let 멈춘이유;
  // ActionPlan 의 결과 형태와 실제 실행 영수증을 한 자리에서 대조한다. 다른 도구가 우연히
  // 남긴 digest 는 파일 산출물이 아니며, local.file write 의 path+digest 만 충족으로 센다.
  const 산출물미충족 = () => unsatisfiedDeliverables(plan, turnReceipts).length > 0;
  let 산출물요청수 = 0;
  // ── **`남은정리이어가기` 를 걷었다** (오너 판단 2026-08-04) ────────────────────
  //
  // 여기에 "원본 자리에 파일이 남아 있으면 모델을 다시 불러 계속 옮기게 한다"는 루프가 있었다.
  // 걷는 이유는 셋이다.
  //
  // ① **동결서에 그런 기준이 없다.** §5.2 성공 조건은 "실제 이동 발생 · 같은 계획 반복 0 ·
  //    거짓 완료 0 · 보고가 실물과 일치(옮긴 수·남은 수) · 다음 턴 승계"다. "루트에 파일 0개"는
  //    나중에 만들어 넣은 기준이었다.
  // ② **그건 사람이 하는 파일 정리가 아니다.** 실측(회차 6): 모델은 1턴에서 정리 안을 셋 내고
  //    "편한 번호 골라줘"라고 되물었다 — 그게 옳은 행동이다. 백지 위임("응, 그렇게 해줘")을
  //    받았으니 자기 기준을 세운 것이고, 남긴 57개는 `.hwp`·`.mp4`·확장자 없음처럼
  //    **함부로 분류하면 안 되는 것들**이었다. 안 건드린 게 맞는 판단이다.
  // ③ 자동성 헌장은 *되돌릴 수 있으면 자동*이지 *끝까지 밀어붙여라*가 아니다. 런타임이
  //    "더 해라"를 반복하면 그게 다시 주객전도다(계약 ①).
  //
  // 이번 라이브의 진짜 결함은 "57개를 안 옮겼다"가 아니라 **"57개가 남았다고 말하지 않았다"**
  // 였다. 그건 실행을 밀어붙여 고칠 일이 아니라 **남은 수를 사실로 손에 쥐여 주면** 닫힌다 —
  // `compactResult` 의 묶음 이동 요약에 `남은자리말` 을 실었다(같은 날).
  const 산출물이어가기 = async () => {
    if (!산출물미충족() || 예산소진(쓴것(), 예산) || 산출물요청수 >= MAX_TOOL_STEPS) return false;
    const derived = (plan.deliverables ?? []).some((wanted) => wanted.binding === 'derived');
    // ActionPlan 이 요구한 것은 파일 손 일반이 아니라 **성공한 write 영수증**이다. 같은 전체
    // 스키마를 다시 주면 모델이 방금 끝낸 versions/read 를 되풀이한다. 작업 종류만 계약과
    // 맞추고, 경로·내용·원본 선택은 모델에 남긴다.
    const fileTools = fileWriteTools(selfState, ctx.modelControls, { derived });
    if (!fileTools.length) { 멈춘이유 = '파일 결과물을 남길 손이 없어 멈췄어요'; return false; }
    산출물요청수 += 1;
    // **강제하지 않는다.** `requiredTool` 은 모델에게서 "안 한다"는 선택지를 뺏는다 —
    // 그러면 낼 것이 없을 때 억지로 무언가를 만들어 낸다(실측: 쓰레기 로그 파일).
    // 계약이 덜 찼다는 **사실**(`unmetDeliverable`)을 주고 고르는 것은 모델에 남긴다.
    finalOut = await ctx.model.respond({ ...tc, unmetDeliverable: true }, {
      onDelta: ctx.onAnswerDelta, search: wantedWeb, effort: 'medium', tools: fileTools,
    });
    if (typeof finalOut === 'string' || !finalOut?.toolCalls?.length) {
      멈춘이유 = '파일 결과물 실행을 고르지 않아 멈췄어요';
      return false;
    }
    // **모델이 같은 것을 다시 내면 멈춘다.** 이건 판단이 아니라 기계 사실이다 —
    // 이미 이 턴에서 돈 지문을 그대로 다시 냈다는 것은 모델이 낼 것이 없다는 뜻이다.
    //
    // 라이브 실측(2026-08-04, 재봉인 관통): 정리 요청에 FILE 계약이 서자 이 이어가기가
    // `unmetDeliverable` 을 계속 밀었고, 모델은 **같은 `.log` bulk_move 를 여덟 번** 냈다.
    // 중복 차단이 매번 막아 실물은 안전했지만 왕복 8개와 원장 8줄이 그냥 탔고, 그 턴의
    // 이동은 261 에서 멈췄다(같은 문장·다른 턴에서 367). 밀어붙이는 것이 진전을 만들지 않았다.
    //
    // 계약 문장을 바꾸는 게 아니다 — 계약은 그대로 미충족으로 남고, 출구 검증이 그 사실을
    // 원장으로 말한다. 여기서 그만두는 것은 **없는 진전을 짜내지 않는 것**뿐이다.
    if (finalOut.toolCalls.every((c) => rung.has(지문of(c?.name, c?.args ?? {})))) {
      멈춘이유 = '이미 한 것과 같은 실행만 남아 멈췄어요';
      return false;
    }
    return true;
  };
  // ── 모델이 낸 호출은 **하나도 합치지 않고 하나도 버리지 않는다** ─────────────
  //
  // S1 실모델 실측(2026-08-04, 회차 6): 모델이 한 응답에 `local.file move` 를 다섯 개 냈는데
  // 옮겨진 것은 **마지막 하나뿐**이었다. `callsToIntentParts` 가 같은 손의 호출들을
  // `{...기존, ...새것}` 으로 합쳐 뒤가 이겼고, 여기서 `neededTools[0]` 하나만 집었기 때문이다.
  // 나머지 넷은 실행도, 실패도, 고지도 없었다 — **모델도 사용자도 그 사실을 못 받는다.**
  //
  // 그래서 T5 의 실행 입자는 "한 걸음 = 한 파일"이 아니라 **"한 왕복 = 한 호출"** 이었다.
  // 걸음 상한과 곱하면 한 턴에 최대 6개다. 437개 앞에서 구조적으로 불가능한데
  // 그 불가능이 어디에도 안 보였다.
  //
  // 이것은 형식 문제가 아니라 **모델 주권 계약의 본체**다(오너 2026-08-04). 계약 ②는
  // "모든 도구 결과는 모델 자신의 행동 이력으로 돌아간다"인데, 돌아갈 행동 자체가 없어졌다.
  //
  // 고친 방식: 합치지 않고 **줄로 세운다.** 줄에 선 호출 하나하나가 기존 판정 경로를
  // 그대로 탄다(probe → toolActionKind → decideAutoGrant → 승인 봉인 → 실행 → 영수증).
  // **새 안전 체계를 만들지 않는다.** 그리고 실행하지 못한 호출도 `callId`·순번·판정·이유와
  // 함께 원장에 남아 모델에게 돌아간다 — 조용한 축소를 없앤다.
  /** @type {Array<{callId:string, 순번:number, tool:string, args:object}>} */
  const 대기호출 = [];

  /**
   * **고르기는 했는데 실행하지 못한 호출**을 사실로 남긴다.
   *
   * 여기가 이 수정의 절반이다. 실행을 여는 것만으로는 부족하다 — 상한·중복·권한·없는 손으로
   * 못 한 것이 조용히 사라지면, 모델은 자기가 다섯을 시켰다고 믿은 채 답을 쓴다(거짓 완료의
   * 씨앗). `actualCall` 을 채워 두므로 모델 입력에서 **자기 호출**로 돌아간다.
   *
   * 값은 담지 않는다 — 실행되지 않았으므로 결과가 없다. `왜` 는 분류값이고 사람 말은 따로 온다.
   *
   * **`actualCall` 이 아니라 `제안한호출` 이다.** 첫 판은 여기에 `actualCall` 을 채웠다 —
   * 그래야 모델이 자기 호출을 돌려받기 때문이었다. 그런데 계약은 *"호출 안 했으면 null"* 이고,
   * 부르지 않은 것을 "실제 호출"로 적으면 **원장이 거짓**이 된다. 필요했던 것은 이 칸이 아니라
   * **다른 칸**이었다. 어휘는 이미 있었다 — `task-context` 가 실패한 호출의 인자를
   * `attemptedWith`("확인된 사실 아님")로 싣는다. 같은 구분을 영수증에도 세운다.
   */
  /** 모델 응답의 호출들을 줄로 세운다. 안 보여준 도구는 버리되 **버린 사실을 남긴다**. */
  const 줄세우기 = (calls) => {
    const 선것 = [];
    for (const call of calls) {
      호출일련 += 1;
      // **T5 내부 상관용 신분.** 공급자 id 로 덮지 않는다 — 둘은 서로 다른 것이고,
      // 섞으면 "모델이 낸 신분"이라는 말이 검증 불가능한 주장이 된다.
      const callId = `걸음${호출일련}`;
      // 1축 그대로: 우리가 실제로 보여준 도구만 받아들인다(selfState 파생 — 수동 맵 없음).
      const parts = callsToIntentParts([call], selfState);
      const id = parts.neededTools?.[0];
      if (!id) {
        // 예전엔 여기서 조용히 사라졌다. 이제 모델이 자기가 없는 손을 골랐다는 것을 안다.
        못한호출남기기({ callId, 순번: 호출일련, tool: String(call?.name ?? '(이름 없음)'), args: call?.args ?? {} },
          '없는손', '그 손은 지금 없어요.');
        continue;
      }
      선것.push({
        callId, 순번: 호출일련, tool: id, args: parts.toolArgs?.[id] ?? {},
        // 공급자가 발급한 신분은 **있을 때만** 나른다. 없으면 칸을 만들지 않는다.
        ...(call?.providerCallId ? { providerCallId: call.providerCallId } : {}),
      });
    }
    return 선것;
  };

  // 이번 발화가 가리킨 자리 — 계획 경로와 **같은 기준**으로 판정한다(두 진실 금지).
  const 이번발화 = parseFileRequest(requestText ?? '');

  // 첫 응답에서 계획이 안 가져간 호출들을 **맨 앞에** 세운다 — 모델이 낸 순서 그대로다.
  /**
   * **남은 줄을 사실로 거둔다 — 원장에도, 다음 턴이 이어받을 상태에도.**
   *
   * 두 자리에서 부른다: 예산이 **루프 안에서** 닿았을 때(그래야 모델이 마지막 답을 쓰기 전에
   * 무엇을 못 했는지 안다), 그리고 루프가 끝난 뒤 남은 것이 있을 때.
   *
   * 처음엔 루프 안에서 `못한호출남기기` 만 불렀다가 **상태 갱신을 빠뜨렸다**(2026-08-05).
   * 회귀가 잡았다 — *"중간에 멈춘 사실이 현재 상태에서 사라졌다."* 원장에만 남기면
   * `workingState` 는 마지막 성공 시점의 사진이라 "다 됐다"로 읽히고, 다음 턴이 이어받을
   * 자리를 잃는다(구속 계약 ②). 뒷정리가 두 벌이면 한쪽이 반드시 얇아진다 — 그래서 한 벌이다.
   */
  const 남은줄거두기 = () => {
    if (!대기호출.length) return;
    const 말 = 소진사유(쓴것(), 예산) ?? '한 번에 할 수 있는 만큼만 하고 나머지는 남겨 뒀어요.';
    const 남긴것 = 대기호출.splice(0).map((남은) => 못한호출남기기(남은, '예산소진', 말));
    workingState = 이어받기정리(deriveWorkingState(workingState, {
      receipts: 남긴것, withinTurn: true,
      blocked: 걸음막힘(남긴것[0], turnReceipts, 있는손()),
    }), ctx.connectors);
  };

  대기호출.push(...줄세우기(첫응답나머지));

  while (!예산소진(쓴것(), 예산)) {
    if (!대기호출.length) {
      // 걸음도 같은 분리 경계를 지난다 — 통제 호출은 걸음이 아니다(실행·승인·원장에 안 탄다).
      // executePlan 은 결과를 직접 못 돌려주므로 ctx 로 실어 나른다.
      const 분리 = splitModelControlCalls(typeof finalOut === 'string' ? [] : (finalOut?.toolCalls ?? []));
      ctx.collectWorkState?.(분리);
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
      대기호출.push(...줄세우기(next));
      if (!대기호출.length) break; // 고른 것이 전부 없는 손이었다(사실은 위에서 남겼다)
    }

    const 이번 = 대기호출.shift();
    const toolId = 이번.tool;
    const rawArgs = Object.keys(이번.args).length ? 이번.args : { request: intent.currentRequest };
    const args = toolId === 'local.file'
      ? runtimeFileArgs(rawArgs, requestText, ctx.tools?.tools?.['local.file']?.scopeRoots)
      : rawArgs;

    const 지문 = 지문of(toolId, args);
    // **이월 행동은 자동으로 실행하지 않는다** — 지난 턴에 못 끝낸 일이 지금 발화에 섞여
    // 조용히 도는 것을 막는다. 버리지 않고 아래 승인 경계로 올린다(카드에 그대로 실린다).
    const 이번이월 = 이월된것.has(지문) || 이월된것.has(지문of(toolId, 이번.args));
    // 같은 손을 같은 인자로 두 번 쓰지 않는다 — 결과가 마음에 안 든다고 반복하면 제자리를 돈다.
    if (rung.has(지문)) {
      // **줄에 아직 남은 것이 있으면 이 하나만 건너뛴다.** 예전엔 여기서 턴을 통째로 멈췄는데,
      // 그건 호출이 하나뿐이던 시절의 계약이다. 다섯 중 하나가 중복이라고 나머지 넷을
      // 버리면 그게 바로 이번에 없앤 그 병이다. 건너뛴 사실은 남는다.
      못한호출남기기({ ...이번, args }, '되풀이', '방금 한 것과 같은 일이라 다시 하지 않았어요.');
      if (대기호출.length) continue;
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
      원장.append(rec);
      turnReceipts.push(rec);
      steps += 1;
      // F6.1: 같은 사용자 턴 안의 파생이다 — turnNo 를 늙게 하지 않는다.
      // F6.2: 이 걸음은 막혔다 — 그 사실과 다음 길이 상태에 남아야 다음 턴이 이어받는다.
      workingState = 이어받기정리(deriveWorkingState(workingState, {
        receipts: [rec], withinTurn: true, blocked: 걸음막힘(rec, turnReceipts, 있는손()),
      }), ctx.connectors);
      tc = buildTaskContext({
        processEnv: ctx.processEnv,
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
        externalReality: ctx.externalReality, externalRealityDelta: ctx.externalRealityDelta,
        intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted, admittedRich: ctx.admittedRich, automationProposal: ctx.automationProposal, 이번턴그림,
        surface: ctx.surface, recentTurns: ctx.recentTurns, priorExchange: ctx.priorExchange,
        nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
        workingState, projectWorkState: ctx.projectWorkState,
        recoveryHint: 다음길(turnReceipts, 있는손(), 손설명()),
        ...예산사실(),
        ...(ctx.selfhood ?? {}),
      });
      // **줄이 남았으면 모델을 다시 부르지 않는다.** 모델은 이미 다음에 할 것을 골라 놨다 —
      // 여기서 되물으면 왕복 하나를 쓰고 그 사이 골라 둔 호출이 이번 응답에 덮인다.
      if (!대기호출.length) {
        finalOut = await ctx.model.respond(tc, {
          onDelta: ctx.onAnswerDelta, search: wantedWeb, effort: 'medium',
          ...(예산소진(쓴것(), 예산) ? {} : { tools: modelSchemasFor(selfState, ctx.modelControls) }),
        });
      }
      continue;
    }

    // ── **실행 경계**(S6-a) — 판정은 한 자리에서 한다 ──────────────────────────
    // 여기 인라인으로 있던 것을 `tool-boundary.js` 로 **글자 그대로** 옮겼다.
    // 계획 경로가 같은 자리로 들어오는 것은 S6-b 다 — 그때 **두 벌이 한 벌이 된다.**
    // 훅은 판정만 돌려준다. 승인·되묻기로 **턴을 끝내는 것은 아래 루프의 일**이다.
    const { 판정인자: 경계인자, kind, 판정행동 } = await 실행전판정({
      toolId, args, selfState, tools: ctx.tools, 이번이월, 이번발화,
    });
    let 판정인자 = 경계인자;
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
        // 줄에 남은 호출은 이번 턴에 못 걷는다 — **사실로 남기고 나간다**(조용히 증발 금지).
        for (const 남은 of 대기호출.splice(0)) {
          못한호출남기기(남은, '되묻기중단', '먼저 확인할 게 있어 이건 아직 안 했어요.');
        }
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
    // ── **면제는 승인 분기 앞에서 본다**(S6-b · F-20) ──────────────────────────
    // 뒤에서 `needsApproval` 만 비우면 **호출이 조용히 증발한다**(밟아서 확인) —
    // 이 분기에 들어간 뒤 카드를 못 만들면 `멈춘이유` 를 세우고 루프를 빠져나가기 때문이다.
    // 면제는 **애초에 안 들어가게** 하는 것이고, 그래야 계획 경로와 같은 결과가 된다.
    const 면제 = 승인면제({
      toolId, 판정인자,
      허락한손: ctx.허락한손,
      허락한걸음: ctx.허락한걸음,
      knownCounterparts: ctx.knownCounterparts,
      전송인가: isSendTool(toolId, selfState),
      // **게이트는 면제 대상이 아니다** — 이월·발화밖은 "현재 요청 침해"의 자리다.
      이번이월, 발화밖: 발화밖파괴({ kind, 대상: args?.path ?? args?.target }, 이번발화),
      // 되돌릴 수 없는 것은 손 면제가 덮지 않는다(헌장 ②). 손 선언이 유일한 진실이다.
      되돌릴수있나: 판정행동.revocable,
    });
    if (!면제.면제 && !decideAutoGrant(판정행동)) {
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
      // **경계가 내린 판정을 계획에 사실로 싣는다 — 여기서 다시 판정하지 않는다**(S6-c 3번).
      //
      // 밟은 사실(2026-08-05): 사용자가 `보고서.md 읽어줘` 라고 했는데 모델이
      // `전혀다른것.csv` **삭제**를 골랐다. 경계는 정확히 판정했다 —
      // `{kind:'delete', revocable:true, needsApproval:true}`(발화 밖 파괴). 그런데 여기서
      // `buildActionPlan` 이 **손 선언만 보고 처음부터 다시 판정해** "자동"이라 답했고,
      // `grants` 가 비어 아래 `break` 로 갔다. 결과: **카드도 실행도 원장도 없고 모델도 모른다.**
      // 게이트는 안 뚫렸지만(아무것도 실행 안 됨) 걸음이 조용히 사라졌다 — 이 파일이
      // 곳곳에서 싸우는 그 병이다("예전엔 여기서 조용히 사라졌다").
      //
      // 판정을 한 벌로 두는 방법은 **다시 재지 않는 것**이다. 경계가 세운 사실
      // (이월·발화밖·손 선언이 합쳐진 `needsApproval`)을 그대로 넘긴다.
      const 걸음selfState = 판정행동.needsApproval
        ? { ...selfState,
          connectedTools: (selfState.connectedTools ?? []).map(
            (t) => (t.id === toolId ? { ...t, needsApproval: true } : t),
          ) }
        : selfState;
      const 걸음plan = buildActionPlan({ intent: 걸음intent, selfState: 걸음selfState });
      // **카드에 누구에게·무엇을을 못 박는다** — 계획 경로와 같은 자리(S6-c 4번).
      if (isSendTool(toolId, selfState)) {
        for (const g of 걸음plan.needsApproval ?? []) {
          if (g.action === toolId) 전송카드확정(g, 판정인자);
        }
      }
      if (plan.workRef && plan.completionContract && plan.completionContractRef) {
        걸음plan.workRef = plan.workRef;
        걸음plan.completionContract = structuredClone(plan.completionContract);
        걸음plan.completionContractRef = plan.completionContractRef;
      }
      // **면제는 위에서 이미 봤다 — 여기서 다시 재지 않는다**(F-34 · 2026-08-05).
      //
      // 예전엔 여기서 `ctx.허락한손.has(toolId)` 로 grants 를 비웠다. 그런데 `승인면제` 는
      // 같은 질문에 **다른 답**을 낸다(손 면제는 `되돌릴수있나 === true` 일 때만 준다).
      // 두 벌이 어긋나면 걸음이 그 사이로 빠진다 — 면제를 못 받고 승인 분기에 들어왔는데
      // 여기서 grants 가 비어 **카드도 못 만들고 죽는다.** 라이브에서 사용자가 `7 누르기` 를
      // 승인하고도 *"승인이 한 번 더 필요합니다"* 를 들은 자리가 정확히 여기다.
      //
      // 그리고 이 지름길에는 구멍이 있었다 — **같은 손이면 대상이 바뀌어도 열렸다.**
      // `rm -rf ./임시` 를 승인한 뒤 `rm -rf /전혀다른곳` 이 실행된 그 사고가 이 모양이고,
      // 계획 경로는 `승인면제` 가 막는데 걸음 경로만 안 막고 있었다. 지우면 함께 닫힌다.
      const grants = 걸음plan.needsApproval ?? [];
      if (grants.length) {
        const pendingId = ctx.newId ? ctx.newId() : `p${(ctx._seq = (ctx._seq ?? 0) + 1)}`;
        이전대기를지난것으로(ctx);
        ctx.pending.set(pendingId, {
          intent: 걸음intent, plan: 걸음plan, admitted,
          ...ctx.workStateSnapshot?.(),
          sourceInputText: ctx.workStateSourceText,
          workRef: ctx.workRef ?? null,
          // **판정한 인자를 그대로 실행 인자로 봉인한다.** executePlan 은 실행할 때 `sendArgs`
          // 에서 인자를 꺼낸다(570줄) — 여기에 안 실으면 승인 뒤 `{request: 발화원문}` 으로
          // 실행돼 엉뚱한 일이 된다. 판정과 실행이 **같은 인자**를 봐야 한다(두 진실 금지).
          sendArgs: { ...(sendArgs ?? {}), [toolId]: 판정인자 },
          // 승인 뒤 실행도 **같은 신분**으로 간다 — 사용자가 승인한 그 호출이라는 사실이
          // 원장과 모델 이력에서 끊기지 않는다.
          호출신분: { ...계획호출신분, ...(이번.providerCallId ? { [toolId]: { providerCallId: 이번.providerCallId } } : {}) },
          askedFrom: ctx.askedFrom,
          // 지금까지 이 요청에서 허락받은 손 — 승인 뒤에도 이어져야 같은 질문을 안 한다.
          허락한손: [...(ctx.허락한손 ?? []), toolId],
          허락한걸음: [...(ctx.허락한걸음 ?? []), 걸음신분({ toolId, 판정인자 })],
          // **여기까지 실제로 한 걸음을 봉인한다**(라이브 2026-08-06 · 오너의 ④).
          //
          // 카드에서 턴이 쪼개지면 재개 턴은 **빈 손으로** 시작한다. 그래서 T5 는 카톡에
          // 글자를 넣고 승인받아 실제로 보내 놓고도 마지막 답에서 *"메시지를 보내는 기능은
          // 지금은 쓸 수 없는 상태"* 라고 했다 — 재개 턴의 교환이 **1개**였고 앞 걸음이
          // 사라져 있었다. 모델은 자기 눈에 보이는 것만으로 답을 쓴다(A14 의 거울상).
          // 계획 단계의 `앞선막힘` 과 **같은 통로**다.
          이미한걸음: [...turnReceipts],
          grantScope: { kind: 'once', expiresAt: nowMs(ctx) + APPROVAL_TTL_MS },
        });
        // **여기까지 한 일을 버리지 않는다.** 모델이 도구를 고르며 이미 한 말이 있으면 그게
        // 사용자 말이다(64a7634). 없으면 원장의 사실로 만든다 — 빈 카드만 뜨면 먹통으로 보인다.
        const 지금까지 = (typeof finalOut === 'string' ? '' : finalOut?.text ?? '').trim();
        // 승인 카드로 나가면서 줄에 남은 호출을 버리지 않는다. 사용자가 승인할 것은 이 하나이고,
        // 나머지는 **못 한 일**로 원장에 남아 다음 턴이 이어받는다.
        for (const 남은 of 대기호출.splice(0)) {
          못한호출남기기(남은, '승인대기중단', '먼저 확인을 받아야 해서 이건 아직 안 했어요.');
        }
        return {
          kind: 'approval',
          pendingId,
          ...(지금까지 ? { reply: 지금까지 } : {}),
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
    현재호출신분 = {
      ...(이번.providerCallId ? { providerCallId: 이번.providerCallId } : {}),
      callRef: 이번.callId,
    };
    const rec = await 계약실행(toolId, 판정인자);
    현실다시();
    원장.append(rec);          // 모든 걸음이 원장에 남는다
    turnReceipts.push(rec);
    await 확인된중간결과(ctx, rec, ledger);
    steps += 1;
    if (되돌릴수있나(toolId)) 되돌릴수있는것쓴것 += 1; else 그밖쓴것 += 1;

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
    // **예산이 여기서 닿았으면 남은 줄을 지금 거둔다**(S6-c 9번).
    //
    // 자리가 이 줄들 **사이**인 이유가 둘이다. 위 갱신보다 뒤여야 한다 — 성공 걸음은 막힘을
    // 푸는 계약이라, 먼저 거두면 방금 세운 "남은 게 있다"를 그 성공이 지운다(회귀가 잡았다).
    // 그리고 아래 재료 조립보다 앞이어야 한다 — 그래야 **모델이 마지막 답을 쓰기 전에**
    // 무엇을 못 했는지 안다. 예전엔 루프 밖에서 거둬 원장·화면에는 남았지만 모델은 몰랐고,
    // 셋 중 둘만 돌고서 "했어요."라고 답했다(밟은 사실 2026-08-05).
    if (예산소진(쓴것(), 예산) && 대기호출.length) 남은줄거두기();
    tc = buildTaskContext({
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
      externalReality: ctx.externalReality, externalRealityDelta: ctx.externalRealityDelta,
      intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted, admittedRich: ctx.admittedRich, automationProposal: ctx.automationProposal, 이번턴그림,
      surface: ctx.surface, recentTurns: ctx.recentTurns, priorExchange: ctx.priorExchange,
      nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
      workingState, projectWorkState: ctx.projectWorkState,
      recoveryHint: 다음길(turnReceipts, 있는손(), 손설명()),
      ...예산사실(), // 남았으면 남았다는 사실(H08 실측) — 이제 두 축 다 준다
      // **손을 조용히 거두면 모델은 "손이 없다"로 읽는다.** 실측(오너 라이브 2026-07-28):
      // "t5demo-idle 꺼줘" 에서 T5 가 대상을 정확히 찾아 놓고 **"터미널 손이 열리지 않아
      // 제가 직접 끄지는 못했어요 — 터미널에서 kill 4356 실행하면 됩니다"** 라고 답했다.
      // 터미널은 있었다. 같은 턴에 실제로 돌기까지 했다. 상한에 닿아 손을 뺐을 뿐이다.
      // 같은 실패가 깃허브에서도 났다("저장소 목록 도구가 안 떠 있어").
      //
      // 없앤 것과 이번 턴에 못 쓰는 것은 다른 사실이다. 그 차이를 안 주면 모델은 빈칸을
      // "능력 없음"으로 메우고, 그 다음 문장은 늘 사용자에게 떠넘기는 말이 된다.
      ...(예산소진(쓴것(), 예산) ? { toolBudgetSpent: true } : {}),
      ...(ctx.selfhood ?? {}),
    });
    // **줄에 남은 것을 먼저 다 걷는다.** 모델이 한 응답에 다섯을 냈으면 다섯을 다 하고 묻는다 —
    // 하나 하고 되물으면 왕복 다섯 번이 되고, 그게 437개 앞에서 상한 6과 곱해져 벽이 됐다.
    if (!대기호출.length) {
      finalOut = await ctx.model.respond(tc, {
        onDelta: ctx.onAnswerDelta, search: wantedWeb, effort: 'medium',
        // 상한에 닿았으면 손을 거둔다 — 더 고를 수 없으니 지금까지의 사실로 답하게 된다.
        ...(예산소진(쓴것(), 예산) ? {} : { tools: modelSchemasFor(selfState, ctx.modelControls) }),
      });
    }
  }
  // 상한에 닿아 줄에 남은 것이 있으면 **그것도 사실로 남긴다**(조용한 축소 금지).
  // **예산 소진은 취소가 아니다**(오너 구속 계약 ②). 못 한 일은 `blocked` 로 남아
  // `unconfirmed` 와 working state 에 그대로 선다 — `cancelled` 로 두면 "이미 된 일"과 같은
  // 자리에 들어가 미완료가 사라진다. 새 enum 을 열지 않고 기존 어휘를 그대로 쓴다.
  const 소진말 = 소진사유(쓴것(), 예산) ?? '한 번에 할 수 있는 만큼만 하고 나머지는 남겨 뒀어요.';
  남은줄거두기();
  // 상한·승인·되풀이로 멈췄으면 **여기까지 한 일과 다음 할 일**을 정직하게 말하게 한다.
  if (예산소진(쓴것(), 예산) && !멈춘이유) 멈춘이유 = 소진사유(쓴것(), 예산) ?? '한 번에 할 수 있는 만큼 하고 멈췄어요';
  // 산출물 의무 미이행은 완료가 아니다 — 계획과 원장(영수증)의 불일치가 기계 사실이다.
  if (!멈춘이유 && 산출물미충족()) {
    멈춘이유 = '만들기로 한 파일 산출물이 아직 만들어지지 않았어요';
  }

  let reply = userFacingModelText(typeof finalOut === 'string' ? finalOut : finalOut?.text ?? '');
  if (멈춘이유 && !reply.trim()) reply = '';
  // 도구를 빼고 한 번 더 묻는 자리 — **빠른 경로와 같은 계약을 쓴다**(`답완성`).
  // 손은 다시 쥐여 주지 않고 `answerOnly` 사실을 준다. 실제로 도구 예산을 다 쓴 것이 아닌데
  // 소진했다고 말하면 모델이 "손이 없다"는 거짓 상태를 사용자에게 설명한다.
  reply = await 답완성({ reply, tc, ctx, search: wantedWeb, receipts: turnReceipts, 출처계약손: 출처계약손목록() });
  // **답을 대필하지 않는다.** 한때 여기서 `/끝냈|완료|끝났|다 했/` 을 잡아 "부분 완료입니다…"를
  // 앞에 붙였다. 문구 판정은 다음 문장에서 또 새고(§4-6), 무엇보다 최종 답은 모델의 것이다
  // (동결 §5.2 과정 ⑥ — 템플릿 대필 0). 남은 수는 이미 원장·`unfinishedFileOrganization`·
  // `멈춘이유` 로 모델 앞에 있다. 그걸 보고도 "끝냈다"고 하면 그건 답의 문제가 아니라
  // **사실 공급의 문제**이므로 그 자리에서 고친다.
  // 계열 ④: 도중에 화면으로 나간 말(도구를 고르며 한 말 포함)을 버리지 않는다 — 답이 화면을 따라온다.
  reply = 미리보기정렬(reply, ctx.미리보기);
  // H09 P0 는 화면 정렬보다 세다: 스트리밍으로 이미 나간 거짓 서술을 정렬이 되살리면, 지속되는
  // 답에서만큼은 원장의 정직한 사실이 이긴다(나간 조각 보존 계약의 유일한 예외 — 거짓 성공).
  const 거짓성공정렬후 = 읽은척차단(turnReceipts, reply, { 출처계약손: 출처계약손목록() });
  if (거짓성공정렬후?.blocked) reply = 거짓성공정렬후.정직한답;

  // ── **출구 검증**(정본 §S5 H08 재개봉) ────────────────────────────────────
  //
  // 모델이 완료를 주장하면 원장과 대조하고, 어긋나면 **사용자에게 보내지 않고 모델에게
  // 돌려준다.** 중간에서 강제하면 낼 것이 없을 때 억지로 무언가를 만들어 낸다(쓰레기 로그
  // 파일, 실측 2026-08-03) — 그래서 강제는 걷고 검증만 출구로 옮겼다.
  //
  // **대필이 아니다.** 사실만 주고 무엇을 말할지는 모델이 정한다. 한 턴에 한 번만 준다 —
  // 두 번 되돌리면 왕복이 무한이 되고 그 비용은 사용자가 문다.
  const unresolvedReceipts = unresolvedTurnReceipts(turnReceipts);
  const projection = projectReceipts(unresolvedReceipts);

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
    nextSafeAction: projection.unconfirmed.length ? finalNextSafeAction(unresolvedReceipts, 있는손()) : undefined,
    // 현재 목표 유지(P6-1): 서버가 session.activeGoal 로 지속해 세션 간 좁게 복원한다.
    // **끝났으면 명시적으로 해제한다.** 안 그러면 끝난 일이 계속 "현재 목표"로 남아
    // 다음 턴을 붙든다(실측: activeGoal 이 새 발화로 덮여 런타임이 "진행 중"처럼 말했다).
    goal: 완료 ? null : { understoodTask: plan.understoodTask, successCriteria: plan.successCriteria },
    // 자기 파악 세 번째 축 — 서버가 세션에 지속해 다음 턴이 "그거"를 이어받는다.
    workingState,
    // **이번 턴에 모델이 실제로 부른 것** — 다음 턴이 이어받아 자기 이력으로 되돌려 준다
    // (정본 §S2 필수 계약 ②). 서버가 대화에 함께 저장해 재시작 뒤에도 살아남는다.
    // 여기서 다시 만들지 않는다 — 모델 앞에 실제로 놓였던 그 배열을 그대로 넘긴다.
    turnExchange: tc?.turnExchange ?? [],
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
