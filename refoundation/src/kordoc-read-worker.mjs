import {
  detectFormat, detectOle2Format, detectZipFormat,
  parseDocx, parseHwp, parseHwp3, parseHwpx, parseXls,
} from 'kordoc';

const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_BLOCKS = 5_000;
const MAX_TABLES = 500;

function fail(code, error) {
  process.stdout.write(`${JSON.stringify({ success: false, code, error })}\n`);
  process.exitCode = 1;
}

function exactFormat(buffer, requested) {
  const array = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (requested === 'hwp3') return detectFormat(array) === 'hwp3';
  if (requested === 'hwp5' || requested === 'xls') {
    return detectOle2Format(array) === (requested === 'hwp5' ? 'hwp' : 'xls');
  }
  if (requested === 'hwpx' || requested === 'docx') {
    return detectZipFormat(array).then((format) => format === requested);
  }
  return false;
}

function boundedCell(cell = {}) {
  return {
    text: String(cell.text ?? ''),
    colSpan: Math.max(1, Number(cell.colSpan) || 1),
    rowSpan: Math.max(1, Number(cell.rowSpan) || 1),
  };
}

function boundedTable(block = {}, remainingCells) {
  const source = block.table ?? {}; const rows = []; let shownCells = 0;
  for (const row of source.cells ?? []) {
    if (shownCells >= remainingCells) break;
    const shown = row.slice(0, Math.max(0, remainingCells - shownCells)).map(boundedCell);
    rows.push(shown); shownCells += shown.length;
  }
  const totalCells = (source.cells ?? []).reduce((sum, row) => sum + row.length, 0);
  return {
    pageNumber: block.pageNumber ?? null,
    rows: Number(source.rows) || (source.cells ?? []).length,
    columns: Number(source.cols) || Math.max(0, ...(source.cells ?? []).map((row) => row.length)),
    hasHeader: source.hasHeader === true, cells: rows,
    totalCells, shownCells, truncated: shownCells < totalCells,
  };
}

function project(result, { format, maxChars, maxCells }) {
  const markdown = String(result.markdown ?? ''); const blocks = result.blocks ?? [];
  const tables = []; let shownCells = 0;
  for (const block of blocks) {
    if (block?.type !== 'table' || tables.length >= MAX_TABLES || shownCells >= maxCells) continue;
    const table = boundedTable(block, maxCells - shownCells); shownCells += table.shownCells; tables.push(table);
  }
  const pages = Array.isArray(result.pages) ? result.pages.map((page) => ({
    pageNumber: page.pageNumber, chars: String(page.markdown ?? '').length,
  })) : [];
  return {
    success: true, format,
    markdown: markdown.slice(0, maxChars),
    coverage: {
      totalChars: markdown.length, shownChars: Math.min(markdown.length, maxChars),
      omittedChars: Math.max(0, markdown.length - maxChars), truncated: markdown.length > maxChars,
      totalBlocks: blocks.length, shownBlocks: Math.min(blocks.length, MAX_BLOCKS),
      totalTables: blocks.filter((block) => block?.type === 'table').length,
      shownTables: tables.length, totalTableCells: tables.reduce((sum, table) => sum + table.totalCells, 0),
      shownTableCells: shownCells,
    },
    structure: {
      pageCount: result.pageCount ?? result.metadata?.pageCount ?? null,
      pages, tables,
      outline: (result.outline ?? []).slice(0, 500).map((item) => ({
        text: String(item.text ?? item.title ?? ''), level: Number(item.level) || null,
        pageNumber: item.pageNumber ?? null,
      })),
    },
    warnings: (result.warnings ?? []).slice(0, 200).map((warning) => ({
      code: String(warning?.code ?? 'PARSER_WARNING'), message: String(warning?.message ?? warning ?? ''),
    })),
    metadata: result.metadata ?? {},
  };
}

async function readInput() {
  const chunks = []; let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) throw new Error('qualified document input size is outside the supported boundary');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

const [format, maxCharsRaw, maxCellsRaw] = process.argv.slice(2);
try {
  if (!['hwp3', 'hwp5', 'hwpx', 'xls', 'docx'].includes(format)) throw new Error('unsupported qualified format');
  const bytes = await readInput();
  if (!bytes.length || bytes.length > MAX_INPUT_BYTES) throw new Error('qualified document input size is outside the supported boundary');
  if (!(await exactFormat(bytes, format))) {
    fail('FORMAT_MISMATCH', 'file structure does not match the requested qualified format');
  } else {
    const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parser = { hwp3: parseHwp3, hwp5: parseHwp, hwpx: parseHwpx, xls: parseXls, docx: parseDocx }[format];
    const result = await parser(array, { tables: true, keepEmptyParagraphs: false });
    if (!result.success) {
      const corruptHwp3 = format === 'hwp3' && result.code === 'DECOMPRESSION_BOMB'
        && /unexpected end|unexpected eof|invalid distance/iu.test(result.error ?? '');
      const corruptStructure = result.code === 'PARSE_ERROR';
      fail(corruptHwp3 || corruptStructure ? 'CORRUPTED' : result.code ?? 'PARSE_ERROR', result.error ?? 'document parse failed');
    } else {
      const maxChars = Math.min(200_000, Math.max(1, Number(maxCharsRaw) || 64_000));
      const maxCells = Math.min(100_000, Math.max(1, Number(maxCellsRaw) || 10_000));
      process.stdout.write(`${JSON.stringify(project(result, { format, maxChars, maxCells }))}\n`);
    }
  }
} catch (error) {
  fail('PARSE_ERROR', error?.message ?? String(error));
}
