import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('L6 local delivery red: corrupt delivery ledger는 empty가 아니라 recovery unknown이다', async () => {
  const dir = await room();
  const store = new DeliveryStore(dir);
  await writeFile(store.file, '{broken', 'utf8');
  const loaded = await store.load();
  assert.ok(loaded.recovery);
  assert.equal(loaded.deliveries.length, 0);
});

test('L6 local delivery red: succeeded due run은 봉인된 local conversation에 exactly once 전달된다', async () => {
  const dir = await room(); const sessions = new SessionStore(dir);
  const session = await sessions.create('전달 대상', { principalRef: 'local-owner' });
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
  const tick = await runtime.tick();
  const deliveries = await new DeliveryStore(dir).load(); const after = await sessions.load(session.id);
  const delivered = after.transcript.filter((entry) => entry.source === 'automation');
  assert.equal(tick.runs[0]?.status, 'succeeded');
  assert.equal(deliveries.deliveries?.length, 1);
  assert.equal(delivered.length, 1);
  assert.equal(tick.runs[0]?.deliveryState, 'delivered');
});
