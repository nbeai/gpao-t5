import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDelegation } from '../src/runtime/agent-delegation.js';

const authority = (patch = {}) => ({
  ceiling: 'A1',
  allowedKinds: ['read'],
  allowedTools: ['local.file'],
  allowedTargets: [],
  workspaceRoots: ['/tmp/h10'],
  expiresAt: null,
  maxRuns: 2,
  maxCost: 2,
  requiresFreshApprovalFor: [],
  ...patch,
});

const budgets = (patch = {}) => ({
  maxToolCalls: 4,
  timeoutMs: 5_000,
  maxCost: 2,
  maxConcurrency: 2,
  ...patch,
});

test('delegation partitions one parent without widening authority or aggregate budgets', () => {
  const delegated = buildDelegation({
    requestId: 'turn-1',
    text: '두 폴더를 조사한다',
    partitions: [{ folder: 'A' }, { folder: 'B' }],
    authorityEnvelope: authority(),
    budgets: budgets(),
    now: 100,
  });

  assert.equal(delegated.children.length, 2);
  assert.ok(delegated.children.every((run) => run.inputSnapshot.parentRequestId === delegated.parent.id));
  assert.ok(delegated.children.every((run) => run.authorityEnvelope.maxRuns === 1));
  assert.equal(delegated.children.reduce((sum, run) => sum + run.budgets.maxToolCalls, 0), 4);
  assert.equal(delegated.children.reduce((sum, run) => sum + run.budgets.maxCost, 0), 2);
});

test('delegation refuses more children than the parent run or step budget permits', () => {
  const common = {
    requestId: 'turn-1',
    text: '세 범위를 조사한다',
    partitions: [{ part: 1 }, { part: 2 }, { part: 3 }],
    now: 100,
  };
  assert.throws(
    () => buildDelegation({ ...common, authorityEnvelope: authority(), budgets: budgets() }),
    /delegation_run_count_outside_parent/,
  );
  assert.throws(
    () => buildDelegation({
      ...common,
      authorityEnvelope: authority({ maxRuns: 3 }),
      budgets: budgets({ maxToolCalls: 2, maxConcurrency: 3 }),
    }),
    /delegation_step_budget_too_small/,
  );
});
