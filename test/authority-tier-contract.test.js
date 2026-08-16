// 권한 등급 **계약 잠금** (P2-8 선행) — 등급의 뜻이 조용히 바뀌는 것을 막는다.
//
// 왜 지금인가: 새 작업 지시서가 A0~A4 를 제안했는데 **기존 A0~A3 과 뜻이 정면으로 달랐다.**
//   현재 코드: A1 되돌릴 수 있는 자동 · **A2 짧은 승인** · **A3 강한 승인/차단**
//   제안 문서: A1 읽기/분석 · **A2 준비(승인 없음)** · **A3 변경(실행 직전 승인)** · A4 고위험
// 같은 이름이 반대 뜻을 가지면 코드와 문서가 서로를 오독한다. 그 상태에서 누군가 "A2 는 준비라
// 승인 불필요"라고 읽고 손대면 **승인이 조용히 사라진다.** 실제로 그 구조로 사고가 났다:
// B1 — fileKind 두 진실(선언은 read, 실행은 delete)로 승인 우회.
//
// **목록이 아니라 불변식을 검사한다**(절대원칙 8). 손으로 관리하는 목록은 다음에 또 어긋난다
// (dist 인벤토리 사고). 아래는 전부 코드에서 파생되므로 새 kind 가 생겨도 자동으로 걸린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIER } from '../src/kernel/contracts.js';
import {
  classifyTier, SAFETY_FLOOR_KINDS, isSafetyFloor, AUTO_SAFE_KINDS,
} from '../src/kernel/l2-plan/authority.js';

const AUTO_TIERS = [TIER.A0, TIER.A1];       // 사용자를 멈춰 세우지 않는 등급
const APPROVAL_TIERS = [TIER.A2, TIER.A3];   // 멈춰 세우는 등급

test('등급은 A0~A3 넷뿐이다 — A4 를 만들면 기존 판정이 통째로 어긋난다', () => {
  assert.deepEqual(Object.keys(TIER).sort(), ['A0', 'A1', 'A2', 'A3']);
  assert.equal(TIER.A4, undefined, '새 등급이 필요하면 등급을 늘리지 말고 safetyFloor 로 강도를 올린다');
});

test('A2·A3 는 **승인 등급**이다(준비·변경 같은 자동 등급으로 뜻이 바뀌면 안 된다)', () => {
  // 이 계약이 깨지면 "A2 는 승인 없이 준비"로 읽는 코드가 들어올 수 있다.
  for (const kind of SAFETY_FLOOR_KINDS) {
    assert.ok(APPROVAL_TIERS.includes(classifyTier({ kind })),
      `${kind} 는 안전 바닥인데 등급이 ${classifyTier({ kind })} 다 — 자동 진행 등급으로 내려갔다`);
  }
});

test('안전 바닥은 자동 통과 목록에 절대 겹치지 않는다(독립 이중화)', () => {
  const auto = Object.keys(AUTO_SAFE_KINDS).filter((k) => AUTO_SAFE_KINDS[k]);
  const overlap = auto.filter((k) => isSafetyFloor(k));
  assert.deepEqual(overlap, [], `자동 통과와 안전 바닥이 겹친다: ${overlap.join(', ')}`);
});

test('자동 등급(A0·A1)으로 분류되는 것은 하나도 안전 바닥이 아니다', () => {
  // 반대 방향 검사 — 위 테스트와 짝이다. 한쪽만 있으면 새 kind 가 사이로 샌다.
  const KNOWN = ['read', 'summarize', 'search', 'draft', 'organize', 'title', 'archive', ...SAFETY_FLOOR_KINDS];
  for (const kind of KNOWN) {
    if (AUTO_TIERS.includes(classifyTier({ kind }))) {
      assert.equal(isSafetyFloor(kind), false, `${kind} 가 자동 등급인데 안전 바닥이다 — 둘 중 하나가 틀렸다`);
    }
  }
});

test('모르는 종류는 자동 등급으로 흐르지 않는다(새 도구·커넥터가 조용히 통과하지 못하게)', () => {
  for (const unknown of [undefined, null, '', 'brand_new_kind', 'desktop_click', 'run_command']) {
    assert.ok(APPROVAL_TIERS.includes(classifyTier({ kind: unknown })),
      `모르는 종류 "${unknown}" 가 ${classifyTier({ kind: unknown })} 로 떨어졌다`);
  }
});

// 앞으로 들어올 로컬·브라우저 손발도 **새 등급을 만들지 말고 여기 매핑**한다.
// 지시서 어휘 → 기존 등급: 관찰/읽기/분석 = A0 · 준비(초안) = A0(draft) · 되돌릴 수 있는 정리 = A1
//                          변경(쓰기·이동·전송) = A2 · 삭제·결제·발행·권한 = A3 + safetyFloor
test('지시서 어휘를 기존 등급에 매핑해도 승인 경계가 유지된다', () => {
  const MAPPING = [
    ['read', TIER.A0], ['search', TIER.A0], ['summarize', TIER.A0], ['draft', TIER.A0],
    ['organize', TIER.A1],
    ['write', TIER.A2], ['send', TIER.A2],
    ['delete', TIER.A3], ['pay', TIER.A3], ['publish', TIER.A3], ['grant_permission', TIER.A3],
  ];
  for (const [kind, expected] of MAPPING) {
    assert.equal(classifyTier({ kind }), expected, `${kind} 등급이 바뀌었다`);
  }
});

