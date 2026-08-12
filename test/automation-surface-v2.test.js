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
import { makeServer } from '../src/surface/server.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { SessionStore } from '../src/surface/session-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';

function skill(id, state) {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id,
    name: id === 'skill-active' ? '주간 정산' : '문서 정리 추천',
    purpose: '사용자가 반복하는 문서 업무를 정리한다',
    version: 1,
    contentHash: '',
    inputs: [],
    steps: [{ kind: 'summarize', instruction: '문서를 읽고 짧게 정리한다' }],
    resultContract: { kind: 'summary' },
    requiredCapabilities: ['local.file'],
    authorityHints: [],
    replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] },
    state,
    createdAt: 1,
    updatedAt: 1,
    previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}

function profile() {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'agent-local-docs',
    name: '문서 정리 담당',
    purpose: '로컬 문서를 읽고 결과를 준비한다',
    modelRole: 'worker',
    toolAllowlist: ['local.file'],
    workspaceScope: ['/tmp'],
    defaultBudgets: {
      maxToolCalls: 4,
      timeoutMs: 30_000,
      maxCost: 1,
      maxConcurrency: 1,
    },
    authorityCeiling: 'A1',
    state: 'active',
    createdAt: 1,
    updatedAt: 1,
  };
}

function scheduledJob(id = 'job-weekly') {
  const proposed = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id,
    name: '금요일 정산 초안',
    skillRef: { id: 'skill-active', version: 1, contentHash: skill('skill-active', 'active').contentHash },
    trigger: {
      kind: 'weekly',
      timezone: 'Asia/Seoul',
      weekdays: [5],
      localTime: '17:00',
      nextRunAt: 10_000,
      misfirePolicy: 'catch_up_once',
    },
    agentProfileId: 'agent-local-docs',
    inputTemplate: { operation: 'read', path: '/tmp/weekly-source.txt' },
    authorityEnvelope: {
      ceiling: 'A1',
      allowedKinds: ['read'],
      allowedTools: ['local.file'],
      allowedTargets: [],
      workspaceRoots: ['/tmp'],
      expiresAt: null,
      maxRuns: 20,
      maxCost: 1,
      requiresFreshApprovalFor: [],
    },
    deliveryPolicy: { mode: 'none' },
    state: 'proposed',
    nextRunAt: 10_000,
    lastRunId: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const approved = transitionState('automationJob', proposed, 'approved', 2);
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const scheduled = transitionState('automationJob', approved.record, 'scheduled', 3);
  assert.equal(scheduled.ok, true, JSON.stringify(scheduled));
  return scheduled.record;
}

