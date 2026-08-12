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
import { canonicalDurableEvidence } from './l0-evidence/sensitive-text.js';
import { toolLabel, withParticle } from './tool-labels.js';
import { interpret } from './l1-intent/intent.js';
import { buildTaskContext, 이번턴만그림 } from './l1-intent/task-context.js';
import {
  bindSourceReceipt, initialWorksetReality, projectSourceCoverage, sourceCoverageReceipt,
} from './l1-intent/source-coverage.js';
import { buildActionPlan, toolActionKind } from './l2-plan/action-plan.js';
import { 실행전판정, 승인면제, 걸음신분 } from './l2-plan/tool-boundary.js';
import { 손제시기록 } from './l2-plan/tool-offer.js';
import { dump손제시 } from '../runtime/prompt-dump.js';
import { observeWorksetReality, 표맥락에서 } from '../runtime/local-file.js';
import { defaultFileRoots } from '../runtime/file-scope.js';
import { isExecutionAllowed, decideAutoGrant, isSafetyFloor } from './l2-plan/authority.js';
import { decideFollowUp } from './l2-plan/follow-up.js';
import { admitInboundEvent } from './l1-intent/inbound-gate.js';
import { detectCandidate, admittedEntries, dropHistoryDuplicates, isGoalRelevant } from './l1-intent/context-mesh.js';
import { shownFromRendered, citedFromShown } from './l5-growth/tcell-shown.js';
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
import { 완료주장검증, 빈손으로끝났나, 미완료를밝혔나, 절대재검증 } from './l2-plan/exit-verification.js';

// 시간 소스 — 테스트는 ctx.now 주입으로 결정적으로 제어(만료 시나리오). 미주입 시 실시간.
function nowMs(ctx) { return ctx.now ? ctx.now() : Date.now(); }
function requestDigest(text) { return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16); }
function 모델앞선영수증(entries, turnReceipts) {
  return (entries ?? []).filter((e) => !turnReceipts.includes(e) && e?.origin !== 'runtime_observation');
}

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

/**
 * **화면의 자리**(F-54 · 2026-08-09). 파일 자리와 같은 계약, 다른 손 — 화면 손이 살아 있는
 * 설치에서만 창 제목·앱명(최대 5 · 폭은 드라이버 층 동결)이 현실 사실로 실린다.
 * 지연은 실측으로 남긴다(PM 조건 2 — 「무겁지 않은가」 축의 사전 데이터). 못 보면 undefined —
 * 조용히 생략(없는 화면을 지어내지 않는다).
 */
/**
 * **자리 공백을 손이 살아 있는 지면에 동봉한다** (F-54 사전 재료 · 쓴숫자대조 선례 · PM 승인 2026-08-09).
 *
 * 출구 되부름은 answerOnly 라 "그 자리도 본다"가 구조적으로 불가능했다(라이브 2표본 — 발화
 * 2/2 · 행동 0/2). 사후 되부름 방법은 이 얼굴에서 **은퇴**했고(모델이 세 번 실패한 게 아니라
 * 방법이 닫힌 것), 선례대로 사실을 옮긴다: 관측 영수증의 요약줄은 모델이 **손을 쥔 채** 받는
 * 지면이다 — 볼 수도 있고(손이 있으니) 밝힐 수도 있다. 닫는 문장의 두 길이 다 산다.
 *
 * 세 성질: 트리거는 원장(이번 턴 영수증 + 턴 머리 관측값 재사용 — 새 관측 아님) · 판단 0
 * (어느 자리가 값진지는 모델이 고른다 — 자르지 않고 전부) · 차단 아님(요약줄 사실 한 줄).
 * 침묵 조건: 두 종류를 다 닿았거나 · 자리가 한 종류뿐이거나 · 실패 영수증.
 */
function 자리공백동봉(rec, 이번턴영수증들, ctx) {
  // ReceiptRef가 선 뒤에는 사용자면 요약도 서명 본문의 일부다. 사후 동봉으로 바꾸지 않는다.
  if (rec?.receiptRef) return;
  if ((rec?.failureState ?? 'none') !== 'none') return;
  const tool = String(rec?.actualCall?.tool ?? '');
  const 화면계 = tool === 'desktop.screen';
  const 파일계 = tool.startsWith('local.');
  if (!화면계 && !파일계) return;
  const 파일자리 = (ctx.이번턴파일자리 ?? []).map((p) => p?.label ?? p).filter(Boolean);
  const 화면자리들 = (ctx.이번턴화면자리 ?? []).map((x) => x?.label ?? x).filter(Boolean);
  if (!파일자리.length || !화면자리들.length) return; // 한 종류뿐 — 고를 공백이 없다
  const 닿았나 = (판별) => 이번턴영수증들.some((r) => (r?.failureState ?? 'none') === 'none'
    && 판별(String(r?.actualCall?.tool ?? '')));
  // **이름이 아니라 내용으로**(③ 완성 · PM 판정 2026-08-09). 자리에 동봉된 내용 사실
  // (locate 의 자 — 자료기간·성격·개수)이 있으면 함께 싣는다: "GPAO-T5(2026-08 자료 · 문서 2)".
  // 질문과 자리의 관련성이 사실로 선다 — 판단은 여전히 모델이 한다.
  const 파일자리말 = (ctx.이번턴파일자리 ?? [])
    .map((p) => (p?.label ? `${p.label}${p.사실 ? `(${p.사실})` : ''}` : String(p)))
    .filter(Boolean);
  const 사실 = (화면계 && !닿았나((t) => t.startsWith('local.')))
    ? `이번 턴에 아직 안 본 자리 종류 — 파일: ${파일자리말.join(' · ')}`
    : (파일계 && !닿았나((t) => t === 'desktop.screen'))
      ? `이번 턴에 아직 안 본 자리 종류 — 화면: ${화면자리들.slice(0, 5).join(' · ')}` // 폭 동결과 같은 5
      : null;
  if (!사실) return;
  rec.userSafeSummary = `${String(rec.userSafeSummary ?? '').trim()} (${사실})`.trim();
}

async function 화면자리(ctx) {
  try {
    const r = await ctx.tools?.tools?.['desktop.screen']?.places?.();
    if (!r?.창들?.length) return undefined;
    ctx.화면자리지연 = { 걸린ms: r.걸린ms, 창수: r.창들.length }; // 진단면 — 회차기록용
    return r.창들;
  } catch { return undefined; }
}

// ── **무엇이 진짜 상한인가** (아껴 쓰지 않게 한다 · 오너 지시 2026-08-11) ──────
//
// 옛 `MAX_TOOL_STEPS = 6` 은 이름이 상한이었지 **루프를 무는 자리가 아니었다.** 걸음 루프
// (`while (!예산소진(...))`)는 이미 예산이 물고 있다. 6 은 두 곳에만 남아 있었고 뜻이 서로 달랐다:
//   ㉮ `toolStepsLeft` — 모델 방에 실리는 **남은 걸음 숫자**. 6 은 여기서 배급 신호였다
//   ㉯ `산출물이어가기` 의 재요청 횟수 뒷단 — 걸음 수와 아무 상관 없는 별개 축
// 하나의 상수가 두 질문에 답하고 있었고, 그래서 "상한을 올린다"가 무슨 뜻인지 아무도 몰랐다.
// 그래서 상수 하나를 키우지 않고 **둘로 가른다.**

/**
 * **걸음 폭주 정지선.** 배급이 아니다 — 한 턴이 끝없이 길어지는 것만 막는다.
 * 비용 축은 예산 한 곳(`turn-budget.js` 왕복)이고, 실제로 루프를 무는 것도 거기다.
 * 값은 예산의 왕복과 같은 대(비교군 실측 20~50)로 둔다 — 여기가 왕복보다 작으면
 * 예산을 올린 것이 시늉이 된다(옛 6 이 정확히 그 모양이었다).
 */
const 걸음정지선 = 40;
/**
 * **산출물 재요청 뒷단** — 걸음 수와 무관한 별개 축이라 따로 선다.
 * 값은 옛 6 그대로다(행동 변화 0). 밀어붙이는 것이 진전을 만들지 않는다는 실측이
 * `산출물이어가기` 주석에 있다(같은 `.log` bulk_move 를 여덟 번 냈다) — 여기는 올릴 자리가
 * 아니고, 걸음 상한이 커진다고 따라 커져서도 안 된다.
 */
