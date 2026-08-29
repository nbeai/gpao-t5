import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('CJ6는 provider별 wire 선택을 분리하고 rebuild를 전역 기본값으로 만들지 않는다', async () => {
  const evidence = JSON.parse(await read('../evidence/fifth-cj6-provider-wire-context-2026-08-30.json'));
  assert.equal(evidence.status, 'COMPLETE_PROVIDER_POLICIES_SELECTED');
  assert.equal(evidence.chatgptOAuth.selected, 'append-continuation');
  assert.equal(evidence.openAIAPI.selected, 'append-continuation');
  assert.equal(evidence.modelFallback.selected, 'portable_canonical_rebuild');
  assert.equal(evidence.modelFallback.priorToolEffectsReexecutionAuthorized, false);
  assert.equal(evidence.productDecision.defaultChanged, false);
  assert.equal(evidence.productDecision.thirdConditionalPatchAttempted, false);
  assert.equal(evidence.chatgptOAuth.largeEvidence2x2.rebuildProjected.passed, true);
  assert.ok(evidence.chatgptOAuth.largeEvidence2x2.rebuildProjected.requestBytes
    < evidence.chatgptOAuth.largeEvidence2x2.rebuildFull.requestBytes);
  assert.ok(evidence.chatgptOAuth.representativeThreePurpose.rebuildProjected.tokens
    > evidence.chatgptOAuth.representativeThreePurpose.appendProjectedLogicalMode.tokens);
});
