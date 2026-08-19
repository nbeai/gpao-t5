import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DOCUMENT_DATA_TURNS, assessDocumentDataQualification, createDocumentDataFixture,
  hashDocumentSources,
} from '../src/document-data-qualification.js';
import { inspectBusinessDocument } from '../src/document-data-inspector.js';

function observedCells(entries) {
  return entries.map(([address, value, formula]) => {
    const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(address);
    const column = [...letters].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0);
    return {
      address, row: Number(digits), column, text: String(value), value,
      ...(formula ? { formula, result: value } : {}),
    };
  });
}

function passingInput() {
  const sourcePaths = ['/tmp/a.xlsx', '/tmp/b.pdf', '/tmp/c.xlsx'];
  const outputPath = '/tmp/8월_사업자료_통합.xlsx';
  const receipt = (name, result, command = '') => ({
    requestedCall: { name, args: name === 'exec' ? { command } : { action: 'view', name: 'document-data' } },
    actualCall: { name }, outcome: 'succeeded', result,
  });
  const observations = sourcePaths.map((path) => ({
    schema: 't5.document-observation.v1', kind: path.endsWith('.pdf') ? 'pdf' : 'xlsx',
    file: { path, sha256: path.repeat(5).slice(0, 64) },
  }));
  const outputObservation = {
    schema: 't5.document-observation.v1', kind: 'xlsx',
    file: { path: outputPath, sha256: 'd'.repeat(64) },
    workbook: {
      totals: { cells: 40, formulas: 3, formulaErrors: 0, missingFormulaResults: 0 },
      sheets: [
        { name: '통합내역', cells: observedCells([
          ['A2', '월'], ['B2', '고객'], ['C2', '품목'], ['F2', '금액'], ['G2', '출처'], ['H2', '검토상태'],
          ['A3', '2026-08'], ['B3', '한빛상회'], ['C3', '원두'], ['F3', 30000], ['G3', 'a.xlsx / 8월 견적 / D3:D4'], ['H3', '확인'],
          ['A4', '2026-08'], ['B4', '한빛상회'], ['C4', '우유'], ['F4', 3300], ['G4', 'a.xlsx · 8월 견적!D4'], ['H4', '확인'],
          ['A5', '2026-08'], ['B5', '한빛상회'], ['C5', '포장재'], ['F5', 7000], ['G5', 'b.pdf · page 1'], ['H5', '확인'],
          ['A6', '2026-08'], ['B6', '미확인'], ['C6', '배송비'], ['F6', 3000], ['G6', 'b.pdf · page 1'], ['H6', '고객 미확인'],
          ['A7', '2026-08'], ['B7', '새봄상사'], ['C7', '필터'], ['F7', 25000], ['G7', 'c.xlsx · 정산!E3'], ['H7', '확인'],
          ['F8', 68300, 'SUM(F3:F7)'],
        ]) },
        { name: '고객별요약', cells: observedCells([
          ['A2', '고객'], ['B2', '금액합계'],
          ['A3', '한빛상회'], ['B3', 40300], ['A4', '새봄상사'], ['B4', 25000], ['A5', '미확인'], ['B5', 3000], ['B6', 68300, 'SUM(B3:B5)'],
        ]) },
      ],
    },
  };
  const turns = DOCUMENT_DATA_TURNS.map((definition) => ({
    id: definition.id, answer: '확인했습니다.', runStatus: 'completed', receipts: [],
    stateAfter: { outputFiles: [] },
  }));
  turns[0].receipts = [receipt('skill', { state: 'viewed', name: 'document-data' }),
    ...observations.map((observation) => receipt('exec', { stdout: JSON.stringify(observation) }, `inspect ${observation.file.path}`))];
  turns[2].receipts = [receipt('exec', { stdout: JSON.stringify({ created: true, observation: outputObservation }) }, `create-xlsx ${outputPath}`)];
  turns[2].stateAfter.outputFiles = [outputPath];
  turns[3].receipts = [receipt('exec', { stdout: JSON.stringify(outputObservation) }, `inspect ${outputPath}`)];
  turns[3].stateAfter.outputFiles = [outputPath];
  turns[4].answer = '완료: 새 통합표를 만들고 다시 검산했습니다. 미확인 배송비는 그대로 표시했습니다. 하지 않은 일: 원본 세 파일은 수정하지 않았습니다.';
  turns[4].stateAfter.outputFiles = [outputPath];
  return {
    turns, sourcePaths, outputPath, outputObservation,
    sourceBefore: Object.fromEntries(sourcePaths.map((path) => [path, `${path}-hash`])),
    sourceAfter: Object.fromEntries(sourcePaths.map((path) => [path, `${path}-hash`])),
  };
}

