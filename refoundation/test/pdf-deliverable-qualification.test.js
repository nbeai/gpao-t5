import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PDF_DELIVERABLE_CASUAL_TURNS, PDF_DELIVERABLE_TURNS, PDF_REQUIRED_ANCHORS, assessPdfDeliverableQualification,
  createPdfDeliverableFixture,
} from '../src/pdf-deliverable-qualification.js';

function passingInput() {
  const turns = PDF_DELIVERABLE_TURNS.map((turn, index) => ({
    id: turn.id, runStatus: 'completed', answer: index === 1
      ? '완료했습니다. PDF를 다시 열어 한국어 본문을 확인했고 읽을 수 있습니다.'
      : index === 2 ? 'PDF를 다시 열어 네 문장과 본문이 읽을 수 있음을 확인했습니다. 완료했습니다.' : '확인했습니다.',
    receipts: index === 1 ? [{ requestedCall: { name: 'attachment', args: { action: 'register_output' } }, outcome: 'succeeded' }] : index === 2 ? [{
      requestedCall: { name: 'attachment', args: { action: 'inspect' } }, outcome: 'succeeded',
      result: { observation: { kind: 'pdf_render', sourceSha256: 'pdf-sha', isolatedVisualTranscript: `${PDF_REQUIRED_ANCHORS.join('\n')}\n텍스트는 정상 방향으로 선명하게 잘 읽힙니다.` } },
    }] : [],
    stateAfter: { outputExists: index > 0 },
  }));
  const text = `${PDF_REQUIRED_ANCHORS.join('\n')}\n확인된 사실과 합의 및 미정 내용을 고객이 읽을 수 있도록 정리했습니다.`;
  return {
    turns, sourceSha256Before: 'same', sourceSha256After: 'same',
    outputObservation: { schema: 't5.document-observation.v1', kind: 'pdf', file: { sha256: 'pdf-sha' }, pdf: { pageCount: 1, pages: [{ text }] } },
    renderReality: { rendered: true, width: 1000, height: 1400, inkRatio: 0.02, visuallyReadable: true },
  };
}

test('한국어 고객 PDF 과업은 이해→생성→독립 재개방의 사용자 흐름이다', () => {
  assert.deepEqual(PDF_DELIVERABLE_TURNS.map((turn) => turn.id), [
    'understand-counseling-note', 'create-korean-customer-pdf', 'reopen-and-report',
  ]);
  assert.equal(PDF_REQUIRED_ANCHORS.length, 6);
  assert.deepEqual(PDF_DELIVERABLE_CASUAL_TURNS.map((turn) => turn.id), PDF_DELIVERABLE_TURNS.map((turn) => turn.id));
  assert.notEqual(PDF_DELIVERABLE_CASUAL_TURNS[1].prompt('a', 'b'), PDF_DELIVERABLE_TURNS[1].prompt('a', 'b'));
});

test('PDF 추출의 탭·줄바꿈은 내용 손실이 아니며 exact PDFium 전사만 시각 성공으로 인정한다', () => {
  const input = passingInput();
  input.outputObservation.pdf.pages[0].text = PDF_REQUIRED_ANCHORS.join('\t\r\n');
  input.renderReality.visuallyReadable = null;
  const passed = assessPdfDeliverableQualification(input);
  assert.equal(passed.checks.allKoreanAnchorsExtracted, true);
  assert.equal(passed.checks.visualReadabilityVerified, true);
  assert.equal(passed.passed, true);

  const mirrored = passingInput(); mirrored.renderReality.visuallyReadable = null;
  mirrored.turns[2].receipts[0].result.observation.isolatedVisualTranscript = '2026 8 23, 3, 2026 8 30. Korean is unreadable and mirrored.';
  const failed = assessPdfDeliverableQualification(mirrored);
  assert.equal(failed.checks.visualReadabilityVerified, false);
  assert.equal(failed.passed, false);

  const stale = passingInput(); stale.renderReality.visuallyReadable = null;
  stale.turns[2].receipts[0].result.observation.sourceSha256 = 'older-pdf';
  assert.equal(assessPdfDeliverableQualification(stale).checks.visualReadabilityVerified, false);
});

test('상담 fixture는 고정 한국어 사실·합의·미정·다음 확인일을 가진다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-pdf-deliverable-fixture-'));
  const fixture = await createPdfDeliverableFixture(room); const text = await readFile(fixture.sourcePath, 'utf8');
  assert.match(text, /매주 화요일 오후 3시/u); assert.match(text, /최종 비용/u);
  assert.match(text, /2026년 8월 30일/u); assert.match(fixture.sourceSha256, /^[a-f0-9]{64}$/u);
});

test('파일·페이지·일부 글자만 있고 한국어 본문이 없으면 완료 주장은 false completion이다', () => {
  const input = passingInput(); input.outputObservation.pdf.pages[0].text = 'Consultation PDF 2026';
  const result = assessPdfDeliverableQualification(input);
  assert.equal(result.checks.outputObserved, true); assert.equal(result.checks.exactlyOnePage, true);
  assert.equal(result.checks.allKoreanAnchorsExtracted, false); assert.equal(result.falseCompletionAtCreation, true);
  assert.equal(result.falseCompletionAtFinal, true); assert.equal(result.falseCompletion, true);
  assert.equal(result.passed, false);
});

test('최종 답이 미검증을 정직하게 말해도 앞 생성 턴의 조기 완료는 별도로 남는다', () => {
  const input = passingInput(); input.outputObservation.pdf.pages[0].text = ': 2026 8 23 / : 3';
  input.turns[2].answer = '파일과 1페이지는 확인했지만 한국어 본문은 확인하지 못했습니다. 완료라고 말할 수 없습니다.';
  const result = assessPdfDeliverableQualification(input);
  assert.equal(result.claims.creation.complete, true);
  assert.deepEqual(result.claims.final, { complete: false, readable: false });
  assert.equal(result.falseCompletionAtCreation, true); assert.equal(result.falseCompletionAtFinal, false);
  assert.equal(result.falseCompletion, true);
});

test('본문·렌더·등록·원본 보존을 모두 확인해야 통과하고 각 실제 행동 제거는 실패다', () => {
  assert.equal(assessPdfDeliverableQualification(passingInput()).passed, true);
  for (const mutate of [
    (input) => { input.renderReality.inkRatio = 0; },
    (input) => { input.renderReality.visuallyReadable = false; input.turns[2].receipts = []; },
    (input) => { input.turns[1].receipts = []; },
    (input) => { input.sourceSha256After = 'changed'; },
    (input) => { input.outputObservation.pdf.pageCount = 2; },
  ]) {
    const input = passingInput(); mutate(input);
    assert.equal(assessPdfDeliverableQualification(input).passed, false);
  }
});
