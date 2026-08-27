import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { deleteT5OwnedLocalData } from '../src/local-data-deletion.js';

test('전체 로컬 삭제는 T5 소유 연결·자격·상태만 지우고 사용자 파일과 별도 backup은 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-local-delete-'));
  const stateDir = join(room, 'owned', 'state'); const connectionFile = join(room, 'owned', 'models', 'connections.json');
  const userFile = join(room, 'user-work.xlsx'); const backup = join(room, 'separate.t5backup'); const calls = [];
  await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(join(connectionFile, '..'), { recursive: true })]);
  await Promise.all([writeFile(join(stateDir, 'work.json'), 'state'), writeFile(connectionFile, 'models'),
    writeFile(userFile, 'user'), writeFile(backup, 'backup')]);
  const modelIds = ['primary', 'fallback'];
  try {
    const receipt = await deleteT5OwnedLocalData({ stateDir, connectionFile,
      workspaceConnectionServices: [{ id: 'notion', async disconnect() { calls.push('connection:notion'); } }],
      messengerCredentialStore: { async clear(provider) { calls.push(`messenger:${provider}`); } },
      modelConnections: { async list() { return modelIds.map((id) => ({ id })); },
        async disconnect(id) { calls.push(`model:${id}`); } },
    });
    assert.deepEqual(calls, ['connection:notion', 'messenger:telegram', 'model:primary', 'model:fallback']);
    assert.equal(receipt.state, 'deleted'); assert.equal(receipt.userWorkspaceDeleted, false);
    await assert.rejects(() => readFile(join(stateDir, 'work.json')), { code: 'ENOENT' });
    await assert.rejects(() => readFile(connectionFile), { code: 'ENOENT' });
    assert.equal(await readFile(userFile, 'utf8'), 'user'); assert.equal(await readFile(backup, 'utf8'), 'backup');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('자격 삭제 실패는 state와 model metadata를 지우거나 완료 Receipt를 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-local-delete-fault-'));
  const stateDir = join(room, 'state'); const connectionFile = join(room, 'models', 'connections.json');
  await Promise.all([mkdir(stateDir), mkdir(join(connectionFile, '..'), { recursive: true })]);
  await Promise.all([writeFile(join(stateDir, 'work.json'), 'state'), writeFile(connectionFile, 'models')]);
  try {
    await assert.rejects(() => deleteT5OwnedLocalData({ stateDir, connectionFile,
      workspaceConnectionServices: [{ id: 'notion', async disconnect() { throw new Error('keychain unavailable'); } }],
      messengerCredentialStore: { async clear() {} },
      modelConnections: { async list() { return [{ id: 'primary' }]; }, async disconnect() {} },
    }), /keychain unavailable/u);
    assert.equal(await readFile(join(stateDir, 'work.json'), 'utf8'), 'state');
    assert.equal(await readFile(connectionFile, 'utf8'), 'models');
  } finally { await rm(room, { recursive: true, force: true }); }
});
