import { createHash } from 'node:crypto';
import {
  chmod, lstat, mkdir, readFile, realpath, rename, unlink, writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

import { openPdf } from 'clawpdf';
import { cellValueAsString, isFormulaValue, setFormula } from '@office-kit/xlsx/cell';
import { loadWorkbook, workbookToBytes } from '@office-kit/xlsx/io';
import { fromBuffer } from '@office-kit/xlsx/node';
import { listChartsOnSheet } from '@office-kit/xlsx/drawing';
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook';
import {
  getDataExtent, getMergedCells, getMergedRangeAt,
  iterCells, mergeCells, setCell, setCellByCoord, setColumnWidth, setRowHeight,
  setAutoFilter, setFreezePanes,
} from '@office-kit/xlsx/worksheet';
import {
  alignCellVertical, formatAsHeader, getCellNumberFormat,
  setBold, setCellNumberFormat, setFontColor,
  setFontSize, wrapCellText,
} from '@office-kit/xlsx/styles';
import { inspectPptxBytes } from './pptx-deliverable.js';
import { documentPublicationTemporary } from './document-publication-temporary.js';

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CELLS = 5_000;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_PAGE_CHARS = 20_000;
const MAX_WORKBOOK_SHEETS = 20;
const MAX_WORKBOOK_COLUMNS = 256;
const MAX_WORKBOOK_ROWS = 100_000;
const MAX_WORKBOOK_CELLS = 1_000_000;
const MAX_CELL_TEXT = 32_767;
const MAX_FORMULA_TEXT = 8_192;
const MAX_FORMULA_PRECEDENT_RANGES = 256;
const FORMULA_ERRORS = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)$/i;
const FORMULA_A1_REFERENCE = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6})(?::(\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}))?/giu;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function regularFileFacts(file, maxBytes) {
  if (!isAbsolute(file)) throw new TypeError('document path must be absolute');
  const requested = resolve(file);
  const stat = await lstat(requested);
  if (stat.isSymbolicLink()) throw new Error('document path must not be a symbolic link');
  if (!stat.isFile()) throw new Error('document path must be a regular file');
  if (stat.nlink !== 1) throw new Error('document path must not be a hard link');
  if (stat.size > maxBytes) throw new Error(`document exceeds ${maxBytes} byte limit`);
  const path = await realpath(requested);
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: sha256(bytes), mode: stat.mode & 0o777, content: bytes };
}

function scalar(value) {
  if (value == null || typeof value === 'string' || typeof value === 'number'
    || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `<binary:${value.length}>`;
  if (Array.isArray(value)) return value.map(scalar);
  if (typeof value === 'object') {
    if (value.kind === 'rich-text') return value.runs.map((item) => item.text ?? '').join('');
    if (value.kind === 'error') return { error: String(value.code) };
    if (value.kind === 'duration') return { durationMs: value.ms };
    if (value.kind === 'formula') return {
      formula: value.formula,
      ...(value.cachedValue === undefined ? {} : { cachedValue: scalar(value.cachedValue) }),
    };
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text ?? '').join('');
    if (value.error !== undefined) return { error: String(value.error) };
    if (value.text !== undefined && value.hyperlink !== undefined) {
      return { text: String(value.text), hyperlink: String(value.hyperlink) };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scalar(item)]));
  }
  return String(value);
}

function valueTypeName(value) {
  if (value == null) return 'null';
  if (value instanceof Date) return 'date';
  if (typeof value === 'object' && value.kind) return value.kind;
  return typeof value;
}

function columnLetter(column) {
  let value = column;
  let output = '';
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function cellAddress(cell) {
  return `${columnLetter(cell.col)}${cell.row}`;
}

function a1Parts(value) {
  const match = String(value ?? '').replaceAll('$', '').toUpperCase().match(/^([A-Z]{1,3})([1-9][0-9]{0,6})$/u);
  if (!match) return null;
  let column = 0;
  for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column < 1 || column > 16_384 || row < 1 || row > 1_048_576) return null;
  return { address: `${match[1]}${row}`, column, row };
}

