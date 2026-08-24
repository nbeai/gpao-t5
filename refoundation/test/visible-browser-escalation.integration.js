import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('일반 뉴스 읽기 실패는 가시 브라우저를 열지 않고 다른 정적 출처로 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-no-visible-browser-news-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });

  const reuters = 'https://www.reuters.com/world/ukraine-russia-war/';
  const ap = 'https://apnews.com/article/ukraine-latest';
  const provider = {
    id: 'fixture', label: 'Fixture Search',
    async available() { return { available: true }; },
    async search() {
      return [
        { title: 'Reuters Ukraine hub', url: reuters, snippet: 'Latest Ukraine updates' },
        { title: 'AP Ukraine report', url: ap, snippet: 'Observed report from today' },
      ];
    },
  };
  let browserNavigations = 0;
  const driver = {
    profile: { id: 'default', kind: 'managed_persistent', selected: true },
    userControlActive: () => false,
    async available() { return { available: true, version: 'fixture' }; },
    async navigate() { browserNavigations += 1; throw new Error('visible browser must not open'); },
    async close() {},
  };
  let turn = 0;
  const server = makeConsoleServer({
    stateDir, workspace, informationControl: 'wide-web-v0',
    webSearchProviders: [provider],
    webReadOptions: {
      resolveHost: async () => ['93.184.216.34'],
      fetchImpl: async (url) => {
        if (url === reuters) return new Response('login', {
          status: 401, headers: { 'content-type': 'text/html; charset=utf-8' },
        });
        return new Response(`<html><head><title>AP Ukraine report</title></head><body><article>
          <h1>Ukraine report</h1><p>${'오늘 확인된 전쟁 관련 최신 보도입니다. '.repeat(20)}</p>
        </article></body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      },
    },
    browserDriverFactory: () => driver,
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      assert.equal(input.tools.some((tool) => tool.name === 'browser'), false);
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'search-news', name: 'web_search', args: {
          query: '오늘 러우 전쟁 관련 최신 뉴스 하나', provider: null, limit: 5, domains: null,
        },
      }] };
      if (turn === 2) return { text: '', toolCalls: [{
        id: 'read-reuters', name: 'web_read', args: {
          url: reuters, maxChars: 5_000, visibleBrowser: 'never',
        },
      }] };
      if (turn === 3) {
        const blocked = JSON.parse(input.messages.at(-1).content).result;
        assert.equal(blocked.state, 'login_required');
        assert.equal(blocked.activatedTools, undefined);
        assert.deepEqual(blocked.visibleBrowser, {
          mode: 'never', activated: false,
          reason: 'visible_browser_not_requested_for_this_user_task',
        });
        return { text: '', toolCalls: [{
          id: 'read-ap', name: 'web_read', args: {
            url: ap, maxChars: 5_000, visibleBrowser: 'never',
          },
        }] };
      }
      const observed = JSON.parse(input.messages.at(-1).content).result;
      assert.equal(observed.state, 'read');
      return { text: 'AP의 읽을 수 있는 최신 보도 하나를 확인했습니다.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '오늘 러우 전쟁 관련 최신 뉴스 하나만 알려줘' }),
    }).then((response) => response.json());
    assert.match(reply.reply, /AP/u);
    assert.equal(browserNavigations, 0);
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    assert.deepEqual(
      run.events.filter((event) => event.type === 'tool_completed')
        .map((event) => event.payload.receipt.actualCall?.name),
      ['web_search', 'web_read', 'web_read'],
    );
  } finally {
    await server.closeBrowsers?.();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
