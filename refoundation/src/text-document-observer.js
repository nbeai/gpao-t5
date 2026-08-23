import { extname } from 'node:path';

const LEGACY_KOREAN_EXTENSIONS = new Set(['.txt', '.csv', '.tsv', '.log']);
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLUMNS = 100;

function decodeStrict(bytes, encoding) {
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { return null; }
}

function textFacts(text) {
  const characters = [...text];
  const printable = characters.filter((character) => character === '\n' || character === '\r'
    || character === '\t' || character.codePointAt(0) >= 0x20).length;
  const hangulCharacters = characters.filter((character) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/u.test(character)).length;
  return {
    characters: characters.length,
    printableRatio: printable / Math.max(1, characters.length),
    replacementCharacters: characters.filter((character) => character === '\ufffd').length,
    hangulCharacters,
  };
}

function exactRoundTrip(bytes, text, encoding) {
  if (encoding === 'utf-8') return Buffer.from(text, 'utf8').equals(bytes);
  if (encoding === 'utf-16le') return Buffer.from(text, 'utf16le').equals(bytes);
  if (encoding === 'utf-16be') {
    const little = Buffer.from(text, 'utf16le');
    for (let index = 0; index < little.length; index += 2) {
      const first = little[index]; little[index] = little[index + 1]; little[index + 1] = first;
    }
    return little.equals(bytes);
  }
  return null;
}

function candidate(bytes, encoding, { bom = null, candidates = [encoding], ambiguous = false } = {}) {
  const text = decodeStrict(bytes, encoding === 'windows-949-compatible' ? 'euc-kr' : encoding);
  if (text == null) return null; const facts = textFacts(text);
  if (facts.printableRatio <= 0.95 || facts.replacementCharacters !== 0) return null;
  const roundTrip = exactRoundTrip(bytes, text, encoding);
  return {
    encoding, text,
    evidence: {
      bom, strictDecode: true, printableRatio: facts.printableRatio,
      replacementCharacters: facts.replacementCharacters,
      hangulCharacters: facts.hangulCharacters,
      candidates, ambiguous,
      roundTrip: roundTrip == null ? 'not_available_in_native_runtime' : roundTrip ? 'exact' : 'mismatch',
    },
  };
}

export function detectTextDocument(bytesInput, originalName = '') {
  const bytes = Buffer.from(bytesInput); if (!bytes.length) return null;
  const extension = extname(String(originalName)).toLowerCase();
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    return candidate(bytes.subarray(3), 'utf-8', { bom: 'utf-8' });
  }
  if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
    if ((bytes.length - 2) % 2 !== 0) return null;
    return candidate(bytes.subarray(2), 'utf-16le', { bom: 'utf-16le' });
  }
  if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    if ((bytes.length - 2) % 2 !== 0) return null;
    return candidate(bytes.subarray(2), 'utf-16be', { bom: 'utf-16be' });
  }
  if (!bytes.includes(0)) {
    const utf8 = candidate(bytes, 'utf-8'); if (utf8) return utf8;
  }
  if (!LEGACY_KOREAN_EXTENSIONS.has(extension) || bytes.includes(0)) return null;
  const korean = candidate(bytes, 'windows-949-compatible', {
    candidates: ['cp949', 'euc-kr'], ambiguous: true,
  });
  return korean?.evidence.hangulCharacters > 0 ? korean : null;
}

export function decodeTextDocument(bytesInput, encoding) {
  const bytes = Buffer.from(bytesInput);
  const offset = encoding === 'utf-8' && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3
    : ['utf-16le', 'utf-16be'].includes(encoding) && (bytes[0] === 0xff || bytes[0] === 0xfe) ? 2 : 0;
  const label = encoding === 'windows-949-compatible' ? 'euc-kr' : encoding;
  const text = decodeStrict(bytes.subarray(offset), label);
  if (text == null) throw new Error(`stored text no longer decodes as ${encoding}`);
  return text;
}

export function inspectDelimitedText(textInput, { delimiter = ',', maxRows = MAX_TABLE_ROWS, maxColumns = MAX_TABLE_COLUMNS } = {}) {
  const text = String(textInput); if (![',', '\t'].includes(delimiter)) throw new TypeError('unsupported table delimiter');
  const shownRows = []; let row = []; let field = ''; let quoted = false;
  let rowCount = 0; let columnCount = 0; let emptyCells = 0; let irregularRows = 0; let expectedColumns = null;
  function finishRow() {
    row.push(field); field = '';
    const width = row.length; rowCount += 1; columnCount = Math.max(columnCount, width);
    emptyCells += row.filter((value) => value === '').length;
    if (expectedColumns == null) expectedColumns = width;
    else if (width !== expectedColumns) irregularRows += 1;
    if (shownRows.length < maxRows) shownRows.push(row.slice(0, maxColumns));
    row = [];
  }
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { field += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === delimiter) { row.push(field); field = ''; continue; }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishRow(); continue;
    }
    field += character;
  }
  if (field || row.length) finishRow();
  return {
    delimiter: delimiter === '\t' ? 'tab' : 'comma', rowCount, columnCount,
    header: shownRows[0] ?? [], rows: shownRows.slice(1),
    emptyCells, irregularRows, malformedQuotedField: quoted,
    projection: {
      truncated: rowCount > shownRows.length || columnCount > maxColumns,
      shownRows: shownRows.length, totalRows: rowCount,
      shownColumns: Math.min(columnCount, maxColumns), totalColumns: columnCount,
      omittedRows: Math.max(0, rowCount - shownRows.length),
      omittedColumns: Math.max(0, columnCount - maxColumns),
    },
  };
}
