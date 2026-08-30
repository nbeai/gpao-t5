import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zipSync, strToU8 } from 'fflate';

import {
  artifactPreviewKind, readWebBundleEntry, renderAttachmentPreview, webBundleManifest,
} from '../src/artifact-preview.js';
import { createWorkbookFromSpec } from '../src/document-data-inspector.js';
import { createPptxFromSpec } from '../src/pptx-deliverable.js';
import { makeBarChart, makeBarSeries, makeChartSpace } from '@office-kit/xlsx/chart';
import { addChartAt } from '@office-kit/xlsx/drawing';
import { workbookToBytes } from '@office-kit/xlsx/io';
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook';
import { mergeCells, setCell } from '@office-kit/xlsx/worksheet';

function record(overrides = {}) {
  return {
    attachmentId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    originalName: 'result.html', mimeType: 'text/html', kind: 'web', bytes: 20,
    ...overrides,
  };
}

test('결과물 형식은 HTML·SVG·PDF·DOCX·PPTX·XLSX·CSV를 한 preview 계약으로 분류한다', () => {
  assert.equal(artifactPreviewKind(record()), 'web');
  assert.equal(artifactPreviewKind(record({ originalName: 'mark.svg', mimeType: 'image/svg+xml' })), 'vector');
  assert.equal(artifactPreviewKind(record({ originalName: 'report.pdf', mimeType: 'application/pdf', kind: 'pdf' })), 'pdf');
  assert.equal(artifactPreviewKind(record({ originalName: 'report.docx', kind: 'document' })), 'document');
  assert.equal(artifactPreviewKind(record({ originalName: 'briefing.pptx', kind: 'document' })), 'presentation');
  assert.equal(artifactPreviewKind(record({ originalName: 'report.xlsx', kind: 'spreadsheet' })), 'spreadsheet');
  assert.equal(artifactPreviewKind(record({ originalName: 'report.csv', mimeType: 'text/csv', kind: 'text' })), 'spreadsheet');
  assert.equal(artifactPreviewKind(record({ originalName: 'raw.bin', mimeType: 'application/octet-stream', kind: 'binary' })), null);
});

test('PPTX 결과물은 모든 슬라이드를 제목·본문과 함께 사용자 Preview로 투영한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-artifact-pptx-preview-'));
  const file = join(room, '브리핑.pptx');
  await createPptxFromSpec({ output: file, spec: { title: '운영 브리핑', slides: [
    { title: '운영 브리핑', bullets: ['첫 번째 결정'] },
    { title: '다음 일정', body: '다음 검토는 금요일입니다.' },
  ] } });
  const bytes = await readFile(file);
  const result = await renderAttachmentPreview({
    record: record({ originalName: '브리핑.pptx', kind: 'document', storedPath: file, bytes: bytes.length }), bytes,
  });
  assert.equal(result.kind, 'presentation');
  assert.equal((result.body.match(/class="pptx-slide"/gu) ?? []).length, 2);
  assert.match(result.body, /운영 브리핑/u); assert.match(result.body, /다음 검토는 금요일/u);
  assert.match(result.body, /편집 가능한 발표자료/u);
});

test('HTML 결과물은 네트워크가 닫힌 별도 preview 문서로 반환된다', async () => {
  const result = await renderAttachmentPreview({
    record: record(),
    bytes: Buffer.from('<!doctype html><h1>말의 힘</h1><script>document.body.dataset.ok="1"</script>'),
  });
  assert.equal(result.kind, 'web');
  assert.equal(result.contentType, 'text/html; charset=utf-8');
  assert.match(result.contentSecurityPolicy, /default-src 'none'/);
  assert.match(result.contentSecurityPolicy, /connect-src 'none'/);
  assert.match(result.body, /말의 힘/);
});

