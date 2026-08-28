import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { admitExecProgramContract } from '../src/exec-program-contract.js';
import { executePythonProgramQualification, observePythonInterpreter } from '../src/ephemeral-program-python.js';
import { createWorkspaceSnapshot, removeWorkspaceSnapshot,
  snapshotProgramBindings } from '../src/ephemeral-program-snapshot.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const WORK = '22222222-2222-4222-8222-222222222222';
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function room() {
  const root = await mkdtemp(join(tmpdir(), 't5-snapshot-qualification-'));
  const workspace = join(root, 'workspace'); const snapshots = join(root, 'snapshots');
  await mkdir(join(workspace, '입력'), { recursive: true }); await mkdir(join(workspace, '결과'));
  await writeFile(join(workspace, '입력', 'a.csv'), 'name,amount\nA,10\n');
  await writeFile(join(workspace, '입력', 'b.csv'), 'name,amount\nB,20\n');
  await writeFile(join(workspace, '처리기준.md'), 'amount 합계');
  return { root, workspace, snapshots };
}

test('APFS clone generation은 workspace 전체를 exact hash로 고정하고 원본 COW 변경과 분리한다', async () => {
  const app = await room();
  try {
    const { snapshot, receipt } = await createWorkspaceSnapshot({ workspace: app.workspace,
      snapshotRoot: app.snapshots, makeId: () => '12345678' });
    assert.equal(receipt.state, 'snapshot_read_only'); assert.equal(receipt.fileCount, 3);
    assert.equal(receipt.exactActualReadSet, false); assert.equal(receipt.providerBytes, 0);
    assert.match(receipt.manifestSha256, /^[a-f0-9]{64}$/u);
    const original = join(app.workspace, '입력', 'a.csv'); const copied = join(snapshot.directory, '입력', 'a.csv');
    assert.equal(hash(await readFile(copied)), hash(await readFile(original)));
    assert.equal((await lstat(copied)).mode & 0o222, 0);
    await writeFile(original, 'name,amount\nA,99\n');
    assert.match(await readFile(copied, 'utf8'), /A,10/u);
    assert.equal((await removeWorkspaceSnapshot(snapshot)).removed, true);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('snapshot source symlink·hardlink와 generation 중 원본 변경은 candidate를 남기지 않는다', async () => {
  for (const mode of ['symlink', 'hardlink', 'stale']) {
    const app = await room();
    try {
      const source = join(app.workspace, '입력', 'a.csv');
      if (mode === 'symlink') await symlink(source, join(app.workspace, '입력', 'alias.csv'));
      if (mode === 'hardlink') await link(source, join(app.workspace, '입력', 'alias.csv'));
      const clone = mode === 'stale' ? async (from, to) => {
        const { execFile } = await import('node:child_process');
        await new Promise((resolveCopy, reject) => execFile('/bin/cp', ['-c', from, to],
          (error) => error ? reject(error) : resolveCopy()));
        if (from.endsWith('a.csv')) await writeFile(from, 'name,amount\nA,77\n');
      } : undefined;
      await assert.rejects(() => createWorkspaceSnapshot({ workspace: app.workspace,
        snapshotRoot: app.snapshots, makeId: () => '12345678', ...(clone ? { clone } : {}) }),
      /symlink|linked file|changed during generation/u);
      const entries = await import('node:fs/promises').then(({ readdir }) => readdir(app.snapshots));
      assert.deepEqual(entries, []);
    } finally { await rm(app.root, { recursive: true, force: true }); }
  }
});

test('동일 Python source는 snapshot universe를 RecordRef로 받아 원본 write 없이 실행된다', async () => {
  const app = await room();
  try {
    const before = hash(await readFile(join(app.workspace, '입력', 'a.csv')));
    const { snapshot } = await createWorkspaceSnapshot({ workspace: app.workspace,
      snapshotRoot: app.snapshots, makeId: () => '12345678' });
    const bound = snapshotProgramBindings(snapshot, { sessionId: SESSION, workId: WORK });
    const source = [
      'import csv', 'from pathlib import Path', 'total = 0',
      "for path in sorted(Path('입력').glob('*.csv')):",
      "    for row in csv.DictReader(path.open()): total += int(row['amount'])",
      "Path('결과').mkdir()",
      "Path('결과/합계.csv').write_text('total\\n' + str(total) + '\\n')",
    ].join('\n');
    const contract = admitExecProgramContract({ workId: WORK, revision: 1, temporary: true,
      sourceLanguage: 'python', source, inputs: bound.bindings,
      outputs: [{ relativePath: '결과/합계.csv', kind: 'text/csv', category: 'publishable' }],
      requirements: { filesystem: true, network: false, childProcess: false, packages: false },
      interpreter: '/usr/bin/python3' });
    const interpreter = await observePythonInterpreter({ path: '/usr/bin/python3' });
    const result = await executePythonProgramQualification({ contract, interpreter,
      sourceReader: bound.sourceReader, processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }),
      scratchRoot: join(app.root, 'program-scratch'), protectedReadRoots: [app.workspace] });
    assert.equal(result.receipt.state, 'actual_output_unverified');
    assert.equal(result.execution.contract.source, source); assert.equal(result.receipt.translated, false);
    assert.match(result.execution.outputs[0].bytes.toString('utf8'), /30/u);
    assert.equal(hash(await readFile(join(app.workspace, '입력', 'a.csv'))), before);
    await assert.rejects(() => readFile(join(app.workspace, '결과', '합계.csv')), /ENOENT/u);
    await removeWorkspaceSnapshot(snapshot);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});
