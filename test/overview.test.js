import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOverview } from '../src/surface/overview.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// P6-18 Slice-1 Status Overview — 조용한 읽기 전용 요약. 누적된 "반드시 구분"을 구조에 박는다:
//   연결 상태↔실제 가능 · 추천 스킬↔활성 스킬 · 추정된 성향↔반영 중 선호 · 전달 실패↔완료.

// ── 순수 조합: 두 범주가 별도 필드로 분리된다(안 섞임) ──
test('buildOverview: 각 항목이 두 범주로 분리된다', () => {
  const o = buildOverview({
    channels: [{ label: '텔레그램', ready: true }, { label: '슬랙 채널', ready: false, userSafe: '연결하면 받을 수 있어요.' }],
    skills: [{ label: '추천됨', state: 'candidate' }, { label: '검토중', state: 'replay_required' }, { label: '활성', state: 'admitted' }],
    userModel: {
      inferredTraits: [{ statement: '아침형일 수도' }],
      operatingPreferences: [{ statement: '표로 주세요', admitted: true }, { statement: '대기중', admitted: false }],
    },
    deliveries: [{ tool: 'slack.post', target: '#g', state: 'failed' }, { tool: 'slack.post', target: '#g', state: 'delivered' }],
  });
  // 연결 상태 ↔ 실제 가능
  assert.deepEqual(o.connections.ready.map((c) => c.label), ['텔레그램']);
  assert.deepEqual(o.connections.notReady.map((c) => c.label), ['슬랙 채널']);
  // 추천 ↔ 활성
  assert.deepEqual(o.skills.recommended.map((s) => s.label).sort(), ['검토중', '추천됨']);
  assert.deepEqual(o.skills.active.map((s) => s.label), ['활성']);
  // 추정됨 ↔ 반영 중(admitted만)
  assert.deepEqual(o.preferences.inferred.map((x) => x.statement), ['아침형일 수도']);
  assert.deepEqual(o.preferences.reflected.map((x) => x.statement), ['표로 주세요']);
  assert.ok(!o.preferences.reflected.some((x) => x.statement === '아침형일 수도'), '추정이 반영으로 안 샘');
  assert.ok(!o.preferences.reflected.some((x) => x.statement === '대기중'), '미확인 선호는 반영 아님');
  // 전달 실패 ↔ 완료
  assert.equal(o.deliveries.failed.length, 1);
  assert.equal(o.deliveries.deliveredCount, 1);
});

test('buildOverview: 빈 입력도 안전한 빈 구조', () => {
  const o = buildOverview({});
  assert.deepEqual(o.connections, { ready: [], notReady: [] });
  assert.deepEqual(o.skills, { recommended: [], active: [] });
  assert.deepEqual(o.preferences, { inferred: [], reflected: [] });
  assert.deepEqual(o.deliveries, { failed: [], deliveredCount: 0 });
});

// ── 서버 /overview: 실제 store 조합 + 전달은 세션 스코프 ──
function mem(d) { return { async load() { return d; }, async save(a) { d = a; return a; } }; }

test('GET /overview: 스토어 조합 + 전달은 sessionId 스코프(§6.13)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-ov-'));
  const skillStore = mem({ skills: [{ label: '추천 스킬', state: 'candidate' }, { label: '활성 스킬', state: 'admitted' }] });
  const memoryStore = mem({
    candidates: [], observed: [{ kind: 'inferred_trait', statement: '아침형일 수도' }],
    promoted: [{ kind: 'operating_preference', statement: '표로 주세요', admitted: true, userConfirmed: true }],
  });
  const deliveryStore = mem({ deliveries: [
    { sessionId: 's1', tool: 'slack.post', target: '#g', state: 'failed' },
    { sessionId: 's1', tool: 'slack.post', target: '#g', state: 'delivered' },
    { sessionId: 'other', tool: 'slack.post', target: '#x', state: 'failed' }, // 다른 세션 — 안 보여야
  ] });
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), skillStore, memoryStore, deliveryStore });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const o = await (await fetch(`http://127.0.0.1:${port}/overview?sessionId=s1`)).json();
    // 연결: demoChannels(telegram ready, slack.channel not)
    assert.ok(o.connections.ready.some((c) => c.label === '텔레그램'));
    assert.ok(o.connections.notReady.some((c) => c.label === '슬랙 채널'));
    // 스킬 추천↔활성
    assert.deepEqual(o.skills.recommended.map((s) => s.label), ['추천 스킬']);
    assert.deepEqual(o.skills.active.map((s) => s.label), ['활성 스킬']);
    // 추정↔반영
    assert.deepEqual(o.preferences.inferred.map((x) => x.statement), ['아침형일 수도']);
    assert.deepEqual(o.preferences.reflected.map((x) => x.statement), ['표로 주세요']);
    // 전달: s1 것만(failed 1, delivered 1) — other 세션 제외
    assert.equal(o.deliveries.failed.length, 1);
    assert.equal(o.deliveries.deliveredCount, 1);
  } finally { await new Promise((r) => server.close(r)); }
});

test('GET /overview: sessionId 없으면 전달은 비어 있음(다른 세션 유출 방지)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-ov2-'));
  const deliveryStore = mem({ deliveries: [{ sessionId: 's1', tool: 'slack.post', target: '#g', state: 'failed' }] });
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), deliveryStore });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const o = await (await fetch(`http://127.0.0.1:${port}/overview`)).json();
    assert.deepEqual(o.deliveries.failed, [], 'sessionId 없으면 전달 미노출');
    assert.equal(o.deliveries.deliveredCount, 0);
  } finally { await new Promise((r) => server.close(r)); }
});
