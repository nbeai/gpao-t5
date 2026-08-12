import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { CanonicalAutomationRuntime } from '../src/runtime/canonical-automation-runtime.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { AUTOMATION_SCHEMA_VERSION, contentHash, skillHashSource } from '../src/kernel/l5-growth/automation-contracts.js';
import { DeliveryStore } from '../src/surface/delivery-store.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

const room = () => mkdtemp(join(tmpdir(), 't5-l6-local-delivery-'));

function deliverySkillProfile() {
  const skill = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 'delivery-skill', name: '대화 전달', purpose: '결과를 만든다',
    version: 1, contentHash: '', inputs: [], steps: [{ kind: 'organize', instruction: '파일을 확인한다' }],
    resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file'], authorityHints: ['organize'], replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] }, state: 'active', createdAt: 0, updatedAt: 0,
    previousVersion: null,
  };
  skill.contentHash = contentHash(skillHashSource(skill));
  const profile = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 'delivery-agent', name: '대화 전달 담당', purpose: '결과를 만든다',
    modelRole: 'worker', toolAllowlist: ['local.file'], workspaceScope: ['/tmp'],
    defaultBudgets: { maxToolCalls: 2, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A1', state: 'active', createdAt: 0, updatedAt: 0,
  };
  return { skill, profile };
}

async function dueRuntime(dir, session, reply = '자동 실행 결과', options = {}) {
  const { skill, profile } = deliverySkillProfile(); const now = Date.now();
  const runtime = new CanonicalAutomationRuntime({
    dir, env: demoEnv(), tools: new ToolRunner({}), memStore: new MemoryStore(dir),
    withMemory: (task) => task(), modelFor: () => ({ async respond() { return reply; } }), now: () => now,
    ...(options.beforeRun ? { beforeRun: options.beforeRun } : {}),
  });
  await runtime.ready();
  await runtime.skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill] });
  await runtime.profileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile] });
  await runtime.jobStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [], settlements: [], jobs: [{
    schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 'delivery-job', name: '대화 전달 작업', principalRef: 'local-owner',
    skillRef: { id: skill.id, version: skill.version, contentHash: skill.contentHash },
    trigger: { kind: 'once', timezone: 'UTC', at: now, nextRunAt: now, misfirePolicy: 'catch_up_once' },
    agentProfileId: profile.id, inputTemplate: {},
    authorityEnvelope: { ceiling: 'A1', allowedKinds: ['organize'], allowedTools: ['local.file'], allowedTargets: [], workspaceRoots: ['/tmp'], expiresAt: null, maxRuns: 1, maxCost: 1, requiresFreshApprovalFor: [] },
    deliveryPolicy: { mode: 'local_conversation', target: { kind: 'local_conversation', conversationRef: session.id, principalRef: session.principalRef, conversationCreatedAt: session.createdAt } },
    state: 'scheduled', nextRunAt: now, lastRunId: null, createdAt: now, updatedAt: now,
  }] });
  return runtime;
}

function chatProposalModel() {
  return { async respond(_tc, opts = {}) {
    if (opts.tools?.some((entry) => entry.name === 'automation.propose')) {
      return { text: '', toolCalls: [{ name: 'automation.propose', args: {
        statement: '매주 결과를 이 대화에 남긴다', operation: 'create', kind: 'weekly',
        trigger: { kind: 'weekly', timezone: 'Asia/Seoul', weekdays: [1], localTime: '09:30', misfirePolicy: 'catch_up_once' },
        tool: 'local.file', action: { args: { action: 'read', path: '자료.txt' } },
        skillPurpose: '자료 확인', deliveryIntent: 'chat',
      } }] };
    }
    return '후보 상태를 확인했어요.';
  } };
}

test('L6 local delivery red: natural local web chat proposal은 actionable candidate가 된다', async () => {
  const dir = await room();
  const store = new SessionStore(dir);
  const server = makeServer({
    store, model: chatProposalModel(), env: demoEnv(), tools: demoTools(),
    processEnv: { HOME: dir, GPAO_T5_HOME: dir, GPAO_T5_DATA_DIR: dir, GPAO_T5_FILE_ROOTS: dir },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
    const result = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '매주 결과를 이 대화에 남겨줘' }),
    }).then((r) => r.json());
    assert.equal(result.automationProposal?.rejected, undefined);
    assert.equal(typeof result.automationProposal?.candidateId, 'string');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

