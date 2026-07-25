import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyTier, grantFor, isExecutionAllowed, decideAutoGrant,
  isSafetyFloor, SAFETY_FLOOR_KINDS, explainAuthority,
} from '../src/kernel/l2-plan/authority.js';
import { APPROVAL_MODES } from '../src/kernel/contracts.js';
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

test('A1(되돌릴 수 있는 로컬 정리)은 manual/smart 자연 진행, strict는 확인', () => {
  assert.equal(decideAutoGrant({ kind: 'organize' }, 'smart'), true);
  assert.equal(decideAutoGrant({ kind: 'organize' }, 'manual'), true);
  assert.equal(decideAutoGrant({ kind: 'organize' }, 'strict'), false, '엄격은 A1도 확인');
  assert.equal(grantFor({ kind: 'organize' }, 'strict').approvalRequired, true);
});

// ── 안전 바닥: 어느 모드도 우회 못 한다(반대 테스트 포함) ──
test('A2 외부 전송은 승인 유지(모든 모드)', () => {
  for (const mode of APPROVAL_MODES) {
    const g = grantFor({ kind: 'send', label: 'slack.post' }, mode);
    assert.equal(g.tier, 'A2');
    assert.equal(g.approvalRequired, true, `${mode}에서도 전송은 승인`);
    assert.equal(g.granted, false);
    assert.equal(isExecutionAllowed(g), false, '미승인 전송은 실행 불가');
  }
});

test('삭제성 요청(A3)은 승인 유지(모든 모드)', () => {
  for (const mode of APPROVAL_MODES) {
    const g = grantFor({ kind: 'delete' }, mode);
    assert.equal(g.tier, 'A3');
    assert.equal(g.approvalRequired, true);
    assert.equal(isExecutionAllowed(g), false);
  }
});

// 반대 테스트(핵심): Smart(가장 느슨) 모드라도 안전 바닥은 자동 승인되지 않는다.
// 외부 전송·삭제·권한 변경·자동화 활성화·비밀/계정 접근 전부 — 어떤 모드에서도 auto-grant 금지.
test('안전 바닥은 Smart 포함 어느 모드에서도 자동 승인 불가', () => {
  for (const kind of SAFETY_FLOOR_KINDS) {
    assert.equal(isSafetyFloor(kind), true);
    for (const mode of APPROVAL_MODES) {
      assert.equal(decideAutoGrant({ kind }, mode), false, `${kind}@${mode}는 자동 진행 금지`);
      const g = grantFor({ kind }, mode);
      assert.equal(g.approvalRequired, true, `${kind}@${mode}는 승인 필요`);
      assert.equal(g.safetyFloor, true);
      assert.equal(g.granted, false, `${kind}@${mode}는 미승인`);
    }
  }
});

// 안전 바닥은 tier 분류가 흔들려도(회귀) 독립적으로 auto를 막는다 — 사용자 지정 kind가 매핑에 없어도.
test('안전 바닥은 tier가 낮게 나와도 auto를 막는다(독립 불변식)', () => {
  // 매핑에 없는 kind는 tier가 A0로 떨어지지만, 바닥 kind면 여전히 승인.
  assert.equal(classifyTier({ kind: 'unknown_kind' }), 'A0');
  // 자동화 활성화는 바닥 — mode 무관 자동 금지.
  assert.equal(decideAutoGrant({ kind: 'automate' }, 'smart'), false);
  assert.equal(decideAutoGrant({ kind: 'access_secret' }, 'smart'), false);
  assert.equal(decideAutoGrant({ kind: 'grant_permission' }, 'smart'), false);
  assert.equal(decideAutoGrant({ kind: 'connect_account' }, 'smart'), false);
});

// ── 승인 이유(사용자 언어) ──
test('explainAuthority: 자동 진행은 왜 진행했는지, 승인 필요는 왜 필요한지 사용자 언어로', () => {
  const a0 = explainAuthority({ kind: 'read' });
  assert.equal(a0.needsApproval, false);
  assert.match(a0.why, /바로 진행/);
  assert.match(a0.whatChanges, /없어요/);

  const send = explainAuthority({ kind: 'send', label: 'slack.post' });
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

// ── 서버 흐름: 전송은 승인 카드에 모드 + 이유가 사용자 언어로 실려 나온다 ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-sa-'));
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools() });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test('서버: 외부 전송은 승인 카드에 approvalMode + reason(사용자 언어)을 실어 멈춘다', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '슬랙 #general에 회의 시작이라고 올려줘' })).json();
    assert.equal(r.kind, 'approval', '전송은 승인에서 멈춘다');
    assert.ok(APPROVAL_MODES.includes(r.approvalMode), '현재 승인 모드 표면화');
    const g = r.pending[0];
    assert.equal(g.tier, 'A2');
    assert.equal(g.safetyFloor, true, '전송은 안전 바닥');
    assert.ok(g.reason?.why, '왜 필요한지 있음');
    assert.match(g.reason.whatChanges, /#general/, '무엇이 바뀌는지 구체 대상');
    assert.doesNotMatch(g.reason.why, /A[0-3]|tier|grant/i, '사용자 언어');
    // 승인 전엔 실제 전송 없음 — 원장에 delivered 없음(전달은 승인 이후).
  });
});
