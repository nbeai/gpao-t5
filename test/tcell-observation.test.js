// S2 · 응답 뒤 관찰 shadow. 계획 §4.1·§4.3(observation·bundle까지)·§4.8·§4.10.
//
// 이 슬라이스는 사용자 체감 기능을 늘리지 않는다. 관찰은 이미 저장된 durable 산출물의
// 소비자이며, 기존 tick 위에서 돈다. 모델 호출 0, 프롬프트 영향 0, 전경 지연 0.
//
// 고정하는 것:
//   ① 관찰은 TurnRef 이후의 저장된 턴만 읽고 세션별 watermark 로 정확히 한 번 처리한다
//   ② 파생 ID 는 원천 TurnRef 집합의 결정적 값이라 재처리해도 중복이 없다
//   ③ 결과 저장과 watermark 전진은 한 원자 쓰기 — 실패하면 둘 다 안 움직인다(크래시 재개)
//   ④ observations·bundles 는 admittedContext·프롬프트에 절대 올라가지 않는다(영향 0)
//   ⑤ 상한·TTL 이 걸려 무한히 자라지 않는다
//   ⑥ T-cell 워커와 자동화 tick 은 서로의 실패에 막히지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryStore } from '../src/surface/memory-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { admittedContext } from '../src/kernel/l1-intent/context-mesh.js';
import {
  observeSessions, makeObservation, bundleObservations, OBSERVATION_CAPS,
} from '../src/kernel/l5-growth/tcell-observe.js';

const ref = (sessionId, turnSeq) => ({ sessionId, turnSeq });

/** 저장된 세션 하나를 만든다(S0 TurnRef 계약 그대로). */
function session(id, turns) {
  const transcript = [];
  const ledgerEntries = [];
  turns.forEach((t, i) => {
    const turnRef = ref(id, i + 1);
    transcript.push({ role: 'user', text: t.user, turnRef });
    transcript.push({ role: 'assistant', result: { kind: 'reply', reply: t.reply ?? '네' }, turnRef });
    if (t.receipt) ledgerEntries.push({ ...t.receipt, turnRef });
  });
  return { id, transcript, ledgerEntries, createdAt: 1, updatedAt: 2 };
}

async function standUp(sessions) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-observe-'));
  const store = new SessionStore(dir);
  for (const s of sessions) await store.save(s);
  return { dir, store, mem: new MemoryStore(dir) };
}

// ── ① watermark: 정확히 한 번 ─────────────────────────────────────────────
test('S2: 저장된 턴을 한 번만 관찰하고 watermark 를 세션별로 남긴다', async () => {
  const { store, mem } = await standUp([
    session('11111111-1111-4111-8111-111111111111', [{ user: '첫 발화' }, { user: '둘째 발화' }]),
  ]);
  const first = await observeSessions({ store, memStore: mem });
  assert.equal(first.observed, 2, '두 턴을 관찰한다');

  const m = await mem.load();
  assert.equal((m.observations ?? []).length, 2);
  assert.equal(m.observationWatermark['11111111-1111-4111-8111-111111111111'], 2, '세션별 지도');

  const second = await observeSessions({ store, memStore: mem });
  assert.equal(second.observed, 0, '같은 턴을 다시 관찰하지 않는다');
  assert.equal((await mem.load()).observations.length, 2, '중복 적재 0');
});

test('S2: 새 턴이 붙으면 그 턴부터 이어서 관찰한다', async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const { store, mem } = await standUp([session(id, [{ user: 'A' }])]);
  await observeSessions({ store, memStore: mem });

  const s = await store.load(id);
  s.transcript.push({ role: 'user', text: 'B', turnRef: ref(id, 2) });
  s.transcript.push({ role: 'assistant', result: { kind: 'reply', reply: '네' }, turnRef: ref(id, 2) });
  await store.save(s);

  const run = await observeSessions({ store, memStore: mem });
  assert.equal(run.observed, 1, '새 턴만');
  assert.equal((await mem.load()).observationWatermark[id], 2);
});

