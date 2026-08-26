import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeEffectForensicProductAdapter, projectHumanEffectForensicReceipt,
  projectHumanEffectRollbackReceipt } from '../src/effect-forensic-projection.js';
import { RunLedger } from '../src/run-ledger.js';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function seal(observation) {
  const declared = observation.declared; const external = observation.before?.scope === 'external';
  const bind = (state) => external || !state ? state : { schema: 't5.effect-observation-state.v2',
    ...state, bindings: state.targets.map((target, index) => ({ ordinal: index,
      declaredDigest: digest(declared.targets[index]), resolvedPathDigest: digest(target.path) })),
    targetSetDigest: digest(state.targets.map((target) => target.path)), cwdDigest: digest('/tmp') };
  const before = external ? { schema: 't5.effect-observation-state.v2', ...observation.before,
    bindings: [], targetSetDigest: digest(declared.targets) } : bind(observation.before);
  const after = external || !observation.after ? observation.after : bind(observation.after);
  const core = { schema: 't5.effect-observation.v2', declared,
    declaredDigest: digest({ kind: declared.kind, targets: declared.targets }),
    targetSetDigest: before?.targetSetDigest === after?.targetSetDigest ? before?.targetSetDigest ?? null : null,
    before, after, changed: null };
  return { ...core, receiptDigest: digest(core) };
}

async function materialized(observation, { outcome = 'succeeded' } = {}) {
  observation = seal(observation);
  const room = await mkdtemp(join(tmpdir(), 't5-effect-forensic-')); const runs = new RunLedger(room);
  const writer = await runs.start({ sessionId: 'session-1', request: 'effect' });
  await writer.append({ type: 'tool_completed', payload: { receipt: { toolCallId: 'tool-1', outcome,
    requestedCall: { name: 'exec', args: { effect: observation.declared } }, result: { effectObservation: observation } } } });
  const snapshot = await runs.read(writer.runId); const event = snapshot.events.at(-1);
  event.payload.receipt.actualCall = structuredClone(event.payload.receipt.requestedCall);
  event.payload.receipt.result.cwd = '/tmp';
  const originalRead = runs.read.bind(runs); runs.read = async (id) => id === writer.runId ? snapshot : originalRead(id);
  return makeEffectForensicProductAdapter({ runLedger: runs }).materialize({ sessionId: 'session-1',
    runId: writer.runId, toolCallId: 'tool-1' });
}

test('존재·identity·content·mode·owner·openability를 필드별로 분리한다', async () => {
  const before = { path: '/private/path', exists: true, type: 'file', size: 3, sha256: 'a'.repeat(64),
    filesystemIdentity: { dev: 1, ino: 2, nlink: 1 }, mode: 0o600, owner: { uid: 1, gid: 1 },
    acl: null, flags: null, openability: { readable: true, writable: true, listable: null } };
  const value = await materialized({ declared: { kind: 'local_change', targets: ['/private/path'] },
    before: { scope: 'local', targets: [before] }, after: { scope: 'local', targets: [{ ...before,
      size: 4, sha256: 'b'.repeat(64) }] } });
  assert.equal(value.targets[0].changes.content, 'changed'); assert.equal(value.targets[0].changes.size, 'changed');
  assert.equal(value.targets[0].changes.identity, 'unchanged'); assert.equal(value.coverage.acl, false);
  const human = projectHumanEffectForensicReceipt(value);
  assert.doesNotMatch(JSON.stringify(human), /private\/path|runId|toolCallId|[a-f0-9]{64}|0o600/u);
});

test('large file hash·ACL·flags가 없으면 unchanged가 아니라 unmeasured다', async () => {
  const target = { path: '/large', exists: true, type: 'file', size: 2_000_000, mode: 0o600,
    owner: { uid: 1, gid: 1 }, filesystemIdentity: { dev: 1, ino: 2, nlink: 1 },
    openability: { readable: true, writable: true, listable: null } };
  const value = await materialized({ declared: { kind: 'local_change', targets: ['/large'] },
    before: { scope: 'local', targets: [target] }, after: { scope: 'local', targets: [target] } });
  assert.equal(value.targets[0].changes.content, 'unknown'); assert.equal(value.result, 'partial');
});

test('external effect와 after 없는 process는 no-change로 승격하지 않는다', async () => {
  const external = await materialized({ declared: { kind: 'external_change', targets: ['remote'] },
    before: { scope: 'external', observed: false, targets: ['remote'] }, after: null });
  assert.equal(external.result, 'unknown');
  assert.throws(() => projectHumanEffectForensicReceipt({ schema: 't5.effect-forensic-receipt.v1' }),
    /runtime-materialized/u);
});

