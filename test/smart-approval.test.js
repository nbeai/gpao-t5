import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  classifyTier, grantFor, isExecutionAllowed, decideAutoGrant,
  isSafetyFloor, SAFETY_FLOOR_KINDS, explainAuthority,
} from '../src/kernel/l2-plan/authority.js';
import { buildActionPlan } from '../src/kernel/l2-plan/action-plan.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// P6-15 Smart Approval: 승인 체계를 느슨하게 만드는 게 아니라 **사용자가 덜 헤매게** 한다.
// 저위험(A0/A1)은 자연 진행, 위험(A2+·안전 바닥)은 어느 모드에서도 승인. 그리고 판단을 사용자 언어로 설명.

// ── 저위험 자연 진행 ──
test('A0(읽기/요약)은 승인 없이 자연 진행', () => {
  for (const kind of ['read', 'summarize', 'search', 'draft']) {
    assert.equal(decideAutoGrant({ kind }), true, `${kind}는 자연 진행`);
    const g = grantFor({ kind });
    assert.equal(g.approvalRequired, false);
    assert.equal(g.granted, true);
    assert.equal(isExecutionAllowed(g), true);
  }
});

// 자동성 헌장(2026-08-03) 이후: **모드는 아무 것도 바꾸지 않는다.** 예전엔 strict 가 A1(되돌릴 수
// 있는 로컬 정리)까지 확인으로 올렸다. 헌장에는 모드 예외가 없다("그 밖의 모든 것은 자동이다") —
// 모드가 마찰을 되살릴 수 있으면 그 문이 언젠가 다시 열린다. 그래서 예외를 없앴고,
// 이 검사는 **없어졌는지를 반대 방향으로 지킨다**(strict 에서 다시 카드가 생기면 실패한다).
// 등급표(A0~A3) 자체는 그대로다 — 바뀐 것은 "묻느냐"이지 "어떤 등급이냐"가 아니다.
test('A1(되돌릴 수 있는 로컬 정리)은 자연 진행한다', () => {
  assert.equal(decideAutoGrant({ kind: 'organize' }), true);
  assert.equal(grantFor({ kind: 'organize' }).approvalRequired, false);
  assert.equal(classifyTier({ kind: 'organize' }), 'A1', '등급표는 그대로다');
});

// ── 안전 바닥: 어느 모드도 우회 못 한다(반대 테스트 포함) ──
test('새 상대 첫 외부 전송은 승인 유지', () => {
  const g = grantFor({ kind: 'send', label: 'slack.post', counterpartKnown: false });
  assert.equal(g.tier, 'A2');
  assert.equal(g.approvalRequired, true, '새 상대 첫 전송은 헌장 ③');
  assert.equal(g.granted, false);
  assert.equal(isExecutionAllowed(g), false, '미승인 전송은 실행 불가');
});

test('비가역 삭제만 승인 유지', () => {
  const g = grantFor({ kind: 'delete', revocable: false });
  assert.equal(g.tier, 'A3');
  assert.equal(g.approvalRequired, true);
  assert.equal(isExecutionAllowed(g), false);
});

// 반대 테스트(핵심): Smart(가장 느슨) 모드라도 안전 바닥은 자동 승인되지 않는다.
// 외부 전송·삭제·권한 변경·자동화 활성화·비밀/계정 접근 전부 — 어떤 모드에서도 auto-grant 금지.
test('실제 헌장 효과만 승인 카드를 만든다', () => {
  for (const action of [
    { kind: 'pay' },
    { kind: 'delete', revocable: false },
    { kind: 'write', revocable: false },
    { kind: 'send', counterpartKnown: false },
    { kind: 'publish', counterpartKnown: false },
  ]) {
    const g = grantFor(action);
    assert.equal(g.approvalRequired, true, JSON.stringify(action));
    assert.equal(g.granted, false);
  }
});