test('S2: 두 세션은 각자 watermark 를 갖는다(전역 순서 비요구)', async () => {
  const a = '33333333-3333-4333-8333-333333333333';
  const b = '44444444-4444-4444-8444-444444444444';
  const { store, mem } = await standUp([session(a, [{ user: 'a1' }, { user: 'a2' }]), session(b, [{ user: 'b1' }])]);
  await observeSessions({ store, memStore: mem });
  const m = await mem.load();
  assert.equal(m.observationWatermark[a], 2);
  assert.equal(m.observationWatermark[b], 1);
});

test('S2: 소급(migrated) 턴은 관찰하지 않는다 — 없는 사실을 만들지 않는다', async () => {
  const id = '55555555-5555-4555-8555-555555555555';
  const s = session(id, [{ user: '옛 발화' }]);
  s.transcript.forEach((e) => { e.turnRef = { ...e.turnRef, migratedTurnRef: true }; });
  const { store, mem } = await standUp([s]);
  const run = await observeSessions({ store, memStore: mem });
  assert.equal(run.observed, 0, '소급 턴은 건너뛴다');
});

// ── ② 결정적 ID ───────────────────────────────────────────────────────────
test('S2: 관찰 ID 는 원천 TurnRef 로 결정된다(재처리해도 같은 값)', () => {
  const a = makeObservation({ turnRef: ref('s', 3), kind: 'repeat', subject: '정리' });
  const b = makeObservation({ turnRef: ref('s', 3), kind: 'repeat', subject: '정리' });
  assert.equal(a.observationId, b.observationId, '같은 원천이면 같은 ID');
  const c = makeObservation({ turnRef: ref('s', 4), kind: 'repeat', subject: '정리' });
  assert.notEqual(a.observationId, c.observationId, '다른 턴이면 다른 ID');
});

test('S2: 묶음 ID 도 원천 집합으로 결정된다', () => {
  const obs = [
    makeObservation({ turnRef: ref('s', 1), kind: 'repeat', subject: '월별 정리' }),
    makeObservation({ turnRef: ref('s', 2), kind: 'repeat', subject: '월별 정리' }),
  ];
  const [b1] = bundleObservations(obs);
  const [b2] = bundleObservations([...obs].reverse());
  assert.equal(b1.bundleId, b2.bundleId, '순서가 달라도 같은 묶음 ID');
  assert.equal(b1.observationIds.length, 2);
});

test('S2: 표현이 달라도 같은 현상이면 묶인다(H02 라이브가 잡은 결함)', () => {
  // 라이브 실측(2026-07-31): 주제를 원문 앞 40자로 잡아 이 세 문장이 하나도 안 묶였다.
  // "표현만 바꿔 세 번"이 H02 시나리오의 정의인데, 그러면 성장이 구조적으로 못 돈다.
  const 문장 = [
    '7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 이거 좀 정리해줘.',
    '8월 것도. 1350 / 900 / 신규 11 / 이탈 5',
    '9월도 부탁. 1500 / 950 / 신규 9 / 이탈 2',
  ];
  const obs = 문장.map((s, i) => makeObservation({ turnRef: ref('s', i + 1), kind: 'request', subject: s }));
  const bundles = bundleObservations(obs);
  assert.equal(bundles.length, 1, '세 번의 같은 요청은 한 묶음이다');
  assert.equal(bundles[0].count, 3);
});

test('S2: 무관한 요청은 같은 묶음에 들어가지 않는다(뭉뚱그리면 원리가 거짓이 된다)', () => {
  const obs = [
    makeObservation({ turnRef: ref('s', 1), kind: 'request', subject: '7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 정리해줘.' }),
    makeObservation({ turnRef: ref('s', 2), kind: 'request', subject: '8월 것도. 1350 / 900 / 신규 11 / 이탈 5' }),
    makeObservation({ turnRef: ref('s', 3), kind: 'request', subject: '오늘 날씨 어때?' }),
    makeObservation({ turnRef: ref('s', 4), kind: 'request', subject: '파일 하나 만들어줘. 회의록.txt' }),
  ];
  const bundles = bundleObservations(obs);
  assert.equal(bundles.length, 1, '반복인 것만 묶인다');
  assert.equal(bundles[0].count, 2);
  const 묶인것 = new Set(bundles[0].observationIds);
  assert.equal(묶인것.has(obs[2].observationId), false, '날씨는 같은 현상이 아니다');
  assert.equal(묶인것.has(obs[3].observationId), false, '파일 요청도 아니다');
});

