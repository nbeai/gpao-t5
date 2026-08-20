import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCliCatalog, ManagedCliStore, makeCliAcquisitionTool } from '../src/managed-cli-store.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const officialCatalogFile = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'cli-catalog.json');

function fixtureCatalog(bytes, versions = ['1.0.0']) {
  const bytesFor = (version) => bytes instanceof Map ? bytes.get(version) : bytes;
  return {
    schema: 't5.cli-catalog.v1',
    packages: [{
      id: 'json-tool', title: 'JSON Tool', command: 'json-tool', description: 'fixture',
      officialSource: 'https://example.test/json-tool',
      license: { spdx: 'MIT', url: 'https://example.test/license' },
      defaultVersion: versions.at(-1),
      versions: Object.fromEntries(versions.map((version) => [version, {
        releaseUrl: `https://example.test/releases/${version}`,
        assets: { 'darwin-arm64': { url: `https://example.test/${version}/json-tool`, sha256: sha256(bytesFor(version)) } },
      }])),
    }],
  };
}

test('catalog는 정확한 플랫폼 자산·HTTPS·SHA와 중복 없는 command만 허용한다', async () => {
  const bytes = Buffer.from('fixture');
  const catalog = await loadCliCatalog(fixtureCatalog(bytes));
  assert.equal(catalog.byId.get('json-tool').defaultVersion, '1.0.0');
  assert.equal(catalog.asset('json-tool', '1.0.0', 'darwin', 'arm64').sha256, sha256(bytes));
  await assert.rejects(() => loadCliCatalog({ ...fixtureCatalog(bytes), packages: [
    fixtureCatalog(bytes).packages[0], fixtureCatalog(bytes).packages[0],
  ] }), /duplicate/u);
  const unsafe = fixtureCatalog(bytes); unsafe.packages[0].versions['1.0.0'].assets['darwin-arm64'].url = 'http://example.test/tool';
  await assert.rejects(() => loadCliCatalog(unsafe), /HTTPS/u);
});

test('공식 jq 후보는 보안 수정판 1.8.2와 여섯 플랫폼 checksum을 정확히 고정한다', async () => {
  const catalog = await loadCliCatalog(officialCatalogFile); const entry = catalog.byId.get('jq');
  assert.equal(entry.defaultVersion, '1.8.2'); assert.equal(entry.license.spdx, 'MIT');
  assert.deepEqual(Object.keys(entry.versions['1.8.2'].assets).sort(), [
    'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64',
  ]);
  assert.equal(catalog.asset('jq', '1.8.2', 'darwin', 'arm64').sha256, '2d75340ba57a4b4b4c8708a21c2dc8e958a48aaa8bba13b27f77f6e4c0eca07e');
});

test('검증된 binary만 0700 managed bin에 원자 설치되고 제거·복원된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-managed-cli-'));
  const bytes = Buffer.from('#!/bin/sh\nprintf json-tool-1.0.0\n');
  const calls = [];
  try {
    const catalog = await loadCliCatalog(fixtureCatalog(bytes));
    const store = new ManagedCliStore({
      root: room, catalog, platform: 'darwin', architecture: 'arm64',
      fetchImpl: async (url) => { calls.push(url); return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } }); },
      verifyExecutable: async ({ path, expectedVersion }) => { calls.push([path, expectedVersion]); return { version: expectedVersion }; },
    });
    const installed = await store.install('json-tool');
    assert.equal(installed.state, 'installed');
    assert.equal(installed.version, '1.0.0');
    assert.equal((await stat(join(room, 'bin/json-tool'))).mode & 0o777, 0o700);
    assert.equal(await readFile(join(room, 'bin/json-tool'), 'utf8'), bytes.toString());
    assert.equal((await store.install('json-tool')).state, 'already_installed');
    assert.equal(calls.filter((item) => typeof item === 'string').length, 1);
    assert.equal((await store.remove('json-tool')).recoverable, true);
    await assert.rejects(() => access(join(room, 'bin/json-tool')));
    assert.equal((await store.restore('json-tool')).state, 'restored');
    assert.equal(await readFile(join(room, 'bin/json-tool'), 'utf8'), bytes.toString());
    assert.match(await readFile(join(room, 'cli-lifecycle.jsonl'), 'utf8'), /"installed".*"removed".*"restored"/s);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('hash 불일치·과대 응답·중단 download는 실행 또는 활성 파일을 남기지 않는다', async () => {
  for (const kind of ['hash', 'large', 'network']) {
    const room = await mkdtemp(join(tmpdir(), `t5-managed-cli-${kind}-`));
    const expected = Buffer.from('expected'); const actual = Buffer.from('different');
    let executed = 0;
    try {
      const store = new ManagedCliStore({
        root: room, catalog: await loadCliCatalog(fixtureCatalog(expected)), platform: 'darwin', architecture: 'arm64', maxBytes: kind === 'large' ? 8 : 100,
        fetchImpl: async () => {
          if (kind === 'network') throw new Error('network interrupted');
          return new Response(kind === 'large' ? Buffer.alloc(9) : actual, { status: 200 });
        },
        verifyExecutable: async () => { executed += 1; return {}; },
      });
      await assert.rejects(() => store.install('json-tool'), kind === 'hash' ? /SHA-256/u : kind === 'large' ? /large/u : /network interrupted/u);
      assert.equal(executed, 0);
      await assert.rejects(() => access(join(room, 'bin/json-tool')));
    } finally { await rm(room, { recursive: true, force: true }); }
  }
});

