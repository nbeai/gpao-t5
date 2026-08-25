import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeAttachmentTool } from '../src/attachment-hand.js';
import { makeExecutableOutputQualifier } from '../src/executable-output-qualification.js';

const SESSION = '77777777-7777-4777-8777-777777777777';

function executableZip({ multiple = false } = {}) {
  const launcher = (label) => [strToU8(`#!/bin/zsh\nprintf '{"totalItems":4,"needsOrderCount":2}' > runtime-result.json\nprintf '${label} ITEMS=4 NEEDS_ORDER=2\\n'\n`), {
    os: 3, attrs: (0o100755 << 16) >>> 0,
  }];
  const files = {
    'package/실행.command': launcher('PRIMARY'),
    'package/README.txt': strToU8('Mac에서는 실행.command를 실행합니다.\n'),
  };
  if (multiple) {
    files['other/실행.command'] = launcher('OTHER');
    files['other/README.txt'] = strToU8('Mac에서는 실행.command를 실행합니다.\n');
  }
  return Buffer.from(zipSync(files, { mtime: new Date('2020-01-01T00:00:00.000Z') }));
}

async function fixture(options = {}) {
  const room = await mkdtemp(join(tmpdir(), 't5-executable-prepare-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const zipPath = join(workspace, '재고확인.zip');
  const expectedPath = join(workspace, 'expected-runtime-result.json');
  await writeFile(zipPath, executableZip(options));
  await writeFile(expectedPath, '{"totalItems":4,"needsOrderCount":2}');
  const store = new AttachmentStore(join(room, 'attachments'));
  const tool = makeAttachmentTool({
    store, sessionId: SESSION, workspace, runId: 'prepare-run',
    authorizeOutputPath: (path) => [zipPath, expectedPath].includes(path),
  });
  return { room, workspace, zipPath, expectedPath, store, tool,
    async close() { await rm(room, { recursive: true, force: true }); } };
}

function preparationArgs(app, overrides = {}) {
  return {
    action: 'prepare_executable_output', attachmentId: null, filePath: app.zipPath,
    maxChars: null, maxCells: null, maxPages: null,
    archiveResultPath: 'package/runtime-result.json',
    expectedResultFilePath: app.expectedPath,
    expectedStdoutIncludes: ['ITEMS=4 NEEDS_ORDER=2'],
    launcherCandidateId: null, guideCandidateId: null,
    ...overrides,
  };
}

test('runtime이 executable sidecar 전체를 생성하고 exact wrapper와 새 JSON 효과로만 등록한다', async () => {
  const app = await fixture();
  try {
    const prepared = await app.tool.execute(preparationArgs(app));
    assert.equal(prepared.state, 'executable_output_prepared');
    assert.equal(prepared.changed, true);
    const sidecar = JSON.parse(await readFile(`${app.zipPath}.t5-deliverable.json`, 'utf8'));
    assert.equal(sidecar.schema, 't5.deliverable-contract.v1');
    assert.equal(sidecar.advertisedEntrypoints[0].path, 'package/실행.command');
    assert.equal(sidecar.guideReferences[0].guidePath, 'package/README.txt');
    assert.equal(sidecar.requiredOutcomeObservations[0].requiredFacts.length, 4);
    assert.equal(Object.hasOwn(sidecar.requiredOutcomeObservations[0], 'totalItems'), false);

    const again = await app.tool.execute(preparationArgs(app));
    assert.equal(again.state, 'executable_output_prepared');
    assert.equal(again.changed, false);

    const registered = await app.tool.execute({
      action: 'register_output', attachmentId: null, filePath: app.zipPath,
      maxChars: null, maxCells: null, maxPages: null,
    });
    assert.equal(registered.state, 'registered');
    assert.equal(registered.executableQualification.receipt.passed, true);
    assert.equal(registered.executableQualification.receipt.qualificationScope,
      'executable_wrapper_and_declared_outcome_observation');
    const facts = registered.executableQualification.receipt.entrypoints[0]
      .outcomeObservations[0].receipt.facts;
    assert.deepEqual(facts.map((fact) => fact.name), [
      'resultPath', 'resultSha256', 'resultBytes', 'resultMime',
    ]);
  } finally { await app.close(); }
});

test('launcher나 guide가 여러 개면 runtime candidate identity 선택 전에는 sidecar를 만들지 않는다', async () => {
  const app = await fixture({ multiple: true });
  try {
    const first = await app.tool.execute(preparationArgs(app));
    assert.equal(first.state, 'executable_preparation_selection_required');
    assert.equal(first.candidates.launchers.length, 2);
    assert.equal(first.candidates.guides.length, 4);
    await assert.rejects(() => readFile(`${app.zipPath}.t5-deliverable.json`, 'utf8'), /ENOENT/u);
    const launcher = first.candidates.launchers.find((item) => item.path === 'package/실행.command');
    const guide = first.candidates.guides.find((item) => item.path === 'package/README.txt'
      && item.launcherCandidateId === launcher.candidateId);
    const selected = await app.tool.execute(preparationArgs(app, {
      launcherCandidateId: launcher.candidateId, guideCandidateId: guide.candidateId,
    }));
    assert.equal(selected.state, 'executable_output_prepared');
  } finally { await app.close(); }
});

test('imported invalid sidecar는 원문 없이 bounded field diagnostic으로 실패한다', async () => {
  const app = await fixture();
  try {
    await writeFile(`${app.zipPath}.t5-deliverable.json`, JSON.stringify({
      schema: 't5.deliverable-contract.v1', id: 'invalid',
      artifact: { id: 'invalid', sha256: 'not-a-digest' },
      expectedFiles: [], advertisedEntrypoints: [], requiredOutcomeObservations: [], platforms: [],
    }));
    const result = await makeExecutableOutputQualifier()({
      filePath: app.zipPath, workspace: app.workspace,
    });
    assert.equal(result.state, 'executable_artifact_unqualified');
    assert.equal(result.reason, 'deliverable_contract_invalid');
    assert.deepEqual(result.diagnostic, {
      stage: 'contract_validation', field: 'artifact.sha256', code: 'invalid_digest',
    });
    assert.equal(JSON.stringify(result.diagnostic).includes('not-a-digest'), false);
  } finally { await app.close(); }
});

test('model tool surface는 typed preparation을 제공하고 내부 contract schema 작성을 요구하지 않는다', async () => {
  const app = await fixture();
  try {
    assert.match(app.tool.description, /prepare_executable_output/u);
    assert.match(app.tool.description, /do not create or edit a sidecar or contract file yourself/iu);
    assert.doesNotMatch(app.tool.description, /t5\.deliverable-contract|producerKind|producerId|observationSchema|resultSha256/iu);
    assert.ok(app.tool.parameters.properties.action.enum.includes('prepare_executable_output'));
  } finally { await app.close(); }
});
