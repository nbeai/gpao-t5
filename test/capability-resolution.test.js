import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCapability, makeCapabilityResolution, CAPABILITY_TYPES } from '../src/kernel/l2-plan/capability-resolution.js';
import { liveDeps } from '../src/surface/live-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

// ── 리졸버: 부족 능력을 하나의 패킷으로 분류(우선순위·resumeContext·ref). ──
test('resolveCapability: 타입 분류·우선순위·복귀맥락', () => {
  // permission > connector > tool > target
  const perm = resolveCapability({ text: 't', permission: { label: '슬랙 게시', action: 'slack.post' }, connectionNeeded: { label: 'x', toolId: 'x' } });
  assert.equal(perm.capabilityType, 'permission');
  assert.equal(perm.nextAction, 'approve');
  assert.equal(perm.requiresApproval, true);

  const conn = resolveCapability({ text: '슬랙에 올려줘', connectionNeeded: { label: '슬랙 게시', toolId: 'slack.post', requestText: '슬랙에 올려줘' } });
  assert.equal(conn.capabilityType, 'connector');
  assert.equal(conn.nextAction, 'connect');
  assert.equal(conn.ref.toolId, 'slack.post');
  assert.equal(conn.resumeContext, '슬랙에 올려줘', '원래 작업 복귀 맥락');

  const tool = resolveCapability({ text: '준비해줘', toolCandidate: { label: '내 크롤러', kind: 'web', requestText: '준비해줘' } });
  assert.equal(tool.capabilityType, 'tool');
  assert.equal(tool.nextAction, 'register');
  assert.equal(tool.testPlan, '설정 확인'); // 실제 실행이 아니라 필수 설정 완비 확인(오해 방지)
  assert.deepEqual(tool.ref, { label: '내 크롤러', kind: 'web' });

  const tgt = resolveCapability({ text: '슬랙에 올려줘', sendClarify: { reason: 'no_target', label: '슬랙 게시', toolId: 'slack.post' } });
  assert.equal(tgt.capabilityType, 'target');
  assert.equal(tgt.nextAction, 'clarify');

  assert.equal(resolveCapability({ text: '안녕' }), null, '부족 신호 없으면 null');
});

test('makeCapabilityResolution: 기본값·타입 목록', () => {
  const p = makeCapabilityResolution({ capabilityType: 'tool', nextAction: 'register' });
  assert.equal(p.requiresApproval, false);
  assert.deepEqual(p.alternatives, []);
  assert.deepEqual(p.ref, {});
  assert.ok(CAPABILITY_TYPES.includes('connector') && CAPABILITY_TYPES.includes('permission'));
});

// ── 턴 통합: 실제 서버가 네 상황을 통합 패킷으로 표면화한다. ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function withLive(processEnv, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-cap-'));
  const { env, tools, descriptors } = liveDeps(processEnv);
  const server = makeServer({ store: new SessionStore(dir), env, tools, descriptors });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}
const turnText = async (base, text) => {
  const s = await (await post(base, '/sessions')).json();
  return (await post(base, '/turn', { sessionId: s.id, text })).json();
};

test('통합: 미연결 슬랙 → connector 패킷(connect)', async () => {
  await withLive({}, async (base) => {
    const r = await turnText(base, '슬랙 #general에 회의 시작이라고 올려줘');
    assert.equal(r.capabilityResolution?.capabilityType, 'connector');
    assert.equal(r.capabilityResolution.nextAction, 'connect');
    assert.equal(r.capabilityResolution.ref.toolId, 'slack.post');
  });
});

test('통합: 개인 도구 준비 요청 → tool 패킷(register)', async () => {
  await withLive({}, async (base) => {
    const r = await turnText(base, '내 크롤러 스크립트 쓸 수 있게 준비해줘');
    assert.equal(r.capabilityResolution?.capabilityType, 'tool');
    assert.equal(r.capabilityResolution.nextAction, 'register');
    assert.match(r.capabilityResolution.resumeContext, /크롤러/);
  });
});

test('통합: 토큰 있고 채널 없는 슬랙 → target 패킷(clarify)', async () => {
  await withLive({ SLACK_BOT_TOKEN: 'xoxb-test' }, async (base) => {
    const r = await turnText(base, '슬랙에 회의 시작 올려줘');
    assert.equal(r.kind, 'clarify');
    assert.equal(r.capabilityResolution?.capabilityType, 'target');
    assert.equal(r.capabilityResolution.nextAction, 'clarify');
  });
});

test('통합: 토큰·채널 명시된 슬랙 → permission 패킷(approve)', async () => {
  await withLive({ SLACK_BOT_TOKEN: 'xoxb-test' }, async (base) => {
    const r = await turnText(base, '슬랙 #general에 회의 시작이라고 올려줘');
    assert.equal(r.kind, 'approval');
    assert.equal(r.capabilityResolution?.capabilityType, 'permission');
    assert.equal(r.capabilityResolution.nextAction, 'approve');
    assert.equal(r.capabilityResolution.requiresApproval, true);
  });
});
