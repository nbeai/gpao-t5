import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AUTOMATION_SCHEMA_VERSION,
  contentHash,
  skillHashSource,
  transitionState,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { AutomationScheduler } from '../src/runtime/automation-scheduler.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';

const post = async (base, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const get = async (base, path) => (await fetch(`${base}${path}`)).json();

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function visibleText(value) {
  const visibleKeys = new Set([
    'label', 'name', 'reply', 'userSafe', 'userSafeSummary', 'nextSafeAction',
    'statement', 'targetLabel',
  ]);
  const found = [];
  const visit = (entry, key = '') => {
    if (typeof entry === 'string') {
      if (visibleKeys.has(key)) found.push(entry);
      return;
    }
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child, key);
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    for (const [childKey, child] of Object.entries(entry)) visit(child, childKey);
  };
  visit(value);
  return found.join('\n');
}

test('W6: 현재 요청부터 영수증까지 일곱 코어가 한 제품 경로에서 같은 사실을 본다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-w6-turn-'));
  const store = new SessionStore(dir);
  const modelContexts = [];
  const externalEffects = [];
  const tools = demoTools({
    senders: {
      'slack.post': {
        previewOf: ({ target, text }) => ({
          title: '슬랙에 보내기', summary: `${target}에 ${text}`,
        }),
        async handler(args) {
          externalEffects.push(structuredClone(args));
          return { result: { posted: true, target: args.target }, userSafeSummary: '슬랙에 게시했어요.' };
        },
      },
    },
  });
  const env = demoEnv({ hands: Object.keys(tools.tools) });
  const model = {
    async respond(context) {
      modelContexts.push(structuredClone(context));
      return { text: `지금 요청은 "${context.currentRequest}"입니다.`, toolCalls: [] };
    },
  };
  const server = makeServer({
    store, env, tools, model, modelTimeoutMs: 0,
    processEnv: { GPAO_T5_TCELL: 'off' },
  });
  const base = await listen(server);
  try {
    const session = (await post(base, '/sessions')).body;
    await post(base, '/turn', { sessionId: session.id, text: '보고서는 기본적으로 목록으로 정리해줘' });
    const current = '이번 요청만 표로 정리해줘';
    const turn = (await post(base, '/turn', { sessionId: session.id, text: current })).body;

    assert.equal(turn.kind, 'reply');
    assert.match(turn.reply, new RegExp(current));
    assert.equal(modelContexts.at(-1).currentRequest, current, '현재 요청 원문이 이전 맥락에 덮이면 안 된다');
    assert.ok(
      modelContexts.at(-1).recentTurns.some((entry) =>
        entry.role === 'user' && entry.text === '보고서는 기본적으로 목록으로 정리해줘'),
      '직전 사용자 발화는 역할과 함께 이력에 남아야 한다',
    );
    assert.equal(
      modelContexts.at(-1).recentTurns.some((entry) => entry.text === current),
      false,
      '현재 요청은 currentRequest와 recentTurns에 중복 공급되면 안 된다',
    );
    assert.ok(turn.selfStateSummary?.model, 'Selfhood가 실제 모델 상태를 사용자 응답에 투영해야 한다');

    const held = (await post(base, '/turn', {
      sessionId: session.id,
      text: '슬랙 #general에 완료했다고 올려줘',
    })).body;
    assert.equal(held.kind, 'approval');
    assert.equal(externalEffects.length, 0, 'Authority가 실행보다 먼저 서야 한다');

    const resumed = (await post(base, '/turn', { sessionId: session.id, approve: held.pendingId })).body;
    assert.equal(resumed.kind, 'reply');
    assert.equal(externalEffects.length, 1, '승인한 외부 행동은 정확히 한 번 실행돼야 한다');
    assert.equal(resumed.ledger.confirmed.at(-1), '슬랙에 게시했어요.');

    const persisted = await store.load(session.id);
    const receipt = persisted.ledgerEntries.at(-1);
    assert.equal(receipt.actualCall.tool, 'slack.post');
    assert.deepEqual(receipt.result, { posted: true, target: '#general' });
    assert.equal(receipt.failureState, 'none');
    assert.equal(receipt.lifecycle, 'delivered');
    assert.equal(receipt.userSafeSummary, resumed.ledger.confirmed.at(-1));

    const userProjection = visibleText({ turn, held, resumed });
    assert.doesNotMatch(userProjection, /\/Users\/|\/tmp\/|EACCES|run-|job-|agent-|[0-9a-f]{8}-[0-9a-f-]{27,}/iu);
  } finally {
    await close(server);
  }
});