test('D1은 실제 사람이 이어 말하는 관측→의미 보정→생성→재검산 흐름이다', () => {
  assert.deepEqual(DOCUMENT_DATA_TURNS.map((turn) => turn.id), [
    'inspect-before-create', 'clarify-meaning', 'create-combined-workbook',
    'reopen-and-reconcile', 'final-summary',
  ]);
  for (const turn of DOCUMENT_DATA_TURNS) {
    assert.doesNotMatch(turn.prompt('/tmp/sources', '/tmp/output.xlsx'), /ToolReceipt|T5_DOCUMENT_CLI|observationId/);
  }
});

test('D1 fixture는 숨김 행·수식 XLSX 둘과 고객 미지정 항목 PDF를 실제로 가진다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-fixture-'));
  const fixture = await createDocumentDataFixture(room);
  const observations = await Promise.all(fixture.sourcePaths.map((file) => inspectBusinessDocument({ file })));
  assert.deepEqual(observations.map((item) => item.kind).sort(), ['pdf', 'xlsx', 'xlsx']);
  const quote = observations.find((item) => item.file.path.endsWith('한빛상회_8월_견적.xlsx'));
  assert.deepEqual(quote.workbook.sheets[0].hiddenRows, [4]);
  assert.equal(quote.workbook.sheets[0].cells.find((cell) => cell.address === 'F5').result, 33300);
  const pdf = observations.find((item) => item.kind === 'pdf');
  assert.match(pdf.pdf.pages[0].text, /Customer: HANBIT SHOP/);
  assert.match(pdf.pdf.pages[0].text, /Customer: \[blank\]/);
  assert.deepEqual(await hashDocumentSources(fixture.sourcePaths), fixture.sourceBefore);
});

test('D1 판정은 출처·미확인·합계·수식·원본 무변경·재개방의 논리곱이다', () => {
  const result = assessDocumentDataQualification(passingInput());
  assert.equal(result.passed, true, JSON.stringify(result.checks));
  assert.ok(Object.values(result.checks).every(Boolean));
});

test('공백 없는 유효한 업무 헤더와 고객 미확인 표현도 같은 의미로 판정한다', () => {
  const input = passingInput();
  const detail = input.outputObservation.workbook.sheets[0].cells;
  detail.find((cell) => cell.address === 'G2').value = '출처파일';
  detail.find((cell) => cell.address === 'G2').text = '출처파일';
  detail.find((cell) => cell.address === 'H2').value = '통합상태';
  detail.find((cell) => cell.address === 'H2').text = '통합상태';
  detail.find((cell) => cell.address === 'B6').value = '고객 미확인';
  detail.find((cell) => cell.address === 'B6').text = '고객 미확인';
  const summary = input.outputObservation.workbook.sheets[1].cells;
  summary.find((cell) => cell.address === 'B2').value = '공급가액합계';
  summary.find((cell) => cell.address === 'B2').text = '공급가액합계';
  summary.find((cell) => cell.address === 'A5').value = '고객 미확인';
  summary.find((cell) => cell.address === 'A5').text = '고객 미확인';
  assert.equal(assessDocumentDataQualification(input).passed, true);
});

test('그럴듯한 답만 있어도 누락·억지 귀속·틀린 합계·미검산·원본 변경은 실패다', () => {
  for (const mutate of [
    (input) => { input.turns[0].receipts = []; },
    (input) => { input.outputObservation.workbook.sheets[0].cells = input.outputObservation.workbook.sheets[0].cells.filter((cell) => cell.address !== 'A6'); },
    (input) => { input.outputObservation.workbook.sheets[0].cells.find((cell) => cell.address === 'B6').value = '한빛상회'; },
    (input) => { input.outputObservation.workbook.sheets[1].cells.find((cell) => cell.address === 'B6').result = 65000; },
    (input) => { input.turns[3].receipts = []; },
    (input) => { input.sourceAfter['/tmp/a.xlsx'] = 'changed'; },
  ]) {
    const input = passingInput();
    mutate(input);
    assert.equal(assessDocumentDataQualification(input).passed, false);
  }
});
