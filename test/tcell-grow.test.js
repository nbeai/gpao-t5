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
import { caseInputDigestOf } from '../src/kernel/l5-growth/tcell-replay.js';
import {
  growTick, GROW_CAPS, verifySuiteFromMemory, parseProposal, computeCaseVerdict,
} from '../src/kernel/l5-growth/tcell-grow.js';

// 원리 문장과 실제로 겹치는 요청 — 이걸 안 주면 `admittedContext` 는 무조건 0을 돌려주고,
// "입장 0" 검사가 통과해도 아무 것도 증명하지 못한다(검사가 자기 의도만 확인하는 자리).
// 픽스처 사례(`7월 지출을 정리해달라고 했다`)와 **같은 상황**의 발화여야 한다 —
// 입장 판정이 낱말이 아니라 검증된 사례를 보기 때문이다.
const 관련요청 = '7월 지출 정리해줘';

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
/** 판정 요청에서 답·항목 수를 읽어 항목별 판정을 만든다 — v3 계약(항목·근거·OS 계산)용. */
function 판정대본(req, { 미충족필수 = [], 출현금지 = [] } = {}) {
  const 답 = /\[원리를 놓고 나온 답\] ([\s\S]*?)\n\n/.exec(req)?.[1] ?? '';
  const ev = 답.replace(/\s+/g, ' ').trim().slice(0, 24);
  const 필수수 = (req.match(/^필수 \d+\./gm) ?? []).length;
  const 금지수 = (req.match(/^금지 \d+\./gm) ?? []).length;
  return JSON.stringify({
    required: Array.from({ length: 필수수 }, (_, i) => (미충족필수.includes(i)
      ? { i, met: false }
      : { i, met: true, evidence: ev })),
    forbidden: Array.from({ length: 금지수 }, (_, i) => (출현금지.includes(i)
      ? { i, appeared: true, evidence: ev }
      : { i, appeared: false })),
    rationale: 미충족필수.length || 출현금지.length ? '계약 위반' : '기대를 지켰다',
  });
}

function 대본모델({
  제안본문 = 제안(),
  // 사례 유효성 점검(H02 성과 계열): 기본은 전부 유효. 시험이 무효를 대본으로 준다.
  유효성 = () => '{"invalid":[]}',
  판정 = (k, req) => 판정대본(req),
  답 = () => '짧은 목록으로 정리했습니다.',
  신분값 = 신분,
} = {}) {
  const calls = [];
  let 판정수 = 0;
  const modelFor = (role) => ({
    async respond(tc, opts = {}) {
      const n = calls.length;
      const req = String(tc.currentRequest ?? '');
      calls.push({ role, request: req, tools: opts.tools ?? null, maxTokens: opts.maxTokens ?? null });
      opts.onCallIdentity?.(신분값(n));
      // **내용으로 가른다** — 호출 순서가 바뀌어도(유효성 점검 삽입 등) 대본이 어긋나지 않는다.
      if (req.includes('운영 원리 후보')) return 제안본문;
      if (req.includes('사례 유효성')) return 유효성(n);
      if (req.includes('기대 사실:')) { 판정수 += 1; return 판정(판정수, req); }
      return 답(n);
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

  assert.equal(calls.length, 12, '제안 1 + 사례 유효성 1 + (실행·판정)×5');
  assert.ok(기록.length >= Math.ceil(12 / GROW_CAPS.callsPerTick), '여러 tick 에 걸쳐 돈다');
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
  await growTick({ memStore, modelFor, now: 100_500 });   // 사례 유효성
  await growTick({ memStore, modelFor, now: 101_000 });   // 첫 케이스
  const 중간호출 = calls.length;
  const 중간영수증 = (await memStore.load()).replayReceipts.length;
  assert.ok(중간영수증 >= 1, '케이스 하나의 증거가 이미 저장돼 있다');

  const { 기록 } = await 끝까지({ memStore, modelFor, 시작: 102_000 });
  assert.equal(calls.length, 12, '앞의 호출을 되풀이하지 않고 나머지만 부른다');
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
  // 판정 대본은 서수다: 1=case0 · 2=case1 · 3=case2(negative).
  const { modelFor } = 대본모델({
    판정: (k, req) => 판정대본(req, k === 3 ? { 출현금지: [0] } : {}),
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

test('S4: 표본이 모자라면 통과가 아니다(positive 1건짜리 제안 — 돌리기 전에 접는다)', async () => {
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
  const r = await growTick({ memStore, modelFor, now: 100_000 }); // 첫 tick = 제안
  assert.match(r.reason ?? '', /proposal_short/);
  assert.match(r.reason, /positive_sample/);
  // 채우지 못한 제안으로는 후보를 세우지 않는다 — 그게 "표본 없음은 통과가 아니다"의 실제 모습이다.
  assert.equal(마지막원리(await memStore.load()) ?? null, null);
  assert.equal((await memStore.load()).growJobs[0].실패요약.missing.includes('positive_sample'), true);
});

test('S4: 판정을 못 읽으면 그 케이스는 표본이 아니다(판정 불가는 통과가 아니다)', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({
    판정: (k, req) => (k <= 2 ? '음… 판단이 어렵네요.' : 판정대본(req)), // 재판정 1회까지 불가여야 굳는다
  });
  await 끝까지({ memStore, modelFor });
  const 후보 = 마지막원리(await memStore.load());
  assert.equal(후보.replayReport.pass, false);
  assert.ok(후보.replayReport.missing.includes('positive_sample'), 'positive 표본이 하나 줄어든다');
});

// ── 감사 지적 3: 실패한 묶음을 영구히 닫지 않는다 ──────────────────────────
test('S4: suite 불통과는 묶음을 닫지 않는다(다음 tick 에 다음 회차를 연다)', async () => {
  const memStore = await 준비();
  const 실패 = 대본모델({ 판정: (k, req) => 판정대본(req, { 미충족필수: [0] }) });
  const { 기록, now } = await 끝까지({ memStore, modelFor: 실패.modelFor });
  assert.equal(기록[기록.length - 1].pass, false);

  const 중간 = await memStore.load();
  const job = 중간.growJobs[0];
  assert.equal(job.state, 'retry_pending', '실패는 종단이 아니다');
  assert.equal(job.nextAttemptAt, 0, '다음 회차를 시계로 늦추지 않는다');
  assert.equal((중간.grownBundles ?? []).includes('b-1'), false, '묶음을 소비하지 않는다');

  // **다음 tick** 에 새 회차가 열린다 — 같은 묶음에서 다시 배울 기회.
  const 다음회차 = 대본모델();
  const r = await growTick({ memStore, modelFor: 다음회차.modelFor, now });
  assert.equal(r.action, 'propose');
  assert.equal(다음회차.calls.length, 1);
  assert.equal((await memStore.load()).growJobs.some((j) => j.round === 1), true);
});

test('S4: 회차를 다 쓰면 종단이고, 종단은 저절로 되살아나지 않는다', async () => {
  const memStore = await 준비();
  let now = 100_000;
  for (let round = 0; round < GROW_CAPS.maxRounds; round += 1) {
    const 실패 = 대본모델({ 판정: (k, req) => 판정대본(req, { 미충족필수: [0] }) });
    const r = await 끝까지({ memStore, modelFor: 실패.modelFor, 시작: now });
    now = r.now; // 회차 사이에 어떤 대기도 없다
  }
  const m = await memStore.load();
  const job = m.growJobs.find((j) => j.bundleId === 'b-1' && j.state === 'exhausted');
  assert.ok(job, `회차 ${GROW_CAPS.maxRounds} 를 쓰면 종단이다`);
  assert.equal((m.grownBundles ?? []).includes('b-1'), true, '종단이면 묶음을 닫는다');

  // 아무리 시간이 지나도 저절로 다시 시작하지 않는다(§4.3 terminal 자동 부활 금지).
  const 나중 = 대본모델();
  const r = await growTick({ memStore, modelFor: 나중.modelFor, now: now + 1_000_000_000 });
  assert.equal(r.reason, 'idle');
  assert.equal(나중.calls.length, 0);
});

test('S4: 호출이 실패해도 시계로 물러나지 않고, 연속 실패 횟수가 그 회차를 접는다', async () => {
  const memStore = await 준비();
  const 죽은모델 = () => ({ async respond() { throw new Error('연결 실패'); } });
  let now = 100_000;

  const 첫 = await growTick({ memStore, modelFor: 죽은모델, now });
  assert.equal(첫.reason, 'call_failed');
  let job = (await memStore.load()).growJobs[0];
  assert.equal(job.failures, 1);
  assert.equal(job.nextAttemptAt, 0, 'tick 자체가 간격이다 — 시계로 더 물러나지 않는다');

  for (let i = 1; i < GROW_CAPS.maxCallFailures; i += 1) {
    now += 1_000; // 다음 tick 일 뿐
    await growTick({ memStore, modelFor: 죽은모델, now });
    job = (await memStore.load()).growJobs[0];
  }
  assert.equal(job.state, 'retry_pending', '연속 실패는 그 회차를 접는다(묶음은 살아 있다)');
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
  const { modelFor, calls } = 대본모델({ 제안본문: 잘림 });
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  // 건진 게 최소 표본에 못 미치면 **사례를 돌리지 않고** 접는다.
  assert.match(r.reason ?? '', /proposal_short/);
  assert.equal(calls.length, 1, '제안 한 번에서 멈춘다');
  const 부족 = (await memStore.load()).growJobs[0].실패요약.missing;
  assert.ok(부족.includes('positive_sample'));
  assert.ok(부족.includes('boundary_sample'));
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
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
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
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
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
  const 반영된 = (await memStore.load()).growJobs[0];
  assert.equal(반영된.state, 'proposing');
  assert.ok(반영된.초안, '제안이 초안으로 반영됐다(사례 유효성 점검 대기)');
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

  // ⑤ 불통과 → 다음 회차 대기. **이것도 시계가 아니다** — 다음 tick 에 그대로 열린다.
  const memStore = await 준비();
  const { modelFor } = 대본모델({ 판정: () => '{"pass":false,"rationale":"x"}' });
  const { now } = await 끝까지({ memStore, modelFor });
  const job = (await memStore.load()).growJobs[0];
  assert.equal(job.state, 'retry_pending');
  assert.equal(job.nextAttemptAt, 0, '회차 사이에 남는 시계가 없다');
  assert.ok(빌림풀림(job, now));
});

test('S4: 예산이 모자라 못 물어본 판정은 다음 tick 이 다시 묻는다(판정 불가로 굳지 않는다)', async () => {
  const memStore = await 준비();
  const 하루 = 86_400_000;
  const 지금 = 하루 * 30_000 + 5_000;
  const m = await memStore.load();
  // 오늘 남은 예산 3회: 제안 1 + 유효성 1 + 실행 1 → 판정은 못 묻는다.
  m.growBudget = { day: Math.floor(지금 / 하루), used: GROW_CAPS.callsPerDay - 3 };
  await memStore.save(m);

  const { modelFor, calls } = 대본모델();
  await growTick({ memStore, modelFor, now: 지금 });          // 제안(1)
  await growTick({ memStore, modelFor, now: 지금 + 500 });    // 사례 유효성(1)
  await growTick({ memStore, modelFor, now: 지금 + 1_000 });  // 실행(1) — 판정은 예산 없음
  assert.equal(calls.length, 3);
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
        return 판정대본(q);
      }
      if (q.includes('이번 답에 한해 적용할 원리')) return '답';
      if (q.includes('사례 유효성')) return '{"invalid":[]}';
      return 제안();
    },
  });

  await growTick({ memStore, modelFor, now: 100_000 });                 // 제안
  await growTick({ memStore, modelFor, now: 100_500 });                 // 사례 유효성
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
  const 실패 = 대본모델({ 판정: (k, req) => 판정대본(req, k === 3 ? { 출현금지: [0] } : {}) });
  const { now } = await 끝까지({ memStore, modelFor: 실패.modelFor });
  assert.equal((await memStore.load()).growJobs[0].state, 'retry_pending');

  const 다음 = 대본모델();
  await growTick({ memStore, modelFor: 다음.modelFor, now });
  const 제안요청 = 다음.calls[0].request;

  assert.match(제안요청, /앞선 회차/, '앞 회차가 있었다는 사실을 전한다');
  assert.ok(제안요청.includes('월별 정리는 짧은 목록으로 한다'), '어떤 원리가 떨어졌는지 그대로 전한다');
  assert.match(제안요청, /금지 출현/, '왜 떨어졌는지도 전한다');
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
    jobId: 'j-옛', bundleId: 'b-1', round: 0, state: 'cooldown', attemptId: null, // 옛 이름 그대로
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
    판정: (k, req) => 판정대본(req, k === 3 ? { 출현금지: [0] } : {}),
  });
  const { now } = await 끝까지({ memStore, modelFor: 넓은원리.modelFor });
  const 첫후보 = 마지막원리(await memStore.load());
  assert.equal(첫후보.replayReport.pass, false);
  assert.deepEqual(confirmCandidate(await memStore.load(), 첫후보.candidateId), { ok: false, reason: 'replay_failed' });

  // 2회차: 앞 회차 실패를 보고 **적용 범위를 명시한** 원리를 낸다.
  const 좁은문장 = '월별 수치 정리를 요청하면 짧은 목록으로 한다(사용자가 다른 형식을 지정하면 그 요청을 따른다)';
  const 좁은원리 = 대본모델({ 제안본문: 제안({ statement: 좁은문장 }) });
  const r2 = await 끝까지({ memStore, modelFor: 좁은원리.modelFor, 시작: now });
  assert.equal(r2.기록[r2.기록.length - 1].pass, true, '좁힌 원리는 suite 를 통과한다');

  const memory = await memStore.load();
  const 둘째후보 = memory.candidates.find((c) => c.statement === 좁은문장);
  assert.ok(둘째후보, '2회차 후보가 따로 선다');
  assert.equal(둘째후보.principleVersion, 2, '회차가 다르면 원리 판도 다르다');
  assert.notEqual(둘째후보.candidateId, 첫후보.candidateId, '앞 회차 후보를 덮어쓰지 않는다');

  // **여기까지 와야 학습이다** — 확인하면 다음 턴부터 실제로 행동에 든다.
  const 확인 = confirmCandidate(memory, 둘째후보.candidateId);
  assert.equal(확인.ok, true);
  assert.equal(admittedContext(memory, '7월 지출 정리해줘').length, 1, '승격된 원리가 실제로 입장한다');
  assert.equal(memory.promoted.find((e) => e.statement === 좁은문장).replayPassed, true);
});

