// L4 · Toolbox View (2.0-A). 도구함/연결 표면이 보여줄 **사용자 언어** 상태를 실제 runtime에서 투영한다.
// 감사 기준(2.0 §10): UI 상태 = 실제 SelfStateSnapshot·ToolDescriptor에서 온 상태만. 없는 도구를
//   있는 것처럼 보이지 않는다. 설치됨≠실행가능≠승인. 기술 용어(MCP/schema/token) 노출 금지.
// 순수 투영(부작용 0) — 서버가 buildSelfState(env) + descriptors를 넣는다.

// 내부 status → 상태 점(2.0 §4.2). 초록=사용가능/노랑=연결필요/빨강=차단/회색=비활성.
const STATUS_DOT = {
  usable: 'green',
  needs_auth: 'yellow',
  needs_config: 'yellow',
  needs_connection: 'yellow',
  blocked: 'red',
};
// 내부 status → 사용자 언어(2.0 §4.5). 기술 용어를 쓰지 않는다.
const STATUS_TEXT = {
  usable: '사용 가능',
  needs_auth: '연결이 필요해요',
  needs_config: '설정이 필요해요',
  needs_connection: '연결이 필요해요',
  blocked: '지금 사용할 수 없어요',
};

// toolKind → 사용자 언어 카테고리(2.0 §4.3). 일반 사용자 업무 단위.
function categoryOf(d) {
  if (d.sessionMode || d.sourcePolicy) return '브라우저/웹';
  if (d.toolKind === 'send') return '메신저';
  if (d.toolKind === 'organize') return '로컬 파일';
  if (d.toolKind === 'read') return '브라우저/웹';
  return '기타';
}

// toolKind·정책 → 사용자 언어 능력 배지(§4.5의 읽기/쓰기/전송 + 출처/승인).
// **문구는 사실이어야 한다**(오너 지시 2026-08-12 · 헌장 ③). 전송은 이제 *"실행 전에"* 가
// 아니라 **처음 보내는 상대에게만** 확인을 받는다(`authority.js` `decideAutoGrant` — 손 선언이
// 헌장 ③ 의 조건 `counterpartKnown` 을 덮던 자리를 걷었다). 옛 문구를 그대로 두면 화면이
// 사실보다 무겁게 말해서, 사용자는 매번 물어볼 줄 알고 자동을 안 쓴다 — 마찰의 다른 얼굴이다.
const 확인문구 = (d) => (d.toolKind === 'send' ? '처음 보내는 상대는 확인받아요' : '실행 전에 확인받아요');
function badgesOf(d) {
  const b = [];
  if (d.toolKind === 'read') b.push('읽어요');
  if (d.toolKind === 'organize') b.push('정리해요');
  if (d.toolKind === 'send') b.push('보내요');
  if (d.toolKind === 'delete') b.push('삭제해요');
  if (d.needsApproval) b.push(확인문구(d));
  if (d.sourcePolicy?.sourceLedgerRequired) b.push('출처를 남겨요');
  return b;
}

// "이 도구로 할 수 있는 일" 한 줄(§4.5) — 일반화(사례 하드코딩 금지).
function blurbOf(d) {
  const verb = d.sessionMode || d.sourcePolicy ? '공개 웹에서 자료를 읽어요'
    : d.toolKind === 'send' ? '메시지를 보내요'
      // 같은 도구가 보기도 하고 바꾸기도 한다. 도구 단위 needsApproval 은 false 인데 실제로는
      // 바꾸거나 지울 때 승인을 받는다 — 카드가 "확인 없이 정리한다"고 읽히면 안 된다(감사 지적).
      : d.toolKind === 'organize' ? '파일을 보고 정리해요. 바꾸거나 지울 땐 먼저 확인받아요'
        : d.toolKind === 'read' ? '자료를 읽어요'
          : '작업을 해요';
  const extra = [];
  if (d.sourcePolicy?.sourceLedgerRequired) extra.push('출처를 남겨요');
  if (d.needsApproval) extra.push(확인문구(d));
  return extra.length ? `${verb}. ${extra.join(', ')}.` : `${verb}.`;
}

