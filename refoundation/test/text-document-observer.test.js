import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeTextDocument, detectTextDocument, inspectDelimitedText,
} from '../src/text-document-observer.js';

const KOREAN = '고객,금액\n한빛상회,40300\n';
const CP949 = Buffer.from('b0edb0b42cb1ddbed70ac7d1bafbbbf3c8b82c34303330300a', 'hex');

function utf16be(text) {
  const bytes = Buffer.from(text, 'utf16le');
  for (let index = 0; index < bytes.length; index += 2) {
    const first = bytes[index]; bytes[index] = bytes[index + 1]; bytes[index + 1] = first;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), bytes]);
}

test('BOM·strict UTF-8·UTF-16은 encoding과 exact round-trip 근거를 보존한다', () => {
  const fixtures = [
    [Buffer.from(KOREAN), 'utf-8', null],
    [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(KOREAN)]), 'utf-8', 'utf-8'],
    [Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(KOREAN, 'utf16le')]), 'utf-16le', 'utf-16le'],
    [utf16be(KOREAN), 'utf-16be', 'utf-16be'],
  ];
  for (const [bytes, encoding, bom] of fixtures) {
    const detected = detectTextDocument(bytes, '정산.csv');
    assert.equal(detected.encoding, encoding); assert.equal(detected.evidence.bom, bom);
    assert.equal(detected.evidence.strictDecode, true); assert.equal(detected.evidence.roundTrip, 'exact');
    assert.equal(decodeTextDocument(bytes, detected.encoding), KOREAN);
  }
});

test('CP949/EUC-KR 공통 바이트는 한쪽으로 꾸미지 않고 호환 후보와 미지원 round-trip을 밝힌다', () => {
  const detected = detectTextDocument(CP949, '오래된_정산.csv');
  assert.equal(detected.encoding, 'windows-949-compatible');
  assert.deepEqual(detected.evidence.candidates, ['cp949', 'euc-kr']);
  assert.equal(detected.evidence.ambiguous, true);
  assert.equal(detected.evidence.replacementCharacters, 0);
  assert.equal(detected.evidence.roundTrip, 'not_available_in_native_runtime');
  assert.equal(decodeTextDocument(CP949, detected.encoding), KOREAN);
});

test('같은 legacy byte라도 텍스트 확장자 근거가 없거나 깨진 byte·binary이면 텍스트로 승격하지 않는다', () => {
  assert.equal(detectTextDocument(CP949, 'unknown.bin'), null);
  assert.equal(detectTextDocument(Buffer.from([0x81]), 'broken.txt'), null);
  assert.equal(detectTextDocument(Buffer.from([0x00, 0x01, 0x02, 0xff]), 'data.csv'), null);
  assert.equal(detectTextDocument(Buffer.from([0xff, 0xfe, 0x00]), 'odd.txt'), null);
});

test('CSV 구조는 quote·escaped quote·CRLF·빈 셀·불균일 열과 전체/표시 범위를 분리한다', () => {
  const observed = inspectDelimitedText('고객,메모,금액\r\n한빛상회,"쉼표, 포함",40300\r\n새봄,"따옴표 ""포함""",\r\n열부족,1\r\n');
  assert.deepEqual(observed.header, ['고객', '메모', '금액']);
  assert.deepEqual(observed.rows[0], ['한빛상회', '쉼표, 포함', '40300']);
  assert.deepEqual(observed.rows[1], ['새봄', '따옴표 "포함"', '']);
  assert.equal(observed.rowCount, 4); assert.equal(observed.columnCount, 3);
  assert.equal(observed.emptyCells, 1); assert.equal(observed.irregularRows, 1);
  assert.equal(observed.malformedQuotedField, false);
  assert.equal(observed.projection.truncated, false);

  const truncated = inspectDelimitedText('a,b\n1,2\n3,4\n', { maxRows: 2, maxColumns: 1 });
  assert.equal(truncated.projection.truncated, true);
  assert.equal(truncated.projection.omittedRows, 1); assert.equal(truncated.projection.omittedColumns, 1);
  assert.equal(inspectDelimitedText('a,"open\n').malformedQuotedField, true);
});

test('TSV는 같은 구조 계약에서 delimiter만 명시적으로 다르다', () => {
  const observed = inspectDelimitedText('고객\t금액\n한빛상회\t40300\n', { delimiter: '\t' });
  assert.equal(observed.delimiter, 'tab');
  assert.deepEqual(observed.header, ['고객', '금액']);
  assert.deepEqual(observed.rows, [['한빛상회', '40300']]);
});