// ── 옛 저장본 이관: 실패 이력이 없던 시절의 job ────────────────────────────
test('S4: 실패요약이 없던 옛 job 도 저장된 사실에서 복원해 다음 회차에 넘긴다', async () => {
  // 실패 이력 전달이 들어오기 전 코드가 쓴 cooldown job 이 실제 데이터에 남아 있다.
  // 그대로 두면 다음 회차가 앞 실패를 못 보고 **재추첨**으로 돈다 — 통로가 안 닿는다.
  const memStore = await 준비();
  const m = await memStore.load();
  m.growJobs = [{
    jobId: 'j-옛코드', bundleId: 'b-1', round: 0, state: 'cooldown', attemptId: null,
    statement: '여러 달 수치를 주면 표로 정리한다',
    principleId: 'p-옛', principleVersion: 1, cases: [],
    failures: 0, nextAttemptAt: 100_000,
    lastReason: 'suite_failed:positive_failed,forbidden_fact_occurred',
    createdAt: 0, updatedAt: 0, // 실패요약 없음 — 그 시절엔 이 칸이 없었다
  }];
  m.candidates = [{
    candidateId: 'p-옛', kind: 'operating_principle', statement: '여러 달 수치를 주면 표로 정리한다',
    principleId: 'p-옛', principleVersion: 1, admitted: false, userConfirmed: false, replayPassed: false,
    replayReport: { pass: false, missing: ['positive_failed', 'forbidden_fact_occurred'], counted: 4 },
  }];
  m.replayCases = [
    { caseId: 'c-1', principleId: 'p-옛', kind: 'negative', verdict: { pass: false, rationale: '표 대신 문장 요약을 원했는데 표로 냈다' } },
    { caseId: 'c-2', principleId: 'p-옛', kind: 'positive', verdict: { pass: true, rationale: 'ok' } },
  ];
  await memStore.save(m);

  const { modelFor, calls } = 대본모델();
  await growTick({ memStore, modelFor, now: 100_001 });

  const 요청 = calls[0].request;
  assert.match(요청, /앞선 회차/, '옛 job 도 앞 회차 이야기를 들고 간다');
  assert.ok(요청.includes('여러 달 수치를 주면 표로 정리한다'), '떨어진 원리를 그대로 전한다');
  assert.ok(요청.includes('표 대신 문장 요약을 원했는데 표로 냈다'), '실패 사유도 전한다');
  assert.ok(요청.includes('forbidden_fact_occurred'), '무엇이 부족했는지도 전한다');

  const 새것 = (await memStore.load()).growJobs.find((j) => j.round === 1);
  assert.equal(새것.priorAttempts.length, 1);
  assert.equal(새것.priorAttempts[0].statement, '여러 달 수치를 주면 표로 정리한다');
});

test('S4: 복원할 사실이 없으면 아무 것도 지어내지 않는다', async () => {
  const memStore = await 준비();
  const m = await memStore.load();
  // 원리 문장도 보고서도 사례도 없는 job — 남길 게 없다.
  m.growJobs = [{
    jobId: 'j-빈', bundleId: 'b-1', round: 0, state: 'cooldown', attemptId: null,
    statement: null, principleId: null, principleVersion: 1, cases: [],
    failures: 0, nextAttemptAt: 100_000, lastReason: 'call_failed:network',
    createdAt: 0, updatedAt: 0,
  }];
  await memStore.save(m);

  const { modelFor, calls } = 대본모델();
  await growTick({ memStore, modelFor, now: 100_001 });
  assert.equal(/앞선 회차/.test(calls[0].request), false, '없는 이력을 만들지 않는다');
  assert.equal((await memStore.load()).growJobs.find((j) => j.round === 1).priorAttempts.length, 0);
});

test('S4: 묶음이 사라진 job 은 종단이다(회차를 헛되이 태우지 않는다)', async () => {
  // 라이브에서 실제로 났다: 묶음 신분이 바뀌자 그걸 배우던 job 이 고아가 됐고,
  // `bundle_gone` 이 **호출 실패**로 세어져 회차만 축났다. 부를 것도 없었는데.
  const memStore = await 준비();
  const m = await memStore.load();
  m.growJobs = [{
    jobId: 'j-고아', bundleId: 'b-사라짐', round: 0, state: 'proposing', attemptId: null,
    statement: null, principleId: null, principleVersion: 1, cases: [],
    failures: 0, nextAttemptAt: 0, lastReason: null, createdAt: 0, updatedAt: 0,
  }];
  await memStore.save(m);

  const { modelFor, calls } = 대본모델();
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.equal(r.reason, 'bundle_gone');
  assert.equal(calls.length, 0, '부를 것이 없으니 모델을 부르지 않는다');

  const job = (await memStore.load()).growJobs.find((j) => j.jobId === 'j-고아');
  assert.equal(job.state, 'exhausted', '배울 대상이 없어진 job 은 종단이다');
  assert.equal(job.failures, 0, '호출 실패로 세지 않는다');
});

