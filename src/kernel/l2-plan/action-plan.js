// L2 · ActionPlan (§4) — IntentPacket 의 출구. 실행 계획이지 실행이 아니다.
// toolsToUse 는 SelfState 가 실행 가능 판정한 것만. needsApproval 은 A2·A3.
import { isToolExecutable } from '../l0-evidence/self-state.js';
import { toolLabel } from '../tool-labels.js';
import { grantFor, UNKNOWN_KIND, isSafetyFloor } from './authority.js';
import { containsSensitivePayload } from '../l0-evidence/sensitive-text.js';
import { counterpartRef } from './known-counterpart.js';
import { isSendTool } from '../contracts.js';

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
    case 'write': case 'move': case 'bulk_move': case 'undo': return 'write';
    // versions 는 읽기 전용 판별(같은 이름 식구의 시각·내용 대조)이다 — 파일을 바꾸지 않는다.
    case 'read': case 'list': case 'versions': return 'read';
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
    case 'bulk_move': return args.to ? `${name} 안의 조건 맞는 파일들을 ${args.to} 로 옮깁니다` : `${name} 안의 조건 맞는 파일들을 옮깁니다`;
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
  // **CU C — 화면 행동은 무엇을 하느냐로 갈린다**(2026-08-05). `local.file` 과 같은 모양이다:
  // 같은 손이 되돌릴 수 있는 일도 하고 없는 일도 한다. 손 하나로 뭉개면 둘 중 하나가 틀린다.
  //
  //   focus·scroll·move·resize   창을 앞으로 띄우고 내리고 옮긴다 — **되돌릴 수 있다**
  //   launch                     켠 것은 끄면 된다 — 되돌릴 수 있다
  //   quit                       **저장 안 된 것이 날아간다** — 헌장 ②(되돌릴 수 없는 파괴)
  //
  // 되돌릴 수 있는 넷까지 물으면 카드가 늘고, **카드가 늘어나는 변경은 개선이 아니라 실패다**(§3.1).
  // 모르는 행동은 읽기로 흘리지 않는다 — 모름은 자동이 아니라 확인 쪽이다.
  if (toolId === 'desktop.act') {
    const a = args?.action;
    // **아무것도 안 바꾸는 것은 자동**(흡수 ④): 기다리기·복사는 화면을 안 건드린다.
    // 창을 옮기고 띄우는 넷은 되돌릴 수 있다 — 그건 예전부터 자동이었다.
    if (a === 'focus' || a === 'scroll' || a === 'move' || a === 'resize' || a === 'launch'
      || a === 'wait' || a === 'copy') kind = 'read';
    // **누르기·입력은 돌려 봐야 안다**(CU E). D 에서는 무조건 `organize` 였고,
    // 그래서 **"보내기 눌러줘"가 카드 없이 나갔다.** 위험을 버튼 이름으로 알아맞히지 않는다 —
    // 문구 목록은 항상 뚫리고, 화면 문구로 등급을 정하는 건 A10 을 정면으로 어긴다.
    //
    // 대신 **손의 probe 가 화면에 다시 물어본 사실**로 가른다(터미널과 같은 길이다):
    //   값이 있는 요소(체크박스·스위치·글자칸)  전후 대조가 자명하고 다시 놓으면 돌아온다 → 자동
    //   값이 없는 버튼                          눌러 보기 전엔 모르고 되돌릴 방법도 없다 → 미상
    //   못 찾음 · 돌려 본 사실 없음             **모름은 자동이 아니라 확인 쪽이다** → 미상
    //
    // 모델이 인자에 `value` 를 적어 내도 소용없다 — probe 는 화면이 준 요소만 본다.
    // **누르고 넣는 것은 돌려 봐야 안다.** 새로 받는 것들(맥락 메뉴·Enter·단축키·끌기·
    // 붙여넣기)도 같은 규율이다 — 무엇이 되는지 모르면 묻는다. 값이 있는 요소를 다루는
    // 것만 자동이다(전후 대조가 자명하고 다시 놓으면 된다).
    else if (a === 'click' || a === 'type' || a === 'double_click' || a === 'right_click'
      || a === 'press_key' || a === 'hotkey' || a === 'menu' || a === 'paste' || a === 'drag') {
      // **바깥으로 나가는 걸음은 값이 있어도 카드다**(라이브 2026-08-06).
      //
      // 예전엔 이 신호를 승인 경계가 **보지도 않았다.** 손이 자기 자리에서 통째로 막고 있었고
      // (*"아직 제가 누르지 않아요"*), 승인 경계는 값 없는 버튼이라 미상으로 잡았을 뿐이다.
      // 그래서 밝히면 영영 못 하고 **안 밝히면 그냥 나갔다** — 정직함이 벌받는 구조였다.
      // 잠금은 여기 한 자리다: 밝히면 반드시 묻고, 허락이 나면 손은 한다.
      // **좌표로 짚은 걸음은 언제나 묻는다**(오너 2026-08-06 · 손과 눈).
      // 눈으로 본 자리는 이름이 없다 — 무엇이 되는지도, 되돌아가는지도 약속할 수 없다.
      // 그래서 손은 받되(못 만지는 창을 만들지 않는다) 등급은 미상이다.
      const 좌표로짚음 = Number.isFinite(Number(args?.대상?.x)) && Number.isFinite(Number(args?.대상?.y))
        && !args?.대상?.토큰 && args?.대상?.번호 == null && !args?.대상?.id;
      // 커서 자리에 치는 입력도 같다 — **커서가 어디 있는지 우리가 모른다.**
      // 탐침이 그 칸을 **찾았으면** 요소를 아는 것이다 — 그때는 예전 그대로 자동이다.
      const 커서에침 = a === 'type' && !Object.keys(args?.대상 ?? {}).length
        && args?.눌러본사실?.찾음 !== true;
      // **바깥으로 나가는 걸음은 미상이 아니라 전송이다**(F-58 · PM 승인 2026-08-09).
      //
      // 예전엔 `UNKNOWN_KIND` 였고 미상은 조건 없이 항상 카드라, 헌장 ③ 의 조건
      // (`counterpartKnown` — 아는 상대에겐 안 묻는다)에 **닿지도 못했다.** 그래서 같은
      // "카톡에 이 말 보내기"가 채널 손으로는 한 번만 묻고 화면 손으로는 매번 물었다 —
      // 사거리 비대칭병이고, 사용자에게는 같은 일이다.
      // 안전은 안 풀린다: `send` 도 헌장 ③ 이라 **새 상대면 반드시 카드**이고, 신분이 안
      // 서면(정규화 실패) 상대를 모르는 것이므로 역시 카드다(fail-closed).
      // 좌표로 짚은 걸음·커서에 치는 입력은 그대로 미상이다 — 그 규율은 손대지 않는다.
      kind = 좌표로짚음 || 커서에침 ? UNKNOWN_KIND
        : args?.기대?.바깥으로 === true ? 'send'
          : args?.눌러본사실?.값있음 === true ? 'organize' : UNKNOWN_KIND;
    }
    else if (a === 'quit') kind = 'write';
    else kind = UNKNOWN_KIND;
  }
  // P6-T2: 명령은 **돌려 봐야 안다.** 계획 단계에서 probe(쓰기·네트워크·비밀읽기 차단)를 돌리고
  // 그 결과가 등급을 정한다 — 위험 명령 목록으로 알아맞히지 않는다(목록은 항상 뚫린다).
  // probe 결과가 없으면 '미상'으로 둔다: 모르면 승인으로 간다(read 로 흘리지 않는다).
  if (toolId === 'local.terminal') {
    kind = args?.changes === true ? 'write' : args?.changes === false ? 'read' : UNKNOWN_KIND;
  }
  // 외부 전송의 본문에 민감값이 있으면 일반 send(A2)가 아니라 export_sensitive(A3)다.
  // 모델의 자기신고가 아니라 실제 실행 인자에서 파생하므로 새 전송 도구도 같은 경계를 탄다.
  if (kind === 'send' && containsSensitivePayload(args)) kind = 'export_sensitive';
  // **여기서 종류를 바꾸지 않는다.** 예전엔 승인을 강제하려고 `kind = 'send'` 로 바꿔 달았고,
  // 그래서 조회·연결 카드에까지 "메시지를 실제로 밖으로 보내는 일이라"가 떴다(실측 2026-07-28).
  // 강제는 이제 authority 가 `needsApproval` 사실로 한다 — 등급만 올리고 이름은 사실대로 둔다.
  return kind;
}

