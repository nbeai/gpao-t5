import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTOMATION_SCHEMA_VERSION,
  contentHash,
  skillHashSource,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { AgentRunRegistry } from '../src/runtime/agent-run-registry.js';
import { AgentRunRunner } from '../src/runtime/agent-runner.js';
import { AutomationScheduler } from '../src/runtime/automation-scheduler.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const serverFile = join(here, '..', 'src', 'surface', 'server.js');
const runtimeFile = join(here, '..', 'src', 'runtime', 'canonical-automation-runtime.js');
const freshDir = () => mkdtemp(join(tmpdir(), 't5-w2-product-cutover-'));

function skill() {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'skill-1',
    name: 'Weekly report',
    purpose: 'Read the bounded workspace and prepare a report',
    version: 1,
    contentHash: '',
    inputs: [],
    steps: [{ kind: 'read', instruction: 'Read current state first' }],
    resultContract: { kind: 'summary' },
    requiredCapabilities: ['local.file'],
    authorityHints: ['read'],
    replayCases: [],
    source: { kind: 'test', sessionId: 'session-1', traceIds: [] },
    state: 'active',
    createdAt: 0,
    updatedAt: 0,
    previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}

function profile() {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'agent-1',
    name: 'Weekly report worker',
    purpose: 'Prepare the bounded report',
    modelRole: 'worker',
    toolAllowlist: ['local.file'],
    workspaceScope: ['/tmp/work'],
    defaultBudgets: {
      maxToolCalls: 4,
      timeoutMs: 30_000,
      maxCost: 1,
      maxConcurrency: 1,
    },
    authorityCeiling: 'A1',
    state: 'active',
    createdAt: 0,
    updatedAt: 0,
  };
}

function authority() {
  return {
    ceiling: 'A1',
    allowedKinds: ['read'],
    allowedTools: ['local.file'],
    allowedTargets: [],
    workspaceRoots: ['/tmp/work'],
    expiresAt: null,
    maxRuns: 10,
    maxCost: 1,
    requiresFreshApprovalFor: [],
  };
}

