import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestAtCommit } from './helpers/git-evidence-digest.js';

const root = new URL('../../', import.meta.url);
const evidenceUrl = new URL('refoundation/evidence/s3-terminal-core-surface-2026-08-26.json', root);

test('Terminal Core 증거는 표면·effect·output 부담 감소와 남은 자격을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(evidence.comparison.beforeActiveTerminalTools, 4);
  assert.equal(evidence.comparison.afterActiveTerminalTools, 2);
  assert.ok(evidence.comparison.afterSchemaBytes < evidence.comparison.beforeSchemaBytes);
  assert.equal(evidence.comparison.effectRequiredFieldsBefore, 7);
  assert.equal(evidence.comparison.effectRequiredFieldsAfter, 3);
  assert.equal(evidence.qualified.approvalBoundaryPreservedWithThreeFieldEffect, true);
  assert.equal(evidence.qualified.wholeOutputReloadForRangeRead, false);
  assert.equal(evidence.qualified.genericGithubCliBypassOnMacos, 0);
  assert.ok(evidence.notYetQualified.includes(
    'clean full-model performance median beyond the completed paired user-goal qualification',
  ));
  assert.equal(evidence.verification.personalCredentialRun, false);
});

test('Terminal Core 증거가 가리키는 제품과 반대시험 digest는 exact source commit과 일치한다', async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  const sources = {
    'terminal-session-tool.js': 'refoundation/src/terminal-session-tool.js',
    'exec-tool.js': 'refoundation/src/exec-tool.js',
    'console-model-factory.js': 'refoundation/src/console-model-factory.js',
    'terminal-output-store.js': 'refoundation/src/terminal-output-store.js',
    'github-cli-broker.js': 'refoundation/src/github-cli-broker.js',
    'terminal-credential-broker.js': 'refoundation/src/terminal-credential-broker.js',
    'terminal-platform-adapter.js': 'refoundation/src/terminal-platform-adapter.js',
    'start-console.mjs': 'refoundation/scripts/start-console.mjs',
  };
  const tests = {
    'terminal-session-tool.test.js': 'refoundation/test/terminal-session-tool.test.js',
    'console-surface.integration.js': 'refoundation/test/console-surface.integration.js',
    'terminal-output-store.test.js': 'refoundation/test/terminal-output-store.test.js',
    'github-cli-broker.test.js': 'refoundation/test/github-cli-broker.test.js',
    'terminal-platform-adapter.test.js': 'refoundation/test/terminal-platform-adapter.test.js',
  };
  assert.equal(evidence.sourceCommit, '82d8df10d296c36f1b8365c5bb9f0b7a904aaca3');
  for (const [name, path] of Object.entries(sources)) {
    assert.equal(digestAtCommit(evidence.sourceCommit, path), evidence.sourceDigests[name], path);
  }
  for (const [name, path] of Object.entries(tests)) {
    assert.equal(digestAtCommit(evidence.sourceCommit, path), evidence.testDigests[name], path);
  }
});
