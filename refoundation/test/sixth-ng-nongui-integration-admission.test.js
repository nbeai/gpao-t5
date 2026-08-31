import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-ng-nongui-integration-admission-2026-08-31.json', import.meta.url);

test('S6-NG는 현재 연구실 전체와 이미 완료된 NG0·1·2를 중복 없이 흡수한다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.status, 'INTEGRATED_ONE_GATE_OPEN');
  assert.equal(value.researchCorpus.markdownFiles, 10);
  assert.equal(value.researchCorpus.lines, 5377);
  assert.match(value.absorbed.NG0, /COMPLETE/u);
  assert.match(value.absorbed.NG1, /COMPLETE/u);
  assert.match(value.absorbed.NG2, /rejected/u);
});

test('S6-NG는 Cognitive Flow 표현 격차 baseline 하나만 열고 다른 큰 연구를 동시에 열지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.opened.gate, 'NG3A_EXPRESSION_GAP_BASELINE');
  assert.equal(value.opened.productChanges, 0);
  assert.ok(value.notOpened.NG4_Method_Runtime);
  assert.ok(value.notOpened.NG5_Document_Reality);
  assert.ok(value.notOpened.NG6_Auditory);
  assert.equal(value.forbiddenConcurrentDevelopment.length, 4);
});

test('S6-NG는 Runtime 의미 판정과 연구 목록 기반 자동 개통을 금지한다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.ok(value.correctionsToResearchCandidate.some((item) => /additionalSnapshotNeeded/u.test(item)));
  assert.ok(value.correctionsToResearchCandidate.some((item) => /evaluator metrics/u.test(item)));
  assert.ok(value.correctionsToResearchCandidate.some((item) => /do not open automatically/u.test(item)));
});
