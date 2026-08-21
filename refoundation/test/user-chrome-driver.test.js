import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeUserChromeDriver, parseChromePages } from '../src/user-chrome-driver.js';
import { makeUserChromeMcpRuntime } from '../src/user-chrome-mcp-runtime.js';

const text = (value) => ({ content: [{ type: 'text', text: value }] });

test('Chrome MCP runtime은 명시 연결 뒤에만 실제 사용자 browser tool을 연다', async () => {
  const calls = [];
  let closed = false;
  const runtime = makeUserChromeMcpRuntime({ clientFactory: async () => ({
    async listTools() { return { tools: ['list_pages', 'select_page', 'new_page', 'navigate_page', 'take_snapshot']
      .map((name) => ({ name })) }; },
    async callTool(input) { calls.push(input); return text('0: https://example.com (Example) [selected]'); },
    async close() { closed = true; },
  }) });
  assert.deepEqual(runtime.status(), { connected: false, lastError: null });
  await runtime.connect();
  assert.deepEqual(runtime.status(), { connected: true, lastError: null });
  assert.deepEqual(calls[0], { name: 'list_pages', arguments: {} });
  await runtime.close();
  assert.equal(closed, true);
});

test('사용자가 고른 실제 Chrome tab만 관측·입력하며 닫힌 tab을 다른 tab으로 자동 변경하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-user-chrome-'));
  let pages = [
    { pageId: 0, url: 'https://mail.naver.com/', title: '네이버 메일', selected: true },
    { pageId: 1, url: 'https://blog.naver.com/PostWriteForm.naver', title: '글쓰기', selected: false },
  ];
  let selected = 0;
  const calls = [];
  const runtime = {
    status: () => ({ connected: true }),
    async call(name, args = {}) {
      calls.push({ name, args });
      if (name === 'list_pages') return { structuredContent: { pages } };
      if (name === 'select_page') { selected = args.pageId; return text('selected'); }
      if (name === 'take_snapshot') return text(`RootWebArea "${pages.find((p) => p.pageId === selected)?.title}"\nbutton "보내기" uid=7_1`);
      if (name === 'click') return text('clicked');
      throw new Error(`unexpected ${name}`);
    },
  };
  const driver = makeUserChromeDriver({ runtime, outputDirectory: room });
  await driver.selectTab(1);
  const first = await driver.snapshot();
  assert.equal(first.tab.url, 'https://blog.naver.com/PostWriteForm.naver');
  assert.deepEqual(first.snapshot.refs, { '7_1': { ref: '7_1', role: 'button', name: '보내기' } });
  await driver.click({ ref: '7_1' });
  assert.deepEqual(calls.find((call) => call.name === 'click').args, { uid: '7_1', includeSnapshot: false });

  pages = [{ pageId: 0, url: 'https://mail.naver.com/', title: '네이버 메일', selected: true }];
  await assert.rejects(() => driver.snapshot(), (error) => error.code === 'tab_unavailable');
  assert.equal(selected, 1, '다른 탭을 임의로 이어받지 않는다');
});

test('Chrome page 목록은 사람에게 보여줄 title·URL·selected 사실만 투영한다', () => {
  assert.deepEqual(parseChromePages(text([
    '## Pages',
    '0: https://www.naver.com/ (NAVER)',
    '12: https://blog.naver.com/ (블로그) [selected]',
  ].join('\n'))), [
    { pageId: 0, url: 'https://www.naver.com/', title: 'NAVER', selected: false },
    { pageId: 12, url: 'https://blog.naver.com/', title: '블로그', selected: true },
  ]);
});
