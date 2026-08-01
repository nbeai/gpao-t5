import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AUTOMATION_SCHEMA_VERSION } from '../src/kernel/l5-growth/automation-contracts.js';
import { makeGrowthCandidate } from '../src/kernel/l5-growth/automation.js';
import { CanonicalAutomationRuntime } from '../src/runtime/canonical-automation-runtime.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { SessionStore } from '../src/surface/session-store.js';

function replayCases() {
  return [
    { id: 'p1', kind: 'positive', inputFacts: ['첫 자료'], expectedFacts: [], forbiddenFacts: [] },
    { id: 'p2', kind: 'positive', inputFacts: ['둘째 자료'], expectedFacts: [], forbiddenFacts: [] },
    { id: 'n1', kind: 'negative', inputFacts: ['무관한 요청'], expectedFacts: [], forbiddenFacts: [] },
    { id: 'b1', kind: 'boundary', inputFacts: ['자료 없음'], expectedFacts: [], forbiddenFacts: [] },
    { id: 'b2', kind: 'boundary', inputFacts: ['일부 자료'], expectedFacts: [], forbiddenFacts: [] },
    { id: 'a1', kind: 'authority', inputFacts: ['외부 전송 없음'], expectedFacts: [], forbiddenFacts: [] },
  ];
}

function callIdentity() {
  return {
    selection: {
      connectionInstanceId: 'seal-connection',
      credentialRef: 'seal-credential',
      endpointOrigin: 'https://models.example',
      requestModelId: 'seal-model',
    },
    actualEndpointOrigin: 'https://models.example',
    actualRequestModelId: 'seal-model',
    responseModelId: 'seal-model',
    responseIdentitySource: 'response_field',
  };
}

function model() {
  return {
    async respond(context, options = {}) {
      options.onCallIdentity?.(callIdentity());
      if (context.currentRequest.includes('항목별로 판정')) {
        return { text: JSON.stringify({ required: [], forbidden: [], rationale: '통과' }), toolCalls: [] };
      }
      if (context.currentRequest.includes('사례 종류:')) {
        return { text: '검증용 답', toolCalls: [] };
      }
      return { text: '예약 작업을 완료했어요.', toolCalls: [] };
    },
  };
}

function authority() {
  return {
    ceiling: 'A0',
    allowedKinds: [],
    allowedTools: [],
    allowedTargets: [],
    workspaceRoots: [],
    expiresAt: null,
    maxRuns: 10,
    maxCost: 0,
    requiresFreshApprovalFor: [],
  };
}

async function postJson(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error(`${path} returned ${response.status} ${response.headers.get('content-type')}: ${text.slice(0, 200)}`); }
  return { response, result };
}