function maskFormulaStringLiterals(formula) {
  const characters = [...String(formula ?? '')];
  let quoted = false;
  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] !== '"') {
      if (quoted) characters[index] = ' ';
      continue;
    }
    if (quoted && characters[index + 1] === '"') {
      characters[index] = ' '; characters[index + 1] = ' '; index += 1;
      continue;
    }
    quoted = !quoted; characters[index] = ' ';
  }
  return characters.join('');
}

function formulaPrecedents(formula, currentSheetId) {
  const formulaCode = maskFormulaStringLiterals(formula);
  const ranges = [];
  let truncated = false;
  for (const match of formulaCode.matchAll(FORMULA_A1_REFERENCE)) {
    const preceding = match.index > 0 ? formulaCode[match.index - 1] : '';
    if (/[A-Za-z0-9_.]/u.test(preceding)) continue;
    const from = a1Parts(match[3]); const to = a1Parts(match[4] ?? match[3]);
    if (!from || !to) continue;
    if (ranges.length >= MAX_FORMULA_PRECEDENT_RANGES) { truncated = true; break; }
    ranges.push({
      sheetId: (match[1] ?? match[2] ?? currentSheetId).replaceAll("''", "'"),
      from: from.address, to: to.address,
    });
  }
  return {
    ranges,
    truncated,
    sameWorkbookOnly: !formulaCode.includes('['),
  };
}

function rangeAddress(range) {
  const from = `${columnLetter(range.minCol)}${range.minRow}`;
  const to = `${columnLetter(range.maxCol)}${range.maxRow}`;
  return from === to ? from : `${from}:${to}`;
}

function observeCell(workbook, worksheet, cell) {
  const mergedRange = getMergedRangeAt(worksheet, cell.row, cell.col);
  const formula = isFormulaValue(cell.value) ? cell.value : null;
  const observed = {
    address: cellAddress(cell),
    row: cell.row,
    column: cell.col,
    type: valueTypeName(cell.value),
    text: cellValueAsString(cell.value),
    numberFormat: getCellNumberFormat(workbook, cell) || 'General',
    merged: Boolean(mergedRange),
  };
  if (mergedRange) observed.mergeMaster = `${columnLetter(mergedRange.minCol)}${mergedRange.minRow}`;
  if (formula) {
    const precedents = formulaPrecedents(formula.formula, worksheet.title);
    observed.formula = formula.formula;
    observed.result = scalar(formula.cachedValue);
    observed.formulaResultMissing = formula.cachedValue === undefined;
    observed.formulaError = typeof formula.cachedValue === 'string' && FORMULA_ERRORS.test(formula.cachedValue)
      ? formula.cachedValue : null;
    observed.precedentRanges = precedents.ranges;
    observed.precedentRangesTruncated = precedents.truncated;
    observed.sameWorkbookPrecedentsOnly = precedents.sameWorkbookOnly;
  } else {
    observed.value = scalar(cell.value);
  }
  return observed;
}

function chartTitle(space) {
  if (space?.title?.text) return String(space.title.text);
  const runs = space?.title?.tx?.paragraphs?.flatMap?.((paragraph) => paragraph.runs ?? []) ?? [];
  return runs.map((run) => run.text ?? '').join('') || null;
}

function chartSeries(series = []) {
  return series.map((item, index) => ({
    index,
    name: item.tx?.kind === 'literal' ? String(item.tx.value) : item.tx?.ref ?? `Series ${index + 1}`,
    categoryRef: item.cat?.ref ?? null,
    categories: (item.cat?.cache ?? []).map(scalar),
    valueRef: item.val?.ref ?? item.yVal?.ref ?? null,
    values: (item.val?.cache ?? item.yVal?.cache ?? []).map((value) => Number(value)).filter(Number.isFinite),
  }));
}

function observeCharts(worksheet) {
  return listChartsOnSheet(worksheet).map((drawing, index) => {
    const reference = drawing.content.kind === 'chart' ? drawing.content.chart : null;
    const space = reference?.space;
    const chart = space?.plotArea?.chart;
    return {
      index: index + 1,
      kind: chart?.kind ?? (reference?.cxSpace ? 'modern' : 'unknown'),
      title: chartTitle(space),
      series: chartSeries(chart?.series),
    };
  });
}