// ── H02 성과 계열 · 사례 유효성 — 자료 실물 없는 사례가 좋은 원리를 소진시키지 않는다 ──
//
// 봉인 6회 실측(2026-08-01): 실패 3회의 실패 사례 16건 중 11건이 같은 모양이었다 —
// inputFacts 가 "사용자가 수치를 제시했다"라고 **서술만** 하고 실제 수치·원문을 담지 않아,
// expectedFacts(표·계산)를 어떤 답으로도 달성할 수 없었다. 실행 모델은 정직하게 수치를
// 되묻거나("실제 수치를 알려줘야 해") 메타 답("원리에 해당한다")을 냈고, 판정은 그것을
// 원리의 실패로 계산해 좋은 원리가 소진됐다. 사례 자체의 유효성과 원리의 실패는 다른 사실이다.

/** 실물 없는 무효 사례 하나를 앞에 끼운 제안(나머지는 정상 표본). */
const 무효섞인제안 = () => 제안({
  cases: [
    { kind: 'positive', inputFacts: ['사용자가 7~10월 수치를 모두 제시했다'], expectedFacts: ['7~10월 표를 만든다', '각 달 이익을 계산한다'], forbiddenFacts: ['수치를 줄글로만 나열한다'] },
    { kind: 'positive', inputFacts: ['8월 지출을 정리해달라고 했다'], expectedFacts: ['짧은 목록으로 정리한다'], forbiddenFacts: ['표로 정리한다'] },
    { kind: 'negative', inputFacts: ['표로 보여달라고 명시했다'], expectedFacts: ['요청대로 표로 준다'], forbiddenFacts: ['목록을 강요한다'] },
    { kind: 'boundary', inputFacts: ['정리가 아니라 계산을 요청했다'], expectedFacts: ['계산을 한다'], forbiddenFacts: ['목록 정리로 바꾼다'] },
    { kind: 'boundary', inputFacts: ['한 줄 답이면 되는 질문이다'], expectedFacts: ['한 줄로 답한다'], forbiddenFacts: ['목록을 만든다'] },
  ],
});
const 무효답 = '{"invalid":[{"index":0,"reason":"inputFacts 에 실제 수치가 없는데 표·계산을 요구한다"}]}';

async function 틱들(deps, 횟수, 시작 = 100_000) {
  const 결과 = [];
  for (let i = 0; i < 횟수; i += 1) 결과.push(await growTick({ ...deps, now: 시작 + i * 1_000 }));
  return 결과;
}

test('S4·H02: 무효 사례는 실행되지 않고, 재제안이 무효 사유를 듣는다', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({
    제안본문: 무효섞인제안(),
    유효성: () => 무효답,
  });
  await 틱들({ memStore, modelFor }, 2); // 제안 → 유효성 점검
  assert.equal(calls.filter((c) => c.request.includes('[이번 답에 한해 적용할 원리]')).length, 0,
    '무효 사례가 유효 사례로 실행됐다');
  const m = await memStore.load();
  assert.equal(m.growJobs[0].state, 'proposing', '무효 발견은 같은 회차 안의 재제안으로 이어져야 한다');
  assert.equal(m.growJobs[0].nextAttemptAt, 0, '시간 대기로 바뀌면 안 된다');
  await 틱들({ memStore, modelFor }, 1, 102_000); // 재제안
  const 제안들 = calls.filter((c) => c.request.includes('운영 원리 후보'));
  assert.equal(제안들.length, 2, '재제안이 나가지 않았다');
  assert.match(제안들[1].request, /무효/, '재제안이 무효 사유를 듣지 못했다');
});

test('S4·H02: 무효가 반복되면 재생성은 1회에서 멈추고 회차를 정직하게 접는다 — suite 통과·실패로 계산되지 않는다', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({ 제안본문: 무효섞인제안(), 유효성: () => 무효답 });
  // 한 회차 = 제안 → 점검(무효) → 재제안 → 점검(무효) → 회차 접힘. 정확히 4 tick.
  await 틱들({ memStore, modelFor }, 4);
  const m = await memStore.load();
  const job = m.growJobs[0];
  assert.match(String(job.lastReason ?? ''), /invalid_cases/, '무효 반복이 회차를 접지 않았다');
  assert.equal(job.state, 'retry_pending', '접힌 회차는 다음 회차 대기다(무제한 재추첨 금지)');
  assert.equal(job.nextAttemptAt, 0, '시간 대기 금지');
  assert.equal(calls.filter((c) => c.request.includes('운영 원리 후보')).length, 2,
    '한 회차의 제안은 원본+재제안 두 번뿐이어야 한다');
  assert.equal(마지막원리(m) ?? null, null, '무효 사례가 suite 로 흘러 후보가 섰다');
  assert.equal(calls.filter((c) => c.request.includes('기대 사실:')).length, 0, '무효 사례가 판정으로 계산됐다');
});

test('S4·H02: 유효성 점검이 계속 읽히지 않으면 횟수로 접는다 — 영구 대기 없음', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({ 유효성: () => '점검 결과를 말로 설명하자면…' });
  // 회차마다 제안 1 + 읽기 실패 3(maxCallFailures) = 4 tick, 세 회차(maxRounds)면 12 tick 에 종단.
  await 틱들({ memStore, modelFor }, 12);
  const job = (await memStore.load()).growJobs[0];
  assert.equal(job.state, 'exhausted', `읽히지 않는 점검이 끝나지 않는다: ${job.state}`);
  assert.equal(job.nextAttemptAt, 0, '시간 대기 금지');
  assert.equal(calls.filter((c) => c.request.includes('운영 원리 후보')).length, GROW_CAPS.maxRounds,
    '회차당 제안 한 번 — 읽기 실패가 재추첨을 늘리면 안 된다');
});

test('S4·H02: 정상 표본은 유효성 점검을 지나 그대로 인정된다(사례 5건 전부 실행·판정)', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  await 끝까지({ memStore, modelFor });
  assert.equal(calls.filter((c) => c.request.includes('사례 유효성')).length, 1, '유효성 점검이 정확히 한 번');
  assert.equal(calls.filter((c) => c.request.includes('[이번 답에 한해 적용할 원리]')).length, 5, '정상 사례 5건 전부 실행');
  const m = await memStore.load();
  assert.equal(m.growJobs[0].state, 'passed');
});

// ── H02 권한 계약 — 접촉 여부는 사례 존재가 아니라 선언에서, 표본은 물리적으로 담긴다 ──

test('S4·H02: 권한 접촉 선언이면 authority 표본 없이는 사례를 돌리지 않는다', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({ 제안본문: 제안({ authorityScope: 'touches' }) });
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.match(String(r.reason ?? ''), /authority_sample/, '권한 접촉인데 authority 표본 없이 진행됐다');
});

test('S4·H02: 권한 접촉이면 표본 6건을 물리적으로 담고, 파서가 authority 를 밀어내지 않는다', () => {
  const 사례 = (kind, i) => ({ kind, inputFacts: [`상황${i}`], expectedFacts: ['e'], forbiddenFacts: ['f'] });
  const p = parseProposal(JSON.stringify({
    statement: '권한 원리', authorityScope: 'touches',
    cases: [사례('positive', 1), 사례('positive', 2), 사례('negative', 3), 사례('boundary', 4), 사례('boundary', 5), 사례('authority', 6)],
  }));
  assert.equal(p.touchesAuthority, true);
  assert.equal(p.cases.length, 6, '권한 접촉의 필요 표본(2P+1N+2B+1A=6)을 담지 못한다');
  assert.equal(p.cases.filter((c) => c.kind === 'authority').length, 1, 'authority 표본이 파서에서 밀려났다');
});

// ── H02 답 계약 v3 — 관측 가능 계약 · 축자/의미 구분 · 항목별 판정 · OS 계산 ──
//
// 감사 기각(재봉인2 원시): ① r21 boundary — allowed 로 허용한 행동을 판정이 위반으로 채점
// (오채점) ② r21 negative — "도우미가 …라고 여긴다"는 답만 보고 관측 불가한 계약이 유효성을
// 통과 ③ r17 positive — 쉼표·표기 차이의 축자 실패 3건(동일 brittleness 계열). 닫는 구조:
// 판정 모델은 **항목별** 충족/출현과 답 원문 근거만 내고, 최종 pass 는 OS 가 계산한다.
// 축자(exactFacts)는 OS 가 직접 대조하고, 일반 계약은 의미로 판정한다. 근거 없는 주장은
// 판정 불가이고, 답에 없는 위반 주장은 세지 않는다.

const 사례v3 = (over = {}) => ({
  caseId: 'c-v3', principleId: 'p-v3', principleVersion: 1, kind: 'positive',
  inputFacts: ['7월 매출 1200을 정리해달라고 했다'],
  expectedFacts: ['7월 매출 수치가 답에 있다'],
  forbiddenFacts: ['수치를 지어낸다'],
  ...over,
});
const 항목 = ({ 필수 = [], 금지 = [] } = {}) => ({ required: 필수, forbidden: 금지, rationale: 'r' });

test('H02·v3: allowed 는 수행해도 생략해도 실패가 아니다 — 판정 계산에 아예 들지 않는다', () => {
  const c = 사례v3({ allowedFacts: ['간단한 해설을 덧붙일 수 있다'] });
  const 답수행 = '7월 매출 1200입니다. 참고로 전월보다 늘었어요.';
  const 답생략 = '7월 매출 1200입니다.';
  for (const 답 of [답수행, 답생략]) {
    const v = computeCaseVerdict(c, 답, 항목({
      필수: [{ i: 0, met: true, evidence: '7월 매출 1200' }],
      금지: [{ i: 0, appeared: false }],
    }));
    assert.equal(v?.pass, true, `allowed 가 판정에 끼어들었다: ${답.slice(0, 12)}`);
  }
});

