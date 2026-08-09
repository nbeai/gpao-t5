// L2 · AuthorityGrant (권한 계약) — 자동성 헌장의 집행 지점.
//
// **자동성 헌장** (design/T5-AUTONOMY-CHARTER-2026-08-03-ko.md · 오너 승인 2026-08-03):
//   T5 가 사람에게 멈춰 묻는 경우는 넷뿐이다 —
//   ① 비밀값 입력(값 받는 자리·승인 아님) ② 되돌릴 수 없는 파괴 ③ 새 상대 첫 외부 전송(한 번만) ④ 돈.
//   그 밖의 모든 것은 자동이다. 헌장과 코드가 어긋나면 코드가 결함이다.
//
// 옛 기본값("모르면 묻는다" — 12종 안전 바닥 일괄 승인)은 이 헌장이 뒤집었다. 팀원 실사용에서
// 승인 카드 6장 중 5장이 읽기·연결 준비였다 — 안전이 아니라 마찰이었다. 안전은 승인이 아니라
// **사실 기록(원장)과 되돌리기(휴지통·역방향 한 걸음)** 가 산다.
// UI 는 권한을 부여하지 않고 결정을 보여 주고, 묻는 넷에서만 승인을 받는다.
import { TIER } from '../contracts.js';

// kind 누락·미상은 자동으로 흘리지 않는다 — **분류가 먼저다**(헌장: "모르면 격리해서 해 보고").
// 원격 손은 선언·분류로 종류를 얻고, 로컬 명령은 probe 가 판정한다. 분류가 안 된 것만 여기 남는다.
export const UNKNOWN_KIND = 'unknown_kind';

/**
 * 헌장이 **물을 수 있는** 종류들. 이 밖의 종류는 어떤 조건에서도 승인 카드가 되지 않는다.
 * 이 안이라고 항상 묻는 것도 아니다 — 조건(되돌림·아는 상대)이 자동을 연다(`decideAutoGrant`).
 *
 * 이름을 SAFETY_FLOOR_KINDS 로 유지하는 이유: 소비자(자동화 엔진·스킬 replay·판정 묶임)가
 * "사람 확인이 걸릴 수 있는 종류인가"를 이 이름으로 묻는다. 의미는 같고 집합만 줄었다.
 *
 * 빠진 것들이 어디로 갔는지 명시한다(조용히 사라진 것이 아니다):
 *   · write        → 파괴 조건부(reversible:false 만 묻는다). T5 파일 손은 원본을 휴지통에 남긴다.
 *   · automate     → 자동. 문지기는 사후 교정 표면(오너: 사전 게이트 금지).
 *   · promote_memory → 자동. 같은 원칙 — 사용자가 보고 고치고 지운다.
 *   · access_secret → 자동. 저장된 자격을 쓰는 것은 일상이다. 밖으로 나가면 export_sensitive.
 *   · connect_account → 자동. 사람의 관문은 비밀값 입력면(헌장 ①)이지 승인 카드가 아니다.
 */
export const SAFETY_FLOOR_KINDS = Object.freeze([
  'send',             // ③ 새 상대 첫 전송만 — 아는 상대는 자동
  'delete', 'write',  // ② 되돌릴 수 없을 때만 — 휴지통·백업이 있으면 자동
  'pay',              // ④ 항상
  'export_sensitive', // ② 의 연장 — 새어 나간 비밀은 되돌릴 수 없다. 항상
  'publish',          // ③ 의 연장 — 공개는 언제나 새 상대(세상)다. 항상
  'escalate', 'grant_permission', // 권한 변경 — 심각한 안전 훼손 축. 항상(현재 내는 손 없음)
]);

// 저위험 어휘의 원천. `AUTO_SAFE_KINDS`(자동 진행 판정)와 `AUTHORITY_KINDS`(어휘 전체)가
// **같은 목록에서 파생**된다 — 두 곳에 손으로 적으면 언젠가 갈린다.
const LOW_RISK_ALWAYS = Object.freeze(['read', 'summarize', 'search', 'draft']);
const LOW_RISK_REVERSIBLE = Object.freeze(['organize', 'title', 'archive']);
// 헌장이 승인 목록에서 내린 종류들 — 어휘에는 남는다(자동화 envelope 의 allowedKinds 등).
export const CHARTER_AUTO_KINDS = Object.freeze(['automate', 'promote_memory', 'access_secret', 'connect_account']);

