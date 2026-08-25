import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseHTML } from 'linkedom';

const execFileAsync = promisify(execFile);
const MAX_PREVIEW_HTML_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_RESOURCE_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_FILES = 256;
const MAX_PAGES = 200;
const MAX_PAGE_HTML_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_PNG_BYTES = 20 * 1024 * 1024;
const MAX_HELPER_STDOUT_BYTES = 64 * 1024;
const MAX_GLYPH_MARKER_GRAPHEMES = 24;
const MAX_TOTAL_RENDER_MS = 120_000;
const DEFAULT_HELPER = resolve(dirname(fileURLToPath(import.meta.url)), '../../../runtime/bin/t5-docx-page-renderer');

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function boundary(reason, error = null) {
  return {
    state: 'capability_boundary', reason,
    ...(error == null ? {} : { error: error?.message ?? String(error) }),
  };
}

async function exactRegularFile(path, maximumBytes) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > maximumBytes) {
    throw new Error('unsafe or oversized regular file');
  }
  return { stat, path: await realpath(path), bytes: await readFile(path) };
}

async function previewFiles(root, current = root, output = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('preview contains a symbolic link');
    if (entry.isDirectory()) await previewFiles(root, path, output);
    else if (entry.isFile() && stat.nlink === 1) output.push({
      path, relativePath: relative(root, path), bytes: stat.size,
    });
    else throw new Error('preview contains a non-regular entry');
    if (output.length > MAX_PREVIEW_FILES) throw new Error('preview contains too many files');
  }
  if (output.reduce((sum, item) => sum + item.bytes, 0) > MAX_PREVIEW_RESOURCE_BYTES) {
    throw new Error('preview resources exceed the byte limit');
  }
  return output;
}

function plistAllowsLocalHtml(value) {
  return /<key>\s*MimeType\s*<\/key>\s*<string>\s*text\/html\s*<\/string>/iu.test(value)
    && /<key>\s*AllowNetworkAccess\s*<\/key>\s*<false\s*\/>/iu.test(value);
}

