import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { AttachmentStore } from '../src/attachment-store.js';
import { makeAttachmentTool } from '../src/attachment-hand.js';
import { ExecutableOutputOperationStore } from '../src/executable-output-operation.js';
import { workspaceRuntimeContextBlock } from '../src/workspace-runtime-context.js';

const SESSION = '88888888-8888-4888-8888-888888888888';

function args(action, overrides = {}) {
  return { action, attachmentId: null, filePath: null,
    maxChars: null, maxCells: null, maxPages: null,
    outputName: null, resultRelativePath: null, expectedResultJson: null,
    expectedStdoutIncludes: null, operationHandle: null, ...overrides };
}

async function writeSource(sourceRoot) {
  await mkdir(join(sourceRoot, 'package'), { recursive: true });
  await Promise.all([
    writeFile(join(sourceRoot, 'package', '실행.command'), [
      '#!/bin/zsh', 'cd "${0:A:h}"',
      "printf '{\"totalItems\":4,\"needsOrderCount\":2}' > runtime-result.json",
      "printf 'ITEMS=4 NEEDS_ORDER=2\\n'", '',
    ].join('\n')),
    writeFile(join(sourceRoot, 'package', 'README.txt'), '실행.command를 실행합니다.\n'),
    writeFile(join(sourceRoot, 'package', 'inventory.json'), '{"items":[1,2,3,4]}'),
  ]);
}

test('workspace observation은 bounded current facts만 만들고 private operation facts를 내지 않는다', () => {
  const block = workspaceRuntimeContextBlock({
    absoluteRoot: '/workspace', writableRoots: ['/workspace'], activeOutputOperations: [{
      handle: 'operation-1', sourceRoot: '/workspace/.t5/source', outputName: 'result.zip', state: 'source_open',
      expectedResultJson: '{"secret":true}', artifactSha256: 'a'.repeat(64),
    }],
  });
  assert.match(block, /^\[T5 CURRENT WORKSPACE/u);
  assert.match(block, /absoluteRoot=\/workspace/u);
  assert.match(block, /currentRunOutputRoot="\/workspace\/\.t5\/source"/u);
  assert.doesNotMatch(block, /secret|artifactSha256|aaaaaaaa/u);
  assert.ok(Buffer.byteLength(block, 'utf8') < 8 * 1024);
});

test('begin 다음 model call에 sourceRoot가 보이고 finalize 뒤 사라지며 transcript에는 누적되지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-workspace-context-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const attachmentStore = new AttachmentStore(join(room, 'attachments'));
  const operations = new ExecutableOutputOperationStore({ attachmentStore, workspace });
  const attachment = makeAttachmentTool({ store: attachmentStore, sessionId: SESSION,
    workspace, runId: 'workspace-run', authorizeOutputPath: () => false,
    executableOperationStore: operations });
  let call = 0; let observedSourceRoot = null;
  try {
    const result = await runAgent({ request: '재고 확인 ZIP을 만들어줘', tools: [attachment],
      runtimeContextProvider: async () => workspaceRuntimeContextBlock({
        absoluteRoot: workspace, writableRoots: [workspace],
        activeOutputOperations: await operations.activeProjection({
          sessionId: SESSION, runId: 'workspace-run',
        }),
      }), model: { async respond(input) {
        call += 1;
        if (call === 1) {
          assert.match(input.runtimeContext, /activeOutputOperations=\[\]/u);
          return { text: '', toolCalls: [{ id: 'begin', name: 'attachment', args: args('begin_executable_output', {
            outputName: '재고확인.zip', resultRelativePath: 'package/runtime-result.json',
            expectedResultJson: '{"totalItems":4,"needsOrderCount":2}',
            expectedStdoutIncludes: ['ITEMS=4 NEEDS_ORDER=2'],
          }) }] };
        }
        if (call === 2) {
          const receipt = JSON.parse(input.messages.at(-1).content);
          observedSourceRoot = receipt.result.sourceDirectory;
          assert.match(input.runtimeContext, new RegExp(observedSourceRoot.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
          await writeSource(observedSourceRoot);
          return { text: '', toolCalls: [{ id: 'finalize', name: 'attachment', args: args('finalize_executable_output', {
            operationHandle: receipt.result.operationHandle,
          }) }] };
        }
        assert.match(input.runtimeContext, /activeOutputOperations=\[\]/u);
        assert.match(input.runtimeContext, /currentRunOutputRoot=null/u);
        return { text: '완성했어요.', toolCalls: [] };
      } } });
    assert.equal(result.status, 'completed'); assert.equal(result.answer, '완성했어요.');
    assert.equal(result.receipts.at(-1).result.state, 'registered');
    assert.doesNotMatch(JSON.stringify(result.transcript), /T5 CURRENT WORKSPACE/u);
    assert.equal((await operations.activeProjection({ sessionId: SESSION, runId: 'workspace-run' })).length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('operation projection은 exact session/run만 최대 4개 내보내고 다른 소유자는 볼 수 없다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-workspace-context-scope-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const attachmentStore = new AttachmentStore(join(room, 'attachments'));
  const operations = new ExecutableOutputOperationStore({ attachmentStore, workspace });
  try {
    for (let index = 0; index < 5; index += 1) await operations.begin({
      sessionId: SESSION, runId: 'run-a', outputName: `result-${index}.zip`,
      resultRelativePath: `package/result-${index}.json`, expectedResultJson: '{}',
      expectedStdoutIncludes: [`READY-${index}`],
    });
    const own = await operations.activeProjection({ sessionId: SESSION, runId: 'run-a' });
    assert.equal(own.length, 4);
    assert.equal(JSON.stringify(own).includes('expectedResultJson'), false);
    assert.deepEqual(await operations.activeProjection({ sessionId: SESSION, runId: 'run-b' }), []);
    assert.deepEqual(await operations.activeProjection({ sessionId: 'foreign', runId: 'run-a' }), []);
  } finally { await rm(room, { recursive: true, force: true }); }
});