// **2026-08-12 계약 이동**(`design/T5-AUTOMATION-CLOSE-ko.md` §4 넓힘 1번).
// 재는 것은 그대로다 — *"job 의 전달 대상은 **서버가 봉인한 현재 local conversation** 하나이고,
// 그 세션 id 는 어떤 공개 표면에도 새지 않는다."* 바뀐 것은 그 job 이 서는 **경로** 하나다:
// 사용자가 스스로 시점을 말한 요청("매주 …")은 승인 카드 없이 그 자리에서 켜진다
// (자동성 헌장 `kernel/l2-plan/authority.js`: *"automate → 자동. 문지기는 사후 교정 표면"*).
test('natural chat 명시 예약은 서버가 봉인한 현재 local conversation만 job에 결속한다', async () => {
  const dir = await room(); const store = new SessionStore(dir);
  const server = makeServer({ store, model: chatProposalModel(), env: demoEnv(), tools: demoTools(),
    processEnv: { HOME: dir, GPAO_T5_HOME: dir, GPAO_T5_DATA_DIR: dir, GPAO_T5_FILE_ROOTS: dir } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { skill, profile } = deliverySkillProfile();
    await server.automationRuntime.ready();
    await server.automationRuntime.skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill] });
    await server.automationRuntime.profileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile] });
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
    const proposed = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '매주 결과를 이 대화에 남겨줘' }) }).then((r) => r.json());
    assert.ok(proposed.automationProposal?.jobRef,
      `명시 예약이 안 켜졌다: ${JSON.stringify(proposed.automationProposal)}`);
    // **대화 신분은 어떤 공개 표면에도 안 샌다** — 켜지는 경로가 바뀌어도 이 경계는 그대로다.
    const publicAutomation = await fetch(`${base}/automation`).then((r) => r.json());
    assert.equal(JSON.stringify(publicAutomation).includes(session.id), false);
    assert.equal(JSON.stringify(proposed.automationProposal).includes(session.id), false);
    const jobs = await server.automationRuntime.jobStore.load();
    const durableSession = await store.load(session.id);
    const job = jobs.jobs.find((entry) => entry.id === proposed.automationProposal.jobRef);
    assert.deepEqual(job.deliveryPolicy, { mode: 'local_conversation', target: {
      kind: 'local_conversation', conversationRef: session.id,
      principalRef: 'local-owner', conversationCreatedAt: durableSession.createdAt,
    } });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('L6 local delivery red: session turn save와 automation append 동시성은 둘 다 보존한다', async () => {
  const store = new SessionStore(await room());
  const session = await store.create('동시성', { principalRef: 'local-owner' });
  const stale = await store.load(session.id);
  stale.transcript.push({ role: 'user', text: '동시에 쓴 말' });
  const delivery = { role: 'assistant', result: { kind: 'reply', reply: '자동 결과' }, source: 'automation',
    jobRef: 'job', runRef: 'run', deliveryRef: 'delivery', contentDigest: 'digest' };
  await Promise.all([
    store.save(stale),
    store.appendAutomationDelivery(session.id, delivery, {
      principalRef: 'local-owner', conversationCreatedAt: session.createdAt,
    }),
  ]);
  const saved = await store.load(session.id);
  assert.equal(saved.transcript.some((entry) => entry.text === '동시에 쓴 말'), true);
  assert.equal(saved.transcript.filter((entry) => entry.deliveryRef === 'delivery').length, 1);
});

test('same deliveryRef의 다른 본문은 idempotent 성공으로 바뀌지 않는다', async () => {
  const store = new SessionStore(await room());
  const session = await store.create('대상', { principalRef: 'local-owner' });
  const expected = { principalRef: 'local-owner', conversationCreatedAt: session.createdAt };
  const first = { role: 'assistant', result: { kind: 'reply', reply: '첫 결과' }, source: 'automation',
    jobRef: 'job', runRef: 'run', deliveryRef: 'same', contentDigest: 'digest-a' };
  assert.equal((await store.appendAutomationDelivery(session.id, first, expected)).ok, true);
  const forged = { ...first, result: { kind: 'reply', reply: '다른 결과' }, contentDigest: 'digest-b' };
  assert.deepEqual(await store.appendAutomationDelivery(session.id, forged, expected), {
    ok: false, reason: 'delivery_identity_mismatch',
  });
  const saved = await store.load(session.id);
  assert.deepEqual(saved.transcript.filter((entry) => entry.deliveryRef === 'same'), [first]);
});

