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
  growTick, GROW_CAPS, verifySuiteFromMemory, parseProposal,
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


/**
 * job 이 끝날 때까지 tick 을 돈다. **tick 마다 계획 §4.10 상한을 지키는지 여기서 판정한다** —
 * 이 자리에 상한 검사가 없으면 구현이 상한을 올려도 아무 검사도 안 운다(감사 지적).
 */
async function 끝까지({ 시작 = 100_000, maxTicks = 40, ...deps }) {
  const 기록 = [];
  let now = 시작;
  for (let i = 0; i < maxTicks; i += 1) {
    const r = await growTick({ ...deps, now });
    assert.ok(r.calls <= GROW_CAPS.callsPerTick,
      `tick 당 호출 ${r.calls} 가 계획 상한 ${GROW_CAPS.callsPerTick} 를 넘었다`);
    기록.push(r);
    now += 1_000;
    if (r.reason === 'idle' || r.reason === 'daily_cap' || r.reason === 'corrupted') break;
    if (r.action === 'finish') break;
    if (r.state === 'cooldown' || r.state === 'exhausted') break;
  }
  return { 기록, now };
}

const 마지막원리 = (memory) => (memory.candidates ?? []).find((c) => c.kind === 'operating_principle');

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
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.equal(calls.length, 0);
  assert.equal(r.reason, 'idle');
});

test('S4: 얇은 묶음은 원리로 세우지 않는다(두 번은 반복이지 원리가 아니다)', async () => {
  const memStore = await 준비({ observationIds: ['o-1', 'o-2'], count: 2 });
  const { modelFor, calls } = 대본모델();
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.equal(calls.length, 0);
  assert.equal(r.reason, 'idle');
});

test('S4: 손상된 기억 위에서는 성장하지 않는다', async () => {
  const memStore = await 준비();
  const 원래 = memStore.load.bind(memStore);
  memStore.load = async () => ({ ...(await 원래()), corrupted: true });
  const { modelFor, calls } = 대본모델();
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.equal(calls.length, 0);
  assert.equal(r.reason, 'corrupted');
});

test('S4: 자격 없는 호출이면 케이스 실행으로 넘어가지 않는다(증거가 안 될 호출을 더 하지 않는다)', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({
    신분값: () => 신분({ selection: { requestedRole: 'growth', resolution: 'stub' } }),
  });
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.equal(calls.length, 1, '제안 한 번에서 멈춘다');
  assert.equal(r.reason, 'call_identity_unverified');
  assert.equal((await memStore.load()).candidates.length, 0);
});

test('S4: 모델이 형식을 못 지키면 후보를 만들지 않는다(지어내지 않는다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({ 제안본문: '음… 잘 모르겠어요.' });
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.equal(r.reason, 'proposal_unreadable');
  assert.equal((await memStore.load()).candidates.length, 0);
});

// ── 계획 §4.10 예산: tick당 ≤2 · 일일 ≤50 ─────────────────────────────────
test('S4: 한 tick 은 계획 상한(≤2)만 쓰고, 나머지는 다음 tick 이 이어서 한다', async () => {
  assert.equal(GROW_CAPS.callsPerTick, 2, '계획 §4.10 이 정한 값이다 — 코드가 편하려고 올리지 않는다');
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  const { 기록 } = await 끝까지({ memStore, modelFor });

  assert.equal(calls.length, 11, '제안 1 + (실행·판정)×5');
  assert.ok(기록.length >= Math.ceil(11 / GROW_CAPS.callsPerTick), '여러 tick 에 걸쳐 돈다');
  assert.equal(기록.filter((r) => r.calls > GROW_CAPS.callsPerTick).length, 0);
  assert.ok(마지막원리(await memStore.load()), '여러 tick 뒤에 후보가 선다');
});

test('S4: 일일 상한을 넘기면 그 날은 더 부르지 않는다(날이 바뀌면 다시 시작)', async () => {
  const memStore = await 준비();
  const 하루 = 86_400_000;
  const 지금 = 하루 * 20_000 + 5_000;
  const m = await memStore.load();
  m.growBudget = { day: Math.floor(지금 / 하루), used: GROW_CAPS.callsPerDay };
  await memStore.save(m);

  const { modelFor, calls } = 대본모델();
  assert.equal((await growTick({ memStore, modelFor, now: 지금 })).reason, 'daily_cap');
  assert.equal(calls.length, 0);

  const 다음날 = await growTick({ memStore, modelFor, now: 지금 + 하루 });
  assert.notEqual(다음날.reason, 'daily_cap', '날이 바뀌면 예산이 새로 선다');
  assert.ok(calls.length > 0);
});

