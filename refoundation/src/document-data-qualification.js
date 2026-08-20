import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { setFormula } from '@office-kit/xlsx/cell';
import { workbookToBytes } from '@office-kit/xlsx/io';
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook';
import { hideRow, mergeCells, setCell } from '@office-kit/xlsx/worksheet';
import { setCellNumberFormat } from '@office-kit/xlsx/styles';

export const DOCUMENT_DATA_TURNS = Object.freeze([
  {
    id: 'inspect-before-create',
    prompt: (sourceDirectory) => `이 폴더에 이번 달 견적·정산 자료 세 개가 있어: ${sourceDirectory} 각 파일의 실제 내용과 구조를 먼저 확인해서 어떤 항목을 합칠 수 있는지 알려줘. 아직 새 파일을 만들거나 원본을 수정하지 마.`,
  },
  {
    id: 'clarify-meaning',
    prompt: () => '통화는 전부 원화이고 금액은 공급가액이야. PDF의 HANBIT SHOP은 한빛상회와 같은 거래처로 묶어줘. 다만 PDF의 배송비는 고객이 비어 있으니 한빛상회에 임의로 붙이지 말고 미확인으로 남겨.',
  },
  {
    id: 'create-combined-workbook',
    prompt: (_sourceDirectory, outputPath) => `좋아. 원본은 그대로 두고 ${outputPath} 에 새 엑셀 파일을 만들어줘. '통합내역'과 '고객별요약' 시트를 만들고, 통합내역의 각 행에는 월·고객·품목·수량·단가·금액·출처·검토상태를 넣어줘. 출처는 나중에 추적할 수 있게 엑셀은 파일명·시트·셀, PDF는 파일명·페이지까지 적어줘. 합계는 수식과 계산 결과가 모두 남게 해줘.`,
  },
  {
    id: 'reopen-and-reconcile',
    prompt: () => '방금 만든 파일을 다시 열어서 원본 세 파일의 항목 수와 금액 합계가 맞는지 검산해줘. 미확인 항목과 출처도 실제 셀에서 다시 확인해.',
  },
  {
    id: 'final-summary',
    prompt: () => '결론부터, 실제로 만든 결과와 검산 결과를 짧게 정리해줘. 원본 파일을 수정했는지와 아직 미확인인 것도 따로 말해줘.',
  },
]);

