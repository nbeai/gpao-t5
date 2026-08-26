import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const evidenceUrl = new URL('refoundation/evidence/s3-terminal-core-surface-2026-08-26.json', root);
const digest = async (path) => createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');

test('Terminal Core 증거는 표면·effect·output 부담 감소와 남은 자격을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(evidence.comparison.beforeActiveTerminalTools, 4);
  assert.equal(evidence.comparison.afterActiveTerminalTools, 2);
  assert.ok(evidence.comparison.afterSchemaBytes < evidence.comparison.beforeSchemaBytes);
  assert.equal(evidence.comparison.effectRequiredFieldsBefore, 7);
  assert.equal(evidence.comparison.effectRequiredFieldsAfter, 3);
  assert.equal(evidence.qualified.approvalBoundaryPreservedWithThreeFieldEffect, true);
  assert.equal(evidence.qualified.wholeOutputReloadForRangeRead, false);
  assert.ok(evidence.notYetQualified.includes('Terra and gpt-5.5 same-purpose live A/B'));
  assert.equal(evidence.verification.personalCredentialRun, false);
});

test('Terminal Core 증거가 가리키는 제품과 반대시험 digest는 현재 source와 일치한다', async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  const sources = {
    'terminal-session-tool.js': 'refoundation/src/terminal-session-tool.js',
    'exec-tool.js': 'refoundation/src/exec-tool.js',
    'console-model-factory.js': 'refoundation/src/console-model-factory.js',
    'terminal-output-store.js': 'refoundation/src/terminal-output-store.js',
  };
  const tests = {
    'terminal-session-tool.test.js': 'refoundation/test/terminal-session-tool.test.js',
    'console-surface.integration.js': 'refoundation/test/console-surface.integration.js',
    'terminal-output-store.test.js': 'refoundation/test/terminal-output-store.test.js',
  };
  for (const [name, path] of Object.entries(sources)) assert.equal(await digest(path), evidence.sourceDigests[name], path);
  for (const [name, path] of Object.entries(tests)) assert.equal(await digest(path), evidence.testDigests[name], path);
});
