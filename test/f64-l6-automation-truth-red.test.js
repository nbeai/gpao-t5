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

const FALSE_REPLY = '화요일 10시, 켜짐, 다음 실행도 잡혔어요.';
const FROZEN_NOW = 1_786_287_600_000; // 2026-08-10 00:00 Asia/Seoul
const MONDAY = Object.freeze({
  kind: 'weekly', timezone: 'Asia/Seoul', weekdays: [1], localTime: '09:30',
  nextRunAt: 1_786_321_800_000, misfirePolicy: 'catch_up_once',
});
const TUESDAY = Object.freeze({
  kind: 'weekly', timezone: 'Asia/Seoul', weekdays: [2], localTime: '10:00',
  nextRunAt: 1_786_410_000_000, misfirePolicy: 'catch_up_once',
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
    id, principalRef: 'local-owner', name: `${id} 주간 자료 확인`,
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
  return {
    ...makeGrowthCandidate({
    candidateId: id, statement,
    action: { tool: 'local.file', args: { action: 'read', path: '지난주정산.txt' } },
    dedupKey: id,
    }),
    principalRef: 'local-owner', revision: 1, current: true,
    operation: 'create', trigger: structuredClone(MONDAY),
    skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
    state: 'proposed', superseded: false, expiresAt: 2_000_000_000_000,
  };
}

async function startProduct({ model, jobs = [], candidates = [], space, preserveState = false }) {
  const x = space ?? await room();
  const store = new SessionStore(x.state);
  const automationStore = new AutomationJobStore(x.state);
  const runLedger = new AutomationRunLedger(x.state);
  const skillStore = new SkillDefinitionStore(x.state);
  const agentProfileStore = new AgentProfileStore(x.state);
  if (!preserveState) {
    await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill()] });
    await agentProfileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile(x.root)] });
    await automationStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates, jobs });
  }
  const server = makeServer({
    store, automationStore, automationRunLedger: runLedger, skillStore, agentProfileStore,
    clock: () => FROZEN_NOW,
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
    const target = tc.automationReality?.jobs?.items?.[0];
    const update = request.includes('같은 알림') && target;
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: request, kind: 'weekly', tool: 'local.file',
      operation: update ? 'update' : 'create',
      ...(update ? { targetJobRef: target.jobRef } : {}),
      trigger: update ? TUESDAY : (request.includes('화요일') ? TUESDAY : MONDAY),
      skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
    } }] };
  } };
}