test('S2: 묶기는 결정적이다(입력 순서를 섞어도 같은 묶음이 나온다)', () => {
  const 문장 = [
    '7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 정리해줘.',
    '8월 것도. 1350 / 900 / 신규 11 / 이탈 5',
    '9월도 부탁. 1500 / 950 / 신규 9 / 이탈 2',
    '오늘 날씨 어때?',
  ];
  const obs = 문장.map((s, i) => makeObservation({ turnRef: ref('s', i + 1), kind: 'request', subject: s }));
  const a = bundleObservations(obs);
  const b = bundleObservations([...obs].reverse());
  assert.deepEqual(a.map((x) => x.bundleId), b.map((x) => x.bundleId));
  assert.deepEqual(a[0].observationIds, b[0].observationIds);
});

// ── ③ 원자성·크래시 재개 ─────────────────────────────────────────────────
test('S2: 저장이 실패하면 watermark 도 전진하지 않는다', async () => {
  const id = '66666666-6666-4666-8666-666666666666';
  const { store, mem } = await standUp([session(id, [{ user: 'A' }])]);
  const 깨지는저장소 = { load: () => mem.load(), save: async () => { throw new Error('디스크 실패'); } };
  await assert.rejects(() => observeSessions({ store, memStore: 깨지는저장소 }));
  const m = await mem.load();
  assert.equal((m.observations ?? []).length, 0, '관찰도 안 남고');
  assert.equal(m.observationWatermark?.[id], undefined, 'watermark 도 안 움직인다');

  const again = await observeSessions({ store, memStore: mem });
  assert.equal(again.observed, 1, '재시작 뒤 그 턴을 다시 집는다(누락 0)');
});

test('S2: watermark 를 관찰과 따로 저장하지 않는다(2단계 저장 금지)', async () => {
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const { store, mem } = await standUp([session(id, [{ user: 'A' }])]);
  // 두 번째 저장에서만 실패시킨다. 구현이 watermark 를 먼저 따로 커밋하면 그 값만 남아
  // 관찰은 유실되고 그 턴은 영영 다시 안 잡힌다 — 그것이 이 검사가 막는 것이다.
  let 저장횟수 = 0;
  const 두번째실패 = {
    load: () => mem.load(),
    save: async (m) => { 저장횟수 += 1; if (저장횟수 >= 2) throw new Error('두 번째 저장 실패'); return mem.save(m); },
  };
  await observeSessions({ store, memStore: 두번째실패 }).catch(() => {});
  const m = await mem.load();
  const wm = m.observationWatermark?.[id] ?? 0;
  const 관찰수 = (m.observations ?? []).filter((o) => o.turnRef.sessionId === id).length;
  assert.ok(wm === 0 || 관찰수 > 0, `watermark(${wm})만 전진하고 관찰(${관찰수})이 비는 상태는 없어야 한다`);
});

// ── ④ 영향 0 ─────────────────────────────────────────────────────────────
test('S2: 관찰·묶음은 모델 입장 관문에 절대 오르지 않는다', async () => {
  const id = '77777777-7777-4777-8777-777777777777';
  const { store, mem } = await standUp([session(id, [{ user: '보고서 정리해줘' }])]);
  await observeSessions({ store, memStore: mem });
  const m = await mem.load();
  assert.ok(m.observations.length > 0, '관찰은 쌓였고');
  const admitted = admittedContext(m, '보고서 정리해줘');
  assert.deepEqual(admitted, [], '입장은 0 — 프롬프트에 오르지 않는다');
});

