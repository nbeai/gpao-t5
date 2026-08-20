import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_AGENT_BROWSER_BINARY, makeAgentBrowserDriver,
} from '../src/agent-browser-driver.js';
import { makePersistentBrowserHost } from '../src/persistent-browser-host.js';

async function fixture() {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/login') {
      res.setHeader('set-cookie', 't5_login=kept; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax');
      res.end('<h1>LOGIN SAVED</h1>');
      return;
    }
    res.end(req.headers.cookie?.includes('t5_login=kept')
      ? '<h1>AUTHENTICATED</h1>' : '<h1>LOGIN REQUIRED</h1>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function host(root, namespace) {
  return makePersistentBrowserHost({
    root, namespace, binary: DEFAULT_AGENT_BROWSER_BINARY, headed: false,
    activateWindow: async () => ({ visible: false, application: null }),
  });
}

async function crashBrowser(cdpUrl) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(cdpUrl);
    let commanded = false;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('browser crash command timed out')), 5_000);
    socket.addEventListener('open', () => {
      commanded = true;
      socket.send(JSON.stringify({ id: 1, method: 'Browser.crash' }));
    }, { once: true });
    socket.addEventListener('close', () => finish(resolve), { once: true });
    socket.addEventListener('error', (error) => finish(commanded ? resolve : reject, error), { once: true });
  });
}

test('한 번 만든 로그인은 다른 T5 대화와 브라우저 호스트 재시작 뒤에도 유지된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-persistent-browser-live-'));
  const site = await fixture();
  const namespace = `t5-persistent-test-${process.pid}-${Date.now()}`;
  let firstHost = host(room, namespace);
  let secondHost = null;
  let thirdHost = null;
  let firstDriver = null;
  let parallelDriver = null;
  let secondDriver = null;
  let thirdDriver = null;
  try {
    firstDriver = makeAgentBrowserDriver({
      ownerId: 'conversation-a', outputDirectory: join(room, 'a', 'artifacts'),
      browserHost: firstHost,
    });
    const loggedIn = await firstDriver.navigate(`${site.base}/login`);
    assert.match(loggedIn.snapshot.text, /LOGIN SAVED/u);
    parallelDriver = makeAgentBrowserDriver({
      ownerId: 'conversation-parallel', outputDirectory: join(room, 'parallel', 'artifacts'),
      browserHost: firstHost,
    });
    const parallel = await parallelDriver.navigate(`${site.base}/check`);
    assert.match(parallel.snapshot.text, /AUTHENTICATED/u);
    assert.notEqual(parallel.tab.targetId, loggedIn.tab.targetId, '대화별 탭은 서로 달라야 한다');
    await parallelDriver.close();
    await firstDriver.close();
    await firstHost.close();

    secondHost = host(room, namespace);
    secondDriver = makeAgentBrowserDriver({
      ownerId: 'conversation-b', outputDirectory: join(room, 'b', 'artifacts'),
      browserHost: secondHost,
    });
    const restored = await secondDriver.navigate(`${site.base}/check`);
    assert.match(restored.snapshot.text, /AUTHENTICATED/u);
    assert.doesNotMatch(restored.snapshot.text, /LOGIN REQUIRED/u);

    const { cdpUrl } = await secondHost.connection();
    await crashBrowser(cdpUrl);
    secondHost.invalidate();
    await secondDriver.close().catch(() => {});
    thirdHost = host(room, namespace);
    thirdDriver = makeAgentBrowserDriver({
      ownerId: 'conversation-c', outputDirectory: join(room, 'c', 'artifacts'),
      browserHost: thirdHost,
    });
    const afterCrash = await thirdDriver.navigate(`${site.base}/check`);
    assert.match(afterCrash.snapshot.text, /AUTHENTICATED/u);
  } finally {
    await thirdDriver?.close().catch(() => {});
    await parallelDriver?.close().catch(() => {});
    await secondDriver?.close().catch(() => {});
    await firstDriver?.close().catch(() => {});
    await thirdHost?.close().catch(() => {});
    await secondHost?.close().catch(() => {});
    await firstHost?.close().catch(() => {});
    await site.close();
    await rm(room, { recursive: true, force: true });
  }
});
