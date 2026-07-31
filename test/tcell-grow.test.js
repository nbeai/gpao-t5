// S4 · 성장 워커 — 묶음에서 원리 후보를 세우고, **실제 replay 로 검증한 뒤에만** 후보로 남긴다.
//
// 봉인 실측(H02): 같은 정리를 세 번 반복해도 학습 0. 그런데 이 슬라이스의 위험은 학습이
// 안 되는 것이 아니라 **잘못 배운 원리가 조용히 행동에 들어가는 것**이다. 그래서 검사의
// 대부분이 "통과하지 못한다"를 확인한다.
//
// 세 가지는 무슨 일이 있어도 지켜져야 한다:
//   ① suite 통과 여부와 무관하게, 사용자 확인 전 원리의 행동 영향은 0
//   ② 표본 없음·실행 증거 없음·판정 불가는 통과가 아니다
//   ③ 성장 호출은 도구·외부 행동 0 — 모델 판단만 한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/surface/memory-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { makeServer } from '../src/surface/server.js';
import { demoTools } from '../src/surface/demo-context.js';
import { admittedContext, confirmCandidate } from '../src/kernel/l1-intent/context-mesh.js';
import {
  growOnce, GROW_CAPS, verifySuiteFromMemory, parseProposal,
} from '../src/kernel/l5-growth/tcell-grow.js';

// 원리 문장과 실제로 겹치는 요청 — 이걸 안 주면 `admittedContext` 는 무조건 0을 돌려주고,
// "입장 0" 검사가 통과해도 아무 것도 증명하지 못한다(검사가 자기 의도만 확인하는 자리).
const 관련요청 = '월별 정리 좀 해줘';

const 신분 = (over = {}) => ({
  callId: 'call-1',
  selection: {
    requestedRole: 'growth', resolution: 'bound',
    connectionInstanceId: 'conn-A', credentialRef: 'cred-A',
    providerId: 'openai', endpointOrigin: 'https://api.openai.com', requestModelId: 'gpt-5.1',
  },
  actualEndpointOrigin: 'https://api.openai.com',
  actualRequestModelId: 'gpt-5.1',
  responseModelId: 'gpt-5.1',
  responseIdentitySource: 'response_field',
  startedAt: 1, finishedAt: 2,
  ...over,
});

/** 최소 표본을 채우는 제안(positive 2 · negative 1 · boundary 2). */
const 제안 = (over = {}) => JSON.stringify({
  statement: '월별 정리는 짧은 목록으로 한다',
  cases: [
    { kind: 'positive', inputFacts: ['7월 지출을 정리해달라고 했다'], expectedFacts: ['짧은 목록으로 정리한다'], forbiddenFacts: ['표로 정리한다'] },
    { kind: 'positive', inputFacts: ['8월 지출을 정리해달라고 했다'], expectedFacts: ['짧은 목록으로 정리한다'], forbiddenFacts: ['표로 정리한다'] },
    { kind: 'negative', inputFacts: ['표로 보여달라고 명시했다'], expectedFacts: ['요청대로 표로 준다'], forbiddenFacts: ['목록을 강요한다'] },
    { kind: 'boundary', inputFacts: ['정리가 아니라 계산을 요청했다'], expectedFacts: ['계산을 한다'], forbiddenFacts: ['목록 정리로 바꾼다'] },
    { kind: 'boundary', inputFacts: ['한 줄 답이면 되는 질문이다'], expectedFacts: ['한 줄로 답한다'], forbiddenFacts: ['목록을 만든다'] },
  ],
  ...over,
});

/**
 * 대본대로 답하는 모델. **무엇을 물었는지·도구를 줬는지**를 함께 기록한다 —
 * 성장 호출이 손을 쓰지 않는다는 사실은 이 기록으로만 확인할 수 있다.
 */
