// L2 · ActionPlan (§4) — IntentPacket 의 출구. 실행 계획이지 실행이 아니다.
// toolsToUse 는 SelfState 가 실행 가능 판정한 것만. needsApproval 은 A2·A3.
import { isToolExecutable } from '../l0-evidence/self-state.js';
import { toolLabel } from '../tool-labels.js';
import { grantFor, UNKNOWN_KIND, isSafetyFloor } from './authority.js';

// 도구 id → 권한 종류(범주). 실행 종류를 권한 등급으로 잇는다.
/**
 * 파일 작업 종류 → 권한 종류. **도구가 아니라 작업으로 판정한다** — 같은 도구가 읽기도 삭제도 하므로
 * 도구 단위로 kind 를 고정하면 삭제가 organize 로 새어 안전 바닥(항상 승인)을 건너뛴다(실사용에서 확인).
 */
export function fileKind(fileOp) {
  switch (fileOp?.action) {
    case 'delete': return 'delete';
    // 옮기기·되돌리기도 **사용자 파일을 바꾼다**. organize(A1 자동 진행)로 두었더니 "옮겨줘" 한 마디에
    // 승인 없이 파일이 사라졌다(감사 실증). 사용자 체감은 삭제와 같다 — 안전 바닥으로 올린다.
    case 'write': case 'move': case 'undo': return 'write';
    case 'read': case 'list': return 'read';
    // **모르면 read 로 흘리지 않는다.** fileOp 가 없는 경로(스킬이 도구만 밀어 넣는 경우)에서
    // read 로 떨어져 삭제가 승인 없이 실행됐다. 미상은 승인으로 간다.
    default: return UNKNOWN_KIND;
  }
}

/**
 * 이번 실행이 무엇을 하는지 **사용자 말로**. 대상이 없으면 null 을 주고 호출자가 라벨로 떨어진다.
 * 도구가 늘어나면 여기에 한 줄씩 — 사례 전용이 아니라 도구별 서술이다.
 */
export function describeAction(toolId, args) {
  // 승인 카드는 **이번 명령의 원문**을 보여야 한다. "터미널 실행"으로는 무엇을 허락하는지 모른다.
  if (toolId === 'local.terminal') {
    if (!args?.command) return null;
    return `${args.command}${args.cwd ? ` (${args.cwd} 에서)` : ''}`;
  }
  if (toolId !== 'local.file' || !args?.action) return null;
  const name = args.path ? String(args.path) : '그 파일';
  switch (args.action) {
    case 'delete': return `${name} 을(를) 지웁니다`;
    case 'write': return `${name} 에 내용을 저장합니다(기존 내용은 휴지통으로)`;
    case 'move': return args.to ? `${name} 을(를) ${args.to} 로 옮깁니다` : `${name} 을(를) 옮깁니다`;
    case 'undo': return '방금 한 파일 작업을 되돌립니다';
    default: return null;
  }
}

const TOOL_KIND = {
  'mail.send': 'send',
  'slack.post': 'send',
  'telegram.send': 'send',
  'local.file': 'organize',
  'web.collect': 'read',
};

/**
 * 이 실행이 **무슨 종류의 행동인가**. 도구 id 만으로는 답이 안 나온다 — `local.file` 은 같은 도구가
 * 읽기도 삭제도 한다. 승인·자동화·tick 이 각자 자기 방식으로 판정하면 한 곳을 고쳐도 다른 곳으로
 * 샌다(실제로 그렇게 샜다: 턴은 삭제를 막았는데 자동화 tick 이 같은 삭제를 무인 실행했다).
 * @param {{toolId:string, args?:object, selfState?:object}} p  args 는 파일 도구의 fileOp({action,...})
 */
export function toolActionKind({ toolId, args, selfState }) {
  const tool = selfState?.connectedTools?.find((t) => t.id === toolId);
  let kind = tool?.toolKind ?? TOOL_KIND[toolId] ?? UNKNOWN_KIND;
  if (toolId === 'local.file') kind = fileKind(args);
  // P6-T3: 프로세스도 **작업으로 판정한다.** 도구 하나로 뭉뚱그리면 켜기까지 자동으로 새어
  // 사용자가 모르는 사이 포트가 점유된다(라이브 실측: "서버 띄워봐"에 승인 없이 떴다).
  if (toolId === 'local.process') {
    const a = args?.action ?? 'status';
    // 보기·로그는 읽기다 — 확인마다 승인을 물으면 사용자가 기계적으로 누르게 된다.
    if (a === 'status' || a === 'list' || a === 'logs') kind = 'read';
    // 켜기는 포트를 잡고 턴을 넘어 살아남는다 — 사용자의 결정이다.
    else if (a === 'start') kind = 'write';
    // 끄기는 사용자가 이미 "꺼줘"라고 말한 것이고 되돌릴 수 있다(다시 켜면 된다).
    else if (a === 'stop') kind = 'organize';
    else kind = UNKNOWN_KIND; // 모르는 작업은 승인으로
  }
  // P6-T2: 명령은 **돌려 봐야 안다.** 계획 단계에서 probe(쓰기·네트워크·비밀읽기 차단)를 돌리고
  // 그 결과가 등급을 정한다 — 위험 명령 목록으로 알아맞히지 않는다(목록은 항상 뚫린다).
  // probe 결과가 없으면 '미상'으로 둔다: 모르면 승인으로 간다(read 로 흘리지 않는다).
  if (toolId === 'local.terminal') {
    kind = args?.changes === true ? 'write' : args?.changes === false ? 'read' : UNKNOWN_KIND;
  }
  // descriptor 가 승인을 요구하면 등급이 낮게 나와도 최소 A2 로 올린다(하드코딩 우회 차단).
  if (tool?.needsApproval && !isSafetyFloor(kind)) kind = 'send';
  return kind;
}

