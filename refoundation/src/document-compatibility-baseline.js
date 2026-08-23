import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { workbookToBytes } from '@office-kit/xlsx/io';
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook';
import { setCell } from '@office-kit/xlsx/worksheet';
import { strToU8, unzipSync, zipSync } from 'fflate';

const SCHEMA = 't5.document-compatibility-baseline.v1';
const CAPABILITIES = new Set([
  'format_identity', 'encoding_identity', 'text_content', 'tabular_structure',
  'page_structure', 'ocr_need_detection', 'ocr_completion',
]);

export const PINNED_DOCUMENT_FIXTURES = Object.freeze([
  {
    caseId: 'legacy-xls-biff8-korean', family: 'spreadsheet', format: 'xls', fileName: '구형_한국어_예산.xls',
    url: 'https://raw.githubusercontent.com/chrisryugj/kordoc/c3ec5b5358197e488f96e5aa05ef9ad683359352/tests/fixtures/xls/budget.xls',
    sha256: '69a4180a7b2d8044220ea2b35116c0c1fe3d4b0dd247d025c0dbc0daf211e14b',
    sourceCommit: 'c3ec5b5358197e488f96e5aa05ef9ad683359352', license: 'MIT',
    expectedText: ['2025년도 부서별 예산 편성', '기획조정실', '12500000000'],
    required: ['format_identity', 'text_content', 'tabular_structure'],
  },
  {
    caseId: 'legacy-doc-ole2', family: 'word_processing', format: 'doc', fileName: '구형_Word_문서.doc',
    url: 'https://raw.githubusercontent.com/apache/poi/08830a9453119cd1a47428bc25744b02d7472fb8/test-data/document/47304.doc',
    sha256: '39170c5a103bb0961b269be04da00ae2ae961da6a26f1624f462ac915adaf13e',
    sourceCommit: '08830a9453119cd1a47428bc25744b02d7472fb8', license: 'Apache-2.0',
    required: ['format_identity', 'text_content'],
  },
  {
    caseId: 'legacy-ppt-ole2', family: 'presentation', format: 'ppt', fileName: '구형_PowerPoint_자료.ppt',
    url: 'https://raw.githubusercontent.com/apache/poi/08830a9453119cd1a47428bc25744b02d7472fb8/test-data/slideshow/41071.ppt',
    sha256: '7eed4b72a235b4122b07b371fb02fbb5ae95d47dc70592ce37bb6bf4a6e94de4',
    sourceCommit: '08830a9453119cd1a47428bc25744b02d7472fb8', license: 'Apache-2.0',
    required: ['format_identity', 'text_content'],
  },
  {
    caseId: 'korean-hwp3', family: 'korean_document', format: 'hwp3', fileName: '한글_3_문서.hwp',
    url: 'https://raw.githubusercontent.com/edwardkim/rhwp/496333b27d21ddb9114ba9ae340bcb895870c9a7/samples/hwp3-sample.hwp',
    sha256: '645525c8cd5ec11b1742ba7cfc759f68622861916233b5e982385cdb12f0ced2',
    sourceCommit: '496333b27d21ddb9114ba9ae340bcb895870c9a7', license: 'MIT',
    required: ['format_identity', 'text_content', 'tabular_structure'],
  },
  {
    caseId: 'korean-hwp5', family: 'korean_document', format: 'hwp5', fileName: '한글_5_문서.hwp',
    url: 'https://raw.githubusercontent.com/edwardkim/rhwp/496333b27d21ddb9114ba9ae340bcb895870c9a7/samples/HWP5-nopassword-123456.hwp',
    sha256: 'a34ecb8cde85b6db49c64a954cb7fa5d23b5f49367bc4753c90bfe89a075b50d',
    sourceCommit: '496333b27d21ddb9114ba9ae340bcb895870c9a7', license: 'MIT',
    required: ['format_identity', 'text_content', 'tabular_structure'],
  },
  {
    caseId: 'korean-hwpx', family: 'korean_document', format: 'hwpx', fileName: '한글_XML_문서.hwpx',
    url: 'https://raw.githubusercontent.com/edwardkim/rhwp/496333b27d21ddb9114ba9ae340bcb895870c9a7/samples/HWP5-nopassword-123456.hwpx',
    sha256: '20ed90f48c6501cad99f6aa1f82d81d2a2132eb04f2d1d32805ac251749e4d0e',
    sourceCommit: '496333b27d21ddb9114ba9ae340bcb895870c9a7', license: 'MIT',
    required: ['format_identity', 'text_content', 'tabular_structure'],
  },
]);

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function textPdf(text = '') {
  const operation = text ? `BT /F1 12 Tf 72 720 Td (${String(text).replace(/[()\\]/g, '\\$&')}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(operation)} >>\nstream\n${operation}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body); body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

function packageBytes(entries) {
  return Buffer.from(zipSync(
    Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])),
    { mtime: new Date('2020-01-01T00:00:00.000Z') },
  ));
}

function docxBytes() {
  return packageBytes({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>한빛상회 계약 검토</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>금액</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>40300</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  });
}

function pptxBytes() {
  return packageBytes({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    'ppt/presentation.xml': '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>',
    'ppt/slides/slide1.xml': '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:t>2026 운영 계획</a:t></p:cSld></p:sld>',
  });
}

function odfBytes(kind) {
  const spreadsheet = kind === 'ods'; const mime = spreadsheet
    ? 'application/vnd.oasis.opendocument.spreadsheet' : 'application/vnd.oasis.opendocument.text';
  const body = spreadsheet
    ? '<office:spreadsheet><table:table table:name="정산"><table:table-row><table:table-cell office:value-type="string"><text:p>한빛상회</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="40300"><text:p>40300</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>'
    : '<office:text><text:p>한빛상회 계약 검토 40300원</text:p></office:text>';
  return packageBytes({
    mimetype: mime,
    'META-INF/manifest.xml': `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
    'content.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:body>${body}</office:body></office:document-content>`,
  });
}

