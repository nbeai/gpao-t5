import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canStartAgentRun,
  proposeAgentProfile,
  reviseAgentProfile,
  transitionAgentProfile,
  validateAgentBudgets,
  validateBoundedAgentProfile,
} from '../src/kernel/l5-growth/agent-profile.js';
import {
  boundedChildToolAllowlist,
} from '../src/kernel/l5-growth/agent-run.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';

const budgets = (patch = {}) => ({
  maxToolCalls: 8,
  timeoutMs: 60_000,
  maxCost: 4,
  maxConcurrency: 2,
  ...patch,
});

const profileInput = (patch = {}) => ({
  id: 'agent-1',
  name: 'Research worker',
  purpose: 'Read bounded project material and return a result',
  modelRole: 'worker',
  toolAllowlist: [
    'local.file', 'local.terminal', 'telegram.send',
    'agent.create', 'memory.propose', 'automation.create',
  ],
  workspaceScope: ['/tmp/work'],
  defaultBudgets: budgets(),
  authorityCeiling: 'A1',
  ...patch,
});

test('AC-4 profile proposals have no execution effect until explicit activation', () => {
  const proposed = proposeAgentProfile({ ...profileInput(), state: 'active' }, 100);
  assert.equal(proposed.state, 'proposed');
  assert.equal(validateBoundedAgentProfile(proposed).ok, true);
  assert.equal(canStartAgentRun(proposed), false);

  const active = transitionAgentProfile(proposed, 'active', 110);
  assert.equal(active.ok, true);
  assert.equal(canStartAgentRun(active.record), true);

  const revised = reviseAgentProfile(active.record, {
    purpose: 'Use a newly reviewed purpose',
    toolAllowlist: [...active.record.toolAllowlist, 'web.collect'],
  }, 120);
  assert.equal(revised.state, 'proposed', 'authority-affecting edits require activation again');
  assert.equal(canStartAgentRun(revised), false);

  const paused = transitionAgentProfile(active.record, 'paused', 130);
  assert.equal(paused.ok, true);
  assert.equal(canStartAgentRun(paused.record), false);
  const retired = transitionAgentProfile(paused.record, 'retired', 140);
  assert.equal(retired.ok, true);
  assert.equal(transitionAgentProfile(retired.record, 'active', 150).ok, false);
});

test('AC-4 bounded profiles require explicit step, time, cost, and concurrency budgets', () => {
  assert.equal(validateAgentBudgets(budgets()).ok, true);
  for (const missing of ['maxToolCalls', 'timeoutMs', 'maxCost', 'maxConcurrency']) {
    const candidate = budgets();
    delete candidate[missing];
    assert.equal(validateAgentBudgets(candidate).ok, false, `${missing} must be explicit`);
  }
  assert.equal(validateAgentBudgets(budgets({ maxToolCalls: 0 })).ok, false);
  assert.equal(validateAgentBudgets(budgets({ timeoutMs: Infinity })).ok, false);
  assert.equal(validateAgentBudgets(budgets({ maxCost: -1 })).ok, false);
  assert.equal(validateAgentBudgets(budgets({ maxConcurrency: 1.5 })).ok, false);
});

test('AC-4 profile tools are narrowed only through the canonical childToolAllowlist contract', () => {
  const profile = proposeAgentProfile(profileInput(), 100);
  const visible = {
    connectedTools: [
      { id: 'local.file', toolKind: 'read' },
      { id: 'local.terminal', toolKind: 'write' },
      { id: 'telegram.send', toolKind: 'send' },
      { id: 'agent.create', toolKind: 'automate' },
      { id: 'memory.propose', toolKind: 'promote_memory' },
      { id: 'automation.create', toolKind: 'automate' },
    ],
  };
  assert.deepEqual(boundedChildToolAllowlist({
    parentToolAllowlist: ['local.file', 'telegram.send', 'agent.create', 'memory.propose', 'automation.create'],
    profile,
    requestedTools: [...profile.toolAllowlist, 'not-parent-owned'],
    selfState: visible,
  }), ['local.file']);
});

test('AC-4 profile store serializes lifecycle updates without losing independent proposals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac4-profile-'));
  const store = new AgentProfileStore(dir);
  const [a, b] = await Promise.all([
    store.propose(profileInput({ id: 'agent-a', name: 'Worker A' }), 100),
    store.propose(profileInput({ id: 'agent-b', name: 'Worker B' }), 101),
  ]);
  assert.equal(a.state, 'proposed');
  assert.equal(b.state, 'proposed');
  assert.deepEqual((await store.load()).profiles.map((entry) => entry.id).sort(), ['agent-a', 'agent-b']);

  const active = await store.activate('agent-a', 110);
  assert.equal(active.state, 'active');
  const revised = await store.update('agent-a', { workspaceScope: ['/tmp/work/review'] }, 120);
  assert.equal(revised.state, 'proposed');
  assert.deepEqual(revised.workspaceScope, ['/tmp/work/review']);
});
