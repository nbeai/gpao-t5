import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const PROFILE = Object.freeze({ id: 'user-chrome', kind: 'existing_user_browser', selected: true });

function textOf(result) {
  return (result?.content ?? []).filter((item) => item?.type === 'text').map((item) => item.text).join('\n');
}

export function parseChromePages(result) {
  const structured = result?.structuredContent?.pages;
  if (Array.isArray(structured)) return structured.map((page) => ({
    pageId: Number(page.id ?? page.pageId),
    url: String(page.url ?? ''), title: String(page.title ?? ''), selected: page.selected === true,
  })).filter((page) => Number.isInteger(page.pageId));
  const pages = [];
  for (const line of textOf(result).split('\n')) {
    const match = line.match(/^\s*(\d+)\s*:\s*(\S+)(?:\s+\(([^)]*)\))?(?:\s+\[selected\])?\s*$/u);
    if (!match) continue;
    pages.push({
      pageId: Number(match[1]), url: match[2], title: match[3] ?? '', selected: /\[selected\]\s*$/u.test(line),
    });
  }
  return pages;
}

function snapshotOf(result) {
  const text = textOf(result);
  const refs = {};
  for (const line of text.split('\n')) {
    const leading = line.match(/uid=([^\s]+)\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s+"([^"]*)")?/u);
    const trailing = leading ? null
      : line.match(/([A-Za-z][A-Za-z0-9_-]*)(?:\s+"([^"]*)")?.*uid=([^\s]+)/u);
    if (!leading && !trailing) continue;
    const ref = leading ? leading[1] : trailing[3];
    const role = leading ? leading[2] : trailing[1];
    const name = leading ? leading[3] : trailing[2];
    refs[ref] = { ref, role: String(role).toLowerCase(), ...(name ? { name } : {}) };
  }
  return { text, totalChars: text.length, truncated: false, refs };
}

function jsonOf(result) {
  const source = textOf(result);
  const candidates = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)].map((match) => match[1].trim());
  candidates.push(source.trim());
  for (const candidate of candidates.reverse()) {
    try { const parsed = JSON.parse(candidate); if (parsed && typeof parsed === 'object') return parsed; }
    catch { /* try the next projection */ }
  }
  throw new Error('user browser returned invalid element facts');
}

async function fileFacts(path) {
  const facts = await stat(path);
  if (!facts.isFile()) throw new Error('browser artifact is not a regular file');
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png' };
}

function browserError(error) {
  const message = String(error?.message ?? '');
  const wrapped = new Error('user_browser_unavailable');
  wrapped.code = /page|target|closed|not found/i.test(message) ? 'tab_unavailable' : 'user_browser_unavailable';
  return wrapped;
}

