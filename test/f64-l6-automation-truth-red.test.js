import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AUTOMATION_SCHEMA_VERSION,
  contentHash,
  skillHashSource,
  transitionState,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { makeGrowthCandidate } from '../src/kernel/l5-growth/automation.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';

const CLOSE = process.env.T5_F64_L6_CLOSE === '1';
const FALSE_REPLY = '화요일 10시, 켜짐, 다음 실행도 잡혔어요.';
const MONDAY = Object.freeze({
  kind: 'weekly', timezone: 'Asia/Seoul', weekdays: [1], localTime: '09:30',
  nextRunAt: 1_900_000_000_000, misfirePolicy: 'catch_up_once',
});
const TUESDAY = Object.freeze({
  kind: 'weekly', timezone: 'Asia/Seoul', weekdays: [2], localTime: '10:00',
  nextRunAt: 1_900_086_400_000, misfirePolicy: 'catch_up_once',
});

const sha = (value) => createHash('sha256').update(value).digest('hex');

async function room() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 't5-f64-l6-truth-')));
  return { root, state: join(root, '.state') };
}

function skill() {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'l6-skill', name: '주간 자료 확인', purpose: '로컬 자료를 정해진 때 확인한다',
    version: 1, contentHash: '', inputs: [],
    steps: [{ kind: 'read', instruction: '로컬 자료를 확인한다' }],
    resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file'],
    authorityHints: ['read'], replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] }, state: 'active',
    createdAt: 1, updatedAt: 1, previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}

function profile(root) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'l6-agent', name: '주간 확인 담당', purpose: '허용된 로컬 자료를 확인한다',
    modelRole: 'worker', toolAllowlist: ['local.file'], workspaceScope: [root],
    defaultBudgets: { maxToolCalls: 4, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A1', state: 'active', createdAt: 1, updatedAt: 1,
  };
}

function scheduledJob(id, root, trigger = MONDAY) {
  const activeSkill = skill();
  const proposed = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id, name: `${id} 주간 자료 확인`,
    skillRef: { id: activeSkill.id, version: activeSkill.version, contentHash: activeSkill.contentHash },
    trigger: structuredClone(trigger), agentProfileId: 'l6-agent', inputTemplate: {},
    authorityEnvelope: {
      ceiling: 'A1', allowedKinds: ['read'], allowedTools: ['local.file'], allowedTargets: [],
      workspaceRoots: [root], expiresAt: null, maxRuns: 20, maxCost: 1,
      requiresFreshApprovalFor: [],
    },
    deliveryPolicy: { mode: 'none' }, state: 'proposed', nextRunAt: trigger.nextRunAt,
    lastRunId: null, createdAt: 1, updatedAt: 1,
  };
  const approved = transitionState('automationJob', proposed, 'approved', 2);
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const scheduled = transitionState('automationJob', approved.record, 'scheduled', 3);
  assert.equal(scheduled.ok, true, JSON.stringify(scheduled));
  return scheduled.record;
}

function candidate(id, statement) {
  return makeGrowthCandidate({
    candidateId: id, statement,
    action: { tool: 'local.file', args: { action: 'read', path: '지난주정산.txt' } },
    dedupKey: id,
  });
}

async function startProduct({ model, jobs = [], candidates = [] }) {
  const x = await room();
  const store = new SessionStore(x.state);
  const automationStore = new AutomationJobStore(x.state);
  const runLedger = new AutomationRunLedger(x.state);
  const skillStore = new SkillDefinitionStore(x.state);
  const agentProfileStore = new AgentProfileStore(x.state);
  await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill()] });
  await agentProfileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile(x.root)] });
  await automationStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates, jobs });
  const server = makeServer({
    store, automationStore, automationRunLedger: runLedger, skillStore, agentProfileStore,
    model, env: demoEnv(),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [x.root], dataDir: x.state, homeDir: x.root }) }),
    processEnv: { HOME: x.root, GPAO_T5_HOME: x.root, GPAO_T5_DATA_DIR: x.state, GPAO_T5_FILE_ROOTS: x.root },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const request = (method, path, body) => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
  const turn = (text) => request('POST', '/turn', { sessionId: session.id, text }).then(({ body }) => body);
  return { ...x, base, server, store, automationStore, runLedger, request, turn };
}

async function withProduct(options, task) {
  const app = await startProduct(options);
  try { return await task(app); }
  finally { await new Promise((resolve) => app.server.close(resolve)); }
}