test('managed version·trash의 symlink는 root 밖 읽기나 복원으로 승격하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-managed-cli-symlink-')); const outside = join(room, 'outside');
  const bytes = Buffer.from('trusted');
  try {
    await mkdir(outside); await writeFile(join(outside, 'json-tool'), bytes);
    const catalog = await loadCliCatalog(fixtureCatalog(bytes));
    const store = new ManagedCliStore({ root: join(room, 'managed'), catalog, platform: 'darwin', architecture: 'arm64', fetchImpl: async () => new Response(bytes), verifyExecutable: async () => ({}) });
    await store.ensure(); await mkdir(join(store.versions, 'json-tool'));
    await symlink(outside, join(store.versions, 'json-tool/1.0.0'));
    await assert.rejects(() => store.install('json-tool'), /symlink/u);
    await rm(join(store.versions, 'json-tool/1.0.0'));
    await symlink(join(outside, 'json-tool'), join(store.trash, 'json-tool-1.0.0-1-json-tool'));
    await assert.rejects(() => store.restore('json-tool'), /not found/u);
    await assert.rejects(() => access(store.binaryPath('json-tool')));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('업데이트 뒤 이전 검증본으로 rollback하고 PATH는 T5 managed bin만 앞에 붙인다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-managed-cli-rollback-'));
  const versions = new Map([['1.0.0', Buffer.from('one')], ['2.0.0', Buffer.from('two')]]);
  try {
    const store = new ManagedCliStore({
      root: room, catalog: await loadCliCatalog(fixtureCatalog(versions, [...versions.keys()])), platform: 'darwin', architecture: 'arm64',
      fetchImpl: async (url) => { const version = url.includes('2.0.0') ? '2.0.0' : '1.0.0'; return new Response(versions.get(version), { status: 200 }); },
      verifyExecutable: async ({ expectedVersion }) => ({ version: expectedVersion }),
    });
    await store.install('json-tool', { version: '1.0.0' });
    await store.install('json-tool', { version: '2.0.0' });
    assert.equal((await store.status('json-tool')).activeVersion, '2.0.0');
    assert.equal((await store.rollback('json-tool')).version, '1.0.0');
    assert.equal(await readFile(join(room, 'bin/json-tool'), 'utf8'), 'one');
    assert.equal(store.prependPath('/usr/bin'), `${join(room, 'bin')}:/usr/bin`);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('모델 도구는 임의 URL을 받지 않고 reversible local change에서만 준비한다', async () => {
  const bytes = Buffer.from('fixture');
  const catalog = await loadCliCatalog(fixtureCatalog(bytes));
  const calls = [];
  const tool = makeCliAcquisitionTool({
    store: { catalog, installed: async () => [], install: async (id) => (calls.push(id), { state: 'installed', id }), status: async () => ({ state: 'not_installed' }), remove: async () => ({}), restore: async () => ({}), rollback: async () => ({}) },
    authorizeEffect: async () => ({ allowed: true }),
  });
  assert.equal(tool.parameters.properties.url, undefined);
  assert.equal((await tool.execute({ action: 'search', id: null, version: null })).packages[0].id, 'json-tool');
  assert.equal((await tool.preflight({ action: 'install', effect: { kind: 'observe' } })).allowed, false);
  assert.equal((await tool.execute({ action: 'install', id: 'json-tool', version: null })).state, 'installed');
  assert.deepEqual(calls, ['json-tool']);
});
