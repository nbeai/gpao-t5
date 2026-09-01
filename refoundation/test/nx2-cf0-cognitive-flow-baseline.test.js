import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('NX2 CF-0은 세 표현 격차와 두 폐기 후보를 재사용하고 세 번째 패치 없이 닫는다', async () => {
  const evidence = JSON.parse(await read(
    'refoundation/evidence/nx2-cf0-cognitive-flow-baseline-2026-09-01.json'));
  assert.equal(evidence.status, 'NX2_3_CLOSED_WITH_MODEL_PROVIDER_JUDGMENT_LIMIT');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.evidenceReuse.liveRerun, false);
  assert.deepEqual(Object.values(evidence.cf0.ordinary).map((item) => item.sourceEntered),
    [false, false, false]);
  assert.deepEqual(Object.values(evidence.cf0.expert).map((item) => item.sourceEntered),
    [true, true, true]);
  assert.equal(evidence.cf0.directPositiveControl.toolCalls, 0);
  assert.equal(evidence.cf0.runtimeInformationGapProven, false);
  assert.deepEqual(evidence.candidateHistory.map((item) => item.result), ['REJECTED', 'REJECTED']);
  assert.equal(evidence.boundaries.thirdCandidateOpened, false);
  assert.equal(evidence.boundaries.cfHqExecuted, false);
  assert.equal(evidence.next.gate, 'NX2-SE Selection-Scoped Side Exploration');
});

test('NX2-3 종료는 Cognitive Flow·Practical Judgment·HQ 연구의 비목표를 보존한다', async () => {
  const [flow, judgment, hq] = await Promise.all([
    read('티파이브개발 연구/T5-COGNITIVE-FLOW-RESEARCH.md'),
    read('티파이브개발 연구/T5-PRACTICAL-JUDGMENT-RESEARCH.md'),
    read('티파이브개발 연구/T5-COGNITIVE-FLOW-HQ-RESEARCH.md'),
  ]);
  assert.match(flow, /NX2_3_CLOSED_WITH_MODEL_PROVIDER_JUDGMENT_LIMIT/u);
  assert.match(judgment, /NX2_3_CLOSED_WITH_MODEL_PROVIDER_JUDGMENT_LIMIT/u);
  assert.match(hq, /NOT_EXECUTED_NO_PRODUCT_CANDIDATE/u);
  assert.match(flow, /새 Cognitive Flow Engine·Store·database/u);
  assert.match(judgment, /고정 질문 순서·Intent Router·상시 컨설팅 persona/u);
  assert.match(hq, /CF-0 실패와 제품 후보가 없으면 열지 않는다/u);
});