test('S2: 관찰은 모델 호출을 하지 않는다', async () => {
  const id = '88888888-8888-4888-8888-888888888888';
  const { store, mem } = await standUp([session(id, [{ user: 'A' }])]);
  let 모델호출 = 0;
  await observeSessions({ store, memStore: mem, model: { respond: async () => { 모델호출 += 1; return ''; } } });
  assert.equal(모델호출, 0, 'S2 는 모델을 부르지 않는다');
});

// ── ⑤ 상한·TTL ───────────────────────────────────────────────────────────
test('S2: 전체 상한을 넘기면 오래된 관찰부터 걷는다', async () => {
  const id = '99999999-9999-4999-8999-999999999999';
  const { store, mem } = await standUp([session(id, [{ user: 'A' }])]);
  const 가득 = Array.from({ length: OBSERVATION_CAPS.total }, (_, i) => makeObservation({
    turnRef: ref('old', i + 1), kind: 'repeat', subject: `옛 관찰 ${i}`, at: 1,
  }));
  const m0 = await mem.load();
  await mem.save({ ...m0, observations: 가득 });

  await observeSessions({ store, memStore: mem, now: 2 });
  const m = await mem.load();
  assert.equal(m.observations.length, OBSERVATION_CAPS.total, '상한을 넘지 않는다');
  assert.ok(m.observations.some((o) => o.turnRef.sessionId === id), '새 관찰이 들어왔고');
  assert.ok(!m.observations.some((o) => o.subject === '옛 관찰 0'), '가장 오래된 것이 밀려났다');
});

test('S2: TTL 이 지난 관찰은 정리된다', async () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { store, mem } = await standUp([session(id, [{ user: 'A' }])]);
  const 오래됨 = makeObservation({ turnRef: ref('old', 1), kind: 'repeat', subject: '만료 대상', at: 0 });
  const m0 = await mem.load();
  await mem.save({ ...m0, observations: [오래됨] });

  const 지금 = OBSERVATION_CAPS.ttlMs + 1000;
  await observeSessions({ store, memStore: mem, now: 지금 });
  const m = await mem.load();
  assert.ok(!m.observations.some((o) => o.subject === '만료 대상'), 'TTL 경과분은 사라진다');
});

// ── ⑥ 실패 격리 ──────────────────────────────────────────────────────────
test('S2: 관찰이 터져도 다음 tick 이 이어서 처리한다(누락 0)', async () => {
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const { store, mem } = await standUp([session(id, [{ user: 'A' }, { user: 'B' }])]);
  let 첫판 = true;
  const 가끔깨지는목록 = {
    ...store,
    loadAll: async () => { if (첫판) { 첫판 = false; throw new Error('일시 실패'); } return store.loadAll(); },
    load: (i) => store.load(i),
  };
  await assert.rejects(() => observeSessions({ store: 가끔깨지는목록, memStore: mem }));
  const ok = await observeSessions({ store, memStore: mem });
  assert.equal(ok.observed, 2, '다음 판이 모두 집는다');
});

// ── 제품 경로: tick 배선·실패 격리·전경 무영향 ─────────────────────────────
import { makeServer } from '../src/surface/server.js';
import { EventLog } from '../src/surface/event-log.js';
import { demoTools } from '../src/surface/demo-context.js';

const 고른다 = () => ({ async respond() { return '알겠어요.'; } });
const post = (base, p, b) => fetch(`${base}${p}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
}).then((r) => r.json());

async function 서버세우기(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-obs-srv-'));
  const store = new SessionStore(dir);
  const server = makeServer({
    store, eventLog: new EventLog(dir), tools: demoTools(), model: 고른다(), ...extra,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { dir, store, server, base: `http://127.0.0.1:${server.address().port}`, mem: new MemoryStore(dir) };
}