async function xlsxBytes() {
  const workbook = createWorkbook(); const sheet = addWorksheet(workbook, '정산');
  setCell(sheet, 1, 1, '고객'); setCell(sheet, 1, 2, '금액');
  setCell(sheet, 2, 1, '한빛상회'); setCell(sheet, 2, 2, 40300);
  return packageBytes(unzipSync(new Uint8Array(await workbookToBytes(workbook))));
}

export async function createGeneratedCompatibilityFixtures(directory) {
  await mkdir(directory, { recursive: true });
  const fixtures = [
    { caseId: 'utf8-text', family: 'text', format: 'text', encoding: 'utf-8', fileName: 'UTF8_메모.txt', bytes: Buffer.from('고객 한빛상회, 금액 40300원\n'), expectedText: ['한빛상회', '40300'], required: ['format_identity', 'encoding_identity', 'text_content'] },
    { caseId: 'utf8-bom-csv', family: 'text', format: 'csv', encoding: 'utf-8', fileName: 'UTF8_BOM_정산.csv', bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('고객,금액\n한빛상회,40300\n')]), expectedText: ['한빛상회', '40300'], required: ['format_identity', 'encoding_identity', 'text_content', 'tabular_structure'] },
    { caseId: 'utf16le-text', family: 'text', format: 'text', encoding: 'utf-16le', fileName: 'UTF16_메모.txt', bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('고객 한빛상회, 금액 40300원\n', 'utf16le')]), expectedText: ['한빛상회', '40300'], required: ['format_identity', 'encoding_identity', 'text_content'] },
    { caseId: 'cp949-csv', family: 'text', format: 'csv', encoding: 'cp949', fileName: 'CP949_정산.csv', bytes: Buffer.from('b0edb0b42cb1ddbed70ac7d1bafbbbf3c8b82c34303330300a', 'hex'), expectedText: ['한빛상회', '40300'], required: ['format_identity', 'encoding_identity', 'text_content', 'tabular_structure'] },
    { caseId: 'modern-xlsx', family: 'spreadsheet', format: 'xlsx', fileName: '현재_정산.xlsx', bytes: await xlsxBytes(), expectedText: ['한빛상회', '40300'], required: ['format_identity', 'text_content', 'tabular_structure'] },
    { caseId: 'text-pdf', family: 'pdf', format: 'pdf', fileName: '텍스트_PDF.pdf', bytes: textPdf('HANBIT SHOP AMOUNT 40300'), expectedText: ['HANBIT SHOP', '40300'], required: ['format_identity', 'text_content', 'page_structure'] },
    { caseId: 'textless-pdf', family: 'pdf', format: 'pdf', fileName: '텍스트층없는_PDF.pdf', bytes: textPdf(), required: ['format_identity', 'ocr_need_detection', 'ocr_completion'] },
    { caseId: 'modern-docx', family: 'word_processing', format: 'docx', fileName: '현재_Word_문서.docx', bytes: docxBytes(), expectedText: ['한빛상회', '40300'], required: ['format_identity', 'text_content', 'tabular_structure'] },
    { caseId: 'modern-pptx', family: 'presentation', format: 'pptx', fileName: '현재_PowerPoint_자료.pptx', bytes: pptxBytes(), expectedText: ['2026 운영 계획'], required: ['format_identity', 'text_content'] },
    { caseId: 'open-document-text', family: 'word_processing', format: 'odt', fileName: '개방형_문서.odt', bytes: odfBytes('odt'), expectedText: ['한빛상회', '40300'], required: ['format_identity', 'text_content'] },
    { caseId: 'open-document-sheet', family: 'spreadsheet', format: 'ods', fileName: '개방형_정산.ods', bytes: odfBytes('ods'), expectedText: ['한빛상회', '40300'], required: ['format_identity', 'text_content', 'tabular_structure'] },
  ];
  return Promise.all(fixtures.map(async (item) => {
    const path = join(directory, item.fileName); await writeFile(path, item.bytes);
    return { ...item, path, bytes: item.bytes.length, sha256: hash(item.bytes), sourceKind: 'generated_fixture' };
  }));
}

