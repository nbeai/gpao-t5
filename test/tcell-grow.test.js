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

test('S4/제품: 실제 서버 배선에서 성장 호출과 전경 기억 쓰기가 겹친다(구조로 판정)', async () => {
  // 앞의 lock depth 검사는 **검사용 wrapper** 를 봤다. 여기서는 제품이 실제로 쓰는
  // `withMemory` 경계를 본다 — 성장 호출이 도는 **동안** 전경 기억 쓰기가 실제로 끝나는지.
  // "안 막혔다(시간)"가 아니라 "겹쳤다(순서)"를 판정한다.
  const 흐름 = [];
  let 놓아주기 = () => {};
  const 매달림 = new Promise((r) => { 놓아주기 = r; });
  const 걸린모델 = () => ({
    async respond(tc, opts) {
      opts?.onCallIdentity?.(신분(0));
      흐름.push('성장호출 시작');
      await 매달림;
      흐름.push('성장호출 끝');
      return 제안();
    },
  });

  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-grow-srv-'));
  const mem = new MemoryStore(dir);
  const 감시기억 = {
    dir,
    load: (...a) => mem.load(...a),
    save: async (m) => { const r = await mem.save(m); 흐름.push('전경 기억 저장'); return r; },
  };
  const store = new SessionStore(dir);
  const server = makeServer({
    store, eventLog: new EventLog(dir), tools: demoTools(),
    model: { async respond() { return '알겠어요.'; } },
    memoryStore: 감시기억,
    modelConnection: { modelFor: 걸린모델 },
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await 익은묶음심기(mem);
    // 전경에서 **실제로 저장이 일어나는** 일을 하나 심어 둔다(없는 후보를 확인하면 저장이 없다).
    const m0 = await mem.load();
    m0.candidates = [...(m0.candidates ?? []), {
      candidateId: 'c-전경', kind: 'preference', statement: '보고서는 짧은 목록으로',
      admitted: false, userConfirmed: false, replayPassed: true, rollbackable: true,
    }];
    await mem.save(m0);
    const 심은뒤 = 흐름.length;

    const tick = server.runtimeTick();
    // 성장이 모델에 매달릴 때까지 기다린다(폴링 — 시간 상한이 아니라 상태를 본다).
    for (let i = 0; i < 200 && !흐름.includes('성장호출 시작'); i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(흐름.includes('성장호출 시작'), '성장 호출이 시작됐다');

    // 이제 전경에서 기억을 쓴다 — 제품의 `withMemory` 를 그대로 탄다.
    const 확인 = await fetch(`${base}/memory/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId: 'c-전경' }),
    }).then((r) => r.json()).catch(() => null);
    assert.equal(확인?.ok, true, '전경 기억 승격이 실제로 끝났다');

    놓아주기();
    await tick;

    const 시작 = 흐름.indexOf('성장호출 시작');
    const 끝 = 흐름.indexOf('성장호출 끝');
    assert.ok(심은뒤 >= 0);
    // 성장 호출이 시작된 **뒤에** 일어난 전경 저장을 본다(그 앞의 저장은 관찰 워커 몫이다).
    const 전경 = 흐름.indexOf('전경 기억 저장', 시작);
    assert.ok(시작 >= 0 && 끝 > 시작, `성장 호출 구간이 있다: ${흐름.join(' → ')}`);
    // 자물쇠를 들고 모델을 기다렸다면 전경 저장은 **끝난 뒤에만** 올 수 있다.
    assert.ok(전경 > 시작 && 전경 < 끝,
      `전경 기억 쓰기가 성장 호출 중에 끝나야 한다: ${흐름.join(' → ')}`);
  } finally { 놓아주기(); server.close(); }
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

// ── 감사 확인 1: 모델 호출이 정말 자물쇠 밖에서 도는가 ─────────────────────
test('S4: 모델을 부르는 동안 기억 자물쇠를 들고 있지 않다(구조로 판정)', async () => {
  // 앞의 제품 검사는 "전경이 안 막혔다"를 **시간**으로 봤다. 시간은 빠른 기계에서 통과할 수
  // 있다. 여기서는 자물쇠 보유 깊이를 직접 세고, 모델 호출 순간의 깊이가 0인지 본다.
  const memStore = await 준비();
  let 깊이 = 0;
  const 최대깊이 = [];
  let 순서 = Promise.resolve();
  const withMemory = (fn) => {
    const run = 순서.then(async () => { 깊이 += 1; try { return await fn(); } finally { 깊이 -= 1; } });
    순서 = run.catch(() => {});
    return run;
  };

  const { modelFor: 원래 } = 대본모델();
  const modelFor = (role) => {
    const c = 원래(role);
    return {
      async respond(tc, opts) {
        최대깊이.push(깊이);       // **이 순간** 자물쇠를 몇 겹 들고 있나
        return c.respond(tc, opts);
      },
    };
  };

  const { 기록 } = await 끝까지({ memStore, withMemory, modelFor });
  assert.equal(기록[기록.length - 1].action, 'finish');
  assert.ok(최대깊이.length >= 11, '실제로 모델을 여러 번 불렀다');
  assert.deepEqual([...new Set(최대깊이)], [0], `모델 호출 중 자물쇠 보유 깊이는 0이어야 한다(관측: ${[...new Set(최대깊이)].join(',')})`);
});

test('S4: 고르기와 반영은 자물쇠 안에서 한다(밖에서 상태를 만지지 않는다)', async () => {
  const memStore = await 준비();
  let 깊이 = 0;
  const 저장깊이 = [];
  let 순서 = Promise.resolve();
  const withMemory = (fn) => {
    const run = 순서.then(async () => { 깊이 += 1; try { return await fn(); } finally { 깊이 -= 1; } });
    순서 = run.catch(() => {});
    return run;
  };
  const 원래저장 = memStore.save.bind(memStore);
  memStore.save = async (m) => { 저장깊이.push(깊이); return 원래저장(m); };

  const { modelFor } = 대본모델();
  await 끝까지({ memStore, withMemory, modelFor });
  assert.ok(저장깊이.length > 0);
  assert.deepEqual([...new Set(저장깊이)], [1], '상태 저장은 전부 자물쇠 안에서 일어난다');
});

// ── 감사 확인 2: 동시 tick·재시작에서 덮어쓰기가 막히는가 ──────────────────
test('S4: 같은 job 을 두 tick 이 동시에 집지 않는다(빌림 표식)', async () => {
  const memStore = await 준비();
  let 순서 = Promise.resolve();
  const withMemory = (fn) => { const run = 순서.then(fn); 순서 = run.catch(() => {}); return run; };

  // 첫 tick 의 모델을 붙잡아 둔 채로 두 번째 tick 을 돌린다.
  let 놓아주기 = () => {};
  const 매달림 = new Promise((r) => { 놓아주기 = r; });
  const 느린 = { modelFor: () => ({ async respond(tc, opts) { opts?.onCallIdentity?.(신분(0)); await 매달림; return 제안(); } }) };
  const 빠른 = 대본모델();

  const 첫 = growTick({ memStore, withMemory, modelFor: 느린.modelFor, now: 100_000 });
  await new Promise((r) => setTimeout(r, 50));
  const 둘 = await growTick({ memStore, withMemory, modelFor: 빠른.modelFor, now: 100_100 });

  assert.equal(빠른.calls.length, 0, '앞 tick 이 집어 간 job 을 다시 집지 않는다');
  assert.equal(둘.reason, 'idle');
  놓아주기();
  const r = await 첫;
  assert.equal(r.action, 'propose');
  assert.equal((await memStore.load()).growJobs[0].state, 'running');
});

test('S4: 지나간 시도의 반영은 무시된다(재시작 뒤 뒤늦은 쓰기가 상태를 덮지 않는다)', async () => {
  const memStore = await 준비();
  let 순서 = Promise.resolve();
  const withMemory = (fn) => { const run = 순서.then(fn); 순서 = run.catch(() => {}); return run; };

  let 놓아주기 = () => {};
  const 매달림 = new Promise((r) => { 놓아주기 = r; });
  const 느린 = { modelFor: () => ({ async respond(tc, opts) { opts?.onCallIdentity?.(신분(0)); await 매달림; return 제안(); } }) };
  const 뒤에온것 = 대본모델();

  // ① 느린 tick 이 job 을 집는다.
  const 첫 = growTick({ memStore, withMemory, modelFor: 느린.modelFor, now: 100_000 });
  await new Promise((r) => setTimeout(r, 50));

  // ② 그 사이 프로세스가 다시 떠서(빌림 만료 뒤) 같은 job 을 집고 끝까지 간다.
  await 끝까지({ memStore, withMemory, modelFor: 뒤에온것.modelFor, 시작: 100_000 + GROW_CAPS.leaseMs + 1 });
  const 나중상태 = await memStore.load();
  const 나중케이스수 = 나중상태.replayReceipts.length;
  assert.ok(나중케이스수 >= 5, '뒤에 온 쪽이 제 일을 다 했다');

  // ③ 이제야 느린 tick 이 결과를 들고 온다 — 덮으면 안 된다.
  놓아주기();
  const r = await 첫;
  assert.equal(r.reason, 'superseded', '지나간 시도의 결과는 반영하지 않는다');
  const 최종 = await memStore.load();
  assert.equal(최종.replayReceipts.length, 나중케이스수, '영수증이 늘거나 중복되지 않는다');
  assert.equal(최종.growJobs.filter((j) => j.bundleId === 'b-1').length, 1, 'job 이 갈라지지 않는다');
});

test('S4: 빌림이 만료되면 다시 집을 수 있다(끊긴 작업이 영원히 잠기지 않는다)', async () => {
  const memStore = await 준비();
  const 죽은 = () => ({ async respond() { await new Promise(() => {}); } }); // 영원히 안 돌아옴
  growTick({ memStore, modelFor: 죽은, now: 100_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 50));

  const 잠긴동안 = 대본모델();
  assert.equal((await growTick({ memStore, modelFor: 잠긴동안.modelFor, now: 100_100 })).reason, 'idle');
  assert.equal(잠긴동안.calls.length, 0);

  const 만료뒤 = 대본모델();
  const r = await growTick({ memStore, modelFor: 만료뒤.modelFor, now: 100_000 + GROW_CAPS.leaseMs + 1 });
  assert.equal(r.action, 'propose', '빌림이 끝나면 다른 tick 이 이어받는다');
  assert.equal(만료뒤.calls.length, 1);
});

// ── 감사 확인 1: 빌림이 모든 상태에서 풀리는가 ─────────────────────────────
const 빌림풀림 = (job, now) => (job.nextAttemptAt ?? 0) - now < GROW_CAPS.leaseMs;

test('S4: 어떤 끝에서도 빌림이 영구화되지 않는다(성공·실패·신분실패·예산·종단)', async () => {
  const 확인 = async (이름, 만들기) => {
    const { memStore, now } = await 만들기();
    const jobs = (await memStore.load()).growJobs ?? [];
    for (const j of jobs) {
      assert.ok(빌림풀림(j, now), `${이름}: job(${j.state}) 의 빌림이 안 풀렸다`);
    }
    return jobs;
  };

  // ① 정상 진행 — 전이마다 곧바로 풀린다.
  await 확인('전이 성공', async () => {
    const memStore = await 준비();
    const { modelFor } = 대본모델();
    const r = await growTick({ memStore, modelFor, now: 100_000 });
    assert.equal(r.action, 'propose');
    return { memStore, now: 100_000 };
  });

  // ② 호출 실패 — backoff 로 물러나지만 빌림 시간보다 짧다.
  await 확인('호출 실패', async () => {
    const memStore = await 준비();
    const r = await growTick({ memStore, modelFor: () => ({ async respond() { throw new Error('x'); } }), now: 100_000 });
    assert.equal(r.reason, 'call_failed');
    return { memStore, now: 100_000 };
  });

  // ③ 신분 미확인 — 같은 계열로 물러난다.
  await 확인('신분 미확인', async () => {
    const memStore = await 준비();
    const { modelFor } = 대본모델({ 신분값: () => 신분({ selection: { requestedRole: 'growth', resolution: 'stub' } }) });
    const r = await growTick({ memStore, modelFor, now: 100_000 });
    assert.equal(r.reason, 'call_identity_unverified');
    return { memStore, now: 100_000 };
  });

  // ④ 통과 종단 — 빌림이 남지 않는다.
  await 확인('통과 종단', async () => {
    const memStore = await 준비();
    const { modelFor } = 대본모델();
    const { now } = await 끝까지({ memStore, modelFor });
    return { memStore, now };
  });

  // ⑤ 불통과 → cooldown. 이건 빌림이 아니라 **회차 대기**다 — 그 사실을 구분해 확인한다.
  const memStore = await 준비();
  const { modelFor } = 대본모델({ 판정: () => '{"pass":false,"rationale":"x"}' });
  const { now } = await 끝까지({ memStore, modelFor });
  const job = (await memStore.load()).growJobs[0];
  assert.equal(job.state, 'cooldown');
  assert.equal(job.nextAttemptAt - now > GROW_CAPS.leaseMs, true, 'cooldown 은 빌림보다 길다(의도된 대기)');
  assert.ok(job.nextAttemptAt - now <= GROW_CAPS.retryCooldownMs, '그래도 유한하다');
});

test('S4: 예산이 모자라 못 물어본 판정은 다음 tick 이 다시 묻는다(판정 불가로 굳지 않는다)', async () => {
  const memStore = await 준비();
  const 하루 = 86_400_000;
  const 지금 = 하루 * 30_000 + 5_000;
  const m = await memStore.load();
  // 오늘 남은 예산 2회: 제안 1 + 실행 1 → 판정은 못 묻는다.
  m.growBudget = { day: Math.floor(지금 / 하루), used: GROW_CAPS.callsPerDay - 2 };
  await memStore.save(m);

  const { modelFor, calls } = 대본모델();
  await growTick({ memStore, modelFor, now: 지금 });          // 제안(1)
  await growTick({ memStore, modelFor, now: 지금 + 1_000 });  // 실행(1) — 판정은 예산 없음
  assert.equal(calls.length, 2);
  const 중간 = (await memStore.load()).growJobs[0];
  const 미판정 = 중간.cases.find((c) => c.phase === 'ran');
  assert.ok(미판정, '판정을 못 물어본 케이스는 ran 으로 남는다');
  assert.equal(미판정.verdict ?? null, null);

  // 예산이 없어 미룬 것은 **실패가 아니다** — 물러나지 않고 곧바로 이어갈 수 있어야 한다.
  assert.equal(중간.failures, 0, '예산 소진을 실패로 세면 안 된다');
  assert.equal(중간.nextAttemptAt, 0, '예산 소진에 backoff 를 걸면 안 된다(다음 tick 이 바로 잇는다)');

  // 다음 날 예산이 서면 그 케이스부터 판정한다.
  const r = await growTick({ memStore, modelFor, now: 지금 + 하루 });
  assert.equal(r.action, 'judge_case', '못 물어본 판정을 이어서 묻는다');
  const 판정됨 = (await memStore.load()).growJobs[0].cases.find((c) => c.caseId === 미판정.caseId);
  assert.equal(판정됨.phase, 'judged');
  assert.equal(판정됨.verdict?.pass, true);
});

// ── 감사 확인 2: 동시 tick 에서도 일일 예산이 새지 않는가 ──────────────────
test('S4: 동시 tick 이 여러 job 을 집어도 일일 예산을 넘기지 않는다', async () => {
  const memStore = await 준비();
  const 하루 = 86_400_000;
  const 지금 = 하루 * 40_000 + 5_000;
  const m = await memStore.load();
  // 익은 묶음 셋 — 동시에 세 tick 이 각자 다른 job 을 집을 수 있는 상황.
  m.bundles = ['b-1', 'b-2', 'b-3'].map((id) => ({
    bundleId: id, kind: 'request', subject: `주제 ${id}`,
    observationIds: ['o-1', 'o-2', 'o-3'], count: 3, firstAt: 10, lastAt: 30,
  }));
  m.growBudget = { day: Math.floor(지금 / 하루), used: GROW_CAPS.callsPerDay - 2 }; // 오늘 2회만 남았다
  await memStore.save(m);

  let 순서 = Promise.resolve();
  const withMemory = (fn) => { const run = 순서.then(fn); 순서 = run.catch(() => {}); return run; };
  const 센다 = { n: 0 };
  const modelFor = () => ({
    async respond(tc, opts) {
      센다.n += 1;
      await new Promise((r) => setTimeout(r, 20));
      opts?.onCallIdentity?.(신분(0));
      return 제안();
    },
  });

  await Promise.all([
    growTick({ memStore, withMemory, modelFor, now: 지금 }),
    growTick({ memStore, withMemory, modelFor, now: 지금 + 1 }),
    growTick({ memStore, withMemory, modelFor, now: 지금 + 2 }),
  ]);

  assert.ok(센다.n <= 2, `남은 예산 2 인데 실제 호출 ${센다.n} 회 — 동시 tick 에서 예산이 샌다`);
  const 뒤 = await memStore.load();
  assert.ok(뒤.growBudget.used <= GROW_CAPS.callsPerDay, '장부도 상한을 넘지 않는다');
  assert.equal(뒤.growBudget.used, GROW_CAPS.callsPerDay - 2 + 센다.n, '장부가 실제 호출과 같다');
});

test('S4: 판정 호출이 실패하면 그 케이스는 판정 불가로 굳지 않고 다시 묻는다', async () => {
  const memStore = await 준비();
  // 호출 순번이 아니라 **무엇을 물었는지**로 답한다 — 판정이 한 번 실패하면 순번 규칙이
  // 어긋나서, 순번 기반 대본은 재시도 경로를 엉뚱하게 재게 된다.
  let 판정실패남음 = 1;
  const modelFor = () => ({
    async respond(tc, opts) {
      opts?.onCallIdentity?.(신분(0));
      const q = String(tc.currentRequest);
      if (q.includes('기대 사실:')) {
        if (판정실패남음 > 0) { 판정실패남음 -= 1; throw new Error('판정 호출만 죽는다'); }
        return '{"pass":true,"rationale":"ok"}';
      }
      if (q.includes('이번 답에 한해 적용할 원리')) return '답';
      return 제안();
    },
  });

  await growTick({ memStore, modelFor, now: 100_000 });                 // 제안
  const r = await growTick({ memStore, modelFor, now: 101_000 });       // 실행 성공 + 판정 실패
  assert.equal(r.reason, 'call_failed');

  const job = (await memStore.load()).growJobs[0];
  const c = job.cases.find((x) => x.runReceiptRef);
  assert.equal(c.phase, 'ran', '판정을 못 받았으면 ran 으로 남는다');
  assert.equal(c.verdict ?? null, null);
  assert.ok(job.failures >= 1, '호출 실패는 실패로 센다');

  // 물러난 시간이 지나면 **그 케이스의 판정부터** 다시 묻는다.
  const 다시 = await growTick({ memStore, modelFor, now: job.nextAttemptAt + 1 });
  assert.equal(다시.action, 'judge_case');
  const 뒤 = (await memStore.load()).growJobs[0].cases.find((x) => x.caseId === c.caseId);
  assert.equal(뒤.phase, 'judged');
  assert.equal(뒤.verdict?.pass, true, '되살아난 판정은 진짜 판정이다');
});

// ── 감사 지시 3: 다음 회차가 **더 나은** 원리를 낼 수 있는 구조인가 ────────
test('S4: 다음 회차는 앞 회차의 실패를 보고 제안한다(재추첨이 아니다)', async () => {
  const memStore = await 준비();
  const 실패 = 대본모델({ 판정: (n) => (n === 6 ? '{"pass":false,"rationale":"표를 강요했다"}' : '{"pass":true,"rationale":"ok"}') });
  const { now } = await 끝까지({ memStore, modelFor: 실패.modelFor });
  assert.equal((await memStore.load()).growJobs[0].state, 'cooldown');

  const 다음 = 대본모델();
  await growTick({ memStore, modelFor: 다음.modelFor, now: now + GROW_CAPS.retryCooldownMs + 1 });
  const 제안요청 = 다음.calls[0].request;

  assert.match(제안요청, /앞선 회차/, '앞 회차가 있었다는 사실을 전한다');
  assert.ok(제안요청.includes('월별 정리는 짧은 목록으로 한다'), '어떤 원리가 떨어졌는지 그대로 전한다');
  assert.match(제안요청, /표를 강요했다/, '왜 떨어졌는지도 전한다');
  assert.match(제안요청, /좁게|적용하지 않을/, '더 좁게 쓰라고 요구한다');
});

test('S4: 첫 회차에는 앞선 회차 이야기를 지어내지 않는다', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  await growTick({ memStore, modelFor, now: 100_000 });
  assert.equal(/앞선 회차/.test(calls[0].request), false, '없는 이력을 만들지 않는다');
});

test('S4: 실패 이력은 상한이 있고, 최근 것만 남는다(무한히 쌓지 않는다)', async () => {
  const memStore = await 준비();
  const m = await memStore.load();
  // 이미 이력이 상한보다 많이 쌓인 job 을 놓고 다음 회차로 넘긴다.
  const 옛것 = [1, 2, 3, 4].map((i) => ({ statement: `옛 원리 ${i}`, missing: [], reasons: [`사유 ${i}`] }));
  m.growJobs = [{
    jobId: 'j-옛', bundleId: 'b-1', round: 0, state: 'cooldown', attemptId: null,
    statement: '떨어진 원리', principleId: 'p-옛', principleVersion: 1, cases: [],
    failures: 0, nextAttemptAt: 100_000, lastReason: 'suite_failed',
    priorAttempts: 옛것,
    실패요약: { statement: '떨어진 원리', missing: ['positive_failed'], reasons: ['최근 사유'] },
    createdAt: 0, updatedAt: 0,
  }];
  await memStore.save(m);

  const { modelFor, calls } = 대본모델();
  await growTick({ memStore, modelFor, now: 100_001 });
  const 새것 = (await memStore.load()).growJobs.find((j) => j.round === 1);
  assert.ok(새것);
  assert.equal(새것.priorAttempts.length, GROW_CAPS.priorAttempts, `이력은 ${GROW_CAPS.priorAttempts}건까지만`);
  assert.equal(새것.priorAttempts.at(-1).statement, '떨어진 원리', '가장 최근 실패가 남는다');
  assert.equal(새것.priorAttempts.some((a) => a.statement === '옛 원리 1'), false, '오래된 것부터 걷는다');
  // 제안 요청에도 상한만큼만 실린다 — 최근 둘만 있고 오래된 것은 없다.
  assert.ok(calls[0].request.includes('옛 원리 4'));
  assert.ok(calls[0].request.includes('최근 사유'));
  for (const 오래된 of ['옛 원리 1', '옛 원리 2', '사유1']) {
    assert.equal(calls[0].request.includes(오래된), false, `${오래된} 은 실리지 않는다`);
  }
});

test('S4/구조: 회차가 넘어가며 좁아진 원리는 통과하고, 그때 실제로 입장한다', async () => {
  // 감사 지시 3. 시간을 조작해 제품을 속이는 게 아니라, **격리 환경에서 회차 구조가
  // 개선을 실어 나르는지**를 본다: 1회차 과잉 일반화로 불통과 → 2회차에 좁힌 원리 →
  // suite 통과 → 사용자 확인 → 행동에 실제 입장.
  const memStore = await 준비();

  // 1회차: negative 에서 과잉 적용(라이브에서 실제로 난 모양).
  const 넓은원리 = 대본모델({
    판정: (n) => (n === 6 ? '{"pass":false,"rationale":"표 대신 문장 요약을 원했는데 표로 냈다"}' : '{"pass":true,"rationale":"ok"}'),
  });
  const { now } = await 끝까지({ memStore, modelFor: 넓은원리.modelFor });
  const 첫후보 = 마지막원리(await memStore.load());
  assert.equal(첫후보.replayReport.pass, false);
  assert.deepEqual(confirmCandidate(await memStore.load(), 첫후보.candidateId), { ok: false, reason: 'replay_failed' });

  // 2회차: 앞 회차 실패를 보고 **적용 범위를 명시한** 원리를 낸다.
  const 좁은문장 = '월별 수치 정리를 요청하면 짧은 목록으로 한다(사용자가 다른 형식을 지정하면 그 요청을 따른다)';
  const 좁은원리 = 대본모델({ 제안본문: 제안({ statement: 좁은문장 }) });
  const r2 = await 끝까지({ memStore, modelFor: 좁은원리.modelFor, 시작: now + GROW_CAPS.retryCooldownMs + 1 });
  assert.equal(r2.기록[r2.기록.length - 1].pass, true, '좁힌 원리는 suite 를 통과한다');

  const memory = await memStore.load();
  const 둘째후보 = memory.candidates.find((c) => c.statement === 좁은문장);
  assert.ok(둘째후보, '2회차 후보가 따로 선다');
  assert.equal(둘째후보.principleVersion, 2, '회차가 다르면 원리 판도 다르다');
  assert.notEqual(둘째후보.candidateId, 첫후보.candidateId, '앞 회차 후보를 덮어쓰지 않는다');

  // **여기까지 와야 학습이다** — 확인하면 다음 턴부터 실제로 행동에 든다.
  const 확인 = confirmCandidate(memory, 둘째후보.candidateId);
  assert.equal(확인.ok, true);
  assert.equal(admittedContext(memory, '월별 수치 정리해줘').length, 1, '승격된 원리가 실제로 입장한다');
  assert.equal(memory.promoted.find((e) => e.statement === 좁은문장).replayPassed, true);
});
