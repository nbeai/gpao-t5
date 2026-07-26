import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectAutomationCandidate, makeGrowthCandidate, approveAutomation,
  isJobRunnable, cancelJob, admitTickTrigger, nextBackoffMs, resolveAfterRun,
} from '../src/kernel/l5-growth/automation.js';
import { tickAutomation } from '../src/runtime/automation-engine.js';
import { AutomationScheduler } from '../src/runtime/automation-scheduler.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { AutomationStore } from '../src/surface/automation-store.js';

const selfState = buildSelfState(demoEnv());
const tools = demoTools();
const localAction = { tool: 'local.file', args: {} };
const sendAction = { tool: 'slack.post', args: {} }; // slack.post: 실행 가능 + needsApproval(외부)

function candidateFor(action, statement = '매주 파일 정리해줘') {
  const c = detectAutomationCandidate(statement, action);
  assert.ok(c, '반복 신호 → 후보');
  return makeGrowthCandidate({ candidateId: 'c1', statement: c.statement, action: c.action });
}

// ── 필수 1) 승인 전 자동화 실행 0 — 후보는 실행이 아니다(승인 전 영향 0). ──
test('승인 전: 후보만 있고 job이 없으면 실행 0', async () => {
  const cand = candidateFor(localAction);
  assert.equal(cand.approved, false, '후보는 승인 안 됨');
  const ran = await tickAutomation([], { tools, selfState, now: 1000 });
  assert.equal(ran.length, 0, '승인 전에는 실행 경로 자체가 없다');
});

// 불변식(목록 아님): isJobRunnable는 scheduled+미만료+도달만 허용. 취소·완료·만료는 절대 실행 금지.
test('불변식: 취소·완료·만료·미도달·만료는 실행 불가', () => {
  const base = { state: 'scheduled', nextRunAt: 0, grantScope: {} };
  assert.equal(isJobRunnable(base, 10), true);
  assert.equal(isJobRunnable({ ...base, state: 'cancelled' }, 10), false);
  assert.equal(isJobRunnable({ ...base, state: 'completed' }, 10), false);
  assert.equal(isJobRunnable({ ...base, state: 'expired' }, 10), false);
  assert.equal(isJobRunnable({ ...base, state: 'paused' }, 10), false);
  assert.equal(isJobRunnable({ ...base, nextRunAt: 100 }, 10), false, '미도달');
  assert.equal(isJobRunnable({ ...base, grantScope: { expiresAt: 5 } }, 10), false, '만료');
});

// ── 필수 2) 승인 후 tick 1회 실행. 재-tick은 실행 안 함(1회 job). ──
test('승인 후: tick에서 정확히 1회 실행', async () => {
  const job = approveAutomation(candidateFor(localAction), { id: 'j1', now: 1000, nextRunAt: 1000 });
  const jobs = [job];
  const ran1 = await tickAutomation(jobs, { tools, selfState, now: 1000 });
  assert.equal(ran1.length, 1, '승인 후 1회 실행');
  assert.equal(job.state, 'completed');
  assert.equal(job.executions.length, 1);
  const ran2 = await tickAutomation(jobs, { tools, selfState, now: 2000 });
  assert.equal(ran2.length, 0, '완료된 job은 다시 실행 안 함');
});

// ── 필수 3) 만료 자동화 미실행 → expired로 정직하게. ──
test('만료: 만료된 자동화는 실행하지 않고 expired로 남는다', async () => {
  const job = approveAutomation(candidateFor(localAction), { id: 'j2', now: 0, nextRunAt: 0, grantScope: { kind: 'session', expiresAt: 500 } });
  const ran = await tickAutomation([job], { tools, selfState, now: 1000 }); // now > expiresAt
  assert.equal(ran.length, 0);
  assert.equal(job.state, 'expired');
  assert.equal(job.executions.length, 0, '만료면 실행 원장도 비어 있다');
});

// ── 필수 4) 취소 자동화 미실행. ──
test('취소: 취소한 자동화는 실행하지 않는다', async () => {
  let job = approveAutomation(candidateFor(localAction), { id: 'j3', now: 0, nextRunAt: 0 });
  job = cancelJob(job);
  assert.equal(job.state, 'cancelled');
  const ran = await tickAutomation([job], { tools, selfState, now: 1000 });
  assert.equal(ran.length, 0);
  assert.equal(job.executions.length, 0);
});

