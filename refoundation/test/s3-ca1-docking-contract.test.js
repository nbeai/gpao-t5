import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateCapabilityPackage } from '../src/capability-package-contract.js';
import { capabilityRealityFact, makeCapabilityRealityObserver } from '../src/capability-reality.js';
import { makeConsoleServer } from '../src/console-server.js';

const digest = 'a'.repeat(64);
function packageFixture() { return {
  schema: 't5.capability-package.v1', id: 'company-inventory', version: '1.0.0',
  knowledge: { summary: '회사 재고를 공식 API로 조회하는 방법', constraints: ['쓰기 작업은 별도 action'],
    sources: [{ url: 'https://docs.example.com/inventory', publisherIdentity: 'Example Company',
      purpose: '인증과 재고 endpoint 확인', lastVerifiedAt: '2026-08-27T12:00:00.000Z', volatile: true }] },
  manifest: { kind: 'declarative_http', source: { kind: 'git_exact_ref',
    locator: 'https://github.com/example/inventory-adapter', resolvedRef: 'commit:1234567890abcdef',
    artifactDigest: digest, publisherIdentity: 'example', signature: null, license: 'MIT' },
    platforms: ['darwin-arm64', 'win32-x64'], entrypoint: { kind: 'remote_http', value: 'https://api.example.com' },
    auth: { strategy: 'api_key', credentialOwner: 'T5 platform secret store', scopes: ['inventory:read'], redirectOrigins: [] },
    actions: [{ id: 'inventory-read', effect: 'observe', hosts: ['api.example.com'],
      idempotency: 'not_applicable', inputSchema: { type: 'object', additionalProperties: false,
        properties: { sku: { type: 'string' } }, required: ['sku'] } }],
    dependencies: [{ name: 'adapter-runtime', version: '1.0.0', digest }],
    isolation: { process: 'separate_process', filesystem: ['workspace:read'], network: ['api.example.com'] },
    lifecycle: { install: 'declarative', update: 'declarative', remove: 'declarative', rollback: 'declarative' },
    qualification: { fixtureId: 'inventory-loopback-v1', probeAction: 'inventory-read',
      expectedObservation: 'exact fixture SKU and quantity' } } };
}

test('Dock Knowledge와 Machine Manifest는 같은 package에서 분리되고 Knowledge는 실행 권한이 없다', () => {
  const value = validateCapabilityPackage(packageFixture());
  assert.equal(value.knowledge.sources[0].volatile, true);
  assert.equal(value.manifest.actions[0].hosts[0], 'api.example.com');
  assert.equal('actions' in value.knowledge, false);
  assert.equal(value.manifest.isolation.process, 'separate_process');
});

test('trustLevel·임의 lifecycle hook·열린 action schema·credential URL은 Machine Manifest가 아니다', () => {
  const trust = packageFixture(); trust.manifest.source.trustLevel = 'official';
  assert.throws(() => validateCapabilityPackage(trust), /source is invalid/u);
  const hook = packageFixture(); hook.manifest.lifecycle.install = 'node install.js';
  assert.throws(() => validateCapabilityPackage(hook), /lifecycle hooks/u);
  const open = packageFixture(); open.manifest.actions[0].inputSchema.additionalProperties = true;
  assert.throws(() => validateCapabilityPackage(open), /closed action input schema/u);
  const secretUrl = packageFixture(); secretUrl.knowledge.sources[0].url = 'https://user:secret@docs.example.com/';
  assert.throws(() => validateCapabilityPackage(secretUrl), /must be HTTPS/u);
});

test('획득·계정 연결·운영 lifecycle은 한 success로 합치지 않는다', () => {
  const qualifiedNeedsAuth = capabilityRealityFact({ id: 'inventory-api', label: '재고 API', kind: 'api',
    acquisition: 'qualified', connection: 'needs_connection', lifecycle: 'active' });
  assert.equal(qualifiedNeedsAuth.reality, 'needs_auth');
  assert.deepEqual(qualifiedNeedsAuth.axes, { acquisition: 'qualified', connection: 'needs_connection', lifecycle: 'active' });
  assert.equal(capabilityRealityFact({ id: 'inventory-api', acquisition: 'qualified', connection: 'ready',
    lifecycle: 'inactive' }).reality, 'available_inactive');
  assert.equal(capabilityRealityFact({ id: 'inventory-api', acquisition: 'qualified', connection: 'ready',
    lifecycle: 'active' }).reality, 'usable_now');
  assert.equal(capabilityRealityFact({ id: 'inventory-api', acquisition: 'source_observed', connection: 'unknown',
    lifecycle: 'candidate' }).reality, 'preparable');
});