test('S4: 쓴 호출 수가 그대로 예산에 남는다(장부가 실제 호출과 어긋나지 않는다)', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  await 끝까지({ memStore, modelFor });
  const m = await memStore.load();
  assert.equal(m.growBudget.used, calls.length);
});

// ── 재개·멱등 ──────────────────────────────────────────────────────────────
test('S4: 중간에 끊겨도 이미 실행한 케이스를 다시 부르지 않는다(재개는 멱등이다)', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  await growTick({ memStore, modelFor, now: 100_000 });   // 제안
  await growTick({ memStore, modelFor, now: 101_000 });   // 첫 케이스
  const 중간호출 = calls.length;
  const 중간영수증 = (await memStore.load()).replayReceipts.length;
  assert.ok(중간영수증 >= 1, '케이스 하나의 증거가 이미 저장돼 있다');

  const { 기록 } = await 끝까지({ memStore, modelFor, 시작: 102_000 });
  assert.equal(calls.length, 11, '앞의 호출을 되풀이하지 않고 나머지만 부른다');
  assert.ok(중간호출 < calls.length);
  assert.equal(기록[기록.length - 1].action, 'finish');
});

test('S4: 통과한 묶음은 다시 배우지 않는다(다음 tick 에서 모델 호출 0)', async () => {
  const memStore = await 준비();
  const 첫 = 대본모델();
  await 끝까지({ memStore, modelFor: 첫.modelFor });
  const 둘 = 대본모델();
  const r = await growTick({ memStore, modelFor: 둘.modelFor, now: 200_000 });
  assert.equal(둘.calls.length, 0);
  assert.equal(r.reason, 'idle');
});

// ── 통과 경로: 그래도 행동 영향은 0 ────────────────────────────────────────
test('S4: suite 를 채우면 후보에 통과 보고서가 붙는다 — 그래도 입장은 0', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  const { 기록 } = await 끝까지({ memStore, modelFor });

  assert.equal(기록[기록.length - 1].pass, true);
  const memory = await memStore.load();
  const 후보 = 마지막원리(memory);
  assert.equal(후보.replayReport.pass, true);
  assert.deepEqual(후보.replayReport.missing, []);
  assert.equal(admittedContext(memory, 관련요청).length, 0, '통과했다고 입장하지 않는다');
  assert.equal(calls.every((c) => !c.tools?.length), true, '성장 호출은 손을 쓰지 않는다');
  assert.equal(calls.every((c) => c.role === 'growth'), true);
});

test('S4: 저장된 후보 상태는 정직하다(통과해도 승인·입장 표식을 미리 켜지 않는다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델();
  await 끝까지({ memStore, modelFor });
  const 후보 = 마지막원리(await memStore.load());
  assert.equal(후보.admitted, false);
  assert.equal(후보.userConfirmed, false);
  assert.equal(후보.replayPassed, false, 'replay 통과 표식은 승격 통로에서만 켠다');
});

test('S4: 통과한 원리는 사용자가 확인해야 입장한다(확인하면 그때 들어간다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델();
  await 끝까지({ memStore, modelFor });
  const memory = await memStore.load();
  const 확인 = confirmCandidate(memory, 마지막원리(memory).candidateId);
  assert.equal(확인.ok, true);
  assert.equal(admittedContext(memory, 관련요청).length, 1);
});

// ── 불통과 경로 ────────────────────────────────────────────────────────────
test('S4: 금지 사실이 나온 negative 케이스가 있으면 통과가 아니다', async () => {
  const memStore = await 준비();
  // 호출 순서: 0 제안 · (1,2)=case0 · (3,4)=case1 · (5,6)=case2(negative).
  const { modelFor } = 대본모델({
    판정: (n) => (n === 6 ? '{"pass":false,"rationale":"금지 사실이 나왔다"}' : '{"pass":true,"rationale":"ok"}'),
  });
  const { 기록 } = await 끝까지({ memStore, modelFor });
  assert.equal(기록[기록.length - 1].pass, false);

  const memory = await memStore.load();
  const 후보 = 마지막원리(memory);
  assert.equal(후보.replayReport.pass, false);
  assert.ok(후보.replayReport.missing.length > 0);
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
  await 끝까지({ memStore, modelFor });
  assert.ok(마지막원리(await memStore.load()).replayReport.missing.includes('positive_sample'));
});

test('S4: 판정을 못 읽으면 그 케이스는 표본이 아니다(판정 불가는 통과가 아니다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({
    판정: (n) => (n === 2 ? '음… 판단이 어렵네요.' : '{"pass":true,"rationale":"ok"}'),
  });
  await 끝까지({ memStore, modelFor });
  const 후보 = 마지막원리(await memStore.load());
  assert.equal(후보.replayReport.pass, false);
  assert.ok(후보.replayReport.missing.includes('positive_sample'), 'positive 표본이 하나 줄어든다');
});

