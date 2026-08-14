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
    // copy·bulk_copy(F-120)는 원본 무접촉·undo=사본 치우기라 파괴가 없지만, **특례 등급을
    // 내지 않는다** — 검사 불변식("읽기·목록·versions 외 파일 동사는 전부 승인 판정을
    // 지난다")이 바꾸는 동사 전부를 한 차선에 세워 두었다(보호는 카드가 아니라
    // 원장+되돌리기가 산다 · 자동성 헌장). 동사마다 차선이 갈라지면 한 곳을 고치면 다른
    // 곳으로 샌다(:60-62 사고). 실마찰도 안 는다 — 같은 write 차선의 bulk_move 가
    // 라이브에서 카드 0 으로 돌았다(과업3).
    case 'copy': case 'bulk_copy': return 'write';
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
    case 'copy': return args.to ? `${name} 을(를) ${args.to} 로 복사합니다(원본은 그대로)` : `${name} 을(를) 복사합니다(원본은 그대로)`;
    case 'bulk_copy': return args.to ? `${name} 안의 조건 맞는 파일들을 ${args.to} 로 복사합니다(원본은 그대로)` : `${name} 안의 조건 맞는 파일들을 복사합니다(원본은 그대로)`;
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
      //
      // **창의 칸에 글자를 넣는 일은 `field_input` 이다**(F-58 (가-2) · PM 판정 2026-08-09).
      //
      // 실물 회차가 남긴 사실: 모델은 같은 일을 매번 다른 모양으로 부른다 — 첫 발신 카드
      // 넷 중 하나만 `바깥으로` 를 신고했고, 두 번째 걸음은 신고 없이 왔다. 열쇠를 모델의
      // **자기 신고에 걸면** 같은 방·같은 문구인데 부르는 모양에 따라 마찰이 갈린다
      // ("모델은 같은 답을 낼 수 없다" — 오너). 그래서 신고가 아니라 **기계가 아는 사실**
      // (type · 요소로 짚음)로 종류를 세운다. 그 칸이 전송 입력인지 메모인지 기계가 모르므로
      // 기본은 무조건 카드고, 조용해지는 칸은 「아는 상대 + 같은 내용 + 창 신분 성립」
      // 하나뿐이다(authority.js `isCharterAsk` · 안전 대차 봉인이 문다). 값 있는 칸 입력이
      // 예전엔 organize(자동)였는데 — 탐침이 선 대화 입력칸이면 **카드 없이 밖으로 나갈 수
      // 있는 구멍**이었다. 카드가 늘어나는 쪽 변화는 PM 조건 ②로 승인된 값이다.
      // **엔터도 칸 내용이 기계로 읽히면 미상이 아니다**(F-58 (a) · PM 판정 2026-08-10).
      // 탐침이 그 창의 글자칸 내용을 읽었으면(정확히 한 칸 · 보안 칸 제외 · fail-closed)
      // "그 내용이 담긴 칸에서 엔터"는 field_input 의 사실 가족이다 — (가-2)가 type 에 한
      // 일(신고 대신 기계 사실로 신분)을 엔터 걸음에 마저 한 것. 못 읽으면 미상 그대로 카드다.
      // 키는 return/enter 만이다 — 다른 키는 그 칸의 내용을 실행하는 걸음이 아니다.
      const 엔터걸음 = a === 'press_key' && /^(return|enter)$/i.test(String(args?.값 ?? '').trim())
        && typeof args?.눌러본사실?.칸내용 === 'string' && args.눌러본사실.칸내용.trim() !== '';
      // ── 결재 ① 의 나머지 절반 — **검색 칸의 엔터는 전송이 아니라 확정이다** (§5-2 · 2026-08-12) ──
      //
      // 검색창에 친 글자를 실행하는 엔터는 질의를 그 화면에 내는 걸음이지 상대에게 보내는
      // 걸음이 아니다 — 종류의 사실은 `search` 다(헌장 ③ 의 「상대」가 없다). 판정 재료는
      // 문구·앱 이름이 아니라 탐침이 읽은 **그 칸의 AX 역할 하나**다(AXSearchField —
      // 앱별 패치가 아니라 기계 사실). 실측(2026-08-11): 네이버 검색 한 문장에 카드 2장이
      // 떴고 그중 하나가 이 엔터였다 — 검색 확정에 뜨는 카드는 안전이 아니라 마찰이다.
      // 역할이 안 읽히면 이 가지는 안 선다 → `field_input` 그대로(fail-closed). 채팅
      // 입력칸(AXTextArea·AXTextField)은 여기 안 걸리고 헌장 ③ 게이트가 그대로 문다.
      const 검색확정 = 엔터걸음
        && /^AXSearchField$/i.test(String(args?.눌러본사실?.칸역할 ?? '').trim());
      // ── **결재 ① 집행 — 칸에 글자 넣기는 자동이다** (오너 승인 · 지시 2026-08-11) ──
      //
      // (가-2)가 `type` 을 통째로 `field_input`(기본 카드)으로 올린 것은 *"그 칸이 전송
      // 입력인지 메모인지 기계가 모른다"* 는 이유였다. **그 이유는 여기서 안 무너진다** —
      // 카드는 자리를 옮길 뿐이다. 밖으로 나가는 걸음 셋이 아래에 그대로 서 있다:
      //   · 신고된 전송(`기대.바깥으로`)      → `send`(바로 위 줄)
      //   · 칸 내용이 실린 엔터(`엔터걸음`)   → `field_input`
      //   · 전송·결제 버튼(값 없는 버튼)      → `UNKNOWN_KIND`
      // 글자를 **넣는 것**과 그 글자를 **보내는 것**은 다른 걸음이고, 카드는 뒤에 붙는다.
      //
      // 실측이 그 대가를 냈다(2026-08-11): 네이버 한 문장이 카드 2장(=사용자 손 2회)이었고,
      // 그다음 회차에서는 T5 가 아예 *"검색창에 직접 글자를 입력하는 행동은 제 권한으로는
      // 아직 못 합니다"* 라고 **거짓 무능**을 답했다. 30분 전 같은 판에서 친 손이다.
      // 마찰이 능력 진술까지 갉았다 — 오너 규율: *"자동성이 의무다. 승인으로 안전을 사지 마라."*
      //
      // 자동은 **조건 셋을 모두** 세울 때만이다(하나라도 못 세우면 카드 · fail-closed):
      //   ① 요소로 짚었다        좌표·커서는 위에서 이미 미상으로 빠진다(그 규율 그대로)
      //   ② 그 요소가 보안 칸이 아니다   헌장 ①(비밀값은 사람만). 탐침도 보안 칸을
      //                                「찾음」으로 안 내주지만, 판정 자리에도 세운다
      //   ③ 그 창의 요소 목록을 실제로 읽어냈다   `찾음:true` 가 그 기계 사실이다.
      //                                 못 읽었으면 무엇에 넣는지 모르는 것이다
      const 짚은칸에넣기 = a === 'type'
        && args?.눌러본사실?.찾음 === true                        // ①③
        && args?.눌러본사실?.보안칸 !== true                       // ②
        && !/secure/i.test(String(args?.눌러본사실?.역할 ?? ''));   // ② 역할로도 한 번 더
      kind = 좌표로짚음 || 커서에침 ? UNKNOWN_KIND
        : args?.기대?.바깥으로 === true ? 'send'
          : 짚은칸에넣기 ? 'organize'
            : 검색확정 ? 'search'
              : a === 'type' || 엔터걸음 ? 'field_input'
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
    const 아는상대집합 = knownCounterparts instanceof Set ? knownCounterparts : new Set(knownCounterparts ?? []);
    const counterpartKnown = Boolean(상대열쇠) && 아는상대집합.has(상대열쇠);
    // ⛔ **(가) 1차 시도는 게이트가 막았다 — 되돌렸다**(2026-08-09). 여기서 `kind = 'send'` 로
    // 올렸더니 게이트 §종류 보존이 물었다(*"위층이 아래층의 종류를 바꿔 부르지 않는다"*).
    // 규율이 맞다. **종류는 사실이고 등급은 조건**이다 — 이 기록은 지우지 않는다.
    //
    // → **(가-2) 로 닫혔다**(PM 판정 2026-08-09): 올바른 자리인 종류 판정(`toolActionKind`)에
    // 사실 층의 정확한 이름 `field_input`(창의 칸에 글자 넣기)이 섰다. 기본은 무조건 카드,
    // 조용해지는 칸은 「아는 상대 + 같은 내용 + 창 신분 성립」 하나뿐(authority.js).
    // **계획 층(여기)은 종류를 건드리지 않는다** — 조건(counterpartKnown)만 세워서 넘긴다.
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
