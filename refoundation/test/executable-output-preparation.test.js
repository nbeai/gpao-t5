import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeAttachmentTool } from '../src/attachment-hand.js';
import { makeExecutableOutputQualifier } from '../src/executable-output-qualification.js';
import { ExecutableOutputOperationStore } from '../src/executable-output-operation.js';
import { inspectZipArchive } from '../src/archive-safety.js';

const SESSION = '77777777-7777-4777-8777-777777777777';

async function fixture(runId = 'operation-run') {
  const room = await mkdtemp(join(tmpdir(), 't5-executable-operation-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const store = new AttachmentStore(join(room, 'attachments'));
  const tool = makeAttachmentTool({ store, sessionId: SESSION, workspace, runId,
    authorizeOutputPath: () => false });
  return { room, workspace, store, tool, runId,
    async close() { await rm(room, { recursive: true, force: true }); } };
}

function args(action, overrides = {}) {
  return {
    action, attachmentId: null, filePath: null,
    maxChars: null, maxCells: null, maxPages: null,
    outputName: null, resultRelativePath: null, expectedResultJson: null,
    expectedStdoutIncludes: null, operationHandle: null,
    ...overrides,
  };
}

async function begin(app, overrides = {}) {
  return app.tool.execute(args('begin_executable_output', {
    outputName: '재고확인.zip', resultRelativePath: 'package/runtime-result.json',
    expectedResultJson: '{"totalItems":4,"needsOrderCount":2}',
    expectedStdoutIncludes: ['ITEMS=4 NEEDS_ORDER=2'], ...overrides,
  }));
}

async function writeGoodSource(sourceDirectory, { resultPrepackaged = false, broken = false,
  extraLauncher = false, extraGuide = false, arbitraryPurposeFact = false } = {}) {
  const packageDir = join(sourceDirectory, 'package'); await mkdir(packageDir, { recursive: true });
  const result = arbitraryPurposeFact
    ? '{"totalItems":4,"needsOrderCount":2,"missionAccomplished":true}'
    : '{"totalItems":4,"needsOrderCount":2}';
  const launcher = broken
    ? '#!/bin/zsh\ncd "${0:A:h}"\nprintf \'{"totalItems":4,"needsOrderCount":2}\' > runtime-result.json\nprintf \'ITEMS=4 NEEDS_ORDER=2\\n\'\nstatus=$?\nexit $status\n'
    : `#!/bin/zsh\ncd "\${0:A:h}"\nprintf '${result}' > runtime-result.json\nprintf 'ITEMS=4 NEEDS_ORDER=2\\n'\n`;
  await Promise.all([
    writeFile(join(packageDir, '실행.command'), launcher),
    writeFile(join(packageDir, 'README.txt'), 'Mac에서는 실행.command를 실행합니다.\n'),
    writeFile(join(packageDir, 'inventory.json'), '{"items":[1,2,3,4]}'),
  ]);
  if (resultPrepackaged) await writeFile(join(packageDir, 'runtime-result.json'), result);
  if (extraLauncher) await writeFile(join(packageDir, '다른.command'), launcher);
  if (extraGuide) await writeFile(join(packageDir, 'GUIDE.md'), '실행.command를 실행합니다.\n');
}

test('begin은 managed source만 주고 finalize가 ZIP·private contract·실행·등록을 한 번에 소유한다', async () => {
  const app = await fixture();
  try {
    const started = await begin(app);
    assert.equal(started.state, 'executable_output_started');
    assert.match(started.operationHandle, /^[0-9a-f-]{36}$/u);
    assert.equal(started.allowedPaths.length, 1);
    await writeGoodSource(started.sourceDirectory);
    const finalized = await app.tool.execute(args('finalize_executable_output', {
      operationHandle: started.operationHandle,
    }));
    assert.equal(finalized.state, 'registered');
    assert.equal(finalized.changed, true);
    assert.equal(finalized.qualification.passed, true);
    assert.equal(finalized.qualification.scope, 'wrapper_and_new_json_file_effect');
    assert.equal(finalized.artifact.originalName, '재고확인.zip');
    assert.equal((await app.store.list({ sessionId: SESSION })).length, 1);
    assert.equal(JSON.stringify(finalized).includes('totalItems'), false);
    assert.equal(JSON.stringify(finalized).includes('producerKind'), false);
  } finally { await app.close(); }
});

test('operation은 exact Run·Session에 결속되고 restart finalize와 완료 재호출이 idempotent다', async () => {
  const app = await fixture('run-a');
  try {
    const started = await begin(app); await writeGoodSource(started.sourceDirectory);
    const foreign = makeAttachmentTool({ store: app.store, sessionId: SESSION,
      workspace: app.workspace, runId: 'run-b', authorizeOutputPath: () => false });
    const rejected = await foreign.execute(args('finalize_executable_output', {
      operationHandle: started.operationHandle,
    }));
    assert.equal(rejected.code, 'operation_not_owned');
    const restarted = makeAttachmentTool({ store: app.store, sessionId: SESSION,
      workspace: app.workspace, runId: 'run-a', authorizeOutputPath: () => false });
    const first = await restarted.execute(args('finalize_executable_output', {
      operationHandle: started.operationHandle,
    }));
    const second = await restarted.execute(args('finalize_executable_output', {
      operationHandle: started.operationHandle,
    }));
    assert.equal(first.state, 'registered'); assert.equal(second.state, 'registered');
    assert.equal(second.changed, false);
    assert.equal(second.artifact.attachmentId, first.artifact.attachmentId);
    assert.equal((await app.store.list({ sessionId: SESSION })).length, 1);
  } finally { await app.close(); }
});

test('artifact 등록 뒤 crash는 qualified identity와 provider binding으로 모델 재실행 없이 복구한다', async () => {
  const app = await fixture('crash-run');
  try {
    const crashing = new ExecutableOutputOperationStore({ attachmentStore: app.store,
      workspace: app.workspace, afterArtifactRegistered: () => { throw new Error('crash-after-register'); } });
    const started = await crashing.begin({ sessionId: SESSION, runId: 'crash-run',
      outputName: 'crash.zip', resultRelativePath: 'package/runtime-result.json',
      expectedResultJson: '{"totalItems":4,"needsOrderCount":2}',
      expectedStdoutIncludes: ['ITEMS=4 NEEDS_ORDER=2'] });
    await writeGoodSource(started.sourceDirectory);
    await assert.rejects(() => crashing.finalize({ operationHandle: started.operationHandle,
      sessionId: SESSION, runId: 'crash-run' }), /crash-after-register/u);
    const recovered = await new ExecutableOutputOperationStore({ attachmentStore: app.store,
      workspace: app.workspace }).finalize({ operationHandle: started.operationHandle,
      sessionId: SESSION, runId: 'crash-run' });
    assert.equal(recovered.state, 'registered'); assert.equal(recovered.changed, false);
    assert.equal((await app.store.list({ sessionId: SESSION })).length, 1);
  } finally { await app.close(); }
});

test('outside write는 무시하고 symlink·multiple launcher/guide를 bounded 실패로 닫는다', async () => {
  const cases = [
    { name: 'symlink', prepare: async (source) => {
      await writeGoodSource(source); await symlink('/tmp', join(source, 'outside-link'));
    }, code: 'source_symlink_not_allowed' },
    { name: 'launchers', prepare: (source) => writeGoodSource(source, { extraLauncher: true }), code: 'multiple_launchers_observed' },
    { name: 'guides', prepare: (source) => writeGoodSource(source, { extraGuide: true }), code: 'multiple_guides_observed' },
  ];
  for (const item of cases) {
    const app = await fixture(`run-${item.name}`);
    try {
      const started = await begin(app, { outputName: `${item.name}.zip` });
      await item.prepare(started.sourceDirectory);
      await writeFile(join(app.workspace, 'outside.json'), '{"ignored":true}');
      const result = await app.tool.execute(args('finalize_executable_output', {
        operationHandle: started.operationHandle,
      }));
      assert.equal(result.code, item.code);
      assert.equal(result.verificationMissing, true);
      assert.equal((await app.store.list({ sessionId: SESSION })).length, 0);
      const events = (await readFile(join(app.store.directory,
        'executable-operations', 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
      assert.ok(events.some((event) => event.type === 'finalize_failed'
        && event.payload.code === item.code));
    } finally { await app.close(); }
  }
});

test('managed source의 dry-run result는 ZIP에서 exact 제외하고 fresh launcher effect만 자격한다', async () => {
  const app = await fixture('run-dry-result');
  try {
    const started = await begin(app, { outputName: 'dry-result.zip' });
    await writeGoodSource(started.sourceDirectory, { resultPrepackaged: true });
    const result = await app.tool.execute(args('finalize_executable_output', {
      operationHandle: started.operationHandle,
    }));
    assert.equal(result.state, 'registered'); assert.equal(result.qualification.passed, true);
    const { bytes } = await app.store.readContent({ sessionId: SESSION,
      attachmentId: result.artifact.attachmentId });
    const manifest = inspectZipArchive(bytes);
    assert.equal(manifest.entries.some((entry) => entry.path === 'package/runtime-result.json'), false);
  } finally { await app.close(); }
});

test('status=$? launcher와 mismatched JSON은 artifact로 승격하지 않는다', async () => {
  for (const item of [
    { name: 'broken', source: { broken: true }, code: 'launcher_failed' },
    { name: 'mismatch', source: { arbitraryPurposeFact: true }, code: 'result_effect_mismatch' },
  ]) {
    const app = await fixture(`run-${item.name}`);
    try {
      const started = await begin(app, { outputName: `${item.name}.zip` });
      await writeGoodSource(started.sourceDirectory, item.source);
      const result = await app.tool.execute(args('finalize_executable_output', {
        operationHandle: started.operationHandle,
      }));
      assert.equal(result.code, item.code);
      assert.equal((await app.store.list({ sessionId: SESSION })).length, 0);
    } finally { await app.close(); }
  }
});

test('imported invalid sidecar는 기존 register verifier에서 bounded field diagnostic으로 실패한다', async () => {
  const app = await fixture();
  try {
    const zipPath = join(app.workspace, 'imported.zip');
    const bytes = Buffer.from(zipSync({
      'package/실행.command': [strToU8('#!/bin/zsh\nprintf ok\n'), { os: 3, attrs: (0o100755 << 16) >>> 0 }],
    }));
    await writeFile(zipPath, bytes);
    await writeFile(`${zipPath}.t5-deliverable.json`, JSON.stringify({
      schema: 't5.deliverable-contract.v1', id: 'invalid',
      artifact: { id: 'invalid', sha256: 'not-a-digest' },
      expectedFiles: [], advertisedEntrypoints: [], requiredOutcomeObservations: [], platforms: [],
    }));
    const result = await makeExecutableOutputQualifier()({ filePath: zipPath, workspace: app.workspace });
    assert.deepEqual(result.diagnostic, {
      stage: 'contract_validation', field: 'artifact.sha256', code: 'invalid_digest',
    });
  } finally { await app.close(); }
});

test('model surface에는 begin/finalize만 있고 ZIP·sidecar·hash 조립을 요구하지 않는다', async () => {
  const app = await fixture();
  try {
    assert.match(app.tool.description, /begin_executable_output/u);
    assert.match(app.tool.description, /finalize_executable_output/u);
    assert.doesNotMatch(app.tool.description, /prepare_executable_output|t5\.deliverable-contract|producerKind|observationSchema|resultSha256/iu);
    assert.ok(app.tool.parameters.properties.action.enum.includes('begin_executable_output'));
    assert.ok(app.tool.parameters.properties.action.enum.includes('finalize_executable_output'));
    assert.equal(app.tool.parameters.properties.action.enum.includes('prepare_executable_output'), false);
    assert.deepEqual(new Set(app.tool.parameters.required), new Set(Object.keys(app.tool.parameters.properties)));
  } finally { await app.close(); }
});