function job() {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'job-1',
    name: 'Weekly report job',
    skillRef: { id: 'skill-1', version: 1, contentHash: skill().contentHash },
    trigger: {
      kind: 'once',
      timezone: 'UTC',
      at: 100,
      misfirePolicy: 'catch_up_once',
      nextRunAt: 100,
    },
    agentProfileId: 'agent-1',
    inputTemplate: {},
    authorityEnvelope: authority(),
    deliveryPolicy: { mode: 'none' },
    state: 'scheduled',
    nextRunAt: 100,
    lastRunId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

async function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('W2 product entry uses only canonical stores and has no legacy execution consumer', async () => {
  const serverSource = await readFile(serverFile, 'utf8');
  const runtimeSource = await readFile(runtimeFile, 'utf8');
  const source = `${serverSource}\n${runtimeSource}`;
  const facts = {
    legacySkillImport: /import\s*\{\s*SkillStore\s*\}\s*from/u.test(source),
    legacyAutomationImport: /import\s*\{\s*AutomationStore\s*\}\s*from/u.test(source),
    legacyTickImport: /import\s*\{\s*tickAutomation\s*\}\s*from/u.test(source),
    legacyStoreConstruction: /\bnew\s+(?:SkillStore|AutomationStore)\s*\(/u.test(source),
    legacyTickExecution: /\btickAutomation\s*\(/u.test(source),
    canonicalSkillStore: /\bSkillDefinitionStore\b/u.test(source),
    canonicalAutomationStore: /\bAutomationJobStore\b/u.test(source),
    canonicalAgentProfileStore: /\bAgentProfileStore\b/u.test(source),
    canonicalRunLedger: /\bAutomationRunLedger\b/u.test(source),
    soleExecutionAdapter: /\bAgentRunRunner\b/u.test(source),
    legacySchedulerCallback: /new\s+AutomationScheduler\s*\(\s*\{\s*onTick\s*:/u.test(source),
    compositionRoot: /new\s+CanonicalAutomationRuntime\s*\(/u.test(serverSource),
  };
  assert.deepEqual(facts, {
    legacySkillImport: false,
    legacyAutomationImport: false,
    legacyTickImport: false,
    legacyStoreConstruction: false,
    legacyTickExecution: false,
    canonicalSkillStore: true,
    canonicalAutomationStore: true,
    canonicalAgentProfileStore: true,
    canonicalRunLedger: true,
    soleExecutionAdapter: true,
    legacySchedulerCallback: false,
    compositionRoot: true,
  }, 'the product entry has not completed the canonical W2 cutover');
});

test('W2 model proposals persist through /turn as canonical influence-free candidates', async () => {
  const dir = await freshDir();
  const sessionStore = new SessionStore(dir);
  const skillStore = new SkillDefinitionStore(dir);
  const automationStore = new AutomationJobStore(dir);
  const agentProfileStore = new AgentProfileStore(dir);
  const runLedger = new AutomationRunLedger(dir);
  const offeredControls = new Set();
  let answered = false;
  const model = {
    async respond(_context, options = {}) {
      for (const schema of options.tools ?? []) offeredControls.add(schema.name);
      if (answered) return { text: '후보로만 준비했어요.', toolCalls: [] };
      answered = true;
      return {
        text: '세 가지를 실행하지 않고 후보로 준비했어요.',
        toolCalls: [
          {
            name: 'skill.propose',
            args: {
              name: '주간 정산',
              purpose: '매주 정산 자료를 읽고 초안을 만든다',
              steps: ['정산 자료를 읽는다', '초안을 만든다'],
            },
          },
          {
            name: 'automation.propose',
            args: { statement: '매주 금요일에 정산 초안을 준비한다', kind: 'weekly' },
          },
          {
            name: 'agent.propose',
            args: {
              name: '정산 담당',
              purpose: '정산 자료를 점검한다',
              workspaceScope: ['/tmp/work'],
            },
          },
        ],
      };
    },
  };
  const server = makeServer({
    store: sessionStore,
    skillStore,
    automationStore,
    agentProfileStore,
    automationRunLedger: runLedger,
    env: demoEnv(),
    tools: demoTools(),
    model,
    modelTimeoutMs: 0,
    processEnv: { GPAO_T5_TCELL: 'off' },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await post(base, '/sessions');
    assert.equal(created.status, 200);
    const session = await created.json();
    const turn = await post(base, '/turn', {
      sessionId: session.id,
      text: '주간 정산 스킬과 일정, 담당 역할을 후보로 준비해줘',
    });
    assert.equal(turn.status, 200);

    const skillState = await skillStore.load();
    const automationState = await automationStore.load();
    const profileState = await agentProfileStore.load();
    const runState = await runLedger.load();
    const facts = {
      controls: ['skill.propose', 'automation.propose', 'agent.propose']
        .filter((name) => offeredControls.has(name)),
      skillCandidates: skillState.skills.length,
      skillState: skillState.skills[0]?.state ?? null,
      automationCandidates: automationState.candidates.length,
      automationJobs: automationState.jobs.length,
      automationApproved: automationState.candidates[0]?.approved === true,
      agentCandidates: profileState.profiles.length,
      agentState: profileState.profiles[0]?.state ?? null,
      agentRuns: runState.runs.length,
    };
    assert.deepEqual(facts, {
      controls: ['skill.propose', 'automation.propose', 'agent.propose'],
      skillCandidates: 1,
      skillState: 'proposed',
      automationCandidates: 1,
      automationJobs: 0,
      automationApproved: false,
      agentCandidates: 1,
      agentState: 'proposed',
      agentRuns: 0,
    }, 'model proposals did not remain canonical, durable, and influence-free');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('W2 scheduler durably claims before the sole AgentRunRunner execution adapter runs', async () => {
  const dir = await freshDir();
  const skillStore = new SkillDefinitionStore(dir);
  const automationStore = new AutomationJobStore(dir);
  const profileStore = new AgentProfileStore(dir);
  const runLedger = new AutomationRunLedger(dir);
  await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill()] });
  await automationStore.save({
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    candidates: [],
    jobs: [job()],
  });
  await profileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile()] });

  const owner = { pid: process.pid, ownerToken: 'w2-product-owner' };
  let executePlanCalls = 0;
  const scheduler = new AutomationScheduler({
    stateSource: async () => ({
      ...(await automationStore.load()),
      skills: (await skillStore.load()).skills,
      profiles: (await profileStore.load()).profiles,
    }),
    jobStore: automationStore,
    runLedger,
    applyJobDeltas: async () => {
      throw new Error('an atomic job claim must not be applied a second time');
    },
    recordHeartbeat: async () => ({ ok: true }),
    owner,
    clock: () => 100,
  });

  const scheduled = await scheduler.fire();
  assert.equal(scheduled.claimed.length, 1);
  assert.equal(executePlanCalls, 0, 'the scheduler executed work while claiming it');
  assert.deepEqual((await runLedger.load()).events.map((event) => event.to), ['queued', 'claimed']);

  const runner = new AgentRunRunner({
    ledger: runLedger,
    registry: new AgentRunRegistry(),
    now: (() => { let now = 100; return () => ++now; })(),
    getRuntimeReality: async () => ({
      connectedTools: [{ id: 'local.file', toolKind: 'read' }],
    }),
    createContext: async ({ run }) => ({ request: run.skillSnapshot.purpose }),
    modelFor: () => ({ id: 'test-model' }),
    executePlan: async (request) => {
      executePlanCalls += 1;
      request.budget.consumeStep({ cost: 0 });
      return { kind: 'reply', result: { answer: 'done' }, receipts: [] };
    },
  });
  const finished = await runner.run(scheduled.claimed[0], {
    owner,
    parentAuthority: authority(),
    parentToolAllowlist: ['local.file'],
    parentBudgets: profile().defaultBudgets,
    concurrencyKey: 'job-1',
  });

  assert.equal(executePlanCalls, 1);
  assert.equal(finished.status, 'succeeded');
  const durable = await runLedger.load();
  assert.deepEqual(durable.events.map((event) => event.to), [
    'queued', 'claimed', 'running', 'succeeded',
  ]);
  assert.equal(durable.events.filter((event) => event.to === 'claimed').length, 1,
    'the execution adapter performed a second claim');
});