// ── 필수 5) 외부 전송 자동화는 승인 경계(A2)를 유지 — 범위 내만 실행, 만료 후 재승인. ──
test('외부 전송: 승인 범위 내에서만 실행, 만료 후 중단', async () => {
  const cand = candidateFor(sendAction, '매일 슬랙에 정리 올려줘');
  const job = approveAutomation(cand, { id: 'j4', now: 0, nextRunAt: 0, external: true, grantScope: { kind: 'session', expiresAt: 1000 } });
  assert.equal(job.external, true);
  assert.equal(isJobRunnable(job, 500), true);
  const ran = await tickAutomation([job], { tools, selfState, now: 500 });
  assert.equal(ran.length, 1, '승인 범위 내에서는 실행');
  // 만료 후 동일 후보를 새 job으로 검증 — 승인 범위 밖은 실행 안 함(재승인 필요).
  const job2 = approveAutomation(cand, { id: 'j5', now: 0, nextRunAt: 0, external: true, grantScope: { kind: 'session', expiresAt: 1000 } });
  const ran2 = await tickAutomation([job2], { tools, selfState, now: 2000 });
  assert.equal(ran2.length, 0, '만료 후에는 실행 안 함');
  assert.equal(job2.state, 'expired');
});

// ── 필수 6) 실행 결과가 원장(Truth Ledger)에 ToolReceipt로 남는다. ──
test('원장: 실행 결과가 ToolReceipt로 남는다', async () => {
  const job = approveAutomation(candidateFor(localAction), { id: 'j6', now: 0, nextRunAt: 0 });
  await tickAutomation([job], { tools, selfState, now: 100 });
  const rec = job.executions.at(-1);
  assert.ok(rec, '실행 원장에 receipt');
  assert.equal(rec.failureState, 'none');
  assert.ok(rec.intended && rec.actualCall, 'intended·actualCall 기록');
});

// 실패·차단도 정직하게 — 실행 불가 도구(mail.send: needs_auth)는 blocked로 남고 job은 failed.
test('원장: 실패·차단도 정직하게 남는다', async () => {
  const job = approveAutomation(candidateFor({ tool: 'mail.send', args: {} }), { id: 'j7', now: 0, nextRunAt: 0 });
  await tickAutomation([job], { tools, selfState, now: 100 });
  const rec = job.executions.at(-1);
  assert.notEqual(rec.failureState, 'none', '실행 불가는 정직하게');
  assert.equal(job.state, 'failed');
});

// ── 필수 7) 일반 대화 흐름 미교란 — 반복 신호 없으면 후보 0. ──
test('일반 대화: 반복 신호 없으면 자동화 후보 0', () => {
  assert.equal(detectAutomationCandidate('오늘 뉴스 요약해줘', localAction), null);
  assert.equal(detectAutomationCandidate('안녕', localAction), null);
  const noAction = detectAutomationCandidate('매주 정리', null);
  assert.equal(noAction.action, null, 'action 없는 후보는 실행 불가');
});

