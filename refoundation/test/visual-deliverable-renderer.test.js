import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeAttachmentTool } from '../src/attachment-hand.js';
import {
  inspectVisualDeliverableSource, renderVisualDeliverable,
} from '../src/visual-deliverable-renderer.js';

async function png() {
  return sharp({ create: { width: 320, height: 180, channels: 4, background: '#ffffff' } })
    .png().toBuffer();
}

function html() {
  return Buffer.from(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff;color:#111;font:20px sans-serif}.page{width:320px;height:180px;padding:20px;box-sizing:border-box}
  </style></head><body><main class="page" data-vd-artboard><h1 data-vd-block>월간 현황</h1><p data-vd-block>매출과 재고를 확인했습니다.</p></main></body></html>`);
}

function dom(overrides = {}) {
  return {
    viewportWidth: 320, viewportHeight: 180, scrollWidth: 320, scrollHeight: 180,
    artboardCount: 1, observedBlockCount: 2, overflowElementCount: 0,
    overlapPairCount: 0, textCharacters: 20, headingCount: 1, tableCount: 0,
    imageCount: 0, imagesMissingAlt: 0, figureCount: 0, figuresMissingCaption: 0,
    contrastFailureCount: 0, contrastUnmeasuredCount: 0, minimumTextSizePx: 20,
    requestedFontFamilies: ['sans-serif'], unavailableFontFamilies: [], ...overrides,
  };
}

test('VD0 source inspection은 HTML 지면과 raw SVG 문단 사고를 구분한다', () => {
  const observed = inspectVisualDeliverableSource(html(), 'report.html');
  assert.equal(observed.sourceKind, 'html');
  assert.equal(observed.artboardDeclarations, 1);
  assert.equal(observed.blockDeclarations, 2);
  assert.deepEqual(observed.defects, []);

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text x="10" y="20">${'긴 문단 '.repeat(40)}</text></svg>`);
  const vector = inspectVisualDeliverableSource(svg, 'diagram.svg');
  assert.ok(vector.defects.includes('svg_paragraph_text'));

  const hostile = inspectVisualDeliverableSource(Buffer.from(
    '<html><body><script>fetch("https://example.com")</script></body></html>',
  ), 'hostile.html');
  assert.ok(hostile.defects.includes('active_content'));
});

test('VD1·2 HTML renderer는 factual DOM·OCR·pixel receipt가 모두 선 뒤 qualified다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-vd-html-'));
  const file = join(room, 'report.html'); const helper = join(room, 'helper');
  await writeFile(file, html()); await writeFile(helper, 'fixture');
  const pixels = await png();
  try {
    const result = await renderVisualDeliverable(file, {
      platform: 'darwin', helperPath: helper, temporaryRoot: room,
      runCommand: async (_command, args) => {
        await writeFile(args[1], pixels);
        return { stdout: JSON.stringify({
          width: 320, height: 180, nonWhitePixels: 100,
          ocrText: '월간 현황 매출과 재고를 확인했습니다.', dom: dom(),
        }) };
      },
    });
    assert.equal(result.state, 'rendered');
    assert.equal(result.receipt.state, 'qualified');
    assert.deepEqual(result.receipt.defects, []);
    assert.equal(result.receipt.source.visibleTextMarkerCount > 0, true);
    assert.equal(result.receipt.render.dom.artboardCount, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('VD2는 overlap·contrast·alt·font 결함을 미적 점수 없이 독립 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-vd-defects-'));
  const file = join(room, 'report.html'); const helper = join(room, 'helper');
  await writeFile(file, html()); await writeFile(helper, 'fixture');
  const pixels = await png();
  try {
    const result = await renderVisualDeliverable(file, {
      platform: 'darwin', helperPath: helper, temporaryRoot: room,
      runCommand: async (_command, args) => {
        await writeFile(args[1], pixels);
        return { stdout: JSON.stringify({
          width: 320, height: 180, nonWhitePixels: 100,
          ocrText: '월간 현황 매출과 재고를 확인했습니다.',
          dom: dom({ overlapPairCount: 1, contrastFailureCount: 1,
            imagesMissingAlt: 1, unavailableFontFamilies: ['Missing Font'] }),
        }) };
      },
    });
    assert.equal(result.receipt.state, 'failed');
    assert.deepEqual(new Set(result.receipt.defects), new Set([
      'declared_block_overlap', 'text_contrast_failure', 'image_alt_missing', 'font_unavailable',
    ]));
    assert.doesNotMatch(JSON.stringify(result.receipt), /beautiful|aestheticScore/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('gradient·투명 배경의 대비는 통과로 꾸미지 않고 unmeasured다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-vd-contrast-'));
  const file = join(room, 'report.html'); const helper = join(room, 'helper');
  await writeFile(file, html()); await writeFile(helper, 'fixture');
  const pixels = await png();
  try {
    const result = await renderVisualDeliverable(file, {
      platform: 'darwin', helperPath: helper, temporaryRoot: room,
      runCommand: async (_command, args) => {
        await writeFile(args[1], pixels);
        return { stdout: JSON.stringify({
          width: 320, height: 180, nonWhitePixels: 100,
          ocrText: '월간 현황 매출과 재고를 확인했습니다.',
          dom: dom({ contrastUnmeasuredCount: 1 }),
        }) };
      },
    });
    assert.equal(result.receipt.state, 'unmeasured');
    assert.ok(result.receipt.unmeasured.includes('text_contrast_on_complex_background'));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('SVG raster 성공은 OCR·접근성을 보지 않았으면 qualified로 꾸미지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-vd-svg-'));
  const file = join(room, 'diagram.svg');
  await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" fill="white"/><text x="10" y="35">확인</text></svg>');
  try {
    const result = await renderVisualDeliverable(file);
    assert.equal(result.state, 'rendered');
    assert.equal(result.receipt.state, 'unmeasured');
    assert.ok(result.receipt.unmeasured.includes('rendered_text_pixels'));
    assert.equal(result.receipt.source.visibleTextMarkerCount, null);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('VD3 기존 attachment inspect는 HTML render pixels와 DesignReceipt를 모델에 함께 공급한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-vd-attachment-'));
  const workspace = join(room, 'workspace'); const file = join(workspace, 'report.html');
  const pixels = await png(); await mkdir(workspace); await writeFile(file, html());
  const store = new AttachmentStore(join(room, 'attachments'));
  const tool = makeAttachmentTool({
    store, sessionId: 'session-vd', workspace, runId: 'run-vd',
    authorizeOutputPath: (candidate) => candidate === file,
    renderVisualPreview: async () => ({
      state: 'rendered', png: pixels,
      receipt: { schema: 't5.visual-design-receipt.v1', state: 'qualified',
        render: { engine: 'fixture' }, defects: [] },
    }),
    observeImagePixels: async () => ({ text: '월간 현황이 화면에 보입니다.', model: 'fixture-vision' }),
  });
  try {
    const result = await tool.execute({
      action: 'inspect', attachmentId: null, filePath: file,
      maxChars: null, maxCells: null, maxPages: null,
      outputName: null, resultRelativePath: null, expectedResultJson: null,
      expectedStdoutIncludes: null, operationHandle: null, outputHandle: null,
    });
    assert.equal(result.state, 'observed');
    assert.equal(result.observation.kind, 'visual_deliverable_render');
    assert.equal(result.observation.designReceipt.state, 'qualified');
    assert.equal(result.observation.pixelsSuppliedToModel, true);
    assert.equal(result._modelAttachments.length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});