async function inspectWorkbook(fileFacts, { maxCells }) {
  const workbook = await loadWorkbook(fromBuffer(fileFacts.content));
  const sheets = [];
  let totalCells = 0;
  let shownCells = 0;
  let formulaCells = 0;
  let formulaErrors = 0;
  let missingFormulaResults = 0;

  for (const sheetRef of workbook.sheets) {
    if (sheetRef.kind !== 'worksheet') {
      sheets.push({
        name: sheetRef.sheet.title, state: sheetRef.state, kind: 'chartsheet',
        rowCount: 0, columnCount: 0, merges: [], hiddenRows: [], hiddenColumns: [], cells: [],
      });
      continue;
    }
    const worksheet = sheetRef.sheet;
    const cells = [];
    const hiddenRows = [...worksheet.rowDimensions.entries()]
      .filter(([, dimension]) => dimension.hidden).map(([row]) => row).sort((a, b) => a - b);
    const hiddenColumns = [];
    for (const dimension of worksheet.columnDimensions.values()) {
      if (!dimension.hidden) continue;
      for (let column = dimension.min; column <= dimension.max; column += 1) {
        hiddenColumns.push(columnLetter(column));
      }
    }
    for (const cell of iterCells(worksheet)) {
      totalCells += 1;
      const formula = isFormulaValue(cell.value) ? cell.value : null;
      if (formula) {
        formulaCells += 1;
        if (formula.cachedValue === undefined) missingFormulaResults += 1;
        if (typeof formula.cachedValue === 'string' && FORMULA_ERRORS.test(formula.cachedValue)) formulaErrors += 1;
      }
      if (shownCells >= maxCells) continue;
      cells.push(observeCell(workbook, worksheet, cell));
      shownCells += 1;
    }
    const extent = getDataExtent(worksheet);
    sheets.push({
      name: worksheet.title,
      state: sheetRef.state,
      kind: 'worksheet',
      rowCount: extent?.maxRow ?? 0,
      columnCount: extent?.maxCol ?? 0,
      merges: getMergedCells(worksheet).map(rangeAddress).sort(),
      hiddenRows,
      hiddenColumns,
      charts: observeCharts(worksheet),
      cells,
    });
  }
  return {
    sheetCount: sheets.length,
    sheets,
    totals: { cells: totalCells, formulas: formulaCells, formulaErrors, missingFormulaResults },
    projection: {
      truncated: shownCells < totalCells,
      shownCells,
      totalCells,
      omittedCells: totalCells - shownCells,
    },
  };
}

function pdfMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata).flatMap(([key, value]) => (
    value == null || value === '' ? [] : [[key, value instanceof Date ? value.toISOString() : String(value)]]
  )));
}

async function inspectPdf(fileFacts, { maxPages, maxPageChars }) {
  const document = await openPdf(fileFacts.content);
  try {
    const pageLimit = Math.min(document.pageCount, maxPages);
    const pages = [];
    let extractableChars = 0;
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = document.page(pageNumber);
      try {
        const fullText = page.text().trim();
        extractableChars += fullText.length;
        pages.push({
          page: pageNumber,
          width: page.width,
          height: page.height,
          rotation: page.rotation,
          text: fullText.slice(0, maxPageChars),
          totalChars: fullText.length,
          truncated: fullText.length > maxPageChars,
          omittedChars: Math.max(0, fullText.length - maxPageChars),
        });
      } finally {
        page[Symbol.dispose]?.();
      }
    }
    return {
      pageCount: document.pageCount,
      metadata: pdfMetadata(document.metadata),
      pages,
      extractableChars,
      requiresOcrOrVision: extractableChars === 0,
      projection: {
        truncated: pageLimit < document.pageCount,
        shownPages: pageLimit,
        totalPages: document.pageCount,
        omittedPages: document.pageCount - pageLimit,
      },
    };
  } finally {
    await document[Symbol.asyncDispose]?.();
  }
}

