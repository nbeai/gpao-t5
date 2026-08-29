import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('CJ5는 logical projection과 provider wire reduction을 같은 성공으로 기록하지 않는다', async () => {
  const evidence = JSON.parse(await read('../evidence/fifth-cj5-evidence-final-context-2026-08-30.json'));
  assert.match(evidence.status, /PRODUCT_DEFAULT_NOT_ADOPTED/u);
  assert.equal(evidence.contract.canonicalReceiptsChanged, false);
  assert.equal(evidence.samePurposeComparison.full.passed, true);
  assert.equal(evidence.samePurposeComparison.projected.passed, true);
  assert.equal(evidence.samePurposeComparison.delta.requestBytes, 0);
  assert.equal(evidence.samePurposeComparison.delta.tokens, 0);
  assert.equal(evidence.decision.candidateAdopted, false);
  const start = await read('../scripts/start-console.mjs');
  assert.doesNotMatch(start, /currentRunEvidenceMode: 'settled-tool-facts-v1'/u);
});
