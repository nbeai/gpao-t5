import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
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
import { prepareAutomationRuns } from '../src/runtime/automation-engine.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { sealAutomationSettlement } from '../src/surface/automation-settlement.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { projectAutomationReality } from '../src/surface/automation-surface.js';
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
    trigger: structuredClone(trigger), agentProfileId: 'l6-agent',
    inputTemplate: { action: 'read', path: '지난주정산.txt' },
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

async function startProduct({ model, jobs = [], candidates = [], space, preserveState = false,
  clock = () => FROZEN_NOW }) {
  const x = space ?? await room();
  const store = new SessionStore(x.state);
  const automationStore = new AutomationJobStore(x.state);
  const runLedger = new AutomationRunLedger(x.state);
  const skillStore = new SkillDefinitionStore(x.state);
  const agentProfileStore = new AgentProfileStore(x.state);
  if (!preserveState) {
    await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill()] });
    await agentProfileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile(x.root)] });
    const seededCandidates = [...candidates];
    const settlements = [];
    const storedJobs = jobs.map((job, index) => {
      if (!job.principalRef) return job;
      const candidateRef = `fixture-candidate-${index}`;
      const controlRef = `fixture-control-${index}`;
      const settlement = sealAutomationSettlement({
        kind: 'automation_settlement', operation: 'create', principalRef: job.principalRef,
        candidateRef, candidateRevision: 2, controlRef, jobRef: job.id,
        jobRevision: job.jobRevision ?? 0, state: job.state,
        trigger: structuredClone(job.trigger), nextRunAt: job.nextRunAt,
        observedAt: job.updatedAt, tool: 'local.file',
        actionArgs: structuredClone(job.inputTemplate), skillPurpose: '지난주 정산 확인',
        deliveryIntent: job.deliveryPolicy?.mode === 'chat' ? 'chat' : 'none',
        skillRef: structuredClone(job.skillRef), agentProfileId: job.agentProfileId,
        authorityEnvelope: structuredClone(job.authorityEnvelope),
        deliveryPolicy: structuredClone(job.deliveryPolicy), verificationPassed: true,
      });
      settlements.push(settlement);
      seededCandidates.push({
        candidateId: candidateRef, principalRef: job.principalRef, revision: 2,
        controlRef, approved: true, current: false, operation: 'create',
        jobRef: job.id, settlementRef: settlement.settlementRef,
        settlementDigest: settlement.settlementDigest,
      });
      return Object.assign(job, {
        candidateLineage: { candidateRef, candidateRevision: 2, controlRef },
        settlementRef: settlement.settlementRef,
        settlementDigest: settlement.settlementDigest,
        latestSettlementRef: settlement.settlementRef,
        latestSettlementDigest: settlement.settlementDigest,
      });
    });
    await automationStore.save({
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      candidates: seededCandidates, jobs: storedJobs, settlements,
    });
  }
  const server = makeServer({
    store, automationStore, automationRunLedger: runLedger, skillStore, agentProfileStore,
    clock,
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
  return {
    ...x, base, server, store, automationStore, runLedger, skillStore, agentProfileStore, request, turn,
  };
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
    const realityReply = () => {
      const candidates = tc.automationReality?.candidates;
      const jobs = tc.automationReality?.jobs;
      if (candidates?.observed !== false && jobs?.observed !== false
        && Number.isInteger(candidates?.total) && Number.isInteger(jobs?.total)) {
        return `승인 전 후보 ${candidates.total}개가 있고, 켜진 자동화는 ${jobs.total}개예요.`;
      }
      return finalReply;
    };
    if (!opts.tools?.length) return request === '최종 상태를 알려줘' ? realityReply() : '처리했어요.';
    if (request === '최종 상태를 알려줘') return { text: realityReply(), toolCalls: [] };
    const target = tc.automationReality?.jobs?.items?.[0];
    const update = request.includes('같은 알림') && target;
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: request, kind: 'weekly', tool: 'local.file',
      action: { args: { action: 'read', path: '지난주정산.txt' } },
      operation: update ? 'update' : 'create',
      ...(update ? { targetJobRef: target.jobRef } : {}),
      trigger: update ? TUESDAY : (request.includes('화요일') ? TUESDAY : MONDAY),
      skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
    } }] };
  } };
}