const 산출물재요청상한 = 6;
const WORK_DELIVERABLE_SCHEMA = Object.freeze({
  name: 'work.deliverable',
  description: '사용자의 요청 결과가 대화 답변인지, 실제 파일 생성·변경인지 구분한다.',
  parameters: {
    type: 'object',
    properties: {
      output: { type: 'string', enum: ['chat', 'file'] },
      sourcePolicy: { type: 'string', enum: ['none', 'all_current', 'selected'] },
      verification: { type: 'string', enum: ['direct_exact', 'process_sha256', 'admin_grounded'],
        description: '파일 결과를 확인할 실제 근거. process_sha256은 선택 원본의 터미널 SHA-256 출력과 결과 readback을 결속한다. admin_grounded는 현재 자료마다 실제 읽은 근거를 결과물의 해당 사실과 결속한다.' },
    },
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
      ? { assessment: 'file', sourcePolicy: 'unknown', deliverables: [{ id: 'primary-file-output', kind: 'file', operation: 'write', binding: 'direct' }] }
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
    const structuredCall = typeof out === 'string' ? null
      : out?.toolCalls?.find((call) => call?.name === WORK_DELIVERABLE_SCHEMA.name
        && ['chat', 'file'].includes(call?.args?.output));
    const structured = structuredCall?.args?.output;
    const sourcePolicy = ['none', 'all_current', 'selected'].includes(structuredCall?.args?.sourcePolicy)
      ? structuredCall.args.sourcePolicy : 'unknown';
    const verification = ['direct_exact', 'process_sha256', 'admin_grounded'].includes(structuredCall?.args?.verification)
      ? structuredCall.args.verification : 'unknown';
    const judgment = structured === 'file' || structured === 'chat'
      ? structured : parseDeliverableJudgment(typeof out === 'string' ? out : out?.text);
    if (judgment === 'file') {
      return {
        assessment: 'file', sourcePolicy, verification,
        deliverables: [{ id: 'primary-file-output', kind: 'file', operation: 'write', binding: directWrite ? 'direct' : 'derived' }],
      };
    }
    if (judgment === 'chat') return { assessment: 'chat', sourcePolicy, deliverables: [] };
  }
  // 구조 채널을 모르는 기존 provider는 직접 쓰기 호출이라는 보수적 계약을 유지한다.
  // 실제 모델이 CHAT을 구조로 반환한 경우에는 위에서 이미 쓰기 후보를 제거했다.
  if (directWrite) {
    return {
      assessment: 'file', sourcePolicy: 'unknown',
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
  //
  // ── **막힌 것만 보고 된 것을 버리지 않는다** (F-84 · 콘솔 라이브 실측 2026-08-12) ──────
  //
  // 밟은 회차: *"내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알려줘."* → 손 3건
  // (`local.file` ok · `local.capsule` blocked · `local.locate` ok **후보 5건**) 인데 답은
  // *"한 캡슐에서 부를 수 있는 손을 다 썼어요(200번). 조건을 좁혀 다시 해볼까요?"* 하나였다.
  // `capsule.js:318 userSafeSummary` + `:321 nextSafeAction` 과 **문자 그대로 같다** — 이
  // 함수가 지은 것이다(재현으로 확인: 최종 답 === `fallbackReplyFrom(영수증)`).
  //
  // 원인은 아래 `blocked` 갈래가 **막힌 영수증만** 읽었기 때문이다. 성공한 손이 가져온 것은
  // 원장에 있었는데 사용자에게 한 글자도 안 갔다. 커널이 답을 쓸 수밖에 없는 자리라면
  // **원장에 남은 사실을 다 읽어야 한다** — 된 것 먼저, 막힌 것 다음.
  //
  // 그리고 **되물음으로 닫지 않는다**(헌장 2등 「네 가지만 묻는다」 — 비밀번호·되돌릴 수 없는
  // 파괴·새 상대 첫 발송·돈). 막힌 손의 `nextSafeAction` 은 그 넷 중 아무것도 아니다.
  // 다만 **된 것이 하나도 없으면** 그 다음 길이 우리가 가진 전부다 — 그때는 예전 그대로
  // 실어야 막다른 답이 안 된다(`fallback-reply-is-user-facing` 이 무는 자리).
  const 사람에게 = receipts.filter((r) => r.failureState !== 'cancelled');
  const 볼것 = 사람에게.length ? 사람에게 : receipts;
  const blocked = 볼것.filter((r) => r.failureState && r.failureState !== 'none');
  const 된말 = [...new Set(볼것.filter((r) => (r.failureState ?? 'none') === 'none')
    .map((r) => r?.userSafeSummary).filter(Boolean))];
  if (!blocked.length) {
    const done = 된말.join(' ').trim();
    return done || '방금 요청은 처리했어요.';
  }
  const what = blocked.map((r) => r.userSafeSummary).filter(Boolean).join(' ');
  if (!된말.length) {
    const next = blocked.map((r) => r.nextSafeAction).filter(Boolean)[0];
    return `${what}${next ? ` ${next}` : ''}`.trim();
  }
  return [...된말, what].filter(Boolean).join(' ').trim();
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

function refreshSourceCoverage(ctx, ledger) {
  if (!ctx.initialWorksetReality) return null;
  ctx.sourceCoverage = projectSourceCoverage({
    worksetReality: ctx.initialWorksetReality,
    receipts: ledger.entries,
    workRef: ctx.sourceCoverageWorkRef,
  });
  ctx.worksetReality = {
    ...ctx.worksetReality,
    initialSourceSetRef: ctx.initialWorksetReality.sourceSetRef,
    sourceCoverage: ctx.sourceCoverage,
  };
  return ctx.sourceCoverage;
}

/** 턴 종료 뒤 같은 projection을 durable runtime reality receipt로 한 번 남긴다. */
export function finalizeSourceCoverage(ctx, turnRef) {
  const coverage = refreshSourceCoverage(ctx, ctx.ledger);
  if (!coverage) return null;
  const existing = ctx.ledger.entries.find((entry) => entry?.origin === 'runtime_observation'
    && entry?.observationKind === 'source_coverage'
    && entry?.turnRef?.sessionId === turnRef?.sessionId
    && entry?.turnRef?.turnSeq === turnRef?.turnSeq);
  if (!existing) ctx.ledger.append(sourceCoverageReceipt(coverage, turnRef));
  return coverage;
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
async function 답완성({ reply, tc, ctx, search, receipts = [], 출처계약손 = [], 파일계약빈손 = false }) {
  // H09 P0(거짓 성공): 이번 턴 읽기가 전패했는데 답이 내용을 서술하면, 그 답 대신 영수증의
  // 정직한 사실이 나간다. 판정 근거는 원장이다 — 성공 영수증이 하나라도 있으면 개입하지 않는다
  // (부분 성공 턴의 오차단 방지 — 경계·검사는 recovery-ladder, 관통은 이 단일 확정 지점).
  const 거짓성공 = 읽은척차단(receipts, reply, { 출처계약손 });
  // 커널이 답을 갈아치우면 **모델이 이어 쓸 것도 없다** — 잘림 사실은 여기서 꺼진다(J9).
  // 조건을 두 줄로 나눈 이유: 아래 반환문은 `answer-authorship-lanes` 가 **글자 그대로** 무는
  // 자리다(갈아치움 칸이 몰래 늘지 않게 하는 자). 그 자를 건드리지 않고 사실만 끈다.
  if (거짓성공?.blocked) ctx.답잘림 = false;
  if (거짓성공?.blocked) return 거짓성공.정직한답;
  // **출구 검증은 여기 묶는다**(§2-C). `답완성` 은 답이 나가는 모든 자리가 지나는 한 문이다 —
  // 자리마다 적으면 언젠가 하나가 빠지고, 빠진 그 경로로 거짓 완료가 그대로 나간다.
  // 실측(2026-08-04): `executePlan` 에만 붙였더니 **손을 안 고른 턴**이 그 앞에서 돌아가
  // 그대로 통과했다 — 그게 정본이 말한 "말로만 끝남"의 바로 그 자리였다.
  if (String(reply ?? '').trim()) return 출구검증(userFacingModelText(reply), { tc, ctx, receipts, 파일계약빈손 });
  const retry = await ctx.model.respond({ ...tc, answerOnly: true }, {
    onDelta: ctx.onAnswerDelta, search, effort: 'medium',
  });
  // **답을 낸 호출이 바뀌었다** — 잘림 사실도 이 호출의 것으로 바뀐다(J9).
  const 다시 = userFacingModelText(답으로삼기(ctx, retry, ''));
  if (!다시) ctx.답잘림 = false;   // 원장 문장으로 끝낸다 — 이어 쓸 것이 없다
  return 출구검증(다시 || fallbackReplyFrom(receipts), { tc, ctx, receipts, 파일계약빈손 });
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
/**
 * **완료 대조를 한 턴에 한 번만 계산한다**(C2 · 상태 지도 §12).
 *
 * 대조가 도는 자리는 둘이고 **둘 다 남는다**: 걸음 루프의 `목적미달()` 은 *되게 만드는* 자리이고
 * 출구의 `출구검증()` 은 *정직하게 말하게 하는* 자리다. 역할이 다르므로 하나를 없애면 그건
 * 재사용이 아니라 그물 제거다. 다만 **자가 같으면 답도 같다** — `완료주장검증` 은 인자만 보는
 * 순수 함수인데, 부를 때마다 대화 전체 원장을 새로 직렬화하고 이름·명령 대조를 처음부터 다시
 * 돌렸다. 원장이 길수록 그대로 사용자 대기시간이다.
 *
 * **메모는 원장이 안 바뀐 동안만 산다.** 영수증이 하나라도 붙으면(`원장.append` 의 한 문) 지워진다 —
 * 그래야 재사용이 낡은 판정을 되살리지 않는다. 값이 아니라 **사실의 나이**로 무는 방식이다.
 */
function 완료검증한번(ctx, 인자) {
  const 셈 = ctx.완료검증셈 ?? (ctx.완료검증셈 = { 잰것: 0, 재사용: 0 });   // 턴 머리에서 새로 선다
  const 자리글 = JSON.stringify(인자.자리종류 ?? null);
  const 메모 = ctx.완료검증메모;
  if (메모 && 메모.reply === 인자.reply && 메모.자리글 === 자리글
    && 메모.돌려줬나 === Boolean(인자.이미돌려줬나) && 메모.원장글 === 인자.원장글) {
    셈.재사용 += 1;
    return 메모.값;
  }
  셈.잰것 += 1;
  const 값 = 완료주장검증(인자);
  ctx.완료검증메모 = {
    reply: 인자.reply, 자리글, 돌려줬나: Boolean(인자.이미돌려줬나), 원장글: 인자.원장글, 값,
  };
  return 값;
}

async function 출구검증(reply, { tc, ctx, receipts = [], 파일계약빈손 = false }) {
  // **원장글**: 이 턴의 영수증 + 앞 턴 교환 + **이 대화의 전체 영수증**(ctx.ledger).
  // 답이 가리킨 자리가 여기 없으면 지어낸 것이다. 두 벌을 따로 만들지 않는다 —
  // 모델이 받은 것과 같은 사실 위에서 대조한다.
  // 창을 대화 전체로 넓힌 이유(수리 재실행 실측 2026-08-10 · S4 R2 7턴): 두 턴 전에
  // 실제로 읽은 `A사_7월_최종.csv` 가 "앞 턴" 창 밖이라 지어낸 이름으로 오판됐다 —
  // 원장에 있는 이름은 몇 턴 전이든 원장의 이름이다. 대화문(recentTurns)은 넣지 않는다 —
  // 변형 이름이 두 번 말해지면 사실이 되는 길을 열지 않는다.
  const 원장글 = JSON.stringify([receipts ?? [], tc?.turnExchange ?? [], ctx.ledger?.entries ?? []]);
  // F-54 후반 — **자리 종류**를 함께 준다(파일 자리 명부 · 이번 턴 화면 자리).
  // 그물이 "한 종류만 보고 끝냈는가"를 원장과 대조할 재료다(판단은 그물이, 답은 모델이).
  const 검증 = 완료검증한번(ctx, {
    reply, receipts, 원장글, 이미돌려줬나: Boolean(ctx.출구되돌림),
    자리종류: {
      // **이번 턴 머리의 관측이 진실이다** — 이전 턴 상태(workingState.places)는 새 세션
      // 첫 턴에 비어 있어 그물이 침묵한다(실측: 오너 창 하나를 태웠다). 관측이 없던 옛
      // 세션 이어받기에서만 이전 턴 상태로 물러난다.
      파일: (ctx.이번턴파일자리 ?? ctx.workingState?.places ?? []).map((p) => p?.label ?? p).filter(Boolean),
      화면: ctx.이번턴화면자리 ?? [],
    },
  });
  if (검증.일치) return reply;
  ctx.출구되돌림 = true;
  // **그물이 물었다는 사실을 남긴다**(계측 · 회차 H 실측 2026-08-08). 회차 원본에 최종 답만
  // 실려서 "그물이 물었는데 모델이 반복했다"와 "그물이 안 물었다"를 가릴 수 없었다 —
  // 안 보이면 또 추측 수리를 하게 된다(P2-7 과 같은 이유). 진단면이다 — 사용자면에 안 나간다.
  ctx.출구그물 = { 사실: 검증.모델에게 };
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
  // 되부름이 **실제로 답을 냈을 때만** 잘림 사실이 그 호출의 것으로 바뀐다(J9). 빈손으로
  // 돌아오면 아래에서 앞 답이 그대로 나가므로 앞 사실도 그대로 서야 한다.
  if (고친답.trim()) ctx.답잘림 = typeof 다시 === 'string' ? false : Boolean(다시?.잘림);
  // ── **보정 실패는 거짓 답으로 회귀하지 않는다**(P-OP 수리 계약 FILE-⑦ · 2026-08-10) ──
  //
  // 실측(S4 재현): 되부름 뒤 모델이 같은 거짓 완료를 반복하면 "한 턴에 한 번" 계약이
  // 그 두 번째 거짓을 그대로 사용자에게 보냈다. 왕복은 여전히 한 번이다 — 다시 부르지
  // 않고, 되부름 뒤의 답이 여전히 **실물 없는 파일 완료 주장**(FILE 계약 빈손 · 원장 밖
  // 이름·자리)이면 원장 기반 짧은 미완료 답으로 끝낸다. 부드러운 그물(개수 어림 등)은
  // 재지 않는다 — 정직하게 고쳐 쓴 답을 잡아먹으면 그게 반대 방향의 거짓이다.
  //
  // **셋째 갈아치움 칸이다**(계획 §3-A 회계 · answer-authorship-lanes 참조). 앞 둘(거짓
  // 성공 게이트)과 같은 P0 성질 — 모델에게 이미 한 번 돌려줬고, 그 뒤에도 반복된 거짓만
  // 잡는다. 일반 대화는 이 칸에 오지 않는다(파일 산출물 존재만 절대 게이트).
  const 재검증 = 절대재검증({ reply: 고친답.trim() ? 고친답 : reply, receipts, 원장글, 파일계약빈손 });
  if (재검증.재거짓) {
    ctx.출구그물 = { 사실: 검증.모델에게, 재거짓: 재검증.사실 };
    ctx.미리보기?.retract?.();
    ctx.답잘림 = false;   // 아래 두 갈래는 커널이 원장으로 쓴 답이다 — 이어 쓸 것이 없다(J9)
    // **미완료 문장은 계약이 빈손일 때만이다**(수리 재실행 실측 2026-08-10 · S4 R2 7턴).
    // 성공한 실행이 있는 턴에서 이름 변형만 반복됐을 때 "완료하지 못했어요"라고 하면
    // **반대 방향의 거짓**이 된다 — 실물은 있다. 그때는 원장의 영수증 문장(실제 파일
    // 이름이 실려 있다)으로 끝낸다. 어느 쪽이든 지어낸 이름은 사용자에게 가지 않는다.
    if (!파일계약빈손) return fallbackReplyFrom(receipts);
    const 막힘 = (receipts ?? []).some((r) => r?.failureState && !['none', 'cancelled'].includes(r.failureState));
    return [
      '방금 요청은 아직 완료하지 못했어요 — 이 턴의 기록에 그 완료를 뒷받침하는 실행이 없어요.',
      ...(막힘 ? [fallbackReplyFrom(receipts)] : []),
    ].join(' ');
  }
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

/**
 * **나가는 답을 고르는 한 자리**(J9 · 상태 지도 §12).
 *
 * 예전엔 `답잘림` 이 **호출 ① 하나**만 보고, 안내는 **빠른 경로 하나**에만 붙었다. 손을 쓴 턴의
 * 답이 끊기면 사용자는 아무 말 없이 잘린 답을 받았다 — 라이브가 잡은 그 사고(2026-08-05)와
 * 같은 모양인데 경로만 다르다.
 *
 * 자리마다 `out.잘림` 을 읽는 방식으로는 또 하나가 빠진다(§2-C). 그래서 **답을 고르는 일과
 * 잘림을 적는 일을 한 함수**로 묶는다: 답을 낸 호출이 바뀌면 사실도 같이 바뀐다.
 * 이 호출이 글을 안 냈으면 앞 답도 앞 사실도 그대로 둔다 — 안 낸 것이 사실을 지우면 안 된다.
 */
function 답으로삼기(ctx, out, 현재답 = '') {
  const 글 = typeof out === 'string' ? out : out?.text;
  if (글 === undefined || 글 === null) return 현재답;
  ctx.답잘림 = typeof out === 'string' ? false : Boolean(out?.잘림);
  return 글;
}

export async function runTurn(input, ctx) {
  // 3축: 이번 턴의 응답 표면. **맨 위에서 한 번만** 정한다 — 승인 재개(executePlan 직행) 경로도
  // 같은 표면을 쓴다. 채널마다 커널을 나누지 않는다(같은 커널, 표면만 다르다).
  ctx.surface = resolveResponseSurface(input);
  // 계열 ④: 이 턴에 화면으로 나가는 조각을 한 원장이 든다 — 최종 답이 그 누적을 따라온다.
  미리보기원장(ctx);
  const ledger = ctx.ledger ?? new TruthLedger();
  if (!ctx.pending) ctx.pending = new Map();
  // **완료 대조 재사용은 한 턴 안에서만 산다**(C2). `ctx` 는 턴을 넘어 살아 있으므로 여기서
  // 안 비우면 지난 턴의 판정이 이번 턴 답 위에 설 수 있다 — 재사용이 낡은 판정을 되살리면
  // 그건 원가 절감이 아니라 그물 구멍이다. 계측(진단면)도 이 턴의 것만 센다.
  ctx.완료검증메모 = undefined;
  ctx.완료검증셈 = { 잰것: 0, 재사용: 0 };
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
  //
  // **네 축이 같은 자리에서 열린다**(S4 수리 2026-08-12). 예전엔 이 줄이 왕복 하나만 열었고
  // 나머지 셋은 `executePlan` 의 지역 변수라 **진입마다** 0 이 됐다 — 리셋 자리가 둘로 갈리면
  // 언젠가 한쪽만 지켜진다. 리셋은 여기 한 줄뿐이다(`turn-budget.js:15-17` 의 규율 그대로).
  if (typeof input.text === 'string' && input.text.trim()) {
    ctx.왕복수 = 0;
    ctx.되돌릴수있는것수 = 0;
    ctx.그밖수 = 0;
    ctx.일한ms = 0;
  }
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
  // F-65: 허용 범위와 현재 작업셋을 섞지 않는다. 명시된 bounded root 하나일 때만 턴 머리에서
  // 이름·종류 목록을 실제 파일 손으로 관측한다. 이 영수증은 모델이 고른 실행이 아니므로
  // 실행 교환/완료 판단에는 넣지 않고, 같은 턴 원장과 RealitySnapshot에만 결속한다.
  {
    const roots = ctx.tools?.tools?.['local.file']?.scopeRoots ?? [];
    const explicitRoots = String((ctx.processEnv ?? process.env).GPAO_T5_FILE_ROOTS ?? '').trim();
    ctx.turnSelfState = selfState;
    ctx.reobserveWorkset = () => observeWorksetReality({ tools: ctx.tools, selfState, roots,
      configuredRoots: explicitRoots ? defaultFileRoots(ctx.processEnv ?? process.env) : [],
      currentBasis: explicitRoots ? 'explicit_file_roots' : undefined });
    const observed = await ctx.reobserveWorkset();
    ctx.worksetReality = observed.reality;
    if (observed.receipt) {
      observed.receipt.sourceWorkRef = ctx.sourceCoverageWorkRef ?? null;
      observed.receipt.sourceSetRef = observed.reality?.sourceSetRef ?? null;
      ledger.append(observed.receipt);
    }
    ctx.initialWorksetReality = initialWorksetReality(
      ledger.entries, ctx.sourceCoverageWorkRef, observed.reality,
    );
    refreshSourceCoverage(ctx, ledger);
  }

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
      hadActiveGoal: Boolean(ctx.activeGoal?.understoodTask) || ctx.hadWorkGoal === true,
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
      // **화면 경유 전송도 같은 자리에서 기억한다**(F-58 · 2026-08-09). 열쇠는 카드가
      // 보여 준 그 실질(`상대열쇠` — previewOf 가 낸 앱·방·내용)이다. 카드가 A 를 보여 주고
      // 기억이 B 로 저장되면 사용자가 승인한 것과 조용해지는 것이 어긋난다(PM 조건 ①).
      // 신분이 안 선 카드(정규화 실패)는 열쇠가 없으므로 아무것도 저장하지 않는다 — 다음에도 묻는다.
      for (const 행동 of saved.plan?.needsApproval ?? []) {
        if (행동?.상대열쇠) ctx.knownCounterparts.add(행동.상대열쇠);
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
  // 관련은 **목표의 대상**으로만 잰다(isGoalRelevant) — 부탁 형태("…말해줘")만 겹친 발화에
  // 옛 목표를 실으면 상태 요약형 질문의 시야가 그 목표로 좁혀진다(30턴 12턴 실측 · 팔A 3/3).
  const goalRelevant = ctx.activeGoal?.understoodTask && isGoalRelevant(ctx.activeGoal.understoodTask, input.text ?? '');
  ctx.stateReviewSignals = {
    goalRelevant: Boolean(goalRelevant),
    // **입장과 부기는 다른 질문이다.** "목표를 이번 프롬프트에 실을까"(goalRelevant)와
    // "이 세션에 이미 진행 중인 목표가 있었나"(최초 작업 후보 판정의 억제 사실)는 소비자가
    // 다르다. 예전엔 정산 게이트가 입장 여부(hasAdmittedContext)로 이걸 대신 알았는데,
    // 입장 판정을 정밀화하자(부탁 형태 겹침 제외) 이어지는 턴이 "최초 작업"으로 보였다.
    // 목표의 존재는 판정이 아니라 구조 사실이므로 그대로 나른다.
    // 수명주기 v2: 대화 턴이 목표를 소진하면(activeGoal null) 이 사실이 함께 꺼졌다 —
    // "세운 적 있다"는 역사(ctx.hadWorkGoal, 서버 지속)로 잰다. 목표의 생존과 역사는 다른 사실이다.
    hadActiveGoal: Boolean(ctx.activeGoal?.understoodTask) || ctx.hadWorkGoal === true,
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
  let automationControl = null;
  let automationObserve = null;
  let agentProposal = null;
  // **모델이 낸 질문.** 커널이 만든 되묻기와 한 자리를 놓고 다투지 않게 여기 하나만 둔다.
  let 물음 = null;
  const 통제제안받기 = (분리) => {
    // **모델이 물었다.** 어느 모델 호출에서 왔든 한 자리에 모은다 — 자리마다 따로 읽으면
    // 언젠가 하나가 빠지고, 빠진 그 자리에서 모델의 질문이 조용히 사라진다(§2-C).
    if (분리?.askUser && !물음) 물음 = 분리.askUser;
    if (분리?.skillProposal) skillProposal = 분리.skillProposal;
    if (분리?.automationProposal) automationProposal = 분리.automationProposal;
    if (분리?.automationControl) automationControl = 분리.automationControl;
    if (분리?.automationObserve) automationObserve = 분리.automationObserve;
    // **만든 것을 모델이 알아야 한다**(판 ⑦). `executePlan` 안에서도 읽으려면 `ctx` 다.
    ctx.automationProposal = automationProposal;
    ctx.automationControl = automationControl;
    if (분리?.agentProposal) agentProposal = 분리.agentProposal;
    collectWorkState(분리);
  };
  const 통제제안 = () => ({
    skillProposal, automationProposal, automationControl, agentProposal,
    workStateProposal: currentWorkStateProposal(),
  });
  const 승인통제제안 = () => ({ skillProposal, automationProposal, automationControl, agentProposal });
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
  // **호출을 하나도 안 낸 응답**과 「일 걸음만 없는 응답」은 다른 사실이다(F-83 반대시험).
  // 통제 호출(기억 철회·작업 상태·자동화·물음)은 실행이 아니라서 `modelChosen` 에 안 담기지만,
  // 모델이 **고른 행동**이기는 하다. 그 턴을 「아무것도 안 골랐다」로 읽으면 방금 한 일을 못 본
  // 채 되부르게 된다(회귀가 잡았다: `memory.withdraw` 한 턴이 목적미달로 끌려갔다).
  // 채널을 열거하지 않는다 — **낸 호출이 있었나** 하나만 센다.
  let 모델이낸호출수 = 0;
  const 낸호출세기 = (out) => {
    모델이낸호출수 += typeof out === 'string' ? 0 : (out?.toolCalls?.length ?? 0);
  };
  let earlyReply = null;
  // 상한에서 끊겼나(거짓 성공 금지 — 잘렸으면 잘렸다고 말한다). **이 턴의 사실은 `ctx` 가 든다**
  // (J9): 지역 변수면 `executePlan` 안에서 답을 낸 호출을 못 본다 — 복합 경로가 통째로 빠졌다.
  ctx.답잘림 = false;
  // **화면 자리는 턴 머리에서 한 번 관측한다**(F-54). 턴 끝 파생에만 실으면 이번 턴 모델은
  // 화면을 영영 못 본다(첫 턴 측정이 정확히 그 자리다 — M1). 여기서 관측해 이번 턴의
  // workingState 에 얹고, 턴 끝 파생도 같은 관측을 이어받는다(드라이버 호출은 턴에 1회).
  ctx.이번턴화면자리 = await 화면자리(ctx);
  if (ctx.이번턴화면자리?.length) {
    ctx.workingState = { ...(ctx.workingState ?? {}), screenPlaces: ctx.이번턴화면자리 };
  }
  // **파일 자리도 같은 규격으로 턴 머리에서 관측한다**(F-54 후반 대칭 · PM 지시 2026-08-09).
  // 첫 판은 출구 그물에 `ctx.workingState.places`(= **이전 턴** 상태)를 넘겼고, 새 세션 첫
  // 턴에는 그게 비어 있어 그물이 한 번도 안 물었다 — 오너의 창 하나를 미검증 배선에 태운
  // 그 자리다. 화면 자리만 머리 관측을 받고 파일 자리는 안 받은 **대칭 누락**이었다.
  // 관측은 턴에 1회 — 아래 파생 자리들이 이 값을 이어받는다(두 번 세지 않는다).
  {
    const t0 = Date.now();
    ctx.이번턴파일자리 = await 볼수있는자리(ctx);
    // 내용 동봉으로 관측 비용이 늘었다 — 얼마나인지는 재서 남긴다(PM 조건 · 화면 자리와 같은 계약).
    ctx.파일자리지연 = { 걸린ms: Date.now() - t0, 자리수: (ctx.이번턴파일자리 ?? []).length };
  }
  // 이 턴의 문맥을 블록 밖에서도 쓴다 — 승인으로 멈출 때 **한 번 더 말하게** 하려면 필요하다.
  let earlyTc;
  let earlyWantedWeb = false;
  {
    const tc = earlyTc = buildTaskContext({
      processEnv: ctx.processEnv,
      externalReality: ctx.externalReality, externalRealityDelta: ctx.externalRealityDelta,
      intent, selfState, admittedContext: admitted, admittedRich, automationProposal, recentTurns: ctx.recentTurns, priorExchange: ctx.priorExchange,
      창예산: ctx.창예산, // 노드 W · 결과 상한이 창의 파생값이 된다(모르면 null → 옛 값)
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
      // 3축: 지금 이 답이 어디로 나가는가(웹/메신저). 같은 커널, 표면만 다르다.
      surface: ctx.surface,
      nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
      // 자기 파악 세 번째 축: **지금 이 대화에서 어디까지 왔는가**. 이게 없으면 "리뷰 읽어봐"의
      // "리뷰"가 무엇인지 몰라 엉뚱한 것을 검색한다(오너 실사용).
      workingState: ctx.workingState,
      worksetReality: ctx.worksetReality,
      automationReality: ctx.automationReality,
      projectWorkState: ctx.projectWorkState,
      // **첫 판단 자리에도 남은 걸음을 준다**(PM 실측 2026-08-07 · 노드 R).
      //
      // `예산사실()` 은 `executePlan` 안에 있어 **모델이 처음 판단할 때는 없다.** ⑤·⑬ 처럼
      // 첫 턴에 손을 쓸지 말지 정하는 자리가 바로 여기이고, 여기가 비어 있으면 모델은
      // 능력만 알고 *지금 써도 되는지*를 모른 채 *"…해 드려야 해요"* 라고 미래형으로 답한다.
      // 아직 아무것도 안 썼으니 남은 걸음은 상한 그대로다.
      toolStepsLeft: Math.min(걸음정지선, 턴예산(ctx.processEnv ?? process.env).왕복),
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
    // **잘린 답을 다 쓴 답인 것처럼 내지 않는다**(절대 게이트 1 — 거짓 성공).
    // 라이브(오너 2026-08-05): 답이 `예를 들어 스윙이면` 에서 문장 한가운데 끊겼는데
    // T5 는 아무 말 없이 그대로 내보냈다. 사용자는 왜 끊겼는지 알 길이 없었다.
    // 종료 사유는 관측되고 있었지만 `onCallIdentity` 곁길로만 흘러 여기서 아무도 안 읽었다.
    // 답을 고르는 일과 잘림을 적는 일은 `답으로삼기` 한 자리에 묶여 있다(J9).
    earlyReply = 답으로삼기(ctx, out, '');
    // **모든 모델 호출 결과는 이 한 경계를 지난다** — 통제 호출(기억 후보 등)은 실행이 아니므로
    // 여기서 분리되어 후보 채널로만 가고, 나머지만 계획·승인·실행으로 간다.
    낸호출세기(out);
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
    // **실행은 안 하되, 안 했다는 사실은 남긴다**(J4 · 상태 지도 §12).
    //
    // 호출이 실행 없이 끝나는 자리는 여섯인데 다섯은 전부 `못한호출남기기` 로 사유가 남는다
    // (없는손·예산소진·되풀이·승인대기중단·되묻기중단). **이 자리만 없었다** — 같은 응답의
    // 작업 호출이 실행·영수증·원장 어디에도 안 남아, 모델은 다음 턴에 그게 갔다고 믿는다.
    // F-68 의 형제다(조용한 축소 금지).
    //
    // 어휘는 걸음 루프의 형제와 **같은 것**을 쓴다(`되묻기중단`). 새 사유를 만들면 소비자
    // (원장 대조·work state)가 어느 쪽을 봐야 할지 갈린다.
    for (const [i, call] of (modelChosen ?? []).entries()) {
      ledger.append(receipt({
        intended: `${call?.name ?? '(이름 없음)'} 실행`,
        actualCall: null,
        제안한호출: {
          tool: call?.name, args: call?.args ?? {},
          ...(call?.providerCallId ? { providerCallId: call.providerCallId } : {}),
          callRef: `되묻기${i + 1}`,
        },
        failureState: 'blocked',
        userSafeSummary: '먼저 확인할 게 있어 이건 아직 안 했어요.',
        diagnosticTrace: { callId: call?.providerCallId, 순번: i + 1, tool: call?.name, reason: '되묻기중단' },
      }));
    }
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
        낸호출세기(out);
        const 분리 = splitModelControlCalls(typeof out === 'string' ? [] : (out?.toolCalls ?? []));
        통제제안받기(분리);
        if (분리.memorySuggestion) memorySuggestion = 분리.memorySuggestion;
        if (분리.memoryWithdrawal) memoryWithdrawal = 분리.memoryWithdrawal;
        if (분리.memoryCorrection) memoryCorrection = 분리.memoryCorrection;
        if (분리.rest.length) {
          modelChosen = 분리.rest;
          if (typeof out !== 'string' && out?.text) earlyReply = 답으로삼기(ctx, out, earlyReply);   // J9
        }
      }
    }
  }

  // **찾는 손도 같은 길을 탄다**(2026-08-07 · 노드 R · 판 ⑤⑬ 0/3).
  //
  // 이 갈래는 `local.file` 하나만 봤다. 그래서 *"이번 달 얼마 벌었지?"* 처럼 **파일 이름을
  // 모르는 채 사실을 묻는** 발화는 후보에 `local.locate` 를 올려도 이 길을 못 탔다 —
  // 후보만 있고 **붙이는 자리가 없었다.** 새 강제를 만드는 게 아니라 이미 있는 길을 넓힌다.
  const 붙일손 = intent.neededTools?.includes('local.file') ? 'local.file'
    : (intent.neededTools?.includes('local.locate') ? 'local.locate' : null);
  if (!modelChosen && 붙일손 && !chatDiscardedFileCall) {
    const fileTools = modelSchemasFor(selfState, ctx.modelControls).filter((t) => t.name === 붙일손);
    if (fileTools.length) {
      const out = await ctx.model.respond({ ...earlyTc, actionRequired: true }, {
        effort: 'medium', tools: fileTools, requiredTool: 붙일손,
      });
      낸호출세기(out);
      const 분리 = splitModelControlCalls(typeof out === 'string' ? [] : (out?.toolCalls ?? []));
      통제제안받기(분리);
      if (분리.memorySuggestion) memorySuggestion = 분리.memorySuggestion;
      if (분리.memoryWithdrawal) memoryWithdrawal = 분리.memoryWithdrawal;
      if (분리.memoryCorrection) memoryCorrection = 분리.memoryCorrection;
      if (분리.rest.length) {
        modelChosen = 분리.rest;
        if (typeof out !== 'string' && out?.text) earlyReply = 답으로삼기(ctx, out, earlyReply);   // J9
      }
    }
  }

  const 자동화입장후답 = async (baseTc, currentReply, search) => {
    if (!automationProposal || typeof ctx.admitAutomationProposal !== 'function'
      || ctx.automationAdmissionHandled === true) return currentReply;
    ctx.automationAdmissionHandled = true;
    const admission = await ctx.admitAutomationProposal(automationProposal);
    automationProposal = admission && Object.hasOwn(admission, 'proposal')
      ? admission.proposal : { rejected: true, reason: 'admission_unknown' };
    ctx.automationProposal = automationProposal;
    ctx.automationReality = admission?.reality ?? ctx.automationReality;
    const out = await ctx.model.respond({
      ...baseTc,
      automationProposal: structuredClone(automationProposal),
      automationReality: structuredClone(ctx.automationReality),
    }, { search, effort: 'medium' });
    return 답으로삼기(ctx, out, currentReply);   // J9 — 답을 낸 호출에서 잘림을 본다
  };
  const 자동화제어후답 = async (baseTc, currentReply, search) => {
    if (!automationControl || typeof ctx.applyAutomationControl !== 'function'
      || ctx.automationControlHandled === true) return currentReply;
    ctx.automationControlHandled = true;
    const settled = await ctx.applyAutomationControl(automationControl);
    automationControl = settled?.control ?? { rejected: true, reason: 'control_unknown' };
    ctx.automationControl = automationControl;
    ctx.automationReality = settled?.reality ?? ctx.automationReality;
    const out = await ctx.model.respond({
      ...baseTc,
      automationControl: structuredClone(automationControl),
      automationReality: structuredClone(ctx.automationReality),
    }, { search, effort: 'medium' });
    return 답으로삼기(ctx, out, currentReply);   // J9 — 답을 낸 호출에서 잘림을 본다
  };
  const 자동화관찰후답 = async (baseTc, currentReply, search) => {
    if (!automationObserve || typeof ctx.observeAutomation !== 'function') return currentReply;
    const observed = await ctx.observeAutomation(automationObserve);
    ctx.automationReality = observed?.reality ?? ctx.automationReality;
    const out = await ctx.model.respond({
      ...baseTc,
      automationObserve: observed?.observation ?? { rejected: true, reason: 'observation_unknown' },
      automationReality: structuredClone(ctx.automationReality),
    }, {
      search, effort: 'medium', tools: modelSchemasFor(selfState, ctx.modelControls),
    });
    const separated = splitModelControlCalls(typeof out === 'string' ? [] : (out?.toolCalls ?? []));
    통제제안받기(separated);
    return 답으로삼기(ctx, out, currentReply);   // J9 — 답을 낸 호출에서 잘림을 본다
  };

  // ── **손이 필요한 턴은 빠른 경로의 자리가 아니다** (F-83 · 콘솔 라이브 2026-08-12) ──
  //
  // 빠른 경로는 *"손이 필요 없다"* 는 판단 위에 선 출구다. 그런데 **필요 여부를 판단한 것과
  // 모델이 고른 것이 어긋나는 회차**가 있다: 의도는 찾는 손을 지목했는데(`neededTools`)
  // 모델은 하나도 안 골랐다. 밟은 회차 — *"내 컴퓨터에 엑셀 파일 있어? 찾아서 알려줘."* →
  // 손 0건 · *"파일 시스템에 직접 접근 권한이 없는 상태라서…"* 로 턴이 그대로 닫혔다.
  // 바로 위 `붙일손` 재요청까지 지나고도 안 골랐다는 뜻이라, **그 답이 이 턴의 마지막 말**이다.
  //
  // 목적을 재는 한 고리(`목적미달이어가기`)는 `executePlan` 안에 산다. 빠른 경로로 나가면
  // 그 고리를 통째로 안 지나므로, 이런 턴은 **출구를 가른다** — 고리를 복제하지 않고
  // 복합 경로로 보낸다(조항을 늘리는 것이 아니라 자리를 가르는 일이다). 무는 판단은 그대로
  // `목적미달()` 의 몫이라, 목적에 닿은 턴이면 거기서 조용히 지나간다.
  //
  // 오픈북 — 비교군도 **답이 나가기 직전**을 그 자리로 쓴다: 헤르메스는 종결 걸음이 원장에
  // 없으면 완성된 답을 억누르고 손을 쥔 채 루프로 되돌리고(`conversation_loop.py:7196-7205`
  // — `final_response = None; continue`), 오픈클로는 `before_agent_reply` 를 답이 나가기 전
  // 자리로 둔다(`docs/concepts/agent-loop.md:96`).
  //
  // 인사·잡담은 여기 안 걸린다 — `neededTools` 가 비어 있으면 잴 목적이 애초에 없다.
  //
  // **손이 걷힌 턴과 안 고른 턴은 다르다**(회귀가 잡았다): *"대화에 먼저 보여줘. 파일은 아직
  // 만들지 마."* 는 모델이 파일 손을 골랐고 CHAT 계약이 그것을 **걷어 낸** 턴이다
  // (`chatDiscardedFileCall`). 목적을 안 쫓은 것이 아니라 사용자가 지금은 하지 말라고 한 것이라,
  // 그 턴을 되부르면 방금 걷어 낸 손을 도로 권하게 된다. F-83 의 얼굴은 **걷어 낼 것조차
  // 없었던** 턴이다 — 모델이 스스로 하나도 안 골랐다.
  const 손이필요한데0건 = !modelChosen && !chatDiscardedFileCall && !모델이낸호출수
    && Boolean(intent.neededTools?.length);
  // **이 턴의 사실은 `ctx` 가 든다**(`답잘림` 과 같은 자리 · J9). `목적미달()` 은 `executePlan`
  // 안에 살아서 "모델이 호출을 하나도 안 냈다"를 직접 볼 수 없다 — 그 자리에서 보이는 것은
  // **실행 영수증**뿐이고, 영수증 0 은 통제 호출만 낸 턴(기억 철회 등)과 구별이 안 된다.
  ctx.손0건으로닫으려함 = 손이필요한데0건;

  // 3) fast path — 손이 필요 없다고 모델이 판단했다. 이미 받은 답을 그대로 준다(추가 호출 없음).
  if (!modelChosen && !influence && !손이필요한데0건
      && (completionContract.assessment === 'chat'
        || (intent.answerMode === 'fast_chat' && completionContract.assessment === 'not_applicable'))) {
    // 도구를 안 쓴 턴도 **대화의 한 턴이다.** 여기서 상태를 안 넘기면 턴 수가 멈춰서, 옛 대상이
    // 영원히 "방금 읽은 자료"로 남는다 — 감쇠가 필요한 바로 그 턴(화제 전환)에 감쇠가 안 돈다.
    // 라이브 실측에서 드러났다: 팔식당 뒤로 파이썬 얘기를 네 턴 해도 여전히 "방금 팔식당"이었다.
    const idleState = deriveWorkingState(ctx.workingState, {
      receipts: [], places: ctx.이번턴파일자리 ?? await 볼수있는자리(ctx), screenPlaces: ctx.이번턴화면자리,
    });
    earlyReply = await 자동화입장후답(earlyTc, earlyReply, earlyWantedWeb);
    earlyReply = await 자동화관찰후답(earlyTc, earlyReply, earlyWantedWeb);
    // 관찰 뒤 실제로 본 ref로 새 후보를 제출할 수 있다. 그 후보도 첫 제안과 같은
    // authoritative 입장/readback을 지나야 하며 raw 모델 args로 표면에 나가면 안 된다.
    earlyReply = await 자동화입장후답(earlyTc, earlyReply, earlyWantedWeb);
    earlyReply = await 자동화제어후답(earlyTc, earlyReply, earlyWantedWeb);
    // 빈 답을 그대로 돌려주던 자리다(H 진단 계열 ③ · P1). 계열 ④: 화면에 나간 조각과 정렬.
    // **잘림은 답을 다 만든 뒤에 읽는다**(J9) — `답완성` 이 재시도·되부름으로 답을 갈아치우면
    // 잘림 사실도 그 호출의 것으로 바뀌어 있다.
    const 빠른답 = 미리보기정렬(await 답완성({
      reply: earlyReply,
      tc: completionContract.assessment === 'chat' ? { ...earlyTc, chatOutputContract: true } : earlyTc,
      ctx, search: earlyWantedWeb,
    }), ctx.미리보기);
    return {
      kind: 'reply',
      reply: 잘림말붙이기(빠른답, ctx.답잘림),
      shownMemoryRefs, // S5-1: 손을 안 쓴 턴도 **모델 앞에 놓인 것**은 같다
      modelCitedRefs,  // S5-2: 모델의 주장(사용 사실 아님)
      memoryCorrection, // S5-3: 정정 신호(상관의 재료)
      ...통제제안(),
      workingState: idleState,
      contextShown: workingStateFacts(idleState),
      identityUpdate, // P-ID-1: 사용자가 지어 준 이름 — 서버가 지속한다
      selfStateSummary: summary, // 칩은 접힌 채(대화 점유 금지)
      exitNetDiagnostic: ctx.출구그물, // 진단면 — 출구 그물이 물었는가(회차 원본 계측)
      screenPlaceDiagnostic: ctx.화면자리지연, // F-54 지연 실측(PM 조건 2 · 진단면)
      filePlaceDiagnostic: ctx.파일자리지연,   // ③ 완성 — 내용 동봉 비용 실측(진단면)
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
    sourcePolicy: completionContract.sourcePolicy ?? 'unknown',
    verification: completionContract.verification ?? 'unknown',
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
  //
  // ── **판정은 손 이름을 안 가린다**(이음매 ① · §5-2 결재 ① · 2026-08-12) ────────
  //
  // 여기는 `'local.terminal'` **하나만 이름으로 박아** 두고 경계를 탔다. 걸음 경로(:3088)는
  // 같은 판정을 **모든 손에** 건다. 그래서 화면 손의 탐침이 계획 경로에서는 안 돌았고,
  // `눌러본사실` 이 없는 채로 등급이 매겨졌다 — **같은 `desktop.act type` 이 첫 수에는
  // 카드(`field_input`), 후속 걸음에서는 자동(`organize`)** 이 됐다(`action-plan.js:186`).
  // 사용자가 보기엔 같은 행동인데 T5 가 두 번 다르게 군 것이다.
  //
  // **새 분류도 새 게이트도 새 조항도 만들지 않는다.** 결함은 조항이 아니라 **자리**였다 —
  // 이 경로도 걸음 경로와 **같은 질문을 같은 함수**(`실행전판정`)에 물으면 된다.
  // (오너 2026-08-12: *"운전법이 아니라 경우의 수가 된다."*)
  //
  // 값은 싸다: 탐침을 가진 손은 지금 **둘뿐**이고(`local.terminal`·`desktop.act`), 나머지
  // 손에게 이 질문은 인자를 그대로 돌려받는 순수 계산이다. 화면 손도 창 넷(`focus` 등)에는
  // `{해당없음:true}` 로 답해 화면을 안 읽는다.
  //
  // 경계가 지키는 계약은 그대로다:
  //   · probe 를 못 돌렸으면 잰 것을 안 싣는다 — 미상은 승인으로 간다(read 로 안 흘린다).
  //   · probe 결과를 **그대로 싣는다.** 안 그러면 도구가 같은 것을 한 번 더 돌린다 —
  //     느린 것보다, `date`·`ls` 처럼 두 번 돌리면 답이 달라지는 것에서 사용자에게 보인 것과
  //     원장에 남은 것이 갈라지는 게 문제다(두 진실 금지). 화면은 더하다 — 그 사이에 바뀐다.
  //   · **잰 인자가 곧 실행 인자다**(`sendArgs` 로 그대로 내려간다 · :1911). 판정과 실행이
  //     다른 인자를 보면 그것이 두 진실이다.
  for (const id of planIntent.neededTools ?? []) {
    // 터미널만 인자 모양을 다듬어 넣던 기존 계약이 있다 — 그 자리는 그대로 둔다.
    const 낸것 = modelToolArgs?.[id];
    let 물을것 = 낸것;
    if (id === 'local.terminal') {
      const command = typeof 낸것?.command === 'string' ? 낸것.command.trim() : '';
      if (!command) continue;
      물을것 = { command, cwd: 낸것.cwd };
    }
    if (!물을것) continue;
    const { 판정인자 } = await 실행전판정({ toolId: id, args: 물을것, selfState, tools: ctx.tools });
    if (id === 'local.terminal') { planIntent = { ...planIntent, terminalOp: 판정인자 }; continue; }
    // 잰 사실을 **판정이 보는 자리와 실행이 보는 자리 둘 다**에 싣는다(같은 객체 하나).
    planIntent = { ...planIntent, toolArgs: { ...(planIntent.toolArgs ?? {}), [id]: 판정인자 } };
    modelToolArgs = { ...modelToolArgs, [id]: 판정인자 };
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
  // F-58 — 이 대화에서 이미 허락한 상대를 함께 넘긴다(헌장 ③ 의 조건이 서는 자리).
  const plan = buildActionPlan({ intent: planIntent, selfState, knownCounterparts: ctx.knownCounterparts });
  // P90-1: 완료 계약은 실행 뒤 영수증을 보고 만들지 않는다. ActionPlan이 확정된 이 자리에서
  // WorkRef와 결합해 발급하고, 승인 재개도 이 봉인된 plan을 그대로 사용한다.
  if (plan.deliverableAssessment === 'file' && plan.deliverables.length
      && ctx.workRef && ctx.issueCompletionContractRef && input.turnRef) {
    const contract = canonicalDurableEvidence({
      kind: 'file',
      sourceTurnRef: input.turnRef,
      sourcePolicy: planIntent.sourcePolicy ?? 'unknown',
      ...(() => {
        const parsed = parseFileRequest(input.text ?? '');
        const root = ctx.initialWorksetReality?.currentRoot?.path;
        if (!root || parsed.action !== 'write' || !parsed.path || !parsed.provenance?.independent
          || parsed.provenance.pathCount !== 1) {
          return { completionBasis: 'unverified' };
        }
        const expected = resolve(root, parsed.path);
        if (planIntent.verification === 'admin_grounded'
          && planIntent.sourcePolicy === 'all_current') {
          return { completionBasis: 'admin_grounded', userBinding: {
            expectedPathDigest: createHash('sha256').update(expected).digest('hex'),
          } };
        }
        if (planIntent.verification === 'process_sha256'
          && planIntent.sourcePolicy === 'selected') {
          return { completionBasis: 'process_sha256', userBinding: {
            expectedPathDigest: createHash('sha256').update(expected).digest('hex'),
          }, processBinding: { algorithm: 'sha256' } };
        }
        if (parsed.ambiguous) return { completionBasis: 'unverified' };
        return { completionBasis: 'direct_exact', userBinding: {
          expectedPathDigest: createHash('sha256').update(expected).digest('hex'),
          expectedContentDigest: createHash('sha256').update(parsed.text).digest('hex'),
        } };
      })(),
      ...(planIntent.sourcePolicy === 'all_current' && ctx.initialWorksetReality?.sourceSetRef
        ? { sourceBinding: { workRef: ctx.sourceCoverageWorkRef,
          sourceSetRef: ctx.initialWorksetReality.sourceSetRef } } : {}),
      deliverables: structuredClone(plan.deliverables),
    });
    const directAdmitted = contract.completionBasis === 'direct_exact'
      && ['none', 'all_current'].includes(contract.sourcePolicy);
    const processHashAdmitted = contract.completionBasis === 'process_sha256'
      && contract.sourcePolicy === 'selected'
      && contract.processBinding?.algorithm === 'sha256';
    const adminGroundedAdmitted = contract.completionBasis === 'admin_grounded'
      && contract.sourcePolicy === 'all_current'
      && contract.userBinding?.expectedPathDigest
      && contract.sourceBinding?.workRef
      && contract.sourceBinding?.sourceSetRef;
    const sliceAdmitted = directAdmitted || processHashAdmitted || adminGroundedAdmitted;
    if (!sliceAdmitted) {
      // 명시 경로·본문이 입장하지 못한 FILE 실행은 그대로 남기되 완료 후보가 아니다.
      ctx.completionAdmissionRejected = true;
      plan.deliverables = [];
    } else {
      plan.workRef = contract.sourcePolicy === 'all_current'
        ? ctx.sourceCoverageWorkRef : ctx.workRef;
      plan.completionContract = contract;
      ctx.deferCompletionSettlement = true;
      plan.completionContractRef = await ctx.issueCompletionContractRef(contract, plan.workRef);
    }
  }

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
  if (ctx.automationControl) automationControl = ctx.automationControl;
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
  // **표면을 요청한 손은 이 턴에 다시 안 부른다**(콘솔 라이브 2026-08-12).
  //
  // 2026-07-27 실측: 비밀 입력창을 띄웠는데 모델이 그걸 실패로 보고 **같은 손을 다시 골라**
  // 카드가 두 번 떴다. 그 사실은 그대로 옳다 — 사용자가 값을 넣기 전까지 **그 손은** 같은 자리다.
  // 그래서 손 단위로 막는다. 턴 전체를 멈추는 것과는 다른 일이다(아래 `목적미달이어가기` 참조).
  const 표면요청한손 = new Set();
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
      for (const 안쪽 of rec?.result?.innerReceipts ?? []) {
        ledger.append(bindSourceReceipt(안쪽, {
          workRef: ctx.sourceCoverageWorkRef, sourceSetRef: ctx.initialWorksetReality?.sourceSetRef,
        }));
      }
      const appended = ledger.append(bindSourceReceipt(rec, {
        workRef: ctx.sourceCoverageWorkRef, sourceSetRef: ctx.initialWorksetReality?.sourceSetRef,
      }));
      refreshSourceCoverage(ctx, ledger);
      return appended;
    },
  };

  // ── 예산·가드레일 상태 (계획 경로보다 먼저 선다 — 거기서도 예산을 센다) ──────
  const 예산 = 턴예산(ctx.processEnv ?? process.env);
  // **외부효과 뒷단은 비용 모델이 아니다**(오너 구속 계약 ④). 되돌릴 수 있는 것과 없는 것을
  // 따로 센다 — 도구별 비용표를 만들지 않고 이미 있는 `reversible` 선언에서 파생한다.
  //
  // **세 축 다 `ctx` 가 든다 — 왕복과 같은 규율이다**(S4 · 상태 지도 §12).
  //
  // 여기 있던 것은 `let` 지역 변수 셋이었다. `executePlan` 은 승인 재개마다 **새로 불린다** —
  // 그래서 카드가 N 번 뜨면 되돌릴 수 없는 실행이 3×N 이었다. `turn-budget.js:15-17` 은
  // 이미 규율을 적어 놓았다: *"승인 재개에도 누적한다(리셋하면 무한이다)."* 왕복만 그 규율을
  // 지켰다 — 예산을 든 자리가 왕복은 `ctx`, 나머지는 이 함수의 스택이었기 때문이다.
  //
  // 오픈북(헤르메스 `agent/iteration_budget.py`): 예산은 객체 하나가 들고 `consume()` 이 한
  // 자리에서 깎는다. 되돌리는 자리는 `refund()` **하나뿐**이고 이름이 붙어 있다 — 진입할 때마다
  // 조용히 0 이 되는 자리는 없다. 여기서도 리셋 자리는 **새 발화 하나**다(아래 `예산새로열기`).
  const 되돌릴수있는것쓴것 = () => ctx.되돌릴수있는것수 ?? 0;
  const 그밖쓴것 = () => ctx.그밖수 ?? 0;
  const 외부효과셈 = (칸) => { ctx[칸] = (ctx[칸] ?? 0) + 1; };
  // **좁은 칸은 `reversible: false` 를 선언한 손만이다.**
  //
  // 한 번 "모르면 좁은 칸"으로 뒀다가 회귀 22건이 물었다(실측 2026-08-04): `reversible` 을
  // 선언하지 않은 손이 많아서(MCP·web.collect·일부 커넥터) 정상 읽기·탐색 흐름이 3에서 끊겼다.
  //
  // 이 뒷단이 막는 것은 **되돌릴 수 없는 외부효과의 폭주**이지 "모르는 것"이 아니다. 모르는 것은
  // 이미 승인 경계가 잡는다 — `toolActionKind` 가 미상을 승인으로 보내고 헌장 넷이 그 위에 선다.
  // 여기서 한 번 더 좁히면 안전이 아니라 마비가 된다(자동성이 의무다).
  const 되돌릴수있나 = (toolId) => selfState.connectedTools?.find((t) => t.id === toolId)?.reversible !== false;
  // **벽시계도 이어받는다 — 다만 재는 것은 「T5 가 일한 시간」이다.**
  //
  // 진입마다 0 이면 카드 N 번에 600초×N 이라 위 두 칸과 같은 병이다. 그렇다고 발화 시각부터
  // 재면 **사용자가 카드를 들여다본 시간**까지 예산이 먹는다 — 이 축의 정의가 정확히 그 반대다
  // (`turn-budget.js:21` *"사용자가 실제로 기다리는 시간"*). 승인을 기다리는 동안 기다리는 쪽은
  // 사용자가 아니라 T5 다. 그래서 **이 함수 안에서 흐른 시간만** 누적분에 얹는다.
  const 진입시각 = nowMs(ctx);
  const 진입전일한ms = ctx.일한ms ?? 0;
  const 지난ms = () => (ctx.일한ms = 진입전일한ms + (nowMs(ctx) - 진입시각));
  // 사용자 취소는 예산과 무관하게 즉시다. 표면이 이 이음새를 채우면 큐 전체가 그 자리에서 선다.
  const 취소됐나 = () => Boolean(ctx.취소됐나?.() || ctx.abortSignal?.aborted);
  const 쓴것 = () => ({
    왕복쓴것: ctx.왕복수 ?? 0, 되돌릴수있는것쓴것: 되돌릴수있는것쓴것(), 그밖쓴것: 그밖쓴것(),
    지난ms: 지난ms(), 취소됨: 취소됐나(),
  });
  const 예산사실 = () => ({
    // **모델 방의 사실**이다(계약 ④). 지시가 아니라 남은 양이다 — 어떻게 쓸지는 모델이 정한다.
    turnBudget: {
      왕복쓴것: ctx.왕복수 ?? 0, 왕복예산: 예산.왕복,
      되돌릴수있는것쓴것: 되돌릴수있는것쓴것(), 되돌릴수있는것예산: 예산.되돌릴수있는것,
      그밖쓴것: 그밖쓴것(), 그밖예산: 예산.그밖,
    },
    // **지금 몇 번 더 뻗을 수 있나**(PM 실측 2026-08-07 · 노드 R).
    //
    // 받는 쪽(`task-context.js`·`model-provider.js`)은 처음부터 있었는데 **넣어 주는 자리가
    // 0곳**이었다. 그 주석에 H08 실측이 이미 적혀 있다 — *"손이 3걸음 남았는데 모델이
    // 「지금 손은 다 써서」라며 미뤘다. 남았다는 사실이 어디에도 없으니 빈칸을 소진으로
    // 메운 것이다."* **진단은 맞았는데 배선이 안 됐다.**
    //
    // 그래서 모델은 *능력*은 알고 *지금 써도 되는지*는 몰랐다. ⑤가
    // *"읽어서 계산해 드려야 해요"* 라고 **미래형**으로 말한 것이 그 모양이다.
    // 위 `turnBudget` 은 두 축의 원자료이고, 이건 **모델이 바로 읽는 한 숫자**다.
    // 강제가 아니다(⛔) — 사실을 줄 뿐이고 어떻게 쓸지는 모델이 정한다.
    toolStepsLeft: Math.max(0, Math.min(
      예산.왕복 - (ctx.왕복수 ?? 0),
      예산.되돌릴수있는것 - 되돌릴수있는것쓴것(),
      걸음정지선 - turnReceipts.length,
    )),
    ...(가드레일신호(turnReceipts).length ? { guardrailNotes: 가드레일신호(turnReceipts) } : {}),
  });
  // **이번에 실행 중인 호출의 신분.** 계획 경로도 바로 아래 `계약실행`을 지나므로
  // 실행문맥보다 먼저 서야 한다.
  /** @type {{providerCallId?:string, callRef?:string}} */
  let 현재호출신분 = {};
  const 실행문맥 = () => ({
    currentRequest: intent.currentRequest,
    // §5-3 c — 큰 결과 흘림 기준의 분모(창 예산의 파생값 · 모르면 tool-runner 가 옛 고정값으로 간다).
    결과자: ctx.창예산?.결과자,
    readScopeRoots: [...new Set(turnReceipts.flatMap((rec) => rec.readScopeRoots ?? []))],
    // **이번 턴의 표 맥락** — 읽은 CSV 합·이웃 합·폴더 명부(⑫ 접근 전환 · PM 승인 2026-08-08).
    // 출구 되부름은 손이 없어 실물을 못 고친다(회차 I 실증). 손이 살아 있는 루프 안에서
    // 쓰기 영수증이 숫자 대조 사실을 실을 수 있게, 커널이 모은 기계 사실을 손에 넘긴다.
    표맥락: 표맥락에서(turnReceipts),
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
      // **객체 동일성에 기대지 않는다**(밟음 2026-08-07 · 오너 질책).
      // 손은 그림을 냈고(`out.그림=O`) 옆길도 불렸는데(`그림받기=O`) 교환에는 안 붙었다 —
      // 담을 때의 `rec` 과 꺼낼 때의 영수증이 **다른 객체**라 `Map.has` 가 false 였다.
      // 그래서 그림 55KB 를 쥐고도 모델은 한 번도 못 봤고, T5 는 계속 *"못 읽었다"* 고 답했다.
      // 호출 신분(`providerCallId`·`callRef`)으로도 함께 걸어 둔다 — 그건 안 바뀐다.
      if (방금그림 && rec) {
        이번턴그림.set(rec, 방금그림);
        const 신분 = (rec.actualCall ?? rec.제안한호출 ?? {});
        for (const k of [신분.providerCallId, 신분.callRef]) if (k) 이번턴그림.set(k, 방금그림);
        방금그림 = null;
      }
      return rec;
    };
    if (toolId !== 'local.file' || !plan.workRef || !plan.completionContract
      || !plan.completionContractRef || !ctx.runCompletionExecution) return execute();
    const executeBeforeSignature = async () => {
      const rec = await execute();
      // 사용자면 동봉도 Receipt 본문이다. 서명 뒤가 아니라 직전에 한 번만 결산한다.
      if (rec?.deliverableRefs?.length) 자리공백동봉(rec, turnReceipts, ctx);
      return rec;
    };
    return ctx.runCompletionExecution({
      turnRef: plan.completionContract.sourceTurnRef,
      turnOrdinal: turnReceipts.length,
      workRef: plan.workRef,
      completionContract: plan.completionContract,
      completionContractRef: plan.completionContractRef,
      deferSignature: ctx.deferCompletionSettlement === true,
      execute: executeBeforeSignature,
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
    // **표면을 요청한 손은 그 자리에서 기록한다**(콘솔 라이브 2026-08-12). 예전엔 걸음 루프
    // 쪽에서만 적어서, 계획 레인이 먼저 그 손을 돌린 턴에서는 기록이 안 남았다 —
    // 그러면 뒤이은 되부름이 **같은 손을 다시 부른다**(2026-07-27 카드 두 장 사고의 재발).
    if (rec?.surfaceRequest) 표면요청한손.add(toolId);
    // 완료 산출물은 서명 경계 직전에 이미 한 번 동봉했다. unsigned 중간 Receipt만 여기서 동봉한다.
    if (!rec?.deliverableRefs?.length) 자리공백동봉(rec, turnReceipts, ctx);
    현실다시();
    // **계획 경로 실행도 예산에 잡힌다.** 걸음 루프에만 계수기를 달았더니 뒷단이 하나씩
    // 헐거워졌다(실측: 그밖 예산 2인데 3번 돌았다) — 왕복에서 겪은 것과 같은 병이다.
    if (되돌릴수있나(toolId)) 외부효과셈('되돌릴수있는것수'); else 외부효과셈('그밖수');
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
    places: ctx.이번턴파일자리 ?? await 볼수있는자리(ctx),
    screenPlaces: ctx.이번턴화면자리, // F-54 — 턴 머리의 그 관측(드라이버 호출은 턴에 1회)
    receipts: turnReceipts,
    blocked: ladder ? rungMessage(ladder) : undefined,
  }), ctx.connectors);
  let tc = buildTaskContext({
    processEnv: ctx.processEnv,
      창예산: ctx.창예산, // 노드 W · 결과 상한이 창의 파생값이 된다(모르면 null → 옛 값)
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
    externalReality: ctx.externalReality, externalRealityDelta: ctx.externalRealityDelta,
    intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted, admittedRich: ctx.admittedRich, automationProposal: ctx.automationProposal,
    // **답을 만드는 자리에도 그림을 준다**(밟음 2026-08-07 · 오너 질책).
    // 손은 그림 55KB 를 냈고 옆길도 정상이었는데(`out.그림=O` · `받기=O`) **이 자리가
    // `이번턴그림` 을 안 넘겼다.** 그래서 모델은 그림을 한 번도 못 봤고, 계산기 화면을
    // 쥐고도 계속 *"못 읽었다"* 고 답했다 — 아침에 됐던 것은 접근성이 잡히던 환경이라
    // 글자로 읽었을 뿐이고, 그림 경로는 **처음부터 이 자리에서 끊겨 있었다.**
    이번턴그림,
    // **앞 턴에 한 것**(노드 K · 판 ③). 세션 원장에서 이번 턴 것을 뺀 나머지다 —
    // 이 재료가 없으면 모델이 대화 이력의 내용을 이번 턴 빈자리에 끌어다 놓고
    // *"방금 다시 열어봤어요"* 라고 말한다(원장은 완전히 비어 있는데).
    priorReceipts: 모델앞선영수증(ledger.entries, turnReceipts),
    surface: ctx.surface,
    recentTurns: ctx.recentTurns, priorExchange: ctx.priorExchange, nativeSearch: Boolean(ctx.modelSupportsSearch),
    modelProviderId: ctx.modelProviderId, workingState, projectWorkState: ctx.projectWorkState,
    worksetReality: ctx.worksetReality,
    automationReality: ctx.automationReality,
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
  // ── **운전법은 하나다** (오너 지시 2026-08-12 · 조항 다섯을 한 고리로 합쳤다) ─────
  //
  //   목적을 정한다 → 손을 고른다 → 한다 → 결과를 원장에서 본다
  //   → 목적에 안 닿았으면 **아직 안 써본 손으로 다시** → 수단이 소진되면 그 사실을 말한다
  //
  // 예전엔 이 고리가 조항 다섯(산출물·후보·부분읽기·다른손·완료검증)으로 쪼개져 있었다.
  // 새 실패가 나올 때마다 조항을 하나 더 붙였고 — 좌회전이 안 되니 좌회전 코드를 붙인 것이다 —
  // 조항마다 손을 다르게 좁혀서 서로 막았다(오너 지적 2026-08-12: *"운전법이 아니라
  // 경우의 수다"*). 「후보를 찾았는데 안 열었다」도 「파일을 못 만들었다」도 「창이 안
  // 바뀌었다」도 **전부 목적에 안 닿음**이고, 대응은 하나다.
  //
  // 조항들에서 남길 것은 **정책이 아니라 사실 탐지기**뿐이다. 각 탐지기의 실측 근거(⑬ 아홉
  // 회차 · L1 locate×7 · ⑤ 부분합 · F-81 팔식당 · Hermes verification_stop)는 git 이력에 있다.
  //
  // 규율 — 다섯 조항이 각자 비싸게 배운 것을 한 벌로:
  //   · 손을 **안 좁힌다**. `modelSchemasFor` 전량 그대로 — 무엇을 고를지는 모델의 몫이다
  //   · `requiredTool` 없음 — "안 한다"는 선택지를 뺏으면 억지 산출물이 나온다(쓰레기 로그)
  //   · **말은 안 건드린다** — 모델이 작업 걸음을 골랐을 때만 답을 바꾼다(완료검증이 배운 것:
  //     바로 덮었더니 되부름 문장이 원래 답을 밀어내 출구 그물의 대상이 사라졌다)
  //   · 같은 지문만 다시 내면 그만둔다 — 없는 진전을 짜내지 않는다(같은 bulk_move 여덟 번)
  //   · **소진은 여기서 판정하지 않는다.** 갈 곳이 없으면 모델이 아무것도 안 고르고, 그때
  //     턴은 그대로 끝나 출구가 그 사실을 사용자 말로 세운다

  /**
   * 이 턴의 **목적 미달 사실**. 판단이 아니라 원장에서 읽은 값만 담는다.
   * 빈 객체면 목적에 닿은 것이고, 그러면 되부르지 않는다.
   */
  const 목적미달 = () => {
    const 사실 = {};
    const 답글원문 = typeof finalOut === 'string' ? finalOut : (finalOut?.text ?? '');
    const 부른것들 = turnReceipts.filter((r) => r?.actualCall?.tool);

    // ① 계약이 요구한 파일 산출물이 원장에 없다.
    if (산출물미충족()) 사실.unmetDeliverable = true;

    // ② 찾아 놓고 한 곳도 안 열었다 — 얕게 끝난 찾기도 같은 얼굴이다.
    //
    // **찾는 손은 파일 쪽만이 아니다**(콘솔 라이브 2026-08-12). 예전엔 `local.locate` 만 봤다.
    // 밟은 회차: 「팔식당 플레이스 후기 분석」에서 `web.search` 가 후보 여덟을 물어 왔고
    // 모델은 **그중 하나도 안 열고** 주소를 지어내 열었다가(DNS 오류) *"복붙해 주세요"* 로 닫았다.
    // 자리를 찾는 일(파일)과 곳을 찾는 일(웹)은 같은 얼굴이다 — 손 이름으로 가르지 않는다.
    //
    // 「열었나」도 같은 결로 넓힌다: 파일은 `local.file read`, 웹은 후보의 **그 주소**를
    // 실제로 부른 것. 아무 주소나 연 것은 후보를 연 것이 아니다(지어낸 주소가 그 자리다).
    const 찾은것들 = turnReceipts.filter((r) => (r.failureState ?? 'none') === 'none'
      && ['local.locate', 'web.search'].includes(r?.actualCall?.tool));
    const 후보들 = 찾은것들.flatMap((r) => r?.result?.candidates ?? r?.result?.후보 ?? []);
    const 얕은찾기 = !후보들.length ? 찾은것들.filter((r) => (r?.result?.candidates ?? []).length === 0
      && (r?.result?.canWiden || (r?.result?.placesToLook ?? []).length)) : [];
    // 후보가 가리키는 곳(파일 경로 또는 주소)을 이번 턴에 실제로 부른 적이 있나.
    const 부른인자글 = 부른것들.map((r) => { try { return JSON.stringify(r.actualCall.args ?? {}); } catch { return ''; } });
    const 후보를열었다 = 후보들.some((c) => {
      const 곳 = String(c?.url ?? c?.path ?? '').trim();
      return 곳 && 부른인자글.some((a) => a.includes(곳));
    });
    const 읽었다 = 후보를열었다 || turnReceipts.some((r) => (r.failureState ?? 'none') === 'none'
      && r?.actualCall?.tool === 'local.file' && ['read', 'versions'].includes(r?.actualCall?.args?.action));
    if (!읽었다 && 빈손으로끝났나(답글원문)) {
      if (후보들.length) {
        사실.candidatesUnopened = {
          수: 후보들.length,
          자리들: [...new Set(후보들.map((c) => String(c.url ?? c.path ?? '')))].filter(Boolean).slice(0, 5),
        };
      } else if (얕은찾기.length) {
        사실.searchNotExhausted = {
          ...(얕은찾기.some((r) => r?.result?.canWiden)
            ? { 깊이: Math.max(...얕은찾기.map((r) => Number(r?.result?.suggestDepth) || 0)) } : {}),
          자리들: [...new Set(얕은찾기.flatMap((r) => (r?.result?.placesToLook ?? [])
            .map((pl) => String(pl?.name ?? pl ?? ''))))].filter(Boolean).slice(0, 6),
        };
      }
    }

    // ③ 같은 자리를 반만 읽고 숫자를 말한다 — 부분합에 "총"이 붙는 자리.
    if (!(plan.deliverables ?? []).length && /\d/.test(답글원문) && !미완료를밝혔나(답글원문)) {
      const 쓴적 = turnReceipts.some((r) => (r.failureState ?? 'none') === 'none'
        && r?.actualCall?.tool === 'local.file'
        && ['write', 'move', 'bulk_move', 'delete'].includes(r?.actualCall?.args?.action));
      const 읽은들 = 쓴적 ? [] : turnReceipts.filter((r) => (r.failureState ?? 'none') === 'none'
        && r?.actualCall?.tool === 'local.file' && r?.actualCall?.args?.action === 'read'
        && (r?.result?.같은자리파일 ?? []).length);
      if (읽은들.length) {
        const 읽은이름 = new Set(읽은들.map((r) => String(r?.result?.path ?? '').split('/').pop()));
        const 안읽은 = [...new Set(읽은들.flatMap((r) => r.result.같은자리파일))].filter((n) => !읽은이름.has(n));
        if (안읽은.length) {
          사실.partialRead = {
            자리: String(읽은들[0]?.result?.path ?? '').split('/').slice(0, -1).join('/'),
            읽은: [...읽은이름], 안읽은: 안읽은.slice(0, 6),
          };
        }
      }
    }

    // ④ 걸음이 막힌 채이거나, 손이 적어 준 길을 한 번도 안 갔다(F-81 팔식당·PDF).
    //
    // ── **0건도 「한 번도 안 갔다」다** (F-83 · 콘솔 라이브 2026-08-12) ──────────────
    //
    // 예전엔 이 갈래가 `if (부른것들.length)` 안에 살았다. 그래서 **가장 심한 미달**인
    // 손 0건이 갈래 자체를 못 세웠다. 밟은 회차: *"내 컴퓨터에 엑셀 파일 있어? 찾아서 어디
    // 있는지 알려줘."* → 손 0건 · *"이 컴퓨터 파일 시스템에 직접 접근 권한이 없는 상태라서…"*
    // 프롬프트에는 `local.file`·`local.locate` 가 실려 있었다. 한 번도 안 간 것이 아니라
    // **한 걸음도 안 뗀 것**인데, 전제가 그 자리를 통째로 건너뛰었다.
    //
    // 갈래를 새로 만들지 않는다 — 전제를 **입구 하나에서 둘로** 가른다. 아래 값들은 0건에서
    // 그대로 옳게 무너진다: 막힌것·안밟은수단은 빈 배열이 되고, `안써본손` 은 **있는 손 전량**이
    // 된다. 그것이 이 갈래가 원래 말하려던 사실이다.
    const 걸음키 = (r) => `${r.actualCall.tool}|${r.actualCall.args?.action ?? r.actualCall.args?.op ?? ''}`;
    const 된걸음 = new Set(부른것들.filter((r) => (r.failureState ?? 'none') === 'none').map(걸음키));
    const 막힌것 = 부른것들.filter((r) => r.failureState
      && !['none', 'cancelled'].includes(r.failureState) && !된걸음.has(걸음키(r)));
    // 손이 스스로 돌려준 다음 수단·후보를, 이 턴에 실제로 향해 부른 적이 있나.
    const 쥐어준수단 = 부른것들.flatMap((r) => [
      ...(r.다음수단 ?? []).map((m) => String(m?.url ?? m?.what ?? '')),
      ...(r.다른후보 ?? []).map((c) => String(c?.url ?? c?.path ?? '')),
    ]).filter(Boolean);
    const 안밟은수단 = [...new Set(쥐어준수단)].filter((수단) => !부른것들.some((r) => {
      try { return JSON.stringify(r.actualCall.args ?? {}).includes(수단); } catch { return false; }
    }));
    const 써본손 = new Set(부른것들.map((r) => r.actualCall.tool));
    const 안써본손 = 있는손().filter((id) => !써본손.has(id));
    // **한 걸음도 안 뗐다** — 이 갈래가 원래 말하려던 사실의 극단이다(F-83).
    //
    // 말투만 보면 *"…없는 상태라서 확인해 드릴 수 없습니다"* 는 심문도 약속도 아니어서 샌다.
    // 비교군의 축은 문장을 아예 안 보는 것이다 — 종결 걸음이 원장에 없으면 턴을 안 닫는다
    // (헤르메스 `kanban_stop.py:88-101` · `conversation_loop.py:7196-7205`). 그 축을 쓰는
    // 자리가 `빈손으로끝났나` 의 둘째 인자다(원장을 주면 원장이 지배한다).
    //
    // ⚠️ **말투 판정을 대체하지 않는다 — 옆에 세운다.** 원장으로 갈아 끼웠더니 「보기만 하고
    // 약속으로 끝난 턴」(browser.observe 1건 성공 + *"이어서 검색해 볼게요"*)이 된걸음 1 이라
    // 조용해졌다(회귀가 잡았다). 걸음이 **하나라도 돈 턴**의 빈손은 여전히 말투가 말하고,
    // 원장이 말하는 것은 **아예 안 부른 턴**이다. 둘은 다른 사실이라 둘 다 남는다.
    // 정직한 미완 고지는 그 함수 첫 줄이 먼저 걷어 낸다 — 이 갈래는 거기 안 닿는다.
    //
    // ⚠️ **영수증 0 만으로 세우지 않는다.** 통제 호출(기억 철회 등)만 낸 턴도 영수증이 0이고,
    // 그 턴은 사용자가 시킨 일을 **이미 한** 턴이다(회귀가 잡았다: `memory.withdraw` 한 턴이
    // 목적미달로 끌려가 되부름이 돌았다). 그래서 「호출을 하나도 안 냈다」는 사실은 그것을
    // 실제로 셀 수 있는 자리(`runTurn`)가 재서 `ctx` 로 건넨다.
    const 한걸음도안뗐다 = ctx.손0건으로닫으려함 === true && !부른것들.length
      && 빈손으로끝났나(답글원문, { 가져온것: 0 });
    // **입구가 둘이고, 걸음이 돈 턴의 입구는 예전 그대로다.** 말투 판정을 영수증 0 인 턴에까지
    // 열면 *"알겠어요."* 같은 평범한 마무리가 전부 약속으로 잡힌다(회귀가 잡았다 — 기억 철회
    // 턴이 그 문장으로 끝난다). 말투는 **걸음이 하나라도 돈 턴**의 것이고, 걸음이 0인 턴은
    // 위의 `한걸음도안뗐다` 가 유일한 입구다.
    const 걸음이말하는미달 = 부른것들.length
      && (막힌것.length || 빈손으로끝났나(답글원문) || 안밟은수단.length);
    if (걸음이말하는미달 || 한걸음도안뗐다) {
      // **안 써 본 손이 없으면 세우지 않는다** — 없는 길을 권하는 되부름은 잔소리다.
      // (손이 아예 없는 판에서도 여기서 멎는다.)
      if (안써본손.length || 막힌것.length || 안밟은수단.length) {
        사실.goalNotReached = {
          ...(막힌것.length ? {
            막힌걸음: [...new Set(막힌것.map(걸음키))].slice(0, 5),
            막힌말: [...new Set(막힌것.map((r) => String(r.userSafeSummary ?? '')).filter(Boolean))].slice(0, 3),
            다음수단: 막힌것.flatMap((r) => r.다음수단 ?? []).slice(0, 5),
          } : {}),
          ...(안밟은수단.length ? { 안밟은수단: 안밟은수단.slice(0, 8) } : {}),
          안써본손: 안써본손.slice(0, 12),
        };
      }
    }

    // ⑤ 답이 원장이 받치지 않는 완료를 말한다 — 출구와 **같은 자·같은 원장**(두 벌 금지).
    const 답글 = userFacingModelText(답글원문);
    if (String(답글).trim()) {
      // C2 — 출구와 **같은 자·같은 원장**이므로 계산도 같다. 자리는 둘 다 남기고 계산만 재사용한다.
      const 검증 = 완료검증한번(ctx, {
        reply: 답글, receipts: turnReceipts,
        원장글: JSON.stringify([turnReceipts, tc?.turnExchange ?? [], ctx.ledger?.entries ?? []]),
        자리종류: {
          파일: (ctx.이번턴파일자리 ?? ctx.workingState?.places ?? []).map((pl) => pl?.label ?? pl).filter(Boolean),
          화면: ctx.이번턴화면자리 ?? [],
        },
      });
      if (!검증.일치) 사실.completionMismatch = { 사실: 검증.모델에게, 실제바뀐수: 검증.실제 };
    }
    return 사실;
  };

  let 이어간횟수 = 0;
  const 이어가기상한 = Math.max(산출물재요청상한, 6);
  /** **한 고리.** 목적에 안 닿았으면 사실을 주고 손 전량으로 되돌린다. */
  const 목적미달이어가기 = async () => {
    if (이어간횟수 >= 이어가기상한 || 예산소진(쓴것(), 예산)) return false;
    // ── **표면 요청은 그 손을 멈추지 턴의 목적을 멈추지 않는다** (콘솔 라이브 2026-08-12) ──
    //
    // 예전엔 표면 요청이 하나라도 있으면 여기서 무조건 물러났다. 근거는 *"사용자가 값을 넣기
    // 전까지는 무엇을 해도 같은 자리다"* 였는데, 그 문장은 **그 손에 대해서만** 참이다.
    //
    // 밟은 라이브: 「네이버에서 팔식당 검색해서 플레이스 후기 분석해줄 수 있어?」 →
    // 모델이 부른 손은 `connector.connect` **하나뿐**(원장 실측)이고, 그것이 Client ID·Secret
    // 입력면을 요청하자 턴이 그대로 닫혔다. 그리고 답은 *"후기를 복사해서 붙여 주세요"* 였다.
    // 그런데 공개 페이지를 읽는 데 자격은 필요 없고 `web.search`·`web.collect`·`browser.observe`·
    // `desktop.screen` 은 **한 번도 안 불렸다**. 「무엇을 해도 같은 자리」가 거짓이었던 것이다.
    //
    // 그래서 무는 자리를 바꾼다: 표면을 요청한 **그 손**은 다시 안 부르고(`표면요청한손`),
    // 안 써 본 손이 남아 있으면 목적은 계속 쫓는다. 남은 손이 없으면 예전처럼 물러난다 —
    // 그때는 정말로 사용자 차례다.
    if (turnReceipts.some((r) => r.surfaceRequest)) {
      const 써본손 = new Set(turnReceipts.filter((r) => r?.actualCall?.tool).map((r) => r.actualCall.tool));
      const 남은손 = 있는손().filter((id) => !써본손.has(id) && !표면요청한손.has(id));
      if (!남은손.length) return false;   // 갈 곳이 없다 — 공은 사용자에게 넘어갔다
    }
    const 미달 = 목적미달();
    if (!Object.keys(미달).length) return false;                    // 목적에 닿았다 — 끝낸다
    const 손들 = modelSchemasFor(selfState, ctx.modelControls);
    if (!손들.length) return false;
    이어간횟수 += 1;
    // ── **약속으로 턴을 닫지 않는다** (오픈북 · 헤르메스 kanban_stop.py:88-101) ──────
    //
    // 사실만 system 블록에 놓고 손을 돌려주는 것으로는 부족했다. 콘솔 라이브(2026-08-12):
    // `goalNotReached` 를 두 번 받고도 모델이 손을 안 고르고 *"흐름은 이렇게 잡을게요 …
    // 분석해 드릴게요."* 라는 **계획**으로 턴을 닫았다. 사실은 갔는데 행동이 안 났다.
    //
    // 비교군은 같은 자리에서 셋을 더 한다:
    //   ① 넛지를 **user 역할 메시지**로 넣는다 — system 사실보다 강하게 선다
    //      (`conversation_loop.py:7182-7185` 가 `{"role":"user", content: nudge}` 를 append)
    //   ② 문장이 지시다 — *"Do this immediately in your next response — do not narrate
    //      intent"* · *"Never end a turn with only a promise of future action."*
    //      (`kanban_stop.py:96-100`)
    //   ③ 횟수로 묶는다(`max_attempts 2`) — 우리는 `이어가기상한` 이 이미 그 자리다
    //
    // **이것은 손을 고르는 판단을 뺏는 것이 아니다.** 무엇을 부를지는 그대로 모델의 몫이고,
    // 여기서 말하는 것은 **턴의 계약** 하나다 — 판단 헌장이 이미 그 층에 있다(§24).
    // 통로도 새로 안 만든다: 이 저장소가 이어쓰기 지시에 쓰던 그 자리(`recentTurns`)를 쓴다.
    const 계약말 = [
      '방금 답은 아직 목적에 안 닿았어요.',
      '지금 응답에서 **손을 부르거나**, 못 하는 이유를 원장에 남은 사실로 말해 주세요.',
      '「~할게요」 같은 예고만으로 끝내지 말아 주세요 — 예고는 한 일이 아니에요.',
    ].join(' ');
    const 되부름 = await ctx.model.respond({
      ...tc, ...미달,
      recentTurns: [...(tc.recentTurns ?? []), { role: 'user', text: 계약말 }],
    }, {
      search: wantedWeb, effort: 'medium', tools: 손들,
    }).catch(() => null);
    // **통제 호출은 「되게 만든 것」이 아니다** — 제안·기억만 다시 내면 미달은 그대로인데
    // 부작용(새 후보 등록)은 생긴다. 이 고리가 여는 것은 **작업 걸음**뿐이다.
    const 고른것 = splitModelControlCalls(typeof 되부름 === 'string' ? [] : (되부름?.toolCalls ?? [])).rest;
    // ── **되부름이 낸 글은 버리지 않는다 — 낼 것이 없을 때 되살린다** (F-84 · 오픈북) ────
    //
    // 예전엔 아래 `finalOut = 되부름` 이 **걸음을 골랐을 때만** 돌았다. 그래서 되부름이
    // *"캡슐은 한도로 막혔고 대신 찾기 손으로 후보 5곳을 확인했어요: …"* 처럼 **정확히 우리가
    // 원하던 답**을 내고 손을 안 골랐을 때, 그 글이 통째로 사라졌다(재현으로 확인). 그리고
    // 앞 답이 비어 있으면 `답완성` 의 빈답 그물이 원장으로 답을 새로 지었다 —
    // 모델이 이미 쓴 답이 있는데 커널이 대신 쓴 것이다.
    //
    // 비교군은 같은 자리에서 **되살린다**(헤르메스 `agent/turn_finalizer.py:106-122`):
    //   `continuation_budget_exhausted = final_response is None and bool(_pending_verification_response)`
    //   → `final_response = _pending_verification_response`
    //   *"Preserve that exact answer instead of replacing it with another fallible model call."*
    // 조건이 `final_response is None` 인 것까지 그대로 가져온다 — **앞 답이 있으면 안 건드린다.**
    // 멀쩡한 답을 되부름의 글로 갈아치우는 것은 이 고리가 할 일이 아니다.
    const 되살리기 = () => {
      const 앞답 = typeof finalOut === 'string' ? finalOut : (finalOut?.text ?? '');
      const 되부름글 = typeof 되부름 === 'string' ? 되부름 : (되부름?.text ?? '');
      if (!String(앞답).trim() && String(되부름글).trim()) finalOut = 되부름;
    };
    if (!고른것.length) {                                            // 안 골랐다 — 수단이 소진된 것이다
      되살리기();
      if (미달.unmetDeliverable) 멈춘이유 = '파일 결과물 실행을 고르지 않아 멈췄어요';
      return false;
    }
    if (고른것.every((c) => rung.has(지문of(c?.name, c?.args ?? {})))) {
      되살리기();
      if (미달.unmetDeliverable) 멈춘이유 = '이미 한 것과 같은 실행만 남아 멈췄어요';
      return false;                                                  // 없는 진전을 짜내지 않는다
    }
    finalOut = 되부름;                                               // 걸음을 골랐을 때만 답을 바꾼다
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

  // ── **큐 잔여 중에 온 응답의 호출은 증발하지 않는다** (F-68 · 반대시험 ⑤ · 2026-08-12) ──
  //
  // 재현(결정적 · `걸음증발-재현프로브.mjs` MODE=early): read 3건 배치의 첫 걸음(계획 레인)
  // 뒤 재호출이 write 를 냈는데, 큐(첫응답나머지)에 read 2건이 남아 있어 그 응답은 루프
  // 머리(분리→줄세우기)에 닿기 전이었다. 큐가 비는 순간 아래 바닥 재호출이 `finalOut` 을
  // **덮어써서** write 가 실행도 카드도 blocked 영수증도 없이 사라졌다 —
  // 「걸음은 증발하지 않는다 — 실행되거나, 카드가 뜨거나, 사유가 남는다」의 위반(F-20 계열).
  //
  // 수리는 새 그물이 아니라 **있는 길로 잇는 것**이다: 루프 머리가 아직 안 걷은 응답이면
  // 바닥에서 다시 부르지 않는다. 그러면 다음 반복의 머리가 그 응답을 정상 경로(분리→통제
  // 채널→줄세우기→기존 판정·승인·원장)로 걷는다 — paced 재현이 이미 증명한 그 관통이다.
  let 걷은응답 = null;
  const 안걷은호출남았나 = () => 걷은응답 !== finalOut && typeof finalOut !== 'string'
    && splitModelControlCalls(finalOut?.toolCalls ?? []).rest.length > 0;

  while (!예산소진(쓴것(), 예산)) {
    if (!대기호출.length) {
      // 걸음도 같은 분리 경계를 지난다 — 통제 호출은 걸음이 아니다(실행·승인·원장에 안 탄다).
      // executePlan 은 결과를 직접 못 돌려주므로 ctx 로 실어 나른다.
      const 분리 = splitModelControlCalls(typeof finalOut === 'string' ? [] : (finalOut?.toolCalls ?? []));
      걷은응답 = finalOut;   // 이 응답은 지금 이 자리가 걷는다 — 바닥 재호출이 덮어써도 된다
      ctx.collectWorkState?.(분리);
      if (분리.memorySuggestion) ctx.제안된기억 = 분리.memorySuggestion;
      if (분리.skillProposal) ctx.제안된스킬 = 분리.skillProposal;
      if (분리.automationProposal) {
        ctx.제안된자동화 = 분리.automationProposal;
        ctx.automationProposal = 분리.automationProposal;
      }
      if (분리.agentProposal) ctx.제안된에이전트 = 분리.agentProposal;
      if (분리.automationObserve && typeof ctx.observeAutomation === 'function') {
        ctx.automationObserveCount = (ctx.automationObserveCount ?? 0) + 1;
        const observed = ctx.automationObserveCount <= 4
          ? await ctx.observeAutomation(분리.automationObserve)
          : { observation: { rejected: true, reason: 'observation_budget_spent' } };
        ctx.automationReality = observed?.reality ?? ctx.automationReality;
        tc = {
          ...tc,
          automationObserve: observed?.observation,
          automationReality: structuredClone(ctx.automationReality),
        };
        finalOut = await ctx.model.respond(tc, {
          search: wantedWeb, effort: 'medium',
          tools: modelSchemasFor(selfState, ctx.modelControls),
        });
        continue;
      }
      if (분리.automationProposal && typeof ctx.admitAutomationProposal === 'function'
        && ctx.automationAdmissionHandled !== true) {
        ctx.automationAdmissionHandled = true;
        const admission = await ctx.admitAutomationProposal(분리.automationProposal);
        ctx.automationProposal = admission && Object.hasOwn(admission, 'proposal')
          ? admission.proposal : { rejected: true, reason: 'admission_unknown' };
        ctx.제안된자동화 = ctx.automationProposal;
        ctx.automationReality = admission?.reality ?? ctx.automationReality;
        tc = {
          ...tc,
          automationProposal: structuredClone(ctx.automationProposal),
          automationReality: structuredClone(ctx.automationReality),
        };
        finalOut = await ctx.model.respond(tc, { search: wantedWeb, effort: 'medium' });
        continue;
      }
      if (분리.automationControl && typeof ctx.applyAutomationControl === 'function') {
        const settled = await ctx.applyAutomationControl(분리.automationControl);
        ctx.automationControl = settled?.control ?? { rejected: true, reason: 'control_unknown' };
        ctx.automationReality = settled?.reality ?? ctx.automationReality;
        tc = {
          ...tc,
          automationControl: structuredClone(ctx.automationControl),
          automationReality: structuredClone(ctx.automationReality),
        };
        finalOut = await ctx.model.respond(tc, { search: wantedWeb, effort: 'medium' });
        continue;
      }
      const next = 분리.rest;
      if (!next.length) {
        // **한 고리.** 목적에 안 닿았으면(계약 미충족·안 연 후보·반만 읽음·막힌 걸음·안 밟은
        // 수단·원장이 안 받치는 완료 — 전부 같은 것) 사실을 주고 손 전량으로 되돌린다.
        // 모델이 걸음을 고르면 계속, 안 고르면 그대로 끝난다(그게 수단 소진이다).
        if (await 목적미달이어가기()) continue;
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
    // **표면을 요청한 손은 이 턴에 다시 안 부른다**(2026-07-27 카드 두 장 사고). 인자가 달라도
    // 같다 — 사용자가 값을 넣기 전까지 그 손이 갈 수 있는 자리는 하나뿐이다.
    if (표면요청한손.has(toolId)) {
      못한호출남기기({ ...이번, args }, '표면대기', '아직 사용자 입력을 기다리는 중이라 다시 하지 않았어요.');
      if (대기호출.length) continue;
      if (await 목적미달이어가기()) continue;
      break;
    }
    // 같은 손을 같은 인자로 두 번 쓰지 않는다 — 결과가 마음에 안 든다고 반복하면 제자리를 돈다.
    if (rung.has(지문)) {
      // **줄에 아직 남은 것이 있으면 이 하나만 건너뛴다.** 예전엔 여기서 턴을 통째로 멈췄는데,
      // 그건 호출이 하나뿐이던 시절의 계약이다. 다섯 중 하나가 중복이라고 나머지 넷을
      // 버리면 그게 바로 이번에 없앤 그 병이다. 건너뛴 사실은 남는다.
      못한호출남기기({ ...이번, args }, '되풀이', '방금 한 것과 같은 일이라 다시 하지 않았어요.');
      if (대기호출.length) continue;
      // 반복 읽기는 실행하지 않는다. 다만 별도 파일 완료 계약까지 같이 버리지는 않는다.
      // 중복 방지와 완료 판정은 서로 다른 경계다.
      if (await 목적미달이어가기()) continue;
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
      창예산: ctx.창예산, // 노드 W · 결과 상한이 창의 파생값이 된다(모르면 null → 옛 값)
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
        externalReality: ctx.externalReality, externalRealityDelta: ctx.externalRealityDelta,
        intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted, admittedRich: ctx.admittedRich, automationProposal: ctx.automationProposal,
    // **앞 턴에 한 것**(노드 K · 판 ③). 세션 원장에서 이번 턴 것을 뺀 나머지다 —
    // 이 재료가 없으면 모델이 대화 이력의 내용을 이번 턴 빈자리에 끌어다 놓고
    // *"방금 다시 열어봤어요"* 라고 말한다(원장은 완전히 비어 있는데).
    priorReceipts: 모델앞선영수증(ledger.entries, turnReceipts), 이번턴그림,
        surface: ctx.surface, recentTurns: ctx.recentTurns, priorExchange: ctx.priorExchange,
        nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
        workingState, projectWorkState: ctx.projectWorkState, worksetReality: ctx.worksetReality,
        automationReality: ctx.automationReality,
        recoveryHint: 다음길(turnReceipts, 있는손(), 손설명()),
        ...예산사실(),
        ...(ctx.selfhood ?? {}),
      });
      // **줄이 남았으면 모델을 다시 부르지 않는다.** 모델은 이미 다음에 할 것을 골라 놨다 —
      // 여기서 되물으면 왕복 하나를 쓰고 그 사이 골라 둔 호출이 이번 응답에 덮인다.
      // **안 걷은 응답도 덮지 않는다**(F-68) — 다음 반복의 머리가 그 호출들을 걷는다.
      if (!대기호출.length && !안걷은호출남았나()) {
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
      // **화면 손의 헌장 ③ 열쇠**(F-58 (가-2) · 리허설 실측 2026-08-09). 채널 손은 target 으로
      // 묻는데 화면 손의 상대는 previewOf 가 낸 실질(앱·창·내용)이다. 이 열쇠를 여기서 안 주면
      // 경계는 "승인 필요", 분기 안의 계획은 knownCounterparts 를 보고 "자동" — 어긋나서
      // grants 빈손 break 로 **걸음이 흔적 없이 증발**했다(F-20 이 기록한 바로 그 죽음길).
      실질열쇠: ctx.tools?.tools?.[toolId]?.previewOf?.(판정인자 ?? {})?.발신실질 ?? null,
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
      const 걸음plan = buildActionPlan({ intent: 걸음intent, selfState: 걸음selfState, knownCounterparts: ctx.knownCounterparts });
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
    // 완료 산출물은 서명 경계 직전에 이미 한 번 동봉했다. unsigned 중간 Receipt만 여기서 동봉한다.
    if (!rec?.deliverableRefs?.length) 자리공백동봉(rec, turnReceipts, ctx);
    현실다시();
    원장.append(rec);          // 모든 걸음이 원장에 남는다
    turnReceipts.push(rec);
    await 확인된중간결과(ctx, rec, ledger);
    steps += 1;
    if (되돌릴수있나(toolId)) 외부효과셈('되돌릴수있는것수'); else 외부효과셈('그밖수');

    // **표면 요청이 나오면 공은 사용자에게 넘어간다 — 그 턴은 여기서 멈춘다.**
    // 실측(오너, 2026-07-27): 비밀 입력창을 띄웠는데 모델이 그걸 실패로 보고 같은 손을
    // 다시 골랐다. 그래서 **승인 카드가 두 번** 떴다. 더 부른다고 될 일이 아니다 —
    // 사용자가 값을 넣기 전까지는 무엇을 해도 같은 자리다.
    if (rec.surfaceRequest) {
      // 그 손은 여기서 멈춘다 — 사용자가 값을 넣기 전까지 같은 자리다(2026-07-27).
      // **턴의 목적은 여기서 멈추지 않는다**: 안 써 본 손이 남아 있으면 계속 쫓는다.
      // 남은 손이 없으면 `목적미달이어가기` 가 스스로 false 를 내고 그때 턴이 닫힌다.
      표면요청한손.add(toolId);
      멈춘이유 = undefined;
      대기호출.length = 0;                        // 그 손 뒤에 줄 서 있던 것은 이 자리에서 무의미하다
      if (await 목적미달이어가기()) continue;
      break;
    }

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
      창예산: ctx.창예산, // 노드 W · 결과 상한이 창의 파생값이 된다(모르면 null → 옛 값)
      carryableWork: ctx.carryableWork, // S3 · 이어받을 수 있는 작업(사실 나열)
      priorShown: ctx.priorShown,        // S5-3 · 정정이 지목할 대상
      externalReality: ctx.externalReality, externalRealityDelta: ctx.externalRealityDelta,
      intent, selfState, plan, receipts: turnReceipts, admittedContext: admitted, admittedRich: ctx.admittedRich, automationProposal: ctx.automationProposal,
    // **앞 턴에 한 것**(노드 K · 판 ③). 세션 원장에서 이번 턴 것을 뺀 나머지다 —
    // 이 재료가 없으면 모델이 대화 이력의 내용을 이번 턴 빈자리에 끌어다 놓고
    // *"방금 다시 열어봤어요"* 라고 말한다(원장은 완전히 비어 있는데).
    priorReceipts: 모델앞선영수증(ledger.entries, turnReceipts), 이번턴그림,
      surface: ctx.surface, recentTurns: ctx.recentTurns, priorExchange: ctx.priorExchange,
      nativeSearch: Boolean(ctx.modelSupportsSearch), modelProviderId: ctx.modelProviderId,
      workingState, projectWorkState: ctx.projectWorkState, worksetReality: ctx.worksetReality,
      automationReality: ctx.automationReality,
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
    // **큐가 도는 동안 온 응답(안 걷은 호출)도 여기서 덮지 않는다**(F-68 · 반대시험 ⑤) —
    // 다음 반복의 머리가 분리→줄세우기로 걷어 기존 판정·승인·원장을 그대로 태운다.
    if (!대기호출.length && !안걷은호출남았나()) {
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

  // 자동화 제안은 답 뒤 서버가 저장하는 부수효과가 아니다. 승인 가능한 후보 신분과
  // canonical store readback을 먼저 확정하고, 모델은 그 현실을 본 뒤 최종 답을 고른다.
  // 문구를 고치지 않는다 — 입장 결과와 갱신된 현실만 공급한다.
  if (ctx.automationProposal && typeof ctx.admitAutomationProposal === 'function'
    && ctx.automationAdmissionHandled !== true) {
    ctx.automationAdmissionHandled = true;
    const admission = await ctx.admitAutomationProposal(ctx.automationProposal);
    ctx.automationProposal = admission && Object.hasOwn(admission, 'proposal')
      ? admission.proposal : { rejected: true, reason: 'admission_unknown' };
    ctx.automationReality = admission?.reality ?? ctx.automationReality;
    ctx.제안된자동화 = ctx.automationProposal;
    tc = {
      ...tc,
      automationProposal: structuredClone(ctx.automationProposal),
      automationReality: structuredClone(ctx.automationReality),
    };
    finalOut = await ctx.model.respond(tc, {
      search: wantedWeb,
      effort: 'medium',
    });
  }

  // **복합 경로도 잘림을 본다**(J9 · 상태 지도 §12). 예전엔 `답잘림` 이 호출 ① 만 보고 안내는
  // 빠른 경로에만 붙어서, **손을 쓴 턴의 잘린 답**은 아무 말 없이 나갔다. 잘림 사실은
  // **마지막 답을 낸 호출**의 것이다 — 아래 `답완성`·`출구검증` 이 답을 갈아치우면 거기서 갱신된다.
  let reply = userFacingModelText(답으로삼기(ctx, finalOut, ''));
  if (멈춘이유 && !reply.trim()) reply = '';
  // 도구를 빼고 한 번 더 묻는 자리 — **빠른 경로와 같은 계약을 쓴다**(`답완성`).
  // 손은 다시 쥐여 주지 않고 `answerOnly` 사실을 준다. 실제로 도구 예산을 다 쓴 것이 아닌데
  // 소진했다고 말하면 모델이 "손이 없다"는 거짓 상태를 사용자에게 설명한다.
  // **FILE 절대 게이트의 재료**(P-OP 수리 계약 · 2026-08-10) — 이 턴에 파일 산출물 계약이
  // 섰는데 성공한 파일 변경(write·move·delete) 영수증이 0 이라는 **기계 사실.** 출구의
  // 되부름 뒤에도 같은 완료 주장이 반복되면 이 사실이 거짓 답의 회귀를 막는다(절대재검증).
  // 문구 판정이 아니다 — 계약(ActionPlan)과 원장(영수증)의 대조다.
  const 파일계약빈손 = plan.deliverableAssessment === 'file'
    && (plan.deliverables ?? []).length > 0
    && !turnReceipts.some((r) => (r?.failureState ?? 'none') === 'none'
      && r?.actualCall?.tool === 'local.file'
      && ['write', 'move', 'delete'].includes(r?.actualCall?.args?.action)
      && r?.result !== undefined);
  // **이 작업의 산출물 신분**(P-OP S4 마감 · 오너 정정 2026-08-10 — "하나" 고정 금지) —
  // 파일 산출물 계약이 선 턴의 성공 write 들이 작업의 결과물 목록으로 working-state 에 선다
  // (새 저장소 아님 — 세션이 이미 나르는 상태). 실측: 신분 승계("방금 다룬 파일")는 보였는데
  // 산출물 신분이 없어, 열 명세 같은 추가 요청에 모델이 같은 파일을 고치지 않고 새로 만들었다
  // (S4 결과 파일 2개 · 2/4). 판정은 계약(plan)과 원장(영수증)의 대조뿐이다 — 문구 판정 0.
  const 산출물영수증들 = plan.deliverableAssessment === 'file'
    && ctx.deferCompletionSettlement !== true
    ? turnReceipts.filter((r) => (r?.failureState ?? 'none') === 'none'
      && r?.actualCall?.tool === 'local.file'
      && r?.actualCall?.args?.action === 'write'
      && typeof r?.actualCall?.args?.path === 'string'
      && r?.result !== undefined)
    : [];
  if (산출물영수증들.length) {
    workingState = 이어받기정리(deriveWorkingState(workingState, {
      withinTurn: true,
      deliverables: 산출물영수증들.map((r) => ({ path: r.actualCall.args.path })),
    }), ctx.connectors);
  }
  reply = await 답완성({
    reply, tc, ctx, search: wantedWeb, receipts: turnReceipts, 출처계약손: 출처계약손목록(), 파일계약빈손,
  });
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
  if (거짓성공정렬후?.blocked) ctx.답잘림 = false;   // 위와 같은 이유 · 같은 자를 지킨다(J9)
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
  const 완료 = 끝났나 && ctx.deferCompletionSettlement !== true ? {
    status: 'completed',
    request: intent.currentRequest,
    completedTurn: workingState.turnNo,
    subjects: (workingState.subjects ?? []).filter((s) => s.lastTurn === workingState.turnNo)
      .map((s) => s.label).filter(Boolean).slice(0, 4),
  } : undefined;
  if (완료) workingState = { ...workingState, recentOutcome: 완료 };

  // ── 수명주기 v2(2026-08-09 · 코덱스 지적 타당 판정) ──────────────────────────
  //
  // 위 완료 판정은 "실제로 성공한 실행 하나 이상"을 요구한다 — 실행 턴에는 맞는 계약이지만,
  // **도구 0 인 대화 턴은 답을 다 내고도 영원히 완료가 못 된다.** 그 턴이 세운 목표(아래
  // `goal`)가 안 닫힌 채 세션에 남아 다음 턴 입장 판정(isGoalRelevant)의 **낡은 목표
  // 공급원**이 된다 — 들어오는 문(입장 판정)만 좁힌 v1 이 낡은 목표를 계속 만드는 이 뿌리를
  // 안 건드렸다(12턴형 병의 수명주기 쪽 절반).
  //
  // 답을 낸 대화 턴은 그 턴의 목표를 소진시킨다. `완료`(recentOutcome)로 올리지는 않는다 —
  // 그 계약은 "실행 결과로 정한다"가 정체성이고, 대화 답을 완료 실적으로 적으면 모델 앞
  // 사실("최근 완료한 일")의 뜻이 넓어진다. 여기서 닫는 것은 **목표 수명** 하나다.
  //
  // 관통 조건(여러 턴짜리 작업의 중간 대화 턴에서 목표가 일찍 죽지 않는다): 그런 턴은
  // 미확인·대기 승인·기다리는 표면·막힘·멈춘이유 중 하나를 반드시 지니므로 아래가 거짓이
  // 된다. 승인 카드 턴은 위에서 이미 `goal` 을 실은 채 반환됐고, 빠른 경로(도구 무관 잡담)는
  // `goal` 자체를 안 실어 기존 목표를 건드리지 않는다 — 이 자리는 본 경로의 대화 턴뿐이다.
  const 대화턴소진 = turnReceipts.length === 0
    && !멈춘이유
    && reply.trim().length > 0
    && plan.deliverableAssessment !== 'unknown'
    && projection.unconfirmed.length === 0
    && (ctx.pending?.size ?? 0) === 0
    && !(workingState.awaiting?.length)
    && !workingState.blocked;

  return {
    kind: 'reply',
    // J9 — 빠른 경로와 **같은 안내, 같은 자**다. 손을 썼다고 잘림이 덜 잘린 것이 되지 않는다.
    reply: 잘림말붙이기(reply, ctx.답잘림),
    identityUpdate: ctx.identityUpdate, // P-ID-1: 승인 재개 경로에서도 이름 지정을 잃지 않는다
    usedSkill: ctx.usedSkill,           // Phase 0-4: 어떤 배운 작업이 도왔는지(조용히 바뀌지 않는다)
    selfStateSummary: summary,
    exitNetDiagnostic: ctx.출구그물,     // 진단면 — 출구 그물이 물었는가(회차 원본 계측)
    screenPlaceDiagnostic: ctx.화면자리지연, // F-54 지연 실측(PM 조건 2 · 진단면)
    filePlaceDiagnostic: ctx.파일자리지연,   // ③ 완성 — 내용 동봉 비용 실측(진단면)
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
    // 대화 턴의 목표 소진(수명주기 v2)도 같은 자리에서 닫힌다 — 위 주석 블록 참조.
    goal: (완료 || 대화턴소진) ? null : { understoodTask: plan.understoodTask, successCriteria: plan.successCriteria },
    // **소진과 "세운 적 없음"은 다른 사실이다.** 정산 게이트(P90-1)는 "이 턴이 작업을
    // 세웠는가"를 구조 사실로 묻는데, 그 신호가 `goal` 의 truthy 에 얹혀 있었다 — 목표
    // 수명을 닫자 정산까지 함께 꺼졌다(시험 3건 빨강으로 잡힘). 두 소비자를 한 필드에
    // 태우지 않는다: 지속할 목표는 `goal`, 이 턴이 세웠다 소진한 목표는 `spentGoal` 로 나른다.
    ...(대화턴소진 && !완료 ? { spentGoal: { understoodTask: plan.understoodTask, successCriteria: plan.successCriteria } } : {}),
    // 자기 파악 세 번째 축 — 서버가 세션에 지속해 다음 턴이 "그거"를 이어받는다.
    workingState,
    // **이번 턴에 모델이 실제로 부른 것** — 다음 턴이 이어받아 자기 이력으로 되돌려 준다
    // (정본 §S2 필수 계약 ②). 서버가 대화에 함께 저장해 재시작 뒤에도 살아남는다.
    // 여기서 다시 만들지 않는다 — 모델 앞에 실제로 놓였던 그 배열을 넘기되, **실패 원문만 걷는다**:
    // §5-3 은 모델 입력과 사용자 출력을 가른다. `실패원문`(진단면 원문)은 모델 입력에만 살고,
    // 저장 봉투·사용자 결과에는 안 실린다 — 내부 오류/연결/전송 진단이 사용자 결과에 새지
    // 않는 봉인(recovery-failure-injection A·B·B')이 이 자리를 문다. 다음 턴 priorExchange 는
    // 어차피 신분·요약·인자만 옮기므로(task-context E1) 여기서 걷어도 잃는 것이 없다.
    turnExchange: (tc?.turnExchange ?? []).map(({ 실패원문, 확인안됨, ...남는것 }) => 남는것),
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