/** 이 행동이 **사람 확인이 걸릴 수 있는** 종류인가(조건은 decideAutoGrant 가 본다). */
export function isSafetyFloor(kind) {
  return SAFETY_FLOOR_KINDS.includes(kind);
}

/**
 * **행동 종류 어휘의 단일 진실**(W2·R1). 자동화 envelope 의 `allowedKinds` 도 이 목록만 받는다 —
 * 예전엔 검증이 "문자열 배열"뿐이라 migration 이 거기에 **도구 id** 를 넣었고(`['local.file']`),
 * 같은 칸을 한쪽은 행동 종류로 다른 쪽은 도구로 읽었다. 그러면 부모⊇자식 비교(authorityWithin)가
 * 의미 없는 문자열 비교가 된다. 도구 신분은 `allowedTools` 로 따로 선다.
 * `UNKNOWN_KIND` 는 판정 결과일 뿐 **승인 범위로 저장할 값이 아니다** — 여기 넣지 않는다.
 */
export const AUTHORITY_KINDS = Object.freeze([
  ...LOW_RISK_ALWAYS, ...LOW_RISK_REVERSIBLE, ...CHARTER_AUTO_KINDS, ...SAFETY_FLOOR_KINDS,
]);

/** 이 문자열이 행동 종류 어휘인가(도구 id·자유 문자열 배제). */
export function isAuthorityKind(kind) {
  return AUTHORITY_KINDS.includes(kind);
}

/**
 * **이 어휘는 두 가지 일을 한다.** 하나로 뭉쳐 두면 "선언만 있고 내는 손이 없다"가 결함처럼
 * 보이고(E-4 감사 지적 2026-08-02), 반대로 "authority 가 기억 승격도 막아 준다"는 오해도 생긴다.
 * 실측(2026-08-02, 정의역 전수 열거): 19종 중 **7종은 낼 수 있는 손이 하나도 없다.**
 *
 *   · 파생   — 실제 행동에서 `toolActionKind` 가 판정해 내는 종류. 승인 등급이 여기서 정해진다.
 *   · 선언전용 — 아무 손도 내지 않는다. envelope 의 `allowedKinds` 로 **미리 좁혀 두는** 어휘이고,
 *     그 행위 자체의 문지기는 authority 가 아니라 각자의 자리다(기억 승격은 기억 통제 채널,
 *     자동화 켜기는 `/automation/approve`, 결제·게시는 아직 손이 없다).
 *
 * 그래서 **"낼 수 있는 손이 없다"는 그 자체로 결함이 아니다.** 결함은 두 가지다:
 *   ① 파생 종류인데 이 목록에서 빠지는 것(판정이 어휘 밖으로 샌다)
 *   ② 선언전용 종류를 authority 가 막아 준다고 믿고 그 자리의 진짜 문지기를 안 세우는 것
 * 아래 목록은 ①을 검사가 물게 하려고 둔다 — 손이 새 종류를 내기 시작하면 여기도 함께 바뀐다.
 */
export const DERIVED_KINDS = Object.freeze([
  'read', 'organize', 'write', 'delete', 'send', 'export_sensitive', 'connect_account',
]);

/** 아무 손도 내지 않는 어휘(선언·차단용). `DERIVED_KINDS` 의 여집합이다 — 손으로 두 번 적지 않는다. */
export function declarationOnlyKinds() {
  return AUTHORITY_KINDS.filter((k) => !DERIVED_KINDS.includes(k));
}

/**
 * 행동의 비가역성·외부성으로 등급을 판정한다. 애매하면 높은 등급으로.
 * @param {Object} action
 * @param {string} action.kind   read|summarize|search|draft|organize|send|write|publish|delete|pay|promote_memory|
 *                               automate|grant_permission|access_secret|connect_account
 * @returns {import('../contracts.js').AuthorityTier}
 */
