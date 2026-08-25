import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import { makeConsoleServer } from '../src/console-server.js';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function hp03Package({ broken, prepackagedResult = false, arbitraryPurposeFact = false }) {
  const launcher = broken
    ? '#!/bin/zsh\ncd "${0:A:h}"\nnode app.js\nstatus=$?\nexit $status\n'
    : '#!/bin/zsh\ncd "${0:A:h}"\nnode app.js\n';
  const resultObject = {
    totalItems: 4, needsOrderCount: 2,
    ...(arbitraryPurposeFact ? { missionAccomplished: true } : {}),
  };
  const files = {
    'package/실행.command': [strToU8(launcher), { os: 3, attrs: (0o100755 << 16) >>> 0 }],
    'package/app.js': strToU8(`import { writeFileSync } from 'node:fs';
import inventory from './inventory.json' with { type: 'json' };
const result = { totalItems: inventory.items.length, needsOrderCount: inventory.items.filter((item) => item.stock <= item.reorderPoint).length${arbitraryPurposeFact ? ', missionAccomplished: true' : ''} };
writeFileSync('runtime-result.json', JSON.stringify(result));
console.log(\`ITEMS=\${result.totalItems} NEEDS_ORDER=\${result.needsOrderCount}\`);
`),
    'package/inventory.json': strToU8(JSON.stringify({ items: [
      { name: '우유', stock: 2, reorderPoint: 3 },
      { name: '종이컵', stock: 3, reorderPoint: 4 },
      { name: '커피', stock: 8, reorderPoint: 3 },
      { name: '물', stock: 10, reorderPoint: 4 },
    ] })),
    'package/README.txt': strToU8('Mac: 실행.command를 실행합니다.\n'),
  };
  if (prepackagedResult) {
    files['package/runtime-result.json'] = strToU8(JSON.stringify(resultObject));
  }
  const bytes = Buffer.from(zipSync(files, { mtime: new Date('2020-01-01T00:00:00.000Z') }));
  const artifactId = broken ? 'hp03-broken' : prepackagedResult ? 'hp03-prepackaged'
    : arbitraryPurposeFact ? 'hp03-arbitrary-purpose' : 'hp03-qualified';
  const resultBytes = Buffer.from(JSON.stringify(resultObject));
  return {
    bytes,
    contract: {
      schema: 't5.deliverable-contract.v1',
      id: `${artifactId}-contract`,
      artifact: { id: artifactId, sha256: sha256(bytes) },
      expectedFiles: Object.keys(files),
      guideReferences: [{
        guidePath: 'package/README.txt', targetPath: 'package/실행.command',
      }],
      advertisedEntrypoints: [{
        id: 'mac-launcher', platform: 'darwin', interpreter: '/bin/zsh',
        path: 'package/실행.command', cwd: 'package', requiresExecutablePermission: true,
        expectedExitCode: 0, expectedStdoutIncludes: ['ITEMS=4 NEEDS_ORDER=2'],
      }],
      requiredOutcomeObservations: [{
        id: 'runtime-result',
        observationSchema: 't5.new-json-result-observation.v1',
        entrypointId: 'mac-launcher',
        producerKind: 'post_execution_file',
        producerId: 't5.new-json-result.v1',
        requiredFacts: [
          { name: 'resultPath', type: 'string', equals: 'package/runtime-result.json' },
          { name: 'resultSha256', type: 'string', equals: sha256(resultBytes) },
          { name: 'resultBytes', type: 'integer', equals: resultBytes.length },
          { name: 'resultMime', type: 'string', equals: 'application/json' },
          ...(arbitraryPurposeFact
            ? [{ name: 'missionAccomplished', type: 'boolean', equals: true }] : []),
        ],
      }],
      platforms: [{
        platform: 'darwin', advertisedSupport: true, claimedQualification: 'actually_executed',
      }],
    },
  };
}

async function fixtureServer({ broken, prepackagedResult = false, arbitraryPurposeFact = false }) {
  const room = await mkdtemp(join(tmpdir(), 't5-qh1-output-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const outputPath = join(workspace, broken ? 'HP-03-broken.zip'
    : prepackagedResult ? 'HP-03-prepackaged.zip'
      : arbitraryPurposeFact ? 'HP-03-arbitrary-purpose.zip' : 'HP-03-qualified.zip');
  const fixture = hp03Package({ broken, prepackagedResult, arbitraryPurposeFact });
  await writeFile(outputPath, fixture.bytes);
  await writeFile(`${outputPath}.t5-deliverable.json`, JSON.stringify(fixture.contract));
  let turn = 0; let attachmentResult = null; let completionResult = null;
  const modelFactory = () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{
      id: 'find-attachment', name: 'tool_search',
      args: { query: 'register executable zip result artifact' },
    }] };
    if (turn === 2) return { text: '', toolCalls: [{
      id: 'register-output', name: 'attachment', args: {
        action: 'register_output', attachmentId: null, filePath: outputPath,
        maxChars: null, maxCells: null, maxPages: null,
      },
    }] };
    if (turn === 3) {
      attachmentResult = JSON.parse(input.messages.at(-1).content).result;
      return { text: '', toolCalls: [{
        id: 'complete-work', name: 'work_completion', args: { outcome: 'achieved', inputSettlements: [] },
      }] };
    }
    completionResult = JSON.parse(input.messages.at(-1).content).result;
    return { text: broken ? '실행 확인이 끝나지 않아 결과 ZIP을 제공하지 않았습니다.' : '실행과 독립 확인을 마친 ZIP입니다.', toolCalls: [] };
  } });
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'qh1-model' }),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  return {
    room, workspace, outputPath, server,
    base: `http://127.0.0.1:${server.address().port}`,
    observed: () => ({ attachmentResult, completionResult }),
    async close() {
      server.closeWakeStreams(); await server.managedProcesses.stopAll('test_shutdown');
      await new Promise((resolveClose) => server.close(resolveClose));
      await rm(room, { recursive: true, force: true });
    },
  };
}

