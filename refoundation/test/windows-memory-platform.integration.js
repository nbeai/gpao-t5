import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reconcileNativeSearch } from '../src/memory-platform-adapter.js';
import { makeWindowsMemoryPlatformAdapter } from '../src/windows-memory-platform-adapter.js';
import { makeWindowsSearchProjectionDriver } from '../src/windows-search-projection-driver.js';

function state(value, status = 'active', revision = 1, sensitivity = 'normal') {
  return { claims: [{ memoryId: 'windows-memory', kind: 'fact', subjectKey: 'windows.기억', value,
    status, subjectRevision: revision, recordedAt: '2026-08-27T02:00:00.000Z', sensitivity, sources: [] }] };
}

test('Windows derived files는 Unicode add·update·delete·rebuild를 noncanonical manifest로 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-windows-memory-projection-'));
  try {
    const driver = makeWindowsSearchProjectionDriver({ root: join(room, 'Indexed') });
    const adapter = makeWindowsMemoryPlatformAdapter({ platform: 'win32', search: driver });
    const added = await reconcileNativeSearch({ state: state('한글 기억 α'), adapter });
    assert.equal(added.state, 'verified');
    assert.equal(added.verificationKind, 'derived_file_projection');
    const updated = await reconcileNativeSearch({ state: state('고친 기억 β', 'active', 2), adapter });
    assert.equal(updated.state, 'verified');
    const manifest = JSON.parse(await readFile(join(room, 'Indexed', 'manifest.json'), 'utf8'));
    assert.equal(manifest.canonical, false);
    assert.equal(JSON.stringify(manifest).includes('고친 기억 β'), false);
    const rebuilt = await adapter.rebuildSearchItems({ domain: 't5.life-continuity.memory',
      items: await driver.list({ domain: 't5.life-continuity.memory' }) });
    assert.equal(rebuilt.state, 'projection_verified');
    assert.equal((await driver.list({ domain: 't5.life-continuity.memory' }))[0].content, '고친 기억 β');
    const removed = await reconcileNativeSearch({ state: state('고친 기억 β', 'retracted', 2), adapter });
    assert.equal(removed.state, 'verified');
    assert.deepEqual(await driver.list({ domain: 't5.life-continuity.memory' }), []);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Windows projection root symlink와 sensitive auto-index는 닫힌다', async (context) => {
  const room = await mkdtemp(join(tmpdir(), 't5-windows-memory-boundary-'));
  try {
    const outside = join(room, 'outside'); const linked = join(room, 'linked'); await mkdir(outside);
    try { await symlink(outside, linked, 'dir'); } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
        context.diagnostic('Windows runner cannot create symlink without developer privilege'); return;
      }
      throw error;
    }
    const driver = makeWindowsSearchProjectionDriver({ root: linked });
    assert.equal(await driver.available(), false);
    const safe = makeWindowsSearchProjectionDriver({ root: join(room, 'safe') });
    const adapter = makeWindowsMemoryPlatformAdapter({ platform: 'win32', search: safe });
    const result = await reconcileNativeSearch({ state: state('노출 금지', 'active', 1, 'private'), adapter });
    assert.equal(result.state, 'verified');
    assert.equal(result.blocked[0].reason, 'sensitivity_blocked');
    assert.deepEqual(await safe.list({ domain: 't5.life-continuity.memory' }), []);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Windows Explorer는 direct argv 구조만 만들고 VM 실행 성공을 주장하지 않는다', () => {
  const adapter = makeWindowsMemoryPlatformAdapter({ platform: 'win32', search: {} });
  assert.deepEqual(adapter.explorerInvocation('C:\\Users\\fixture\\T5 Records', 'directory'), {
    program: 'explorer.exe', args: ['C:\\Users\\fixture\\T5 Records'],
  });
  assert.equal(makeWindowsMemoryPlatformAdapter({ platform: 'darwin' })
    .explorerInvocation('C:\\Users\\fixture', 'directory'), null);
});

test('actual Windows runner는 같은 projection 계약을 x64에서 실행한다', async (context) => {
  if (process.platform !== 'win32') return context.skip('Windows runner qualification');
  const room = await mkdtemp(join(tmpdir(), 't5-windows-memory-live-'));
  try {
    const driver = makeWindowsSearchProjectionDriver({ root: join(room, 'Indexed') });
    const adapter = makeWindowsMemoryPlatformAdapter({ search: driver });
    const receipt = await reconcileNativeSearch({ state: state('Windows runner 실제 파일'), adapter });
    assert.equal(receipt.state, 'verified');
    assert.equal(receipt.platform, 'windows');
    assert.equal(receipt.verificationKind, 'derived_file_projection');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('GitHub Windows runner는 projection을 실행하되 VM Search PASS로 부르지 않는다', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /windows-terminal:[\s\S]*windows-memory-platform\.integration\.js/u);
  assert.doesNotMatch(workflow, /Windows Search VM PASS/u);
});