test('L6 원본 동결 관측: 후보 셋·승인/job/run 0의 canonical 현실이 종료 답과 일치한다', async () => {
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
  assert.equal(observed.reply, '승인 전 후보 3개가 있고, 켜진 자동화는 0개예요.',
    '같은 provider가 canonical candidate/job 현실을 보고 원본 종료문장을 바꾼다');
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
    assert.equal(afterPause.jobs.find((job) => job.id === target.id)?.jobRevision, 1);
    assert.equal(afterResume.jobs.find((job) => job.id === target.id)?.state, 'scheduled');
    assert.equal(afterResume.jobs.find((job) => job.id === target.id)?.jobRevision, 2);
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
      action: { args: { action: 'read', path: '지난주정산.txt' } },
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
    const staleSetup = await app.request('GET', `/automation/setup?candidateId=${first.automationProposal.candidateId}`);
    const visible = await app.request('GET', '/automation');
    assert.equal(staleSetup.status, 404);
    assert.equal(visible.body.candidates.some((entry) => entry.candidateId === first.automationProposal.candidateId), false);
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
    const {
      jobRevision, candidateLineage, settlementRef, settlementDigest,
      latestSettlementRef, latestSettlementDigest, ...changedContract
    } = changed;
    const {
      candidateLineage: initialLineage,
      settlementRef: initialSettlementRef,
      settlementDigest: initialSettlementDigest,
      latestSettlementRef: initialLatestRef,
      latestSettlementDigest: initialLatestDigest,
      ...targetContract
    } = target;
    const preserved = { ...changedContract, trigger: target.trigger, nextRunAt: target.nextRunAt, updatedAt: target.updatedAt };
    assert.deepEqual(preserved, targetContract);
    assert.deepEqual(candidateLineage, initialLineage);
    assert.equal(settlementRef, initialSettlementRef);
    assert.equal(settlementDigest, initialSettlementDigest);
    assert.notEqual(latestSettlementRef, initialLatestRef);
    assert.notEqual(latestSettlementDigest, initialLatestDigest);
    assert.equal(jobRevision, 1);
    const updateSettlement = state.settlements.find(
      (entry) => entry.settlementRef === latestSettlementRef,
    );
    assert.equal(updateSettlement.candidateRef, proposed.automationProposal.candidateId);
    assert.match(settlementRef, /^[a-f0-9]{64}$/u);
    assert.match(settlementDigest, /^[a-f0-9]{64}$/u);
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

test('P0 실제 스키마 경로: 자연 제안은 final 전 입장·readback reality를 보고 승인 뒤 job1로 이어진다', async () => {
  const seenSchemas = [];
  const honestReply = '월요일 오전 9시 반 후보를 준비했어요. 아직 승인 전이에요.';
  const model = { async respond(tc, opts = {}) {
    const proposalSchema = opts.tools?.find((entry) => entry.name === 'automation.propose');
    if (proposalSchema) {
      seenSchemas.push(structuredClone(proposalSchema));
      return { text: '', toolCalls: [{ name: 'automation.propose', args: {
        statement: '매주 월요일 오전 9시 반에 지난주 정산 확인',
        operation: 'create', kind: 'weekly', trigger: MONDAY,
        tool: 'local.file', action: { args: { action: 'read', path: '지난주정산.txt' } },
        skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
      } }] };
    }
    const admitted = tc.automationProposal?.candidateId;
    const observed = tc.automationReality?.candidates?.items?.some((entry) => entry.candidateRef === admitted);
    return admitted && observed ? honestReply : FALSE_REPLY;
  } };
  await withProduct({ model }, async (app) => {
    const result = await app.turn('매주 월요일 오전 9시 반에 지난주 정산을 확인해줘.');
    const required = seenSchemas[0]?.parameters?.required ?? [];
    assert.deepEqual(required.slice().sort(), [
      'action', 'deliveryIntent', 'operation', 'skillPurpose', 'statement', 'tool', 'trigger',
    ].sort(), '승인 준비에 필요한 구조가 실제 provider schema의 필수 계약이어야 한다');
    assert.equal(result.reply, honestReply, '같은 모델이 입장·readback 현실을 본 뒤 후보 상태로 답한다');
    const candidateId = result.automationProposal?.candidateId;
    const stored = (await app.automationStore.load()).candidates.find((entry) => entry.candidateId === candidateId);
    assert.deepEqual(stored?.action, { tool: 'local.file', args: { action: 'read', path: '지난주정산.txt' } });
    const setup = await app.request('GET', `/automation/setup?candidateId=${candidateId}`);
    assert.equal(setup.status, 200);
    const approval = await app.request('POST', '/automation/approve', {
      candidateId, candidateRevision: result.automationProposal.revision,
      controlRef: result.automationProposal.controlRef,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
      expiresAt: 2_000_000_000_000, maxRuns: 20,
    });
    assert.equal(approval.status, 200, JSON.stringify(approval));
    assert.equal((await app.automationStore.load()).jobs.length, 1);
  });
});

test('P0 입장 경계: action args가 없는 draft는 current setup·job이 되지 않는다', async () => {
  const model = { async respond(_tc, opts = {}) {
    if (!opts.tools?.length) return '확인할 후보가 아직 없어요.';
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: '매주 월요일 오전 9시 반 정산 확인', operation: 'create',
      kind: 'weekly', trigger: MONDAY, tool: 'local.file',
      skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
    } }] };
  } };
  await withProduct({ model }, async (app) => {
    const result = await app.turn('매주 월요일 오전 9시 반 정산 확인 후보를 준비해줘.');
    const state = await app.automationStore.load();
    assert.equal(state.candidates.filter((entry) => entry.current !== false).length, 0);
    assert.equal(state.jobs.length, 0);
    const setup = await app.request('GET', `/automation/setup?candidateId=${result.automationProposal?.candidateId ?? 'missing'}`);
    assert.equal(setup.status, 404);
  });
});

test('P0 민감 경계: 모델 제안의 비밀은 durable 후보와 final reality에 들어가지 않는다', async () => {
  const secret = 'api_key=Abcd1234SecretValue';
  const finalContexts = [];
  const model = { async respond(tc, opts = {}) {
    if (!opts.tools?.length) {
      finalContexts.push(structuredClone(tc));
      return '민감한 값이 있어 후보로 저장하지 않았어요.';
    }
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: '매주 월요일 오전 9시 반 정산 확인', operation: 'create',
      kind: 'weekly', trigger: MONDAY, tool: 'local.file',
      action: { args: { action: 'read', path: '지난주정산.txt', token: secret } },
      skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
    } }] };
  } };
  await withProduct({ model }, async (app) => {
    const result = await app.turn('정산 확인 자동화 후보를 준비해줘.');
    const state = await app.automationStore.load();
    assert.equal(state.candidates.length, 0);
    assert.equal(state.jobs.length, 0);
    assert.deepEqual(result.automationProposal, { rejected: true, reason: 'sensitive_input' });
    assert.equal(JSON.stringify(finalContexts).includes(secret), false);
    assert.equal(JSON.stringify(await app.request('GET', '/automation')).includes(secret), false);
  });
});