test('H02·v3: exact 계약은 OS 가 직접 대조한다 — 정확히 다르면 모델 판정과 무관하게 실패', () => {
  const c = 사례v3({ exactFacts: ['7월 매출 1200'] });
  const 틀림 = computeCaseVerdict(c, '7월 매출은 1,200 입니다.', 항목({
    필수: [{ i: 0, met: true, evidence: '7월 매출은 1,200' }],
    금지: [{ i: 0, appeared: false }],
  }));
  assert.equal(틀림?.pass, false, '축자 불일치를 모델 판정이 덮었다');
  const 맞음 = computeCaseVerdict(c, '요청하신 그대로: 7월 매출 1200 입니다.', 항목({
    필수: [{ i: 0, met: true, evidence: '7월 매출 1200' }],
    금지: [{ i: 0, appeared: false }],
  }));
  assert.equal(맞음?.pass, true);
});

test('H02·v4(계약 개정): 답에 없는 위반 주장은 실패도 통과도 아니다 — 판정 불가(null)다', () => {
  // v3 는 무근거 위반 주장을 "버려서" 통과로 흘렸다(감사 지적 ④). 개정: 실패를 만들지 않는
  // 것은 유지하되, 통과로도 흐르지 않는다 — null 로 재질문 1회를 받는다.
  const c = 사례v3();
  const v = computeCaseVerdict(c, '7월 매출 1200입니다.', 항목({
    필수: [{ i: 0, met: true, evidence: '매출 1200' }],
    금지: [{ i: 0, appeared: true, evidence: '지어낸 수치 9999' }], // 답에 없는 조각
  }));
  assert.equal(v, null, '무근거 위반 주장이 통과나 실패로 위장됐다');
});

test('H02·v3: 근거 없는 충족 주장·항목 누락은 판정 불가다 — 통과로도 실패로도 위장하지 않는다', () => {
  const c = 사례v3();
  const 근거없음 = computeCaseVerdict(c, '7월 매출 1200입니다.', 항목({
    필수: [{ i: 0, met: true }], 금지: [{ i: 0, appeared: false }],
  }));
  assert.equal(근거없음, null, '근거 없는 충족이 표본이 됐다');
  const 항목누락 = computeCaseVerdict(c, '7월 매출 1200입니다.', 항목({ 필수: [], 금지: [{ i: 0, appeared: false }] }));
  assert.equal(항목누락, null, '필수 항목 누락이 판정으로 굳었다');
  const 못읽음 = computeCaseVerdict(c, '7월 매출 1200입니다.', null);
  assert.equal(못읽음, null);
});

test('H02·v3: 실제 위반(근거가 답 원문)과 필수 미충족은 계속 실패다', () => {
  const c = 사례v3();
  const 위반 = computeCaseVerdict(c, '7월 매출 9999로 추정합니다.', 항목({
    필수: [{ i: 0, met: false }],
    금지: [{ i: 0, appeared: true, evidence: '9999로 추정' }],
  }));
  assert.equal(위반?.pass, false, 'r20·r21형 실제 위반이 통과로 바뀌면 안 된다');
});

test('H02·v3: 판정 요청은 항목별 근거를 요구하고, 의미/축자 구분을 계약으로 공급한다', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  await 끝까지({ memStore, modelFor });
  const 판정 = calls.find((c) => c.request.includes('기대 사실:'));
  assert.ok(판정, '판정 호출 없음');
  assert.match(판정.request, /필수 0\./, '항목이 번호로 특정되지 않는다');
  assert.match(판정.request, /evidence|근거/, '항목별 근거 요구가 없다');
  assert.match(판정.request, /의미|표현.*(달라도|차이)/, '의미 판정 방향이 계약에 없다');
});

test('H02·v3: 유효성 계약이 관측 불가 계약(내부 판단·원리 적용 여부)과 무근거 축자를 거부한다', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  await 틱들({ memStore, modelFor }, 2);
  const 검 = calls.find((c) => c.request.includes('사례 유효성'));
  assert.ok(검, '유효성 호출 없음');
  assert.match(검.request, /관측/, '관측 가능성 기준이 없다');
  assert.match(검.request, /여긴다|간주|적용 여부|내부/, '내부 판단·메타 계약 거부 기준이 없다');
  assert.match(검.request, /exactFacts/, '축자 계약 제한 기준이 없다');
});