test('Capability Reality는 현재 연결과 아직 실행 불가능한 catalog 후보를 같은 목록에서 구분한다', async () => {
  const observer = makeCapabilityRealityObserver({ connectionDoctor: { async inspect() { return {
    checkedAt: '2026-08-27T12:00:00.000Z', connections: [{ id: 'notion', label: 'Notion', category: 'workspace',
      state: 'connected', capabilities: { read: true }, userSafeSummary: '연결됨' },
    { id: 'broken-api', label: '고장난 API', category: 'workspace', state: 'needs_attention',
      capabilities: {}, userSafeSummary: '확인 필요' }] }; } },
    catalogSnapshot: { entries: [{ id: 'company-inventory', label: '회사 재고', category: 'business',
      capabilities: { read: true }, userSafeSummary: '준비 후보' }] } });
  const report = await observer.inspect();
  assert.equal(report.facts.find((item) => item.id === 'notion').reality, 'usable_now');
  assert.equal(report.facts.find((item) => item.id === 'broken-api').reality, 'degraded');
  assert.equal(report.facts.find((item) => item.id === 'company-inventory').reality, 'preparable');
});

test('CA1 사고 가족은 서비스 목록이 아니라 범용 실패 원리로 고정된다', async () => {
  const incidents = JSON.parse(await readFile(new URL('../config/s3-ca1-docking-incidents.json', import.meta.url), 'utf8'));
  assert.equal(incidents.incidents.length, 10);
  assert.equal(new Set(incidents.incidents.map((item) => item.id)).size, 10);
  assert.doesNotMatch(JSON.stringify(incidents), /naver|google|coupang/iu);
});

test('제품은 능력 부족이 확인된 뒤에만 작은 Capability Reality를 열고 후보를 usable로 꾸미지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-ca1-product-')); let turn = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    workspaceConnectionInspectors: [{ id: 'company-api', label: '회사 API', category: 'business',
      inspect: async () => ({ state: 'needs_connection', reason: 'credential_missing',
        userSafeSummary: '연결 정보가 필요해요.', capabilities: { read: false }, routes: [] }) }],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) { turn += 1;
      if (turn === 1) {
        assert.equal(input.tools.some((tool) => tool.name === 'capability_reality'), false);
        return { text: '', toolCalls: [{ id: 'find', name: 'tool_search', args: {
          query: 'current missing external capability reality',
        } }] };
      }
      if (turn === 2) {
        assert.equal(input.tools.some((tool) => tool.name === 'capability_reality'), true);
        return { text: '', toolCalls: [{ id: 'reality', name: 'capability_reality', args: {
          action: 'inspect', id: 'company-api',
        } }] };
      }
      const fact = JSON.parse(input.messages.at(-1).content).result.facts[0];
      assert.equal(fact.reality, 'needs_auth');
      assert.equal(fact.axes.acquisition, 'qualified');
      return { text: '회사 API는 존재하지만 현재 연결 정보가 필요해요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const answer = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '회사 API로 재고를 확인할 수 있어?' }) }).then((response) => response.json());
    assert.match(answer.reply, /연결 정보가 필요/u);
    const reality = await fetch(`${base}/capabilities/reality`).then((response) => response.json());
    assert.equal(reality.facts.find((item) => item.id === 'company-api').reality, 'needs_auth');
    assert.doesNotMatch(JSON.stringify(reality), /\/Users\/|credential_missing/u);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('CA1 evidence는 설치·custom coding·전략 Pack을 완료로 꾸미지 않는다', async () => {
  const evidence = JSON.parse(await readFile(new URL('../evidence/s3-ca1-docking-reality-completion-2026-08-27.json', import.meta.url), 'utf8'));
  const plan = await readFile(new URL('../../T5-THIRD-ACTIVATION-PREPARATION.md', import.meta.url), 'utf8');
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.verification.providerCalls, 0);
  assert.ok(evidence.notClaimed.some((item) => item.includes('S3-CA2 through S3-CA4')));
  assert.match(plan, /S3CA_CA1_COMPLETE_CA2_ACTIVE_LOCAL_POSITIVE_CONTROL/u);
  assert.doesNotMatch(JSON.stringify(evidence), /\/Users\/|C:\\Users\\|sk-[A-Za-z0-9]|-----BEGIN/u);
});