export function classifyTier(action) {
  const kind = action?.kind ?? UNKNOWN_KIND;
  const tier = tierOfKind(kind);
  // 도구 선언이 "확인받고 하라"고 하면 등급이 낮게 나와도 최소 A2 다(하드코딩 우회 차단).
  // **등급만 올리고 종류는 그대로 둔다** — 예전엔 여기 오기 전에 kind 자체를 send 로 바꿔
  // 달았고, 그래서 조회·연결 카드에까지 "메시지를 실제로 밖으로 보내는 일이라"가 떴다
  // (실측 2026-07-28). 바뀐 이름은 등급을 지키는 대신 사실을 버린다.
  if (action?.needsApproval && (tier === TIER.A0 || tier === TIER.A1)) return TIER.A2;
  return tier;
}

function tierOfKind(kind) {
  switch (kind) {
    case 'delete':
    case 'pay':
    case 'publish':
    case 'export_sensitive':
    case 'escalate':
    case 'grant_permission': // 권한 변경/상승
      return TIER.A3;
    case 'send':
    case 'write':          // SaaS 쓰기
    case 'automate':       // 자동화 활성화
    case 'promote_memory': // 장기 기억 승격
    case 'access_secret':  // 비밀 접근
    case 'connect_account':// 계정 접근/연결
      return TIER.A2;
    case 'organize':       // 되돌릴 수 있는 로컬 정리
    case 'title':
    case 'archive':
      return TIER.A1;
    case 'read':
    case 'summarize':
    case 'search':
    case 'draft':
      return TIER.A0;
    default:
      // 애매하면 높은 등급. 모르는 kind(새 도구·플러그인·커넥터의 toolKind)를 A0로 흘리지 않는다 —
      // Smart Approval에서 unknown 자동 진행은 안전 바닥 철학과 정면으로 어긋난다(감사 blocker).
      return TIER.A2;
  }
}

// 자동 진행 저위험 allowlist — **명시된 것만** 자연 진행한다. 모르는 kind는 여기에 없으므로 자동 진행 안 함.
//   tier가 낮게 나와도(회귀·오분류) 이 allowlist가 독립적으로 auto를 막는다(안전 바닥과 같은 방어적 이중화).
export const AUTO_SAFE_KINDS = Object.freeze({
  always: LOW_RISK_ALWAYS,          // A0 — 읽기·요약·검색·초안
  reversibleLocal: LOW_RISK_REVERSIBLE, // A1 — 되돌릴 수 있는 로컬 정리
});

/**
 * **헌장 판정** — 승인 없이 진행할지 결정한다.
 *
 * 기본은 자동이다. 묻는 것은 헌장 넷의 파생뿐이고, 그 안에서도 조건이 자동을 연다:
 * 휴지통이 있는 삭제는 파괴가 아니고, 한 번 허락한 상대는 새 상대가 아니다.
 *
 * **승인 모드는 제거했다**(오너 결정 2026-08-03) — 세 모드가 같은 답을 내는 순간 그것은
 * 조절 손잡이가 아니라 죽은 버튼이었다. 마찰의 강도를 정하는 것은 이제 헌장의 넷뿐이다.
 *
 * @param {Object} action  {kind, reversible?, counterpartKnown?, needsApproval?}
 *   reversible        — 도구가 밝힌 사실. 삭제·쓰기에서 "백업이 있는가"(헌장 ②의 조건).
 *   counterpartKnown  — 이 상대에게 보낸 것을 사용자가 이미 허락했는가(헌장 ③의 조건).
 * @returns {boolean} true면 승인 없이 진행.
 */