test('H02·v3: exactFacts 는 저장·digest 에 묶이고, 옛 사례 digest 는 불변', () => {
  const 바탕 = {
    caseId: 'c-1', principleId: 'p-1', principleVersion: 1, kind: 'positive',
    sourceRefs: [], inputFacts: ['입력'], expectedFacts: ['필수'], forbiddenFacts: ['금지'],
  };
  assert.notEqual(caseInputDigestOf({ ...바탕, exactFacts: ['A'] }), caseInputDigestOf({ ...바탕, exactFacts: ['B'] }));
  assert.equal(caseInputDigestOf(바탕), caseInputDigestOf({ ...바탕, exactFacts: [] }));
  const p = parseProposal(JSON.stringify({
    statement: '원리',
    cases: [{ kind: 'positive', inputFacts: ['사용자가 답에 "이 문구" 그대로 넣으라고 했다'], exactFacts: ['이 문구'], expectedFacts: [], forbiddenFacts: [] },
      { kind: 'positive', inputFacts: ['b'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
      { kind: 'negative', inputFacts: ['c'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
      { kind: 'boundary', inputFacts: ['d'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
      { kind: 'boundary', inputFacts: ['e'], expectedFacts: ['e'], forbiddenFacts: ['f'] }],
  }));
  const 축자사례 = p.cases.find((c) => (c.exactFacts ?? []).length);
  assert.ok(축자사례, 'exactFacts 가 파서에서 사라졌다');
  assert.ok(축자사례.exactFacts.length + 축자사례.expectedFacts.length + 축자사례.forbiddenFacts.length > 0,
    '축자만 있는 사례의 판정력이 인정되지 않는다');
});

// ── H02 답 계약 v4 — 감사 재개(원시 4결함): exact 출처 결합 · forbidden 무근거 null ──
//
// 감사 원시 확인: ① r28 — 요청 문구("숫자만 다시 써줘")가 exact 출력 계약이 되어 정상 답을
// 실패시킴 ② r29 — 메타 계약("…라고 간주한다")이 유효 사례로 잔존 ③ r31 — null 소진을
// "실행 위반"으로 기록 ④ forbidden 무근거 출현 주장을 구현이 조용히 무시(→통과 가능).
// 구조 봉합: exact 는 사용자 발화 안 **따옴표 인용 literal** 일 때만(기계 검증, 아니면
// semantic 강등 — 모델이 뭐라 하든 OS 경계), forbidden 무근거 주장은 null(재질문 1회).

test('H02·v4→v5 재계약: 요청 문구는 exact 출력 literal 이 아니다 — 강등이 아니라 무효 표식이 남는다', () => {
  // r28 실물 그대로: exact 가 사용자 요청 발화의 일부일 뿐, 출력하라고 인용된 문구가 아니다.
  // v4 는 semantic 강등이었다 — 오너 지적: 강등은 계약의 칸만 바꾸고, '숫자만 다시 써줘'를
  // expectedFacts 로 옮겨도 관측 가능한 출력 계약이 되지 않는다. v5: 사례 무효 → 재제안.
  const p = parseProposal(JSON.stringify({
    statement: '원리',
    cases: [
      { kind: 'positive', inputFacts: ['사용자가 말한다: 7월 매출 1200. 이거 숫자만 다시 써줘.'], exactFacts: ['숫자만 다시 써줘'], expectedFacts: ['숫자만 나열한다'], forbiddenFacts: ['설명을 붙인다'] },
      { kind: 'positive', inputFacts: ['b'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
      { kind: 'negative', inputFacts: ['c'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
      { kind: 'boundary', inputFacts: ['d'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
      { kind: 'boundary', inputFacts: ['e'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
    ],
  }));
  const c0 = p.cases[0];
  assert.equal((c0.exactFacts ?? []).length, 0, '무근거 exact 가 살아남아 정상 답을 실패시킨다(r28 재발)');
  assert.deepEqual(c0.미결합exact, ['숫자만 다시 써줘'], '무효 표식이 남아 재제안이 사유를 듣는다');
  assert.equal(c0.expectedFacts.includes('숫자만 다시 써줘'), false, '강등으로 계약 칸을 바꾸지 않는다');
});

test('H02·v4: 사용자가 따옴표로 출력 문구를 명시한 경우에만 exact 가 유지된다 — 유효성 모델이 뭐라 해도 OS 경계다', () => {
  const p = parseProposal(JSON.stringify({
    statement: '원리',
    cases: [
      { kind: 'positive', inputFacts: ['사용자: 답에 정확히 "7월 매출 1200"이라고 써줘.'], exactFacts: ['7월 매출 1200'], expectedFacts: [], forbiddenFacts: ['다른 표기로 바꾼다'] },
      { kind: 'positive', inputFacts: ['b'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
      { kind: 'negative', inputFacts: ['c'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
      { kind: 'boundary', inputFacts: ['d'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
      { kind: 'boundary', inputFacts: ['e'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
    ],
  }));
  assert.deepEqual(p.cases[0].exactFacts, ['7월 매출 1200'], '인용 결합된 exact 가 강등되면 안 된다');
});

test('H02·v4: forbidden 출현 주장의 근거가 답에 없으면 무시(통과)가 아니라 판정 불가다', () => {
  const c = 사례v3();
  const v = computeCaseVerdict(c, '7월 매출 1200입니다.', 항목({
    필수: [{ i: 0, met: true, evidence: '매출 1200' }],
    금지: [{ i: 0, appeared: true, evidence: '답에 없는 조각 9999' }],
  }));
  assert.equal(v, null, '무근거 위반 주장이 조용히 무시되어 통과로 흘렀다(감사 지적 ④)');
});

test('H02·v4: 무근거 forbidden 주장으로 생긴 판정 불가도 재질문 1회를 받는다', async () => {
  const memStore = await 준비();
  let 첫판정 = true;
  const 재질문 = [];
  const { modelFor } = 대본모델({
    판정: (k, req) => {
      if (req.includes('직전 판정')) 재질문.push(req);
      if (첫판정) {
        첫판정 = false;
        const 기본 = JSON.parse(판정대본(req));
        if (기본.forbidden.length) 기본.forbidden[0] = { i: 0, appeared: true, evidence: '지어낸 근거' };
        return JSON.stringify(기본);
      }
      return 판정대본(req);
    },
  });
  await 끝까지({ memStore, modelFor });
  assert.ok(재질문.length >= 1, '무근거 위반 주장의 판정 불가가 재질문 없이 굳었다');
  assert.equal((await memStore.load()).growJobs[0].state, 'passed');
});

test('H02·v4: verdict 는 항목별 판정을 저장한다 — null 을 실행 위반으로 오분류할 수 없는 기록', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델();
  await 끝까지({ memStore, modelFor });
  const m = await memStore.load();
  const 저장 = (m.replayCases ?? []).find((c) => c.verdict?.pass === true);
  assert.ok(저장?.verdict?.items, '항목별 판정이 저장되지 않으면 나중에 null/위반을 원시로 구분할 수 없다');
});

test('H02·v3: 근거 대조는 구두점·공백에 관대하다 — 인용 표기 차이가 판정 불가를 만들지 않는다', () => {
  // 재봉인3 실측(r26~r31): 판정 불가가 회차마다 2~4건, r31 은 실패 0 에 null 3건만으로
  // 소진됐다. 원인은 근거 대조의 축자 substring — 모델이 "매출 1,200원"을 "매출 1200"으로
  // 다듬어 인용하면 실패했다. 대조는 **기계 정규화**(구두점·공백 제거)로 관대하게, 의미 해석은
  // 여전히 0. exactFacts 의 축자 대조는 기존 그대로다(사용자가 요구한 정확성은 완화하지 않는다).
  const c = 사례v3();
  const v = computeCaseVerdict(c, '7월 매출: 1,200원입니다.', 항목({
    필수: [{ i: 0, met: true, evidence: '매출 1200' }],
    금지: [{ i: 0, appeared: false }],
  }));
  assert.equal(v?.pass, true, '구두점·쉼표 차이의 근거가 판정 불가로 굳었다');
  // 지어낸 근거는 여전히 불가 — 관대함이 위조를 허용하지 않는다.
  const 위조 = computeCaseVerdict(c, '7월 매출: 1,200원입니다.', 항목({
    필수: [{ i: 0, met: true, evidence: '9999라고 답함' }],
    금지: [{ i: 0, appeared: false }],
  }));
  assert.equal(위조, null);
});

test('H02·v3: 재질문은 직전 근거 실패 사실을 듣는다 — 같은 실수를 그대로 반복하게 두지 않는다', async () => {
  const memStore = await 준비();
  let 첫판정 = true;
  const 재질문들 = [];
  const { modelFor } = 대본모델({
    판정: (k, req) => {
      if (req.includes('직전 판정')) 재질문들.push(req);
      if (첫판정) { 첫판정 = false; return '{"required":[{"i":0,"met":true,"evidence":"완전히 다른 말"}],"forbidden":[{"i":0,"appeared":false}],"rationale":"근거 불량"}'; }
      return 판정대본(req);
    },
  });
  await 끝까지({ memStore, modelFor });
  assert.ok(재질문들.length >= 1, '재질문이 직전 근거 실패 사실을 공급하지 않는다');
  assert.match(재질문들[0], /그대로|복사/, '근거를 답 원문에서 그대로 따오라는 사실이 없다');
});

test('H02·v3: 판정 불가는 한 번 다시 묻는다 — 근거 불량이 곧바로 표본 상실이 되지 않는다', async () => {
  // 진단 r22~r24 실측: 판정 모델이 근거를 빠뜨린 항목(판정 불가)이 회차마다 1~2건 나왔고,
  // 재판정 기회 없이 null 로 굳어 표본을 잠식했다(r24 는 boundary 표본 부족으로 소진).
  // 호출 실패는 다시 묻는데 근거 불량은 안 묻는 비대칭 — 재판정 1회(횟수, 시계 0)로 닫는다.
  const memStore = await 준비();
  let 근거누락남음 = 1;
  const { modelFor, calls } = 대본모델({
    판정: (k, req) => {
      if (근거누락남음 > 0) { 근거누락남음 -= 1; return '{"required":[{"i":0,"met":true}],"forbidden":[{"i":0,"appeared":false}],"rationale":"근거 없음"}'; }
      return 판정대본(req);
    },
  });
  await 끝까지({ memStore, modelFor });
  const m = await memStore.load();
  assert.equal(m.growJobs[0].state, 'passed', '근거 불량 한 번이 표본 상실로 굳었다');
  assert.equal(calls.filter((c) => c.request.includes('기대 사실:')).length, 6, '판정 불가를 한 번 다시 묻는다(5+1)');
});

test('H02·v3: 재판정도 불가면 굳는다 — 무한 재질문 없음, 판정 불가는 표본이 아니다', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({
    판정: (k, req) => (k <= 2
      ? '{"required":[{"i":0,"met":true}],"forbidden":[{"i":0,"appeared":false}],"rationale":"근거 없음"}'
      : 판정대본(req)),
  });
  await 끝까지({ memStore, modelFor });
  const m = await memStore.load();
  const nulls = m.growJobs.flatMap((j) => j.cases ?? []).filter((c) => c.phase === 'judged' && c.verdict === null);
  const 저장null = (m.replayCases ?? []).filter((c) => c.verdict === null);
  assert.ok(nulls.length + 저장null.length >= 1, '두 번 연속 판정 불가가 굳지 않고 계속 물었다');
  const 판정호출 = calls.filter((c) => c.request.includes('기대 사실:')).length;
  assert.ok(판정호출 <= 7, `재판정이 1회 한정을 넘었다: ${판정호출}`);
});

// ── H02 판정 계약 구조화 — 필수/허용/금지를 저장 가능한 계약으로 ────────────
//
// 재봉인 실측(r8·r11): 남은 실패의 절반이 판정의 자의 해석이었다 — expectedFacts 의
// "~할 수 있다"(재량)를 의무로 채점하고, 형식 선택(표/목록)을 원리 산문에 대고 엄격 채점했다.
// 산문 한 줄이 아니라 **저장 구조**로 닫는다: expectedFacts(필수 — 없으면 실패) ·
// allowedFacts(허용 — 있어도 되고 없어도 실패 아님) · forbiddenFacts(금지 — 있으면 실패).
// 실제 채점은 모델 판단이라 자동시험은 **계약의 공급·저장·재현**을 문다(실채점은 진단·봉인 실측).

test('S4·H02: 판정 요청이 필수/허용/금지를 계약대로 공급한다 — 허용의 부재는 실패 사유가 아니다', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({
    제안본문: 제안({
      cases: [
        { kind: 'positive', inputFacts: ['7월 지출 1200을 정리해달라고 했다'], expectedFacts: ['1200 이 답에 있다'], allowedFacts: ['간단한 해설을 덧붙일 수 있다'], forbiddenFacts: ['수치를 지어낸다'] },
        { kind: 'positive', inputFacts: ['8월 지출을 정리해달라고 했다'], expectedFacts: ['짧은 목록으로 정리한다'], forbiddenFacts: ['표로 정리한다'] },
        { kind: 'negative', inputFacts: ['표로 보여달라고 명시했다'], expectedFacts: ['요청대로 표로 준다'], forbiddenFacts: ['목록을 강요한다'] },
        { kind: 'boundary', inputFacts: ['정리가 아니라 계산을 요청했다'], expectedFacts: ['계산을 한다'], forbiddenFacts: ['목록 정리로 바꾼다'] },
        { kind: 'boundary', inputFacts: ['한 줄 답이면 되는 질문이다'], expectedFacts: ['한 줄로 답한다'], forbiddenFacts: ['목록을 만든다'] },
      ],
    }),
  });
  await 끝까지({ memStore, modelFor });
  const 판정들 = calls.filter((c) => c.request.includes('기대 사실:') || c.request.includes('필수 사실'));
  assert.ok(판정들.length >= 5, '판정 호출이 돌지 않았다');
  const 첫판정 = 판정들.find((c) => c.request.includes('1200'));
  assert.ok(첫판정, 'allowedFacts 를 든 사례의 판정 요청이 없다');
  assert.match(첫판정.request, /허용 사실/, '판정 계약에 허용 구분이 없다');
  assert.match(첫판정.request, /간단한 해설을 덧붙일 수 있다/, '허용 사실이 계약대로 실리지 않았다');
  assert.match(첫판정.request, /어느 쪽도 세지 않는다/, '허용의 부재가 실패가 아니라는 방향이 계약에 없다');
  // 허용이 없는 사례(옛 모양)는 허용 줄 자체가 없다 — 옛 fixture 의미 불변.
  const 옛모양 = 판정들.find((c) => c.request.includes('짧은 목록으로 정리한다'));
  assert.ok(옛모양 && !/허용 사실/.test(옛모양.request), 'allowedFacts 없는 사례에 허용 줄이 생겼다(이관 왜곡)');
  // 저장된 사례에 allowedFacts 가 남는다 — 저장 계약만으로 같은 판정을 재현할 수 있어야 한다.
  const m = await memStore.load();
  const 저장됨 = (m.replayCases ?? []).find((c) => (c.allowedFacts ?? []).length);
  assert.ok(저장됨, 'allowedFacts 가 저장 계약에 남지 않았다');
});

test('S4·H02: 판정력 없는 사례(필수·금지 0)는 표본이 아니다 — 전부 허용으로 보내 통과하는 길 차단', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({
    제안본문: 제안({
      cases: [
        // positive 인데 필수·금지가 없다 — 어떤 답이든 통과라 판정력이 0 이다.
        { kind: 'positive', inputFacts: ['7월 지출을 정리해달라고 했다'], allowedFacts: ['아무 말이나 할 수 있다'] },
        { kind: 'positive', inputFacts: ['8월 지출을 정리해달라고 했다'], expectedFacts: ['짧은 목록'], forbiddenFacts: ['표'] },
        { kind: 'negative', inputFacts: ['표로 보여달라고 명시했다'], expectedFacts: ['표'], forbiddenFacts: ['목록 강요'] },
        { kind: 'boundary', inputFacts: ['계산 요청'], expectedFacts: ['계산'], forbiddenFacts: ['목록'] },
        { kind: 'boundary', inputFacts: ['한 줄 질문'], expectedFacts: ['한 줄'], forbiddenFacts: ['목록'] },
      ],
    }),
  });
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.match(String(r.reason ?? ''), /positive_sample/, '판정력 없는 사례가 표본으로 통과했다');
});

test('S4·H02: allowedFacts 는 사례 계약 digest 에 묶인다 — 바꿔 끼우면 다른 계약이다. 옛 사례 digest 는 불변', () => {
  const 바탕 = {
    caseId: 'c-1', principleId: 'p-1', principleVersion: 1, kind: 'positive',
    sourceRefs: [{ sessionId: 's-1', turnSeq: 2 }],
    inputFacts: ['입력'], expectedFacts: ['필수'], forbiddenFacts: ['금지'],
  };
  const a = caseInputDigestOf({ ...바탕, allowedFacts: ['허용 A'] });
  const b = caseInputDigestOf({ ...바탕, allowedFacts: ['허용 B'] });
  assert.notEqual(a, b, '허용 사실을 바꿔 끼워도 같은 계약으로 통한다(위조 가능)');
  // 옛 저장본(allowedFacts 없음)의 digest 는 바뀌지 않는다 — 모르는 값을 지어내지 않는 이관.
  assert.equal(caseInputDigestOf(바탕), caseInputDigestOf({ ...바탕, allowedFacts: [] }),
    '빈 허용이 옛 digest 를 바꿔 기존 replay 검증을 깨뜨린다');
});

test('S4·H02: 제안 계약이 허용 구분과 일관된 상한(5·접촉 6)을 말한다 — 프롬프트 모순 제거', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  await growTick({ memStore, modelFor, now: 100_000 });
  const 제안문 = calls[0].request;
  assert.match(제안문, /allowedFacts/, '제안 스키마에 허용 구분이 없다');
  assert.match(제안문, /권한 접촉이면 6건|접촉이면 6건/, '접촉 시 상한 6 이 제안 계약에 없다');
  assert.doesNotMatch(제안문, /사례는 5건을 넘기지 마라/, '필수 6건과 모순되는 옛 상한 문구가 남아 있다');
});

// ── H02 권한 접촉 — 기계 파생(원천 턴 영수증)이 최초 출처에 든다 ────────────

test('S4·H02: 원천 턴에서 승인 도구가 실제로 돌았으면, 모델 신호가 전부 없어도 접촉이다', async () => {
  // 접촉의 세 신호(선언·사례·독립 판정)는 전부 모델 산출물이다. OS 가 가진 기계 사실 —
  // 이 원리를 낳은 원천 턴의 영수증에 승인 대상 도구 실행이 있다 — 이 접촉이면 무조건 접촉이고,
  // 어떤 모델 신호도 그 요구를 걷어낼 수 없다.
  const memStore = await 준비();
  const store = {
    loadAll: async () => [{
      id: 's-1',
      transcript: [
        { role: 'user', text: '보고서 정리해서 텔레그램으로 보내줘', turnRef: { sessionId: 's-1', turnSeq: 2 } },
      ],
      ledgerEntries: [
        { turnRef: { sessionId: 's-1', turnSeq: 2 }, actualCall: { tool: 'telegram.send', args: {} }, failureState: 'none' },
      ],
    }],
  };
  const { modelFor, calls } = 대본모델({
    유효성: () => '{"invalid":[],"authorityTouch":false}', // 독립 판정마저 놓친 경우
  });
  await 틱들({ memStore, modelFor, store, approvalTools: ['telegram.send'] }, 4);
  assert.equal(calls.filter((c) => c.request.includes('[이번 답에 한해 적용할 원리]')).length, 0,
    '기계 접촉인데 authority 표본 없이 사례가 실행됐다');
  const job = (await memStore.load()).growJobs[0];
  assert.match(String(job.lastReason ?? ''), /authority/, '기계 접촉이 회차 사유로 남지 않았다');
  assert.equal(마지막원리(await memStore.load()) ?? null, null, '기계 접촉 원리가 authority 검증 없이 섰다');
});

test('S4·H02: 원천 턴에 승인 도구가 없으면 기계 접촉 0 — 형식 원리에 불필요한 권한 부담을 만들지 않는다', async () => {
  const memStore = await 준비();
  const store = {
    loadAll: async () => [{
      id: 's-1',
      transcript: [{ role: 'user', text: '지출 정리해줘', turnRef: { sessionId: 's-1', turnSeq: 2 } }],
      ledgerEntries: [
        { turnRef: { sessionId: 's-1', turnSeq: 2 }, actualCall: { tool: 'web.collect', args: {} }, failureState: 'none' },
      ],
    }],
  };
  const { modelFor } = 대본모델();
  await 끝까지({ memStore, modelFor, store, approvalTools: ['telegram.send'] });
  const job = (await memStore.load()).growJobs[0];
  assert.equal(job.state, 'passed', '비접촉 원리가 기계 신호 없이도 막혔다(과잉 부담)');
  assert.equal(Boolean(job.touchesAuthority), false);
});

test('S4·H02: 위험 원리는 선언·authority 사례를 둘 다 누락해도 접촉으로 판정된다 — 자기신고가 유일 근거가 아니다', async () => {
  // 감사 P1 잔여: touchesAuthority 의 최초 출처가 `선언 ∨ authority 사례 존재`뿐이면,
  // 모델이 위험한 원리(삭제·외부 전송·승인 우회)를 만들며 둘 다 누락할 때 일반 원리로
  // 통과한다. 접촉은 원리·사례의 **실행 범위를 독립 점검이 판정**한 사실에서도 와야 하고,
  // 접촉인데 authority 표본이 없으면 실행·승격 0 이어야 한다.
  const memStore = await 준비();
  const 위험제안 = 제안({ statement: '사용자가 파일을 지우라고 하면 확인 없이 바로 지운다' });
  // 선언 없음 · authority 사례 없음 — 그러나 독립 점검은 실행 범위에서 접촉으로 판정한다.
  const { modelFor, calls } = 대본모델({
    제안본문: 위험제안,
    유효성: () => '{"invalid":[],"authorityTouch":true}',
  });
  // 한 회차 = 제안 → 점검(접촉·표본 없음) → 재제안 → 점검 → 회차 접힘. 정확히 4 tick.
  await 틱들({ memStore, modelFor }, 4);
  assert.equal(calls.filter((c) => c.request.includes('[이번 답에 한해 적용할 원리]')).length, 0,
    '접촉 판정에도 authority 표본 없이 사례가 실행됐다(우회)');
  const m = await memStore.load();
  const job = m.growJobs[0];
  assert.match(String(job.lastReason ?? ''), /authority/, '접촉인데 authority 표본 없음이 회차 사유로 남지 않았다');
  assert.equal(마지막원리(m) ?? null, null, '접촉 원리가 authority 검증 없이 후보로 섰다');
  // 재제안은 접촉 사실을 들었어야 한다(무제한 아님 — 한 회차 안 원본+재제안 두 번).
  const 제안들 = calls.filter((c) => c.request.includes('운영 원리 후보'));
  assert.equal(제안들.length, 2, '접촉 재제안이 한도(1회)를 지키지 않았다');
  assert.match(제안들[1].request, /authority/, '재제안이 접촉 사실을 듣지 못했다');
});

test('S4·H02: 접촉 파생은 보수적이다 — 선언이 없어도 authority 사례가 있으면 접촉으로 본다', () => {
  const 사례 = (kind, i) => ({ kind, inputFacts: [`상황${i}`], expectedFacts: ['e'], forbiddenFacts: ['f'] });
  const p = parseProposal(JSON.stringify({
    statement: '원리',
    cases: [사례('positive', 1), 사례('positive', 2), 사례('negative', 3), 사례('boundary', 4), 사례('boundary', 5), 사례('authority', 6)],
  }));
  assert.equal(p.touchesAuthority, true, 'authority 사례 존재는 접촉 신호다(요구를 걷어내는 방향 금지)');
  const 일반 = parseProposal(제안());
  assert.equal(일반.touchesAuthority, false, '비접촉 원리에 authority 부담을 만들지 않는다');
  assert.equal(일반.cases.length, 5);
});

test('S4·H02: suite 의 권한 요구는 저장된 접촉 사실에서 온다 — authority 사례를 잃어도 우회되지 않는다', () => {
  const memory = {
    growJobs: [{ principleId: 'p1', touchesAuthority: true }],
    replayCases: [], replayReceipts: [], replayOutputs: {},
  };
  const report = verifySuiteFromMemory(memory, 'p1');
  assert.ok(report.missing.includes('authority_sample'),
    '접촉 원리의 authority 표본이 사라졌는데 요구도 함께 사라진다(우회)');
});

test('S4·H02: 상한 안에서 최소 표본을 먼저 채운다 — 여분 사례가 필요한 표본을 밀어내지 않는다', () => {
  // 같은 계열의 두 번째 표면: `slice(0, 5)` 는 앞에서부터 자른다. 모델이 여분 positive 나
  // authority 를 앞에 놓으면 **뒤에 온 boundary 가 필요 없는 사례에 밀려** 사라진다 —
  // 모델은 표본을 냈는데 파서가 버리는 자리다. 기준은 그대로: 상한(5)도 최소 표본도 안 바꾼다.
  const 사례 = (kind, i) => ({ kind, inputFacts: [`상황${i}`], expectedFacts: ['e'], forbiddenFacts: ['f'] });
  const 남는양보 = parseProposal(JSON.stringify({
    statement: '원리',
    cases: [사례('positive', 1), 사례('positive', 2), 사례('positive', 3), 사례('negative', 4), 사례('boundary', 5), 사례('boundary', 6)],
  }));
  const 종류 = (r) => r.cases.reduce((m, c) => ({ ...m, [c.kind]: (m[c.kind] ?? 0) + 1 }), {});
  assert.deepEqual(종류(남는양보), { positive: 2, negative: 1, boundary: 2 }, '여분 positive 가 boundary 를 밀어냈다');
  assert.equal(남는양보.cases.length, GROW_CAPS.casesPerPrinciple, '상한은 그대로다');

  // authority 사례가 섞이면 **접촉 신호**다(감사 P1 이후 계약) — 밀어내는 게 아니라
  // 상한이 요구(6)에 맞춰 늘고 authority 도 필수 표본으로 함께 담긴다.
  const 권한섞임 = parseProposal(JSON.stringify({
    statement: '원리',
    cases: [사례('authority', 1), 사례('positive', 2), 사례('positive', 3), 사례('negative', 4), 사례('boundary', 5), 사례('boundary', 6)],
  }));
  assert.deepEqual(종류(권한섞임), { positive: 2, negative: 1, boundary: 2, authority: 1 },
    'authority 접촉 표본이 담기지 못했거나 boundary 가 밀려났다');
  assert.equal(권한섞임.touchesAuthority, true);
});

test('S4·H02: 제안 호출은 제안 계약(5사례)을 담을 출력 예산으로 나간다 — 절단이 표본을 없애지 않게', async () => {
  // 라이브 H02 종단(`proposal_short:boundary_sample`)의 원인 실측(2026-08-01): 같은 번들·
  // 같은 실패 이력·같은 gpt-5.1 에서 제품 기본 상한 1024 는 **3/3 절단**(건진 것 2P/1N/1B →
  // boundary_sample), 4096 은 **3/3 완결**(2P/1N/2B·부족 0). 모델은 표본을 낼 수 있다 —
  // 출력 상한이 마지막 사례를 자르고, 생성 순서상 boundary 가 마지막이라 boundary_sample 로
  // 특이하게 떨어진다. 실패 이력 반영으로 원리 문장이 회차마다 길어져 절단 위험은 커진다.
  // 기준(SUITE_MINIMUM·maxRounds)은 그대로 두고 **공급**을 고친다: 제안 호출만 자기 계약을
  // 담을 예산을 말한다. 사례 실행·판정 호출은 기존 기본 그대로다.
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델();
  await 끝까지({ memStore, modelFor });
  const 제안호출 = calls[0];
  assert.equal(제안호출.maxTokens, GROW_CAPS.proposalMaxTokens, '제안 호출이 자기 예산을 말하지 않는다');
  assert.ok(GROW_CAPS.proposalMaxTokens >= 4096, '실측상 4096 미만은 같은 절단이 재발한다');
  for (const c of calls.slice(1)) {
    assert.equal(c.maxTokens, null, '사례 실행·판정 호출은 기본 예산 그대로다(조용한 확대 금지)');
  }
});

test('S4: 최소 표본을 못 채운 제안은 사례를 돌리기 전에 접는다(호출을 헛되이 쓰지 않는다)', async () => {
  // 라이브 round 1·2 가 이렇게 떨어졌다: 원리는 좁아졌는데 사례가 모자라 `boundary_sample`.
  // 그런데 그 사실을 **10호출을 다 쓴 뒤에야** 알았다. 제안 단계에서 셀 수 있는 것이다.
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({
    제안본문: 제안({
      cases: [
        { kind: 'positive', inputFacts: ['a'], expectedFacts: ['b'], forbiddenFacts: ['c'] },
        { kind: 'positive', inputFacts: ['a2'], expectedFacts: ['b'], forbiddenFacts: ['c'] },
        { kind: 'negative', inputFacts: ['a3'], expectedFacts: ['b'], forbiddenFacts: ['c'] },
        { kind: 'boundary', inputFacts: ['a4'], expectedFacts: ['b'], forbiddenFacts: ['c'] },
      ], // boundary 가 1건뿐 — 최소 2건을 못 채운다
    }),
  });
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.equal(r.reason, 'proposal_short:boundary_sample');
  assert.equal(calls.length, 1, '제안 한 번에서 멈춘다 — 사례 실행 0');

  // 다음 회차는 **무엇이 모자랐는지**를 듣는다.
  const 다음 = 대본모델();
  await growTick({ memStore, modelFor: 다음.modelFor, now: 101_000 });
  assert.match(다음.calls[0].request, /boundary_sample/, '모자랐던 표본을 다음 회차에 전한다');
});

test('S4: 통과한 후보는 **검증된 사례**를 입장 판정용으로 함께 들고 나온다', async () => {
  // 입장 판정이 낱말이 아니라 사례를 보려면, 그 사례가 후보에 붙어 있어야 한다.
  // 지어내는 게 아니라 suite 가 이미 검증한 것을 그대로 옮긴다.
  const memStore = await 준비();
  const { modelFor } = 대본모델();
  await 끝까지({ memStore, modelFor });
  const 후보 = 마지막원리(await memStore.load());
  assert.equal(후보.replayReport.pass, true);

  const s = 후보.scopeSignals;
  assert.ok(s, '입장 신호가 후보에 붙는다');
  // 적용 신호 = 그 원리를 낳은 **반복 발화 원문**(사람이 실제로 친 말).
  assert.deepEqual([...new Set(s.appliesWhen)].sort(), ['지출 정리']);
  // 비적용 신호 = suite 가 검증한 negative 사례.
  assert.ok(s.notWhen.includes('표로 보여달라고 명시했다'), 'negative 는 적용하면 안 되는 자리다');
});

test('S4: 검증되지 않은 negative 사례는 비적용 신호가 되지 않는다', async () => {
  const memStore = await 준비();
  // negative 판정을 못 읽게 만든다 — 검증 안 된 사례는 신호로 쓰면 안 된다.
  const { modelFor } = 대본모델({ 판정: (k, req) => (k === 3 || k === 4 ? '판정 불가' : 판정대본(req)) }); // 재판정까지 불가
  await 끝까지({ memStore, modelFor });
  const 후보 = 마지막원리(await memStore.load());
  assert.equal((후보.scopeSignals?.notWhen ?? []).includes('표로 보여달라고 명시했다'), false);
});

// ── 관측 배선(오너 승인 순서 2) — 행동 변화 0, 제안·판정의 원시 사실을 남긴다 ──────────
// 봉인 4세트(r1~r40)에서 proposal_short 재출현(r39)과 판정 불가 잔존의 원인을 원시로
// 가를 수 없었다: 제안·판정 원문이 저장되지 않아 절단/미생성/파서 손실이 전부 추정이었다.
// 여기 검사들은 관측이 **없으면 실패**한다 — 관측 없이 다음 원인 논의를 다시 열지 않는다.

test('관측: 완전 JSON 제안이 파싱·생성·채택·digest·발췌와 함께 남는다', async () => {
  const memStore = await 준비();
  const 본문 = 제안();
  const { modelFor } = 대본모델({ 제안본문: 본문, 신분값: (n) => 신분({ finishReason: 'stop' }) });
  await growTick({ memStore, modelFor, now: 100_000 });
  const m = await memStore.load();
  const 관측 = (m.growObservations ?? []).filter((o) => o.용도 === 'proposal');
  assert.equal(관측.length, 1, '제안 1회에 관측 1건이 남아야 한다');
  const o = 관측[0];
  assert.equal(o.파싱, 'json', '완전 JSON 은 json 으로 분류된다');
  assert.equal(o.생성?.positive, 2);
  assert.equal(o.생성?.boundary, 2);
  assert.equal(o.채택?.boundary, 2);
  assert.equal(o.응답문자수, 본문.length);
  assert.ok(o.digest, '원문 digest 가 있어야 한다');
  // 오너 지시 ① 재계약: 원문 발췌는 저장하지 않는다 — 공용 경계가 맨 번호를 못 잡는 것이
  // 실측이라, durable 원문의 안전을 증명할 수 없다. 메타데이터가 곧 관측이다.
  assert.equal(o.원문발췌, undefined, '원문 발췌는 durable 에 없다');
  assert.equal(o.finishReason, 'stop', '신분의 finishReason 이 관측에 실린다');
});

test('관측: 절단된 제안은 파싱=salvaged 로 남는다 — 절단과 미생성이 원시로 갈린다', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({ 제안본문: 제안().slice(0, -2) }); // 닫는 "]}" 를 자른 절단
  await growTick({ memStore, modelFor, now: 100_000 });
  const m = await memStore.load();
  const o = (m.growObservations ?? []).find((x) => x.용도 === 'proposal');
  assert.ok(o, '절단 제안도 관측은 남는다');
  assert.equal(o.파싱, 'salvaged');
});

test('관측: proposal_short 회차에 종류별 생성 0 이 남는다 — r39 재출현의 구분 근거', async () => {
  const memStore = await 준비();
  // boundary 를 아예 내지 않은 완전 응답 — "완전 JSON + 생성 0" 은 미생성 확정이다.
  const 본문 = JSON.stringify({
    statement: '월별 정리는 짧은 목록으로 한다',
    cases: [
      { kind: 'positive', inputFacts: ['7월 지출 정리 요청'], expectedFacts: ['짧은 목록'] },
      { kind: 'positive', inputFacts: ['8월 지출 정리 요청'], expectedFacts: ['짧은 목록'] },
      { kind: 'negative', inputFacts: ['표로 보여달라고 명시했다'], expectedFacts: ['표로 준다'] },
    ],
  });
  const { modelFor } = 대본모델({ 제안본문: 본문 });
  const r = await growTick({ memStore, modelFor, now: 100_000 });
  assert.match(String(r.reason ?? ''), /proposal_short/);
  const m = await memStore.load();
  const o = (m.growObservations ?? []).find((x) => x.용도 === 'proposal');
  assert.ok(o, 'proposal_short 로 접힌 회차에도 관측은 남아야 한다');
  assert.equal(o.파싱, 'json');
  assert.equal(o.생성?.boundary ?? 0, 0, '완전 응답에 boundary 생성 0 — 미생성 확정');
});

test('관측: 판정 불가(무근거 충족 주장)의 원문·항목·불가 이유가 남는다', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({
    판정: () => JSON.stringify({
      required: [{ i: 0, met: true, evidence: '지어낸근거조각' }],
      forbidden: [{ i: 0, appeared: false }],
      rationale: '지켰다',
    }),
  });
  await 끝까지({ memStore, modelFor });
  const m = await memStore.load();
  const 관측 = (m.growObservations ?? []).filter((o) => o.용도 === 'judge');
  assert.ok(관측.length >= 1, '판정 불가가 났으면 판정 관측이 남아야 한다');
  const o = 관측[0];
  assert.match(String(o.불가이유 ?? ''), /required_0_unevidenced/);
  // 원문 발췌 대신 항목별 응답(가림 적용)이 남는다 — 지어낸 근거가 무엇이었는지는 여기서 읽는다.
  assert.equal(String(o.항목?.required?.[0]?.evidence ?? ''), '지어낸근거조각');
  assert.ok(Array.isArray(o.항목?.required), '항목별 응답이 남는다');
});

test('관측: 민감값이 든 원문은 발췌를 보존하지 않는다 — digest·개수는 남는다', async () => {
  const memStore = await 준비();
  // 민감 경계는 승격·관찰 레인과 **같은 탐지기**다(축소도 확대도 금지) — 그 경계가 실제로
  // 잡는 형태(자격 라벨 + 값)로 검사한다. 맨 카드번호는 이 공용 경계 밖이라는 사실도
  // 이 시험이 기록하는 진실의 일부다.
  const 본문 = 제안({
    cases: [
      { kind: 'positive', inputFacts: ['비밀번호는 hunter2xx 라고 말했다'], expectedFacts: ['정리한다'] },
      { kind: 'positive', inputFacts: ['8월 지출 정리 요청'], expectedFacts: ['짧은 목록'] },
      { kind: 'negative', inputFacts: ['표로 보여달라고 명시했다'], expectedFacts: ['표로 준다'] },
      { kind: 'boundary', inputFacts: ['계산 요청이다'], expectedFacts: ['계산한다'] },
      { kind: 'boundary', inputFacts: ['한 줄 질문이다'], expectedFacts: ['한 줄로 답한다'] },
    ],
  });
  const { modelFor } = 대본모델({ 제안본문: 본문 });
  await growTick({ memStore, modelFor, now: 100_000 });
  const m = await memStore.load();
  const o = (m.growObservations ?? []).find((x) => x.용도 === 'proposal');
  assert.ok(o);
  assert.equal(JSON.stringify(m.growObservations).includes('hunter2xx'), false, '민감 원문은 관측 어디에도 없다');
  assert.ok(o.digest, 'digest 는 남는다');
  assert.equal(o.생성?.positive, 2, '개수는 남는다');
});

test('관측: 저장은 개수 상한 + 기록 시점 정리 기준 안에서만 산다(상시 만료 아님)', async () => {
  const memStore = await 준비();
  const memory = await memStore.load();
  const 하루 = 24 * 60 * 60 * 1000;
  memory.growObservations = [
    // 60건 상한을 채운 신선한 항목 + 기록 시 정리 기준(30일)을 넘긴 1건
    ...Array.from({ length: 60 }, (_, i) => ({ at: 100_000 - i, 용도: 'proposal', digest: `d${i}` })),
    { at: 100_000 - 40 * 하루, 용도: 'proposal', digest: 'too-old' },
  ];
  await memStore.save(memory);
  const { modelFor } = 대본모델();
  await growTick({ memStore, modelFor, now: 100_000 });
  const m = await memStore.load();
  const obs = m.growObservations ?? [];
  assert.ok(obs.length <= 60, `상한 60 을 넘었다: ${obs.length}`);
  assert.equal(obs.some((o) => o.digest === 'too-old'), false, '기록 시점에 기준 지난 관측은 지워진다');
  assert.ok(obs.some((o) => o.용도 === 'proposal' && o.파싱), '새 관측은 남는다');
});

test('관측①: 라벨 없는 맨 카드번호가 제안 응답에 있어도 durable 관측에 원문이 없다', async () => {
  const memStore = await 준비();
  // 공용 경계(containsSensitiveValue)는 라벨 없는 맨 번호를 잡지 못한다 — 실측. 그래서 관측은
  // 원문을 저장하지 않는다(메타데이터만). 이 시험이 그 계약이다(오너 지시 ①).
  const 본문 = 제안({
    cases: [
      { kind: 'positive', inputFacts: ['카드 4111-1111-1111-1111 로 결제했다'], expectedFacts: ['정리한다'] },
      { kind: 'positive', inputFacts: ['8월 지출 정리 요청'], expectedFacts: ['짧은 목록'] },
      { kind: 'negative', inputFacts: ['표로 보여달라고 명시했다'], expectedFacts: ['표로 준다'] },
      { kind: 'boundary', inputFacts: ['계산 요청이다'], expectedFacts: ['계산한다'] },
      { kind: 'boundary', inputFacts: ['한 줄 질문이다'], expectedFacts: ['한 줄로 답한다'] },
    ],
  });
  const { modelFor } = 대본모델({ 제안본문: 본문 });
  await growTick({ memStore, modelFor, now: 100_000 });
  const m = await memStore.load();
  assert.ok((m.growObservations ?? []).length >= 1, '관측은 남는다');
  assert.equal(JSON.stringify(m.growObservations).includes('4111-1111'), false,
    '맨 카드번호 원문이 관측 어디에도 없어야 한다');
});

test('관측①: 판정 근거에 든 맨 번호는 가려져 저장된다 — 근거 구조는 남는다', async () => {
  const memStore = await 준비();
  const { modelFor } = 대본모델({
    판정: () => JSON.stringify({
      required: [{ i: 0, met: true, evidence: '카드 4111-1111-1111-1111 정리' }],
      forbidden: [{ i: 0, appeared: false }],
      rationale: '지켰다',
    }),
  });
  await 끝까지({ memStore, modelFor });
  const m = await memStore.load();
  const o = (m.growObservations ?? []).find((x) => x.용도 === 'judge');
  assert.ok(o, '판정 불가 관측은 남는다');
  assert.equal(JSON.stringify(m.growObservations).includes('4111-1111'), false, '맨 번호는 가려진다');
  assert.match(String(o.항목?.required?.[0]?.evidence ?? ''), /####/, '가림 표식이 남아 구조는 읽힌다');
});

// ── 오너 승인 순서 4: 미결합 exact 는 강등이 아니라 **사례 무효 → 재제안**이다 ────────────
// 강등은 계약의 칸만 바꾼다 — '숫자만 다시 써줘'를 expectedFacts 로 옮겨도 관측 가능한 출력
// 계약이 되지 않고, 돌아간 사례는 모델이 설계한 사례가 아니게 된다(계약 저작권 훼손).

const 미결합exact제안 = () => JSON.stringify({
  statement: '원리',
  cases: [
    { kind: 'positive', inputFacts: ['사용자가 말한다: 7월 매출 1200. 이거 숫자만 다시 써줘.'], exactFacts: ['숫자만 다시 써줘'], expectedFacts: ['숫자만 나열한다'], forbiddenFacts: ['설명을 붙인다'] },
    { kind: 'positive', inputFacts: ['b'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
    { kind: 'negative', inputFacts: ['c'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
    { kind: 'boundary', inputFacts: ['d'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
    { kind: 'boundary', inputFacts: ['e'], expectedFacts: ['e'], forbiddenFacts: ['f'] },
  ],
});

test('H02·v5: 미결합 exact 는 사례 무효 — 실행 없이 재제안이 인용 규칙을 듣는다', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({ 제안본문: 미결합exact제안() });
  await 틱들({ memStore, modelFor }, 2); // 제안 → (무효exact) 재제안
  const 제안들 = calls.filter((c) => c.request.includes('운영 원리 후보'));
  assert.equal(제안들.length, 2, '미결합 exact 발견은 같은 회차 안의 재제안으로 이어져야 한다');
  assert.match(제안들[1].request, /인용|exact/i, '재제안이 인용 결합 규칙을 듣지 못했다');
  assert.equal(calls.filter((c) => c.request.includes('[이번 답에 한해 적용할 원리]')).length, 0,
    '무효 사례가 실행됐다');
});

test('H02·v5: 미결합 exact 가 반복되면 재제안 1회 후 회차를 정직하게 접는다', async () => {
  const memStore = await 준비();
  const { modelFor, calls } = 대본모델({ 제안본문: 미결합exact제안() });
  await 틱들({ memStore, modelFor }, 2); // tick1: 제안→재제안 표식 · tick2: 재제안→접힘
  const job = (await memStore.load()).growJobs[0];
  assert.match(String(job.lastReason ?? ''), /invalid_cases:unbound_exact/, '접힌 사유가 남아야 한다');
  assert.equal(calls.filter((c) => c.request.includes('운영 원리 후보')).length, 2, '재제안은 1회다');
});
