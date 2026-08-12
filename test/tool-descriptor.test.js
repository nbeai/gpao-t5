import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineTool, evaluateStatus, toConnection, classifyRetry } from '../src/kernel/l2-plan/tool-descriptor.js';

test('defineTool 기본값: owner=core, executor=id, availability=connected', () => {
  const d = defineTool({ id: 'x', label: 'X' });
  assert.equal(d.owner, 'core');
  assert.equal(d.executor, 'x');
  assert.deepEqual(d.availability, [{ kind: 'connected' }]);
  assert.equal(d.needsApproval, false);
});

// availability 신호 → status. allOf: 하나라도 불만족이면 그 신호 상태.
test('evaluateStatus: availability 신호를 사실에 대입해 판정', () => {
  const d = defineTool({ id: 'm', availability: [{ kind: 'connected' }, { kind: 'auth' }] });
  assert.equal(evaluateStatus(d, { connected: false }), 'needs_connection');
  assert.equal(evaluateStatus(d, { connected: true, auth: false }), 'needs_auth');
  assert.equal(evaluateStatus(d, { connected: true, auth: true }), 'usable');
  const c = defineTool({ id: 'c', availability: [{ kind: 'connected' }, { kind: 'config' }] });
  assert.equal(evaluateStatus(c, { connected: true, config: false }), 'needs_config');
});

// 핵심: auth ≠ approval. 실행 가능(usable)해도 승인이 필요할 수 있다(별도 축).
test('auth와 approval은 분리 — usable이어도 needsApproval일 수 있다', () => {
  const d = defineTool({ id: 'slack.post', toolKind: 'send', availability: [{ kind: 'connected' }], needsApproval: true });
  const conn = toConnection(d, { connected: true });
  assert.equal(conn.status, 'usable');
  assert.equal(conn.executable, true);
  assert.equal(conn.needsApproval, true, '실행 가능해도 승인 필요는 별개');
});

// 실패 재시도 분류(Hermes permanent/transient 흡수).
test('classifyRetry: 차단·취소=permanent, 실패·타임아웃=transient', () => {
  assert.equal(classifyRetry('none'), 'none');
  assert.equal(classifyRetry('blocked'), 'permanent');
  assert.equal(classifyRetry('cancelled'), 'permanent');
  assert.equal(classifyRetry('failed'), 'transient');
  assert.equal(classifyRetry('timeout'), 'transient');
});

// ── P0-b (오너 결정 2026-08-02 · 능력 유지 + 고지) ────────────────────────
//
// 라이브 실측(2026-08-02, 격리 홈 검증): `local.file` 이 `/Users/…/Desktop` 를 out_of_scope 로
// 막은 **같은 턴에** `local.terminal` 이 그 자리를 읽어 실제 파일 이름이 답변에 나갔다.
// 적대 검증 결과: 이건 버그가 아니라 계약이다(recovery-ladder `out_of_scope → other_hand`,
// 떠넘김 방지). 오너 결정은 **능력 유지 + 고지** — 능력을 줄이지 않는 대신 그 사실을 숨기지 않는다.
// 그래서 "작업 폴더보다 넓게 읽는 손은 readReach 를 선언한다"를 불변식으로 잠근다.
// (문구를 검사하지 않는다 — 선언의 **존재와 전달**만 문다. 무슨 말을 할지는 모델이 정한다.)
test('P0-b: 작업 폴더보다 넓게 읽는 손은 그 사실을 선언한다', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const { defaultFileRoots } = await import('../src/runtime/file-scope.js');
  const { 범위를넘겨받는손들 } = await import('../src/kernel/l2-plan/recovery-ladder.js');
  // 대상을 손으로 적지 않는다 — **사다리가 범위 밖 읽기를 넘기는 손**이 곧 고지 대상이다.
  const 넓게읽는손 = 범위를넘겨받는손들();
  assert.ok(넓게읽는손.includes('local.terminal'),
    '사다리가 범위 밖 읽기를 넘기는 손이 없다 — 이 검사가 실효를 잃었다');
  for (const id of 넓게읽는손) {
    const d = demoDescriptors().find((x) => x.id === id);
    assert.ok(d, `손 선언을 못 찾았다: ${id}`);
    assert.ok(typeof d.readReach === 'string' && d.readReach.trim().length > 10,
      `${id} 은 작업 폴더(${defaultFileRoots().length}곳) 밖을 읽는데 그 사실을 선언하지 않는다 — `
      + '사용자는 T5 가 작업 폴더만 본다고 알게 된다');
  }
});

test('P0-b: 선언한 고지 사실이 능력 문서까지 그대로 간다(중간에서 떨어지지 않는다)', async () => {
  const { toConnection } = await import('../src/kernel/l2-plan/tool-descriptor.js');
  const { buildCapabilityFacts, renderDerivedSection } = await import('../src/kernel/capabilities.js');
  const 고지 = '작업 폴더 밖도 읽어요 — 시험용 문장';
  const conn = toConnection(
    defineTool({ id: 'x.hand', label: '시험 손', toolKind: 'read', readReach: 고지 }),
    { connected: true },
  );
  assert.equal(conn.readReach, 고지, 'toConnection 에서 떨어졌다');
  const facts = buildCapabilityFacts({ connectedTools: [conn], currentModel: { id: 'm' }, limits: [] });
  assert.equal(facts.ready[0].readReach, 고지, '능력 사실에서 떨어졌다');
  assert.match(renderDerivedSection(facts), /시험용 문장/, '사용자가 읽는 문서에 안 나온다 — 고지가 아니다');
});

test('P0-b: 고지를 선언하지 않은 손에는 아무 말도 지어내지 않는다', async () => {
  const { toConnection } = await import('../src/kernel/l2-plan/tool-descriptor.js');
  const { buildCapabilityFacts } = await import('../src/kernel/capabilities.js');
  const conn = toConnection(defineTool({ id: 'y.hand', label: '조용한 손', toolKind: 'read' }), { connected: true });
  const facts = buildCapabilityFacts({ connectedTools: [conn], currentModel: { id: 'm' }, limits: [] });
  assert.equal(facts.ready[0].readReach, null, '선언이 없는데 범위를 지어냈다');
});