// ── 서버 통합: 후보 → 승인 → tick → 원장 → 취소. 외부는 만료 없는 승인 거부. ──
const TICK_TOKEN = 'test-tick-token';
async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-auto-'));
  const autoStore = new AutomationStore(dir);
  const server = makeServer({ store: new SessionStore(dir), automationStore: autoStore, runtimeToken: TICK_TOKEN });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { return await fn(base, autoStore, server); }
  finally { await new Promise((r) => server.close(r)); }
}
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();
// tick은 런타임 이벤트로만(§8.3) — 트러스트 토큰을 실어 호출. 사용자 요청은 이 토큰이 없다.
const tick = (base) =>
  fetch(`${base}/automation/tick`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-runtime-token': TICK_TOKEN } });

test('서버: 후보 승인 → tick 실행 → 원장 기록', async () => {
  await withServer(async (base, autoStore) => {
    await autoStore.save({ candidates: [makeGrowthCandidate({ candidateId: 'c1', statement: '매주 정리', action: localAction })], jobs: [] });
    const approved = await (await post(base, '/automation/approve', { candidateId: 'c1' })).json();
    assert.equal(approved.ok, true);
    assert.equal(approved.external, false);
    let view = await getj(base, '/automation');
    assert.equal(view.jobs.length, 1);
    assert.equal(view.jobs[0].state, 'scheduled');
    assert.equal(view.candidates.length, 0, '승인된 후보는 후보 목록에서 빠진다');
    const ticked = await (await tick(base)).json();
    assert.equal(ticked.ran.length, 1);
    assert.equal(ticked.ran[0].failureState, 'none');
    view = await getj(base, '/automation');
    assert.equal(view.jobs[0].state, 'completed');
    assert.equal(view.jobs[0].runs, 1, '실행 원장에 1회');
  });
});

test('서버: 외부 전송 자동화는 만료 없는 승인을 거부한다(A2)', async () => {
  await withServer(async (base, autoStore) => {
    await autoStore.save({ candidates: [makeGrowthCandidate({ candidateId: 'c2', statement: '매일 슬랙', action: sendAction })], jobs: [] });
    const rej = await post(base, '/automation/approve', { candidateId: 'c2' });
    assert.equal(rej.status, 400, '외부 전송은 만료 필요');
    assert.equal((await rej.json()).needsExpiry, true);
    const ok = await (await post(base, '/automation/approve', { candidateId: 'c2', expiresAt: Date.now() + 3600_000 })).json();
    assert.equal(ok.ok, true);
    assert.equal(ok.external, true);
    assert.ok(ok.grantScope.expiresAt, '승인 범위에 만료 있음');
  });
});

test('서버: 취소한 자동화는 tick에서 실행되지 않는다', async () => {
  await withServer(async (base, autoStore) => {
    await autoStore.save({ candidates: [makeGrowthCandidate({ candidateId: 'c3', statement: '매주 정리', action: localAction })], jobs: [] });
    const { jobId } = await (await post(base, '/automation/approve', { candidateId: 'c3' })).json();
    const cancelled = await (await post(base, '/automation/cancel', { jobId })).json();
    assert.equal(cancelled.state, 'cancelled');
    const ticked = await (await tick(base)).json();
    assert.equal(ticked.ran.length, 0, '취소된 job은 실행 안 함');
  });
});

// 산출물 검증(원칙 1): /turn 실경로가 반복 신호 → 후보를 만들어 저장하는지. (dedupKey 버그를 잡는 경로)
test('서버: 반복 신호 turn → 제안 카드 + 후보 저장(실경로)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '매주 로컬 파일 목록 정리해줘' })).json();
    assert.ok(r.automationSuggestion, '반복 신호 → 제안 카드');
    assert.ok(r.automationSuggestion.candidateId, 'UI 승인용 candidateId');
    assert.ok(r.automationSuggestion.action?.tool, '실행할 action 도구');
    const view = await getj(base, '/automation');
    assert.equal(view.candidates.length, 1, '후보로 저장됨(자동 승인 아님)');
    // 같은 발화 재입력 → 중복 제안 안 함
    const r2 = await (await post(base, '/turn', { sessionId: s.id, text: '매주 로컬 파일 목록 정리해줘' })).json();
    assert.equal(r2.automationSuggestion, undefined, '이미 제안한 것은 다시 제안하지 않는다');
    assert.equal((await getj(base, '/automation')).candidates.length, 1);
  });
});

// 전체 경로 회귀(감사 보정): /sessions → /turn 반복 → approve → tick → runs 1 을 한 줄 흐름으로 고정.
test('서버: 전체 경로 /turn 반복 → approve → tick → 원장 runs 1', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '매주 로컬 파일 목록 정리해줘' })).json();
    const candidateId = r.automationSuggestion.candidateId;
    const appr = await (await post(base, '/automation/approve', { candidateId })).json();
    assert.equal(appr.ok, true);
    assert.equal(appr.external, false);
    const ticked = await (await tick(base)).json();
    assert.equal(ticked.ran.length, 1);
    assert.equal(ticked.ran[0].failureState, 'none');
    const view = await getj(base, '/automation');
    assert.equal(view.jobs.length, 1);
    assert.equal(view.jobs[0].state, 'completed');
    assert.equal(view.jobs[0].runs, 1);
    assert.equal(view.jobs[0].ledger.length, 1, 'AutomationLedger에 실행 1건');
    assert.equal(view.jobs[0].ledger[0].failureState, 'none');
  });
});