test('L6 원본 동결 관측: 후보 셋·승인/job/run 0인 provider 거짓 표면을 제품 완료로 세지 않는다', async () => {
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
  assert.equal(observed.purposeMet, false, '승인하지 않은 후보는 제품 완료가 아니다');
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

test('L6 닫힘: 승인한 같은 job을 월09:30→화10:00로 바꾸고 id를 보존한다', async () => {
  const proposed = candidate('monday-candidate', '매주 월요일 오전 9시 반에 지난주 정산을 확인한다');
  const observed = await withProduct({ model: proposalModel(), candidates: [proposed] }, async (app) => {
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.candidateId, skillId: 'l6-skill', agentProfileId: 'l6-agent',
      trigger: MONDAY, expiresAt: 2_000_000_000_000, maxRuns: 20,
    });
    const jobId = approval.body.jobId;
    const changed = await app.turn('같은 알림을 매주 화요일 오전 10시로 바꿔줘.');
    const setup = await app.request('GET', `/automation/setup?candidateId=${changed.automationProposal?.candidateId}`);
    const update = await app.request('POST', '/automation/approve', {
      candidateId: changed.automationProposal?.candidateId,
      candidateRevision: setup.body.candidate?.revision,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
    });
    const state = await app.automationStore.load();
    return { jobId, changed, setup, update, state, runs: await app.runLedger.load() };
  });
  const target = observed.state.jobs.find((job) => job.id === observed.jobId);
  process.stdout.write(`${JSON.stringify({ probe: 'L6-modify-red', observed: {
    jobId: observed.jobId, jobCount: observed.state.jobs.length,
    candidateCount: observed.state.candidates.filter((entry) => !entry.approved).length,
    targetTrigger: target?.trigger, runs: observed.runs.runs.length,
  } })}\n`);
  assert.equal(observed.state.jobs.length, 1);
  assert.equal(observed.runs.runs.length, 0);
  assert.equal(observed.setup.status, 200);
  assert.equal(observed.update.status, 200, JSON.stringify(observed.update));
  assert.equal(observed.update.body.jobId, observed.jobId);
  assert.equal(target?.id, observed.jobId);
  assert.deepEqual(target?.trigger, TUESDAY);
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

test('L6 닫힘: 승인·수정 뒤 다음 /turn 모델 현실에 active/nextRun 실제값이 있다', async () => {
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
  assert.deepEqual([observed.hasJobId, observed.hasNextRunAt, observed.hasState], [true, true, true]);
});

test('원자 심사: 같은 create 후보를 동시에 두 번 승인해도 job은 정확히 하나다', async () => {
  const proposed = candidate('race-candidate', '매주 월요일 오전 9시 반에 지난주 정산을 확인한다');
  await withProduct({ model: proposalModel(), candidates: [proposed] }, async (app) => {
    const body = {
      candidateId: proposed.candidateId, candidateRevision: 1,
      skillId: 'l6-skill', agentProfileId: 'l6-agent', expiresAt: 2_000_000_000_000, maxRuns: 20,
    };
    const results = await Promise.all([
      app.request('POST', '/automation/approve', body),
      app.request('POST', '/automation/approve', body),
    ]);
    assert.deepEqual(results.map((entry) => entry.status).sort(), [200, 409]);
    const state = await app.automationStore.load();
    assert.equal(state.jobs.length, 1);
    assert.equal(state.candidates.filter((entry) => entry.approved).length, 1);
    assert.equal((await app.runLedger.load()).runs.length, 0);
  });
});

test('후보 계약: full trigger/action/purpose/delivery와 principal/revision/currentness를 보존하고 UI cursor는 무시한다', async () => {
  const model = { async respond(_tc, opts = {}) {
    if (!opts.tools?.length) return '후보를 준비했어요.';
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: '매주 월요일 오전 9시 반 정산 확인', operation: 'create',
      kind: 'weekly', tool: 'local.file', action: { args: { action: 'read', path: '지난주정산.txt' } },
      trigger: { ...MONDAY, nextRunAt: 123 },
      skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
    } }] };
  } };
  await withProduct({ model }, async (app) => {
    const result = await app.turn('매주 월요일 오전 9시 반 정산을 확인해줘');
    const stored = (await app.automationStore.load()).candidates
      .find((entry) => entry.candidateId === result.automationProposal.candidateId);
    assert.equal(stored.principalRef, 'local-owner');
    assert.deepEqual([stored.revision, stored.current, stored.operation], [1, true, 'create']);
    assert.deepEqual(stored.trigger, MONDAY, '제안에 실린 임의 nextRunAt 대신 runtime TriggerProvider가 계산한다');
    assert.deepEqual(stored.action, { tool: 'local.file', args: { action: 'read', path: '지난주정산.txt' } });
    assert.deepEqual([stored.skillPurpose, stored.deliveryIntent], ['지난주 정산 확인', 'none']);
    assert.match(stored.controlRef, /^[a-f0-9]{64}$/u);
    assert.equal(stored.expiresAt > FROZEN_NOW, true);
  });
});

test('stale/superseded: 먼저 본 update revision은 승인되지 않고 target job 영향 0', async () => {
  const x = await room();
  const target = scheduledJob('target-job', x.root);
  let calls = 0;
  const model = { async respond(tc, opts = {}) {
    if (!opts.tools?.length) return '후보를 준비했어요.';
    calls += 1;
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: `일정 변경 후보 ${calls}`, operation: 'update', targetJobRef: target.id,
      kind: 'weekly', tool: 'local.file', trigger: TUESDAY,
      skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
    } }] };
  } };
  await withProduct({ model, jobs: [target] }, async (app) => {
    const first = await app.turn('첫 번째 일정 변경 후보를 준비해줘.');
    const second = await app.turn('두 번째 일정 변경 후보를 준비해줘.');
    const stale = await app.request('POST', '/automation/approve', {
      candidateId: first.automationProposal.candidateId,
      candidateRevision: first.automationProposal.revision,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.reason, 'candidate_not_current');
    const state = await app.automationStore.load();
    assert.deepEqual(state.jobs.find((job) => job.id === target.id), target);
    assert.equal(state.candidates.find((entry) => entry.candidateId === second.automationProposal.candidateId)?.current, true);
  });
});

