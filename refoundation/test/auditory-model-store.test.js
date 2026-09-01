import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AuditoryModelStore, loadAuditoryModelCatalog } from '../src/auditory-model-store.js';
import { makeAuditoryCapabilityService } from '../src/auditory-capability-service.js';

const bytes = Buffer.alloc(1024 * 1024, 7);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const catalog = () => loadAuditoryModelCatalog({ schema: 't5.auditory-model-assets.v1',
  defaultAssetId: 'large-v3-turbo-full', assets: [{ id: 'large-v3-turbo-full', model: 'openai/test',
    format: 'ggml-f16', sourceRevision: 'a'.repeat(40),
    url: `https://example.test/models/${'a'.repeat(40)}/model.bin`, bytes: bytes.length,
    sha256, license: 'MIT', default: true }] });
const response = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });

test('제품 catalog는 full을 유일한 기본으로 두고 Q5를 qualification 후보로 고정한다', async () => {
  const current = loadAuditoryModelCatalog(JSON.parse(await readFile(new URL(
    '../config/auditory-model-assets.json', import.meta.url,
  ), 'utf8')));
  assert.equal(current.defaultAssetId, 'large-v3-turbo-full');
  assert.equal(current.assets.length, 2);
  assert.equal(current.byId.get('large-v3-turbo-full').bytes, 1624555275);
  assert.equal(current.byId.get('large-v3-turbo-q5-0').default, false);
});

test('auditory model은 stream download→inactive→fixture-qualified→active exact generation으로 열린다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-auditory-model-')); const progress = [];
  try {
    const store = new AuditoryModelStore({ root: room, catalog: catalog(), minimumFreeBytes: 0,
      makeId: () => 'generation-1', fetchImpl: async () => response(bytes) });
    const installed = await store.installInactive('large-v3-turbo-full', {
      onProgress: (event) => progress.push(event),
    });
    assert.equal(installed.state, 'installed_inactive'); assert.ok(progress.length > 0);
    assert.equal((await store.openActive('large-v3-turbo-full')).state, 'not_present');
    const qualified = await store.qualify(installed.assetId, installed.generationId,
      async () => ({ qualified: true, receiptDigest: 'b'.repeat(64) }));
    assert.equal(qualified.state, 'fixture_qualified');
    await store.activate(installed.assetId, installed.generationId);
    const active = await store.openActive(installed.assetId);
    assert.equal(active.state, 'active'); assert.equal(active.bytes, bytes.length);
    assert.equal(active.sha256, sha256); assert.equal(active.qualificationDigest, 'b'.repeat(64));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('resume는 exact Range만 append하고 200 응답이면 partial을 처음부터 교체한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-auditory-resume-')); let requestHeaders = null;
  try {
    const store = new AuditoryModelStore({ root: room, catalog: catalog(), minimumFreeBytes: 0,
      makeId: () => 'generation-2', fetchImpl: async (_url, options) => {
        requestHeaders = options.headers; return response(bytes);
      } });
    await store.ensure(); const asset = store.catalog.byId.get('large-v3-turbo-full');
    const partial = store.partialPath(asset);
    await import('node:fs/promises').then((fs) => fs.writeFile(partial, bytes.subarray(0, 1024)));
    const installed = await store.installInactive(asset.id);
    assert.equal(requestHeaders.Range, 'bytes=1024-'); assert.equal(installed.state, 'installed_inactive');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('digest mismatch와 qualification 실패는 active model을 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-auditory-reject-'));
  try {
    const bad = new AuditoryModelStore({ root: join(room, 'bad'), catalog: catalog(), minimumFreeBytes: 0,
      fetchImpl: async () => response(Buffer.alloc(bytes.length, 8)) });
    await assert.rejects(bad.installInactive('large-v3-turbo-full'), /digest mismatch/u);
    const store = new AuditoryModelStore({ root: join(room, 'quality'), catalog: catalog(), minimumFreeBytes: 0,
      makeId: () => 'generation-3', fetchImpl: async () => response(bytes) });
    const installed = await store.installInactive('large-v3-turbo-full');
    const result = await store.qualify(installed.assetId, installed.generationId,
      async () => ({ qualified: false }));
    assert.equal(result.qualified, false);
    await assert.rejects(store.activate(installed.assetId, installed.generationId), /not fixture-qualified/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('준비 서비스는 inactive crash를 이어서 qualify·activate하고 동시 호출을 한 generation으로 합친다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-auditory-service-')); let fetches = 0; let qualifications = 0;
  try {
    const store = new AuditoryModelStore({ root: room, catalog: catalog(), minimumFreeBytes: 0,
      makeId: () => 'generation-service', fetchImpl: async () => { fetches += 1; return response(bytes); } });
    const installed = await store.installInactive('large-v3-turbo-full');
    assert.equal(installed.state, 'installed_inactive');
    const service = makeAuditoryCapabilityService({ store, scratchRoot: room,
      qualifier: async () => { qualifications += 1; return { qualified: true, receiptDigest: 'c'.repeat(64) }; } });
    const [first, second] = await Promise.all([service.prepare(), service.prepare()]);
    assert.equal(first.state, 'ready'); assert.equal(second.model.generationId, first.model.generationId);
    assert.equal(fetches, 1); assert.equal(qualifications, 1);
    const restarted = makeAuditoryCapabilityService({ store, scratchRoot: room,
      qualifier: async () => { qualifications += 1; throw new Error('must not requalify active model'); } });
    const reused = await restarted.prepare(); assert.equal(reused.reused, true); assert.equal(qualifications, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});
