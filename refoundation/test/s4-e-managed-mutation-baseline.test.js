import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeExecTool } from '../src/exec-tool.js';
import { makeFileRealityTool } from '../src/file-reality-tool.js';
import { ManagedMutationObserver } from '../src/managed-mutation-observer.js';

const args = (overrides = {}) => ({ action: 'search', query: null, scope: null, path: null,
  handles: null, maxCandidates: null, placements: null, planId: null, effect: null, ...overrides });
const effect = { kind: 'local_change', targets: [], confirmation: 'not_applicable',
  rollbackOfToolCallId: null, reversible: true, backupAvailable: true };

async function planned(root, source, destination) {
  const tool = makeFileRealityTool({ workspace: join(root, 'workspace'), home: root,
    platform: 'test', computerRoots: [root], organizationRoot: join(root, 'plans'),
    indexSearch: async () => [source] });
  const found = await tool.execute(args({ action: 'search', query: 'target', scope: 'workspace', maxCandidates: 5 }));
  const plan = await tool.execute(args({ action: 'plan', placements: [{
    handle: found.candidates[0].handle, destinationDirectory: destination,
  }] }));
  return { tool, plan };
}

test('S4-E2: plan 뒤 destination parent symlink 교체는 managed root 밖 이동 전에 차단된다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-s4e-symlink-parent-'));
  try {
    const workspace = join(root, 'workspace'); const destination = join(root, 'destination');
    const outside = join(root, 'outside'); await Promise.all([mkdir(workspace), mkdir(destination), mkdir(outside)]);
    const source = join(workspace, 'target.txt'); await writeFile(source, 'exact-source');
    const { tool, plan } = await planned(root, source, destination);
    await rm(destination, { recursive: true }); await symlink(outside, destination);
    await assert.rejects(tool.execute(args({ action: 'apply', planId: plan.planId,
      effect: { ...effect, targets: [source] } })), /destination changed/u);
    await assert.rejects(readFile(join(outside, 'target.txt'), 'utf8'), { code: 'ENOENT' });
    assert.equal(await readFile(source, 'utf8'), 'exact-source');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('S4-E3: workspace source hardlink는 plan admission에서 차단된다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-s4e-hardlink-'));
  try {
    const workspace = join(root, 'workspace'); const destination = join(root, 'destination');
    await Promise.all([mkdir(workspace), mkdir(destination)]);
    const outside = join(root, 'outside.txt'); const source = join(workspace, 'target.txt');
    await writeFile(outside, 'shared-bytes'); await link(outside, source);
    await assert.rejects(planned(root, source, destination), /hardlink/u);
    assert.equal(await readFile(outside, 'utf8'), 'shared-bytes');
    await assert.rejects(readFile(join(destination, 'target.txt'), 'utf8'), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('S4-E4A: foreground Terminal은 선언 밖 실제 write를 bounded managed diff로 관측한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-s4e-unexpected-write-'));
  try {
    const target = join(root, 'target.txt'); const unexpected = join(root, 'unexpected.txt');
    const tool = makeExecTool({ workspace: root, explainCommand: async () => ({ ok: false }),
      mutationObserver: new ManagedMutationObserver(root) });
    const command = `printf target > ${JSON.stringify(target)}; printf outside > ${JSON.stringify(unexpected)}`;
    const result = await tool.execute({ command, cwd: null,
      effect: { ...effect, targets: [target] } });
    assert.equal(result.state, 'completed');
    assert.equal(result.effectObservation.after.targets.length, 1);
    assert.deepEqual(result.managedMutationObservation.declaredChanges, ['target.txt']);
    assert.deepEqual(result.managedMutationObservation.unexpectedChanges, ['unexpected.txt']);
    assert.equal(await readFile(unexpected, 'utf8'), 'outside');
  } finally { await rm(root, { recursive: true, force: true }); }
});