function 대본모델({ 제안본문 = 제안(), 판정 = () => '{"pass":true,"rationale":"기대 사실을 지켰다"}', 답 = () => '짧은 목록으로 정리했습니다.', 신분값 = 신분 } = {}) {
  const calls = [];
  const modelFor = (role) => ({
    async respond(tc, opts = {}) {
      const n = calls.length;
      calls.push({ role, request: tc.currentRequest, tools: opts.tools ?? null });
      opts.onCallIdentity?.(신분값(n));
      if (n === 0) return 제안본문;
      // 홀수 = replay 실행, 짝수 = 판정(제안 1건을 뺀 뒤 두 칸씩)
      return (n - 1) % 2 === 0 ? 답(n) : 판정(n);
    },
  });
  return { modelFor, calls };
}

async function 준비(bundleOver = {}) {
  const memStore = new MemoryStore(await mkdtemp(join(tmpdir(), 'gpao-t5-grow-')));
  const memory = await memStore.load();
  memory.observations = [
    { observationId: 'o-1', turnRef: { sessionId: 's-1', turnSeq: 2 }, kind: 'request', subject: '지출 정리', at: 10 },
    { observationId: 'o-2', turnRef: { sessionId: 's-1', turnSeq: 4 }, kind: 'request', subject: '지출 정리', at: 20 },
    { observationId: 'o-3', turnRef: { sessionId: 's-1', turnSeq: 6 }, kind: 'request', subject: '지출 정리', at: 30 },
  ];
  memory.bundles = [{
    bundleId: 'b-1', kind: 'request', subject: '지출 정리',
    observationIds: ['o-1', 'o-2', 'o-3'], count: 3, firstAt: 10, lastAt: 30, ...bundleOver,
  }];
  await memStore.save(memory);
  return memStore;
}

// ── 아무 일도 하지 않아야 하는 자리 ────────────────────────────────────────
test('S4: 묶음이 없으면 모델을 부르지 않는다(성장은 할 일이 있을 때만 돈다)', async () => {
  const memStore = new MemoryStore(await mkdtemp(join(tmpdir(), 'gpao-t5-grow-')));
  const { modelFor, calls } = 대본모델();
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(calls.length, 0);
  assert.equal(r.proposed, 0);
});

test('S4: 얇은 묶음은 원리로 세우지 않는다(두 번은 반복이지 원리가 아니다)', async () => {
  const memStore = await 준비({ observationIds: ['o-1', 'o-2'], count: 2 });
  const { modelFor, calls } = 대본모델();
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(calls.length, 0);
  assert.equal(r.reason, 'no_ripe_bundle');
});

test('S4: 자격 없는 호출이면 케이스 실행으로 넘어가지 않는다(증거가 안 될 호출을 더 하지 않는다)', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({
    신분값: () => 신분({ selection: { requestedRole: 'growth', resolution: 'stub' } }),
  });
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(calls.length, 1, '제안 한 번에서 멈춘다');
  assert.equal(r.reason, 'call_identity_unverified');
  const memory = await memStore.load();
  assert.equal((memory.candidates ?? []).length, 0);
});

test('S4: 모델이 형식을 못 지키면 후보를 만들지 않는다(지어내지 않는다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({ 제안본문: '음… 잘 모르겠어요.' });
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(r.reason, 'proposal_unreadable');
  const memory = await memStore.load();
  assert.equal((memory.candidates ?? []).length, 0);
});

// ── 통과 경로: 그래도 행동 영향은 0 ────────────────────────────────────────
test('S4: suite 를 채우면 후보에 통과 보고서가 붙는다 — 그래도 입장은 0', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  const r = await growOnce({ memStore, modelFor, now: 100 });

  assert.equal(r.proposed, 1);
  assert.equal(r.pass, true);
  const memory = await memStore.load();
  const 후보 = memory.candidates.find((c) => c.kind === 'operating_principle');
  assert.ok(후보, '원리 후보가 남는다');
  assert.equal(후보.replayReport.pass, true);
  assert.deepEqual(후보.replayReport.missing, []);
  // **사용자 확인 전에는 행동에 영향 0** — 통과했다고 입장하지 않는다.
  assert.equal(admittedContext(memory, 관련요청).length, 0);
  // 성장 호출은 손을 쓰지 않는다.
  assert.equal(calls.every((c) => !c.tools?.length), true);
  assert.equal(calls.every((c) => c.role === 'growth'), true);
});