test('재감사 민감 경계: 후보의 모든 durable field는 비밀이면 입장·표면·setup 0이다', async () => {
  const secret = 'api_key=Abcd1234SecretValue';
  const variants = {
    skillPurpose: (args) => { args.skillPurpose = secret; },
    tool: (args) => { args.tool = secret; },
    timezone: (args) => { args.trigger.timezone = secret; },
    localTime: (args) => { args.trigger.localTime = secret; },
    delivery: (args) => { args.deliveryIntent = secret; },
  };
  for (const [variant, mutate] of Object.entries(variants)) {
    const finalContexts = [];
    const model = { async respond(tc, opts = {}) {
      if (!opts.tools?.length) {
        finalContexts.push(structuredClone(tc));
        return '후보로 입장시키지 않았어요.';
      }
      const args = {
        statement: '매주 월요일 오전 9시 반 정산 확인', operation: 'create',
        kind: 'weekly', trigger: structuredClone(MONDAY), tool: 'local.file',
        action: { args: { action: 'read', path: '지난주정산.txt' } },
        skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
      };
      mutate(args);
      return { text: '', toolCalls: [{ name: 'automation.propose', args }] };
    } };
    await withProduct({ model }, async (app) => {
      const result = await app.turn(`민감 후보 ${variant}`);
      const state = await app.automationStore.load();
      const surface = await app.request('GET', '/automation');
      const setup = await app.request('GET', '/automation/setup?candidateId=missing');
      assert.equal(state.candidates.length, 0, variant);
      assert.equal(state.jobs.length, 0, variant);
      assert.deepEqual(result.automationProposal, { rejected: true, reason: 'sensitive_input' }, variant);
      assert.equal(JSON.stringify(finalContexts).includes(secret), false, variant);
      assert.equal(JSON.stringify(surface).includes(secret), false, variant);
      assert.equal(setup.status, 404, variant);
      assert.equal(JSON.stringify(setup).includes(secret), false, variant);
    });
  }
});

test('재감사 민감 경계: legacy candidate/job의 비표시 durable field도 web·provider에 0이다', async () => {
  const x = await room();
  const secret = 'password=Abcd1234SecretValue';
  const hiddenCandidate = { ...candidate('legacy-secret-candidate', '주간 자료 확인'), skillPurpose: secret };
  const hiddenJob = { ...scheduledJob('legacy-secret-job', x.root), inputTemplate: { token: secret } };
  const capture = [];
  const model = { async respond(tc) { capture.push(structuredClone(tc)); return '상태를 확인했어요.'; } };
  await withProduct({
    model, candidates: [hiddenCandidate], jobs: [hiddenJob], space: x,
  }, async (app) => {
    await app.turn('자동화 상태를 알려줘');
    const surface = await app.request('GET', '/automation');
    assert.equal(surface.body.candidates.length, 0);
    assert.equal(surface.body.jobs.some((entry) => entry.id === hiddenJob.id), false);
    assert.equal(JSON.stringify(surface).includes(secret), false);
  });
  assert.equal(JSON.stringify(capture).includes(secret), false);
});

test('P0 민감·principal 경계: legacy 비밀 이름은 표면/모델에서 빠지고 null principal은 unknown이다', async () => {
  const x = await room();
  const secret = 'password=Abcd1234SecretValue';
  const legacy = { ...scheduledJob('secret-job', x.root), name: secret };
  const capture = [];
  await withProduct({ model: proposalModel({ capture }), jobs: [legacy] }, async (app) => {
    await app.turn('자동화 상태를 알려줘');
    const surface = await app.request('GET', '/automation');
    assert.equal(JSON.stringify(surface).includes(secret), false);
  });
  assert.equal(JSON.stringify(capture).includes(secret), false);
  const unknown = projectAutomationReality({ jobs: [legacy] }, { principalRef: null, now: FROZEN_NOW });
  assert.deepEqual([unknown.principalBound, unknown.availability, unknown.jobs.observed], [false, 'unknown', false]);
  assert.equal(unknown.jobs.items.length, 0);
});

test('lineage settlement: candidate→job digest 신분이 store readback·web·model·channel에 같다', async () => {
  const proposed = candidate('lineage-candidate', '매주 월요일 오전 9시 반 정산 확인');
  const capture = [];
  await withProduct({ model: proposalModel({ capture }), candidates: [proposed] }, async (app) => {
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.candidateId, candidateRevision: 1,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
      expiresAt: 2_000_000_000_000, maxRuns: 20,
    });
    assert.equal(approval.status, 200, JSON.stringify(approval));
    const stored = (await app.automationStore.load()).jobs[0];
    const settlement = approval.body.settlement;
    assert.equal(stored.jobRevision, 1);
    assert.deepEqual(stored.candidateLineage, {
      candidateRef: proposed.candidateId,
      candidateRevision: 2,
    });
    assert.match(stored.settlementRef, /^[a-f0-9]{64}$/u);
    assert.match(stored.settlementDigest, /^[a-f0-9]{64}$/u);
    assert.deepEqual([settlement.settlementRef, settlement.settlementDigest],
      [stored.settlementRef, stored.settlementDigest]);
    const surfaceJob = (await app.request('GET', '/automation')).body.jobs[0];
    assert.ok(surfaceJob, 'verified canonical job must remain visible');
    assert.deepEqual([surfaceJob.settlementRef, surfaceJob.jobRevision], [stored.settlementRef, 1]);
    await app.turn('최종 상태를 알려줘');
    const webReality = capture.at(-1).automationReality.jobs.items
      .find((entry) => entry.jobRef === stored.id);
    assert.deepEqual([webReality.settlementRef, webReality.jobRevision], [stored.settlementRef, 1]);
    const inboundSession = (await app.request('POST', '/sessions')).body.id;
    await app.request('POST', '/channel/inbound', {
      sessionId: inboundSession, channel: 'telegram', text: '자동화 상태를 알려줘', isMention: true,
    });
    const channelReality = capture.at(-1).automationReality.jobs.items
      .find((entry) => entry.jobRef === stored.id);
    assert.equal(channelReality.settlementRef, stored.settlementRef);
  });
});