export function decideAutoGrant(action) {
  const kind = action?.kind ?? UNKNOWN_KIND;
  // 도구가 명시로 확인을 요구하면 존중한다 — 다만 이 선언은 이제 **예외**다. 손 전체에
  // 기본값으로 다는 것(옛 http/cli 도구)은 헌장 위반이고, 그 기본값들은 걷어냈다.
  if (action?.needsApproval) return false;
  // 헌장 넷에 실제로 닿으면 묻는다. 조건(되돌림·아는 상대)이 자동을 여는 것까지 여기서 본다.
  if (isCharterAsk(action)) return false;
  // 그 밖의 전부는 자동 — 헌장이 자동으로 둔 것(automate·기억 승격·자격 사용·연결 준비)과
  // 저위험 어휘, 조건을 통과한 send·write·delete 가 모두 여기로 온다.
  return true;
}

/**
 * 이 행동이 헌장의 넷에 **실제로 닿는가**. 종류가 목록에 있는 것만으로는 부족하다 —
 * 되돌릴 수 있는 삭제·쓰기, 이미 허락한 상대로의 전송은 헌장이 자동으로 두었다.
 */
function isCharterAsk(action) {
  const kind = action?.kind ?? UNKNOWN_KIND;
  // **어휘 밖은 전부 미상이다.** 리터럴 `unknown_kind` 만 걸러 내면, 종류를 스스로 적어 내는
  // 원격 커넥터가 `transfer_money` · `crm_write` 같은 이름으로 헌장을 그냥 지나간다(실측 2026-08-03).
  // 헌장 ④(돈)에 정면으로 닿는 이름조차 자동이 됐다. 어휘(`AUTHORITY_KINDS`)에 없으면
  // 분류가 안 된 것이고, 분류가 안 된 것은 자동으로 흘리지 않는다 — 이 파일 머리의 규칙 그대로다.
  if (!isAuthorityKind(kind)) return true;
  if (!isSafetyFloor(kind)) return false;   // 헌장 목록 밖(어휘 안) → 안 묻는다
  switch (kind) {
    // ② 되돌릴 수 없는 파괴만. 다만 **되돌릴 수 있다고 밝혀야 자동**이다 — 삭제와 같은 기본.
    // 예전 판은 `revocable === false` 만 파괴로 봤다. 그러면 되돌림을 **선언하지 않은** 손이
    // 전부 자동이 된다: 원격 SaaS 쓰기(`http-tool` 은 read 가 아니면 `reversible: undefined`)에는
    // 휴지통이 없는데 구글 시트 덮어쓰기가 확인 없이 돌았다(실측 2026-08-03).
    // 헌장 ② 는 "백업 없는 덮어쓰기"를 묻는다 — 백업이 있다는 것은 손이 밝혀야 하는 사실이다.
    // 로컬 파일 손은 휴지통을 선언하므로(`reversible: true`) 그대로 자동이다.
    case 'write':
      return action?.revocable !== true;
    // 삭제도 같은 기본 — 되돌릴 수 있다고 **밝혀야**(휴지통) 자동. 빈 값은 파괴로 본다.
    case 'delete':
      return action?.revocable !== true;
    // ③ 새 상대 첫 전송만. 이미 허락한 상대(counterpartKnown)에는 안 묻는다.
    case 'send':
      return action?.counterpartKnown !== true;
    // ②·③·④ 의 연장 — 비밀 본문·공개·결제·권한 변경은 조건 없이 항상.
    default:
      return true;
  }
}

/**
 * 행동에 대한 AuthorityGrant 를 만든다. 승인 필요 여부는 모드가 아니라 **헌장**이 정한다 —
 * 모드는 되돌릴 수 있는 로컬 정리를 strict 에서 한 번 더 확인하느냐만 조절한다.
 * @param {Object} action
 * @param {string} action.label            사용자에게 보일 행동 이름
 * @param {string} action.kind
 * @param {Object} [action.preview]        {impact,scope,duration,cancel}
 * @param {boolean} [action.revocable]
 * @returns {import('../contracts.js').AuthorityGrant}
 */