async function automationView(base) {
  const response = await fetch(`${base}/automation`);
  assert.equal(response.status, 200);
  return response.json();
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

test('automation core seal: one canonical chain survives restart and exposes reversible surface truth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-automation-core-seal-'));
  const now = Date.now();
  const clock = () => now;
  const sharedModel = model();
  const tools = new ToolRunner({});
  const runtime = new CanonicalAutomationRuntime({
    dir,
    env: demoEnv(),
    tools,
    modelFor: () => sharedModel,
    memStore: new MemoryStore(dir),
    withMemory: (task) => task(),
    now: clock,
  });
  await runtime.ready();

  const proposed = await runtime.skillService.propose({
    name: '정기 요약',
    purpose: '주어진 자료를 짧게 요약한다',
    steps: ['자료를 읽는다', '한 문단으로 요약한다'],
    resultContract: { kind: 'summary' },
    requiredCapabilities: [],
    authorityHints: [],
    replayCases: replayCases(),
  }, { now });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  assert.equal(proposed.skill.state, 'proposed');

  const replayed = await runtime.skillService.replay(proposed.skill.id, { now: now + 1 });
  assert.equal(replayed.ok, true, JSON.stringify(replayed));
  assert.equal(replayed.cases.length, 6);

  const approved = await runtime.skillService.approve(proposed.skill.id, {
    now: now + 2,
    approval: {
      id: 'seal-skill-approval',
      decision: 'approved',
      skillId: proposed.skill.id,
      skillVersion: proposed.skill.version,
      skillHash: proposed.skill.contentHash,
      replayDigest: replayed.replayDigest,
    },
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal(approved.skill.state, 'approved');
  const activated = await runtime.skillService.activate(proposed.skill.id, { now: now + 3 });
  assert.equal(activated.ok, true, JSON.stringify(activated));
  assert.equal(activated.skill.state, 'active');

  const profile = await runtime.profileStore.propose({
    id: 'seal-agent',
    name: '정기 요약 담당',
    purpose: '승인된 정기 요약만 실행한다',
    modelRole: 'worker',
    toolAllowlist: [],
    workspaceScope: [],
    defaultBudgets: { maxToolCalls: 1, timeoutMs: 30_000, maxCost: 0, maxConcurrency: 1 },
    authorityCeiling: 'A0',
  }, now + 4);
  await runtime.profileStore.activate(profile.id, now + 5);
  await runtime.jobStore.update((state) => ({
    ...state,
    candidates: [...state.candidates, makeGrowthCandidate({
      candidateId: 'seal-candidate',
      statement: '정기적으로 자료를 요약한다',
      action: null,
    })],
  }));

  const server = makeServer({
    store: new SessionStore(dir),
    automationRuntime: runtime,
    env: demoEnv(),
    tools,
    model: sharedModel,
    modelTimeoutMs: 0,
    processEnv: { GPAO_T5_TCELL: 'off' },
  });
  const base = await listen(server);
  let jobId;
  try {
    const scheduled = await postJson(base, '/automation/approve', {
      candidateId: 'seal-candidate',
      skillId: activated.skill.id,
      agentProfileId: profile.id,
      name: '정기 요약 작업',
      trigger: {
        kind: 'interval', timezone: 'UTC', intervalMs: 60_000,
        nextRunAt: now, misfirePolicy: 'catch_up_once',
      },
      authorityEnvelope: authority(),
      inputTemplate: { source: 'sealed-fixture' },
      deliveryPolicy: { mode: 'none' },
    });
    assert.equal(scheduled.response.status, 200, JSON.stringify(scheduled.result));
    assert.equal(scheduled.result.state, 'scheduled');
    jobId = scheduled.result.jobId;

    const ticked = await server.runtimeTick();
    assert.equal(ticked.ran.length, 1, JSON.stringify(ticked));
    assert.equal(ticked.ran[0].jobId, jobId);
    assert.equal(ticked.ran[0].status, 'succeeded');

    const durable = await runtime.runLedger.load();
    const jobRuns = durable.runs.filter((run) => run.jobId === jobId);
    assert.equal(jobRuns.length, 1, 'one scheduled occurrence must have one durable AgentRun');
    assert.equal(jobRuns[0].status, 'succeeded');
    assert.deepEqual(
      durable.events.filter((event) => event.runId === jobRuns[0].id).map((event) => event.to),
      ['queued', 'claimed', 'running', 'succeeded'],
      'the product chain must durably claim before execution and end terminally',
    );
  } finally {
    await close(server);
  }

  const restarted = new CanonicalAutomationRuntime({
    dir,
    env: demoEnv(),
    tools,
    modelFor: () => sharedModel,
    memStore: new MemoryStore(dir),
    withMemory: (task) => task(),
    now: clock,
  });
  const restartedServer = makeServer({
    store: new SessionStore(dir),
    automationRuntime: restarted,
    env: demoEnv(),
    tools,
    model: sharedModel,
    modelTimeoutMs: 0,
    processEnv: { GPAO_T5_TCELL: 'off' },
  });
  const restartedBase = await listen(restartedServer);
  try {
    const recovered = await restartedServer.runtimeReconcile();
    assert.equal(recovered.runs.length, 0, 'restart must not replay a consumed occurrence');
    assert.equal(
      (await restarted.runLedger.load()).runs.filter((run) => run.jobId === jobId).length,
      1,
      'restart must preserve exactly one occurrence owner',
    );

    const pause = await postJson(restartedBase, '/automation/pause', { jobId });
    assert.deepEqual(pause.result, { ok: true, state: 'paused' });
    assert.equal((await automationView(restartedBase)).jobs.find((job) => job.id === jobId).state, 'paused');

    const resume = await postJson(restartedBase, '/automation/resume', { jobId });
    assert.deepEqual(resume.result, { ok: true, state: 'scheduled' });
    assert.equal((await automationView(restartedBase)).jobs.find((job) => job.id === jobId).state, 'scheduled');

    const retry = await postJson(restartedBase, '/automation/retry', { jobId });
    assert.deepEqual(retry.result, { ok: true, jobId, state: 'scheduled' });
    const afterRetry = await automationView(restartedBase);
    assert.equal(afterRetry.jobs.filter((job) => job.id === jobId).length, 1, 'retry must keep the same job identity');

    const cancel = await postJson(restartedBase, '/automation/cancel', { jobId });
    assert.deepEqual(cancel.result, { ok: true, state: 'cancelled' });
    assert.equal((await automationView(restartedBase)).jobs.find((job) => job.id === jobId).state, 'cancelled');

    const afterCancel = await restartedServer.runtimeReconcile();
    assert.equal(afterCancel.runs.length, 0, 'cancelled work must stay stopped after recovery');
    assert.equal(
      (await restarted.runLedger.load()).runs.filter((run) => run.jobId === jobId).length,
      1,
      'pause, resume, retry, cancel, and recovery must not duplicate the occurrence',
    );
  } finally {
    await close(restartedServer);
  }
});