// 개인 도구(2.0-C) → 사용자 카드. 등록됨 ≠ 실행 가능: 테스트 통과 전에는 "테스트 전"(사용 가능 아님).
const PERSONAL_STATUS = { untested: '테스트 전', passed: '사용 가능', failed: '테스트 실패' };
const PERSONAL_DOT = { untested: 'yellow', passed: 'green', failed: 'red' };

function personalCard(t) {
  const st = t.testState ?? 'untested';
  const executable = st === 'passed';
  return {
    id: t.id,
    label: t.label ?? t.id,
    category: '개인용',
    statusDot: PERSONAL_DOT[st] ?? 'yellow',
    userStatus: PERSONAL_STATUS[st] ?? '테스트 전',
    connected: true, // 등록됨(로컬). 단 실행 가능은 테스트 통과가 결정한다(축 분리).
    executable,
    needsApproval: t.toolKind === 'send',
    sourceLedgerRequired: false,
    personal: true,
    testState: st,
    badges: ['개인용', ...(t.toolKind === 'send' ? ['보내요', 확인문구(t)] : t.toolKind === 'read' ? ['읽어요'] : ['정리해요'])],
    blurb: '사용자가 준비한 개인 도구예요.',
    // 준비 안내(죽은 버튼 대신 텍스트). 테스트 실패면 실제 사유·다음 안전 행동을 정직하게.
    connectHint: executable ? undefined
      : st === 'failed' ? `${t.testError?.reason ?? '설정 확인에 실패했어요.'} ${t.testError?.nextSafeAction ?? ''}`.trim()
        : '설정 확인을 통과하면 쓸 수 있어요.',
  };
}

/**
 * 도구함 투영 — 실제 SelfState.connectedTools의 status를 descriptor와 합쳐 사용자 카드로.
 * 개인 도구(personalTools)가 있으면 "개인용" 카테고리 카드로 함께 보여준다(등록됨≠실행가능).
 * @param {{connectedTools?:Array}} selfState  buildSelfState(env) 결과
 * @param {Array} descriptors                   ToolDescriptor 목록(라벨·toolKind·needsApproval·sourcePolicy)
 * @param {Array} [personalTools]               등록된 PersonalTool 목록(2.0-C)
 * @returns {{tools:object[], categories:string[]}}
 */
export function projectToolbox(selfState, descriptors, personalTools = []) {
  const byId = new Map((selfState?.connectedTools ?? []).map((t) => [t.id, t]));
  const tools = (descriptors ?? []).map((d) => {
    const ct = byId.get(d.id) ?? {};
    // 실제 status만 쓴다. connectedTools에 없으면 회색(비활성) — 있는 척하지 않는다.
    const known = byId.has(d.id);
    const status = ct.status ?? 'needs_connection';
    // 연결·설정 계열만 "연결되면 이어서" 안내. blocked(차단)·gray(비활성)엔 부정확하므로 붙이지 않는다.
    const connectable = known && !ct.executable && ['needs_auth', 'needs_connection', 'needs_config'].includes(status);
    return {
      id: d.id,
      label: d.label ?? d.id,
      category: categoryOf(d),
      statusDot: known ? (STATUS_DOT[status] ?? 'gray') : 'gray',
      userStatus: known ? (STATUS_TEXT[status] ?? '비활성') : '비활성',
      // 세 축을 섞지 않는다(§5.2): 연결됨 / 실행 가능 / 승인 필요 각각.
      connected: Boolean(ct.connected),
      executable: Boolean(ct.executable),
      needsApproval: Boolean(d.needsApproval),
      sourceLedgerRequired: Boolean(d.sourcePolicy?.sourceLedgerRequired),
      badges: badgesOf(d),
      blurb: blurbOf(d),
      // 2.0-B: 연결·설정 필요 도구만 정직한 준비 안내(죽은 '연결하기' 버튼 대신 텍스트). 실제 연결은 후속.
      connectHint: connectable ? '연결이 준비되면 이어서 쓸 수 있어요. (실제 연결은 곧 지원돼요.)' : undefined,
    };
  });
  const personal = (personalTools ?? []).map(personalCard);
  const all = [...tools, ...personal];
  const categories = [...new Set(all.map((t) => t.category))];
  return { tools: all, categories };
}
