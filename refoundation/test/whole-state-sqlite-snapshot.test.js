import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { ConnectionStateStore } from '../src/connection-state-store.js';
import { makeT5WholeStateRegistry } from '../src/t5-whole-state.js';
import { stageWholeStateGeneration } from '../src/whole-state-bundle.js';

test('live connection SQLite는 WAL sidecar 복사가 아니라 online backup snapshot으로 generation에 들어간다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-sqlite-')); const state = join(room, 'state');
  const file = join(state, 'connections', 'connection-state.sqlite'); const store = new ConnectionStateStore(file);
  let stage = null;
  try {
    store.database.exec('PRAGMA journal_mode=WAL');
    store.beginOAuthAttempt({ connectionKey: 'a'.repeat(64), state: 'oauth-state', secretRef: 'platform-secret-ref',
      redirectUri: 'http://127.0.0.1:4185/callback', requestedScopes: ['read'] });
    const registry = await makeT5WholeStateRegistry(state); const manifest = await registry.manifest({
      generationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-08-27T00:00:00.000Z' });
    const connections = manifest.components.find((component) => component.id === 'connections');
    assert.equal(connections.capture, 'sqlite_online');
    assert.deepEqual(connections.files.map((item) => item.path), ['connections/connection-state.sqlite']);
    stage = await stageWholeStateGeneration({ registry, stagingParent: room, manifest });
    const snapshot = new DatabaseSync(join(stage.payloadRoot, 'connections', 'connection-state.sqlite'), { readOnly: true });
    try {
      assert.equal(snapshot.prepare('SELECT count(*) AS count FROM oauth_attempts').get().count, 1);
      assert.equal(snapshot.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    } finally { snapshot.close(); }
    assert.equal(stage.manifest.components.find((component) => component.id === 'connections').files[0].capture,
      'sqlite_online');
  } finally { store.close(); if (stage) await rm(stage.root, { recursive: true, force: true });
    await rm(room, { recursive: true, force: true }); }
});
