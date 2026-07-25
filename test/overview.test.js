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
    skills: [{ id: 'sk1', label: '추천됨', state: 'candidate' }, { id: 'sk2', label: '검토중', state: 'replay_required' }, { id: 'sk3', label: '활성', state: 'admitted' }],
    userModel: {
      inferredTraits: [{ statement: '아침형일 수도' }],
      operatingPreferences: [{ statement: '표로 주세요', status: 'admitted', admitted: true }, { id: 'p1', statement: '대기중', status: 'pending_confirm', admitted: false }],
    },
    deliveries: [{ id: 'd1', tool: 'slack.post', target: '#g', state: 'failed' }, { id: 'd2', tool: 'slack.post', target: '#g', state: 'delivered' }],
  });
  // 연결 상태 ↔ 실제 가능
  assert.deepEqual(o.connections.ready.map((c) => c.label), ['텔레그램']);
  assert.deepEqual(o.connections.notReady.map((c) => c.label), ['슬랙 채널']);
  // 추천 ↔ 활성
  assert.deepEqual(o.skills.recommended.map((s) => s.label).sort(), ['검토중', '추천됨']);
  assert.deepEqual(o.skills.active.map((s) => s.label), ['활성']);
  // 추정됨 ↔ 확인 대기 ↔ 반영 중(admitted만)
  assert.deepEqual(o.preferences.inferred.map((x) => x.statement), ['아침형일 수도']);
  assert.deepEqual(o.preferences.pending.map((x) => x.statement), ['대기중']);
  assert.deepEqual(o.preferences.reflected.map((x) => x.statement), ['표로 주세요']);
  assert.ok(!o.preferences.reflected.some((x) => x.statement === '아침형일 수도'), '추정이 반영으로 안 샘');
  assert.ok(!o.preferences.reflected.some((x) => x.statement === '대기중'), '미확인 선호는 반영 아님');
  // 전달 실패 ↔ 완료
  assert.equal(o.deliveries.failed.length, 1);
  assert.equal(o.deliveries.deliveredCount, 1);
});

// ── 액션 가능 항목은 id를 싣고, 읽기 전용(추정·활성·반영)은 액션 없음 ──
test('buildOverview: actionable(추천·대기·실패)은 id, 읽기전용(추정·활성·반영)은 id 없음', () => {
  const o = buildOverview({
    skills: [{ id: 'sk1', label: '추천', state: 'candidate' }, { id: 'sk3', label: '활성', state: 'admitted' }],
    userModel: { inferredTraits: [{ statement: '아침형' }], operatingPreferences: [{ id: 'p1', statement: '대기', status: 'pending_confirm', admitted: false }, { id: 'pr1', statement: '반영', status: 'admitted', admitted: true }] },
    deliveries: [{ id: 'd1', tool: 'slack.post', target: '#g', state: 'failed' }],
  });
  assert.equal(o.skills.recommended[0].id, 'sk1', '추천 스킬은 승인 액션용 id');
  assert.equal(o.skills.active[0].id, undefined, '활성은 읽기 전용(액션 없음)');
  assert.equal(o.preferences.pending[0].id, 'p1', '대기 선호는 확인 액션용 id');
  assert.equal(o.preferences.inferred[0].id, undefined, '추정은 읽기 전용 — 액션 없음(추정→승인 경계)');
  assert.equal(o.preferences.reflected[0].id, 'pr1', '반영 중은 되돌리기 액션용 id(반영하기와 같은 수준)');
  assert.equal(o.deliveries.failed[0].id, 'd1', '전달 실패는 재전달 액션용 id');
});

test('buildOverview: 빈 입력도 안전한 빈 구조', () => {
  const o = buildOverview({});
  assert.deepEqual(o.connections, { ready: [], notReady: [] });
  assert.deepEqual(o.skills, { recommended: [], active: [] });
  assert.deepEqual(o.preferences, { inferred: [], pending: [], reflected: [] });
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

const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();

test('액션이 항목을 "아직 아님"→"완료"로 옮긴다(액션 전엔 계속 아직 아님)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-ov3-'));
  const okSender = { toolKind: 'send', async handler() { return { result: { sent: true }, userSafeSummary: '보냈어요.' }; } };
  const skillStore = mem({ skills: [{ id: 'sk1', label: '추천 스킬', state: 'candidate', trigger: 't', steps: ['t'], userConfirmed: false, replayPassed: false }] });
  const memoryStore = mem({ candidates: [{ candidateId: 'p1', kind: 'operating_preference', statement: '표로 주세요', admitted: false, userConfirmed: false }], promoted: [], observed: [] });
  const deliveryStore = mem({ deliveries: [{ id: 'd1', sessionId: 's1', tool: 'slack.post', target: '#g', artifact: { text: '회의' }, state: 'failed', retriable: true }] });
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ senders: { 'slack.post': okSender } }), skillStore, memoryStore, deliveryStore });
  await new Promise((r) => server.listen(0, r));
  const b = `http://127.0.0.1:${server.address().port}`;
  try {
    // 액션 전: 전부 "아직 아님"
    let o = await getj(b, '/overview?sessionId=s1');
    assert.equal(o.skills.recommended.length, 1); assert.equal(o.skills.active.length, 0);
    assert.equal(o.preferences.pending.length, 1); assert.equal(o.preferences.reflected.length, 0);
    assert.equal(o.deliveries.failed.length, 1); assert.equal(o.deliveries.deliveredCount, 0);
    // 액션(이미 만든 게이트 엔드포인트 그대로)
    assert.equal((await (await post(b, '/skills/sk1/approve')).json()).state, 'admitted');
    assert.equal((await (await post(b, '/user-model/preferences/p1/confirm')).json()).status, 'admitted');
    assert.equal((await (await post(b, '/deliveries/d1/retry', { sessionId: 's1' })).json()).state, 'delivered');
    // 액션 후: "완료"로 이동, 구분 유지(빈 쪽↔찬 쪽 뒤바뀜)
    o = await getj(b, '/overview?sessionId=s1');
    assert.equal(o.skills.recommended.length, 0); assert.equal(o.skills.active.length, 1, '승인→활성');
    assert.equal(o.preferences.pending.length, 0); assert.equal(o.preferences.reflected.length, 1, '확인→반영');
    assert.equal(o.deliveries.failed.length, 0); assert.equal(o.deliveries.deliveredCount, 1, '재전달→완료');
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