test('서버: 일반 대화 turn은 자동화 후보를 만들지 않는다(흐름 미교란)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '안녕' })).json();
    assert.equal(r.kind, 'reply');
    assert.equal(r.automationSuggestion, undefined, '반복 신호 없으면 제안 0');
    assert.deepEqual((await getj(base, '/automation')).candidates, []);
  });
});

// ── 후속 슬라이스: tick 트러스트 경계(§8.3) + 반복 스케줄러 ──

// 불변식: tick은 trusted_runtime_event만 트리거한다. 사용자·자동화 인바운드·빈 값은 불허.
test('불변식: admitTickTrigger는 trusted_runtime_event만 허용', () => {
  assert.equal(admitTickTrigger({ source: 'trusted_runtime_event' }), true);
  assert.equal(admitTickTrigger({ source: 'user_chat' }), false);
  assert.equal(admitTickTrigger({ source: 'automation_trigger' }), false, '게이트 대상 외부 이벤트는 tick 아님');
  assert.equal(admitTickTrigger({ source: 'external_channel' }), false);
  assert.equal(admitTickTrigger({}), false);
  assert.equal(admitTickTrigger(null), false);
});

// 핵심 경계: 사용자가 누르듯 토큰 없이 tick을 치면 실행 0(403). "사용자 버튼 아님"을 산출물에서 고정.
test('서버: 트러스트 토큰 없는 tick은 거부되고 실행 0(not_trusted)', async () => {
  await withServer(async (base, autoStore) => {
    await autoStore.save({ candidates: [makeGrowthCandidate({ candidateId: 'c1', statement: '매주 정리', action: localAction })], jobs: [] });
    await post(base, '/automation/approve', { candidateId: 'c1' });
    // 토큰 없이 일반 POST(=사용자 요청 흉내) → 403, job은 scheduled 그대로.
    const res = await post(base, '/automation/tick');
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'not_trusted');
    const view = await getj(base, '/automation');
    assert.equal(view.jobs[0].state, 'scheduled', '거부됐으니 실행 안 됨');
    assert.equal(view.jobs[0].runs, 0);
    // 트러스트 토큰을 실으면 정상 실행(대조).
    const ok = await (await tick(base)).json();
    assert.equal(ok.ran.length, 1);
    assert.equal((await getj(base, '/automation')).jobs[0].runs, 1);
  });
});

// in-process 스케줄러는 trusted_runtime_event로 발화하고, server.runtimeTick 경로로 실제 실행한다.
test('서버: 스케줄러 발화(runtimeTick)로 tick이 실제 실행된다', async () => {
  await withServer(async (base, autoStore, server) => {
    await autoStore.save({ candidates: [makeGrowthCandidate({ candidateId: 'c1', statement: '매주 정리', action: localAction })], jobs: [] });
    await post(base, '/automation/approve', { candidateId: 'c1' });
    const scheduler = new AutomationScheduler({ onTick: server.runtimeTick });
    const out = await scheduler.fire(); // 실타이머 없이 1회 발화(결정적)
    assert.equal(out.ok, true);
    assert.equal(out.ran.length, 1, '스케줄러 발화로 실행됨');
    assert.equal((await getj(base, '/automation')).jobs[0].runs, 1);
  });
});

