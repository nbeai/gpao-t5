import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { digestAtCommit } from './helpers/git-evidence-digest.js';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s3-m5-obsidian-independent-2026-08-27.json', import.meta.url,
), 'utf8'));

test('M5-5 evidence는 Obsidian 없음과 metadata 존재가 exact 같음을 요구한다', () => {
  assert.equal(evidence.status, 'PASS_WITH_OBSERVATION');
  assert.equal(evidence.deterministic.requiresObsidian, false);
  assert.equal(evidence.deterministic.obsidianAbsentVsMetadataPresent.indexHtmlExact, true);
  assert.equal(evidence.deterministic.obsidianAbsentVsMetadataPresent.memoryMarkdownExact, true);
  assert.equal(evidence.deterministic.obsidianAbsentVsMetadataPresent.manifestExact, true);
  assert.equal(evidence.productNonInterference.obsidianPluginCalls, 0);
});

test('M5-5 evidence는 두 모델 최종 PASS와 앞선 불리한 실행을 함께 보존한다', () => {
  assert.equal(evidence.actualModels['gpt-5.5'].finalRun.pass, true);
  assert.equal(evidence.actualModels['gpt-5.6-terra'].finalRun.pass, true);
  assert.equal(evidence.actualModels['gpt-5.5'].priorRun.reportedPass, false);
  assert.equal(evidence.actualModels['gpt-5.6-terra'].priorRun.pass, false);
  assert.equal(evidence.actualModels['gpt-5.6-terra'].priorRun.memoryCorrectionCommitted, false);
  assert.ok(evidence.notClaimed.includes('Terra correction reliability is perfect'));
});

test('M5-5 evidence source digest는 exact source commit과 일치한다', async () => {
  assert.equal(evidence.sourceCommit, '48b6222d5fdda5fa3b800ee6d0b472f358d4d895');
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    assert.equal(digestAtCommit(evidence.sourceCommit, path), expected, path);
  }
});