test('재감사 settlement: 본문·candidate/job linkage 손상은 restart에서 unknown이고 모델 입장 0이다', async () => {
  for (const variant of ['body', 'job-link']) {
    const x = await room();
    const proposed = candidate(`tamper-${variant}`, '매주 월요일 오전 9시 반 정산 확인');
    const first = await startProduct({ model: proposalModel(), candidates: [proposed], space: x });
    try {
      const approval = await first.request('POST', '/automation/approve', {
        candidateId: proposed.candidateId, candidateRevision: 1,
        skillId: 'l6-skill', agentProfileId: 'l6-agent',
        expiresAt: 2_000_000_000_000, maxRuns: 20,
      });
      assert.equal(approval.status, 200, JSON.stringify(approval));
    } finally { await new Promise((resolve) => first.server.close(resolve)); }
    const raw = JSON.parse(await readFile(first.automationStore.file, 'utf8'));
    if (variant === 'body') raw.settlements[0].state = 'paused';
    else raw.jobs[0].settlementRef = '0'.repeat(64);
    await writeFile(first.automationStore.file, JSON.stringify(raw), 'utf8');

    const capture = [];
    const restarted = await startProduct({
      model: proposalModel({ capture }), space: x, preserveState: true,
    });
    try {
      const loaded = await restarted.automationStore.load();
      const result = await restarted.turn('자동화 상태를 알려줘');
      assert.ok(loaded.recovery, variant);
      assert.deepEqual(result.automationProposal, {
        rejected: true, reason: 'automation_reality_unknown',
      }, variant);
      assert.equal(capture.at(-1).automationReality.availability, 'unknown', variant);
      assert.equal(capture.at(-1).automationReality.jobs.items.length, 0, variant);
    } finally { await new Promise((resolve) => restarted.server.close(resolve)); }
  }
});

test('재감사 settlement write: digest·linkage 불일치는 저장 전 거절되고 기존 원본은 불변이다', async () => {
  const proposed = candidate('write-validation', '매주 월요일 오전 9시 반 정산 확인');
  await withProduct({ model: proposalModel(), candidates: [proposed] }, async (app) => {
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.candidateId, candidateRevision: 1,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
      expiresAt: 2_000_000_000_000, maxRuns: 20,
    });
    assert.equal(approval.status, 200, JSON.stringify(approval));
    const valid = await app.automationStore.load();
    for (const variant of ['digest', 'linkage', 'principal', 'revision', 'state', 'job']) {
      const invalid = structuredClone(valid);
      if (variant === 'digest') invalid.settlements[0].state = 'paused';
      else if (variant === 'linkage') invalid.jobs[0].settlementRef = '0'.repeat(64);
      else {
        const body = structuredClone(valid.settlements[0]);
        delete body.settlementRef;
        delete body.settlementDigest;
        if (variant === 'principal') body.principalRef = 'forged-principal';
        if (variant === 'revision') body.candidateRevision += 1;
        if (variant === 'state') body.state = 'paused';
        if (variant === 'job') body.jobRef = 'forged-job';
        invalid.settlements.push(sealAutomationSettlement(body));
      }
      await assert.rejects(() => app.automationStore.save(invalid), /settlement/u, variant);
      assert.deepEqual(await app.automationStore.load(), valid, variant);
    }
  });
});

test('delivery intent: 실제 local conversation consumer가 없는 chat 후보는 승인되지 않는다', async () => {
  const proposed = { ...candidate('chat-candidate', '매주 월요일 오전 9시 반 정산 확인'), deliveryIntent: 'chat' };
  await withProduct({ model: proposalModel(), candidates: [proposed] }, async (app) => {
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.candidateId, candidateRevision: 1,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
      expiresAt: 2_000_000_000_000, maxRuns: 20,
    });
    assert.equal(approval.status, 422, JSON.stringify(approval));
    assert.equal(approval.body.reason, 'delivery_not_connected');
    const state = await app.automationStore.load();
    assert.equal(state.jobs.length, 0);
    assert.equal(state.candidates[0].approved, false);
    assert.equal((await app.runLedger.load()).runs.length, 0);
  });
});

test('delivery intent actual /turn: 자연 chat 제안은 admission rejected·setup0·job0이다', async () => {
  const model = { async respond(_tc, opts = {}) {
    if (opts.tools?.some((entry) => entry.name === 'automation.propose')) {
      return { text: '', toolCalls: [{ name: 'automation.propose', args: {
        statement: '매주 월요일 정산 결과를 이 대화로 알린다', operation: 'create',
        kind: 'weekly', trigger: MONDAY, tool: 'local.file',
        action: { args: { action: 'read', path: '지난주정산.txt' } },
        skillPurpose: '지난주 정산 확인', deliveryIntent: 'chat',
      } }] };
    }
    return '전달 연결이 없어 후보로 확정하지 않았어요.';
  } };
  await withProduct({ model }, async (app) => {
    const result = await app.turn('매주 월요일 정산 결과를 이 대화로 알려줘');
    assert.deepEqual(result.automationProposal, { rejected: true, reason: 'delivery_not_connected' });
    const setup = await app.request('GET', '/automation/setup?candidateId=missing');
    const state = await app.automationStore.load();
    assert.equal(setup.status, 404);
    assert.equal(state.candidates.length, 0);
    assert.equal(state.jobs.length, 0);
  });
});

