import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

import { setFormula } from '@office-kit/xlsx/cell';
import { workbookToBytes } from '@office-kit/xlsx/io';
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook';
import {
  hideColumn, hideRow, mergeCells, setCell,
} from '@office-kit/xlsx/worksheet';
import { setCellNumberFormat } from '@office-kit/xlsx/styles';

import {
  createWorkbookFromSpec, inspectBusinessDocument,
} from '../src/document-data-inspector.js';

async function makeWorkbook(file) {
  const workbook = createWorkbook();
  const sheet = addWorksheet(workbook, '8월 견적');
  setCell(sheet, 1, 1, '한빛상회 8월 견적');
  mergeCells(sheet, 'A1:D1');
  ['품목', '수량', '단가', '금액'].forEach((value, index) => setCell(sheet, 2, index + 1, value));
  ['원두 1kg', 2, 15000].forEach((value, index) => setCell(sheet, 3, index + 1, value));
  ['우유', 3, 1100].forEach((value, index) => setCell(sheet, 4, index + 1, value));
  const d3 = setCell(sheet, 3, 4);
  const d4 = setCell(sheet, 4, 4);
  setFormula(d3, 'B3*C3', { cachedValue: 30000 });
  setFormula(d4, 'B4*C4', { cachedValue: 3300 });
  setCellNumberFormat(workbook, d3, '#,##0');
  setCellNumberFormat(workbook, d4, '#,##0');
  hideRow(sheet, 4);
  hideColumn(sheet, 5);
  const hidden = addWorksheet(workbook, '내부 메모', { state: 'veryHidden' });
  setCell(hidden, 1, 1, '사용자 결과에 자동 포함하지 말 것');
  await writeFile(file, await workbookToBytes(workbook));
}

