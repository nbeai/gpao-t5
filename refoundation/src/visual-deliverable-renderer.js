import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseHTML, DOMParser } from 'linkedom';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_RENDER_BYTES = 20 * 1024 * 1024;
const MAX_HELPER_STDOUT_BYTES = 128 * 1024;
const DEFAULT_HELPER = process.env.T5_VISUAL_RENDERER_HELPER
  ? resolve(process.env.T5_VISUAL_RENDERER_HELPER)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../../runtime/bin/t5-docx-page-renderer');

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function boundary(reason, error = null) {
  return { state: 'capability_boundary', reason,
    ...(error == null ? {} : { error: error?.message ?? String(error) }) };
}

async function exactFile(input, maximumBytes = MAX_SOURCE_BYTES) {
  const stat = await lstat(input);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > maximumBytes) {
    throw new Error('visual source must be one bounded regular file');
  }
  const path = await realpath(input);
  return { path, stat, bytes: await readFile(path) };
}

function localReference(value) {
  const source = String(value ?? '').trim();
  if (!source || source.startsWith('#') || source.startsWith('data:')) return true;
  return !source.startsWith('/') && !source.startsWith('//')
    && !/^[a-z][a-z0-9+.-]*:/iu.test(source)
    && !source.split(/[?#]/u)[0].split('/').includes('..');
}

function sourceTextMarkers(value) {
  const text = String(value ?? '').normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, '');
  if (!text) return [];
  const graphemes = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)]
    .map((item) => item.segment);
  if (graphemes.length <= 12) return [graphemes.join('')];
  return [graphemes.slice(0, 6).join(''), graphemes.slice(-6).join('')];
}