test('authority maxRuns: durable reserved run 한도 뒤 다음 occurrence는 실행0·job expired다', async () => {
  const x = await room();
  let now = FROZEN_NOW;
  const interval = {
    kind: 'interval', timezone: 'Asia/Seoul', intervalMs: 1_000,
    nextRunAt: now, misfirePolicy: 'catch_up_once',
  };
  const due = scheduledJob('max-one-job', x.root, interval);
  due.authorityEnvelope = { ...due.authorityEnvelope, maxRuns: 1 };
  const first = await startProduct({ model: proposalModel(), jobs: [due], space: x, clock: () => now });
  const prepared = prepareAutomationRuns({
    jobs: [due], skills: [skill()], profiles: [profile(x.root)], now,
  });
  assert.equal(prepared.entries.length, 1);
  await first.runLedger.append(prepared.entries[0].run);
  await new Promise((resolve) => first.server.close(resolve));
  const app = await startProduct({
    model: proposalModel(), space: x, preserveState: true, clock: () => now,
  });
  try {
    const second = await app.server.runtimeTick();
    const runs = (await app.runLedger.load()).runs.filter((run) => run.jobId === due.id);
    const saved = (await app.automationStore.load()).jobs.find((job) => job.id === due.id);
    assert.equal(second.ran.length, 0, JSON.stringify(second));
    assert.equal(runs.length, 1);
    assert.equal(saved.state, 'expired');
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
});

test('update binding: target의 exact active Skill/Profile/authority가 바뀌면 승인 영향0', async () => {
  const x = await room();
  const target = scheduledJob('binding-target', x.root);
  await withProduct({ model: proposalModel(), jobs: [target] }, async (app) => {
    const proposed = await app.turn('같은 알림을 매주 화요일 오전 10시로 바꿔줘.');
    const inactive = { ...skill(), state: 'paused', updatedAt: 2 };
    await app.skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [inactive] });
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.automationProposal.candidateId,
      candidateRevision: proposed.automationProposal.revision,
      controlRef: proposed.automationProposal.controlRef,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
    });
    assert.equal(approval.status, 422, JSON.stringify(approval));
    assert.equal(approval.body.reason, 'binding_not_active');
    assert.deepEqual((await app.automationStore.load()).jobs[0], target);
  });
  const target2 = scheduledJob('authority-target', x.root);
  await withProduct({ model: proposalModel(), jobs: [target2] }, async (app) => {
    const proposed = await app.turn('같은 알림을 매주 화요일 오전 10시로 바꿔줘.');
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.automationProposal.candidateId,
      candidateRevision: proposed.automationProposal.revision,
      controlRef: proposed.automationProposal.controlRef,
      skillId: 'l6-skill', agentProfileId: 'l6-agent', maxRuns: 999,
    });
    assert.deepEqual([approval.status, approval.body.reason], [422, 'authority_change_not_allowed']);
    assert.deepEqual((await app.automationStore.load()).jobs[0], target2);
  });
});

test('authority expiry: 만료된 job은 actual tick에서 실행0·expired로 정산된다', async () => {
  const x = await room();
  const interval = {
    kind: 'interval', timezone: 'Asia/Seoul', intervalMs: 1_000,
    nextRunAt: FROZEN_NOW, misfirePolicy: 'catch_up_once',
  };
  const due = scheduledJob('expired-job', x.root, interval);
  due.authorityEnvelope = { ...due.authorityEnvelope, expiresAt: FROZEN_NOW - 1 };
  await withProduct({ model: proposalModel(), jobs: [due] }, async (app) => {
    const tick = await app.server.runtimeTick();
    const saved = (await app.automationStore.load()).jobs.find((job) => job.id === due.id);
    assert.equal(tick.ran.length, 0);
    assert.equal((await app.runLedger.load()).runs.length, 0);
    assert.equal(saved.state, 'expired');
  });
});

function controlModel({ forcedRef, forcedRevision, capture = [] } = {}) {
  return { async respond(tc, opts = {}) {
    capture.push(structuredClone(tc));
    const schema = opts.tools?.find((entry) => entry.name === 'automation.control');
    if (!schema) {
      const settled = tc.automationControl;
      return settled
        ? `${settled.operation}:${settled.jobRef}:${settled.jobRevision}:${settled.state}`
        : '제어 결과를 확인하지 못했어요.';
    }
    const request = String(tc.currentRequest ?? '');
    const target = tc.automationReality?.jobs?.items?.[0];
    const operation = request.includes('일시정지') ? 'pause'
      : request.includes('재개') ? 'resume' : 'status';
    return { text: '', toolCalls: [{ name: 'automation.control', args: {
      operation,
      targetJobRef: forcedRef ?? target?.jobRef,
      targetJobRevision: forcedRevision ?? target?.jobRevision,
    } }] };
  } };
}