test('target race: update 후보 뒤 target pause가 먼저 서면 옛 revision 승인은 영향 0', async () => {
  const x = await room();
  const target = scheduledJob('target-job', x.root);
  await withProduct({ model: proposalModel(), jobs: [target] }, async (app) => {
    const proposed = await app.turn('같은 알림을 매주 화요일 오전 10시로 바꿔줘.');
    const pause = await app.request('POST', '/automation/pause', { jobId: target.id });
    assert.equal(pause.status, 200);
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.automationProposal.candidateId,
      candidateRevision: proposed.automationProposal.revision,
      controlRef: proposed.automationProposal.controlRef,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
    });
    assert.equal(approval.status, 409);
    assert.equal(approval.body.reason, 'target_revision_changed');
    const state = await app.automationStore.load();
    const saved = state.jobs.find((job) => job.id === target.id);
    assert.equal(saved.state, 'paused');
    assert.deepEqual(saved.trigger, MONDAY);
    assert.equal((await app.runLedger.load()).runs.length, 0);
  });
});

test('update 보존: trigger revision만 바뀌고 같은 principal의 다른 job과 기존 계약은 불변', async () => {
  const x = await room();
  const target = scheduledJob('target-job', x.root);
  const other = scheduledJob('other-job', x.root);
  await withProduct({ model: proposalModel(), jobs: [target, other] }, async (app) => {
    const proposed = await app.turn('같은 알림을 매주 화요일 오전 10시로 바꿔줘.');
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.automationProposal.candidateId,
      candidateRevision: proposed.automationProposal.revision,
      controlRef: proposed.automationProposal.controlRef,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
    });
    assert.equal(approval.status, 200, JSON.stringify(approval));
    const state = await app.automationStore.load();
    const changed = state.jobs.find((job) => job.id === target.id);
    const preserved = { ...changed, trigger: target.trigger, nextRunAt: target.nextRunAt, updatedAt: target.updatedAt };
    assert.deepEqual(preserved, target);
    assert.deepEqual(changed.trigger, TUESDAY);
    assert.deepEqual(state.jobs.find((job) => job.id === other.id), other);
    assert.equal(approval.body.settlement.storeReadback, true);
    assert.equal(approval.body.settlement.jobRef, target.id);
    assert.deepEqual(approval.body.settlement.trigger, TUESDAY);
  });
});

test('candidate 신분: control mismatch와 expiry는 원자 심사에서 job/effect 0', async () => {
  const current = candidate('control-candidate', '매주 월요일 오전 9시 반에 확인한다');
  const expired = { ...candidate('expired-candidate', '만료 후보'), expiresAt: FROZEN_NOW - 1 };
  await withProduct({ model: proposalModel(), candidates: [current, expired] }, async (app) => {
    const wrongControl = await app.request('POST', '/automation/approve', {
      candidateId: current.candidateId, candidateRevision: 1, controlRef: 'wrong',
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
    });
    const stale = await app.request('POST', '/automation/approve', {
      candidateId: expired.candidateId, candidateRevision: 1,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
    });
    assert.deepEqual([wrongControl.status, wrongControl.body.reason], [409, 'candidate_control_changed']);
    assert.deepEqual([stale.status, stale.body.reason], [409, 'candidate_not_current']);
    assert.equal((await app.automationStore.load()).jobs.length, 0);
    assert.equal((await app.runLedger.load()).runs.length, 0);
  });
});