test('S2/제품: 사용자 턴은 관찰을 기다리지 않는다(전경에서 관찰 0)', async () => {
  const { server, base, mem } = await 서버세우기();
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: '보고서 정리해줘' });
    const m = await mem.load();
    assert.equal((m.observations ?? []).length, 0, '턴이 끝난 시점에 관찰은 아직 0이다');
  } finally { server.close(); }
});

test('S2/제품: tick 이 돌면 그때 관찰이 쌓인다', async () => {
  const { server, base, mem } = await 서버세우기();
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: '보고서 정리해줘' });
    const r = await server.runtimeTick();
    assert.equal(r.ok, true);
    assert.equal(r.observe.observed, 1, 'tick 이 관찰한다');
    assert.equal((await mem.load()).observations.length, 1);
  } finally { server.close(); }
});

test('S2/제품: 같은 tick 안에서 자동화가 터져도 관찰은 실행된다', async () => {
  // 이전 검사는 자동화 실패 뒤 observeSessions 를 **따로** 불러 통과했다 — 그건 "관찰 함수가
  // 따로 돌 수 있다"는 증명이지 "같은 tick 안에서 서로의 실행 기회를 뺏지 않는다"가 아니다.
  // 여기서는 한 번의 runtimeTick 안에서 두 쪽이 각자 도는지만 본다.
  const { server, base, mem } = await 서버세우기({
    automationStore: { load: async () => { throw new Error('자동화 저장소 실패'); }, save: async () => {} },
  });
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: '보고서 정리해줘' });

    const r = await server.runtimeTick();
    assert.equal(r.observe?.observed, 1, '자동화가 터진 같은 tick 에서도 관찰은 돌았다');
    assert.equal(r.automation?.failed, true, '자동화 실패는 숨기지 않는다');
    assert.equal((await mem.load()).observations.length, 1, '관찰이 실제로 저장됐다');
  } finally { server.close(); }
});

test('S2/제품: 같은 tick 안에서 관찰이 터져도 자동화 결과는 보존된다', async () => {
  let 자동화저장 = 0;
  const { server, base } = await 서버세우기({
    automationStore: { load: async () => ({ jobs: [], candidates: [] }), save: async () => { 자동화저장 += 1; } },
    memoryStore: { load: async () => { throw new Error('기억 저장소 실패'); }, save: async () => {} },
  });
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: 'A' });

    const r = await server.runtimeTick();
    assert.equal(r.ok, true, 'tick 은 정상 종료');
    assert.ok(Array.isArray(r.ran), '자동화 결과가 보존된다');
    assert.equal(자동화저장, 1, '자동화 저장이 실제로 일어났다');
    assert.equal(r.observe?.failed, true, '관찰 실패는 숨기지 않는다');
  } finally { server.close(); }
});

test('S2/제품: 양쪽이 동시에 터져도 tick 은 두 실패를 모두 보고한다', async () => {
  const { server } = await 서버세우기({
    automationStore: { load: async () => { throw new Error('자동화 실패'); }, save: async () => {} },
    memoryStore: { load: async () => { throw new Error('기억 실패'); }, save: async () => {} },
  });
  try {
    const r = await server.runtimeTick();
    assert.equal(r.ok, true, 'tick 자체는 닫힌다(무한 대기 금지)');
    assert.equal(r.automation?.failed, true);
    assert.equal(r.observe?.failed, true);
  } finally { server.close(); }
});

test('S2/제품: 자동화가 터진 tick 뒤에도 사용자 턴은 정상이다', async () => {
  const { server, base } = await 서버세우기({
    automationStore: { load: async () => { throw new Error('자동화 실패'); }, save: async () => {} },
  });
  try {
    await server.runtimeTick();
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: '안녕' });
    assert.equal(r.kind, 'reply', '사용자 턴은 무영향');
  } finally { server.close(); }
});