export function grantFor(action) {
  const tier = classifyTier(action);
  const approvalRequired = !decideAutoGrant(action);
  const revocable = action.revocable ?? (tier !== TIER.A3);
  /** @type {import('../contracts.js').AuthorityGrant} */
  const grant = {
    tier,
    kind: action.kind,
    action: action.label ?? action.kind,
    safetyFloor: isSafetyFloor(action.kind),
    approvalRequired,
    granted: !approvalRequired, // 저위험은 자동 진행, 승인 필요는 대기
    revocable,
    // P6-15: A0-A3 판단을 사용자 언어로. 정책이 아니라 "왜/무엇이/되돌릴 수 있나"를 보여줄 뿐.
    reason: explainAuthority(action),
  };
  if (approvalRequired) {
    // **승인 기억의 열쇠를 카드와 함께 나른다**(F-58 · 2026-08-09). 승인 경로(`input.approve`)
    // 가 이 값으로 상대를 기억한다 — 여기서 떨구면 카드가 보여 준 것과 기억하는 것이 갈린다
    // (PM 조건 ①: 보여 준 것과 기억한 것의 동일성). 없으면 칸을 안 만든다 → 매번 카드.
    if (action.상대열쇠) grant.상대열쇠 = action.상대열쇠;
    grant.approvalPreview = action.preview ?? {
      impact: action.label ?? action.kind,
      scope: '이번 요청',
      duration: '이번 한 번',
      cancel: revocable ? '되돌릴 수 있음' : '되돌릴 수 없음(실행 전 확인)',
    };
  }
  return grant;
}

/**
 * 실행 직전 게이트. 저위험 자동, 승인 필요는 granted=true 여야 통과.
 * 안전 바닥은 승인 필요가 강제되므로(grantFor) granted 없이는 절대 통과하지 않는다.
 * @param {import('../contracts.js').AuthorityGrant} grant
 */
export function isExecutionAllowed(grant) {
  if (!grant.approvalRequired) return true;
  return grant.granted === true;
}

// 승인 이유(사용자 언어) — kind별 한 줄. 개발자식 설명 금지.
const WHY_APPROVAL = {
  send: '메시지를 실제로 밖으로 보내는 일이라 보내기 전에 한 번 확인받아요.',
  write: '내용을 남기거나 덮어쓰는 일이라 실행 전에 확인받아요.',
  automate: '앞으로 자동으로 실행될 설정이라 켜기 전에 확인받아요.',
  promote_memory: '오래 기억할 내용이라 저장하기 전에 확인받아요.',
  // 되돌릴 수 있는지는 도구가 말한다 — 여기서 "어렵다"고 단정하면 같은 카드 안에서 말이 어긋난다.
  delete: '지우는 일이라 실행 전에 확인받아요.',
  pay: '돈이 나가는 일이라 진행 전에 확인받아요.',
  publish: '밖으로 공개되는 일이라 게시 전에 확인받아요.',
  export_sensitive: '민감한 정보를 내보내는 일이라 먼저 확인받아요.',
  escalate: '권한을 올리는 일이라 먼저 확인받아요.',
  grant_permission: '권한을 바꾸는 일이라 먼저 확인받아요.',
  access_secret: '비밀·자격에 접근하는 일이라 먼저 확인받아요.',
  connect_account: '계정에 접근·연결하는 일이라 먼저 확인받아요.',
};

// **자동으로 한 일을 사용자에게 말하는 자리는 여기가 아니다.**
//
// 헌장이 승인을 걷은 자리는 비워 두는 자리가 아니라 사실이 서는 자리다 — 그건 맞다. 그래서
// 여기에 종류별 자동 설명표(`WHY_AUTO`)를 뒀었는데, 라이브 관통(2026-08-03)에서 **그 표가 화면에
// 한 글자도 닿지 않는다**는 것이 드러났다. `buildActionPlan` 은 자동으로 판정된 grant 를
// 통째로 버리고 도구 id 만 `autoAllowed` 에 남긴다 — `reason` 을 실어 나를 통로 자체가 없다.
// 단위 검사가 `explainAuthority` 를 직접 불러 초록이었을 뿐이고, 제품에서는 죽은 문장이었다.
//
// 그리고 통로를 새로 뚫는 것도 답이 아니다. 실제로 화면에 뜨는 문장은 **도구가 낸 영수증**이고,
// 그쪽이 언제나 더 많이 안다(라이브 실측):
//   삭제 → "지울것.txt 을(를) 지웠어요(되돌릴 수 있어요)."   ← 파일 이름이 있다
//   연결 → "노션에 연결했어요. 이제 20개를 바로 쓸 수 있어요." ← 무엇이 늘었는지가 있다
// 여기 고정표를 되살리면 아래 `explainAuthority` 주석이 기록한 그 사고를 되풀이한다 —
// 같은 자리에 두 개의 진실이 서고 **덜 아는 쪽이 이긴다.**
//
// 그래서 자동 경로의 정직한 문장은 **손의 책임**으로 둔다. 무언가를 바꾼 손은 자기가 무엇을
// 했는지 말해야 한다(`userSafeSummary`). 말하지 않는 손이 생기면 그건 그 손의 결함이지,
// 권한 층이 일반론으로 메울 구멍이 아니다.