test('재시작: canonical job readback은 같은 principal의 다음 모델 현실에 다시 공급된다', async () => {
  const x = await room();
  const capture = [];
  const active = scheduledJob('restart-job', x.root, TUESDAY);
  const first = await startProduct({ model: proposalModel(), jobs: [active], space: x });
  await new Promise((resolve) => first.server.close(resolve));
  const second = await startProduct({
    model: proposalModel({ capture }), space: x, preserveState: true,
  });
  try { await second.turn('재시작 뒤 자동화 상태를 알려줘'); }
  finally { await new Promise((resolve) => second.server.close(resolve)); }
  const context = capture.find((entry) => entry.currentRequest === '재시작 뒤 자동화 상태를 알려줘');
  const jobs = context?.automationReality?.jobs?.items ?? [];
  assert.equal(jobs.some((job) => job.jobRef === active.id && job.nextRunAt === TUESDAY.nextRunAt), true);
});

test('principal 경계: legacy job은 관리면에 남지만 다른 신분의 모델 현실로 승격되지 않는다', async () => {
  const x = await room();
  const legacy = scheduledJob('legacy-job', x.root);
  delete legacy.principalRef;
  const capture = [];
  await withProduct({ model: proposalModel({ capture }), jobs: [legacy] }, async (app) => {
    assert.equal((await app.request('GET', '/automation')).body.jobs.some((job) => job.id === legacy.id), true);
    await app.turn('자동화 상태를 알려줘');
  });
  const context = capture.find((entry) => entry.currentRequest === '자동화 상태를 알려줘');
  assert.equal(context.automationReality.jobs.items.some((job) => job.jobRef === legacy.id), false);
});

test('다중 대상: bounded reality는 opaque refs를 전부 주고 임의 current 하나를 만들지 않는다', async () => {
  const x = await room();
  const jobs = [scheduledJob('job-a', x.root), scheduledJob('job-b', x.root, TUESDAY)];
  const capture = [];
  await withProduct({ model: proposalModel({ capture }), jobs }, async (app) => {
    await app.turn('자동화 둘의 상태를 알려줘');
  });
  const reality = capture.find((entry) => entry.currentRequest === '자동화 둘의 상태를 알려줘')?.automationReality;
  assert.equal(reality.jobs.total, 2);
  assert.equal(reality.jobs.truncated, false);
  assert.deepEqual(reality.jobs.items.map((job) => job.jobRef).sort(), ['job-a', 'job-b']);
  assert.equal(Object.hasOwn(reality, 'currentJobRef'), false);
});

test('채널 동률: external channel 모델 입력도 웹과 같은 canonical AutomationReality를 본다', async () => {
  const x = await room();
  const capture = [];
  const active = scheduledJob('channel-job', x.root, TUESDAY);
  await withProduct({ model: proposalModel({ capture }), jobs: [active] }, async (app) => {
    const inbound = await app.request('POST', '/channel/inbound', {
      sessionId: (await app.request('POST', '/sessions')).body.id,
      channel: 'telegram', text: '자동화 상태를 알려줘', isMention: true,
    });
    assert.equal(inbound.status, 200);
  });
  const context = capture.find((entry) => entry.currentRequest === '자동화 상태를 알려줘');
  assert.equal(context?.automationReality?.jobs?.items?.some((job) => job.jobRef === active.id), true);
});

test('상태 결과: store readback과 다음 모델 현실에서 고른 active/nextRun이 사용자 결과까지 같다', async () => {
  const x = await room();
  const active = scheduledJob('status-job', x.root, TUESDAY);
  let selected = null;
  const model = { async respond(tc) {
    selected = tc.automationReality?.jobs?.items?.find((job) => job.jobRef === active.id) ?? null;
    return { text: JSON.stringify(selected), toolCalls: [] };
  } };
  await withProduct({ model, jobs: [active] }, async (app) => {
    const result = await app.turn('자동화의 현재 상태와 다음 실행을 알려줘');
    const surface = (await app.request('GET', '/automation')).body.jobs.find((job) => job.id === active.id);
    assert.equal(selected.state, surface.state);
    assert.equal(selected.nextRunAt, surface.nextRunAt);
    assert.equal(result.reply, JSON.stringify(selected), '모델이 store 현실에서 고른 결과가 그대로 사용자에게 간다');
  });
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