test('before/after target 순서·binding·observation digest가 다르면 귀속하지 않는다', async () => {
  const target = (path) => ({ path, exists: true, type: 'file', size: 1, sha256: 'a'.repeat(64),
    mode: 0o600, owner: { uid: 1, gid: 1 }, filesystemIdentity: { dev: 1, ino: path === '/a' ? 1 : 2, nlink: 1 },
    openability: { readable: true, writable: true, listable: null } });
  await assert.rejects(() => materialized({ declared: { kind: 'local_change', targets: ['/a', '/b'] },
    before: { scope: 'local', targets: [target('/a'), target('/b')] },
    after: { scope: 'local', targets: [target('/b'), target('/a')] } }), /target identity mismatch/u);
});

test('실행 실패와 남은 변화는 같은 인간 영수증에서 둘 다 보인다', async () => {
  const before = { path: '/a', exists: false }; const after = { path: '/a', exists: true,
    type: 'file', size: 1, sha256: 'a'.repeat(64), mode: 0o600, owner: { uid: 1, gid: 1 },
    filesystemIdentity: { dev: 1, ino: 1, nlink: 1 }, openability: { readable: true, writable: true, listable: null } };
  const value = await materialized({ declared: { kind: 'local_change', targets: ['/a'] },
    before: { scope: 'local', targets: [before] }, after: { scope: 'local', targets: [after] } },
  { outcome: 'failed' });
  const human = projectHumanEffectForensicReceipt(value);
  assert.match(human.title, /변화를 확인/u); assert.match(human.unknowns.join(' '), /실행은 실패/u);
});

test('symlink null access는 열기 가능 여부 confirmed가 아니다', async () => {
  const target = { path: '/link', exists: true, type: 'symlink', size: 1,
    filesystemIdentity: { dev: 1, ino: 1, nlink: 1 }, mode: 0o777, owner: { uid: 1, gid: 1 },
    openability: { readable: null, writable: null, listable: null } };
  const value = await materialized({ declared: { kind: 'local_change', targets: ['/link'] },
    before: { scope: 'local', targets: [target] }, after: { scope: 'local', targets: [target] } });
  assert.equal(value.coverage.openability, false);
});

test('명시한 prior tool relation과 exact before 복원이 모두 맞을 때만 restored다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-effect-rollback-')); const runs = new RunLedger(room);
  const source = await runs.start({ sessionId: 'session-rollback', request: 'create' });
  const missing = { path: '/a', exists: false }; const present = { path: '/a', exists: true,
    type: 'file', size: 1, sha256: 'a'.repeat(64), mode: 0o600, owner: { uid: 1, gid: 1 },
    filesystemIdentity: { dev: 1, ino: 1, nlink: 1 }, openability: { readable: true, writable: true, listable: null } };
  const sourceEffect = { kind: 'local_change', targets: ['/a'] };
  const sourceObservation = seal({ declared: sourceEffect, before: { scope: 'local', targets: [missing] },
    after: { scope: 'local', targets: [present] } });
  await source.append({ type: 'tool_completed', payload: { receipt: { toolCallId: 'create-1', outcome: 'succeeded',
    requestedCall: { name: 'exec', args: { effect: sourceEffect } }, actualCall: { name: 'exec', args: { effect: sourceEffect } },
    result: { cwd: '/tmp', effectObservation: sourceObservation } } } });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const rollback = await runs.start({ sessionId: 'session-rollback', request: 'undo' });
  const rollbackEffect = { kind: 'local_change', targets: ['/a'], rollbackOfToolCallId: 'create-1' };
  const rollbackObservation = seal({ declared: rollbackEffect, before: { scope: 'local', targets: [present] },
    after: { scope: 'local', targets: [missing] } });
  await rollback.append({ type: 'tool_completed', payload: { receipt: { toolCallId: 'undo-1', outcome: 'succeeded',
    requestedCall: { name: 'exec', args: { effect: rollbackEffect } }, actualCall: { name: 'exec', args: { effect: rollbackEffect } },
    result: { cwd: '/tmp', effectObservation: rollbackObservation } } } });
  const adapter = makeEffectForensicProductAdapter({ runLedger: runs });
  const value = await adapter.materializeRollback({ rollbackRunId: rollback.runId, rollbackToolCallId: 'undo-1' });
  assert.equal(value.result, 'restored');
  assert.match(projectHumanEffectRollbackReceipt(value).summary, /이전 상태로 돌아온/u);
});
