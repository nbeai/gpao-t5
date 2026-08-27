import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WholeStateComponentRegistry } from '../src/whole-state-component-registry.js';

test('component registry는 drained generation의 portable file facts와 restore 관계만 만든다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-state-registry-'));
  try {
    await mkdir(join(room, 'work')); await mkdir(join(room, 'automation'));
    await writeFile(join(room, 'console-sessions.json'), '{"version":1,"sessions":[]}');
    await writeFile(join(room, 'work', 'events.jsonl'), '{"schema":"t5.work-event.v1"}\n');
    await writeFile(join(room, 'automation', 'state.json'), '{"schema":"t5.automation-store.v1"}');
    const registry = new WholeStateComponentRegistry(room);
    registry.register({ id: 'sessions', files: ['console-sessions.json'], restoreOrder: 10 });
    registry.register({ id: 'work', files: ['work/events.jsonl'], restoreOrder: 20,
      relationships: ['sessions'] });
    registry.register({ id: 'automation', files: ['automation/state.json'], restoreOrder: 30,
      relationships: ['sessions', 'work'] });
    const manifest = await registry.manifest({ generationId: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-08-27T00:00:00.000Z' });
    assert.deepEqual(manifest.components.map((item) => item.id), ['sessions', 'work', 'automation']);
    assert.ok(manifest.components.every((item) => item.state === 'included'));
    assert.equal(manifest.sourceRootIncluded, false); assert.equal(manifest.secretPlaintextIncluded, false);
    assert.doesNotMatch(JSON.stringify(manifest), new RegExp(room.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('secret path·root escape·symlink·required missing은 payload copy 전에 닫힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-state-reject-'));
  try {
    const registry = new WholeStateComponentRegistry(room);
    assert.throws(() => registry.register({ id: 'credential', files: ['messenger/messenger-credentials.json'], restoreOrder: 1 }),
      { code: 'T5_BACKUP_SECRET_PATH_FORBIDDEN' });
    assert.throws(() => registry.register({ id: 'escape', files: ['../outside'], restoreOrder: 1 }), /portable/u);
    registry.register({ id: 'required-state', files: ['missing.json'], restoreOrder: 1 });
    await assert.rejects(() => registry.manifest({ generationId: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-08-27T00:00:00.000Z' }), { code: 'T5_BACKUP_REQUIRED_COMPONENT_UNAVAILABLE' });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('restore 관계는 등록된 앞선 component만 가리켜야 한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-state-relationship-'));
  try {
    await writeFile(join(room, 'state.json'), '{}');
    const registry = new WholeStateComponentRegistry(room);
    registry.register({ id: 'work', files: ['state.json'], restoreOrder: 10, relationships: ['sessions'] });
    await assert.rejects(() => registry.manifest({ generationId: '33333333-3333-4333-8333-333333333333',
      createdAt: '2026-08-27T00:00:00.000Z' }), /relationship/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