export function makeUserChromeDriver({ runtime, outputDirectory } = {}) {
  if (!runtime?.call || !runtime?.status) throw new TypeError('user Chrome runtime is required');
  let selectedPageId = null;
  let selectedUrl = null;
  let userControl = false;

  async function pages() { return parseChromePages(await runtime.call('list_pages')); }
  async function select(pageId, bringToFront = false) {
    const id = Number(pageId);
    if (!Number.isInteger(id)) throw new TypeError('user browser page id is required');
    await runtime.call('select_page', { pageId: id, bringToFront });
    const current = (await pages()).find((page) => page.pageId === id);
    if (!current) throw Object.assign(new Error('selected browser tab is unavailable'), { code: 'tab_unavailable' });
    selectedPageId = id; selectedUrl = current.url;
    return current;
  }
  async function ensureSelected() {
    const currentPages = await pages();
    if (selectedPageId != null) {
      const exact = currentPages.find((page) => page.pageId === selectedPageId);
      if (exact) return exact;
      selectedPageId = null;
    }
    if (selectedUrl) {
      const same = currentPages.filter((page) => page.url === selectedUrl);
      if (same.length === 1) return select(same[0].pageId);
    }
    throw Object.assign(new Error('사용할 브라우저 탭을 연결해 주세요.'), { code: 'tab_unavailable' });
  }
  async function observed() {
    const tab = await ensureSelected();
    await runtime.call('select_page', { pageId: tab.pageId, bringToFront: false });
    const snapshot = snapshotOf(await runtime.call('take_snapshot', { verbose: false }));
    return { tab: { tabId: String(tab.pageId), targetId: String(tab.pageId), url: tab.url, title: tab.title }, snapshot };
  }
  async function act(name, args) {
    await ensureSelected();
    try { await runtime.call(name, args); return observed(); }
    catch (error) { throw browserError(error); }
  }

  return {
    profile: PROFILE,
    async available() { return runtime.status().connected
      ? { available: true } : { available: false, reason: 'user_browser_not_connected' }; },
    async status() { return { state: runtime.status().connected ? 'ready' : 'not_connected', profile: PROFILE }; },
    async profiles() { return { profiles: [PROFILE] }; },
    async tabs() { return { tabs: (await pages()).map((page) => ({
      tabId: String(page.pageId), targetId: String(page.pageId), url: page.url, title: page.title,
      selected: page.pageId === selectedPageId,
    })) }; },
    async selectTab(pageId, { bringToFront = true } = {}) { return select(pageId, bringToFront); },
    async navigate(url) {
      if (selectedPageId == null) {
        await runtime.call('new_page', { url, background: false });
        const current = (await pages()).find((page) => page.selected) ?? (await pages()).at(-1);
        if (!current) throw new Error('user browser created no tab');
        await select(current.pageId);
      } else {
        await ensureSelected();
        await runtime.call('navigate_page', { type: 'url', url });
      }
      selectedUrl = url;
      return observed();
    },
    async snapshot() { return observed(); },
    async click({ ref }) { return act('click', { uid: ref, includeSnapshot: false }); },
    async fill({ ref, text }) { return act('fill', { uid: ref, value: text, includeSnapshot: false }); },
    async submit({ ref }) { return act('click', { uid: ref, includeSnapshot: false }); },
    async elementFacts({ ref }) {
      await ensureSelected();
      return jsonOf(await runtime.call('evaluate_script', {
        function: `(el) => ({
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          type: el.getAttribute('type'), autocomplete: el.getAttribute('autocomplete'),
          download: el.getAttribute('download'), tagName: el.tagName.toLowerCase()
        })`,
        args: [ref],
      }));
    },
    async submitFacts({ ref }) {
      const element = await this.elementFacts({ ref });
      const page = jsonOf(await runtime.call('evaluate_script', {
        function: `() => ({
          secretFieldCount: document.querySelectorAll('input[type=password],input[autocomplete=current-password],input[autocomplete=new-password],input[autocomplete=one-time-code],input[autocomplete=cc-number],input[autocomplete=cc-csc]').length,
          fileInputCount: document.querySelectorAll('input[type=file]').length
        })`,
      }));
      return { element, secretFieldCount: Number(page.secretFieldCount), fileInputCount: Number(page.fileInputCount) };
    },
    async upload({ ref, filePath, expectedSha256 }) {
      const file = await fileFacts(filePath);
      if (expectedSha256 && file.sha256 !== expectedSha256) throw new Error('upload file changed before browser action');
      const after = await act('upload_file', { uid: ref, filePath, includeSnapshot: false });
      return { ...after, action: { kind: 'upload', ref }, file, source: { path: filePath } };
    },
    async screenshot({ fullPage = false } = {}) {
      await ensureSelected();
      await mkdir(outputDirectory, { recursive: true });
      const path = join(outputDirectory, `browser-${Date.now()}.png`);
      await runtime.call('take_screenshot', { format: 'png', fullPage, filePath: path });
      return { file: await fileFacts(path), tab: await ensureSelected() };
    },
    async beginUserLogin(url) {
      userControl = true;
      const result = await this.navigate(url);
      await runtime.call('select_page', { pageId: selectedPageId, bringToFront: true });
      return { state: 'user_action_required', visible: true, tab: result.tab, profile: PROFILE,
        handoff: { kind: 'user_browser', active: true } };
    },
    async loginStatus() {
      const result = await observed(); userControl = false;
      return { state: 'observed', ...result, continuityEstablished: true,
        handoff: { kind: 'user_browser', active: false } };
    },
    async revealUserLogin() {
      if (selectedPageId == null) return { visible: false, reason: 'tab_unavailable' };
      await runtime.call('select_page', { pageId: selectedPageId, bringToFront: true });
      return { visible: true, tabId: String(selectedPageId) };
    },
    async cancelUserLogin() { userControl = false; return { cancelled: true }; },
    userControlActive() { return userControl; },
    async close() {},
  };
}