test('S4: 통과한 원리는 사용자가 확인해야 입장한다(확인하면 그때 들어간다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델();
  await growOnce({ memStore, modelFor, now: 100 });
  const memory = await memStore.load();
  const 후보 = memory.candidates.find((c) => c.kind === 'operating_principle');

  const 확인 = confirmCandidate(memory, 후보.candidateId);
  assert.equal(확인.ok, true);
  assert.equal(admittedContext(memory, 관련요청).length, 1);
});

// ── 불통과 경로 ────────────────────────────────────────────────────────────
test('S4: 금지 사실이 나온 negative 케이스가 있으면 통과가 아니다', async () => {
  const memStore = await 준비();
  // 호출 순서: 0 제안 · (1 실행, 2 판정)=case0 · (3,4)=case1 · (5,6)=case2(negative).
  const { modelFor } = 대본모델({
    판정: (n) => (n === 6 ? '{"pass":false,"rationale":"금지 사실이 나왔다"}' : '{"pass":true,"rationale":"ok"}'),
  });
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(r.pass, false);
  const memory = await memStore.load();
  const 후보 = memory.candidates.find((c) => c.kind === 'operating_principle');
  assert.equal(후보.replayReport.pass, false);
  assert.ok(후보.replayReport.missing.length > 0);
  // 사용자가 확인 버튼을 눌러도 들어가지 않는다.
  assert.deepEqual(confirmCandidate(memory, 후보.candidateId), { ok: false, reason: 'replay_failed' });
  assert.equal(admittedContext(memory, 관련요청).length, 0);
});

test('S4: 표본이 모자라면 통과가 아니다(positive 1건짜리 제안)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({
    제안본문: 제안({
      cases: [
        { kind: 'positive', inputFacts: ['a'], expectedFacts: ['b'], forbiddenFacts: ['c'] },
        { kind: 'negative', inputFacts: ['a'], expectedFacts: ['b'], forbiddenFacts: ['c'] },
        { kind: 'boundary', inputFacts: ['a'], expectedFacts: ['b'], forbiddenFacts: ['c'] },
        { kind: 'boundary', inputFacts: ['d'], expectedFacts: ['b'], forbiddenFacts: ['c'] },
      ],
    }),
  });
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(r.pass, false);
  const memory = await memStore.load();
  const 후보 = memory.candidates.find((c) => c.kind === 'operating_principle');
  assert.ok(후보.replayReport.missing.includes('positive_sample'));
});

test('S4: 실행 증거가 없는 케이스는 표본으로 세지 않는다', async () => {
  const memStore = await 준비();
  // 두 번째 replay 호출만 던진다 — 그 케이스는 영수증이 없다.
  const { modelFor } = 대본모델({
    답: (n) => { if (n === 3) throw new Error('모델이 그 호출에서 죽었다'); return '짧은 목록으로 정리했습니다.'; },
  });
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(r.pass, false);
  const memory = await memStore.load();
  const 후보 = memory.candidates.find((c) => c.kind === 'operating_principle');
  assert.ok(후보.replayReport.missing.includes('positive_sample'), '증거 없는 케이스는 세지 않는다');
});

// ── 상한·멱등 ──────────────────────────────────────────────────────────────
test('S4: 같은 묶음을 두 번 배우지 않는다(다음 tick 에서 모델 호출 0)', async () => {
  const memStore = await 준비();
  const 첫 = 대본모델();
  await growOnce({ memStore, modelFor: 첫.modelFor, now: 100 });
  const 둘 = 대본모델();
  const r = await growOnce({ memStore, modelFor: 둘.modelFor, now: 200 });
  assert.equal(둘.calls.length, 0);
  assert.equal(r.proposed, 0);
});

