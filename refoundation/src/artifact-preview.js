import { extname } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { DOMParser } from 'linkedom';

import { inspectZipArchive } from './archive-safety.js';
import { inspectBusinessDocument } from './document-data-inspector.js';
import { decodeTextDocument } from './text-document-observer.js';

const MAX_WEB_BYTES = 5 * 1024 * 1024;
const MAX_DOCX_BYTES = 32 * 1024 * 1024;
const MAX_CSV_BYTES = 8 * 1024 * 1024;
const MAX_CSV_ROWS = 500;
const MAX_CSV_COLUMNS = 100;
const MAX_SHEET_ROWS = 200;
const MAX_SHEET_COLUMNS = 50;
const WEB_BUNDLE_LIMITS = {
  maxEntries: 500,
  maxEntryBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 100,
};

const PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "font-src data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "object-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
].join('; ');

const OFFICE_CSP = PREVIEW_CSP.replace("script-src 'unsafe-inline'", "script-src 'none'");

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function extension(record) {
  return extname(String(record?.originalName ?? '')).toLowerCase();
}

export function artifactPreviewKind(record = {}) {
  const ext = extension(record);
  const mime = String(record.mimeType ?? '').toLowerCase();
  if (record.kind === 'web_app' || mime === 'application/vnd.gpao-t5.web-bundle+zip') return 'web_app';
  // 실제 저장소는 bytes로 MIME을 정하지만, 이름과 MIME이 충돌한 오래된 원장도 있다.
  // 구체적인 파일 형식을 먼저 고르고 broad text/html·document kind는 그다음에 본다.
  if (ext === '.docx') return 'document';
  if (['.xlsx', '.xlsm', '.xltx', '.csv'].includes(ext)) return 'spreadsheet';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.svg') return 'vector';
  if (['.html', '.htm'].includes(ext)) return 'web';
  if (mime === 'image/svg+xml') return 'vector';
  if (mime === 'text/html') return 'web';
  if (record.kind === 'image') return 'image';
  if (record.kind === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (record.kind === 'spreadsheet' || mime === 'text/csv') return 'spreadsheet';
  return null;
}

export function artifactPreviewMetadata(record = {}) {
  const previewKind = artifactPreviewKind(record);
  if (!previewKind) return {};
  const base = `/attachments/${record.attachmentId}`;
  const session = `sessionId=${record.sessionId}`;
  if (previewKind === 'image' || previewKind === 'pdf') {
    return { previewKind, previewUrl: `${base}/content?${session}&inline=1` };
  }
  if (previewKind === 'web_app') return {
    previewKind,
    previewUrl: `${base}/web/${record.sessionId}/index.html`,
    sourceUrl: `${base}/manifest?${session}`,
  };
  return {
    previewKind,
    previewUrl: `${base}/preview?${session}`,
    ...(['web', 'vector'].includes(previewKind) ? { sourceUrl: `${base}/source?${session}` } : {}),
  };
}

function officeDocument(title, body, extra = '') {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:#f4f1e9;color:#24231f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR",sans-serif;line-height:1.65}.page{width:min(920px,calc(100% - 32px));min-height:calc(100vh - 32px);margin:16px auto;padding:clamp(28px,6vw,72px);background:#fff;border:1px solid #ded8c9;border-radius:14px;box-shadow:0 10px 34px rgba(58,48,31,.10)}h1,h2,h3{line-height:1.25;color:#151f2b}h1{font-size:2rem;margin:0 0 1.2em}h2{font-size:1.5rem;margin:1.5em 0 .7em}h3{font-size:1.2rem;margin:1.2em 0 .6em}p{white-space:pre-wrap;margin:.7em 0}table{border-collapse:collapse;min-width:100%;font-size:.92rem}th,td{border:1px solid #d8d3c7;padding:8px 10px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#ebe7dc;font-weight:700}.sheet{overflow:auto;margin:0 0 28px}.sheet h2{position:sticky;left:0}.cell-address{display:block;color:#8b806b;font-size:.68rem}.formula{color:#815f1c;font-size:.7rem}.notice{color:#746c5d;font-size:.82rem;margin-bottom:18px}.artifact-chart{margin:0 0 28px;padding:20px;border:1px solid #ded8c9;border-radius:14px;background:#faf9f5}.artifact-chart h3{margin:0 0 16px}.chart-series{margin-top:16px}.chart-series-title{font-weight:700;font-size:.82rem;margin-bottom:8px}.chart-row{display:grid;grid-template-columns:minmax(70px,130px) minmax(120px,1fr) auto;gap:10px;align-items:center;margin:7px 0;font-size:.8rem}.chart-track{height:18px;background:#ebe7dc;border-radius:9px;overflow:hidden}.chart-bar{display:block;height:100%;min-width:2px;border-radius:9px;background:#315f78}${extra}
    @media(prefers-color-scheme:dark){body{background:#1f1e1b;color:#ddd8ce}.page{background:#292824;border-color:#48443b}h1,h2,h3{color:#f4f0e7}th{background:#39362f}th,td{border-color:#514c42}.notice{color:#aaa292}}
  </style></head><body><main class="page">${body}</main></body></html>`;
}

function descendants(node, localName) {
  const output = [];
  const walk = (candidate) => {
    for (const child of candidate?.childNodes ?? []) {
      const name = String(child.localName ?? child.nodeName ?? '').split(':').at(-1);
      if (child.nodeType === 1 && name === localName) output.push(child);
      walk(child);
    }
  };
  walk(node);
  return output;
}

function textOf(node) {
  return descendants(node, 't').map((item) => item.textContent ?? '').join('');
}

function docxParagraph(node) {
  const text = textOf(node);
  if (!text.trim()) return '<p><br></p>';
  const style = descendants(node, 'pStyle')[0];
  const name = style?.getAttribute('w:val') ?? style?.getAttribute('val') ?? '';
  const heading = String(name).match(/(?:Heading|제목)\s*([1-3])?/i);
  if (heading) {
    const level = Math.min(3, Math.max(1, Number(heading[1] ?? 1)));
    return `<h${level}>${escapeHtml(text)}</h${level}>`;
  }
  return `<p>${escapeHtml(text)}</p>`;
}

function docxTable(node) {
  const rows = [...(node.childNodes ?? [])].filter((child) => child.nodeType === 1 && child.localName === 'tr');
  return `<table>${rows.map((row, rowIndex) => {
    const cells = [...(row.childNodes ?? [])].filter((child) => child.nodeType === 1 && child.localName === 'tc');
    const tag = rowIndex === 0 ? 'th' : 'td';
    return `<tr>${cells.map((cell) => `<${tag}>${escapeHtml(textOf(cell))}</${tag}>`).join('')}</tr>`;
  }).join('')}</table>`;
}

function renderDocx(record, bytes) {
  if (bytes.length > MAX_DOCX_BYTES) throw Object.assign(new Error('document preview size limit exceeded'), { status: 413 });
  const archive = unzipSync(new Uint8Array(bytes));
  const entry = archive['word/document.xml'];
  if (!entry) throw new Error('DOCX document body is missing');
  const xml = strFromU8(entry);
  if (xml.length > 16 * 1024 * 1024) throw Object.assign(new Error('document XML preview limit exceeded'), { status: 413 });
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const body = descendants(document, 'body')[0];
  if (!body) throw new Error('DOCX document body is invalid');
  const blocks = [...body.childNodes].flatMap((node) => {
    if (node.nodeType !== 1) return [];
    const name = String(node.localName ?? node.nodeName ?? '').split(':').at(-1);
    if (name === 'p') return [docxParagraph(node)];
    if (name === 'tbl') return [docxTable(node)];
    return [];
  });
  return officeDocument(record.originalName, blocks.join('') || '<p class="notice">표시할 문단이 없어요.</p>');
}

function renderWorkbookChart(chart) {
  const series = (chart.series ?? []).filter((item) => item.values?.length);
  if (!series.length) return `<section class="artifact-chart"><h3>${escapeHtml(chart.title ?? `차트 ${chart.index}`)}</h3><p class="notice">차트는 있지만 화면에 그릴 cached data가 없어 원본 Excel에서 확인해야 해요.</p></section>`;
  const content = series.map((item) => {
    const max = Math.max(1, ...item.values.map((value) => Math.abs(Number(value) || 0)));
    const rows = item.values.map((value, index) => {
      const label = item.categories[index] ?? String(index + 1);
      const width = Math.max(0, Math.min(100, Math.abs(Number(value) || 0) / max * 100));
      return `<div class="chart-row"><span>${escapeHtml(label)}</span><span class="chart-track"><span class="chart-bar" style="width:${width.toFixed(2)}%"></span></span><strong>${escapeHtml(value)}</strong></div>`;
    }).join('');
    return `<div class="chart-series"><div class="chart-series-title">${escapeHtml(item.name)}</div>${rows}</div>`;
  }).join('');
  return `<section class="artifact-chart" data-chart-kind="${escapeHtml(chart.kind)}"><h3>${escapeHtml(chart.title ?? `차트 ${chart.index}`)}</h3>${content}</section>`;
}

function renderWorkbookSheet(sheet) {
  const cells = new Map(sheet.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  const rows = Math.min(sheet.rowCount, MAX_SHEET_ROWS);
  const columns = Math.min(sheet.columnCount, MAX_SHEET_COLUMNS);
  const head = `<tr><th></th>${Array.from({ length: columns }, (_, index) => `<th>${escapeHtml(String.fromCharCode(65 + index))}</th>`).join('')}</tr>`;
  const body = Array.from({ length: rows }, (_, rowIndex) => {
    const row = rowIndex + 1;
    return `<tr><th>${row}</th>${Array.from({ length: columns }, (_, columnIndex) => {
      const cell = cells.get(`${row}:${columnIndex + 1}`);
      if (!cell) return '<td></td>';
      const value = cell.text || (cell.value == null ? '' : String(cell.value));
      const formula = cell.formula ? `<span class="formula">=${escapeHtml(cell.formula)}</span>` : '';
      return `<td><span class="cell-address">${escapeHtml(cell.address)}</span>${escapeHtml(value)}${formula}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const omitted = sheet.rowCount > rows || sheet.columnCount > columns
    ? `<p class="notice">화면에는 ${rows}행 × ${columns}열까지만 보여요. 원본 파일에는 더 많은 셀이 있습니다.</p>` : '';
  const charts = (sheet.charts ?? []).map(renderWorkbookChart).join('');
  return `<section class="sheet"><h2>${escapeHtml(sheet.name)}</h2>${charts}${omitted}<table>${head}${body}</table></section>`;
}

async function renderXlsx(record) {
  const observed = await inspectBusinessDocument({
    file: record.storedPath, maxCells: MAX_SHEET_ROWS * MAX_SHEET_COLUMNS,
  });
  const sheets = observed.workbook.sheets.filter((sheet) => sheet.kind === 'worksheet');
  const notice = observed.projection.truncated
    ? `<p class="notice">큰 문서라 일부 셀만 미리 보여요. 다운로드한 원본에는 전체 내용이 있습니다.</p>` : '';
  return officeDocument(record.originalName, notice + sheets.map(renderWorkbookSheet).join(''));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length && rows.length < MAX_CSV_ROWS; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { field += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === ',') { row.push(field); field = ''; continue; }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row.slice(0, MAX_CSV_COLUMNS)); row = []; field = ''; continue;
    }
    field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row.slice(0, MAX_CSV_COLUMNS)); }
  return rows;
}

function renderCsv(record, bytes) {
  if (bytes.length > MAX_CSV_BYTES) throw Object.assign(new Error('CSV preview size limit exceeded'), { status: 413 });
  const rows = parseCsv(decodeTextDocument(bytes, record.encoding ?? 'utf-8'));
  const body = rows.map((row, rowIndex) => {
    const tag = rowIndex === 0 ? 'th' : 'td';
    return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('')}</tr>`;
  }).join('');
  return officeDocument(record.originalName, `<section class="sheet"><table>${body}</table></section>`);
}

export async function renderAttachmentPreview({ record, bytes } = {}) {
  const content = Buffer.from(bytes ?? []);
  const kind = artifactPreviewKind(record);
  if (!kind) throw Object.assign(new Error('preview is not available for this file'), { status: 415 });
  if (['web', 'vector'].includes(kind)) {
    if (content.length > MAX_WEB_BYTES) throw Object.assign(new Error('web preview size limit exceeded'), { status: 413 });
    return {
      kind,
      contentType: kind === 'vector' ? 'image/svg+xml; charset=utf-8' : 'text/html; charset=utf-8',
      contentSecurityPolicy: kind === 'vector' ? OFFICE_CSP : PREVIEW_CSP,
      body: kind === 'web' ? injectArtifactPreviewBridge(content.toString('utf8'), record.attachmentId)
        : content.toString('utf8'),
    };
  }
  if (kind === 'document') return {
    kind, contentType: 'text/html; charset=utf-8', contentSecurityPolicy: OFFICE_CSP,
    body: renderDocx(record, content),
  };
  if (kind === 'spreadsheet') return {
    kind, contentType: 'text/html; charset=utf-8', contentSecurityPolicy: OFFICE_CSP,
    body: extension(record) === '.csv' ? renderCsv(record, content) : await renderXlsx(record),
  };
  throw Object.assign(new Error('preview uses the original managed content'), { status: 409 });
}

export function injectArtifactPreviewBridge(htmlInput, attachmentId) {
  const html = String(htmlInput ?? '');
  const id = JSON.stringify(String(attachmentId ?? ''));
  const bridge = `<script>(()=>{const artifactId=${id};const send=(level,args)=>{try{const text=args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ').slice(0,2000);parent.postMessage({type:'t5-artifact-log',artifactId,level,text},'*')}catch{}};for(const level of ['log','warn','error']){const original=console[level]?.bind(console);console[level]=(...args)=>{send(level,args);original?.(...args)}}window.addEventListener('error',event=>send('error',[event.message||'실행 오류']));window.addEventListener('unhandledrejection',event=>send('error',[event.reason?.message||String(event.reason||'처리되지 않은 오류')]))})();</script>`;
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, `${bridge}</head>`);
  if (/<body(?:\s[^>]*)?>/i.test(html)) return html.replace(/<body(?:\s[^>]*)?>/i, (match) => `${match}${bridge}`);
  return `${bridge}${html}`;
}

function webAssetContentType(path) {
  const ext = extname(path).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  })[ext] ?? 'application/octet-stream';
}

export function webBundleManifest(bytesInput) {
  const bytes = Buffer.from(bytesInput ?? []);
  const inspected = inspectZipArchive(bytes, WEB_BUNDLE_LIMITS);
  if (inspected.state !== 'safe_manifest') {
    throw Object.assign(new Error(`web bundle is unsafe: ${inspected.reason}`), { status: 415 });
  }
  if (!inspected.entries.some((entry) => entry.path === 'index.html' && !entry.directory)) {
    throw Object.assign(new Error('web bundle index.html is missing'), { status: 415 });
  }
  return {
    schema: 't5.web-bundle-preview.v1', state: 'ready', entry: 'index.html',
    files: inspected.entries.filter((entry) => !entry.directory).map((entry) => ({
      path: entry.path, bytes: entry.uncompressedBytes, contentType: webAssetContentType(entry.path),
    })),
    totalBytes: inspected.totalUncompressedBytes,
  };
}

export function readWebBundleEntry(bytesInput, requestedPath) {
  const bytes = Buffer.from(bytesInput ?? []);
  const manifest = webBundleManifest(bytes);
  let path;
  try { path = decodeURIComponent(String(requestedPath ?? '')); }
  catch { throw Object.assign(new Error('web bundle path is invalid'), { status: 400 }); }
  const file = manifest.files.find((candidate) => candidate.path === path);
  if (!file) throw Object.assign(new Error('web bundle file not found'), { status: 404 });
  const content = unzipSync(new Uint8Array(bytes))[path];
  if (!content || content.length !== file.bytes) throw new Error('web bundle entry size mismatch');
  return { ...file, body: Buffer.from(content), manifest };
}

export function webPreviewContentSecurityPolicy() { return PREVIEW_CSP.replace(
  "font-src data:", "font-src 'self' data:",
).replace(
  "img-src data: blob:", "img-src 'self' data: blob:",
).replace(
  "script-src 'unsafe-inline'", "script-src 'self' 'unsafe-inline'",
).replace(
  "style-src 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
); }
