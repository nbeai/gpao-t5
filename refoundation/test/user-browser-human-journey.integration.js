import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

const nulls = {
  url: null, tabId: null, full: null, maxChars: 20_000, fullPage: null,
  observationId: null, ref: null, text: null, filePath: null, effect: null,
};

test('사람 말로 네이버 업무를 부탁하면 연결한 Chrome에서 한 번 관측하고 전용 browser·terminal 우회 없이 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-user-browser-human-'));
  const calls = [];
  const driver = {
    profile: { id: 'user-chrome', kind: 'existing_user_browser', selected: true },
    async available() { return { available: true }; },
    async navigate(url) {
      calls.push({ action: 'navigate', url });
      return {
        tab: { tabId: '12', targetId: '12', title: '내 블로그 글쓰기', url },
        snapshot: {
          text: 'RootWebArea "내 블로그 글쓰기"\ntextbox "제목" uid=title\ntextbox "본문" uid=body',
          refs: { title: { role: 'textbox', name: '제목' }, body: { role: 'textbox', name: '본문' } },
        },
      };
    },
    async status() { return { state: 'ready' }; },
    async profiles() { return { profiles: [this.profile] }; },
    async tabs() { return { tabs: [] }; },
    userControlActive() { return false; },
    async close() {},
  };
  let turn = 0;
  const server = makeConsoleServer({
    stateDir: room, workspace: room,
    browserHost: { profile: driver.profile, status: () => ({ connected: true }) },
    browserDriverFactory: () => driver,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      assert.ok(input.tools.find((tool) => tool.name === 'browser'));
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'naver-blog', name: 'browser', args: {
          ...nulls, action: 'navigate', url: 'https://blog.naver.com/PostWriteForm.naver',
        },
      }] };
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.requestedCall.name, 'browser');
      assert.equal(receipt.result.tab.title, '내 블로그 글쓰기');
      return { text: '내 Chrome에서 로그인된 네이버 블로그 글쓰기 화면을 확인했어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const answer = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '네이버 블로그에 들어가서 글쓰기 화면이 보이는지 확인해줘.' }),
    }).then((response) => response.json());
    assert.match(answer.reply, /내 Chrome.*로그인된 네이버 블로그/u);
    assert.deepEqual(calls, [{ action: 'navigate', url: 'https://blog.naver.com/PostWriteForm.naver' }]);
    const run = await fetch(`${base}/runs/${answer.runId}`).then((response) => response.json());
    const tools = run.events.filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload.receipt.actualCall?.name).filter(Boolean);
    assert.deepEqual(tools, ['browser']);
  } finally {
    await server.closeBrowsers(); await server.closeMessengers();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