function localReference(value) {
  const source = String(value ?? '').trim();
  if (!source || source.startsWith('#')) return '';
  if (source.startsWith('/') || source.startsWith('//') || /^[a-z][a-z0-9+.-]*:/iu.test(source)) return null;
  let decoded;
  try { decoded = decodeURIComponent(source.split(/[?#]/u)[0]); }
  catch { return null; }
  if (!decoded || decoded.includes('\\') || isAbsolute(decoded) || decoded.split('/').includes('..')) return null;
  return decoded.replace(/^\.\//u, '');
}

function validatePreviewHtml(document, safeImageResources) {
  if (document.querySelector('script,iframe,object,embed')) throw new Error('preview contains active content');
  for (const meta of document.querySelectorAll('meta')) {
    if (String(meta.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh') {
      throw new Error('preview contains meta refresh');
    }
  }
  const styles = [
    ...[...document.querySelectorAll('style')].map((item) => item.textContent ?? ''),
    ...[...document.querySelectorAll('[style]')].map((item) => item.getAttribute('style') ?? ''),
  ].join('\n');
  if (/@import\b|url\s*\(|(?:https?|file|data):|\/\//iu.test(styles)) {
    throw new Error('preview CSS contains an external resource primitive');
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of ['src', 'poster']) {
      const value = element.getAttribute(attribute); if (value == null) continue;
      const path = localReference(value);
      if (path == null || !safeImageResources.has(path)) throw new Error('preview contains an unsafe URL');
    }
    for (const attribute of ['data', 'action', 'formaction', 'xlink:href', 'background', 'manifest', 'ping']) {
      if (String(element.getAttribute(attribute) ?? '').trim()) throw new Error('preview contains an unsafe URL');
    }
    const href = String(element.getAttribute('href') ?? '').trim();
    if (href && !href.startsWith('#')) throw new Error('preview contains an unsafe URL');
    const srcset = element.getAttribute('srcset');
    if (srcset != null && srcset.split(',').some((item) => {
      const path = localReference(item.trim().split(/\s+/u)[0]);
      return path == null || !safeImageResources.has(path);
    })) {
      throw new Error('preview contains an unsafe srcset URL');
    }
  }
}

function glyphText(value) {
  return String(value ?? '').normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, '');
}

function glyphMarkers(value) {
  const normalized = glyphText(value);
  if (!normalized) return [];
  const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
  const segments = [...segmenter.segment(normalized)].map((item) => item.segment);
  if (segments.length <= MAX_GLYPH_MARKER_GRAPHEMES) return [segments.join('')];
  const half = Math.floor(MAX_GLYPH_MARKER_GRAPHEMES / 2);
  return [segments.slice(0, half).join(''), segments.slice(-half).join('')];
}

function splitPreviewPages(html, safeImageResources = new Set()) {
  const { document } = parseHTML(html);
  validatePreviewHtml(document, safeImageResources);
  const container = document.querySelector('div.s1');
  if (!container) throw new Error('preview document container is missing');
  const children = [...container.children];
  const shared = children.filter((item) => item.tagName === 'STYLE');
  const pages = [[]];
  for (const child of children) {
    if (child.tagName === 'STYLE') continue;
    if (child.tagName === 'P' && child.textContent === '\f') {
      pages.push([]); continue;
    }
    pages.at(-1).push(child);
  }
  if (pages.length > MAX_PAGES) throw new Error('preview exceeds the page cap');
  if (pages.some((page) => page.length === 0)) throw new Error('preview contains an empty derived page');
  return pages.map((page, index) => {
    const pageDocument = document.cloneNode(true);
    const pageContainer = pageDocument.querySelector('div.s1');
    pageContainer.replaceChildren(
      ...shared.map((item) => item.cloneNode(true)), ...page.map((item) => item.cloneNode(true)),
    );
    const pageHtml = pageDocument.toString();
    if (Buffer.byteLength(pageHtml) > MAX_PAGE_HTML_BYTES) throw new Error('derived page HTML exceeds the byte limit');
    const text = page.map((item) => item.textContent ?? '').join(' ');
    return { page: index + 1, html: pageHtml, markers: glyphMarkers(text) };
  });
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function safeImageResourcePaths(files) {
  const output = new Set();
  for (const file of files) {
    if (file.bytes < 8 || file.bytes > MAX_PAGE_PNG_BYTES) continue;
    const header = (await readFile(file.path)).subarray(0, 16);
    const png = header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const gif = ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString('ascii'));
    const webp = header.subarray(0, 4).toString('ascii') === 'RIFF'
      && header.subarray(8, 12).toString('ascii') === 'WEBP';
    if (png || jpeg || gif || webp) output.add(file.relativePath);
  }
  return output;
}

async function sealPage({ page, packageRoot, packageFiles, sealedRoot }) {
  const root = join(sealedRoot, `page-${page.page}`);
  await mkdir(root, { recursive: true });
  for (const resource of packageFiles) {
    if (resource.relativePath === 'Preview.html') continue;
    const destination = resolve(root, resource.relativePath);
    if (relative(root, destination) === '..' || relative(root, destination).startsWith(`..${sep}`)) {
      throw new Error('preview resource escapes sealed page root');
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resource.path, destination);
  }
  const htmlPath = join(root, 'Preview.html');
  await writeFile(htmlPath, page.html, { encoding: 'utf8', mode: 0o600 });
  return { ...page, htmlPath, pngPath: join(root, 'page.png') };
}

function helperReceipt(stdout) {
  const value = JSON.parse(String(stdout ?? ''));
  if (![value.width, value.height, value.nonWhitePixels].every(Number.isInteger)
    || value.width < 1 || value.height < 1 || value.width > 10_000 || value.height > 10_000
    || value.nonWhitePixels < 0 || value.nonWhitePixels > value.width * value.height
    || typeof value.ocrText !== 'string' || value.ocrText.length > 8_192) {
    throw new Error('DOCX page helper returned a malformed receipt');
  }
  return value;
}

export async function renderDocxAllPages(file, {
  platform = process.platform, runCommand = execFileAsync, temporaryRoot = tmpdir(),
  helperPath = DEFAULT_HELPER,
} = {}) {
  if (platform !== 'darwin') return boundary('docx_all_page_renderer_not_qualified');
  try { await exactRegularFile(helperPath, 4 * 1024 * 1024); }
  catch { return boundary('docx_all_page_helper_unavailable'); }
  const deadline = Date.now() + MAX_TOTAL_RENDER_MS;
  const directory = await mkdtemp(join(temporaryRoot, 't5-docx-all-pages-'));
  try {
    const output = join(directory, 'quicklook'); await mkdir(output);
    await runCommand('/usr/bin/qlmanage', ['-p', '-o', output, file], {
      timeout: 30_000, maxBuffer: 512 * 1024,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'ko_KR.UTF-8' },
    });
    const candidates = (await readdir(output, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('.qlpreview'));
    if (candidates.length !== 1) return boundary('docx_preview_output_ambiguous');
    const packageRoot = join(output, candidates[0].name);
    const packageStat = await lstat(packageRoot);
    if (packageStat.isSymbolicLink()) return boundary('docx_preview_output_unsafe');
    const packageFiles = await previewFiles(packageRoot);
    const preview = await exactRegularFile(join(packageRoot, 'Preview.html'), MAX_PREVIEW_HTML_BYTES);
    const properties = await exactRegularFile(join(packageRoot, 'PreviewProperties.plist'), 128 * 1024);
    if (!plistAllowsLocalHtml(properties.bytes.toString('utf8'))) return boundary('docx_preview_properties_unqualified');
    const pages = splitPreviewPages(
      preview.bytes.toString('utf8'), await safeImageResourcePaths(packageFiles),
    );
    const sealedRoot = join(directory, 'sealed'); await mkdir(sealedRoot);
    const receipts = [];
    for (const page of pages) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return boundary('docx_all_page_render_timeout');
      const sealed = await sealPage({ page, packageRoot, packageFiles, sealedRoot });
      const executed = await runCommand(helperPath, [sealed.htmlPath, sealed.pngPath], {
        timeout: Math.min(30_000, remaining), maxBuffer: MAX_HELPER_STDOUT_BYTES,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'ko_KR.UTF-8' },
      });
      const observed = helperReceipt(executed?.stdout);
      const png = await exactRegularFile(sealed.pngPath, MAX_PAGE_PNG_BYTES);
      const dimensions = pngDimensions(png.bytes);
      if (!dimensions || dimensions.width !== observed.width || dimensions.height !== observed.height) {
        return boundary('docx_page_png_receipt_mismatch');
      }
      const normalizedOcr = glyphText(observed.ocrText);
      const markerPresent = sealed.markers.every((marker) => normalizedOcr.includes(marker));
      const markerIdentity = sealed.markers.join('\u0000');
      receipts.push({
        page: page.page, pageId: `document:page${page.page}`, bytes: png.bytes.length,
        sha256: sha256(png.bytes), width: dimensions.width, height: dimensions.height,
        nonWhitePixels: observed.nonWhitePixels,
        glyphMarkerSha256: sha256(Buffer.from(markerIdentity)),
        glyphMarkerLength: sealed.markers.reduce((sum, marker) => sum + [...marker].length, 0),
        glyphMarkerPresent: markerPresent && (sealed.markers.length === 0 || observed.nonWhitePixels > 0),
      });
    }
    const distinctMarkers = new Set(receipts.map((page) => page.glyphMarkerSha256)).size > 1;
    const identicalPixels = new Set(receipts.map((page) => page.sha256)).size === 1;
    if (receipts.length > 1 && distinctMarkers && identicalPixels) return boundary('docx_page_pixels_identical');
    return {
      state: 'rendered', engine: 'macos-quicklook-webkit', pageCount: receipts.length,
      observedPageIds: receipts.map((page) => page.pageId), pages: receipts,
    };
  } catch (error) {
    const message = error?.message ?? String(error);
    if (error?.code === 'ETIMEDOUT' || /timed?\s*out/iu.test(message)) return boundary('docx_all_page_render_timeout');
    if (/page cap/iu.test(message)) return boundary('docx_preview_page_limit');
    if (/byte limit|too many files|oversized/iu.test(message)) return boundary('docx_preview_size_limit');
    if (/active content|refresh|external resource|unsafe URL/iu.test(message)) {
      return boundary('docx_preview_active_content');
    }
    if (/symbolic link|non-regular|escapes/iu.test(message)) return boundary('docx_preview_output_unsafe');
    return boundary('docx_all_page_render_failed');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function renderDocxFirstPage(file, {
  platform = process.platform, runCommand = execFileAsync, temporaryRoot = tmpdir(),
} = {}) {
  if (platform !== 'darwin') return { state: 'capability_boundary', reason: 'docx_visual_renderer_not_qualified' };
  const directory = await mkdtemp(join(temporaryRoot, 't5-docx-quicklook-'));
  try {
    await runCommand('/usr/bin/qlmanage', ['-t', '-s', '1600', '-o', directory, file], {
      timeout: 30_000, maxBuffer: 512 * 1024,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'ko_KR.UTF-8' },
    });
    const pages = (await readdir(directory)).filter((name) => /\.png$/iu.test(name));
    if (pages.length !== 1) return { state: 'capability_boundary', reason: 'docx_visual_output_ambiguous' };
    const bytes = await readFile(join(directory, pages[0]));
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) return { state: 'capability_boundary', reason: 'docx_visual_output_limit' };
    return { state: 'rendered', bytes, mimeType: 'image/png', engine: 'macos-quicklook', page: 1 };
  } catch (error) {
    return { state: 'capability_boundary', reason: 'docx_visual_render_failed', error: error?.message ?? String(error) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
