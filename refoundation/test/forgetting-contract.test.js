import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  makeForgetPlan,
  makeForgetReceipt,
  validateForgetPlan,
  validateForgetReceipt,
} from '../src/forgetting-contract.js';

const root = new URL('../../', import.meta.url);
const plan = (overrides = {}) => makeForgetPlan({
  requestId: 'forget-request-1',
  selector: { memoryIds: ['memory-1'], subjectKeys: [], scopeIds: [] },
  targets: [
    { kind: 'memory', id: 'memory-1', action: 'retract', revision: 3 },
    { kind: 'fts', id: 'memory-1', action: 'delete', revision: null },
    { kind: 'library_view', id: 'memory-1', action: 'rebuild', revision: null },
    { kind: 'external_copy', id: 'memory-1', action: 'unknown', revision: null },
  ],
  backupAvailable: true,
  ...overrides,
});

test('ForgetPlan preview digest는 exact selector·target·revision에서 runtime이 만든다', () => {
  const first = plan(); const second = plan();
  assert.match(first.previewDigest, /^[a-f0-9]{64}$/u);
  assert.equal(first.previewDigest, second.previewDigest);
  assert.deepEqual(validateForgetPlan(first), first);
  assert.notEqual(plan({ targets: [
    { kind: 'memory', id: 'memory-1', action: 'retract', revision: 4 },
  ] }).previewDigest, first.previewDigest);
});

test('selector는 opaque exact IDs만 받고 display name·빈 selector·중복을 거부한다', () => {
  assert.throws(() => makeForgetPlan({
    requestId: 'r', selector: { memoryIds: [], subjectKeys: [], scopeIds: [] },
    targets: [], backupAvailable: null,
  }), /selector/u);
  assert.throws(() => makeForgetPlan({
    requestId: 'r', selector: { memoryIds: ['m', 'm'], subjectKeys: [], scopeIds: [] },
    targets: [{ kind: 'memory', id: 'm', action: 'retract', revision: 1 }], backupAvailable: null,
  }), /unique/u);
  assert.throws(() => makeForgetPlan({
    requestId: 'r', selector: { memoryIds: [], subjectKeys: [], scopeIds: [], displayName: 'Alex' },
    targets: [{ kind: 'memory', id: 'm', action: 'retract', revision: 1 }], backupAvailable: null,
  }), /unknown field/u);
});

test('ForgetReceipt는 모든 plan target을 executed·unknown·retained로 정확히 한 번 분할한다', () => {
  const currentPlan = plan();
  const receipt = makeForgetReceipt({
    plan: currentPlan,
    executedTargets: ['memory:memory-1', 'fts:memory-1', 'library_view:memory-1'],
    unknownTargets: ['external_copy:memory-1'], retainedTargets: [],
    searchHitAfter: 0, contextProjectionAfter: 0, behaviorProbeAfter: 'pass',
    reversibleUntil: '2026-09-26T00:00:00.000Z',
  });
  assert.equal('success' in receipt, false);
  assert.deepEqual(validateForgetReceipt(receipt, currentPlan), receipt);
  assert.throws(() => makeForgetReceipt({
    plan: currentPlan, executedTargets: ['memory:memory-1'], unknownTargets: [], retainedTargets: [],
    searchHitAfter: 0, contextProjectionAfter: 0, behaviorProbeAfter: 'pass', reversibleUntil: null,
  }), /partition/u);
});

test('unknown·retained·behavior unknown은 0이나 pass로 꾸미지 않는다', () => {
  const currentPlan = plan();
  const receipt = makeForgetReceipt({
    plan: currentPlan, executedTargets: ['memory:memory-1'],
    unknownTargets: ['fts:memory-1', 'external_copy:memory-1'],
    retainedTargets: [{ id: 'library_view:memory-1', reason: 'rebuild_failed' }],
    searchHitAfter: null, contextProjectionAfter: null, behaviorProbeAfter: 'unknown',
    reversibleUntil: null,
  });
  assert.equal(receipt.searchHitAfter, null);
  assert.equal(receipt.behaviorProbeAfter, 'unknown');
  assert.equal(receipt.reversibleUntil, null);
  assert.throws(() => validateForgetReceipt({ ...receipt, success: true }, currentPlan), /unknown field/u);
});

test('M3 fixture는 아홉 cascade 사고와 절대 불변식을 제품 변경 전에 고정한다', async () => {
  const config = JSON.parse(await readFile(new URL(
    'refoundation/config/s3-memory-forgetting-incidents.json', root,
  ), 'utf8'));
  assert.equal(config.status, 'm3_locked_before_forgetting_product_change');
  assert.equal(config.incidents.length, 9);
  assert.equal(new Set(config.incidents.map((item) => item.id)).size, 9);
  assert.equal(config.absoluteInvariants.unrelatedRecordLoss, 0);
  assert.equal(config.absoluteInvariants.successBooleanAllowed, false);
});

test('M3-0 contract는 Memory writer·Context·background reviewer에 아직 연결되지 않는다', async () => {
  for (const path of [
    'refoundation/src/memory-ledger.js', 'refoundation/src/memory-tool.js',
    'refoundation/src/console-server.js', 'refoundation/src/memory-portfolio.js',
    'refoundation/src/learning-review.js',
  ]) assert.doesNotMatch(await readFile(new URL(path, root), 'utf8'), /forgetting-contract/u, path);
});