/**
 * A0-A3 판단을 사용자 언어로 설명한다(정책을 바꾸지 않는다 — 판단을 보여줄 뿐, P6-15).
 * @param {Object} action  {kind,label,preview,revocable}
 * @returns {{tier:string, needsApproval:boolean, safetyFloor:boolean, why:string, whatChanges:string, reversible:string}}
 */
export function explainAuthority(action) {
  const kind = action?.kind ?? UNKNOWN_KIND;
  const tier = classifyTier(action);
  const auto = decideAutoGrant(action);
  const floor = isSafetyFloor(kind);
  // **되돌릴 수 있는지는 도구가 아는 사실이다.** 종류만 보고 추측하면 거짓말이 된다 —
  // 로컬 파일 삭제는 휴지통으로 가서 되돌릴 수 있는데 카드가 "되돌릴 수 없음"이라고 겁을 줬다(실측).
  // 도구가 밝힌 사실(revocable)이 있으면 그것이 이긴다. 모르면 안전하게 "어렵다"로.
  const declared = action?.revocable;
  const irreversible = declared === false
    || (declared === undefined && (kind === 'delete' || kind === 'pay' || kind === 'publish' || tier === TIER.A3));
  // 그리고 **이 작업에 대해** 도구가 낸 문장이 도구 전체 문구보다 먼저다. `reversibleNote` 는
  // 도구에 하나만 붙어 있어 같은 write 라도 덮어쓰기와 새로 만들기를 구분하지 못한다.
  // 실측(오너 라이브 2026-07-28): 없던 파일을 만드는 카드가 "휴지통에 남아 되살릴 수 있어요"라고
  // 약속했다. 도구는 이미 정확한 문장을 냈는데 여기서 고정 문구가 그것을 덮었다 —
  // 같은 카드에 두 개의 진실이 있었고 **덜 아는 쪽이 이겼다.**
  const reversible = irreversible
    ? '되돌리기 어려워요 — 그래서 미리 확인해요.'
    : (action?.preview?.cancel ?? action?.reversibleNote ?? '되돌릴 수 있어요.');
  let why;
  if (auto) {
    // 자동 경로의 "무엇을 했는지"는 도구 영수증이 말한다(위 주석). 여기서는 등급만 말한다.
    why = tier === TIER.A0
      ? '읽고 정리해 보여드리는 일이라 승인 없이 바로 진행했어요.'
      : '되돌릴 수 있는 가벼운 정리라 승인 없이 바로 진행했어요.';
  } else {
    why = WHY_APPROVAL[kind] ?? '되돌리기 어렵거나 밖으로 나가는 일이라 실행 전에 확인받아요.';
  }
  // 무엇이 바뀌는지는 **이번 요청의 구체 사실**로 말한다. 일반론("상태가 바뀌어요")은 정책문이고,
  // 사용자는 그걸 읽고도 무엇이 사라지는지 모른다(P2-3 목표).
  const whatChanges = action?.preview?.impact
    ?? (auto ? '바깥으로 나가거나 되돌리기 어려운 변화는 없어요.' : '지정한 항목이 바뀌어요.');
  return { tier, needsApproval: !auto, safetyFloor: floor, why, whatChanges, reversible };
}