function purposeTerms(query) {
  return [...new Set(String(query ?? '').normalize('NFKC').toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 24);
}

function occurrences(text, term) {
  let count = 0; let cursor = 0;
  while ((cursor = text.indexOf(term, cursor)) >= 0) { count += 1; cursor += Math.max(1, term.length); }
  return count;
}

function purposeSnippet(text, terms, maximum = 600) {
  const lower = text.toLowerCase(); const offsets = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const center = offsets.length ? Math.min(...offsets) : 0; const start = Math.max(0, center - Math.floor(maximum / 3));
  return text.slice(start, start + maximum);
}

export async function searchBusinessDocumentPages({ file, query, maxCandidates = 8,
  maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 16) throw new TypeError('maxCandidates is invalid');
  const terms = purposeTerms(query); if (!terms.length) throw new TypeError('document page search requires meaningful terms');
  const facts = await regularFileFacts(String(file ?? ''), maxBytes);
  if (extname(facts.path).toLowerCase() !== '.pdf' && facts.content.subarray(0, 5).toString('binary') !== '%PDF-') {
    throw new Error('document page search currently requires a PDF');
  }
  const document = await openPdf(facts.content); const candidates = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.pageCount; pageNumber += 1) {
      const page = document.page(pageNumber);
      try {
        const text = page.text().trim(); const lower = text.normalize('NFKC').toLowerCase();
        const matched = terms.map((term) => ({ term, count: occurrences(lower, term) })).filter((item) => item.count > 0);
        if (!matched.length) continue;
        const score = matched.reduce((sum, item) => sum + item.count, 0) + (matched.length * 5);
        candidates.push({ page: pageNumber,
          pageHandle: `page-${sha256(Buffer.from(`${facts.sha256}:${pageNumber}:${sha256(Buffer.from(text))}`)).slice(0, 24)}`,
          score, matchedTerms: matched.length, snippet: purposeSnippet(text, terms), totalChars: text.length });
      } finally { page[Symbol.dispose]?.(); }
    }
    candidates.sort((a, b) => b.score - a.score || a.page - b.page);
    return { schema: 't5.document-page-candidates.v1', fileSha256: facts.sha256,
      totalPages: document.pageCount, locallySearchedPages: document.pageCount,
      candidates: candidates.slice(0, maxCandidates), omittedCandidates: Math.max(0, candidates.length - maxCandidates),
      transmission: { category: 'document_candidates', sourceWholeObserved: true,
        totalUnits: document.pageCount, sentUnits: Math.min(candidates.length, maxCandidates), wholeSourceSent: false } };
  } finally { await document[Symbol.asyncDispose]?.(); }
}

export async function reopenBusinessDocumentPages({ file, expectedSha256, pages,
  maxPageChars = DEFAULT_MAX_PAGE_CHARS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 4
    || pages.some((page) => !Number.isInteger(page) || page < 1)) throw new TypeError('document reopen pages are invalid');
  const facts = await regularFileFacts(String(file ?? ''), maxBytes);
  if (facts.sha256 !== expectedSha256) throw Object.assign(new Error('document changed after page selection'), {
    code: 'T5_DOCUMENT_SELECTION_STALE',
  });
  const document = await openPdf(facts.content); const selected = [];
  try {
    for (const pageNumber of [...new Set(pages)]) {
      if (pageNumber > document.pageCount) throw new Error('selected document page no longer exists');
      const page = document.page(pageNumber);
      try { const text = page.text().trim(); selected.push({ page: pageNumber, text: text.slice(0, maxPageChars),
        totalChars: text.length, truncated: text.length > maxPageChars,
        omittedChars: Math.max(0, text.length - maxPageChars) }); }
      finally { page[Symbol.dispose]?.(); }
    }
    return { schema: 't5.document-page-reopen.v1', fileSha256: facts.sha256,
      totalPages: document.pageCount, pages: selected,
      transmission: { category: 'document_excerpt', sourceWholeObserved: true,
        totalUnits: document.pageCount, sentUnits: selected.length,
        selectedUnits: selected.map((item) => item.page), wholeSourceSent: selected.length === document.pageCount } };
  } finally { await document[Symbol.asyncDispose]?.(); }
}