// 안전 바닥은 tier 분류가 흔들려도(회귀) 독립적으로 auto를 막는다 — 사용자 지정 kind가 매핑에 없어도.
test('헌장 밖 권한·설정 종류는 정적 등급만으로 카드가 되지 않는다', () => {
  // 매핑에 없는 kind는 최소 A2(애매하면 높은 등급) + allowlist에도 없어 자동 진행 안 함.
  assert.equal(classifyTier({ kind: 'unknown_kind' }), 'A2');
  // 헌장(2026-08-03)이 바닥 목록을 12→8 로 줄였다. **지키는 불변식은 그대로다** —
  // tier 분류가 낮게 회귀해도 바닥은 독립으로 자동을 막는다. 재는 종류만 현재 바닥으로 옮긴다.
  // 내려온 넷(automate·promote_memory·access_secret·connect_account)은 헌장의 결정이며,
  // 그것들이 다시 카드가 되면 `test/autonomy-charter.test.js` 가 반대 방향에서 잡는다.
  assert.equal(grantFor({ kind: 'grant_permission' }).approvalRequired, false);
  assert.equal(grantFor({ kind: 'grant_permission' }).disposition, 'observe');
  assert.equal(grantFor({ kind: 'escalate' }).approvalRequired, false);
  assert.equal(grantFor({ kind: 'escalate' }).disposition, 'observe');
  assert.equal(decideAutoGrant({ kind: 'pay' }), false);
  assert.equal(decideAutoGrant({ kind: 'export_sensitive' }), false);
  assert.equal(grantFor({ kind: 'export_sensitive' }).approvalRequired, false, '비밀은 보호 차단이지 카드가 아니다');
  assert.equal(decideAutoGrant({ kind: 'publish', counterpartKnown: false }), false);
});

// ── 모르는 kind는 자동 진행 금지(감사 blocker 1) ── 새 도구·플러그인·커넥터가 매핑에 없어도 A0로 새면 안 된다.
test('unknown kind는 실행·카드 양쪽에서 빠져 관측/재계획으로 간다', () => {
  assert.equal(decideAutoGrant({ kind: 'unknown_kind' }), false);
  assert.equal(decideAutoGrant({ kind: 'transfer_money' }), false);
  assert.equal(decideAutoGrant({ kind: 'crm_write' }), false);
  const g = grantFor({ kind: 'unknown_kind' });
  assert.equal(g.approvalRequired, false, 'unknown은 승인 사유가 아니다');
  assert.equal(g.granted, false);
  assert.equal(g.disposition, 'observe');
  assert.equal(classifyTier({ kind: 'unknown_kind' }), 'A2', '모르는 kind는 최소 A2');
});

test('기존 저위험 kind는 의도대로 유지된다', () => {
  for (const kind of ['read', 'search', 'draft', 'summarize']) {
    assert.equal(decideAutoGrant({ kind }), true, `${kind} 자연 진행`);
    assert.equal(grantFor({ kind }).approvalRequired, false);
  }
  assert.equal(decideAutoGrant({ kind: 'organize' }), true, 'A1 정리 자연 진행');
});

// executable descriptor가 toolKind:'unknown_kind', needsApproval:false여도 autoAllowed로 새지 않는다.
test('실행 가능한 unknown toolKind 도구는 autoAllowed로 새지 않는다', () => {
  const selfState = buildSelfState({
    model: { id: 'm', authSignal: 'ok' },
    connections: [{ id: 'evil.tool', connected: true, status: 'usable', toolKind: 'unknown_kind', needsApproval: false }],
  });
  const plan = buildActionPlan({
    intent: { neededTools: ['evil.tool'], desiredOutcome: '뭔가 실행' },
    selfState
  });
  assert.equal(plan.toolsToUse.includes('evil.tool'), false, '효과 미상 호출은 실행 목록에서 빠진다');
  assert.equal(plan.autoAllowed.includes('evil.tool'), false, 'unknown은 자동 허용으로 새지 않는다');
  assert.ok(plan.authorityDeferred.some((g) => g.toolId === 'evil.tool' && g.disposition === 'observe'));
});

// ── kind 자체가 비어 있는 것도 안전하지 않은 것으로 본다(감사 blocker) ── 누락 ≠ read.
test('kind 누락은 자동 진행 금지(누락 ≠ read)', () => {
  assert.equal(decideAutoGrant({}), false, 'kind 없는 행동은 자동 승인 안 함');
  assert.equal(decideAutoGrant({ label: '새 도구' }), false);
  const g = grantFor({ label: '새 도구' });
  assert.equal(g.approvalRequired, false, 'kind 없음은 승인 사유가 아니다');
  assert.equal(g.granted, false);
  assert.equal(classifyTier({}), 'A2', 'kind 누락은 최소 A2');
});

// toolKind를 아예 안 싣고 들어온 실행 가능 도구도 autoAllowed로 새지 않는다.
test('toolKind 없는(비어 있는) 도구는 read로 흘리지 않고 승인으로 올린다', () => {
  const selfState = buildSelfState({
    model: { id: 'm', authSignal: 'ok' },
    connections: [{ id: 'custom.danger', connected: true, status: 'usable', needsApproval: false }], // toolKind 없음
  });
  const plan = buildActionPlan({
    intent: { neededTools: ['custom.danger'], desiredOutcome: '뭔가 실행' },
    selfState
  });
  assert.equal(plan.toolsToUse.includes('custom.danger'), false, '미분류 호출은 실행 목록에서 빠진다');
  assert.equal(plan.autoAllowed.includes('custom.danger'), false, 'toolKind 없음도 자동 허용으로 새지 않는다');
  assert.ok(plan.authorityDeferred.some((g) => g.toolId === 'custom.danger'));
});

