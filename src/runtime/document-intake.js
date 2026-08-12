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
    // **JXA 의 console.log 는 stderr 로 나간다** (F-82 · 실측 2026-08-12: 같은 PDF 가
    // stdout 0자 · stderr 23,512자). command() 는 stdout 만 받으므로 추출문 전체가
    // 조용히 버려졌고, 압축 스트림 PDF(실세계 대부분)는 아래 비압축 폴백도 못 읽어
    // "본문을 안전하게 꺼내지 못했어요"가 됐다 — 표준출력 핸들에 직접 쓴다.
    'const out = $.NSFileHandle.fileHandleWithStandardOutput;',
    'out.writeData($(text).dataUsingEncoding($.NSUTF8StringEncoding));',
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

/**
 * 그 형식이 **무엇으로 시작해야 하는가** — 사람 말로 (F-86 · 2026-08-12).
 *
 * 위 자는 참/거짓만 낸다. 막을 때는 *"왜 아닌지"* 를 말해야 막다른 답이 아니다 —
 * 기대한 서명과 실제 앞 4바이트를 나란히 놓으면 사용자도 모델도 다음 걸음을 고를 수 있다.
 */
export function documentSignatureExpectation(format) {
  if (format === 'pdf') return '`25 50 44 46 2d`("%PDF-")';
  if (['docx', 'xlsx', 'hwpx'].includes(format)) return '`50 4b 03 04`("PK…" — 압축 꾸러미)';
  if (format === 'hwp') return '`d0 cf 11 e0`';
  return null;
}

