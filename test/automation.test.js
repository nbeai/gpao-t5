import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectAutomationCandidate, makeGrowthCandidate, approveAutomation,
  isJobRunnable, cancelJob,
} from '../src/kernel/l5-growth/automation.js';
import { tickAutomation } from '../src/runtime/automation-engine.js';
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
async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-auto-'));
  const autoStore = new AutomationStore(dir);
  const server = makeServer({ store: new SessionStore(dir), automationStore: autoStore });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { return await fn(base, autoStore); }
  finally { await new Promise((r) => server.close(r)); }
}
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();

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
    const ticked = await (await post(base, '/automation/tick')).json();
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
    const ticked = await (await post(base, '/automation/tick')).json();
    assert.equal(ticked.ran.length, 0, '취소된 job은 실행 안 함');
  });
});

// 산출물 검증(원칙 1): /turn 실경로가 반복 신호 → 후보를 만들어 저장하는지. (dedupKey 버그를 잡는 경로)
test('서버: 반복 신호 turn → 제안 카드 + 후보 저장(실경로)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '매주 로컬 파일 정리해줘' })).json();
    assert.ok(r.automationSuggestion, '반복 신호 → 제안 카드');
    assert.ok(r.automationSuggestion.candidateId, 'UI 승인용 candidateId');
    assert.ok(r.automationSuggestion.action?.tool, '실행할 action 도구');
    const view = await getj(base, '/automation');
    assert.equal(view.candidates.length, 1, '후보로 저장됨(자동 승인 아님)');
    // 같은 발화 재입력 → 중복 제안 안 함
    const r2 = await (await post(base, '/turn', { sessionId: s.id, text: '매주 로컬 파일 정리해줘' })).json();
    assert.equal(r2.automationSuggestion, undefined, '이미 제안한 것은 다시 제안하지 않는다');
    assert.equal((await getj(base, '/automation')).candidates.length, 1);
  });
});

// 전체 경로 회귀(감사 보정): /sessions → /turn 반복 → approve → tick → runs 1 을 한 줄 흐름으로 고정.
test('서버: 전체 경로 /turn 반복 → approve → tick → 원장 runs 1', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '매주 로컬 파일 정리해줘' })).json();
    const candidateId = r.automationSuggestion.candidateId;
    const appr = await (await post(base, '/automation/approve', { candidateId })).json();
    assert.equal(appr.ok, true);
    assert.equal(appr.external, false);
    const ticked = await (await post(base, '/automation/tick')).json();
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