test('natural automation.control: exact job status→pause→resume가 same id/revision/readback으로 끝난다', async () => {
  const x = await room();
  const target = { ...scheduledJob('control-target', x.root), jobRevision: 1 };
  const other = { ...scheduledJob('control-other', x.root), jobRevision: 4 };
  const capture = [];
  await withProduct({ model: controlModel({ capture }), jobs: [target, other] }, async (app) => {
    const status = await app.turn('첫 번째 자동화 상태를 알려줘');
    assert.deepEqual({
      operation: status.automationControl.operation,
      jobRef: status.automationControl.jobRef,
      jobRevision: status.automationControl.jobRevision,
      state: status.automationControl.state,
      nextRunAt: status.automationControl.nextRunAt,
      mutated: status.automationControl.mutated,
      storeReadback: status.automationControl.storeReadback,
    }, {
      operation: 'status', jobRef: target.id, jobRevision: 1,
      state: 'scheduled', nextRunAt: target.nextRunAt, mutated: false, storeReadback: true,
    });
    assert.match(status.automationControl.settlement.settlementRef, /^[a-f0-9]{64}$/u);
    const paused = await app.turn('첫 번째 자동화를 일시정지해줘');
    assert.deepEqual([paused.automationControl.operation, paused.automationControl.jobRef,
      paused.automationControl.jobRevision, paused.automationControl.state],
    ['pause', target.id, 2, 'paused']);
    assert.match(paused.automationControl.settlement.settlementRef, /^[a-f0-9]{64}$/u);
    assert.equal(paused.reply, `pause:${target.id}:2:paused`);
    const resumed = await app.turn('첫 번째 자동화를 재개해줘');
    assert.deepEqual([resumed.automationControl.operation, resumed.automationControl.jobRef,
      resumed.automationControl.jobRevision, resumed.automationControl.state],
    ['resume', target.id, 3, 'scheduled']);
    const state = await app.automationStore.load();
    const saved = state.jobs.find((job) => job.id === target.id);
    assert.equal(saved?.jobRevision, 3);
    assert.deepEqual(saved.lastControlSettlement, resumed.automationControl.settlement);
    const surface = (await app.request('GET', '/automation')).body.jobs
      .find((job) => job.id === target.id);
    assert.deepEqual(surface.lastControlSettlement, saved.lastControlSettlement);
    const finalContext = capture.findLast((entry) => entry.automationControl?.operation === 'resume');
    assert.equal(finalContext.automationReality.jobs.items
      .find((job) => job.jobRef === target.id)?.lastControlSettlement.settlementRef,
    saved.lastControlSettlement.settlementRef);
    assert.deepEqual(state.jobs.find((job) => job.id === other.id), other);
    assert.equal((await app.runLedger.load()).runs.length, 0);
    const schema = capture.flatMap((tc) => tc ? [tc] : []).length;
    assert.equal(schema > 0, true);
  });
});

test('natural automation.control 반례: stale/다른 principal exact ref는 영향0이고 채널도 같은 callback이다', async () => {
  const x = await room();
  const target = { ...scheduledJob('control-target', x.root), jobRevision: 2 };
  const foreign = { ...scheduledJob('foreign-target', x.root), principalRef: 'other-owner', jobRevision: 1 };
  await withProduct({
    model: controlModel({ forcedRef: target.id, forcedRevision: 1 }), jobs: [target, foreign],
  }, async (app) => {
    const stale = await app.turn('자동화를 일시정지해줘');
    assert.deepEqual(stale.automationControl, { rejected: true, reason: 'job_revision_changed' });
    assert.deepEqual((await app.automationStore.load()).jobs, [target, foreign]);
  });
  await withProduct({
    model: controlModel({ forcedRef: foreign.id, forcedRevision: 1 }), jobs: [target, foreign],
  }, async (app) => {
    const sessionId = (await app.request('POST', '/sessions')).body.id;
    const inbound = await app.request('POST', '/channel/inbound', {
      sessionId, channel: 'telegram', text: '자동화를 일시정지해줘', isMention: true,
    });
    assert.deepEqual(inbound.body.automationControl, { rejected: true, reason: 'job_not_found' });
    assert.deepEqual((await app.automationStore.load()).jobs, [target, foreign]);
  });
});

test('automation.observe 관통: 모델이 다음 bounded page에서 실제 본 ref만 exact control한다', async () => {
  const x = await room();
  const target = { ...scheduledJob('page-outside-target', x.root), jobRevision: 7 };
  const jobs = [
    ...Array.from({ length: 20 }, (_, index) => ({
      ...scheduledJob(`bounded-${String(index).padStart(2, '0')}`, x.root), jobRevision: 1,
    })),
    target,
  ];
  const capture = [];
  const explicitLabel = target.name;
  let requestedLabel = null;
  const model = { async respond(tc, opts = {}) {
    capture.push(structuredClone(tc));
    if (tc.automationControl) return `상태:${tc.automationControl.state}`;
    requestedLabel ??= String(tc.currentRequest ?? '').match(/「([^」]+)」/u)?.[1] ?? null;
    const visible = tc.automationReality?.jobs?.items?.find((entry) => entry.name === requestedLabel);
    if (visible && opts.tools?.some((entry) => entry.name === 'automation.control')) {
      return { text: '', toolCalls: [{ name: 'automation.control', args: {
        operation: 'status', targetJobRef: visible.jobRef, targetJobRevision: visible.jobRevision,
      } }] };
    }
    if (tc.automationReality?.jobs?.truncated
      && opts.tools?.some((entry) => entry.name === 'automation.observe')) {
      return { text: '', toolCalls: [{ name: 'automation.observe', args: {
        collection: 'jobs', offset: 20, limit: 20,
      } }] };
    }
    return '상태를 찾지 못했어요.';
  } };
  await withProduct({
    model, jobs,
  }, async (app) => {
    const status = await app.turn(`자동화 목록에서 다음 쪽까지 보고 「${explicitLabel}」 상태를 알려줘`);
    assert.ok(status.automationControl, JSON.stringify(capture.map((entry) => ({
      request: entry.currentRequest,
      page: entry.automationReality?.jobs,
      observe: entry.automationObserve,
    }))));
    assert.deepEqual([status.automationControl.jobRef, status.automationControl.jobRevision,
      status.automationControl.state], [target.id, 7, 'scheduled']);
    const firstReality = capture[0].automationReality.jobs;
    assert.equal(firstReality.truncated, true, JSON.stringify({
      total: firstReality.total, count: firstReality.items.length,
      names: firstReality.items.map((entry) => entry.name),
    }));
    assert.equal(firstReality.items.some((entry) => entry.jobRef === target.id), false);
    const observedReality = capture.find((entry) => entry.automationObserve)?.automationReality.jobs;
    assert.equal(observedReality.offset, 20);
    assert.equal(observedReality.items.some((entry) => entry.jobRef === target.id), true);
    assert.equal((await app.automationStore.load()).jobs.length, 21);
  });
});