export async function fetchPinnedCompatibilityFixtures(directory, { fetchImpl = fetch } = {}) {
  await mkdir(directory, { recursive: true }); const output = [];
  for (const item of PINNED_DOCUMENT_FIXTURES) {
    const response = await fetchImpl(item.url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`fixture download failed: ${item.caseId} HTTP ${response.status}`);
    const maxBytes = 2 * 1024 * 1024; const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`fixture exceeds baseline size limit: ${item.caseId}`);
    if (!response.body) throw new Error(`fixture response body missing: ${item.caseId}`);
    const reader = response.body.getReader(); const chunks = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length; if (total > maxBytes) { await reader.cancel(); throw new Error(`fixture exceeds baseline size limit: ${item.caseId}`); }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks, total);
    const digest = hash(bytes); if (digest !== item.sha256) throw new Error(`fixture digest mismatch: ${item.caseId}`);
    const path = join(directory, item.fileName); await writeFile(path, bytes, { mode: 0o600 });
    output.push({ ...item, path, bytes: bytes.length, sourceKind: 'pinned_public_fixture' });
  }
  return output;
}

function detectedFormat(record = {}) {
  const mime = String(record.mimeType ?? '').toLowerCase();
  if (mime === 'text/plain') return 'text'; if (mime === 'text/csv') return 'csv';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('spreadsheetml.sheet')) return 'xlsx';
  if (mime.includes('wordprocessingml.document')) return 'docx';
  if (mime.includes('presentationml.presentation')) return 'pptx';
  return 'unknown';
}