test('L6 local delivery red: corrupt delivery ledger는 empty가 아니라 recovery unknown이다', async () => {
  const dir = await room();
  const store = new DeliveryStore(dir);
  await writeFile(store.file, '{broken', 'utf8');
  const loaded = await store.load();
  assert.ok(loaded.recovery);
  assert.equal(loaded.deliveries.length, 0);
});

test('delivery receipt readback count와 canonical identity가 다르면 durable 입장하지 않는다', async () => {
  const dir = await room(); const store = new DeliveryStore(dir);
  const target = { kind: 'local_conversation', conversationRef: 'session', principalRef: 'owner', conversationCreatedAt: 1 };
  const contentDigest = createHash('sha256').update('result').digest('hex');
  const deliveryRef = createHash('sha256').update(JSON.stringify({ runRef: 'run', jobRef: 'job', target, contentDigest })).digest('hex');
  const record = { kind: 'automation_local_delivery', deliveryRef, runRef: 'run', jobRef: 'job', target,
    contentDigest, state: 'delivered', attempts: [{ attemptRef: 'start', phase: 'started', at: 1 }, { attemptRef: 'finish', phase: 'finished', at: 2, outcome: 'delivered' }],
    createdAt: 1, updatedAt: 2, deliveredAt: 2,
    receipt: { conversationRef: 'session', deliveryRef, contentDigest, exactCount: 2 } };
  await assert.rejects(store.save({ deliveries: [record] }), /receipt invalid/);
  assert.ok((await store.load()).recovery === undefined);
});

test('L6 local delivery red: succeeded due run은 봉인된 local conversation에 exactly once 전달된다', async () => {
  const dir = await room(); const sessions = new SessionStore(dir);
  const session = await sessions.create('전달 대상', { principalRef: 'local-owner' });
  const { skill, profile } = deliverySkillProfile();
  const now = Date.now();
  const runtime = new CanonicalAutomationRuntime({
    dir, env: demoEnv(), tools: new ToolRunner({}), memStore: new MemoryStore(dir),
    withMemory: (task) => task(), modelFor: () => ({ async respond() { return '자동 실행 결과'; } }), now: () => now,
  });
  await runtime.ready();
  await runtime.skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill] });
  await runtime.profileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile] });
  await runtime.jobStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [], settlements: [], jobs: [{
    schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 'delivery-job', name: '대화 전달 작업', principalRef: 'local-owner',
    skillRef: { id: skill.id, version: skill.version, contentHash: skill.contentHash },
    trigger: { kind: 'once', timezone: 'UTC', at: now, nextRunAt: now, misfirePolicy: 'catch_up_once' },
    agentProfileId: profile.id, inputTemplate: {},
    authorityEnvelope: { ceiling: 'A1', allowedKinds: ['organize'], allowedTools: ['local.file'], allowedTargets: [], workspaceRoots: ['/tmp'], expiresAt: null, maxRuns: 1, maxCost: 1, requiresFreshApprovalFor: [] },
    deliveryPolicy: { mode: 'local_conversation', target: { kind: 'local_conversation', conversationRef: session.id, principalRef: session.principalRef, conversationCreatedAt: session.createdAt } },
    state: 'scheduled', nextRunAt: now, lastRunId: null, createdAt: now, updatedAt: now,
  }] });
  const server = makeServer({
    store: sessions, automationRuntime: runtime, model: { async respond() { return '자동 실행 결과'; } },
    env: demoEnv(), tools: new ToolRunner({}), startScheduler: false,
  });
  const tick = await server.runtimeTick();
  const deliveries = await new DeliveryStore(dir).load(); const after = await sessions.load(session.id);
  const delivered = after.transcript.filter((entry) => entry.source === 'automation');
  assert.equal(tick.ran[0]?.status, 'succeeded');
  assert.equal(deliveries.deliveries?.length, 1);
  assert.equal(delivered.length, 1);
  assert.equal(tick.ran[0]?.deliveryStatus, 'delivered');
  const runs = await runtime.runLedger.load();
  assert.equal(runs.runs[0].deliveryState.status, 'delivered');
  assert.equal((await runtime.runLedger.recordDelivery(runs.runs[0].id,
    structuredClone(runs.runs[0].deliveryState), Date.now())).idempotent, true);
  await assert.rejects(runtime.runLedger.recordDelivery(runs.runs[0].id,
    { ...runs.runs[0].deliveryState, deliveryRef: 'forged' }, Date.now()),
  /identity changed/);
  await server.runtimeTick();
  assert.deepEqual((await new DeliveryStore(dir).load()).deliveries[0].attempts.map((entry) => entry.phase), ['started', 'finished']);
  assert.equal((await sessions.load(session.id)).transcript.filter((entry) => entry.deliveryRef).length, 1);
});