// 기존 known id는 하드코딩 맵(TOOL_KIND)으로 그대로 동작한다(깨지지 않게).
test('known id fallback 유지: toolKind 없어도 TOOL_KIND 맵대로 동작', () => {
  const selfState = buildSelfState({
    model: { id: 'm', authSignal: 'ok' },
    connections: [
      { id: 'web.collect', connected: true, status: 'usable' },  // 맵: read → A0 자연 진행
      { id: 'local.file', connected: true, status: 'usable' },   // 작업(fileOp) 미상 → 승인
    ],
  });
  const plan = buildActionPlan({
    intent: { neededTools: ['web.collect', 'local.file'], desiredOutcome: '조회·정리' },
    selfState
  });
  assert.ok(plan.autoAllowed.includes('web.collect'), 'web.collect는 read로 자연 진행(기존 유지)');
  // 감사 blocker B1: local.file 은 같은 도구가 읽기도 삭제도 한다. **무슨 작업인지 모르면** 자연
  // 진행하지 않는다 — 예전엔 fileOp 없는 경로가 organize/read 로 떨어져 삭제가 승인 없이 실행됐다.
  assert.equal(plan.autoAllowed.includes('local.file'), false, '작업 미상인 파일 도구는 자동 진행 금지');
  assert.ok(plan.authorityDeferred.some((g) => g.toolId === 'local.file'), '작업 미상은 관측/재계획으로 간다');
});

// ── 승인 이유(사용자 언어) ──
test('explainAuthority: 자동 진행은 왜 진행했는지, 승인 필요는 왜 필요한지 사용자 언어로', () => {
  const a0 = explainAuthority({ kind: 'read' });
  assert.equal(a0.needsApproval, false);
  assert.match(a0.why, /바로 진행/);
  assert.match(a0.whatChanges, /없어요/);

  const send = explainAuthority({ kind: 'send', label: 'slack.post', counterpartKnown: false });
  assert.equal(send.needsApproval, true);
  assert.equal(send.safetyFloor, true);
  assert.ok(send.why && send.whatChanges && send.reversible);
  // 개발자식 용어가 새지 않는다(A2/tier/grant/approvalRequired 등).
  const devTerms = /A[0-3]|tier|grant|approval|execute|payload|kind/i;
  assert.doesNotMatch(send.why, devTerms, '이유는 사용자 언어');
  assert.doesNotMatch(send.whatChanges, devTerms);

  const del = explainAuthority({ kind: 'delete' });
  assert.match(del.reversible, /되돌리기 어려/);
});

// ── 화면 라벨은 사용자 언어(감사 blocker 2) ── 내부 계약어 "안전 바닥"이 화면에 노출되면 안 된다.
test('승인 카드 화면 라벨에 내부어 "안전 바닥"이 노출되지 않는다', async () => {
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
  // 렌더되는 배지 텍스트: 내부어 대신 사용자 언어.
  assert.match(html, /badge floor">꼭 확인</, '안전 바닥 배지는 "꼭 확인"으로 보여야 한다');
  assert.equal(html.includes('안전 바닥'), false, '화면 파일에 내부 계약어가 남으면 안 된다');
  // 내부 필드명은 유지(safetyFloor는 계약, 화면 텍스트 아님).
  assert.ok(html.includes('safetyFloor'), 'safetyFloor 필드는 유지');
});

// ── 서버 흐름: 전송은 승인 카드에 모드 + 이유가 사용자 언어로 실려 나온다 ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-sa-'));
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test('서버: 외부 전송은 승인 카드에 reason(사용자 언어)을 실어 멈춘다', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '슬랙 #general에 회의 시작이라고 올려줘' })).json();
    assert.equal(r.kind, 'approval', '전송은 승인에서 멈춘다');
    const g = r.pending[0];
    assert.equal(g.tier, 'A2');
    assert.equal(g.safetyFloor, true, '전송은 안전 바닥');
    assert.ok(g.reason?.why, '왜 필요한지 있음');
    assert.match(g.reason.whatChanges, /#general/, '무엇이 바뀌는지 구체 대상');
    assert.doesNotMatch(g.reason.why, /A[0-3]|tier|grant/i, '사용자 언어');
    // 승인 전엔 실제 전송 없음 — 원장에 delivered 없음(전달은 승인 이후).
  });
});