test('S4: 한 tick 에 원리는 하나, 호출 수는 상한 안이다', async () => {
  const memStore = await 준비();
  const memory = await memStore.load();
  memory.bundles = [
    memory.bundles[0],
    { bundleId: 'b-2', kind: 'request', subject: '다른 주제', observationIds: ['o-1', 'o-2', 'o-3'], count: 3, firstAt: 10, lastAt: 30 },
  ];
  await memStore.save(memory);

  const { modelFor, calls } = 대본모델();
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(r.proposed, 1, '한 tick 에 원리 하나');
  assert.ok(calls.length <= GROW_CAPS.callsPerTick, `호출 ${calls.length} ≤ 상한 ${GROW_CAPS.callsPerTick}`);
  const 뒤 = await memStore.load();
  assert.equal(뒤.candidates.filter((c) => c.kind === 'operating_principle').length, 1);
});

test('S4: 손상된 기억 위에서는 성장하지 않는다', async () => {
  const memStore = await 준비();
  const 원래 = memStore.load.bind(memStore);
  memStore.load = async () => ({ ...(await 원래()), corrupted: true });
  const { modelFor, calls } = 대본모델();
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(calls.length, 0);
  assert.equal(r.reason, 'corrupted');
});

// ── 저장된 증거로 다시 판정된다 ────────────────────────────────────────────
test('S4: 보고서는 저장된 증거만으로 재현된다(산출물이 바뀌면 통과가 무너진다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델();
  await growOnce({ memStore, modelFor, now: 100 });
  const memory = await memStore.load();
  const 후보 = memory.candidates.find((c) => c.kind === 'operating_principle');

  // ① memory.json 만 들고 같은 판정이 나온다.
  const 재현 = verifySuiteFromMemory(memory, 후보.principleId);
  assert.equal(재현.pass, true);
  assert.equal(재현.cases, 후보.replayReport.cases);

  // ② 저장된 산출물을 하나 바꿔치면 그 케이스는 표본에서 빠지고 통과가 무너진다.
  const 바꿀것 = Object.keys(memory.replayOutputs)[0];
  const 변조 = { ...memory, replayOutputs: { ...memory.replayOutputs, [바꿀것]: '다른 답' } };
  const 변조판정 = verifySuiteFromMemory(변조, 후보.principleId);
  assert.equal(변조판정.pass, false, '바꿔치기된 증거로는 통과하지 않는다');

  // ③ 영수증을 지우면 그 케이스는 실행 증거가 없다.
  const 지움 = { ...memory, replayReceipts: memory.replayReceipts.slice(1) };
  assert.equal(verifySuiteFromMemory(지움, 후보.principleId).pass, false);
});

test('S4: 저장된 후보 상태는 정직하다(통과해도 승인·입장 표식을 미리 켜지 않는다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델();
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(r.pass, true);

  const memory = await memStore.load();
  const 후보 = memory.candidates.find((c) => c.kind === 'operating_principle');
  // suite 를 통과했다는 사실과 "사용자가 승인했다"는 사실은 다른 사실이다.
  assert.equal(후보.admitted, false);
  assert.equal(후보.userConfirmed, false);
  assert.equal(후보.replayPassed, false, 'replay 통과 표식은 승격 통로에서만 켠다');
});

test('S4: 판정을 못 읽으면 그 케이스는 표본이 아니다(판정 불가는 통과가 아니다)', async () => {
  const memStore = await 준비();
  // case0 의 판정만 읽히지 않는 답으로 준다(호출 2번).
  const { modelFor } = 대본모델({
    판정: (n) => (n === 2 ? '음… 판단이 어렵네요.' : '{"pass":true,"rationale":"ok"}'),
  });
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(r.pass, false);
  const memory = await memStore.load();
  const 후보 = memory.candidates.find((c) => c.kind === 'operating_principle');
  assert.ok(후보.replayReport.missing.includes('positive_sample'), 'positive 표본이 하나 줄어든다');
});