test('channel-origin conversation은 local delivery target으로 입장하지 않는다', async () => {
  const dir = await room(); const store = new SessionStore(dir);
  const session = await store.create('채널', { principalRef: 'local-owner', origin: { channel: 'telegram', chatId: 'room' } });
  const productTools = demoTools(); let productToolCalls = 0;
  const originalRun = productTools.run.bind(productTools);
  productTools.run = async (...args) => { productToolCalls += 1; return originalRun(...args); };
  const server = makeServer({ store, model: chatProposalModel(), env: demoEnv(), tools: productTools,
    processEnv: { HOME: dir, GPAO_T5_HOME: dir, GPAO_T5_DATA_DIR: dir, GPAO_T5_FILE_ROOTS: dir } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '매주 결과를 이 대화에 남겨줘' }) }).then((r) => r.json());
    assert.equal(result.automationProposal?.reason, 'delivery_target_unknown');
    assert.equal((await server.automationRuntime.jobStore.load()).candidates.length, 0);
    assert.equal(productToolCalls, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('failed local append는 same-session explicit retry로 같은 artifact를 exactly once 전달한다', async () => {
  const dir = await room(); const sessions = new SessionStore(dir);
  const session = await sessions.create('전달 대상', { principalRef: 'local-owner' });
  const other = await sessions.create('다른 대상', { principalRef: 'local-owner' });
  const runtime = await dueRuntime(dir, session, '재사용할 결과');
  const originalAppend = sessions.appendAutomationDelivery.bind(sessions);
  sessions.appendAutomationDelivery = async () => ({ ok: false, reason: 'injected_append_failure' });
  const server = makeServer({ store: sessions, automationRuntime: runtime,
    model: { async respond() { return '재사용할 결과'; } }, env: demoEnv(), tools: new ToolRunner({}), startScheduler: false });
  const first = await server.runtimeTick();
  assert.equal(first.ran[0].deliveryStatus, 'failed');
  assert.equal((await sessions.load(session.id)).transcript.filter((entry) => entry.source === 'automation').length, 0);
  const failed = (await new DeliveryStore(dir).load()).deliveries[0];
  assert.equal(failed.state, 'failed');
  sessions.appendAutomationDelivery = originalAppend;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const wrong = await fetch(`${base}/deliveries/${failed.deliveryRef}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: other.id }) });
    assert.equal(wrong.status, 403);
    assert.equal((await sessions.load(session.id)).transcript.filter((entry) => entry.source === 'automation').length, 0);
    const retry = await fetch(`${base}/deliveries/${failed.deliveryRef}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id }) }).then((r) => r.json());
    assert.deepEqual(retry, { ok: true, state: 'delivered' });
    const saved = await sessions.load(session.id);
    assert.equal(saved.transcript.filter((entry) => entry.deliveryRef === failed.deliveryRef).length, 1);
    assert.equal(saved.transcript.find((entry) => entry.deliveryRef === failed.deliveryRef).result.reply, '재사용할 결과');
    const runs = await runtime.runLedger.load();
    assert.equal(runs.runs[0].deliveryState.status, 'delivered');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('claim 뒤 mutable job target 변경은 queued run의 봉인 target을 바꾸지 않는다', async () => {
  const dir = await room(); const sessions = new SessionStore(dir);
  const original = await sessions.create('원래 대상', { principalRef: 'local-owner' });
  const other = await sessions.create('바뀐 대상', { principalRef: 'local-owner' });
  let runtime;
  runtime = await dueRuntime(dir, original, '봉인 결과', { beforeRun: async () => {
    await runtime.jobStore.update((state) => ({ ...state, jobs: state.jobs.map((job) => ({
      ...job, deliveryPolicy: { mode: 'local_conversation', target: {
        kind: 'local_conversation', conversationRef: other.id,
        principalRef: other.principalRef, conversationCreatedAt: other.createdAt,
      } },
    })) }));
  } });
  const server = makeServer({ store: sessions, automationRuntime: runtime,
    model: { async respond() { return '봉인 결과'; } }, env: demoEnv(), tools: new ToolRunner({}), startScheduler: false });
  await server.runtimeTick();
  assert.equal((await sessions.load(original.id)).transcript.filter((entry) => entry.source === 'automation').length, 1);
  assert.equal((await sessions.load(other.id)).transcript.filter((entry) => entry.source === 'automation').length, 0);
});