// 반복(interval) job: 스케줄러가 여러 번 발화하면 여러 번 실행되고, 매번 AutomationLedger에 쌓인다.
test('반복 job: 연속 tick에서 여러 번 실행되고 재예약된다', async () => {
  // engine 직접 구동(결정적 now). interval=100ms 반복 job.
  const cand = candidateFor(localAction, '매일 로컬 정리');
  const job = approveAutomation(cand, { id: 'r1', now: 0, nextRunAt: 0, intervalMs: 100 });
  const ran1 = await tickAutomation([job], { tools, selfState, now: 0 });
  assert.equal(ran1.length, 1, '1차 실행');
  assert.equal(job.state, 'scheduled', '반복은 완료되지 않고 재예약');
  assert.equal(job.nextRunAt, 100, 'nextRunAt 재예약');
  // 아직 nextRunAt 미도달 → 실행 안 함
  assert.equal((await tickAutomation([job], { tools, selfState, now: 50 })).length, 0, '미도달은 실행 0');
  // 도달 → 2차 실행
  const ran2 = await tickAutomation([job], { tools, selfState, now: 100 });
  assert.equal(ran2.length, 1, '2차 실행');
  assert.equal(job.executions.length, 2, 'AutomationLedger에 2건 누적');
  assert.equal(job.nextRunAt, 200);
});

// 스케줄러는 프로세스를 붙잡지 않는다(unref) — start/stop이 타이머를 정리한다.
test('스케줄러: start/stop이 타이머를 정리한다(데몬 아님)', () => {
  let fired = 0;
  const s = new AutomationScheduler({ onTick: async () => { fired++; }, intervalMs: 10_000 });
  s.start();
  assert.ok(s._timer, '기동됨');
  s.start(); // 중복 기동 금지
  s.stop();
  assert.equal(s._timer, null, '정지됨');
});

// ── P6-4 Automation Reliability Guard: 백오프·포기·중첩·만료 ──

// 실행 가능한 도구를 가진 결정적 컨텍스트(성공/transient실패/permanent차단).
function reliabilityCtx() {
  const env = {
    model: { authSignal: 'ok' },
    connections: [
      { id: 'ok', status: 'usable', connected: true },
      { id: 'flaky', status: 'usable', connected: true },
      { id: 'wall', status: 'usable', connected: true },
    ],
    grantedAuthorities: [],
  };
  const tools = new ToolRunner({
    ok: { async handler() { return { result: {}, userSafeSummary: '됨' }; } },
    flaky: { async handler() { throw new Error('transient'); } }, // → failed(transient)
    wall: { async handler() { return { blocked: true, userSafeSummary: '차단' }; } }, // → blocked(permanent)
  });
  return { self: buildSelfState(env), tools };
}

test('신뢰성: nextBackoffMs는 지수 증가하고 cap에서 포화한다', () => {
  assert.equal(nextBackoffMs(1, { baseMs: 10, capMs: 1000 }), 10);
  assert.equal(nextBackoffMs(2, { baseMs: 10, capMs: 1000 }), 20);
  assert.equal(nextBackoffMs(3, { baseMs: 10, capMs: 1000 }), 40);
  assert.equal(nextBackoffMs(10, { baseMs: 10, capMs: 100 }), 100, 'cap 포화');
  assert.equal(nextBackoffMs(0, { baseMs: 10, capMs: 1000 }), 10, 'fc<1은 1로 취급');
});

test('신뢰성: resolveAfterRun — 성공 리셋 / permanent 즉시 포기 / transient 백오프', () => {
  // 성공(반복): 재예약 + failureCount 0
  assert.deepEqual(resolveAfterRun({ intervalMs: 100, failureCount: 3 }, 'none', 1000), { state: 'scheduled', nextRunAt: 1100, failureCount: 0 });
  // 성공(1회): completed
  assert.deepEqual(resolveAfterRun({ failureCount: 2 }, 'none', 1000), { state: 'completed', failureCount: 0 });
  // permanent(차단): 즉시 failed(재시도 없음)
  assert.deepEqual(resolveAfterRun({ failureCount: 0 }, 'blocked', 1000), { state: 'failed', failureCount: 1 });
  // transient(cap 미만): 백오프 재예약
  const r = resolveAfterRun({ failureCount: 0, maxAttempts: 5, backoffBaseMs: 10 }, 'failed', 1000);
  assert.deepEqual(r, { state: 'scheduled', nextRunAt: 1010, failureCount: 1 });
  // transient(maxAttempts 도달): failed
  assert.deepEqual(resolveAfterRun({ failureCount: 4, maxAttempts: 5 }, 'timeout', 1000), { state: 'failed', failureCount: 5 });
});

