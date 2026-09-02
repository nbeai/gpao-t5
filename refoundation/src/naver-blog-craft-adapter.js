import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

function digest(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function exact(value, label, max = 500) { const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new TypeError(`${label} is invalid`); return text; }
async function targetId(context, page) { const session = await context.newCDPSession(page);
  try { return (await session.send('Target.getTargetInfo')).targetInfo?.targetId ?? null; }
  finally { await session.detach(); } }

const selectScript = (body, { text, occurrence }) => {
  const roots = [...body.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"]')];
  const matches = [];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node; while ((node = walker.nextNode())) {
      let start = 0; const value = String(node.nodeValue || '');
      while (true) { const index = value.indexOf(text, start); if (index < 0) break;
        matches.push({ node, index }); start = index + Math.max(1, text.length); }
    }
  }
  const match = matches[occurrence]; if (!match) return null;
  const range = document.createRange(); range.setStart(match.node, match.index);
  range.setEnd(match.node, match.index + text.length);
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const element = match.node.parentElement; const style = getComputedStyle(element);
  return { tag: element.tagName.toLowerCase(), fontWeight: style.fontWeight,
    fontSize: style.fontSize, color: style.color, lineHeight: style.lineHeight,
    marginBottom: style.marginBottom, text: range.toString() };
};

export function makeNaverBlogCraftAdapter({ browserHost, chromiumImpl = chromium } = {}) {
  if (!browserHost?.connection) throw new TypeError('Naver Blog craft requires the managed Browser host');
  let browser = null; let context = null;
  async function connected() {
    if (browser?.isConnected?.() && context) return { browser, context };
    const { cdpUrl } = await browserHost.connection();
    browser = await chromiumImpl.connectOverCDP(cdpUrl, { isLocal: true, noDefaults: true, timeout: 30_000 });
    context = browser.contexts()[0]; browser.once?.('disconnected', () => { browser = null; context = null; });
    return { browser, context };
  }
  async function pageFor(id) { const current = await connected();
    for (const page of current.context.pages()) if (await targetId(current.context, page) === id) return page;
    throw new Error('Naver Blog exact editor target is unavailable'); }
  async function frameWithSelection(page, text, occurrence) {
    for (const frame of page.frames()) {
      const selected = await frame.locator('body').evaluate(selectScript, { text, occurrence }).catch(() => null);
      if (selected) return { frame, selected };
    }
    throw new Error('Naver Blog exact text occurrence is unavailable');
  }
  async function clickControl(frame, pattern, value = null) {
    const control = frame.getByRole('button', { name: pattern }).first();
    if (!await control.isVisible()) throw new Error('Naver Blog format control is unavailable');
    await control.click({ timeout: 5_000 });
    if (value) {
      const option = frame.getByText(value, { exact: true }).first();
      if (!await option.isVisible()) throw new Error('Naver Blog format option is unavailable');
      await option.click({ timeout: 5_000 });
    }
  }
  return {
    async applyFormat({ targetId: id, targetText, occurrence = 0, kind, value = null } = {}) {
      const text = exact(targetText, 'format target text', 2_000); const page = await pageFor(exact(id, 'target id', 200));
      const before = await frameWithSelection(page, text, Number(occurrence)); const frame = before.frame;
      const controls = { bold: /굵게|bold/iu, heading: /제목|소제목|heading/iu,
        color: /글자색|색상|color/iu, font_size: /글자 크기|폰트 크기|font size/iu,
        spacing: /줄 간격|문단 간격|line spacing|paragraph spacing/iu,
        divider: /구분선|divider/iu };
      if (!controls[kind]) throw new TypeError('unsupported Naver Blog format');
      const dividerBefore = kind === 'divider' ? await frame.locator('hr, .se-horizontal-line, [data-type="horizontal-line"]').count() : null;
      await clickControl(frame, controls[kind], ['color', 'font_size', 'heading', 'spacing'].includes(kind)
        && value ? exact(value, 'format value', 100) : null);
      await page.waitForTimeout(100);
      const after = kind === 'divider' ? { dividerCount: await frame.locator(
        'hr, .se-horizontal-line, [data-type="horizontal-line"]',
      ).count() } : (await frameWithSelection(page, text, Number(occurrence))).selected;
      let verified = false;
      if (kind === 'divider') verified = after.dividerCount > dividerBefore;
      else if (kind === 'bold') verified = Number.parseInt(after.fontWeight, 10) >= 600 || /bold/iu.test(after.fontWeight);
      else if (kind === 'heading') verified = /^h[1-6]$/u.test(after.tag) || before.selected.tag !== after.tag;
      else if (kind === 'color') verified = before.selected.color !== after.color;
      else if (kind === 'font_size') verified = before.selected.fontSize !== after.fontSize;
      else if (kind === 'spacing') verified = before.selected.lineHeight !== after.lineHeight
        || before.selected.marginBottom !== after.marginBottom;
      return { state: verified ? 'verified' : 'unverified', kind, targetDigest: digest(text), occurrence,
        before: before.selected, after };
    },
    async insertImages({ targetId: id, files = [], captions = [] } = {}) {
      if (!Array.isArray(files) || !files.length || files.length > 20) throw new TypeError('Blog images are required');
      const page = await pageFor(exact(id, 'target id', 200)); let input = null; let frame = null;
      for (const candidate of page.frames()) { const locator = candidate.locator('input[type="file"]');
        if (await locator.count()) { input = locator.first(); frame = candidate; break; } }
      if (!input) throw new Error('Naver Blog image input is unavailable');
      const before = await frame.locator('img').count(); await input.setInputFiles(files, { timeout: 10_000 });
      await page.waitForTimeout(250); const after = await frame.locator('img').count();
      const captionFields = frame.locator('figcaption, [contenteditable="true"][aria-label*="캡션"], [data-placeholder*="캡션"]');
      const count = Math.min(await captionFields.count(), captions.length);
      for (let index = 0; index < count; index += 1) await captionFields.nth(index).fill(String(captions[index] ?? ''));
      return { state: after - before >= files.length ? 'verified' : 'partial', files: files.length,
        imagesBefore: before, imagesAfter: after, captionsRequested: captions.length, captionsApplied: count };
    },
    async preview({ targetId: id } = {}) {
      const page = await pageFor(exact(id, 'target id', 200)); const beforePages = context.pages();
      let button = null;
      for (const frame of page.frames()) { const candidate = frame.getByRole('button', { name: /미리보기|Preview/iu }).first();
        if (await candidate.isVisible().catch(() => false)) { button = candidate; break; } }
      if (!button) throw new Error('Naver Blog preview control is unavailable');
      await button.click({ timeout: 5_000 }); await page.waitForTimeout(250);
      const afterPages = context.pages(); const preview = afterPages.find((candidate) => !beforePages.includes(candidate)) ?? page;
      const text = await preview.locator('body').innerText().catch(() => '');
      return { state: text.trim() ? 'observed' : 'unknown', url: preview.url(), title: await preview.title(),
        textChars: text.length, textDigest: digest(text) };
    },
    async close() { await browser?.close?.().catch(() => {}); browser = null; context = null; },
  };
}