// ── 감사 지적 3: 실패한 묶음을 영구히 닫지 않는다 ──────────────────────────
test('S4: suite 불통과는 묶음을 닫지 않는다(쉬었다가 다음 회차를 연다)', async () => {
  const memStore = await 준비();
  const 실패 = 대본모델({ 판정: () => '{"pass":false,"rationale":"안 지켰다"}' });
  const { 기록, now } = await 끝까지({ memStore, modelFor: 실패.modelFor });
  assert.equal(기록[기록.length - 1].pass, false);

  const 중간 = await memStore.load();
  const job = 중간.growJobs[0];
  assert.equal(job.state, 'cooldown', '실패는 종단이 아니다');
  assert.equal((중간.grownBundles ?? []).includes('b-1'), false, '묶음을 소비하지 않는다');

  // 쉬는 동안에는 부르지 않는다.
  const 쉬는중 = 대본모델();
  assert.equal((await growTick({ memStore, modelFor: 쉬는중.modelFor, now: now + 1_000 })).reason, 'idle');
  assert.equal(쉬는중.calls.length, 0);

  // 쉬는 시간이 지나면 **새 회차**가 열린다 — 같은 묶음에서 다시 배울 기회.
  const 다음회차 = 대본모델();
  const r = await growTick({ memStore, modelFor: 다음회차.modelFor, now: now + GROW_CAPS.retryCooldownMs + 1 });
  assert.equal(r.action, 'propose');
  assert.equal(다음회차.calls.length, 1);
  assert.equal((await memStore.load()).growJobs.some((j) => j.round === 1), true);
});

test('S4: 회차를 다 쓰면 종단이고, 종단은 저절로 되살아나지 않는다', async () => {
  const memStore = await 준비();
  let now = 100_000;
  for (let round = 0; round < GROW_CAPS.maxRounds; round += 1) {
    const 실패 = 대본모델({ 판정: () => '{"pass":false,"rationale":"안 지켰다"}' });
    const r = await 끝까지({ memStore, modelFor: 실패.modelFor, 시작: now });
    now = r.now + GROW_CAPS.retryCooldownMs + 1;
  }
  const m = await memStore.load();
  const job = m.growJobs.find((j) => j.bundleId === 'b-1' && j.state === 'exhausted');
  assert.ok(job, `회차 ${GROW_CAPS.maxRounds} 를 쓰면 종단이다`);
  assert.equal((m.grownBundles ?? []).includes('b-1'), true, '종단이면 묶음을 닫는다');

  // 아무리 시간이 지나도 저절로 다시 시작하지 않는다(§4.3 terminal 자동 부활 금지).
  const 나중 = 대본모델();
  const r = await growTick({ memStore, modelFor: 나중.modelFor, now: now + GROW_CAPS.retryCooldownMs * 100 });
  assert.equal(r.reason, 'idle');
  assert.equal(나중.calls.length, 0);
});

test('S4: 호출이 실패하면 물러났다가 다시 오고, 계속 실패하면 그 회차를 접는다', async () => {
  const memStore = await 준비();
  const 죽은모델 = () => ({ async respond() { throw new Error('연결 실패'); } });
  let now = 100_000;

  const 첫 = await growTick({ memStore, modelFor: 죽은모델, now });
  assert.equal(첫.reason, 'call_failed');
  let job = (await memStore.load()).growJobs[0];
  assert.equal(job.failures, 1);
  assert.ok(job.nextAttemptAt > now, '바로 다시 부르지 않는다(backoff)');

  // 물러난 동안에는 아무 것도 안 한다.
  assert.equal((await growTick({ memStore, modelFor: 죽은모델, now: now + 1_000 })).reason, 'idle');

  for (let i = 1; i < GROW_CAPS.maxCallFailures; i += 1) {
    now = job.nextAttemptAt + 1;
    await growTick({ memStore, modelFor: 죽은모델, now });
    job = (await memStore.load()).growJobs[0];
  }
  assert.equal(job.state, 'cooldown', '연속 실패는 그 회차를 접는다(묶음은 살아 있다)');
  assert.equal(((await memStore.load()).grownBundles ?? []).includes('b-1'), false);
});

// ── 저장된 증거로 다시 판정된다 ────────────────────────────────────────────
test('S4: 보고서는 저장된 증거만으로 재현된다(산출물이 바뀌면 통과가 무너진다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델();
  await 끝까지({ memStore, modelFor });
  const memory = await memStore.load();
  const 후보 = 마지막원리(memory);

  const 재현 = verifySuiteFromMemory(memory, 후보.principleId);
  assert.equal(재현.pass, true);
  assert.equal(재현.cases, 후보.replayReport.cases);

  const 바꿀것 = Object.keys(memory.replayOutputs)[0];
  const 변조 = { ...memory, replayOutputs: { ...memory.replayOutputs, [바꿀것]: '다른 답' } };
  assert.equal(verifySuiteFromMemory(변조, 후보.principleId).pass, false, '바꿔치기된 증거로는 통과하지 않는다');

  const 지움 = { ...memory, replayReceipts: memory.replayReceipts.slice(1) };
  assert.equal(verifySuiteFromMemory(지움, 후보.principleId).pass, false);
});

