import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCX_REQUIRED_ANCHORS, assessDeliverableTruthSuite, assessDocxDeliverableTruth,
} from '../src/deliverable-truth-qualification.js';

function passingDocx() {
  const text = DOCX_REQUIRED_ANCHORS.join('\n');
  return {
    turns: [
      { id: 'understand', runStatus: 'completed', answer: '확인했습니다.' },
      { id: 'create', runStatus: 'completed', answer: '문서를 만들었습니다.' },
      { id: 'verify', runStatus: 'completed', answer: '다시 열어 재확인했습니다. 최종 비용은 미정이며 확인 필요입니다. 완료했습니다.' },
    ],
    observation: {
      kind: 'qualified_document', format: 'docx', state: 'observed', text,
      structure: { tables: [{ cells: [[{ text: '구분' }, { text: '내용' }, { text: '상태' }]] }] },
    },
    previewHtml: `<h1>${text}</h1>`, renderedPages: [{ bytes: 100, width: 1200, height: 1600 }],
    visualTranscript: `${text}\n모든 글자가 정상 방향으로 선명하게 읽힙니다.`,
    sourceSha256Before: 'same', sourceSha256After: 'same', outputRegistered: true, outputInspected: true,
    boundedCreatorUsed: true,
  };
}

test('DOCX 결과는 추출·표·preview·page render·시각 전사·재개방의 논리곱이다', () => {
  const result = assessDocxDeliverableTruth(passingDocx());
  assert.equal(result.passed, true); assert.ok(Object.values(result.checks).every(Boolean));
});

test('DOCX anchor·표·glyph·원본·등록·재개방 중 하나를 제거하면 완료가 아니다', () => {
  for (const mutate of [
    (input) => { input.observation.text = input.observation.text.replace('최종 비용', ''); },
    (input) => { input.observation.structure.tables = []; },
    (input) => { input.previewHtml = ''; },
    (input) => { input.renderedPages = []; },
    (input) => { input.visualTranscript = '글자가 잘려 읽을 수 없습니다.'; },
    (input) => { input.sourceSha256After = 'changed'; },
    (input) => { input.outputRegistered = false; },
    (input) => { input.outputInspected = false; },
    (input) => { input.boundedCreatorUsed = false; },
  ]) {
    const input = structuredClone(passingDocx()); mutate(input);
    assert.equal(assessDocxDeliverableTruth(input).passed, false);
  }
});

test('D7 suite는 Excel·PDF·Word와 두 positive control을 모두 요구한다', () => {
  const result = assessDeliverableTruthSuite({
    documentEvidence: { passed: true, multiDocumentReconciliation: { counterfactualTests: Array(5).fill('x') } },
    pdfEvidence: { passed: true, qualifiedRuns: [{ passed: true, falseCompletion: false }, { passed: true, falseCompletion: false }] },
    textEvidence: { passed: true, liveRuns: [{ passed: true }, { passed: true }] },
    structureEvidence: { passed: true }, docxRuns: [{ verdict: { passed: true } }, { verdict: { passed: true } }],
    brandControl: { rows: 3, uniqueSources: 3, duplicateSources: 0, formulaErrors: 0 },
  });
  assert.equal(result.passed, true);
  const broken = assessDeliverableTruthSuite({
    documentEvidence: { passed: true, multiDocumentReconciliation: { counterfactualTests: [] } },
  });
  assert.equal(broken.passed, false);
});