test('automation.observe→update 관통: 다음 page에서 실제 본 label/ref/revision만 canonical 후보로 입장한다', async () => {
  const x = await room();
  const target = { ...scheduledJob('page-update-target', x.root), jobRevision: 7 };
  const jobs = [
    ...Array.from({ length: 20 }, (_, index) => ({
      ...scheduledJob(`page-update-${String(index).padStart(2, '0')}`, x.root), jobRevision: 1,
    })),
    target,
  ];
  const explicitLabel = target.name;
  let requestedLabel = null;
  const capture = [];
  const model = { async respond(tc, opts = {}) {
    capture.push(structuredClone(tc));
    requestedLabel ??= String(tc.currentRequest ?? '').match(/「([^」]+)」/u)?.[1] ?? null;
    if (tc.automationProposal?.candidateId) return '변경 후보를 준비했어요.';
    const seen = tc.automationReality?.jobs?.items?.find((entry) => entry.name === requestedLabel);
    if (seen && opts.tools?.some((entry) => entry.name === 'automation.propose')) {
      return { text: '', toolCalls: [{ name: 'automation.propose', args: {
        statement: `${requestedLabel} 시간을 화요일 오전 10시로 바꾼다`,
        operation: 'update', targetJobRef: seen.jobRef,
        kind: 'weekly', trigger: TUESDAY, tool: 'local.file',
        action: { args: { action: 'read', path: '지난주정산.txt' } },
        skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
      } }] };
    }
    if (tc.automationReality?.jobs?.truncated
      && opts.tools?.some((entry) => entry.name === 'automation.observe')) {
      return { text: '', toolCalls: [{ name: 'automation.observe', args: {
        collection: 'jobs', offset: tc.automationReality.jobs.nextOffset, limit: 20,
      } }] };
    }
    return '대상을 찾지 못했어요.';
  } };
  await withProduct({ model, jobs, space: x }, async (app) => {
    const result = await app.turn(`자동화 목록 다음 쪽의 「${explicitLabel}」 시간을 화요일 오전 10시로 바꿔줘`);
    assert.ok(result.automationProposal?.candidateId, JSON.stringify({
      proposal: result.automationProposal,
      capture: capture.map((entry) => ({
        request: entry.currentRequest,
        page: entry.automationReality?.jobs,
        observe: entry.automationObserve,
        proposal: entry.automationProposal,
      })),
    }));
    const setup = await app.request('GET', `/automation/setup?candidateId=${result.automationProposal.candidateId}`);
    assert.equal(setup.status, 200, JSON.stringify(setup));
    assert.deepEqual([setup.body.candidate.targetJobRef, setup.body.candidate.revision], [target.id, 1]);
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: result.automationProposal.candidateId,
      candidateRevision: result.automationProposal.revision,
      skillId: 'l6-skill', agentProfileId: 'l6-agent',
    });
    assert.equal(approval.status, 200, JSON.stringify(approval));
    assert.equal(approval.body.jobId, target.id);
    const saved = (await app.automationStore.load()).jobs.find((entry) => entry.id === target.id);
    assert.deepEqual([saved.id, saved.jobRevision, saved.trigger.localTime], [target.id, 8, '10:00']);
    assert.equal(capture[0].automationReality.jobs.items.some((entry) => entry.jobRef === target.id), false);
    assert.equal(capture.some((entry) => entry.automationReality?.jobs?.items
      ?.some((item) => item.jobRef === target.id)), true);
  });
});

test('재감사 선빨강: approve name 민감 ingress는 job·durable 사실을 만들지 않는다', async () => {
  const proposed = candidate('sensitive-name-candidate', '매주 자료를 확인한다');
  await withProduct({ model: proposalModel(), candidates: [proposed] }, async (app) => {
    const before = await app.automationStore.load();
    const response = await app.request('POST', '/automation/approve', {
      candidateId: proposed.candidateId, skillId: 'l6-skill', agentProfileId: 'l6-agent',
      expiresAt: 2_000_000_000_000, maxRuns: 20,
      name: 'api_key=sk-secret-approval-name',
    });
    const after = await app.automationStore.load();
    assert.equal(response.status, 422);
    assert.equal(response.body.reason, 'sensitive_input');
    assert.deepEqual(after, before);
    assert.equal(JSON.stringify(after).includes('sk-secret-approval-name'), false);
  });
});

test('재감사 선빨강: scheduler mutation 뒤 옛 jobRevision 자연 제어는 영향 0이다', async () => {
  const x = await room();
  const interval = {
    kind: 'interval', timezone: 'Asia/Seoul', intervalMs: 1_000,
    nextRunAt: FROZEN_NOW, misfirePolicy: 'catch_up_once',
  };
  const due = { ...scheduledJob('scheduler-race-job', x.root, interval), jobRevision: 1 };
  const model = controlModel({ forcedRef: due.id, forcedRevision: 1 });
  await withProduct({ model, jobs: [due], space: x }, async (app) => {
    const tick = await app.server.runtimeTick();
    assert.equal(tick.ran.length, 1, JSON.stringify(tick));
    const afterTick = (await app.automationStore.load()).jobs.find((job) => job.id === due.id);
    assert.ok(afterTick.nextRunAt > due.nextRunAt);
    assert.ok(afterTick.jobRevision > 1, 'scheduler가 job을 바꾸고 revision은 그대로다');
    const control = await app.turn('그 자동화를 일시정지해줘.');
    const afterControl = (await app.automationStore.load()).jobs.find((job) => job.id === due.id);
    assert.equal(control.automationControl?.rejected, true);
    assert.equal(control.automationControl?.reason, 'job_revision_changed');
    assert.equal(afterControl.state, 'scheduled');
    assert.equal(afterControl.jobRevision, afterTick.jobRevision);
  });
});