test('DOCX 결과물은 문단·제목·표를 사용자 화면으로 투영하고 XML을 노출하지 않는다', async () => {
  const bytes = Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>월간 보고서</w:t></w:r></w:p>
        <w:p><w:r><w:t>이번 달 성과입니다.</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>금액</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`),
  }));
  const result = await renderAttachmentPreview({
    record: record({ originalName: '월간보고.docx', kind: 'document', bytes: bytes.length }), bytes,
  });
  assert.equal(result.kind, 'document');
  assert.match(result.body, /<h1>월간 보고서<\/h1>/);
  assert.match(result.body, /이번 달 성과입니다/);
  assert.match(result.body, /<table>/);
  assert.doesNotMatch(result.body, /w:document/);
});

test('XLSX 결과물은 실제 재개방된 셀·수식과 시트명을 표로 보여준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-artifact-preview-'));
  const file = join(room, '매출.xlsx');
  await createWorkbookFromSpec({
    output: file,
    spec: { sheets: [{
      name: '8월', title: '8월 매출',
      columns: [{ key: 'customer', header: '고객' }, { key: 'amount', header: '금액' }],
      rows: [{ customer: '한빛상회', amount: 33000 }],
      formulas: [{ cell: 'B4', formula: 'SUM(B3:B3)', result: 33000 }],
    }] },
  });
  const bytes = await readFile(file);
  const result = await renderAttachmentPreview({
    record: record({ originalName: '매출.xlsx', kind: 'spreadsheet', storedPath: file, bytes: bytes.length }), bytes,
  });
  assert.equal(result.kind, 'spreadsheet');
  assert.match(result.body, /8월/);
  assert.match(result.body, /한빛상회/);
  assert.match(result.body, /33000/);
  assert.match(result.body, /SUM\(B3:B3\)/);
});

test('XLSX preview는 병합 master만 그리고 원본 rowspan·colspan을 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-artifact-merged-preview-'));
  const file = join(room, '병합견적.xlsx');
  const workbook = createWorkbook(); const sheet = addWorksheet(workbook, 'Sheet1');
  setCell(sheet, 1, 1, '견적서'); mergeCells(sheet, 'A1:F1');
  setCell(sheet, 2, 1, '업체명'); setCell(sheet, 2, 2, '한빛상회'); mergeCells(sheet, 'B2:C2');
  setCell(sheet, 2, 4, '상호명'); mergeCells(sheet, 'D2:F2');
  await writeFile(file, await workbookToBytes(workbook)); const bytes = await readFile(file);
  const result = await renderAttachmentPreview({
    record: record({ originalName: '병합견적.xlsx', kind: 'spreadsheet', storedPath: file, bytes: bytes.length }), bytes,
  });
  assert.match(result.body, /<td colspan="6"><span class="cell-address">A1<\/span>견적서<\/td>/u);
  assert.match(result.body, /<td colspan="2"><span class="cell-address">B2<\/span>한빛상회<\/td>/u);
  assert.match(result.body, /<td colspan="3"><span class="cell-address">D2<\/span>상호명<\/td>/u);
  assert.equal((result.body.match(/한빛상회/gu) ?? []).length, 1);
});

test('CSV 결과물은 따옴표와 쉼표를 보존해 표로 보여준다', async () => {
  const bytes = Buffer.from('고객,메모,금액\n한빛상회,"서울, 강남",33000\n');
  const result = await renderAttachmentPreview({
    record: record({ originalName: '매출.csv', mimeType: 'text/csv', kind: 'text', bytes: bytes.length }), bytes,
  });
  assert.equal(result.kind, 'spreadsheet');
  assert.match(result.body, /한빛상회/);
  assert.match(result.body, /서울, 강남/);

  const cp949 = Buffer.from('b0edb0b42cb1ddbed70ac7d1bafbbbf3c8b82c34303330300a', 'hex');
  const legacy = await renderAttachmentPreview({
    record: record({
      originalName: '구형.csv', mimeType: 'text/csv', kind: 'text',
      encoding: 'windows-949-compatible', bytes: cp949.length,
    }),
    bytes: cp949,
  });
  assert.match(legacy.body, /한빛상회/); assert.match(legacy.body, /40300/);
});

test('빌드된 React·여러 파일 웹앱은 index.html 정적 꾸러미만 격리 preview한다', () => {
  const bytes = Buffer.from(zipSync({
    'index.html': strToU8('<!doctype html><div id="root">앱 화면</div><script src="assets/app.js"></script>'),
    'assets/app.js': strToU8('document.querySelector("#root").dataset.ready="yes"'),
    'assets/app.css': strToU8('body{color:#123}'),
  }));
  const manifest = webBundleManifest(bytes);
  assert.equal(manifest.state, 'ready');
  assert.deepEqual(manifest.files.map((file) => file.path), ['assets/app.css', 'assets/app.js', 'index.html']);
  const entry = readWebBundleEntry(bytes, 'index.html');
  assert.equal(entry.contentType, 'text/html; charset=utf-8');
  assert.match(entry.body.toString(), /앱 화면/);
  assert.throws(() => readWebBundleEntry(bytes, '../secret'), /not found|invalid/i);
});

test('Excel 차트는 cached category·value를 실제 차트 미리보기로 보여준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-artifact-chart-'));
  const file = join(room, '차트.xlsx');
  const workbook = createWorkbook(); const sheet = addWorksheet(workbook, '매출');
  setCell(sheet, 1, 1, '고객'); setCell(sheet, 1, 2, '금액');
  setCell(sheet, 2, 1, '한빛'); setCell(sheet, 2, 2, 330);
  setCell(sheet, 3, 1, '새봄'); setCell(sheet, 3, 2, 220);
  const series = makeBarSeries({
    idx: 0, val: { ref: '매출!$B$2:$B$3', cache: [330, 220] },
    cat: { ref: '매출!$A$2:$A$3', cacheKind: 'str', cache: ['한빛', '새봄'] },
    tx: { kind: 'literal', value: '고객별 매출' },
  });
  addChartAt(sheet, 'D2', { space: makeChartSpace({
    title: '고객별 매출 차트', plotArea: { chart: makeBarChart({ series: [series] }) },
  }) });
  await writeFile(file, await workbookToBytes(workbook));
  const bytes = await readFile(file);
  const result = await renderAttachmentPreview({
    record: record({ originalName: '차트.xlsx', kind: 'spreadsheet', storedPath: file, bytes: bytes.length }), bytes,
  });
  assert.match(result.body, /고객별 매출 차트/);
  assert.match(result.body, /한빛/);
  assert.match(result.body, /330/);
  assert.match(result.body, /artifact-chart/);
});
