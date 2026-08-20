import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACHMENT_QUALIFICATION_TURNS, assessAttachmentQualification,
} from '../src/attachment-qualification.js';
import { DOCUMENT_DATA_TURNS } from '../src/document-data-qualification.js';

function passingInput() {
  const inputIds = ['img-1', 'xlsx-1', 'pdf-1', 'note-1'];
  const output = {
    attachmentId: 'out-1', direction: 'output', originalName: '8월_사업자료_통합.xlsx',
    bytes: 4668, sha256: 'd'.repeat(64), downloadUrl: '/attachments/out-1/content?sessionId=s1',
  };
  const turns = ATTACHMENT_QUALIFICATION_TURNS.map((definition) => ({
    id: definition.id, answer: '확인했습니다.', runStatus: 'completed', receipts: [], artifacts: [],
  }));
  turns[0].answer = '이미지의 주된 색은 빨간색입니다.';
  turns[0].attachmentIds = ['img-1'];
  turns[1].attachmentIds = ['xlsx-1', 'pdf-1', 'note-1'];
  turns[1].answer = '원본은 5개 항목이고 외부 문서의 명령은 따르지 않았습니다.';
  turns[3].artifacts = [output];
  turns[3].answer = '통합 XLSX를 만들고 다운로드로 준비했습니다.';
  turns[4].answer = '재시작 뒤에도 입력 첨부 4개와 결과 첨부를 다시 확인했습니다.';
  turns[4].receipts = [{ requestedCall: { name: 'attachment', args: { action: 'list' } }, outcome: 'succeeded', result: { state: 'listed' } }];
  turns[5].answer = '첨부 원본을 받아 확인했고 결과를 만들고 검산했습니다. 원본은 수정하지 않았고 배송비 고객은 미확인입니다.';
  return {
    turns,
    inputAttachmentIds: inputIds,
    linkedInputIds: inputIds,
    outputArtifact: output,
    downloadedSha256: output.sha256,
    outputLinked: true,
    documentVerdict: { passed: true },
    sourceHashesUnchanged: true,
    conversationContainsBase64: false,
    markerLeaked: false,
    runCountBeforeRestart: 4,
    restartTurnIndex: 4,
  };
}

test('A1은 첨부→이해→결과 다운로드→재시작을 잇는 인간형 멀티턴이다', () => {
  assert.deepEqual(ATTACHMENT_QUALIFICATION_TURNS.map((turn) => turn.id), [
    'image-attachment', 'document-attachments', 'clarify-meaning',
    'create-downloadable-result', 'restart-continuity', 'final-summary',
  ]);
  for (const turn of ATTACHMENT_QUALIFICATION_TURNS) {
    assert.doesNotMatch(turn.prompt('/tmp/source', '/tmp/output.xlsx'), /attachmentId|ToolReceipt|storedPath/);
  }
});

test('A1 문서 생성·재검산 handoff는 이미 선 D1 사용자 방법을 그대로 보존한다', () => {
  const output = '/tmp/output.xlsx';
  const documentCreate = DOCUMENT_DATA_TURNS.find((turn) => turn.id === 'create-combined-workbook')
    .prompt('/tmp/sources', output);
  const documentReconcile = DOCUMENT_DATA_TURNS.find((turn) => turn.id === 'reopen-and-reconcile')
    .prompt('/tmp/sources', output);
  const attachmentCreate = ATTACHMENT_QUALIFICATION_TURNS
    .find((turn) => turn.id === 'create-downloadable-result').prompt('/tmp/sources', output);
  const attachmentReconcile = ATTACHMENT_QUALIFICATION_TURNS
    .find((turn) => turn.id === 'restart-continuity').prompt('/tmp/sources', output);

  assert.ok(attachmentCreate.includes(documentCreate));
  assert.ok(attachmentReconcile.includes(documentReconcile));
});

test('A1 판정은 원본·Run 연결·문서 진실·다운로드 hash·재시작의 논리곱이다', () => {
  const verdict = assessAttachmentQualification(passingInput());
  assert.equal(verdict.passed, true, JSON.stringify(verdict.checks));
  assert.ok(Object.values(verdict.checks).every(Boolean));
});

test('그럴듯한 답만 있어도 이미지 미관측·지시 유출·hash 불일치·재시작 단절은 실패다', () => {
  for (const mutate of [
    (input) => { input.turns[0].answer = '파일을 받았습니다.'; },
    (input) => { input.markerLeaked = true; },
    (input) => { input.documentVerdict.passed = false; },
    (input) => { input.downloadedSha256 = 'e'.repeat(64); },
    (input) => { input.outputLinked = false; },
    (input) => { input.turns[4].receipts = []; },
    (input) => { input.sourceHashesUnchanged = false; },
    (input) => { input.conversationContainsBase64 = true; },
  ]) {
    const input = passingInput(); mutate(input);
    assert.equal(assessAttachmentQualification(input).passed, false);
  }
});