async function runJourney(broken, prepackagedResult = false, arbitraryPurposeFact = false) {
  const app = await fixtureServer({ broken, prepackagedResult, arbitraryPurposeFact });
  try {
    const session = await fetch(`${app.base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        text: `HP-03 프로그램의 실행 가능한 설치 ZIP "${app.outputPath}"을 확인해서 이 대화에 제공해줘.`,
      }),
    }).then((response) => response.json());
    const run = await fetch(`${app.base}/runs/${result.runId}`).then((response) => response.json());
    return { app, result, run, observed: app.observed() };
  } catch (error) { await app.close(); throw error; }
}

test('HP-03형 status=$? launcher ZIP은 app stdout이 맞아도 등록·Work 완료로 승격되지 않는다', async () => {
  const { app, result, run, observed } = await runJourney(true);
  try {
    assert.ok(observed.attachmentResult, JSON.stringify({ result, events: run.events, observed }));
    assert.equal(observed.attachmentResult.state, 'executable_artifact_unqualified', JSON.stringify(observed));
    assert.equal(observed.attachmentResult.verificationMissing, true);
    assert.equal(observed.completionResult.verifiedOutcome, 'unresolved');
    assert.equal(result.artifacts, undefined);
    assert.ok(run.events.some((event) => event.type === 'work_unresolved'));
  } finally { await app.close(); }
});

test('HP-03형 정상 launcher ZIP은 exact 실행과 새 typed 결과 파일 독립 관측 뒤에만 제공·완료된다', async () => {
  const { app, result, run, observed } = await runJourney(false);
  try {
    assert.ok(observed.attachmentResult, JSON.stringify({ result, events: run.events, observed }));
    assert.equal(observed.attachmentResult.state, 'registered', JSON.stringify(observed));
    assert.equal(observed.attachmentResult.executableQualification.receipt.passed, true);
    const entrypoint = observed.attachmentResult.executableQualification.receipt.entrypoints[0];
    assert.equal(entrypoint.executionQualification, 'actually_executed');
    assert.equal(entrypoint.outcomeObservations[0].receipt.producer.trusted, true);
    assert.equal(entrypoint.outcomeObservations[0].receipt.facts
      .find((fact) => fact.name === 'resultMime').value, 'application/json');
    assert.equal(entrypoint.outcomeObservations[0].receipt.facts
      .some((fact) => fact.name === 'totalItems'), false);
    assert.equal(observed.attachmentResult.executableQualification.receipt.qualificationScope,
      'executable_wrapper_and_declared_outcome_observation');
    assert.equal(observed.completionResult.verifiedOutcome, 'achieved');
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].sha256, sha256(hp03Package({ broken: false }).bytes));
    assert.ok(run.events.some((event) => event.type === 'work_settled'));
  } finally { await app.close(); }
});

test('archive에 미리 넣은 결과 JSON은 launcher가 만든 external file effect로 승격되지 않는다', async () => {
  const { app, result, run, observed } = await runJourney(false, true);
  try {
    assert.equal(observed.attachmentResult.state, 'executable_artifact_unqualified');
    const entrypoint = observed.attachmentResult.receipt.entrypoints[0];
    assert.equal(entrypoint.executionQualification, 'actually_executed');
    assert.equal(entrypoint.qualification, 'executed_but_outcome_failed');
    assert.equal(entrypoint.outcomeObservations[0].receipt.reason, 'result_existed_before_execution');
    assert.equal(observed.completionResult.verifiedOutcome, 'unresolved');
    assert.equal(result.artifacts, undefined);
    assert.ok(run.events.some((event) => event.type === 'work_unresolved'));
  } finally { await app.close(); }
});

test('missionAccomplished 같은 arbitrary JSON field는 trusted QH-1 file effect가 아니다', async () => {
  const { app, result, run, observed } = await runJourney(false, false, true);
  try {
    assert.equal(observed.attachmentResult.state, 'executable_artifact_unqualified');
    const entrypoint = observed.attachmentResult.receipt.entrypoints[0];
    assert.equal(entrypoint.executionQualification, 'actually_executed');
    assert.equal(entrypoint.qualification, 'executed_but_outcome_failed');
    assert.equal(entrypoint.outcomeObservations[0].receipt.reason, 'unsupported_file_effect_facts');
    assert.equal(entrypoint.outcomeObservations[0].receipt.facts.length, 0);
    assert.equal(observed.completionResult.verifiedOutcome, 'unresolved');
    assert.equal(result.artifacts, undefined);
    assert.ok(run.events.some((event) => event.type === 'work_unresolved'));
  } finally { await app.close(); }
});