// ── 제품 경로: 전경 비용 0 · tick 안 상호 격리 ─────────────────────────────
const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

async function 서버세우기(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-grow-srv-'));
  const store = new SessionStore(dir);
  const server = makeServer({
    store, eventLog: new EventLog(dir), tools: demoTools(),
    model: { async respond() { return '알겠어요.'; } },
    ...extra,
  });
  await new Promise((r) => server.listen(0, r));
  return { dir, store, server, base: `http://127.0.0.1:${server.address().port}`, mem: new MemoryStore(dir) };
}

/** 같은 주제를 세 번 말해 묶음을 익힌다(성장이 돌 수 있는 최소 조건). */
async function 반복대화(base) {
  const s = await post(base, '/sessions');
  for (let i = 0; i < 3; i += 1) await post(base, '/turn', { sessionId: s.id, text: '지출 정리해줘' });
  return s;
}

test('S4/제품: 사용자 턴은 성장을 부르지 않는다(전경 비용 0)', async () => {
  const { modelFor, calls } = 대본모델();
  const { server, base, mem } = await 서버세우기({ modelConnection: { modelFor } });
  try {
    // **이미 익은 묶음을 심어 둔다.** 이게 없으면 "성장이 할 일이 없어서 안 불렀다"와
    // "턴 경로가 성장을 안 부른다"가 같은 얼굴이 된다 — 그러면 이 검사는 아무 것도 못 막는다.
    const 지금 = Date.now(); // TTL 안이어야 관찰 워커가 걷어가지 않는다
    const m = await mem.load();
    m.observations = [1, 2, 3].map((i) => ({
      observationId: `o-${i}`, turnRef: { sessionId: 's-1', turnSeq: i * 2 },
      kind: 'request', subject: '지출 정리', at: 지금,
    }));
    m.bundles = [{
      bundleId: 'b-심음', kind: 'request', subject: '지출 정리',
      observationIds: ['o-1', 'o-2', 'o-3'], count: 3, firstAt: 지금, lastAt: 지금,
    }];
    await mem.save(m);

    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: '지출 정리해줘' });
    assert.equal(calls.length, 0, '할 일이 있어도 턴 경로는 성장을 부르지 않는다');

    // 같은 조건에서 tick 은 실제로 부른다 — 그래야 위 0이 "못 부른다"가 아니라 "안 부른다"다.
    await server.runtimeTick();
    assert.ok(calls.length > 0, 'tick 에서는 부른다');
  } finally { server.close(); }
});

test('S4/제품: tick 이 돌면 그때 성장이 돈다', async () => {
  const { modelFor, calls } = 대본모델();
  const { server, base, mem } = await 서버세우기({ modelConnection: { modelFor } });
  try {
    await 반복대화(base);
    // 같은 tick 안에서 관찰이 묶음을 만들고 성장이 그것을 먹는다(순서가 계약이다).
    const r = await server.runtimeTick();
    assert.equal(r.ok, true);
    assert.equal(r.observe?.bundles, 1);
    assert.ok(calls.length > 0, '성장이 실제로 모델을 불렀다');
    assert.equal(r.grow?.proposed, 1);
    const m = await mem.load();
    assert.ok(m.candidates.some((c) => c.kind === 'operating_principle'));
    // 그래도 이 원리는 행동에 영향이 없다 — 사용자가 확인하지 않았다.
    assert.equal(admittedContext(m, '지출 정리해줘').length, 0);
  } finally { server.close(); }
});

test('S4/제품: 같은 tick 안에서 성장이 터져도 관찰·자동화는 그대로 돈다', async () => {
  const { server, base, mem } = await 서버세우기({
    modelConnection: { modelFor: () => { throw new Error('성장 연결 실패'); } },
  });
  try {
    await 반복대화(base);
    const r = await server.runtimeTick();
    assert.equal(r.ok, true, 'tick 은 닫힌다');
    assert.equal(r.observe?.observed, 3, '같은 tick 에서 관찰은 돌았다');
    assert.equal(r.grow?.failed, true, '성장 실패는 숨기지 않는다');
    assert.ok(Array.isArray(r.ran), '자동화 결과도 보존된다');
    assert.equal((await mem.load()).observations.length, 3);
  } finally { server.close(); }
});