export async function inspectBusinessDocument({
  file,
  maxBytes = DEFAULT_MAX_BYTES,
  maxCells = DEFAULT_MAX_CELLS,
  maxPages = DEFAULT_MAX_PAGES,
  maxPageChars = DEFAULT_MAX_PAGE_CHARS,
} = {}) {
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 100_000) {
    throw new TypeError('maxCells must be an integer from 1 to 100000');
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) {
    throw new TypeError('maxPages must be an integer from 1 to 200');
  }
  const facts = await regularFileFacts(String(file ?? ''), maxBytes);
  const extension = extname(facts.path).toLowerCase();
  const fileView = {
    path: facts.path, bytes: facts.bytes, sha256: facts.sha256, mode: facts.mode,
  };
  if (extension === '.xlsx' || extension === '.xlsm' || extension === '.xltx') {
    const workbook = await inspectWorkbook(facts, { maxCells });
    return {
      schema: 't5.document-observation.v1', kind: 'xlsx', file: fileView,
      workbook: {
        sheetCount: workbook.sheetCount,
        sheets: workbook.sheets,
        totals: workbook.totals,
        recalculation: { state: 'unmeasured', reason: 'qualified_engine_receipt_absent' },
      },
      projection: workbook.projection,
    };
  }
  if (extension === '.pdf' || facts.content.subarray(0, 5).toString('binary') === '%PDF-') {
    return {
      schema: 't5.document-observation.v1', kind: 'pdf', file: fileView,
      pdf: await inspectPdf(facts, { maxPages, maxPageChars }),
    };
  }
  if (extension === '.pptx') {
    return { schema: 't5.document-observation.v1', kind: 'pptx', file: fileView,
      presentation: inspectPptxBytes(facts.content) };
  }
  throw new Error(`unsupported business document type: ${extension || 'unknown'}`);
}