// ── 만드는 쪽 — 표 하나짜리 xlsx (F-86 · 2026-08-12) ──────────────────────
//
// 이 파일은 여태 **읽기 전용**이었다(`documentFormat`·`documentSignatureMatches`·
// `extractDocument` 셋만 내보냈다). 그래서 *"엑셀로 만들어줘"* 에 T5 가 쥘 손이 하나도
// 없었고, 모델이 매번 손수 조립하다 매번 다르게 실패했다 — 밟은 라이브 2회차는
// `xl/worksheets/sheet1.xml` 한 조각(462바이트)을 그대로 `.xlsx` 이름으로 저장했고,
// 1회차는 셸로 조립하다 사용자 폴더에 xlsx **내부 구조를 그대로 풀어** 놓았다.
//
// 만드는 길을 **여기** 두는 이유: 형식 지식이 여기 있다. 읽는 쪽(`extractXlsx`)과 쓰는 쪽이
// 같은 지식을 쓰면 **쓴 것을 되읽어 확인**할 수 있다(검사 ⑥ 이 정확히 그걸 잰다).
//
// xlsx 는 zip + 정해진 XML 몇 장이다. 바깥 프로세스(`zip`)를 부르지 않고 **여기서 바이트를
// 짓는다** — 임시 폴더도, 타임아웃도, 되돌아갈 길도 필요 없고(부를 것이 없으니 실패할 것도
// 없다), 사용자 폴더에 남을 부스러기도 구조적으로 없다(1회차 사고가 정확히 그 부스러기다).
// npm 의존성 0 은 그대로다. 압축 방식은 **저장(store · 무압축)** — 정본 zip 이고 엑셀이 연다.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** zip 꾸러미 한 벌(무압축). 같은 표는 언제 만들어도 같은 바이트가 되게 시각을 고정한다. */
function zipStore(parts) {
  const DOS_1980 = 0x0021; // 1980-01-01 — 만든 시각이 바이트에 새겨지면 같은 표가 매번 달라진다
  const 앞들 = []; const 목록 = [];
  let 자리 = 0;
  for (const { name, data } of parts) {
    const 이름 = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const 머리 = Buffer.alloc(30);
    머리.writeUInt32LE(0x04034b50, 0); 머리.writeUInt16LE(20, 4);
    머리.writeUInt16LE(0x0800, 6);      // 이름은 UTF-8
    머리.writeUInt16LE(0, 8);           // 방식 0 = 저장(무압축)
    머리.writeUInt16LE(0, 10); 머리.writeUInt16LE(DOS_1980, 12);
    머리.writeUInt32LE(crc, 14); 머리.writeUInt32LE(data.length, 18); 머리.writeUInt32LE(data.length, 22);
    머리.writeUInt16LE(이름.length, 26); 머리.writeUInt16LE(0, 28);
    앞들.push(머리, 이름, data);

    const 칸 = Buffer.alloc(46);
    칸.writeUInt32LE(0x02014b50, 0); 칸.writeUInt16LE(20, 4); 칸.writeUInt16LE(20, 6);
    칸.writeUInt16LE(0x0800, 8); 칸.writeUInt16LE(0, 10);
    칸.writeUInt16LE(0, 12); 칸.writeUInt16LE(DOS_1980, 14);
    칸.writeUInt32LE(crc, 16); 칸.writeUInt32LE(data.length, 20); 칸.writeUInt32LE(data.length, 24);
    칸.writeUInt16LE(이름.length, 28); 칸.writeUInt32LE(자리, 42);
    목록.push(칸, 이름);
    자리 += 30 + 이름.length + data.length;
  }
  const 목록바이트 = Buffer.concat(목록);
  const 끝 = Buffer.alloc(22);
  끝.writeUInt32LE(0x06054b50, 0);
  끝.writeUInt16LE(parts.length, 8); 끝.writeUInt16LE(parts.length, 10);
  끝.writeUInt32LE(목록바이트.length, 12); 끝.writeUInt32LE(자리, 16);
  return Buffer.concat([...앞들, 목록바이트, 끝]);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // XML 1.0 이 담지 못하는 제어문자는 뺀다 — 넣으면 엑셀이 파일 자체를 거부한다.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** 0 → A · 25 → Z · 26 → AA */
function columnName(index) {
  let n = index; let name = '';
  do { name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return name;
}

const XLSX_MAX_ROWS = 100_000;
const XLSX_MAX_COLUMNS = 256;

/**
 * 행 배열(문자열 2차원)로 **표 하나짜리 xlsx 바이트**를 짓는다.
 *
 * 범위를 좁게 잡는다 — 시트 하나 · 서식 없음 · 수식 없음. 그것이면 *"항목별로 합계 내서
 * 엑셀로 만들어줘"* 가 닫힌다. 숫자로 보이는 칸은 **숫자 칸**으로 넣는다(문자열로 넣으면
 * 엑셀에서 합계가 안 돼서 사용자가 다시 손봐야 한다 — 만든 척이 된다).
 * 글자는 `inlineStr` 로 넣어 sharedStrings 부품 없이도 정본이 되게 한다.
 */
export function buildXlsx(rows, { sheetName = 'Sheet1' } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('xlsx_rows_required');
  if (rows.length > XLSX_MAX_ROWS) throw new Error('xlsx_too_many_rows');
  const 몸통 = rows.map((row, r) => {
    const cells = Array.isArray(row) ? row : [row];
    if (cells.length > XLSX_MAX_COLUMNS) throw new Error('xlsx_too_many_columns');
    const 칸들 = cells.map((value, c) => {
      const raw = value === null || value === undefined ? '' : String(value);
      if (raw === '') return '';
      const ref = `${columnName(c)}${r + 1}`;
      if (/^-?\d+(\.\d+)?$/.test(raw)) return `<c r="${ref}"><v>${raw}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(raw)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${칸들}</row>`;
  }).join('');
  const 선언 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const part = (name, xml) => ({ name, data: Buffer.from(선언 + xml, 'utf8') });
  const bytes = zipStore([
    part('[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>'),
    part('_rels/.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'),
    part('xl/workbook.xml',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + `<sheet name="${xmlEscape(String(sheetName).slice(0, 31)) || 'Sheet1'}" sheetId="1" r:id="rId1"/>`
      + '</sheets></workbook>'),
    part('xl/_rels/workbook.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '</Relationships>'),
    part('xl/worksheets/sheet1.xml',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<sheetData>${몸통}</sheetData></worksheet>`),
  ]);
  // 만든 것을 **읽는 문의 자로** 한 번 본다 — 우리가 지은 바이트라도 "됐다"는 말은
  // 자를 통과한 뒤에만 한다(밟은 사고의 뿌리가 자 없이 성공을 부른 것이었다).
  if (!documentSignatureMatches('xlsx', bytes)) throw new Error('xlsx_build_signature_broken');
  return bytes;
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