function proposalModel({ finalReply = FALSE_REPLY, capture = [] } = {}) {
  return { async respond(tc, opts = {}) {
    capture.push(structuredClone(tc));
    const request = String(tc.currentRequest ?? '');
    if (!opts.tools?.length) return request === '최종 상태를 알려줘' ? finalReply : '처리했어요.';
    if (request === '최종 상태를 알려줘') return { text: finalReply, toolCalls: [] };
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: request, kind: 'weekly', tool: 'local.file',
    } }] };
  } };
}

test('L6 원본 선빨강: 후보 셋·카드/승인/job/run 0인데 활성·다음 실행 완료를 말한다', async () => {
  const observed = await withProduct({ model: proposalModel() }, async (app) => {
    const turns = [];
    turns.push(await app.turn('매주 월요일 오전 9시 반에 지난주 정산을 확인하라고 알려줘.'));
    turns.push(await app.turn('매주 월요일 오전 9시 반 알림 후보를 다시 준비해줘.'));
    turns.push(await app.turn('매주 화요일 오전 10시에 지난주 정산을 확인하라고 바꿔줘.'));
    const setups = await Promise.all(turns.map((turn) => app.request(
      'GET', `/automation/setup?candidateId=${turn.automationProposal?.candidateId ?? 'missing'}`,
    )));
    const final = await app.turn('최종 상태를 알려줘');
    const state = await app.automationStore.load();
    const runs = await app.runLedger.load();
    return {
      candidates: state.candidates.length,
      cards: turns.filter((turn) => turn.kind === 'approval' && Array.isArray(turn.pending)).length,
      approved: state.candidates.filter((entry) => entry.approved).length,
      jobs: state.jobs.length,
      runs: runs.runs.length,
      surfaceCandidates: turns.filter((turn) => turn.automationProposal?.candidateId).length,
      actionableSetups: setups.filter((setup) => setup.status === 200).length,
      reply: final.reply,
      purposeMet: state.jobs.some((job) => job.state === 'scheduled' && job.nextRunAt === TUESDAY.nextRunAt),
    };
  });
  process.stdout.write(`${JSON.stringify({ probe: 'L6-original-red', observed })}\n`);
  assert.deepEqual(
    [observed.candidates, observed.cards, observed.approved, observed.jobs, observed.runs],
    [3, 0, 0, 0, 0],
  );
  assert.equal(observed.surfaceCandidates, 3, '모델 제안은 후보 표면까지만 닿는다');
  assert.equal(observed.actionableSetups, 3, 'candidateId는 실제 setup으로 이어지는 신분이다');
  assert.equal(observed.reply, FALSE_REPLY, '동결 provider가 낸 거짓 완료 표면');
  assert.equal(observed.purposeMet, CLOSE ? true : false);
});

test('정상 경계: setup→approve는 정확히 한 job을 만들고 승인 전 effect0·예정 전 run0·다른 job 불변', async () => {
  const x = await room();
  const other = scheduledJob('other-job', x.root);
  const proposed = candidate('monday-candidate', '매주 월요일 오전 9시 반에 지난주 정산을 확인한다');
  const observed = await withProduct({
    model: proposalModel(), jobs: [other], candidates: [proposed],
  }, async (app) => {
    const before = await app.automationStore.load();
    const beforeRuns = await app.runLedger.load();
    const setup = await app.request('GET', `/automation/setup?candidateId=${proposed.candidateId}`);
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.candidateId, skillId: 'l6-skill', agentProfileId: 'l6-agent',
      trigger: MONDAY, expiresAt: 2_000_000_000_000, maxRuns: 20,
    });
    const after = await app.automationStore.load();
    const afterRuns = await app.runLedger.load();
    return { before, beforeRuns, setup, approval, after, afterRuns };
  });
  assert.deepEqual([observed.before.jobs.length, observed.beforeRuns.runs.length], [1, 0]);
  assert.equal(observed.setup.status, 200);
  assert.equal(observed.approval.status, 200, JSON.stringify(observed.approval));
  assert.equal(observed.after.jobs.length, 2);
  assert.equal(observed.afterRuns.runs.length, 0);
  const created = observed.after.jobs.find((job) => job.id === observed.approval.body.jobId);
  assert.deepEqual(created?.trigger, MONDAY);
  assert.deepEqual(observed.after.jobs.find((job) => job.id === 'other-job'), observed.before.jobs[0]);
});

