import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderDocxAllPages } from '../src/docx-visual-renderer.js';

const basePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZL0sAAAAASUVORK5CYII=',
  'base64',
);
const plist = '<?xml version="1.0"?><plist><dict><key>MimeType</key><string>text/html</string><key>AllowNetworkAccess</key><false/><key>CanHavePages</key><true/></dict></plist>';

function threePageHtml(extra = '') {
  return `<html><head><meta charset="utf-8"></head><style>.s1{min-height:792px}</style><body><div class="s1"><style>.text{font-size:22px}</style><p class="text">첫째 쪽 한글 기준 글리프 가나다</p><p><span>\f</span></p><p class="text">둘째 쪽 한글 기준 글리프 라마바</p><p><span>\f</span></p><p class="text">셋째 쪽 한글 기준 글리프 사아자</p>${extra}</div></body></html>`;
}

async function fixture({ html = threePageHtml(), helper = true, helperMode = 'normal' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 't5-docx-all-pages-test-'));
  const helperPath = join(root, 'helper');
  if (helper) await writeFile(helperPath, 'fixture helper');
  const runCommand = async (command, args) => {
    if (command === '/usr/bin/qlmanage') {
      const output = args[args.indexOf('-o') + 1];
      const preview = join(output, 'fixture.docx.qlpreview'); await mkdir(preview);
      await writeFile(join(preview, 'Preview.html'), html);
      await writeFile(join(preview, 'PreviewProperties.plist'), plist);
      return { stdout: '' };
    }
    assert.equal(command, helperPath);
    assert.equal(args.length, 2, 'expected marker must not be supplied to native OCR helper');
    const pageHtml = await readFile(args[0], 'utf8');
    const marker = pageHtml.includes('첫째') ? '첫째 쪽 한글 기준 글리프 가나다'
      : pageHtml.includes('둘째') ? '둘째 쪽 한글 기준 글리프 라마바'
        : '셋째 쪽 한글 기준 글리프 사아자';
    const page = marker.startsWith('첫째') ? 1 : marker.startsWith('둘째') ? 2 : 3;
    const suffix = helperMode === 'identical' ? '' : String(page);
    await writeFile(args[1], Buffer.concat([basePng, Buffer.from(suffix)]));
    const receipt = {
      width: 1, height: 1,
      nonWhitePixels: helperMode === 'blank' ? 0 : 1,
      ocrText: helperMode === 'missing-marker' && page === 2 ? '다른 글자' : marker,
    };
    return { stdout: JSON.stringify(receipt) };
  };
  return { root, helperPath, runCommand, close: () => rm(root, { recursive: true, force: true }) };
}

test('Quick Look HTML 세 page를 sealed local page로 나눠 PNG·OCR coverage receipt를 만든다', async () => {
  const app = await fixture();
  try {
    const result = await renderDocxAllPages('/tmp/input.docx', {
      platform: 'darwin', temporaryRoot: app.root, helperPath: app.helperPath, runCommand: app.runCommand,
    });
    assert.equal(result.state, 'rendered');
    assert.equal(result.pageCount, 3);
    assert.deepEqual(result.observedPageIds, ['document:page1', 'document:page2', 'document:page3']);
    assert.ok(result.pages.every((page) => page.glyphMarkerPresent && page.nonWhitePixels === 1));
    assert.equal(new Set(result.pages.map((page) => page.sha256)).size, 3);
    assert.doesNotMatch(JSON.stringify(result), /가나다|라마바|사아자/u, 'full OCR text must not enter the receipt');
  } finally { await app.close(); }
});

test('helper 부재와 non-mac은 all-page proof가 아니라 unmeasured capability boundary다', async () => {
  const app = await fixture({ helper: false });
  try {
    assert.deepEqual(await renderDocxAllPages('/tmp/input.docx', {
      platform: 'darwin', temporaryRoot: app.root, helperPath: app.helperPath, runCommand: app.runCommand,
    }), { state: 'capability_boundary', reason: 'docx_all_page_helper_unavailable' });
    assert.deepEqual(await renderDocxAllPages('/tmp/input.docx', { platform: 'linux' }), {
      state: 'capability_boundary', reason: 'docx_all_page_renderer_not_qualified',
    });
  } finally { await app.close(); }
});

test('blank와 marker 누락은 page receipt에서 glyph coverage를 거짓 통과하지 않는다', async () => {
  for (const helperMode of ['blank', 'missing-marker']) {
    const app = await fixture({ helperMode });
    try {
      const result = await renderDocxAllPages('/tmp/input.docx', {
        platform: 'darwin', temporaryRoot: app.root, helperPath: app.helperPath, runCommand: app.runCommand,
      });
      assert.equal(result.state, 'rendered');
      assert.ok(result.pages.some((page) => !page.glyphMarkerPresent));
    } finally { await app.close(); }
  }
});

test('서로 다른 page marker인데 PNG가 모두 identical이면 all-page proof를 차단한다', async () => {
  const app = await fixture({ helperMode: 'identical' });
  try {
    const result = await renderDocxAllPages('/tmp/input.docx', {
      platform: 'darwin', temporaryRoot: app.root, helperPath: app.helperPath, runCommand: app.runCommand,
    });
    assert.equal(result.state, 'capability_boundary');
    assert.equal(result.reason, 'docx_page_pixels_identical');
  } finally { await app.close(); }
});

test('active HTML과 external URL은 helper 실행 전에 닫힌다', async () => {
  for (const unsafe of ['<script>alert(1)</script>', '<img src="https://example.com/a.png">', '<div style="background:url(file:///tmp/a)">x</div>']) {
    const app = await fixture({ html: threePageHtml(unsafe) });
    try {
      const result = await renderDocxAllPages('/tmp/input.docx', {
        platform: 'darwin', temporaryRoot: app.root, helperPath: app.helperPath, runCommand: app.runCommand,
      });
      assert.equal(result.state, 'capability_boundary');
      assert.equal(result.reason, 'docx_preview_active_content');
    } finally { await app.close(); }
  }
});

test('oversize HTML과 page cap 초과는 bounded failure다', async () => {
  const cases = [
    { html: `<html><body><div class="s1"><p>${'가'.repeat(2 * 1024 * 1024)}</p></div></body></html>`, reason: 'docx_preview_size_limit' },
    { html: `<html><body><div class="s1">${Array.from({ length: 201 }, (_, index) => `<p>쪽${index}</p>${index < 200 ? '<p>\f</p>' : ''}`).join('')}</div></body></html>`, reason: 'docx_preview_page_limit' },
  ];
  for (const item of cases) {
    const app = await fixture({ html: item.html });
    try {
      const result = await renderDocxAllPages('/tmp/input.docx', {
        platform: 'darwin', temporaryRoot: app.root, helperPath: app.helperPath, runCommand: app.runCommand,
      });
      assert.equal(result.state, 'capability_boundary');
      assert.equal(result.reason, item.reason);
    } finally { await app.close(); }
  }
});
