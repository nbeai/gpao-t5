import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import { inspectQualifiedDocument } from './qualified-document-parser.js';

const MAX_SPEC_CHARS = 500_000;
const MAX_PARAGRAPHS = 500;
const MAX_TABLES = 50;
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 20;
const FONT = 'Apple SD Gothic Neo';

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 32_000) throw new TypeError(`${label} is invalid`);
  return value;
}

function validate(spec) {
  if (!spec || typeof spec !== 'object' || JSON.stringify(spec).length > MAX_SPEC_CHARS) throw new TypeError('DOCX spec is invalid');
  const title = text(spec.title, 'title'); const paragraphs = spec.paragraphs ?? [];
  const tables = spec.tables ?? [];
  if (!Array.isArray(paragraphs) || paragraphs.length > MAX_PARAGRAPHS || !Array.isArray(tables) || tables.length > MAX_TABLES) {
    throw new TypeError('DOCX spec exceeds content limits');
  }
  for (const paragraph of paragraphs) text(paragraph?.text, 'paragraph text');
  for (const table of tables) {
    if (!Array.isArray(table?.columns) || !table.columns.length || table.columns.length > MAX_COLUMNS
      || !Array.isArray(table.rows) || table.rows.length > MAX_ROWS) throw new TypeError('DOCX table is invalid');
    const keys = new Set();
    for (const column of table.columns) {
      const key = text(column?.key, 'column key'); if (keys.has(key)) throw new TypeError('DOCX column key is duplicated');
      keys.add(key); text(column?.header, 'column header');
      if (column.width != null && (!Number.isFinite(column.width) || column.width <= 0)) throw new TypeError('DOCX column width is invalid');
    }
    for (const row of table.rows) for (const column of table.columns) {
      const value = row?.[column.key]; if (value != null && !['string', 'number', 'boolean'].includes(typeof value)) throw new TypeError('DOCX cell value is invalid');
    }
  }
  return { title, paragraphs, tables };
}

function run(value, { bold = false, size = 22 } = {}) {
  return `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}"/>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r>`;
}

function paragraph(value, { style = null, align = null, bold = false, size = 22, after = 120 } = {}) {
  return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${align ? `<w:jc w:val="${align}"/>` : ''}<w:spacing w:after="${after}"/></w:pPr>${run(value, { bold, size })}</w:p>`;
}

function widths(columns) {
  const weights = columns.map((column) => Number(column.width ?? 1)); const total = weights.reduce((sum, value) => sum + value, 0);
  const result = weights.map((value) => Math.floor(value / total * 9000)); result[result.length - 1] += 9000 - result.reduce((sum, value) => sum + value, 0);
  return result;
}

function tableXml(table) {
  const columnWidths = widths(table.columns);
  const rowXml = (values, header = false) => `<w:tr>${values.map((value, index) => `<w:tc><w:tcPr><w:tcW w:w="${columnWidths[index]}" w:type="dxa"/>${header ? '<w:shd w:fill="D9EAF7"/>' : ''}</w:tcPr>${paragraph(String(value ?? ''), { bold: header, after: 40 })}</w:tc>`).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="777777"/><w:left w:val="single" w:sz="6" w:color="777777"/><w:bottom w:val="single" w:sz="6" w:color="777777"/><w:right w:val="single" w:sz="6" w:color="777777"/><w:insideH w:val="single" w:sz="4" w:color="AAAAAA"/><w:insideV w:val="single" w:sz="4" w:color="AAAAAA"/></w:tblBorders></w:tblPr><w:tblGrid>${columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rowXml(table.columns.map((column) => column.header), true)}${table.rows.map((row) => rowXml(table.columns.map((column) => row?.[column.key]))).join('')}</w:tbl>`;
}

function docxBytes(validated) {
  const body = [
    paragraph(validated.title, { style: 'Title', align: 'center', bold: true, size: 36, after: 240 }),
    ...validated.paragraphs.map((item) => paragraph(item.text, { style: item.style === 'heading' ? 'Heading1' : null, bold: item.style === 'heading', size: item.style === 'heading' ? 28 : 22 })),
    ...validated.tables.map(tableXml),
  ].join('');
  const entries = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style></w:styles>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])), { mtime: new Date('2020-01-01T00:00:00.000Z') }));
}

export async function createDocxFromSpec({ output, spec, replace = false } = {}) {
  if (!isAbsolute(String(output ?? '')) || !/\.docx$/iu.test(output)) throw new TypeError('absolute .docx output is required');
  const validated = validate(spec); let existing = null;
  try { existing = await lstat(output); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (existing && !replace) throw new Error('output already exists; explicit replace is required');
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error('output must be a regular file');
  const bytes = docxBytes(validated); await mkdir(dirname(output), { recursive: true }); const temporary = `${output}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, output); }
  finally { await rm(temporary, { force: true }); }
  const written = await readFile(output);
  const observation = await inspectQualifiedDocument({
    bytes: written, format: 'docx', sourceSha256: createHash('sha256').update(written).digest('hex'),
    maxChars: 100_000, maxCells: 20_000,
  });
  if (observation.state !== 'observed') throw new Error('created DOCX could not be reopened');
  return { created: true, output, bytes: written.length, observation };
}