function makeTextPdf(lines) {
  const escape = (text) => String(text).replace(/[()\\]/g, '\\$&');
  const operations = lines.map((line, index) => (
    `${index ? '0 -18 Td ' : ''}(${escape(line)}) Tj`
  )).join(' ');
  const stream = `BT /F1 11 Tf 72 740 Td ${operations} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

async function writeXlsx(file, define) {
  const workbook = createWorkbook();
  define(workbook);
  await writeFile(file, await workbookToBytes(workbook));
}

async function fileHash(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function createDocumentDataFixture(workspace) {
  const sourceDirectory = join(workspace, '8월 사업자료');
  await mkdir(sourceDirectory, { recursive: true });
  const quote = join(sourceDirectory, '한빛상회_8월_견적.xlsx');
  const supplement = join(sourceDirectory, 'HANBIT_SHOP_추가정산.pdf');
  const settlement = join(sourceDirectory, '새봄상사_8월_정산.xlsx');
  const output = join(workspace, '8월_사업자료_통합.xlsx');

  await writeXlsx(quote, (workbook) => {
    const sheet = addWorksheet(workbook, '8월 견적');
    setCell(sheet, 1, 1, '한빛상회 2026년 8월 견적');
    mergeCells(sheet, 'A1:F1');
    ['월', '고객', '품목', '수량', '단가', '금액'].forEach((value, index) => setCell(sheet, 2, index + 1, value));
    ['2026-08', '한빛상회', '원두 1kg', 2, 15000].forEach((value, index) => setCell(sheet, 3, index + 1, value));
    ['2026-08', '한빛상회', '우유', 3, 1100].forEach((value, index) => setCell(sheet, 4, index + 1, value));
    const f3 = setCell(sheet, 3, 6);
    const f4 = setCell(sheet, 4, 6);
    const f5 = setCell(sheet, 5, 6);
    setFormula(f3, 'D3*E3', { cachedValue: 30000 });
    setFormula(f4, 'D4*E4', { cachedValue: 3300 });
    setFormula(f5, 'SUM(F3:F4)', { cachedValue: 33300 });
    [f3, f4, f5].forEach((cell) => setCellNumberFormat(workbook, cell, '#,##0'));
    hideRow(sheet, 4);
  });

  await writeFile(supplement, makeTextPdf([
    'AUGUST SUPPLEMENT SETTLEMENT',
    'Month: 2026-08',
    'Customer: HANBIT SHOP',
    'Item: Packaging',
    'Quantity: 1',
    'Unit Price: 7000 KRW',
    'Amount: 7000 KRW',
    '---',
    'Customer: [blank]',
    'Item: Delivery Fee',
    'Quantity: 1',
    'Unit Price: 3000 KRW',
    'Amount: 3000 KRW',
  ]));

  await writeXlsx(settlement, (workbook) => {
    const sheet = addWorksheet(workbook, '정산');
    setCell(sheet, 1, 1, '새봄상사 8월 정산');
    mergeCells(sheet, 'A1:F1');
    ['월', '고객', '품목', '수량', '단가', '금액'].forEach((value, index) => setCell(sheet, 2, index + 1, value));
    ['2026-08', '새봄상사', '필터', 5, 5000].forEach((value, index) => setCell(sheet, 3, index + 1, value));
    const f3 = setCell(sheet, 3, 6);
    setFormula(f3, 'D3*E3', { cachedValue: 25000 });
    setCellNumberFormat(workbook, f3, '#,##0');
  });

  const canonicalSources = await Promise.all([quote, supplement, settlement].map((file) => realpath(file)));
  const sourceBefore = Object.fromEntries(await Promise.all(canonicalSources.map(async (file) => [file, await fileHash(file)])));
  return {
    sourceDirectory: await realpath(sourceDirectory),
    sourcePaths: canonicalSources,
    outputPath: join(await realpath(workspace), '8월_사업자료_통합.xlsx'),
    sourceBefore,
    expected: {
      detailRows: 5, grandTotal: 68_300,
      customers: { 한빛상회: 40_300, 새봄상사: 25_000, 미확인: 3_000 },
    },
  };
}

export async function hashDocumentSources(paths) {
  return Object.fromEntries(await Promise.all(paths.map(async (file) => [file, await fileHash(file)])));
}

function receipts(turns) {
  return turns.flatMap((turn) => turn.receipts ?? []);
}

function parsedStdout(receipt) {
  if (receipt?.requestedCall?.name !== 'exec' || typeof receipt.result?.stdout !== 'string') return null;
  try { return JSON.parse(receipt.result.stdout); }
  catch { return null; }
}

function cellValue(cell) {
  if (!cell) return undefined;
  return cell.result ?? cell.value ?? cell.text;
}

function numeric(cell) {
  const value = Number(cellValue(cell));
  return Number.isFinite(value) ? value : null;
}

function mentionsPath(text, path) {
  return String(text ?? '').normalize('NFC').includes(String(path ?? '').normalize('NFC'));
}

function semanticTable(observation, sheetName, requiredHeaders) {
  const sheet = observation?.workbook?.sheets?.find((entry) => entry.name === sheetName);
  const byRow = new Map();
  for (const cell of sheet?.cells ?? []) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  const headerEntry = [...byRow.entries()].find(([, cells]) => {
    const values = new Set(cells.map((cell) => String(cellValue(cell) ?? '').trim()));
    return requiredHeaders.every((header) => (
      (Array.isArray(header) ? header : [header]).some((candidate) => values.has(candidate))
    ));
  });
  if (!headerEntry) return { headerRow: null, columns: new Map(), rows: [], cells: sheet?.cells ?? [] };
  const [headerRow, headerCells] = headerEntry;
  const columns = new Map(headerCells.map((cell) => [String(cellValue(cell)).trim(), cell.column]));
  const rows = [...byRow.entries()].filter(([row]) => row > headerRow).map(([row, cells]) => {
    const byColumn = new Map(cells.map((cell) => [cell.column, cell]));
    return {
      row,
      cell: (header) => byColumn.get(columns.get(header)),
      value: (header) => cellValue(byColumn.get(columns.get(header))),
    };
  });
  return { headerRow, columns, rows, cells: sheet?.cells ?? [] };
}

function firstCell(row, headers) {
  for (const header of headers) {
    const cell = row.cell(header);
    if (cell) return cell;
  }
  return undefined;
}

function firstValue(row, headers) {
  return cellValue(firstCell(row, headers));
}

function sameRecord(left = {}, right = {}) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

export function assessDocumentDataQualification({
  turns = [], sourcePaths = [], outputPath, outputObservation,
  sourceBefore = {}, sourceAfter = {},
} = {}) {
  const allReceipts = receipts(turns);
  const parsed = allReceipts.map(parsedStdout).filter(Boolean);
  const sourceObservations = parsed.filter((item) => item.schema === 't5.document-observation.v1'
    && sourcePaths.includes(item.file?.path));
  const reopenReceipts = turns.slice(3).flatMap((turn) => turn.receipts ?? []);
  const reopenedOutput = reopenReceipts.map(parsedStdout).filter(Boolean)
    .some((item) => item.schema === 't5.document-observation.v1' && item.file?.path === outputPath)
    || reopenReceipts.some((receipt) => receipt.requestedCall?.name === 'exec'
      && receipt.outcome === 'succeeded' && mentionsPath([
        receipt.requestedCall?.args?.command, receipt.result?.stdout,
      ].filter(Boolean).join('\n'), outputPath));
  const detail = semanticTable(outputObservation, '통합내역', [
    ['월'], ['고객'], ['품목'], ['금액', '금액 결과', '공급가액'],
  ]);
  const summary = semanticTable(outputObservation, '고객별요약', ['고객']);
  const summaryAmountHeaders = ['금액합계', '금액', '합계 결과', '공급가액 합계', '공급가액합계'];
  const detailRows = detail.rows.filter((row) => /^2026-08$/.test(String(firstValue(row, ['월']) ?? ''))
    && String(firstValue(row, ['품목']) ?? '').trim());
  const detailAmounts = detailRows.map((row) => numeric(firstCell(row, ['금액', '금액 결과', '공급가액'])));
  const sourceTexts = detailRows.map((row) => {
    const direct = firstValue(row, ['출처']);
    if (direct) return String(direct);
    return [
      firstValue(row, ['원본 파일', '원본파일', '파일', '출처파일']),
      firstValue(row, ['원본 시트', '원본시트', '시트/PDF페이지', '출처시트/PDF페이지']),
      firstValue(row, ['원본 셀/PDF 페이지', '원본위치', '원본 셀', 'PDF 페이지', '셀/PDF 출처', '출처셀/항목']),
    ].filter(Boolean).join(' · ');
  });
  const final = turns.find((turn) => turn.id === 'final-summary')?.answer ?? '';
  const toolCalls = allReceipts.length;
  const sourceKinds = new Set(sourceObservations.map((item) => item.kind));
  const firstTurnEvidence = (turns[0]?.receipts ?? []).map((receipt) => [
    receipt.requestedCall?.args?.command, receipt.result?.stdout,
  ].filter(Boolean).join('\n')).join('\n');
  const sourceNamesObserved = sourcePaths.every((path) => firstTurnEvidence.includes(path.split('/').at(-1)));
  const skillViewed = allReceipts.some((receipt) => receipt.requestedCall?.name === 'skill'
    && receipt.result?.state === 'viewed' && receipt.result?.name === 'document-data');
  const detailTotalFormulas = detail.cells.filter((cell) => cell.formula && numeric(cell) === 68_300);
  const summaryTotalFormulas = summary.cells.filter((cell) => cell.formula && numeric(cell) === 68_300);
  const summaryByCustomer = new Map(summary.rows.map((row) => [
    String(firstValue(row, ['고객']) ?? ''), numeric(firstCell(row, summaryAmountHeaders)),
  ]));
  const unidentified = detailRows.find((row) => /미확인/.test(String(firstValue(row, ['고객']) ?? '')));
  const unknownSummary = [...summaryByCustomer.entries()].find(([customer]) => /미확인/.test(customer))?.[1];

  const checks = {
    allTurnsAnswered: turns.length === DOCUMENT_DATA_TURNS.length
      && turns.every((turn) => turn.runStatus === 'completed' && String(turn.answer ?? '').trim()),
    noInternalTerms: turns.every((turn) => !/ToolReceipt|pendingId|observationId|T5_DOCUMENT_CLI/u.test(turn.answer ?? '')),
    allSourcesObserved: (new Set(sourceObservations.map((item) => item.file.path)).size === sourcePaths.length
      && sourceKinds.has('xlsx') && sourceKinds.has('pdf')) || sourceNamesObserved,
    noEarlyOutput: turns.slice(0, 2).every((turn) => (turn.stateAfter?.outputFiles ?? []).length === 0),
    sourcesUnchanged: sameRecord(sourceBefore, sourceAfter),
    exactlyOneOutput: turns.slice(2).every((turn) => {
      const files = turn.stateAfter?.outputFiles ?? [];
      return files.length === 1 && files[0] === outputPath;
    }),
    outputObserved: outputObservation?.schema === 't5.document-observation.v1'
      && outputObservation.kind === 'xlsx' && outputObservation.file?.path === outputPath,
    outputReopened: reopenedOutput,
    requiredSheets: ['통합내역', '고객별요약'].every((name) => outputObservation?.workbook?.sheets?.some((sheet) => sheet.name === name)),
    fiveSourceRows: detailRows.length === 5 && detailRows.every((row, index) => (
      firstCell(row, ['월']) && firstCell(row, ['고객']) && firstCell(row, ['품목'])
      && firstCell(row, ['금액', '금액 결과', '공급가액'])
      && firstCell(row, ['검토상태', '확인상태', '통합상태', '상태']) && sourceTexts[index]
    )),
    customerMeaningApplied: detailRows.filter((row) => firstValue(row, ['고객']) === '한빛상회').length === 3
      && detailRows.filter((row) => firstValue(row, ['고객']) === '새봄상사').length === 1,
    unownedFeePreserved: Boolean(unidentified)
      && /배송비|Delivery Fee/i.test(String(firstValue(unidentified, ['품목']) ?? ''))
      && /확인\s*필요|미확인|공란[\s\S]*(?:귀속|배정|연결|붙이)[\s\S]*(?:않|안|보류)/.test(
        String(firstValue(unidentified, ['검토상태', '확인상태', '통합상태', '상태']) ?? ''),
      ),
    rowSourcesTraceable: sourceTexts.filter((value) => (
      /\.xlsx.*(?:![A-Z]+\d+|[A-Z]+\d+:[A-Z]+\d+)/i.test(value)
      || /\.pdf.*(?:page\s*1|페이지\s*1|1\s*페이지|p\.?\s*1)/i.test(value)
    )).length === 5,
    exactDetailTotal: detailAmounts.every((value) => value != null)
      && detailAmounts.reduce((sum, value) => sum + value, 0) === 68_300,
    exactCustomerSummary: summaryByCustomer.get('한빛상회') === 40_300
      && summaryByCustomer.get('새봄상사') === 25_000 && unknownSummary === 3_000,
    formulaTruth: detailTotalFormulas.length >= 1 && summaryTotalFormulas.length >= 1
      && outputObservation?.workbook?.totals?.formulaErrors === 0
      && outputObservation?.workbook?.totals?.missingFormulaResults === 0,
    finalSeparatesDoneAndUnknown: /만들|생성|완료/u.test(final)
      && /원본[\s\S]*수정(?:하지|\s*안|[\s\S]*않)/u.test(final) && /미확인/u.test(final),
    boundedToolUse: toolCalls > 0 && toolCalls <= 30,
  };
  return {
    checks, passed: Object.values(checks).every(Boolean), toolCalls,
    method: { skillViewed },
  };
}
