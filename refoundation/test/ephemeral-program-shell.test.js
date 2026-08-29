import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { executeSnapshotShellQualification } from '../src/ephemeral-program-shell.js';
import { createWorkspaceSnapshot, removeWorkspaceSnapshot } from '../src/ephemeral-program-snapshot.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 't5-snapshot-shell-')); const workspace = join(root, 'workspace');
  await mkdir(join(workspace, '입력'), { recursive: true }); await mkdir(join(workspace, '결과'));
  await writeFile(join(workspace, '입력', 'data.txt'), 'A\nB\n');
  const { snapshot } = await createWorkspaceSnapshot({ workspace, snapshotRoot: join(root, 'snapshots') });
  return { root, workspace, snapshot, registry: new ManagedProcessRegistry({ platform: 'darwin' }),
    scratchRoot: join(root, 'scratch') };
}

test('복합 shell은 exact command 그대로 writable snapshot에서 실행하고 declared output만 반환한다', async () => {
  const app = await fixture();
  try {
    const command = ["mkdir -p 결과 .temporary", "python3 - <<'PY'", 'from pathlib import Path',
      "rows=Path('입력/data.txt').read_text().splitlines()",
      "Path('결과/out.txt').write_text(str(len(rows))+'\\n')",
      "Path('.temporary/debug.txt').write_text('internal')", 'PY',
      "test \"$(cat 결과/out.txt)\" = 2"].join('\n');
    const result = await executeSnapshotShellQualification({ command, snapshot: app.snapshot,
      outputs: [{ relativePath: '결과/out.txt', kind: 'text/plain', category: 'publishable' }],
      processRegistry: app.registry, ownerId: 'work-shell', scratchRoot: app.scratchRoot,
      protectedReadRoots: [app.workspace] });
    assert.ok(result.execution, JSON.stringify(result.receipt));
    assert.equal(result.execution.state, 'shell_output_unverified');
    assert.equal(result.execution.outputs[0].bytes.toString('utf8'), '2\n');
    assert.ok(result.receipt.temporaryCount >= 1); assert.equal(result.receipt.exactCommand, true);
    assert.equal(await readFile(join(app.workspace, '입력', 'data.txt'), 'utf8'), 'A\nB\n');
    await assert.rejects(() => readFile(join(app.workspace, '결과', 'out.txt')), /ENOENT/u);
  } finally { await removeWorkspaceSnapshot(app.snapshot).catch(() => {}); await rm(app.root, { recursive: true, force: true }); }
});

test('snapshot shell의 network·outside write는 declared output publication 전에 차단된다', async () => {
  for (const command of [
    "curl -fsS http://127.0.0.1:9 > 결과/out.txt",
    "printf bad > ../outside.txt; printf ok > 결과/out.txt",
  ]) {
    const app = await fixture();
    try {
      const result = await executeSnapshotShellQualification({ command, snapshot: app.snapshot,
        outputs: [{ relativePath: '결과/out.txt', kind: 'text/plain', category: 'publishable' }],
        processRegistry: app.registry, ownerId: 'work-shell-deny', scratchRoot: app.scratchRoot,
        protectedReadRoots: [app.workspace] });
      assert.equal(result.execution, null); assert.equal(result.receipt.state, 'shell_failed_no_publication');
      await assert.rejects(() => readFile(join(app.workspace, '결과', 'out.txt')), /ENOENT/u);
    } finally { await removeWorkspaceSnapshot(app.snapshot).catch(() => {}); await rm(app.root, { recursive: true, force: true }); }
  }
});
