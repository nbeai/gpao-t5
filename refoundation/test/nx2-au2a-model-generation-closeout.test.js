import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL(
  '../evidence/nx2-au2a-model-generation-2026-09-01.json', import.meta.url,
), 'utf8'));

test('AU-2A는 대형 model을 CLI whole-buffer 경계에 넣지 않고 exact generation으로 관리한다', () => {
  assert.equal(evidence.status, 'AU2A_COMPLETE_AU2_HELPER_QUALIFICATION_CURRENT');
  assert.equal(evidence.modelStore.wholeAssetBufferedInMemory, false);
  assert.equal(evidence.modelStore.rangeResume, true);
  assert.equal(evidence.modelStore.partialIsActive, false);
  assert.equal(evidence.modelStore.fixtureQualificationRequired, true);
  assert.equal(evidence.catalog.q5Default, false);
});

test('AU-2A는 범용 model marketplace·Prompt·Tool·UI를 열지 않는다', () => {
  assert.deepEqual(Object.values(evidence.nonGoals), [false, false, false, false, false, false]);
  assert.match(evidence.next.gate, /t5-whisper-host/u);
});