test('S4/제품: 성장이 연속 실패하면 성장만 격리된다(대화·관찰은 계속)', async () => {
  const { server, base, mem } = await 서버세우기({
    modelConnection: { modelFor: () => { throw new Error('성장 연결 실패'); } },
  });
  try {
    await 반복대화(base);
    for (let i = 0; i < 3; i += 1) await server.runtimeTick();
    const r = await server.runtimeTick();
    assert.equal(r.grow?.isolated ?? null, null, '격리된 뒤에는 성장 결과 자체가 나오지 않는다');
    assert.equal(r.ok, true);
    // 격리 뒤에도 대화는 정상이다.
    const s = await post(base, '/sessions');
    const 답 = await post(base, '/turn', { sessionId: s.id, text: '안녕' });
    assert.ok(答또는답(답), '대화가 계속된다');
    assert.ok((await mem.load()).observations.length >= 3);
  } finally { server.close(); }
});

const 答또는답 = (r) => typeof r?.reply === 'string' && r.reply.length > 0;

// ── 잘린 응답 ──────────────────────────────────────────────────────────────
test('S4: 잘린 제안에서 완전한 사례만 건진다(모자란 조각을 채워 넣지 않는다)', () => {
  // 라이브 실측(2026-07-31): 응답이 1024 토큰에서 잘려 JSON 이 안 닫혔고, 제안 전체가 버려졌다.
  const 잘림 = '{"statement":"월별 지표는 항목별로 정리한다","cases":['
    + '{"kind":"positive","inputFacts":["7월 수치를 줬다"],"expectedFacts":["항목별로 정리한다"],"forbiddenFacts":["표로 바꾼다"]},'
    + '{"kind":"negative","inputFacts":["표로 달라고 했다"],"expectedFacts":["표로 준다"],"forbiddenFacts":["목록을 강요한다"]},'
    + '{"kind":"boundary","inputFacts":["계산을 요청했다"],"expectedFacts":["답변';
  const r = parseProposal(잘림);
  assert.ok(r, '읽을 수 있는 만큼은 읽는다');
  assert.equal(r.statement, '월별 지표는 항목별로 정리한다');
  assert.equal(r.cases.length, 2, '완전한 사례 둘만 건진다 — 잘린 셋째는 버린다');
  assert.deepEqual(r.cases.map((c) => c.kind), ['positive', 'negative']);
});

test('S4: 원리 문장 자체가 잘렸으면 아무 것도 만들지 않는다', () => {
  assert.equal(parseProposal('{"statement":"월별 지표는 항'), null);
  assert.equal(parseProposal('{"cases":[{"kind":"positive","inputFacts":["a"]}]}'), null, '원리 없는 사례는 원리가 아니다');
});

test('S4: 건진 사례가 최소 표본에 못 미치면 통과가 아니다', async () => {
  const memStore = await 준비();
  const 잘림 = '{"statement":"월별 지표는 항목별로 정리한다","cases":['
    + '{"kind":"positive","inputFacts":["7월 수치를 줬다"],"expectedFacts":["항목별로 정리한다"],"forbiddenFacts":["표로 바꾼다"]},'
    + '{"kind":"negative","inputFacts":["표로 달라고 했다"],"expectedFacts":["표로 준다"],"forbiddenFacts":["목록을';
  const { modelFor } = 대본모델({ 제안본문: 잘림 });
  const r = await growOnce({ memStore, modelFor, now: 100 });
  assert.equal(r.pass, false);
  const memory = await memStore.load();
  const 후보 = memory.candidates.find((c) => c.kind === 'operating_principle');
  assert.ok(후보.replayReport.missing.includes('positive_sample'));
  assert.ok(후보.replayReport.missing.includes('boundary_sample'));
});
