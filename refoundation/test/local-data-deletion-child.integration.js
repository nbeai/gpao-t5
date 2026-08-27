import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function runChild(args) {
  const moduleUrl = new URL('../src/local-data-deletion.js', import.meta.url).href;
  const script = `import { writeFile } from 'node:fs/promises';
    import { deleteT5OwnedLocalData } from ${JSON.stringify(moduleUrl)};
    const [stateDir, connectionFile, receiptFile] = process.argv.slice(1);
    const receipt = await deleteT5OwnedLocalData({ stateDir, connectionFile,
      workspaceConnectionServices: [{ id: 'fixture', async disconnect() {} }],
      messengerCredentialStore: { async clear() {} },
      modelConnections: { async list() { return [{ id: 'primary' }]; }, async disconnect() {} } });
    await writeFile(receiptFile, JSON.stringify(receipt));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  });
  assert.equal(code, 0, stderr);
}

test('별도 product child가 T5 소유 경계를 지우고 외부 사용자 파일은 그대로 둔다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-local-delete-child-'));
  const stateDir = join(room, 'owned-state'); const connectionFile = join(room, 'owned-model', 'connection.json');
  const receiptFile = join(room, 'deletion-receipt.json'); const userFile = join(room, 'customer.xlsx');
  const backupFile = join(room, 'saved-elsewhere.t5backup');
  await Promise.all([mkdir(stateDir), mkdir(join(room, 'owned-model'))]);
  await Promise.all([writeFile(join(stateDir, 'work.json'), 'state'), writeFile(connectionFile, 'model'),
    writeFile(userFile, 'user'), writeFile(backupFile, 'backup')]);
  try {
    await runChild([stateDir, connectionFile, receiptFile]);
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    assert.equal(receipt.state, 'deleted');
    await assert.rejects(() => readFile(join(stateDir, 'work.json')), { code: 'ENOENT' });
    await assert.rejects(() => readFile(connectionFile), { code: 'ENOENT' });
    assert.equal(await readFile(userFile, 'utf8'), 'user');
    assert.equal(await readFile(backupFile, 'utf8'), 'backup');
  } finally { await rm(room, { recursive: true, force: true }); }
});
