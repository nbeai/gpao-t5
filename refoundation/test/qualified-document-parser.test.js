import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGeneratedCompatibilityFixtures } from '../src/document-compatibility-baseline.js';
import {
  QUALIFIED_DOCUMENT_PARSER, detectQualifiedDocumentFormat, inspectQualifiedDocument,
} from '../src/qualified-document-parser.js';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

test('split parser 표면은 자격화한 다섯 읽기만 열고 PDF·OCR·MCP·생성을 제외한다', () => {
  assert.deepEqual(QUALIFIED_DOCUMENT_PARSER.formats, ['hwp3', 'hwp5', 'hwpx', 'xls', 'docx']);
  assert.deepEqual(QUALIFIED_DOCUMENT_PARSER.excludedSurfaces, [
    'pdf', 'ocr', 'image', 'mcp', 'cli', 'generate', 'fill', 'patch',
  ]);
  assert.equal(QUALIFIED_DOCUMENT_PARSER.version, '4.9.1');
  assert.match(QUALIFIED_DOCUMENT_PARSER.tarballSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(QUALIFIED_DOCUMENT_PARSER.isolation, {
    process: 'node-permission-worker', input: 'stdin-exact-bytes', filesystemWrite: false,
    network: false, childProcess: false, workerThreads: false,
  });
});

test('Kordoc CLI와 MCP bin은 일반 terminal PATH 표면에 설치되지 않는다', async () => {
  const bin = join(process.cwd(), 'refoundation', 'node_modules', '.bin');
  for (const name of ['kordoc', 'kordoc-mcp']) {
    await assert.rejects(() => access(join(bin, name)), (error) => error?.code === 'ENOENT');
  }
});

test('형식 발견은 확장자와 구조가 함께 맞는 자격 형식만 선택한다', () => {
  const hwp3 = Buffer.from('HWP Document File V3.00 fake body');
  const ole = Buffer.from('d0cf11e0a1b11ae1', 'hex');
  const docx = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('word/document.xml')]);
  const hwpx = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('Contents/content.hpf')]);
  assert.equal(detectQualifiedDocumentFormat(hwp3, '문서.hwp'), 'hwp3');
  assert.equal(detectQualifiedDocumentFormat(ole, '문서.hwp'), 'hwp5');
  assert.equal(detectQualifiedDocumentFormat(ole, '예산.xls'), 'xls');
  assert.equal(detectQualifiedDocumentFormat(docx, '계약.docx'), 'docx');
  assert.equal(detectQualifiedDocumentFormat(hwpx, '공문.hwpx'), 'hwpx');
  assert.equal(detectQualifiedDocumentFormat(docx, '이름만.hwpx'), null);
  assert.equal(detectQualifiedDocumentFormat(Buffer.from('%PDF-1.7'), '문서.pdf'), null);
});

test('DOCX worker는 exact bytes를 읽기 전용으로 관측하고 본문·표·coverage를 bounded 반환한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qualified-docx-'));
  const fixtures = await createGeneratedCompatibilityFixtures(room);
  const definition = fixtures.find((row) => row.caseId === 'modern-docx');
  const bytes = await readFile(definition.path);
  const observed = await inspectQualifiedDocument({
    bytes, format: 'docx', sourceSha256: definition.sha256, maxChars: 100, maxCells: 10,
  });
  assert.equal(observed.state, 'observed');
  assert.equal(observed.format, 'docx');
  assert.match(observed.text, /한빛상회 계약 검토/u);
  assert.equal(observed.structure.tables[0].rows, 1);
  assert.deepEqual(observed.structure.tables[0].cells[0].map((cell) => cell.text), ['금액', '40300']);
  assert.equal(observed.coverage.truncated, false);
  assert.equal(observed.sourceSha256, definition.sha256);
  assert.equal(observed.parser.version, '4.9.1');
});

test('원본 digest 불일치와 형식 위장은 worker 실행 결과로 승격되지 않는다', async () => {
  const bytes = Buffer.from('HWP Document File V3.00 truncated');
  await assert.rejects(() => inspectQualifiedDocument({
    bytes, format: 'hwp3', sourceSha256: '0'.repeat(64),
  }), /source digest mismatch/u);
  const rejected = await inspectQualifiedDocument({
    bytes, format: 'hwp3', sourceSha256: sha256(bytes),
  });
  assert.equal(rejected.state, 'capability_boundary');
  assert.equal(rejected.errorCode, 'CORRUPTED');
  assert.equal(rejected.sourceSha256, sha256(bytes));
});