async function json(response, label) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label}: JSON 응답이 아님 (${response.status}) ${body.slice(0, 160)}`);
  }
}

const getj = async (base, path) => json(await fetch(`${base}${path}`), `GET ${path}`);
const postj = async (base, path, body) => json(await fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}), `POST ${path}`);

async function fixture(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac6-surface-'));
  const store = new SessionStore(dir);
  const skillStore = new SkillDefinitionStore(dir);
  const automationStore = new AutomationJobStore(dir);
  const agentProfileStore = new AgentProfileStore(dir);
  const automationRunLedger = options.runLedger ?? new AutomationRunLedger(dir);

  await skillStore.save({
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    skills: options.skills ?? [skill('skill-recommended', 'proposed'), skill('skill-active', 'active')],
  });
  await automationStore.save({
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    candidates: [],
    jobs: options.jobs ?? [scheduledJob()],
  });
  await agentProfileStore.save({
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    profiles: options.profiles ?? [profile()],
  });

  const model = options.model ?? {
    async respond() {
      return { text: '안녕하세요. 무엇을 도와드릴까요?', toolCalls: [] };
    },
  };
  const server = makeServer({
    store,
    skillStore,
    automationStore,
    agentProfileStore,
    automationRunLedger,
    env: demoEnv(),
    tools: demoTools(),
    model,
    modelTimeoutMs: 0,
    processEnv: { GPAO_T5_TCELL: 'off' },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    server,
    automationStore,
  };
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('AC-6: 추천 스킬과 활성 스킬은 같은 요약에서 섞이지 않는다', async () => {
  const ctx = await fixture();
  try {
    const overview = await getj(ctx.base, '/overview');
    assert.deepEqual(overview.skills.recommended.map((entry) => entry.label), ['문서 정리 추천']);
    assert.deepEqual(overview.skills.active.map((entry) => entry.label), ['주간 정산']);
  } finally {
    await close(ctx.server);
  }
});

test('AC-6: 스킬 replay, 승인, 활성화는 한 번의 우회 호출로 합쳐지지 않는다', async () => {
  const ctx = await fixture({ skills: [skill('skill-recommended', 'proposed')] });
  try {
    const approve = await fetch(`${ctx.base}/skills/skill-recommended/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    const activate = await fetch(`${ctx.base}/skills/skill-recommended/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(approve.status, 409, 'replay 증거와 명시 승인이 없으면 승인 불가');
    assert.equal(activate.status, 409, '승인되지 않은 추천은 활성화 불가');
    const view = await getj(ctx.base, '/skills');
    assert.equal(view.skills[0].state, 'proposed');
    assert.equal(view.skills[0].canInfluence, false);
  } finally {
    await close(ctx.server);
  }
});

test('AC-6: 한 화면에서 스킬, 자동화, 담당 에이전트의 현재 상태를 함께 볼 수 있다', async () => {
  const ctx = await fixture();
  try {
    const overview = await getj(ctx.base, '/overview');
    assert.ok(Array.isArray(overview.automations?.active), '자동화 상태가 통합 요약에 없음');
    assert.ok(Array.isArray(overview.agents?.active), '담당 에이전트 상태가 통합 요약에 없음');
    assert.deepEqual(overview.automations.active.map((entry) => entry.label), ['금요일 정산 초안']);
    assert.deepEqual(overview.agents.active.map((entry) => entry.label), ['문서 정리 담당']);
  } finally {
    await close(ctx.server);
  }
});

test('AC-6: 예약 자동화는 취소할 수 있고 취소 상태가 목록에 남는다', async () => {
  const ctx = await fixture();
  try {
    const result = await postj(ctx.base, '/automation/cancel', { jobId: 'job-weekly' });
    assert.deepEqual(result, { ok: true, state: 'cancelled' });
    const view = await getj(ctx.base, '/automation');
    assert.equal(view.jobs[0].state, 'cancelled');
  } finally {
    await close(ctx.server);
  }
});

test('AC-6: 예약 자동화는 삭제 없이 일시정지할 수 있다', async () => {
  const ctx = await fixture();
  try {
    const response = await fetch(`${ctx.base}/automation/pause`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: 'job-weekly' }),
    });
    const result = await json(response, 'POST /automation/pause');
    assert.equal(response.status, 200);
    assert.deepEqual(result, { ok: true, state: 'paused' });
    assert.equal((await getj(ctx.base, '/automation')).jobs[0].state, 'paused');
  } finally {
    await close(ctx.server);
  }
});

test('AC-6: 일시정지한 자동화는 같은 작업을 재생성하지 않고 재개할 수 있다', async () => {
  const paused = transitionState('automationJob', scheduledJob(), 'paused', 4);
  assert.equal(paused.ok, true, JSON.stringify(paused));
  const ctx = await fixture({ jobs: [paused.record] });
  try {
    const response = await fetch(`${ctx.base}/automation/resume`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: 'job-weekly' }),
    });
    const result = await json(response, 'POST /automation/resume');
    assert.equal(response.status, 200);
    assert.deepEqual(result, { ok: true, state: 'scheduled' });
    const view = await getj(ctx.base, '/automation');
    assert.equal(view.jobs.length, 1);
    assert.equal(view.jobs[0].id, 'job-weekly');
    assert.equal(view.jobs[0].state, 'scheduled');
  } finally {
    await close(ctx.server);
  }
});

test('AC-6: 실패한 실행은 사람말 사유와 다음 복구 행동을 함께 보여준다', async () => {
  const runLedger = {
    async append(run) { return run; },
    async load() {
      return {
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        runs: [{
          id: 'run-internal-7f8a',
          jobId: 'job-weekly',
          status: 'failed',
          scheduledFor: 9_000,
          finishedAt: 9_100,
          result: { error: 'EACCES: /Users/person/private/source.txt' },
        }],
      };
    },
  };
  const ctx = await fixture({ runLedger });
  try {
    const failed = (await getj(ctx.base, '/automation')).runs[0];
    assert.equal(failed.status, 'failed');
    assert.equal(typeof failed.userSafeSummary, 'string');
    assert.ok(failed.userSafeSummary.length > 0);
    assert.equal(typeof failed.nextSafeAction, 'string');
    assert.ok(failed.nextSafeAction.length > 0);
    const visible = `${failed.userSafeSummary}\n${failed.nextSafeAction}`;
    assert.doesNotMatch(visible, /run-internal|job-weekly|\/Users\/|EACCES|[0-9a-f]{8}-[0-9a-f-]{27,}/iu);
  } finally {
    await close(ctx.server);
  }
});

test('AC-6: 실패한 실행은 원래 작업을 잃지 않고 복구를 요청할 수 있다', async () => {
  const ctx = await fixture();
  try {
    const response = await fetch(`${ctx.base}/automation/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: 'job-weekly' }),
    });
    const result = await json(response, 'POST /automation/retry');
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.jobId, 'job-weekly');
    assert.ok(['scheduled', 'needs_review'].includes(result.state));
  } finally {
    await close(ctx.server);
  }
});

test('AC-6: 평범한 대화는 카드, 승인, 내부 신분, 원시 경로를 강요하지 않는다', async () => {
  const ctx = await fixture();
  try {
    const session = await postj(ctx.base, '/sessions');
    const result = await postj(ctx.base, '/turn', { sessionId: session.id, text: '안녕' });
    assert.equal(result.kind, 'reply');
    assert.equal(result.reply, '안녕하세요. 무엇을 도와드릴까요?');
    assert.equal(result.automationSuggestion == null, true);
    assert.equal(result.skillProposal == null, true);
    assert.equal(result.agentProposal == null, true);
    assert.equal(result.pendingId == null, true);
    assert.equal(result.approvalPreview == null, true);
    assert.doesNotMatch(result.reply, /skill-|job-|agent-|run-|\/Users\/|\/tmp\//u);
  } finally {
    await close(ctx.server);
  }
});