function inspectHtml(bytes) {
  const html = bytes.toString('utf8');
  const { document } = parseHTML(html);
  const defects = [];
  if (document.querySelector('script,iframe,object,embed')) defects.push('active_content');
  for (const meta of document.querySelectorAll('meta')) {
    if (String(meta.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh') defects.push('meta_refresh');
  }
  const styles = [
    ...[...document.querySelectorAll('style')].map((item) => item.textContent ?? ''),
    ...[...document.querySelectorAll('[style]')].map((item) => item.getAttribute('style') ?? ''),
  ].join('\n');
  if (/@import\b|url\s*\(\s*['"]?(?:https?|file):|expression\s*\(/iu.test(styles)) {
    defects.push('external_or_active_css');
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of ['src', 'href', 'poster', 'data', 'action', 'formaction', 'xlink:href']) {
      const value = element.getAttribute(attribute);
      if (value != null && !localReference(value)) defects.push('external_or_escaping_reference');
    }
  }
  const text = document.body?.textContent ?? '';
  return {
    sourceKind: 'html', textCharacters: text.length, textMarkers: sourceTextMarkers(text),
    artboardDeclarations: document.querySelectorAll('[data-vd-artboard]').length,
    blockDeclarations: document.querySelectorAll('[data-vd-block]').length,
    headingCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    tableCount: document.querySelectorAll('table').length,
    defects: [...new Set(defects)],
  };
}

function inspectSvg(bytes) {
  const xml = bytes.toString('utf8');
  const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
  const root = document?.documentElement;
  if (String(root?.localName ?? '').toLowerCase() !== 'svg') throw new Error('visual SVG root is invalid');
  const defects = [];
  if (root.querySelector('script,foreignObject,iframe,object,embed')) defects.push('unsupported_active_or_foreign_content');
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of ['href', 'xlink:href', 'src']) {
      const value = element.getAttribute(attribute);
      if (value != null && !localReference(value)) defects.push('external_or_escaping_reference');
    }
  }
  const textElements = [...root.querySelectorAll('text')];
  if (textElements.some((item) => (item.textContent ?? '').trim().length > 120
    || (item.textContent ?? '').includes('\n'))) defects.push('svg_paragraph_text');
  const text = textElements.map((item) => item.textContent ?? '').join(' ');
  return {
    sourceKind: 'svg', textCharacters: text.length, textMarkers: sourceTextMarkers(text),
    viewBox: root.getAttribute('viewBox') ?? null,
    textElementCount: textElements.length,
    defects: [...new Set(defects)],
  };
}

export function inspectVisualDeliverableSource(bytes, fileName = '') {
  const content = Buffer.from(bytes ?? []);
  if (content.length === 0 || content.length > MAX_SOURCE_BYTES) throw new Error('visual source size is invalid');
  const extension = extname(String(fileName)).toLowerCase();
  if (['.html', '.htm'].includes(extension)) return inspectHtml(content);
  if (extension === '.svg') return inspectSvg(content);
  throw new Error('visual deliverable source must be HTML or SVG');
}

function helperReceipt(stdout) {
  const value = JSON.parse(String(stdout ?? ''));
  if (![value.width, value.height, value.nonWhitePixels].every(Number.isInteger)
    || value.width < 1 || value.height < 1 || value.nonWhitePixels < 0
    || typeof value.ocrText !== 'string') throw new Error('visual helper returned a malformed receipt');
  if (!value.dom || ![
    value.dom.viewportWidth, value.dom.viewportHeight, value.dom.scrollWidth,
    value.dom.scrollHeight, value.dom.artboardCount, value.dom.observedBlockCount,
    value.dom.overflowElementCount, value.dom.overlapPairCount, value.dom.textCharacters,
    value.dom.contrastFailureCount, value.dom.contrastUnmeasuredCount,
  ].every(Number.isFinite)) throw new Error('visual helper returned no DOM receipt');
  return value;
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function designReceipt({ source, rendered, png }) {
  const defects = [...source.defects];
  const unmeasured = [];
  if (rendered.nonWhitePixels === 0) defects.push('blank_render');
  if (rendered.nonWhitePixels == null) unmeasured.push('non_white_pixel_coverage');
  if (rendered.dom) {
    if (rendered.dom.overflowElementCount > 0) defects.push('content_overflow');
    if (rendered.dom.overlapPairCount > 0) defects.push('declared_block_overlap');
    if (rendered.dom.contrastFailureCount > 0) defects.push('text_contrast_failure');
    if (rendered.dom.contrastUnmeasuredCount > 0) unmeasured.push('text_contrast_on_complex_background');
    if (rendered.dom.imagesMissingAlt > 0) defects.push('image_alt_missing');
    if (rendered.dom.figuresMissingCaption > 0) defects.push('figure_caption_missing');
    if (rendered.dom.unavailableFontFamilies?.length) defects.push('font_unavailable');
  }
  const ocrAvailable = typeof rendered.ocrText === 'string';
  const normalizedOcr = ocrAvailable
    ? rendered.ocrText.normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, '') : '';
  const visibleMarkers = ocrAvailable
    ? source.textMarkers.filter((marker) => normalizedOcr.includes(marker)) : null;
  if (ocrAvailable && source.textMarkers.length && visibleMarkers.length === 0) defects.push('rendered_text_unobserved');
  if (!ocrAvailable && source.textMarkers.length) unmeasured.push('rendered_text_pixels');
  return {
    schema: 't5.visual-design-receipt.v1',
    state: defects.length ? 'failed' : unmeasured.length ? 'unmeasured' : 'qualified',
    source: {
      kind: source.sourceKind, textCharacters: source.textCharacters,
      textMarkerCount: source.textMarkers.length,
      visibleTextMarkerCount: visibleMarkers?.length ?? null,
      ...(source.viewBox == null ? {} : { viewBox: source.viewBox }),
    },
    render: {
      engine: rendered.engine,
      width: rendered.width, height: rendered.height,
      nonWhitePixels: rendered.nonWhitePixels,
      pngBytes: png.length, pngSha256: sha256(png),
      dom: rendered.dom ?? null,
    },
    defects: [...new Set(defects)],
    unmeasured,
    nonClaims: [
      'This receipt contains observable render facts, not an aesthetic score.',
      'A qualified raster render does not prove editable DOCX or PPTX output.',
    ],
  };
}

export async function renderVisualDeliverable(file, {
  platform = process.platform, helperPath = DEFAULT_HELPER,
  runCommand = execFileAsync, temporaryRoot = tmpdir(),
} = {}) {
  let sourceFile;
  try { sourceFile = await exactFile(file); }
  catch (error) { return boundary('visual_source_unavailable', error); }
  let source;
  try { source = inspectVisualDeliverableSource(sourceFile.bytes, sourceFile.path); }
  catch (error) { return boundary('visual_source_invalid', error); }
  if (source.defects.some((item) => ['active_content', 'meta_refresh', 'external_or_active_css',
    'external_or_escaping_reference', 'unsupported_active_or_foreign_content'].includes(item))) {
    return { state: 'failed', source, receipt: {
      schema: 't5.visual-design-receipt.v1', state: 'failed', defects: source.defects,
    } };
  }
  if (source.sourceKind === 'svg') {
    try {
      const png = await sharp(sourceFile.bytes, { limitInputPixels: 16_000_000, failOn: 'warning' })
        .png().toBuffer();
      if (png.length > MAX_RENDER_BYTES) return boundary('visual_render_too_large');
      const dimensions = pngDimensions(png); if (!dimensions) return boundary('visual_render_invalid_png');
      const rendered = {
        engine: 'sharp-svg', ...dimensions, nonWhitePixels: null,
        ocrText: null, dom: null,
      };
      const receipt = designReceipt({ source, rendered, png });
      return { state: 'rendered', sourcePath: sourceFile.path,
        sourceSha256: sha256(sourceFile.bytes), png, receipt };
    } catch (error) { return boundary('visual_svg_render_failed', error); }
  }
  if (platform !== 'darwin') return boundary('visual_html_renderer_not_qualified_for_platform');
  try { await exactFile(helperPath, 4 * 1024 * 1024); }
  catch { return boundary('visual_html_helper_unavailable'); }
  const room = await mkdtemp(join(temporaryRoot, 't5-visual-deliverable-'));
  try {
    const output = join(room, 'render.png');
    const executed = await runCommand(helperPath, [sourceFile.path, output], {
      timeout: 30_000, maxBuffer: MAX_HELPER_STDOUT_BYTES,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'ko_KR.UTF-8' },
    });
    const observed = helperReceipt(executed?.stdout);
    const pngFile = await exactFile(output, MAX_RENDER_BYTES);
    const dimensions = pngDimensions(pngFile.bytes);
    if (!dimensions || dimensions.width !== observed.width || dimensions.height !== observed.height) {
      return boundary('visual_render_receipt_mismatch');
    }
    const rendered = { ...observed, engine: 'macos-webkit' };
    const receipt = designReceipt({ source, rendered, png: pngFile.bytes });
    return { state: 'rendered', sourcePath: sourceFile.path,
      sourceSha256: sha256(sourceFile.bytes), png: pngFile.bytes, receipt };
  } catch (error) { return boundary('visual_html_render_failed', error); }
  finally { await rm(room, { recursive: true, force: true }).catch(() => {}); }
}
