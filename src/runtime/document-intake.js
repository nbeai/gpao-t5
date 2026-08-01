import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_EXTRACTED_BYTES = 2_000_000;
const COMMAND_TIMEOUT_MS = 15_000;

const FORMATS = new Map([
  ['.pdf', 'pdf'], ['.docx', 'docx'], ['.xlsx', 'xlsx'], ['.hwpx', 'hwpx'], ['.hwp', 'hwp'],
]);

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function xmlText(xml, { paragraphTags = [] } = {}) {
  let normalized = String(xml ?? '');
  for (const tag of paragraphTags) {
    normalized = normalized.replace(new RegExp(`</(?:[^:>]+:)?${tag}>`, 'gi'), '\n');
  }
  normalized = normalized
    .replace(/<(?:[^:>]+:)?(?:tab|br)\b[^>]*\/?>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  return decodeXml(normalized)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function command(file, args, options = {}) {
  const { stdout } = await exec(file, args, {
    encoding: 'utf8',
    maxBuffer: MAX_EXTRACTED_BYTES,
    timeout: COMMAND_TIMEOUT_MS,
    ...options,
  });
  return stdout;
}

async function zipEntries(path) {
  const listed = await command('/usr/bin/unzip', ['-Z1', path]);
  const entries = listed.split('\n').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length > 1_000) throw new Error('document_archive_has_too_many_entries');
  return entries;
}

async function zipEntry(path, entry) {
  return command('/usr/bin/unzip', ['-p', path, entry]);
}

async function extractDocx(path) {
  try {
    const converted = await command('/usr/bin/textutil', ['-convert', 'txt', '-stdout', path]);
    if (converted.trim()) return converted.trim();
  } catch {
    // Minimal or partially damaged OOXML can still have a readable document.xml.
  }
  const entries = await zipEntries(path);
  const document = entries.find((entry) => /^word\/document\.xml$/i.test(entry));
  if (!document) throw new Error('docx_document_xml_missing');
  return xmlText(await zipEntry(path, document), { paragraphTags: ['p', 'tr'] });
}

function cellValue(cell, sharedStrings) {
  const type = /\bt="([^"]+)"/i.exec(cell)?.[1];
  if (type === 'inlineStr') return xmlText(/<(?:[^:>]+:)?is\b[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?is>/i.exec(cell)?.[1] ?? '');
  const raw = /<(?:[^:>]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?v>/i.exec(cell)?.[1];
  if (raw === undefined) return '';
  const value = decodeXml(raw).trim();
  return type === 's' ? (sharedStrings[Number(value)] ?? '') : value;
}

async function extractXlsx(path) {
  const entries = await zipEntries(path);
  const sharedEntry = entries.find((entry) => /^xl\/sharedStrings\.xml$/i.test(entry));
  const sharedStrings = [];
  if (sharedEntry) {
    const xml = await zipEntry(path, sharedEntry);
    for (const match of xml.matchAll(/<(?:[^:>]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?si>/gi)) {
      sharedStrings.push(xmlText(match[1]));
    }
  }
  const sheets = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry))
    .sort((a, b) => a.localeCompare(b, 'en'));
  if (!sheets.length) throw new Error('xlsx_worksheet_missing');
  const output = [];
  for (const [index, entry] of sheets.entries()) {
    const xml = await zipEntry(path, entry);
    const rows = [];
    for (const row of xml.matchAll(/<(?:[^:>]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?row>/gi)) {
      const cells = [...row[1].matchAll(/<(?:[^:>]+:)?c\b[^>]*>[\s\S]*?<\/(?:[^:>]+:)?c>/gi)]
        .map((cell) => cellValue(cell[0], sharedStrings));
      if (cells.some((value) => value !== '')) rows.push(cells.join('\t'));
    }
    if (rows.length) output.push(`[시트 ${index + 1}]\n${rows.join('\n')}`);
  }
  return output.join('\n\n').trim();
}

async function extractHwpx(path) {
  const entries = (await zipEntries(path))
    .filter((entry) => /^Contents\/section\d+\.xml$/i.test(entry))
    .sort((a, b) => a.localeCompare(b, 'en'));
  if (!entries.length) throw new Error('hwpx_section_missing');
  const sections = [];
  for (const entry of entries) {
    sections.push(xmlText(await zipEntry(path, entry), { paragraphTags: ['p', 'tr'] }));
  }
  return sections.filter(Boolean).join('\n\n');
}

function decodePdfLiteral(value) {
  return value
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1');
}

function extractUncompressedPdfText(bytes) {
  const source = bytes.toString('latin1');
  const text = [];
  for (const match of source.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj\b/g)) {
    text.push(decodePdfLiteral(match[1]));
  }
  return text.join('\n').trim();
}

async function extractPdf(path, bytes) {
  const script = [
    "ObjC.import('Foundation');",
    "ObjC.import('PDFKit');",
    'const args = $.NSProcessInfo.processInfo.arguments;',
    'const path = ObjC.unwrap(args.objectAtIndex(args.count - 1));',
    'const url = $.NSURL.fileURLWithPath(path);',
    'const doc = $.PDFDocument.alloc.initWithURL(url);',
    "if (!doc) throw new Error('pdf_open_failed');",
    "const text = doc.string ? ObjC.unwrap(doc.string) : '';",
    'console.log(text);',
  ].join('\n');
  try {
    const extracted = (await command('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, '--', path])).trim();
    if (extracted) return extracted;
  } catch {
    // PDFKit가 없거나 문서를 열지 못해도 단순 PDF의 본문은 안전하게 복구할 수 있다.
  }
  return extractUncompressedPdfText(bytes);
}

async function extractSpotlightText(path) {
  const text = await command('/usr/bin/mdls', ['-raw', '-name', 'kMDItemTextContent', path]);
  return ['(null)', 'null'].includes(text.trim()) ? '' : text.trim();
}

export function documentFormat(path) {
  return FORMATS.get(extname(String(path ?? '')).toLowerCase()) ?? null;
}

export function documentSignatureMatches(format, bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  if (format === 'pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (['docx', 'xlsx', 'hwpx'].includes(format)) return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (format === 'hwp') return bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  return false;
}

export async function extractDocument(path, bytes) {
  const format = documentFormat(path);
  if (!format) return null;
  if (!documentSignatureMatches(format, bytes)) {
    return { format, text: '', error: 'document_signature_mismatch' };
  }
  try {
    let text = '';
    if (format === 'pdf') text = await extractPdf(path, bytes);
    else if (format === 'docx') text = await extractDocx(path);
    else if (format === 'xlsx') text = await extractXlsx(path);
    else if (format === 'hwpx') text = await extractHwpx(path);
    else if (format === 'hwp') text = await extractSpotlightText(path);
    return text.trim()
      ? { format, text: text.trim() }
      : { format, text: '', error: 'document_text_unavailable' };
  } catch (error) {
    return { format, text: '', error: error?.code ?? error?.message ?? 'document_extract_failed' };
  }
}