test('archived target와 sensitive result는 전달을 fail closed하고 다른 세션을 바꾸지 않는다', async () => {
  for (const mode of ['archived', 'sensitive']) {
    const dir = await room(); const sessions = new SessionStore(dir);
    const target = await sessions.create('대상', { principalRef: 'local-owner' });
    const other = await sessions.create('불변', { principalRef: 'local-owner' });
    const beforeOther = JSON.stringify(await sessions.load(other.id));
    const runtime = await dueRuntime(dir, target, mode === 'sensitive' ? 'api_key=secret-value' : '정상 결과');
    if (mode === 'archived') await sessions.setArchived(target.id, true);
    const server = makeServer({ store: sessions, automationRuntime: runtime,
      model: { async respond() { return 'unused'; } }, env: demoEnv(), tools: new ToolRunner({}), startScheduler: false });
    await server.runtimeTick();
    assert.equal((await sessions.load(target.id)).transcript.filter((entry) => entry.source === 'automation').length, 0);
    assert.equal(JSON.stringify(await sessions.load(other.id)), beforeOther);
    assert.equal((await runtime.runLedger.load()).runs[0].deliveryState.status, 'failed');
  }
});

test('deleted target와 principal 변경도 실행 결과를 다른 곳에 전달하지 않는다', async () => {
  for (const mode of ['deleted', 'principal_changed']) {
    const dir = await room(); const sessions = new SessionStore(dir);
    const target = await sessions.create('대상', { principalRef: 'local-owner' });
    const runtime = await dueRuntime(dir, target);
    if (mode === 'deleted') await sessions.softDelete(target.id);
    else { const changed = await sessions.load(target.id); changed.principalRef = 'other-owner'; await sessions.save(changed); }
    const server = makeServer({ store: sessions, automationRuntime: runtime,
      model: { async respond() { return '자동 실행 결과'; } }, env: demoEnv(), tools: new ToolRunner({}), startScheduler: false });
    await server.runtimeTick();
    const durable = await sessions.load(target.id, { includeDeleted: true });
    assert.equal(durable.transcript.filter((entry) => entry.source === 'automation').length, 0);
    assert.equal((await runtime.runLedger.load()).runs[0].deliveryState.status, 'failed');
  }
});

test('corrupt delivery ledger는 pending run을 delivered로 열지 않고 transcript를 쓰지 않는다', async () => {
  const dir = await room(); const sessions = new SessionStore(dir);
  const target = await sessions.create('대상', { principalRef: 'local-owner' });
  const runtime = await dueRuntime(dir, target);
  await writeFile(new DeliveryStore(dir).file, '{broken', 'utf8');
  const server = makeServer({ store: sessions, automationRuntime: runtime,
    model: { async respond() { return '자동 실행 결과'; } }, env: demoEnv(), tools: new ToolRunner({}), startScheduler: false });
  await server.runtimeTick();
  assert.equal((await sessions.load(target.id)).transcript.filter((entry) => entry.source === 'automation').length, 0);
  assert.equal((await runtime.runLedger.load()).runs[0].deliveryState.status, 'pending');
  assert.ok((await new DeliveryStore(dir).load()).recovery);
});

test('두 scheduler tick 경합과 후속 reconcile도 run1 delivery1 entry1이다', async () => {
  const dir = await room(); const sessions = new SessionStore(dir);
  const target = await sessions.create('대상', { principalRef: 'local-owner' });
  const runtime = await dueRuntime(dir, target);
  const server = makeServer({ store: sessions, automationRuntime: runtime,
    model: { async respond() { return '자동 실행 결과'; } }, env: demoEnv(), tools: new ToolRunner({}), startScheduler: false });
  await Promise.all([server.runtimeTick(), server.runtimeTick()]);
  await server.runtimeTick();
  assert.equal((await runtime.runLedger.load()).runs.length, 1);
  assert.equal((await new DeliveryStore(dir).load()).deliveries.length, 1);
  assert.equal((await sessions.load(target.id)).transcript.filter((entry) => entry.source === 'automation').length, 1);
});