// ── E-4 (오너 결정 2026-08-02 · 감사 지적 흡수) · 어휘의 두 역할 ─────────
//
// 감사 지적은 "`draft` 를 toolKind 로 선언하는 도구가 하나도 없다 — 어휘로만 존재"였다.
// 정의역을 전수 열거해 보니 19종 중 **12종**이 그랬고, 그중 7종(promote_memory·automate·
// access_secret·pay·publish·escalate·grant_permission)은 src 전체에서 authority.js 밖에
// 나오지도 않았다. 그래서 지운다가 아니라 **두 역할을 명시**한다(어휘를 지우면 envelope 이
// 미리 좁혀 둘 말을 잃는다). 여기서 무는 것은 딱 하나 — **파생 종류가 어휘 밖으로 새지 않는가.**
test('E-4: 손이 실제로 내는 종류는 전부 권한 어휘 안에 있다(판정이 어휘 밖으로 새지 않는다)', async () => {
  const { toolActionKind } = await import('../src/kernel/l2-plan/action-plan.js');
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const { UNKNOWN_KIND, DERIVED_KINDS, isAuthorityKind } = await import('../src/kernel/l2-plan/authority.js');
  const selfState = { connectedTools: demoDescriptors().map((d) => ({ ...d })) };

  // 선언으로 내는 것 + 인자로 파생하는 것을 모두 모은다(정의역을 손으로 적지 않는다).
  const 낸것 = new Set();
  for (const d of demoDescriptors()) {
    if (d.toolKind) 낸것.add(toolActionKind({ toolId: d.id, args: {}, selfState }));
  }
  for (const [id, args] of [
    ['local.file', { action: 'read' }], ['local.file', { action: 'write' }],
    ['local.file', { action: 'delete' }], ['local.file', { action: 'move' }],
    ['local.file', { action: 'undo' }], ['local.file', { action: 'list' }],
    ['local.terminal', { probeObservation: true }], ['local.terminal', { changes: true }],
    ['local.process', { action: 'status' }], ['local.process', { action: 'start' }],
    ['local.process', { action: 'stop' }],
    ['mail.send', { to: 'a@b.c', body: 'password: hunter2222' }],   // send → export_sensitive 파생
    // field_input 파생(F-58 (가-2)) — 요소로 짚은 창의 칸에 글자 넣기.
    ['desktop.act', { action: 'type', 대상: { 토큰: 's1:9', label: '메시지 입력' } }],
  ]) 낸것.add(toolActionKind({ toolId: id, args, selfState }));
  낸것.delete(UNKNOWN_KIND);   // 판정 결과일 뿐 저장할 어휘가 아니다

  // demo 밖에서 선언하는 손도 정의역이다 — 라이브 커넥터 손이 `connect_account` 를 낸다.
  const { liveDeps } = await import('../src/surface/live-context.js');
  for (const d of Object.values(liveDeps({}).tools?.descriptors ?? {})) {
    if (d?.toolKind) 낸것.add(d.toolKind);
  }
  낸것.add('connect_account');   // connector-declare.js:130 · live-context.js:201,232

  for (const kind of 낸것) {
    assert.ok(isAuthorityKind(kind), `손이 내는 종류가 권한 어휘 밖이다: ${kind}`);
    assert.ok(DERIVED_KINDS.includes(kind),
      `손이 실제로 내는데 파생 목록에 없다: ${kind} — envelope 이 이 종류를 좁힐 수 없게 된다`);
  }

  // **역방향도 문다.** 파생이라고 적어 놓고 아무도 안 내면 그 목록이 거짓이 되고,
  // "authority 가 이것도 판정해 준다"는 오해가 그대로 남는다(E-4 지적의 뿌리).
  for (const kind of DERIVED_KINDS) {
    assert.ok(낸것.has(kind),
      `파생이라고 적혀 있는데 내는 손이 없다: ${kind} — 선언전용이면 DERIVED_KINDS 에서 빼라`);
  }
});

test('E-4: 선언전용 어휘는 여집합으로 파생된다(두 곳에 손으로 적지 않는다)', async () => {
  const { AUTHORITY_KINDS, DERIVED_KINDS, declarationOnlyKinds } = await import('../src/kernel/l2-plan/authority.js');
  const 선언전용 = declarationOnlyKinds();
  assert.deepEqual(
    [...DERIVED_KINDS, ...선언전용].sort(),
    [...AUTHORITY_KINDS].sort(),
    '파생 + 선언전용 이 어휘 전체와 같지 않다 — 어느 한쪽이 빠지거나 겹친다',
  );
  assert.equal(선언전용.some((k) => DERIVED_KINDS.includes(k)), false, '두 역할이 겹치면 구분이 무의미하다');
});
