import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeDeclarativeObserveExecutor } from '../src/declarative-observe-executor.js';
import { LocalCapabilityPackageStore } from '../src/local-capability-package-store.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');

async function packageAt(root, endpoint, overrides = {}) {
  await mkdir(root, { recursive: true }); const payloadDigest = sha('[]');
  const manifest = { schema: 't5.capability-package.v1', id: 'current-data-observer', version: '1.0.0',
    knowledge: { summary: '현재 공개 JSON 자료를 읽는 검증 후보', constraints: ['observe only'],
      sources: [{ url: 'https://docs.example.com/current-data', publisherIdentity: 'Example Publisher',
        purpose: 'public JSON contract', lastVerifiedAt: '2026-08-30T00:00:00.000Z', volatile: true }] },
    manifest: { kind: 'declarative_http', source: { kind: 'local_directory', locator: root,
      resolvedRef: `local:1.0.0:${payloadDigest}`, artifactDigest: payloadDigest,
      publisherIdentity: 'Example Publisher', signature: null, license: 'CC-BY-4.0' },
    platforms: ['darwin-arm64'], entrypoint: { kind: 'remote_http', value: endpoint },
    auth: { strategy: 'none', credentialOwner: 'none', scopes: [], redirectOrigins: [] },
    actions: [{ id: 'current-read', effect: 'observe', hosts: [new URL(endpoint).hostname], idempotency: 'not_applicable',
      inputSchema: { type: 'object', additionalProperties: false,
        properties: { location: { type: 'string', maxLength: 80 } }, required: ['location'] } }],
    dependencies: [], isolation: { process: 'separate_process', filesystem: [], network: ['127.0.0.1'] },
    lifecycle: { install: 'declarative', update: 'declarative', remove: 'declarative', rollback: 'declarative' },
    qualification: { fixtureId: 'current-data-loopback-v1', probeAction: 'current-read',
      expectedObservation: 'exact location and current value' }, ...overrides } };
  await writeFile(join(root, 'capability.json'), JSON.stringify(manifest)); return manifest;
}

async function activeFixture(room, endpoint, overrides) {
  const source = join(room, 'source'); await packageAt(source, endpoint, overrides);
  const store = new LocalCapabilityPackageStore(join(room, 'store'));
  const installed = await store.installInactive(source); await store.enable(installed.id, installed.generationId);
  return { source, store, installed };
}

test('S6-B declarative observe는 active generation의 exact GET을 별도 helper에서 한 번 관측한다', async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1; const url = new URL(request.url, 'http://127.0.0.1');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ location: url.searchParams.get('location'), value: 26.5, unit: 'C' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const room = await mkdtemp(join(tmpdir(), 't5-s6-declarative-observe-'));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/current`;
    const { store, installed } = await activeFixture(room, endpoint);
    const result = await makeDeclarativeObserveExecutor({ store, allowLoopbackHttp: true }).execute({
      id: installed.id, actionId: 'current-read', args: { location: 'Seoul' },
    });
    assert.equal(calls, 1); assert.equal(result.state, 'observed');
    assert.equal(result.result.location, 'Seoul'); assert.equal(result.result.value, 26.5);
    assert.equal(result.capability.generationId, installed.generationId);
    assert.equal(result.source.url, `${endpoint}?location=Seoul`);
    assert.equal(result.source.publisherIdentity, 'Example Publisher');
  } finally {
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('inactive·write action·host mismatch·unknown argument는 helper 실행 전에 닫힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s6-declarative-negative-')); let runs = 0;
  const run = async () => { runs += 1; return {}; };
  try {
    const source = join(room, 'inactive'); await packageAt(source, 'https://api.example.com/current');
    const inactive = new LocalCapabilityPackageStore(join(room, 'inactive-store'));
    await inactive.installInactive(source);
    await assert.rejects(makeDeclarativeObserveExecutor({ store: inactive, run }).execute({
      id: 'current-data-observer', actionId: 'current-read', args: { location: 'Seoul' },
    }), /not active/u);

    const { store } = await activeFixture(join(room, 'active'), 'https://api.example.com/current');
    await assert.rejects(makeDeclarativeObserveExecutor({ store, run }).execute({
      id: 'current-data-observer', actionId: 'current-read', args: { location: 'Seoul', extra: true },
    }), /closed schema/u);
    await assert.rejects(makeDeclarativeObserveExecutor({ store, run }).execute({
      id: 'current-data-observer', actionId: 'missing', args: { location: 'Seoul' },
    }), /observe-only/u);

    const writeAction = [{ id: 'current-read', effect: 'external_change', hosts: ['api.example.com'],
      idempotency: 'unknown', inputSchema: { type: 'object', additionalProperties: false,
        properties: { location: { type: 'string', maxLength: 80 } }, required: ['location'] } }];
    const changed = await activeFixture(join(room, 'write'), 'https://api.example.com/current', {
      actions: writeAction,
    });
    await assert.rejects(makeDeclarativeObserveExecutor({ store: changed.store, run }).execute({
      id: 'current-data-observer', actionId: 'current-read', args: { location: 'Seoul' },
    }), /observe-only/u);
    assert.equal(runs, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('active generation의 manifest가 바뀌면 endpoint를 열기 전에 readback이 실패한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s6-declarative-stale-')); let runs = 0;
  try {
    const { store, installed } = await activeFixture(room, 'https://api.example.com/current');
    const path = join(room, 'store', 'packages', installed.id, installed.generationId, 'capability.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.manifest.entrypoint.value = 'https://outside.example.net/current';
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(makeDeclarativeObserveExecutor({ store, run: async () => { runs += 1; } }).execute({
      id: installed.id, actionId: 'current-read', args: { location: 'Seoul' },
    }), /readback mismatch/u);
    assert.equal(runs, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});