/**
 * @param {Object} p
 * @param {import('../contracts.js').IntentPacket} p.intent
 * @param {import('../contracts.js').SelfStateSnapshot} p.selfState
 * @returns {import('../contracts.js').ActionPlan}
 */
export function buildActionPlan(p) {
  // `knownCounterparts` — 이 대화에서 사용자가 이미 허락한 상대들(세션 범위 · PM 판정
  // 2026-08-09: 영속은 사용자가 명시로 넓힐 때만이고 그때는 기억 계약을 탄다).
  const { intent, selfState, mode, knownCounterparts } = p; // mode(P6-15): 저위험 통과 강도. 안전 바닥은 불변.
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
    // **모델이 고른 인자로 판정한다.** 도구마다 여기 분기를 늘리면 새 도구가 생길 때마다
    // 조용히 새어 나간다 — 실측: local.process 를 안 넣어서 "서버 띄워봐"가 승인 없이 실행됐다.
    // 판정과 실행이 **같은 인자**를 봐야 한다(두 진실 금지).
    // terminal 은 probe 를 거친 terminalOp 가, file 은 파싱을 거친 fileOp 가 더 정확하다.
    // 그 둘이 없는 도구는 **모델이 고른 인자**로 판정한다 — 여기 분기가 없다고 빈 인자로
    // 판정하면 위험한 작업이 조용히 새어 나간다(local.process 의 start 가 그렇게 실행됐다).
    const 판정인자 = (id === 'local.terminal' ? intent.terminalOp
      : id === 'local.file' ? intent.fileOp
        : undefined) ?? intent.toolArgs?.[id];
    let kind = toolActionKind({ toolId: id, args: 판정인자, selfState });
    // 승인 카드는 **이번 요청의 구체 사실**을 말해야 한다. "로컬 파일 실행"으로는 무엇이 사라지는지
    // 알 수 없다(실측). 되돌릴 수 있는지도 종류가 아니라 **도구가 밝힌 사실**을 쓴다.
    const reversible = tool?.reversible;
    const cancelText = reversible === true ? (tool.reversibleNote ?? '되돌릴 수 있어요')
      : reversible === false ? '실행한 뒤에는 되돌릴 수 없어요'
        : (kind === 'delete' ? '되돌리기 어려울 수 있어요' : '되돌릴 수 있어요');
    // **도구가 만든 미리보기가 먼저다.** 도구는 자기가 무엇을 하는지 가장 정확히 안다.
    // 여기 도구별 if 를 늘리면 새 도구마다 "○○ 실행" 이라는 빈 문구가 또 나온다 —
    // 사용자가 무엇을 허락하는지 모르는 승인은 승인이 아니다(실측: "실행 중인 것 실행").
    const 도구미리보기 = intent.toolPreviews?.[id];
    const preview = () => (도구미리보기 ? { cancel: cancelText, ...도구미리보기 } : {
      impact: describeAction(id, 판정인자) ?? `${toolLabel(id, selfState)} 실행`,
      scope: '이번 요청',
      duration: '이번 한 번',
      cancel: cancelText,
    });
    // **아는 상대인가** — 헌장 ③ 의 조건을 여기서 세운다(F-58).
    // 계약(`counterpartKnown`)과 신분 만드는 자리(`known-counterpart.js`)는 있었는데
    // **둘을 잇는 배선이 없었다** — 그래서 조건이 영영 참이 되지 않았고 채널 손조차
    // 매번 물었다(집 파일 P0 와 같은 모양: 만들어 놓고 안 이었다).
    // 열쇠는 **카드가 보여 준 그 실질**이다(PM 조건 ①): 화면 손은 previewOf 가 낸
    // `발신실질`, 채널 손은 실행 대상 값. 둘 다 없으면 모르는 상대다(fail-closed).
    const 상대열쇠 = 도구미리보기?.발신실질
      ?? (isSendTool(id, selfState) ? counterpartRef(id, 판정인자?.target ?? intent.sendArgs?.[id]?.target) : null);
    const counterpartKnown = Boolean(상대열쇠)
      && (knownCounterparts instanceof Set ? knownCounterparts : new Set(knownCounterparts ?? [])).has(상대열쇠);
    const asAction = (k) => ({
      label: id, kind: k, preview: preview(),
      ...(상대열쇠 ? { 상대열쇠 } : {}),
      counterpartKnown,
      revocable: reversible, reversibleNote: tool?.reversibleNote,
      // 도구 선언이 확인을 요구한다는 **사실**을 그대로 넘긴다 — 종류를 바꿔 흉내 내지 않는다.
      needsApproval: tool?.needsApproval,
    });
    const grant = grantFor(asAction(kind), mode);
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
    // 요청의 결과 형태는 모델이 판단하고, 충족 여부는 실제 영수증으로만 판정한다.
    deliverables: intent.deliverables ?? [],
    // 전용 판단이 형식을 지키지 못한 경우 CHAT 으로 꾸미지 않고 완료 상태만 보류한다.
    deliverableAssessment: intent.deliverableAssessment ?? 'not_applicable',
  };
}