function validateSheet(sheet, names) {
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) throw new TypeError('sheet must be an object');
  const name = String(sheet.name ?? '').trim();
  if (!name || name.length > 31 || /[\\/*?:\[\]]/.test(name)) throw new TypeError('invalid worksheet name');
  if (names.has(name)) throw new TypeError(`duplicate worksheet name: ${name}`);
  names.add(name);
  if (!Array.isArray(sheet.columns) || !Array.isArray(sheet.rows)) {
    throw new TypeError(`worksheet ${name} requires columns and rows arrays`);
  }
  if (sheet.columns.length > MAX_WORKBOOK_COLUMNS) throw new TypeError(`worksheet ${name} exceeds ${MAX_WORKBOOK_COLUMNS} columns`);
  if (sheet.rows.length > MAX_WORKBOOK_ROWS) throw new TypeError(`worksheet ${name} exceeds ${MAX_WORKBOOK_ROWS} rows`);
  const keys = new Set();
  for (const column of sheet.columns) {
    const key = String(column?.key ?? '').trim();
    if (!key || keys.has(key)) throw new TypeError(`worksheet ${name} has invalid or duplicate column key`);
    keys.add(key);
  }
  for (const formula of sheet.formulas ?? []) {
    if (!formula || typeof formula !== 'object' || !formula.cell || !formula.formula) {
      throw new TypeError(`worksheet ${name} has invalid formula`);
    }
    if (!Object.hasOwn(formula, 'result')) throw new TypeError('formula result is required');
    if (String(formula.formula).length > MAX_FORMULA_TEXT) throw new TypeError('formula text exceeds Excel limit');
  }
  return name;
}

function workbookCellValue(value) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('workbook cell requires a finite number');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_CELL_TEXT) throw new TypeError('cell text exceeds Excel limit');
    return value;
  }
  throw new TypeError('workbook cell values must be string, finite number, boolean, or null');
}

function applyWorkbookSpec(workbook, spec) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.sheets) || !spec.sheets.length) {
    throw new TypeError('workbook spec requires at least one sheet');
  }
  if (spec.sheets.length > MAX_WORKBOOK_SHEETS) throw new TypeError(`workbook spec allows at most ${MAX_WORKBOOK_SHEETS} sheets`);
  const totalCells = spec.sheets.reduce((sum, sheet) => (
    sum + Number(sheet?.columns?.length ?? 0) * Number(sheet?.rows?.length ?? 0)
  ), 0);
  if (totalCells > MAX_WORKBOOK_CELLS) throw new TypeError(`workbook spec exceeds ${MAX_WORKBOOK_CELLS} data cells`);
  const names = new Set();
  for (const sheetSpec of spec.sheets) {
    const name = validateSheet(sheetSpec, names);
    const sheet = addWorksheet(workbook, name);
    const columns = sheetSpec.columns;
    let headerRow = 1;
    if (sheetSpec.title) {
      const title = setCell(sheet, 1, 1, workbookCellValue(String(sheetSpec.title)));
      mergeCells(sheet, `A1:${columnLetter(Math.max(1, columns.length))}1`);
      setBold(workbook, title);
      setFontSize(workbook, title, 14);
      setFontColor(workbook, title, 'FF1F2937');
      alignCellVertical(workbook, title, 'center');
      setRowHeight(sheet, 1, 24);
      headerRow = 2;
    }
    columns.forEach((column, index) => {
      setColumnWidth(sheet, index + 1, Math.max(8, Math.min(60, Number(column.width ?? 16))));
      setCell(sheet, headerRow, index + 1, String(column.header ?? column.key));
    });
    if (columns.length) {
      formatAsHeader(workbook, sheet, `A${headerRow}:${columnLetter(columns.length)}${headerRow}`);
    }
    sheetSpec.rows.forEach((rowData, rowIndex) => {
      const rowNumber = headerRow + rowIndex + 1;
      columns.forEach((column, index) => {
        const cell = setCell(sheet, rowNumber, index + 1, workbookCellValue(rowData?.[column.key] ?? null));
        if (column.numberFormat) setCellNumberFormat(workbook, cell, String(column.numberFormat));
        alignCellVertical(workbook, cell, 'top');
        wrapCellText(workbook, cell);
      });
    });
    for (const formula of sheetSpec.formulas ?? []) {
      const result = workbookCellValue(formula.result);
      if (!['string', 'number', 'boolean'].includes(typeof result)) {
        throw new TypeError('formula result must be a string, number, or boolean');
      }
      const cell = setCellByCoord(sheet, String(formula.cell));
      setFormula(cell, String(formula.formula).replace(/^=/, ''), { cachedValue: result });
      if (formula.numberFormat) setCellNumberFormat(workbook, cell, String(formula.numberFormat));
    }
    if (columns.length) {
      setAutoFilter(sheet, {
        ref: `A${headerRow}:${columnLetter(columns.length)}${headerRow + sheetSpec.rows.length}`,
        filterColumns: [],
      });
    }
    setFreezePanes(sheet, `A${headerRow + 1}`);
  }
  workbook.calcProperties = {
    ...(workbook.calcProperties ?? {}), calcMode: 'auto', calcOnSave: true,
    fullCalcOnLoad: true, forceFullCalc: true,
  };
}

export async function createWorkbookFromSpec({ output, spec, replace = false } = {}) {
  if (!isAbsolute(output ?? '')) throw new TypeError('output path must be absolute');
  const requested = resolve(output);
  if (extname(requested).toLowerCase() !== '.xlsx') throw new TypeError('output must end in .xlsx');
  const parent = await realpath(dirname(requested));
  const target = join(parent, basename(requested));
  try {
    const existing = await lstat(target);
    if (existing && !replace) throw new Error('output already exists');
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('output target is not a replaceable regular file');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const workbook = createWorkbook();
  applyWorkbookSpec(workbook, spec);
  await mkdir(parent, { recursive: true });
  const temporary = documentPublicationTemporary(target);
  try {
    await writeFile(temporary, await workbookToBytes(workbook));
    await chmod(temporary, 0o600);
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return {
    created: true,
    observation: await inspectBusinessDocument({ file: target }),
  };
}