/**
 * @param {Object} p
 * @param {import('../contracts.js').IntentPacket} p.intent
 * @param {import('../contracts.js').SelfStateSnapshot} p.selfState
 * @returns {import('../contracts.js').ActionPlan}
 */
export function buildActionPlan(p) {
  const { intent, selfState, mode } = p; // mode(P6-15): 저위험 통과 강도. 안전 바닥은 불변.
  const needed = intent.neededTools ?? [];

  // 실행 가능한 도구만 계획에 올린다(목록 존재 ≠ 실행 가능).
  const toolsToUse = needed.filter((id) => isToolExecutable(selfState, id));
  const blockedTools = needed.filter((id) => !isToolExecutable(selfState, id));

  const autoAllowed = [];
  /** @type {import('../contracts.js').AuthorityGrant[]} */
  const needsApproval = [];
  for (const id of toolsToUse) {
    // 권한 종류는 descriptor(toolKind)를 먼저 믿는다 — 하드코딩 맵에 없어도 새 도구가 새지 않게.
    // toolKind가 아예 없으면(권한 종류 미상) read로 흘리지 않고 unknown으로 둔다 → 자동 진행 금지(감사 blocker).
    //   단, 기존 known id(web.collect 등)는 TOOL_KIND 맵으로 그대로 동작한다.
    // Phase 0-1: local.file 은 같은 도구가 보기·읽기·쓰기·삭제를 모두 한다. 작업으로 판정하지 않으면
    // 삭제가 organize 로 새어 승인 없이 실행된다(오너 실사용에서 실제로 새었다).
    // 판정은 toolActionKind 하나로 모은다 — 승인·자동화·tick 이 같은 답을 봐야 한다.
    const tool = selfState.connectedTools.find((t) => t.id === id);
    let kind = toolActionKind({ toolId: id, args: id === 'local.terminal' ? intent.terminalOp : intent.fileOp, selfState });
    // 승인 카드는 **이번 요청의 구체 사실**을 말해야 한다. "로컬 파일 실행"으로는 무엇이 사라지는지
    // 알 수 없다(실측). 되돌릴 수 있는지도 종류가 아니라 **도구가 밝힌 사실**을 쓴다.
    const reversible = tool?.reversible;
    const cancelText = reversible === true ? (tool.reversibleNote ?? '되돌릴 수 있어요')
      : reversible === false ? '실행한 뒤에는 되돌릴 수 없어요'
        : (kind === 'delete' ? '되돌리기 어려울 수 있어요' : '되돌릴 수 있어요');
    const preview = () => ({
      impact: describeAction(id, id === 'local.terminal' ? intent.terminalOp : intent.fileOp) ?? `${toolLabel(id, selfState)} 실행`,
      scope: '이번 요청',
      duration: '이번 한 번',
      cancel: cancelText,
    });
    const asAction = (k) => ({
      label: id, kind: k, preview: preview(),
      revocable: reversible, reversibleNote: tool?.reversibleNote,
    });
    let grant = grantFor(asAction(kind), mode);
    if (tool?.needsApproval && !grant.approvalRequired) {
      kind = 'send'; // 최소 A2로 승인 강제(하드코딩 우회 차단)
      grant = grantFor(asAction(kind), mode);
    }
    if (grant.approvalRequired) needsApproval.push(grant);
    else autoAllowed.push(id);
  }

  const forbidden = [];
  if (intent.unwantedRisk) forbidden.push(intent.unwantedRisk);

  return {
    understoodTask: intent.desiredOutcome,
    contextToUse: intent.relatedContext ?? [],
    toolsToUse,
    autoAllowed,
    needsApproval,
    forbidden,
    successCriteria: `요청 달성: ${intent.desiredOutcome}`,
    recoveryCriteria: blockedTools.length
      ? `막힌 도구(${blockedTools.map(toolLabel).join(', ')})는 연결·대체 안내로 이어간다`
      : '실패 시 무엇이 안전하고 다음 안전 행동을 제시한다',
    // 실행 불가로 계획에서 빠진 도구를 정직하게 남긴다(죽은 버튼 금지, 복구 근거).
    blockedTools,
  };
}
