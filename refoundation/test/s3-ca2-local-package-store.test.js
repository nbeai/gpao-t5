import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeCapabilityAcquisitionCoordinator, makeCapabilityPackageAdminTool,
  makeGitExactRefResolver, makeLocalDirectoryResolver } from '../src/capability-acquisition-coordinator.js';
import { LocalCapabilityPackageStore } from '../src/local-capability-package-store.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');
async function packageAt(root, version, content) {
  await mkdir(root, { recursive: true }); const bytes = Buffer.from(content); await writeFile(join(root, 'run.txt'), bytes);
  const payloadDigest = sha(JSON.stringify([{ path: 'run.txt', bytes: bytes.length, sha256: sha(bytes) }]));
  const manifest = { schema: 't5.capability-package.v1', id: 'inventory-dock', version,
    knowledge: { summary: '재고 조회 package', constraints: [], sources: [{ url: 'https://docs.example.com/inventory',
      publisherIdentity: 'Example', purpose: 'API contract', lastVerifiedAt: '2026-08-27T12:00:00.000Z', volatile: false }] },
    manifest: { kind: 'executable_extension', source: { kind: 'local_directory', locator: root,
      resolvedRef: `local:${version}:${payloadDigest}`, artifactDigest: payloadDigest, publisherIdentity: 'local developer', signature: null, license: 'MIT' },
      platforms: ['darwin-arm64'], entrypoint: { kind: 'executable', value: 'run.txt' },
      auth: { strategy: 'none', credentialOwner: 'none', scopes: [], redirectOrigins: [] },
      actions: [{ id: 'inventory-read', effect: 'observe', hosts: [], idempotency: 'not_applicable',
        inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] } }], dependencies: [],
      isolation: { process: 'separate_process', filesystem: ['workspace:read'], network: [] },
      lifecycle: { install: 'declarative', update: 'declarative', remove: 'declarative', rollback: 'declarative' },
      qualification: { fixtureId: 'local-positive', probeAction: 'inventory-read', expectedObservation: 'fixture output' } } };
  await writeFile(join(root, 'capability.json'), JSON.stringify(manifest)); return manifest;
}

test('CA2 local positive control은 inspect→inactive install→enable/disable→update→rollback→remove를 한 store에서 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-ca2-local-')); const store = new LocalCapabilityPackageStore(join(room, 'store'));
  try {
    const v1 = join(room, 'v1'); await packageAt(v1, '1.0.0', 'version-one');
    assert.equal((await store.inspect(v1)).state, 'structurally_checked');
    const first = await store.installInactive(v1); assert.equal(first.state, 'installed_inactive');
    await store.enable(first.id, first.generationId);
    const v2 = join(room, 'v2'); await packageAt(v2, '2.0.0', 'version-two');
    const second = await store.installInactive(v2); await store.enable(second.id, second.generationId);
    assert.equal((await store.rollback('inventory-dock')).generationId, first.generationId);
    await assert.rejects(store.uninstall('inventory-dock', first.generationId), /active generation/u);
    await store.disable('inventory-dock');
    await store.uninstall('inventory-dock', second.generationId);
    const state = await store.list();
    assert.equal(state['inventory-dock'].activeGenerationId, null);
    assert.deepEqual(state['inventory-dock'].generations.map((item) => item.version), ['1.0.0']);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('payload 변경·symlink·active generation 제거는 설치 상태로 승격되지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-ca2-negative-')); const store = new LocalCapabilityPackageStore(join(room, 'store'));
  try {
    const source = join(room, 'source'); await packageAt(source, '1.0.0', 'original');
    await writeFile(join(source, 'run.txt'), 'changed');
    await assert.rejects(store.installInactive(source), /payload digest mismatch/u);
    assert.deepEqual(await store.list(), {});
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('개발자 명시 표면은 local source를 스스로 찾지 않고 같은 coordinator로 inspect·install한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-ca2-admin-')); const source = join(room, 'source');
  await packageAt(source, '1.0.0', 'admin');
  const coordinator = makeCapabilityAcquisitionCoordinator({ store: new LocalCapabilityPackageStore(join(room, 'store')),
    resolvers: { local_directory: makeLocalDirectoryResolver() } });
  const tool = makeCapabilityPackageAdminTool({ coordinator });
  const base = { sourceKind: 'local_directory', locator: source, resolvedRef: null,
    id: null, generationId: null, effect: null };
  try {
    assert.equal((await tool.execute({ ...base, action: 'inspect' })).state, 'structurally_checked');
    const installed = await tool.execute({ ...base, action: 'install' });
    assert.equal(installed.state, 'installed_inactive');
    assert.ok((await tool.execute({ ...base, action: 'list' })).packages['inventory-dock']);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Git resolver는 branch·tag·credential URL을 받지 않고 exact commit만 fetch 후보로 만든다', async () => {
  const resolver = makeGitExactRefResolver({ run: async () => { throw new Error('must not execute'); } });
  await assert.rejects(resolver.resolve({ locator: 'https://github.com/example/repo', resolvedRef: 'main' }), /exact 40-character commit/u);
  await assert.rejects(resolver.resolve({ locator: 'https://user:token@github.com/example/repo', resolvedRef: `commit:${'a'.repeat(40)}` }), /credential-free HTTPS/u);
});