test('L6 선빨강: 승인한 같은 job의 월09:30→화10:00 수정 경로가 없고 새 후보로 갈라진다', async () => {
  const proposed = candidate('monday-candidate', '매주 월요일 오전 9시 반에 지난주 정산을 확인한다');
  const observed = await withProduct({ model: proposalModel(), candidates: [proposed] }, async (app) => {
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.candidateId, skillId: 'l6-skill', agentProfileId: 'l6-agent',
      trigger: MONDAY, expiresAt: 2_000_000_000_000, maxRuns: 20,
    });
    const jobId = approval.body.jobId;
    const changed = await app.turn('같은 알림을 매주 화요일 오전 10시로 바꿔줘.');
    const state = await app.automationStore.load();
    return { jobId, changed, state, runs: await app.runLedger.load() };
  });
  const target = observed.state.jobs.find((job) => job.id === observed.jobId);
  process.stdout.write(`${JSON.stringify({ probe: 'L6-modify-red', observed: {
    jobId: observed.jobId, jobCount: observed.state.jobs.length,
    candidateCount: observed.state.candidates.filter((entry) => !entry.approved).length,
    targetTrigger: target?.trigger, runs: observed.runs.runs.length,
  } })}\n`);
  assert.equal(observed.state.jobs.length, 1);
  assert.equal(observed.runs.runs.length, 0);
  assert.equal(target?.id, observed.jobId);
  assert.deepEqual(target?.trigger, CLOSE ? TUESDAY : MONDAY);
});

test('정상 경계: pause/resume은 삭제·재생성 없이 같은 id를 보존하고 다른 job은 불변', async () => {
  const x = await room();
  const target = scheduledJob('target-job', x.root);
  const other = scheduledJob('other-job', x.root);
  await withProduct({ model: proposalModel(), jobs: [target, other] }, async (app) => {
    const paused = await app.request('POST', '/automation/pause', { jobId: target.id });
    const afterPause = await app.automationStore.load();
    const resumed = await app.request('POST', '/automation/resume', { jobId: target.id });
    const afterResume = await app.automationStore.load();
    assert.deepEqual([paused.status, paused.body.state, resumed.status, resumed.body.state], [200, 'paused', 200, 'scheduled']);
    assert.deepEqual(afterPause.jobs.map((job) => job.id).sort(), ['other-job', 'target-job']);
    assert.equal(afterPause.jobs.find((job) => job.id === target.id)?.state, 'paused');
    assert.equal(afterResume.jobs.find((job) => job.id === target.id)?.state, 'scheduled');
    assert.deepEqual(afterResume.jobs.find((job) => job.id === other.id), other);
    assert.equal((await app.runLedger.load()).runs.length, 0);
  });
});

test('L6 선빨강: 승인·수정 뒤 다음 /turn 모델 현실에 active/nextRun 실제값이 없다', async () => {
  const x = await room();
  const active = scheduledJob('target-job', x.root, TUESDAY);
  const capture = [];
  await withProduct({ model: proposalModel({ finalReply: '현재 상태를 확인했어요.', capture }), jobs: [active] }, async (app) => {
    await app.turn('최종 상태를 알려줘');
  });
  const modelReality = capture.find((context) => context.currentRequest === '최종 상태를 알려줘');
  const serialized = JSON.stringify(modelReality);
  const observed = {
    hasJobId: serialized.includes(active.id),
    hasNextRunAt: serialized.includes(String(TUESDAY.nextRunAt)),
    hasState: serialized.includes('scheduled'),
    contextSha256: sha(serialized),
  };
  process.stdout.write(`${JSON.stringify({ probe: 'L6-reality-red', observed })}\n`);
  assert.deepEqual(
    [observed.hasJobId, observed.hasNextRunAt, observed.hasState],
    CLOSE ? [true, true, true] : [false, false, false],
  );
});

test('반대조건: 없는 id 변경은 404이고 기존 job·run 원장을 바꾸지 않는다', async () => {
  const x = await room();
  const active = scheduledJob('target-job', x.root);
  await withProduct({ model: proposalModel(), jobs: [active] }, async (app) => {
    const before = await app.automationStore.load();
    const response = await app.request('POST', '/automation/pause', { jobId: 'unknown-job' });
    const after = await app.automationStore.load();
    assert.equal(response.status, 404);
    assert.deepEqual(after, before);
    assert.equal((await app.runLedger.load()).runs.length, 0);
  });
});