test('attempting 및 append-before-receipt crash 뒤 restart는 같은 artifact를 exact1로 결산한다', async () => {
  for (const afterAppend of [false, true]) {
    const dir = await room(); const sessions = new SessionStore(dir);
    const target = await sessions.create('대상', { principalRef: 'local-owner' });
    const firstRuntime = await dueRuntime(dir, target, '재시작 결과');
    const firstTick = await firstRuntime.tick();
    const run = firstTick.runs[0]; const policy = run.deliveryState.policySnapshot;
    const reply = run.result.reply; const contentDigest = createHash('sha256').update(reply).digest('hex');
    const deliveryRef = createHash('sha256').update(JSON.stringify({
      runRef: run.id, jobRef: run.jobId, target: policy.target, contentDigest,
    })).digest('hex');
    const at = Date.now();
    await new DeliveryStore(dir).save({ deliveries: [{
      kind: 'automation_local_delivery', deliveryRef, runRef: run.id, jobRef: run.jobId,
      target: policy.target, contentDigest, state: 'attempting',
      attempts: [{ attemptRef: `${deliveryRef}:1:start`, phase: 'started', at }], createdAt: at, updatedAt: at,
    }] });
    const entry = { role: 'assistant', result: { kind: 'reply', reply }, source: 'automation',
      jobRef: run.jobId, runRef: run.id, deliveryRef, contentDigest };
    if (afterAppend) assert.equal((await sessions.appendAutomationDelivery(target.id, entry, policy.target)).ok, true);
    const restarted = new CanonicalAutomationRuntime({
      dir, env: demoEnv(), tools: new ToolRunner({}), memStore: new MemoryStore(dir),
      withMemory: (task) => task(), modelFor: () => ({ async respond() { throw new Error('model_must_not_run'); } }),
    });
    const server = makeServer({ store: sessions, automationRuntime: restarted,
      model: { async respond() { throw new Error('model_must_not_run'); } }, env: demoEnv(), tools: new ToolRunner({}), startScheduler: false });
    await server.runtimeTick();
    assert.equal((await sessions.load(target.id)).transcript.filter((item) => item.deliveryRef === deliveryRef).length, 1);
    assert.equal((await new DeliveryStore(dir).load()).deliveries[0].state, 'delivered');
    assert.equal((await restarted.runLedger.load()).runs[0].deliveryState.status, 'delivered');
  }
});

test('deliveryPolicy none job은 전달 저장소와 transcript를 건드리지 않는다', async () => {
  const dir = await room(); const sessions = new SessionStore(dir);
  const target = await sessions.create('대상', { principalRef: 'local-owner' });
  const runtime = await dueRuntime(dir, target);
  await runtime.jobStore.update((state) => ({ ...state, jobs: state.jobs.map((job) => ({
    ...job, deliveryPolicy: { mode: 'none' },
  })) }));
  const server = makeServer({ store: sessions, automationRuntime: runtime,
    model: { async respond() { return '자동 실행 결과'; } }, env: demoEnv(), tools: new ToolRunner({}), startScheduler: false });
  await server.runtimeTick();
  assert.equal((await new DeliveryStore(dir).load()).deliveries.length, 0);
  assert.equal((await sessions.load(target.id)).transcript.filter((entry) => entry.source === 'automation').length, 0);
  assert.equal((await runtime.runLedger.load()).runs[0].deliveryState.status, 'not_requested');
});

test('다음 RealitySnapshot은 bounded execution/delivery status만 공급하고 target/content를 누출하지 않는다', async () => {
  const dir = await room(); const sessions = new SessionStore(dir);
  const target = await sessions.create('대상', { principalRef: 'local-owner' });
  const runtime = await dueRuntime(dir, target, '노출 금지 자동 본문');
  let seen = null;
  const server = makeServer({ store: sessions, automationRuntime: runtime,
    model: { async respond(tc) { seen = tc.automationReality; return '확인'; } },
    env: demoEnv(), tools: new ToolRunner({}), startScheduler: false });
  await server.runtimeTick();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: target.id, text: '지금 자동화 상태 알려줘' }) });
    const run = seen.recentRuns.items[0];
    assert.equal(run.executionStatus, 'succeeded');
    assert.equal(run.deliveryStatus, 'delivered');
    const raw = JSON.stringify(seen);
    assert.equal(raw.includes(target.id), false);
    assert.equal(raw.includes('노출 금지 자동 본문'), false);
    assert.equal(raw.includes('contentDigest'), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