function makePdf(text) {
  const escaped = text.replace(/[()\\]/g, '\\$&');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

function makeIndependentXlsx() {
  const xml = (text) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${text}`);
  return Buffer.from(zipSync({
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="외부 견적" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': xml('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="5" max="5" hidden="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>외부 도구 생성 견적</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>품목</t></is></c><c r="B2" t="inlineStr"><is><t>수량</t></is></c><c r="C2" t="inlineStr"><is><t>단가</t></is></c><c r="D2" t="inlineStr"><is><t>금액</t></is></c></row><row r="3" hidden="1"><c r="A3" t="inlineStr"><is><t>원두</t></is></c><c r="B3"><v>2</v></c><c r="C3"><v>15000</v></c><c r="D3" s="1"><f>B3*C3</f><v>30000</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells></worksheet>'),
  }));
}

test('XLSX 관측은 병합·숨김·셀 주소·수식과 표시 결과를 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-xlsx-'));
  const file = join(room, '견적.xlsx');
  await makeWorkbook(file);

  const observation = await inspectBusinessDocument({ file });
  assert.equal(observation.schema, 't5.document-observation.v1');
  assert.equal(observation.kind, 'xlsx');
  assert.equal(observation.file.path, await realpath(file));
  assert.equal(observation.file.sha256.length, 64);
  assert.equal(observation.workbook.sheetCount, 2);
  const quote = observation.workbook.sheets.find((sheet) => sheet.name === '8월 견적');
  assert.deepEqual(quote.merges, ['A1:D1']);
  assert.deepEqual(quote.hiddenRows, [4]);
  assert.deepEqual(quote.hiddenColumns, ['E']);
  const amount = quote.cells.find((cell) => cell.address === 'D4');
  assert.equal(amount.formula, 'B4*C4');
  assert.equal(amount.result, 3300);
  assert.equal(amount.numberFormat, '#,##0');
  assert.equal(amount.merged, false);
  const title = quote.cells.find((cell) => cell.address === 'A1');
  assert.equal(title.merged, true);
  assert.equal(title.mergeMaster, 'A1');
  assert.equal(observation.workbook.sheets.find((sheet) => sheet.name === '내부 메모').state, 'veryHidden');
  assert.equal(observation.projection.truncated, false);
});

test('XLSX 관측 상한은 본 셀 수와 생략 수를 숨기지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-cap-'));
  const file = join(room, 'large.xlsx');
  const workbook = createWorkbook();
  const sheet = addWorksheet(workbook, '자료');
  for (let row = 1; row <= 20; row += 1) {
    setCell(sheet, row, 1, `row-${row}`);
    setCell(sheet, row, 2, row);
  }
  await writeFile(file, await workbookToBytes(workbook));
  const observation = await inspectBusinessDocument({ file, maxCells: 7 });
  assert.equal(observation.projection.truncated, true);
  assert.equal(observation.projection.shownCells, 7);
  assert.equal(observation.projection.totalCells, 40);
  assert.equal(observation.projection.omittedCells, 33);
});

test('자체 writer가 아닌 표준 OOXML도 병합·숨김·수식 결과와 함께 읽는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-independent-'));
  const file = join(room, 'external.xlsx');
  await writeFile(file, makeIndependentXlsx());
  const observation = await inspectBusinessDocument({ file });
  const sheet = observation.workbook.sheets[0];
  assert.equal(sheet.name, '외부 견적');
  assert.deepEqual(sheet.merges, ['A1:D1']);
  assert.deepEqual(sheet.hiddenRows, [3]);
  assert.deepEqual(sheet.hiddenColumns, ['E']);
  const total = sheet.cells.find((cell) => cell.address === 'D3');
  assert.equal(total.formula, 'B3*C3');
  assert.equal(total.result, 30000);
  assert.equal(total.numberFormat, '#,##0');
});

test('일반 workbook 명세는 새 XLSX를 만들고 같은 관측기로 다시 검증한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-create-'));
  const output = join(room, '통합표.xlsx');
  const result = await createWorkbookFromSpec({
    output,
    spec: {
      sheets: [{
        name: '통합',
        title: '8월 견적 통합',
        columns: [
          { key: 'customer', header: '고객', width: 18 },
          { key: 'amount', header: '금액', width: 14, numberFormat: '#,##0' },
          { key: 'source', header: '출처', width: 36 },
        ],
        rows: [
          { customer: '한빛상회', amount: 33300, source: '견적.xlsx · 8월 견적!D3:D4' },
          { customer: '새봄상사', amount: 25000, source: '정산.pdf · page 1' },
        ],
        formulas: [{ cell: 'B5', formula: 'SUM(B3:B4)', result: 58300, numberFormat: '#,##0' }],
      }],
    },
  });
  assert.equal(result.created, true);
  assert.equal(result.observation.file.path, await realpath(output));
  const sheet = result.observation.workbook.sheets[0];
  assert.equal(sheet.cells.find((cell) => cell.address === 'B5').formula, 'SUM(B3:B4)');
  assert.equal(sheet.cells.find((cell) => cell.address === 'B5').result, 58300);
  assert.match(sheet.cells.find((cell) => cell.address === 'C3').text, /견적\.xlsx/);
  await assert.rejects(() => createWorkbookFromSpec({ output, spec: { sheets: [] } }), /already exists/i);
});

test('계산 결과가 없는 수식과 root 밖 symlink 입력은 실행 전에 거부한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-stop-'));
  const output = join(room, 'bad.xlsx');
  await assert.rejects(() => createWorkbookFromSpec({
    output,
    spec: { sheets: [{ name: '자료', columns: [], rows: [], formulas: [{ cell: 'A1', formula: '1+1' }] }] },
  }), /formula result is required/i);

  const actual = join(room, 'actual.xlsx');
  await makeWorkbook(actual);
  const linkDir = join(room, 'links');
  await mkdir(linkDir);
  const linked = join(linkDir, 'linked.xlsx');
  await symlink(actual, linked);
  await assert.rejects(() => inspectBusinessDocument({ file: linked }), /symbolic link/i);
});

test('workbook 명세의 과도한 시트·셀 문자열·비유한 숫자는 파일 생성 전에 멈춘다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-spec-limit-'));
  const make = (spec, name) => createWorkbookFromSpec({ output: join(room, name), spec });
  await assert.rejects(() => make({
    sheets: Array.from({ length: 21 }, (_, index) => ({
      name: `sheet-${index}`, columns: [{ key: 'v', header: '값' }], rows: [],
    })),
  }, 'too-many.xlsx'), /at most 20 sheets/i);
  await assert.rejects(() => make({ sheets: [{
    name: '자료', columns: [{ key: 'v', header: '값' }], rows: [{ v: 'x'.repeat(32_768) }],
  }] }, 'long-cell.xlsx'), /cell text exceeds/i);
  await assert.rejects(() => make({ sheets: [{
    name: '자료', columns: [{ key: 'v', header: '값' }], rows: [{ v: Number.POSITIVE_INFINITY }],
  }] }, 'infinite.xlsx'), /finite number/i);
});

test('PDF 관측은 페이지별 출처를 남기고 텍스트 없는 문서를 OCR 필요 후보로 구분한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-pdf-'));
  const readable = join(room, 'settlement.pdf');
  const blank = join(room, 'scan.pdf');
  await writeFile(readable, makePdf('Settlement August total 58300 source receipt 17'));
  await writeFile(blank, makePdf(''));

  const observed = await inspectBusinessDocument({ file: readable });
  assert.equal(observed.kind, 'pdf');
  assert.equal(observed.pdf.pageCount, 1);
  assert.match(observed.pdf.pages[0].text, /Settlement August/);
  assert.equal(observed.pdf.pages[0].page, 1);
  assert.equal(observed.pdf.requiresOcrOrVision, false);

  const scanned = await inspectBusinessDocument({ file: blank });
  assert.equal(scanned.pdf.requiresOcrOrVision, true);
  assert.equal(scanned.pdf.pages[0].text, '');
  assert.ok((await readFile(blank)).length > 0);
});
