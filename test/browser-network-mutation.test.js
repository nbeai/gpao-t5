import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBrowser, 네트워크요청사실 } from '../src/runtime/browser.js';
import { makeBrowserActTool } from '../src/runtime/browser-tool.js';

test('CH4: 요청 주소는 method와 경로만 남기고 질의값·userinfo를 싣지 않는다', () => {
  assert.deepEqual(네트워크요청사실({
    request: { method: 'post', url: 'https://user:secret@example.com/삭제?token=abc&name=윤#뒤' },
    type: 'Fetch',
  }), {
    method: 'POST', address: 'https://example.com/%EC%82%AD%EC%A0%9C', queryOmitted: true, resourceType: 'Fetch',
  });
  assert.equal(네트워크요청사실({ request: { method: 'GET', url: 'data:text/plain,x' } }), undefined);
});

test('CH4: click 귀속 창의 CDP requestWillBeSent만 행동 결과에 싣는다', async () => {
  let launched = false;
  const listeners = new Set();
  const view = {
    title: '판', url: 'http://127.0.0.1:9999/', text: '충분한 본문 '.repeat(30), textTotal: 210,
    scroll: { y: 0, viewport: 600, total: 600 }, actionable: [], 글자칸: [],
  };
  const conn = {
    ready: Promise.resolve(),
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() {},
    async send(method, params, sessionId) {
      if (method === 'Target.createTarget') return { result: { targetId: 't1' } };
      if (method === 'Target.attachToTarget') return { result: { sessionId: 's1' } };
      if (method !== 'Runtime.evaluate') return { result: {} };
      const expression = String(params.expression ?? '');
      if (expression.includes('el.click()')) {
        for (const fn of listeners) fn({
          method: 'Network.requestWillBeSent', sessionId,
          params: { type: 'Fetch', request: { method: 'POST', url: 'http://127.0.0.1:9999/삭제?token=숨김' } },
        });
        return { result: { result: { value: 'ok' } } };
      }
      if (expression.includes('document.body?.innerText')) return { result: { result: { value: 210 } } };
      return { result: { result: { value: view } } };
    },
  };
  const browser = makeBrowser({
    browserPath: '/fake/chrome', settleMs: 1, maxWaitMs: 5,
    launch() { launched = true; return { kill() {} }; },
    async fetchImpl() {
      if (!launched) throw new Error('빈 포트');
      return { async json() { return { webSocketDebuggerUrl: 'ws://fake' }; } };
    },
    connect: () => conn,
  });
  try {
    const result = await browser.click('e1');
    assert.deepEqual(result.networkRequests, [{
      method: 'POST', address: 'http://127.0.0.1:9999/%EC%82%AD%EC%A0%9C', queryOmitted: true, resourceType: 'Fetch',
    }]);
  } finally { await browser.close(); }
});

test('CH4: browser.act 영수증과 사람 말에 같은 요청 사실이 실린다', async () => {
  const tool = makeBrowserActTool({ browser: {
    profileKind: () => 'isolated',
    async click() {
      return {
        clicked: true, title: '판', url: 'http://127.0.0.1/', text: '본문 '.repeat(80), textTotal: 240,
        scroll: { y: 0, viewport: 600, total: 600 }, actionable: [], 글자칸: [],
        networkRequests: [{ method: 'POST', address: 'http://127.0.0.1/삭제' }],
      };
    },
  } });
  const result = await tool.handler({ action: 'click', ref: 'e5' });
  assert.deepEqual(result.result.observation.networkRequests, [{ method: 'POST', address: 'http://127.0.0.1/삭제' }]);
  assert.match(result.userSafeSummary, /POST http:\/\/127\.0\.0\.1\/삭제/);
});