test('S2/제품: 관찰이 연속 실패하면 워커만 격리된다', async () => {
  const { server } = await 서버세우기({
    memoryStore: { load: async () => { throw new Error('계속 실패'); }, save: async () => {} },
  });
  try {
    for (let i = 0; i < 3; i += 1) await server.runtimeTick();
    assert.equal(server.tcellObserveState().격리됨, true, '3회 뒤 관찰만 멈춘다');
    const r = await server.runtimeTick();
    assert.equal(r.ok, true, '자동화 tick 은 계속 돈다');
    assert.equal(r.observe, undefined, '격리된 워커는 더 시도하지 않는다');
  } finally { server.close(); }
});

test('S2/제품: kill switch 로 관찰만 끌 수 있다', async () => {
  const { server, base, mem } = await 서버세우기({ processEnv: { GPAO_T5_TCELL: 'off' } });
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: 'A' });
    const r = await server.runtimeTick();
    assert.equal(r.ok, true, '대화·자동화는 그대로');
    assert.equal(r.observe, undefined, '관찰은 돌지 않는다');
    assert.equal((await mem.load()).observations.length, 0);
  } finally { server.close(); }
});

test('S2: 같은 현상에 관찰이 하나 더 붙어도 묶음 신분은 그대로다(학습이 누적된다)', () => {
  // 라이브가 잡은 결함: 묶음 ID 를 구성원 전체로 만들었더니, 관찰이 하나 붙을 때마다 ID 가
  // 바뀌어 **그 묶음을 배우던 job 이 고아가 됐다**(`bundle_gone`). 그러면 배운 표식도 무의미해지고
  // 같은 현상을 처음부터 다시 배운다 — 학습이 쌓이지 않는다.
  const 문장 = [
    '7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 정리해줘.',
    '8월 것도. 1350 / 900 / 신규 11 / 이탈 5',
    '9월도 부탁. 1500 / 950 / 신규 9 / 이탈 2',
  ];
  const obs = 문장.map((s, i) => makeObservation({ turnRef: ref('s', i + 1), kind: 'request', subject: s, at: 10 * (i + 1) }));
  const [처음] = bundleObservations(obs);
  assert.equal(처음.count, 3);

  // **id 정렬 순서에 기대면 안 된다.** 관찰 ID 는 digest 라 새 관찰이 정렬 앞에 올 수 있고,
  // 그러면 씨앗이 바뀌어 신분이 갈린다(라이브에서 `bundle_gone` 으로 두 번 났다).
  // 나중에 온 것이 **먼저 온 것보다 앞서지 않게** 하려면 시간 순이어야 한다.
  let 더붙음 = null;
  for (let i = 20; i < 200; i += 1) {
    const 새것 = makeObservation({ turnRef: ref('s', i), kind: 'request', subject: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4', at: 999 });
    if (새것.observationId < obs[0].observationId && 새것.observationId < obs[1].observationId
      && 새것.observationId < obs[2].observationId) { 더붙음 = [...obs, 새것]; break; }
  }
  assert.ok(더붙음, 'id 가 기존 것보다 앞서는 새 관찰을 찾았다');
  const [나중] = bundleObservations(더붙음);
  assert.equal(나중.bundleId, 처음.bundleId, 'id 가 앞서는 관찰이 붙어도 같은 묶음이다');
  assert.equal(나중.count, 4, '반복 횟수만 늘어난다');
});

test('S2: 다른 현상은 여전히 다른 묶음이고, 재처리해도 같은 신분이다', () => {
  const 만들기 = (텍스트, i) => makeObservation({ turnRef: ref('s', i), kind: 'request', subject: 텍스트 });
  const obs = [
    만들기('7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 정리해줘.', 1),
    만들기('8월 것도. 1350 / 900 / 신규 11 / 이탈 5', 2),
    만들기('회의록 파일 하나 만들어줘', 3),
    만들기('회의록 파일 또 하나 만들어줘', 4),
  ];
  const a = bundleObservations(obs);
  const b = bundleObservations([...obs].reverse());
  assert.equal(a.length, 2, '두 현상은 따로 묶인다');
  assert.notEqual(a[0].bundleId, a[1].bundleId);
  assert.deepEqual(a.map((x) => x.bundleId).sort(), b.map((x) => x.bundleId).sort(), '재처리해도 같은 신분');
});

// ── 민감 턴은 관찰에 남지 않는다 (H 진단 계열 ① · P0) ─────────────────────
//
// 라이브 진단에서 카드번호·비밀번호가 든 발화가 `observations[].subject` 에 **원문 그대로**
// 남았다. 승격 레인(`candidates`·`promoted`)에는 민감정보 게이트가 서 있는데 관찰 축적에는
// 없었다 — 모델은 정확히 거절했고 저장만 뚫렸다. 답만 보면 통과로 읽혔을 자리다.
//
// 판정은 **기존 공통 경계**(`containsSensitiveValue`)를 그대로 쓴다. 관찰용 축소 탐지기를
// 따로 만들면 두 경계가 언젠가 다르게 말하고, 그때 어느 쪽이 진실인지 아무도 모른다.
test('민감한 발화는 관찰에 남지 않되, watermark 는 함께 전진한다', async () => {
  const sid = '55555555-5555-4555-8555-555555555555';
  const { store, mem } = await standUp([
    session(sid, [
      { user: '7월 매출 정리해줘' },
      { user: '내 카드번호는 4111-1111-1111-1111 이고 비밀번호는 hunter2 야' },
      { user: '8월 매출도 정리해줘' },
    ]),
  ]);

  const r = await observeSessions({ store, memStore: mem });
  const m = await mem.load();
  const 통째로 = JSON.stringify(m);

  assert.equal(통째로.includes('4111'), false, '카드번호가 관찰에 남았다');
  assert.equal(통째로.includes('hunter2'), false, '비밀번호가 관찰에 남았다');
  assert.equal(r.observed, 2, '민감 턴만 빠지고 나머지는 그대로 관찰된다');

  // **watermark 는 끝까지 전진한다.** 안 그러면 그 턴을 매 tick 마다 다시 읽고, 매번 다시
  // 걸러 낸다 — 조용히 도는 무한 반복이다. 거른 것도 "처리했다"가 사실이어야 한다.
  assert.equal(m.observationWatermark[sid], 3, 'watermark 가 민감 턴을 넘어 전진해야 한다');

  const 두번째 = await observeSessions({ store, memStore: mem });
  assert.equal(두번째.observed, 0, '다시 읽지 않는다');
});

// 답이 아직(또는 영영) 없는 민감 턴 — **여기가 진짜 위험한 자리다.**
// 보통은 조수 항목이 watermark 를 대신 밀어 준다. 그런데 턴이 답 없이 끝나면(중단·크래시)
// 그 자리를 밀어 줄 것이 없다. 거른 턴에서 watermark 를 멈추면 매 tick 마다 같은 발화를
// 다시 읽고 다시 거른다 — 아무 것도 안 남기면서 조용히 도는 무한 반복이다.
test('답 없이 끝난 민감 턴도 watermark 를 넘긴다(무한 재처리 금지)', async () => {
  const sid = '66666666-6666-4666-8666-666666666666';
  const { store, mem } = await standUp([{
    id: sid,
    transcript: [
      { role: 'user', text: '7월 매출 정리해줘', turnRef: ref(sid, 1) },
      { role: 'assistant', result: { kind: 'reply', reply: '네' }, turnRef: ref(sid, 1) },
      // 답이 없다 — 조수 항목이 없으므로 이 턴을 밀어 줄 것은 민감 분기뿐이다.
      { role: 'user', text: '비밀번호는 hunter2 야', turnRef: ref(sid, 2) },
    ],
    ledgerEntries: [], createdAt: 1, updatedAt: 2,
  }]);

  await observeSessions({ store, memStore: mem });
  const m = await mem.load();
  assert.equal(JSON.stringify(m).includes('hunter2'), false, '민감값이 남았다');
  assert.equal(m.observationWatermark[sid], 2, '거른 턴을 넘어가야 다시 안 읽는다');

  const 두번째 = await observeSessions({ store, memStore: mem });
  assert.equal(두번째.observed, 0, '같은 턴을 매 tick 다시 읽지 않는다');
});