// ── 잘린 응답 ──────────────────────────────────────────────────────────────
test('S4: 잘린 제안에서 완전한 사례만 건진다(모자란 조각을 채워 넣지 않는다)', () => {
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
  await 끝까지({ memStore, modelFor });
  const 후보 = 마지막원리(await memStore.load());
  assert.equal(후보.replayReport.pass, false);
  assert.ok(후보.replayReport.missing.includes('positive_sample'));
  assert.ok(후보.replayReport.missing.includes('boundary_sample'));
});

// ── 제품 경로: 전경 비용 0 · tick 안 상호 격리 · 자물쇠 분리 ────────────────
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

/** 이미 익은 묶음을 심는다 — "할 일이 없어서 안 불렀다"와 "안 부른다"를 가르기 위해서다. */
async function 익은묶음심기(mem) {
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
}

test('S4/제품: 사용자 턴은 성장을 부르지 않는다(전경 비용 0)', async () => {
  const { modelFor, calls } = 대본모델();
  const { server, base, mem } = await 서버세우기({ modelConnection: { modelFor } });
  try {
    await 익은묶음심기(mem);
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: '지출 정리해줘' });
    assert.equal(calls.length, 0, '할 일이 있어도 턴 경로는 성장을 부르지 않는다');

    await server.runtimeTick();
    assert.ok(calls.length > 0, 'tick 에서는 부른다 — 위 0 이 "못 부른다"가 아니라 "안 부른다"다');
  } finally { server.close(); }
});

test('S4/제품: 성장 모델이 매달려 있어도 전경 기억 작업은 막히지 않는다(계획 §4.8)', async () => {
  // `withMemory` 는 기억 쓰기 직렬화 자물쇠다. 성장 **호출**을 그 안에서 기다리면,
  // 모델이 느린 동안 사용자의 기억 저장·철회가 통째로 멈춘다(감사 지적 — 수정 전 실패 확인).
  let 놓아주기 = () => {};
  const 매달림 = new Promise((r) => { 놓아주기 = r; });
  const 걸린모델 = () => ({
    async respond(tc, opts) {
      opts?.onCallIdentity?.(신분(0));
      await 매달림;               // 모델이 응답하지 않는 상태
      return 제안();
    },
  });

  const { server, base, mem } = await 서버세우기({ modelConnection: { modelFor: 걸린모델 } });
  try {
    await 익은묶음심기(mem);
    const tick = server.runtimeTick();        // 성장이 모델에 매달린다
    await new Promise((r) => setTimeout(r, 300));

    const s = await post(base, '/sessions');
    const 전경 = await Promise.race([
      post(base, '/turn', { sessionId: s.id, text: '앞으로 보고서는 짧은 목록으로 정리해줘.' }),
      new Promise((r) => setTimeout(() => r({ 막힘: true }), 4_000)),
    ]);
    assert.notEqual(전경.막힘, true, '성장 모델 대기가 전경 기억 경로를 막았다');

    놓아주기();
    await tick;
  } finally { 놓아주기(); server.close(); }
});

test('S4/제품: 같은 tick 안에서 성장이 터져도 관찰·자동화는 그대로 돈다', async () => {
  const { server, base, mem } = await 서버세우기({
    modelConnection: { modelFor: () => { throw new Error('성장 연결 실패'); } },
  });
  try {
    const s = await post(base, '/sessions');
    for (let i = 0; i < 3; i += 1) await post(base, '/turn', { sessionId: s.id, text: '지출 정리해줘' });
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
    const s0 = await post(base, '/sessions');
    for (let i = 0; i < 3; i += 1) await post(base, '/turn', { sessionId: s0.id, text: '지출 정리해줘' });
    for (let i = 0; i < 3; i += 1) await server.runtimeTick();
    const r = await server.runtimeTick();
    assert.equal(r.grow ?? null, null, '격리된 뒤에는 성장 결과 자체가 나오지 않는다');
    assert.equal(r.ok, true);

    const s = await post(base, '/sessions');
    const 답 = await post(base, '/turn', { sessionId: s.id, text: '안녕' });
    assert.ok(typeof 답?.reply === 'string' && 답.reply.length > 0, '대화가 계속된다');
    assert.ok((await mem.load()).observations.length >= 3);
  } finally { server.close(); }
});