export function summarizeCompatibilityObservation(definition, record, inspected) {
  const observation = inspected?.observation ?? null; const pdf = observation?.pdf;
  const workbook = observation?.workbook;
  const qualified = observation?.kind === 'qualified_document' ? observation : null;
  const text = ['text', 'tabular_text', 'qualified_document'].includes(observation?.kind) ? observation.text : null;
  const format = qualified?.format ?? detectedFormat(record); const observedText = [
    text, ...(pdf?.pages ?? []).map((page) => page.text),
    ...(workbook?.sheets ?? []).flatMap((sheet) => (sheet.cells ?? []).flatMap((cell) => [cell.text, cell.value, cell.result])),
  ].filter((value) => value != null).join('\n');
  const expectedText = definition.expectedText ?? [];
  const contentText = expectedText.length ? expectedText.every((anchor) => observedText.includes(anchor)) : observedText.trim().length > 0;
  const structure = Boolean(workbook?.sheets?.length) || Boolean(pdf?.pageCount);
  const capabilities = {
    format_identity: format === definition.format,
    encoding_identity: definition.encoding == null ? null : record.kind === 'text' && (
      record.encoding === definition.encoding
      || definition.encoding === 'cp949' && record.encoding === 'windows-949-compatible'
    ),
    text_content: contentText,
    tabular_structure: Boolean(workbook?.sheets?.some((sheet) => sheet.cells?.length))
      || Boolean(qualified?.structure?.tables?.some((table) => table.shownCells > 0))
      || Boolean(observation?.table?.rowCount && observation?.table?.columnCount),
    page_structure: Boolean(pdf?.pageCount) || Number(qualified?.structure?.pageCount ?? 0) > 0,
    ocr_need_detection: pdf?.requiresOcrOrVision === true,
    ocr_completion: false,
  };
  const missing = definition.required.filter((name) => !capabilities[name]);
  return {
    caseId: definition.caseId, family: definition.family, expectedFormat: definition.format,
    sourceKind: definition.sourceKind, sourceSha256: definition.sha256,
    record: { kind: record.kind, mimeType: record.mimeType, bytes: record.bytes, sha256: record.sha256 },
    inspection: {
      state: inspected?.state ?? 'failed', observedKind: observation?.kind ?? null,
      capabilityReason: observation?.reason ?? null, expectedTextAnchors: expectedText.length,
      matchedTextAnchors: expectedText.filter((anchor) => observedText.includes(anchor)).length,
    },
    detectedFormat: format, capabilities, required: [...definition.required], missing,
    targetReady: missing.length === 0,
    truthfulBoundary: inspected?.state === 'observed' || inspected?.state === 'capability_boundary',
  };
}

export function assessDocumentCompatibilityBaseline(cases = [], observations = []) {
  const ids = new Set();
  for (const item of cases) {
    if (!item.caseId || ids.has(item.caseId)) throw new Error('document compatibility cases require unique caseId');
    ids.add(item.caseId); if (!item.family || !item.format || !item.sha256 || !item.sourceKind) throw new Error('document compatibility case metadata is incomplete');
    if (!Array.isArray(item.required) || !item.required.length || item.required.some((name) => !CAPABILITIES.has(name))) throw new Error('document compatibility case capabilities are invalid');
  }
  const requiredFamilies = ['text', 'spreadsheet', 'pdf', 'word_processing', 'presentation', 'korean_document'];
  const families = new Set(cases.map((item) => item.family)); const gaps = requiredFamilies.filter((family) => !families.has(family)).map((family) => `missing family: ${family}`);
  const byId = new Map(observations.map((item) => [item.caseId, item]));
  const rows = cases.map((item) => {
    const actual = byId.get(item.caseId); const checks = {
      measured: Boolean(actual), sourceIdentity: actual?.sourceSha256 === item.sha256,
      exactReceiptIdentity: actual?.record?.sha256 === item.sha256,
      truthfulBoundary: actual?.truthfulBoundary === true,
    };
    return { caseId: item.caseId, family: item.family, checks, measured: Object.values(checks).every(Boolean), targetReady: actual?.targetReady === true, missing: actual?.missing ?? item.required };
  });
  const baselineComplete = gaps.length === 0 && rows.every((row) => row.measured);
  const targetReadyCases = rows.filter((row) => row.targetReady).length;
  const missingCapabilityCounts = {};
  for (const row of rows) for (const capability of row.missing) missingCapabilityCounts[capability] = (missingCapabilityCounts[capability] ?? 0) + 1;
  return {
    schema: SCHEMA, baselineComplete, targetReady: baselineComplete && targetReadyCases === rows.length,
    cases: rows.length, targetReadyCases, gaps, missingCapabilityCounts, rows,
  };
}

export async function hashCompatibilityFiles(cases = []) {
  return Object.fromEntries(await Promise.all(cases.map(async (item) => [item.caseId, hash(await readFile(item.path))])));
}