test('재감사 선빨강: 구조 automation.propose가 없으면 반복 문구만으로 후보가 생기지 않는다', async () => {
  const model = { async respond(_tc, opts = {}) {
    if (opts.tools?.some((entry) => entry.name === 'automation.propose')) {
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '.' } }] };
    }
    return '확인했어요.';
  } };
  await withProduct({ model }, async (app) => {
    const result = await app.turn('매주 월요일마다 작업 폴더를 확인해줘.');
    const state = await app.automationStore.load();
    assert.equal(result.automationSuggestion == null, true);
    assert.equal(result.automationProposal == null, true);
    assert.equal(state.candidates.length, 0);
  });
});

test('재감사 선빨강: candidate→job→status→pause settlement는 append-only 한 원장에 남는다', async () => {
  const proposed = candidate('history-candidate', '매주 자료를 확인한다');
  await withProduct({ model: controlModel(), candidates: [proposed] }, async (app) => {
    const approval = await app.request('POST', '/automation/approve', {
      candidateId: proposed.candidateId, skillId: 'l6-skill', agentProfileId: 'l6-agent',
      expiresAt: 2_000_000_000_000, maxRuns: 20,
    });
    assert.equal(approval.status, 200, JSON.stringify(approval));
    const jobId = approval.body.jobId;
    const approvedState = await app.automationStore.load();
    const approvedCandidate = approvedState.candidates.find((entry) => entry.candidateId === proposed.candidateId);
    assert.equal(approvedCandidate.jobRef, jobId);
    assert.equal(approvedCandidate.settlementRef, approval.body.settlement.settlementRef);
    await app.turn('그 자동화 상태를 알려줘.');
    await app.turn('그 자동화를 일시정지해줘.');
    const state = await app.automationStore.load();
    assert.equal(Array.isArray(state.settlements), true);
    assert.deepEqual(state.settlements.map((entry) => entry.operation), ['create', 'status', 'pause']);
    assert.equal(new Set(state.settlements.map((entry) => entry.settlementRef)).size, 3);
    assert.equal(state.settlements.every((entry) => entry.jobRef === jobId), true);
    assert.equal(state.settlements[0].settlementRef, approval.body.settlement.settlementRef);
  });
});

test('maxRuns 동시성: 두 scheduler와 restart가 같은 durable occurrence를 하나만 예약한다', async () => {
  const x = await room();
  const interval = {
    kind: 'interval', timezone: 'Asia/Seoul', intervalMs: 1_000,
    nextRunAt: FROZEN_NOW, misfirePolicy: 'catch_up_once',
  };
  const due = { ...scheduledJob('concurrent-max-one', x.root, interval), jobRevision: 1 };
  due.authorityEnvelope = { ...due.authorityEnvelope, maxRuns: 1 };
  const first = await startProduct({ model: proposalModel(), jobs: [due], space: x });
  const second = await startProduct({
    model: proposalModel(), space: x, preserveState: true,
  });
  try {
    await Promise.all([first.server.runtimeTick(), second.server.runtimeTick()]);
  } finally {
    await Promise.all([
      new Promise((resolve) => first.server.close(resolve)),
      new Promise((resolve) => second.server.close(resolve)),
    ]);
  }
  const restarted = await startProduct({ model: proposalModel(), space: x, preserveState: true });
  try {
    await restarted.server.runtimeTick();
    const runs = (await restarted.runLedger.load()).runs.filter((run) => run.jobId === due.id);
    const saved = (await restarted.automationStore.load()).jobs.find((job) => job.id === due.id);
    assert.equal(runs.length, 1);
    assert.equal(saved.state, 'expired');
    assert.ok(saved.jobRevision > 1);
  } finally { await new Promise((resolve) => restarted.server.close(resolve)); }
});

test('update는 trigger-only다: action·skillPurpose·delivery 변경 후보는 effect와 성공 settlement 0', async () => {
  for (const variant of ['action', 'skillPurpose', 'delivery']) {
    const x = await room();
    const target = { ...scheduledJob(`trigger-only-${variant}`, x.root), jobRevision: 1 };
    const model = { async respond(tc, opts = {}) {
      const job = tc.automationReality?.jobs?.items?.[0];
      if (opts.tools?.some((entry) => entry.name === 'automation.propose') && job) {
        const args = {
          statement: '같은 자동화의 시간만 화요일 오전 10시로 바꾼다',
          operation: 'update', targetJobRef: job.jobRef,
          kind: 'weekly', trigger: TUESDAY,
          tool: 'local.file', action: { args: { action: 'read', path: '지난주정산.txt' } },
          skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
        };
        if (variant === 'action') args.action.args.path = '다른자료.txt';
        if (variant === 'skillPurpose') args.skillPurpose = '다른 목적';
        if (variant === 'delivery') args.deliveryIntent = 'chat';
        return { text: '', toolCalls: [{ name: 'automation.propose', args }] };
      }
      return '변경하지 않았어요.';
    } };
    await withProduct({ model, jobs: [target], space: x }, async (app) => {
      const before = await app.automationStore.load();
      const result = await app.turn('같은 자동화의 시간만 화요일 오전 10시로 바꿔줘');
      const after = await app.automationStore.load();
      assert.equal(result.automationProposal?.rejected, true, variant);
      assert.equal(after.candidates.filter((entry) => entry.current !== false).length, 0, variant);
      assert.deepEqual(after.jobs, before.jobs, variant);
      assert.deepEqual(after.settlements, before.settlements, variant);
    });
  }
});