test('신뢰성: transient 실패는 백오프 재시도 후 maxAttempts에서 포기(failed)', async () => {
  const { self, tools } = reliabilityCtx();
  const job = approveAutomation({ statement: 'x', action: { tool: 'flaky', args: {} } },
    { id: 'f1', now: 0, nextRunAt: 0, intervalMs: 100, maxAttempts: 3, backoffBaseMs: 10, backoffCapMs: 1000 });
  await tickAutomation([job], { tools, selfState: self, now: 0 });   // 1차 실패
  assert.equal(job.state, 'scheduled'); assert.equal(job.failureCount, 1); assert.equal(job.nextRunAt, 10);
  assert.equal((await tickAutomation([job], { tools, selfState: self, now: 5 })).length, 0, '백오프 미도달은 실행 0');
  await tickAutomation([job], { tools, selfState: self, now: 10 });  // 2차 실패
  assert.equal(job.failureCount, 2); assert.equal(job.nextRunAt, 30);
  await tickAutomation([job], { tools, selfState: self, now: 30 });  // 3차 → maxAttempts 도달
  assert.equal(job.state, 'failed', 'maxAttempts 초과 → 정직하게 포기');
  assert.equal(job.executions.length, 3, '원장에 3회 실패');
  assert.equal((await tickAutomation([job], { tools, selfState: self, now: 100 })).length, 0, 'failed는 다시 실행 안 함');
});

test('신뢰성: permanent 실패(차단)는 재시도 없이 즉시 포기(무한 재전송 차단)', async () => {
  const { self, tools } = reliabilityCtx();
  const job = approveAutomation({ statement: 'x', action: { tool: 'wall', args: {} } },
    { id: 'w1', now: 0, nextRunAt: 0, intervalMs: 100 });
  await tickAutomation([job], { tools, selfState: self, now: 0 });
  assert.equal(job.state, 'failed', '차단은 재시도로 안 풀린다 → 즉시 포기');
  assert.equal(job.failureCount, 1);
  const ran = await tickAutomation([job], { tools, selfState: self, now: 200 });
  assert.equal(ran.length, 0, '재전송 반복 없음');
  assert.equal(job.executions.length, 1);
});

test('신뢰성: 백오프 대기 중 만료되면 expired(만료가 재시도보다 우선)', async () => {
  const { self, tools } = reliabilityCtx();
  const job = approveAutomation({ statement: 'x', action: { tool: 'flaky', args: {} } },
    { id: 'e1', now: 0, nextRunAt: 0, intervalMs: 100, maxAttempts: 5, backoffBaseMs: 1000, grantScope: { kind: 'session', expiresAt: 500 } });
  await tickAutomation([job], { tools, selfState: self, now: 0 }); // 실패 → 백오프 nextRunAt=1000
  assert.equal(job.state, 'scheduled'); assert.equal(job.nextRunAt, 1000);
  const ran = await tickAutomation([job], { tools, selfState: self, now: 600 }); // 만료(>500)
  assert.equal(ran.length, 0);
  assert.equal(job.state, 'expired', '백오프 대기 중이라도 만료 우선');
});

test('신뢰성: tick 중첩 방지 — 겹친 tick은 skip되고 job은 1회만 실행', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-lock-'));
  const autoStore = new AutomationStore(dir);
  let release; const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const tools = new ToolRunner({ slow: { async handler() { calls++; await gate; return { result: {}, userSafeSummary: 'ok' }; } } });
  const env = { model: { authSignal: 'ok' }, connections: [{ id: 'slow', status: 'usable', connected: true }], grantedAuthorities: [] };
  const server = makeServer({ store: new SessionStore(dir), automationStore: autoStore, runtimeToken: TICK_TOKEN, tools, env });
  await autoStore.save({ candidates: [], jobs: [approveAutomation({ statement: 'x', action: { tool: 'slow', args: {} } }, { id: 's1', now: 0, nextRunAt: 0 })] });
  const p1 = server.runtimeTick(); // 첫 tick이 gate에서 대기
  const p2 = server.runtimeTick(); // 겹침 → skip
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal([r1, r2].filter((r) => r.skipped === 'in_flight').length, 1, '하나는 in_flight로 skip');
  assert.equal(calls, 1, 'job은 1회만 실행(중복 실행 방지)');
});