function activeSkill() {
  const skill = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'skill-weekly', name: '주간 정산', purpose: '주간 자료를 정리한다',
    version: 1, contentHash: '', inputs: [],
    steps: [{ kind: 'summarize', instruction: '자료를 읽고 요약한다' }],
    resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file'],
    authorityHints: [], replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] }, state: 'active',
    createdAt: 1, updatedAt: 1, previousVersion: null,
  };
  skill.contentHash = contentHash(skillHashSource(skill));
  return skill;
}

function activeProfile() {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'agent-weekly', name: '정산 담당', purpose: '정산 자료를 읽는다',
    modelRole: 'worker', toolAllowlist: ['local.file'], workspaceScope: ['/tmp'],
    defaultBudgets: { maxToolCalls: 2, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A1', state: 'active', createdAt: 1, updatedAt: 1,
  };
}

function scheduledJob(skill) {
  const proposed = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'job-weekly', name: '금요일 정산 초안',
    skillRef: { id: skill.id, version: skill.version, contentHash: skill.contentHash },
    trigger: {
      kind: 'weekly', timezone: 'Asia/Seoul', weekdays: [5], localTime: '17:00',
      nextRunAt: 10_000, misfirePolicy: 'catch_up_once',
    },
    agentProfileId: 'agent-weekly', inputTemplate: {},
    authorityEnvelope: {
      ceiling: 'A1', allowedKinds: ['read'], allowedTools: ['local.file'],
      allowedTargets: [], workspaceRoots: ['/tmp'], expiresAt: null,
      maxRuns: 20, maxCost: 1, requiresFreshApprovalFor: [],
    },
    deliveryPolicy: { mode: 'none' }, state: 'proposed', nextRunAt: 10_000,
    lastRunId: null, createdAt: 1, updatedAt: 1,
  };
  const approved = transitionState('automationJob', proposed, 'approved', 2);
  assert.equal(approved.ok, true);
  const scheduled = transitionState('automationJob', approved.record, 'scheduled', 3);
  assert.equal(scheduled.ok, true);
  return scheduled.record;
}

test('W6: 자동화·에이전트·복구 표면은 같은 상태를 말하고 진단 원문은 사람말에 새지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-w6-surface-'));
  const skill = activeSkill();
  const profile = activeProfile();
  const job = scheduledJob(skill);
  const skillStore = new SkillDefinitionStore(dir);
  const automationStore = new AutomationJobStore(dir);
  const agentProfileStore = new AgentProfileStore(dir);
  await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill] });
  await automationStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [], jobs: [job] });
  await agentProfileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile] });

  const runLedger = {
    async append(run) { return { record: run }; },
    async load() {
      return {
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        runs: [{
          id: 'run-internal-7f8a', jobId: job.id, status: 'unknown',
          scheduledFor: 9_000, finishedAt: 9_100,
          result: { error: 'EACCES: /Users/person/private/source.txt' },
        }],
      };
    },
  };
  const server = makeServer({
    store: new SessionStore(dir), skillStore, automationStore, agentProfileStore,
    automationRunLedger: runLedger, env: demoEnv(), tools: demoTools(),
    model: { async respond() { return { text: '확인했어요.', toolCalls: [] }; } },
    modelTimeoutMs: 0, processEnv: { GPAO_T5_TCELL: 'off' },
  });
  const base = await listen(server);
  try {
    const [overview, automation] = await Promise.all([
      get(base, '/overview'), get(base, '/automation'),
    ]);
    assert.deepEqual(overview.automations.active, [{ id: job.id, label: job.name, state: 'scheduled' }]);
    assert.deepEqual(overview.agents.active, [{ id: profile.id, label: profile.name }]);
    assert.equal(automation.jobs.length, 1);
    assert.equal(automation.jobs[0].id, overview.automations.active[0].id);
    assert.equal(automation.jobs[0].state, overview.automations.active[0].state);
    assert.equal(automation.runs[0].status, 'unknown');
    assert.match(automation.runs[0].userSafeSummary, /확인하지 못했/);
    assert.match(automation.runs[0].nextSafeAction, /다시 시도/);

    const userProjection = visibleText({ overview, automation });
    assert.doesNotMatch(userProjection, /\/Users\/|\/tmp\/|EACCES|run-internal|job-weekly|agent-weekly/iu);
  } finally {
    await close(server);
  }
});

test('W6: 스케줄러를 멈춘 뒤에는 남은 타이머가 다시 일을 시작하지 않는다', async () => {
  let ticks = 0;
  const scheduler = new AutomationScheduler({
    intervalMs: 5,
    onTick: async () => { ticks += 1; },
  });
  scheduler.start();
  const deadline = Date.now() + 250;
  while (ticks === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(ticks > 0, '시작한 스케줄러가 실제로 한 번은 돌아야 한다');
  scheduler.stop();
  const stoppedAt = ticks;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(ticks, stoppedAt, '종료 뒤 스케줄러 호출이 남아 있으면 안 된다');
});
