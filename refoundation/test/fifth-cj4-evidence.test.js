import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('CJ4 actual은 세 목적의 품질과 호출 수를 지키며 설치 제품 Tool surface를 줄인다', async () => {
  const evidence = JSON.parse(await read('../evidence/fifth-cj4-capability-tool-economy-2026-08-30.json'));
  assert.equal(evidence.status, 'COMPLETE_WITH_CJ5_CARRY');
  assert.deepEqual(evidence.samePurposeComparison.map((item) => item.candidate.passed), [true, true, true]);
  assert.equal(evidence.aggregate.delta.modelCalls, 0); assert.equal(evidence.aggregate.delta.toolCalls, 0);
  assert.ok(evidence.aggregate.delta.tokens < 0); assert.ok(evidence.aggregate.delta.requestBytes < 0);
  assert.ok(evidence.aggregate.delta.wallMs < 0);
  assert.equal(evidence.candidateIterations.length, 2);
  assert.equal(evidence.carryToCJ5.workCompletionCalled, false);
  assert.match(await read('../scripts/start-console.mjs'), /capabilitySurfaceMode: 'directory-first-v1'/u);
});
