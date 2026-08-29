import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeAttachmentTool } from '../src/attachment-hand.js';
import { AttachmentStore } from '../src/attachment-store.js';
import { explainShellCommand } from '../src/command-explainer.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { makeSnapshotProgramAdapter } from '../src/snapshot-program-adapter.js';
import { makeWorkspacePatchTool } from '../src/workspace-patch-tool.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const WORK = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const args = (overrides = {}) => ({ action: 'register_output', attachmentId: null,
  filePath: null, maxChars: null, maxCells: null, maxPages: null, outputName: null,
  resultRelativePath: null, expectedResultJson: null, expectedStdoutIncludes: null,
  operationHandle: null, outputHandle: null, sourceManifestId: null, query: null,
  pageHandles: null, ...overrides });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 't5-s4g-handoff-audit-'));
  const workspace = join(root, 'workspace'); const state = join(root, 'state');
  await mkdir(join(workspace, '입력'), { recursive: true }); await mkdir(join(workspace, '결과'));
  await writeFile(join(workspace, '입력', '자료.csv'), 'name,amount\nA,10\nB,20\n');
  const workspacePatchTool = makeWorkspacePatchTool({ workspace,
    stateRoot: join(state, 'authoring'), sessionId: SESSION });
  const adapter = makeSnapshotProgramAdapter({ workspace, snapshotRoot: join(state, 'snapshots'),
    scratchRoot: join(state, 'scratch'), sessionId: SESSION, workId: WORK, revision: 1,
    processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }), workspacePatchTool,
    executionPath: '/usr/bin:/bin', protectedReadRoots: [workspace] });
  const source = [
    'from pathlib import Path',
    "Path('결과/합계.csv').write_text('total\\n30\\n')",
    "Path('결과/행수.csv').write_text('rows\\n2\\n')",
  ].join('\n');
  const command = `python3 - <<'PY'\n${source}\nPY`;
  const outcome = await adapter.execute({ args: { effect: { kind: 'local_change',
    targets: ['결과/합계.csv', '결과/행수.csv'] } },
  commandExplanation: await explainShellCommand(command), cwd: workspace });
  const store = new AttachmentStore(join(state, 'attachments'));
  return { root, workspace, state, outcome, store,
    first: join(workspace, '결과', '합계.csv'), second: join(workspace, '결과', '행수.csv') };
}

test('G verified publication은 현재 produced-output identity를 자동 만들지 않는다', async () => {
  const app = await fixture();
  try {
    assert.equal(app.outcome.result.state, 'published_verified_cleaned');
    assert.equal(app.outcome.result.outputs.length, 2);
    assert.ok(app.outcome.result.outputs.every((output) => output.outputHandle == null));
    assert.equal((await app.store.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 0);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('outputHandle 부재만으로 attachment 실패가 확정되지는 않는다', async () => {
  const app = await fixture();
  try {
    const denied = makeAttachmentTool({ store: app.store, sessionId: SESSION,
      workspace: app.workspace, runId: RUN, authorizeOutputPath: () => false });
    await assert.rejects(denied.execute(args({ filePath: app.first })),
      /output path is not authorized by the current request or run/u);
    await assert.rejects(denied.execute(args()), /filePath or outputHandle is required/u);

    const allowed = makeAttachmentTool({ store: app.store, sessionId: SESSION,
      workspace: app.workspace, runId: RUN, authorizeOutputPath: (path) => path === app.first });
    const registered = await allowed.execute(args({ filePath: app.first }));
    assert.equal(registered.state, 'registered');
    assert.equal(registered.outputHandle, undefined);
    assert.equal((await app.store.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 0);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});
