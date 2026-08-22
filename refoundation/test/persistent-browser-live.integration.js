import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_AGENT_BROWSER_BINARY, makeAgentBrowserDriver,
} from '../src/agent-browser-driver.js';
import { makeBrowserObservationTool } from '../src/browser-observation-tool.js';
import {
  makePersistentBrowserHost, managedBrowserProcessForProfile,
} from '../src/persistent-browser-host.js';
import { makeManagedPlaywrightEditorProvider } from '../src/managed-playwright-editor.js';

async function fixture() {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/editor') {
      res.end(`<!doctype html><meta charset="utf-8"><title>EDITOR</title>
        <main>
          <div class="post-title" contenteditable="true" data-placeholder="제목"></div>
          <div class="post-body" contenteditable="true" data-placeholder="본문"></div>
          <button type="button">발행</button>
        </main>`);
      return;
    }
    if (req.url === '/provider-editor') {
      res.end(`<!doctype html><meta charset="utf-8"><title>PROVIDER EDITOR</title>
        <iframe src="/provider-frame" style="width:800px;height:500px"></iframe>`);
      return;
    }
    if (req.url === '/modal') {
      res.end('<div role="dialog" aria-label="기존 작업"><p>기존 내용을 버릴까요?</p><button>계속</button></div>');
      return;
    }
    if (req.url === '/roleless-modal') {
      res.end(`<!doctype html><meta charset="utf-8"><title>ROLELESS MODAL</title>
        <button type="button">계속</button>
        <div style="position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.4);display:grid;place-items:center">
          <div style="width:420px;min-height:180px;background:white;padding:24px">
            <h2>작성 중인 항목이 있습니다.</h2><p>이어서 처리하시겠습니까?</p>
            <button type="button">취소</button><button type="button">계속</button>
          </div>
        </div>`);
      return;
    }
    if (req.url === '/provider-frame') {
      res.end(`<!doctype html><meta charset="utf-8"><article>
        <section class="title"><p>이전 제목</p></section>
        <section class="body"><p>이전 본문</p></section>
      </article><div aria-hidden="true" contenteditable="true" style="position:fixed;left:-9999px;width:100px;height:20px"></div>
      <button type="button">발행</button><script>
        document.querySelectorAll('article p').forEach((item) => item.addEventListener('click', () => {
          item.contentEditable = 'true'; item.focus();
        }));
      </script>`);
      return;
    }
    if (req.url === '/login') {
      res.setHeader('set-cookie', 't5_login=kept; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax');
      res.end('<h1>LOGIN SAVED</h1>');
      return;
    }
    if (req.url === '/login-session') {
      res.setHeader('set-cookie', 't5_login=kept; Path=/; HttpOnly; SameSite=Lax');
      res.end('<h1>SESSION LOGIN SAVED</h1>');
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

async function openApplication(name) {
  await new Promise((resolveOpen, reject) => {
    execFile('/usr/bin/open', ['-a', name], (error) => (error ? reject(error) : resolveOpen()));
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

test('제품의 공유 managed profile은 대화를 바꾸고 T5 runtime을 다시 열어도 로그인을 유지한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-shared-browser-restart-live-'));
  const site = await fixture();
  const namespace = `t5-product-shared-${process.pid}-${Date.now()}`;
  let firstHost = host(room, namespace);
  let secondHost = null;
  let first = null;
  let other = null;
  let restored = null;
  try {
    first = makeAgentBrowserDriver({
      ownerId: 'conversation-a', clientInstanceId: 'runtime-one',
      outputDirectory: join(room, 'a', 'artifacts'), browserHost: firstHost,
    });
    assert.match((await first.navigate(`${site.base}/login`)).snapshot.text, /LOGIN SAVED/u);

    other = makeAgentBrowserDriver({
      ownerId: 'conversation-b', clientInstanceId: 'runtime-one',
      outputDirectory: join(room, 'b', 'artifacts'), browserHost: firstHost,
    });
    assert.match((await other.navigate(`${site.base}/check`)).snapshot.text, /AUTHENTICATED/u);
    await other.close();
    await first.close();
    await firstHost.close();

    secondHost = host(room, namespace);
    restored = makeAgentBrowserDriver({
      ownerId: 'conversation-a', clientInstanceId: 'runtime-two',
      outputDirectory: join(room, 'restored', 'artifacts'), browserHost: secondHost,
    });
    const afterRestart = await restored.navigate(`${site.base}/check`);
    assert.match(afterRestart.snapshot.text, /AUTHENTICATED/u);
    assert.doesNotMatch(afterRestart.snapshot.text, /LOGIN REQUIRED/u);
  } finally {
    await restored?.close().catch(() => {});
    await other?.close().catch(() => {});
    await first?.close().catch(() => {});
    await secondHost?.close().catch(() => {});
    await firstHost?.close().catch(() => {});
    await site.close();
    await rm(room, { recursive: true, force: true });
  }
});

test('브라우저 종료형 runtime 재시작도 session cookie 로그인을 복원한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-cookie-restart-live-'));
  const site = await fixture();
  const namespace = `t5-session-cookie-${process.pid}-${Date.now()}`;
  let firstHost = host(room, namespace);
  let secondHost = null;
  let first = null;
  let restored = null;
  try {
    first = makeAgentBrowserDriver({
      ownerId: 'session-cookie', clientInstanceId: 'runtime-one',
      outputDirectory: join(room, 'first', 'artifacts'), browserHost: firstHost,
    });
    assert.match((await first.navigate(`${site.base}/login-session`)).snapshot.text, /SESSION LOGIN SAVED/u);
    await first.close();
    await firstHost.close();

    secondHost = host(room, namespace);
    restored = makeAgentBrowserDriver({
      ownerId: 'session-cookie', clientInstanceId: 'runtime-two',
      outputDirectory: join(room, 'restored', 'artifacts'), browserHost: secondHost,
    });
    const afterRestart = await restored.navigate(`${site.base}/check`);
    assert.match(afterRestart.snapshot.text, /AUTHENTICATED/u);
    assert.doesNotMatch(afterRestart.snapshot.text, /LOGIN REQUIRED/u);
  } finally {
    await restored?.close().catch(() => {});
    await first?.close().catch(() => {});
    await secondHost?.close().catch(() => {});
    await firstHost?.close().catch(() => {});
    await site.close();
    await rm(room, { recursive: true, force: true });
  }
});

test('Browser snapshot ref는 dialog 조상 맥락을 modal action target에 결속한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-modal-context-live-'));
  const site = await fixture();
  const browserHost = host(room, `t5-modal-context-${process.pid}-${Date.now()}`);
  const driver = makeAgentBrowserDriver({
    ownerId: 'modal-context', outputDirectory: join(room, 'artifacts'), browserHost,
    editorProvider: makeManagedPlaywrightEditorProvider({ browserHost }),
  });
  try {
    const opened = await driver.navigate(`${site.base}/modal`);
    const button = Object.values(opened.snapshot.refs).find((item) => item.role === 'button');
    assert.equal(button.context.modal, true, opened.snapshot.text);
    assert.deepEqual(button.context.ancestors.map((item) => item.role), ['dialog']);
    assert.match(button.context.modalId, /^[0-9a-f]{64}$/u);
    assert.match(button.context.frameId, /^[0-9a-f]{64}$/u);
  } finally {
    await driver.close().catch(() => {});
    await browserHost.close().catch(() => {});
    await site.close();
    await rm(room, { recursive: true, force: true });
  }
});

test('역할 없는 overlay modal도 동명 외부 버튼과 구분해 exact control ref에 결속한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-roleless-modal-live-'));
  const site = await fixture();
  const browserHost = host(room, `t5-roleless-modal-${process.pid}-${Date.now()}`);
  const driver = makeAgentBrowserDriver({
    ownerId: 'roleless-modal', outputDirectory: join(room, 'artifacts'), browserHost,
    editorProvider: makeManagedPlaywrightEditorProvider({ browserHost }),
  });
  try {
    const opened = await driver.navigate(`${site.base}/roleless-modal`);
    const continues = Object.values(opened.snapshot.refs)
      .filter((item) => item.role === 'button' && item.name === '계속');
    assert.equal(continues.length, 2, opened.snapshot.text);
    assert.equal(continues.filter((item) => item.context?.modal === true).length, 1);
    const inside = continues.find((item) => item.context?.modal === true);
    const outside = continues.find((item) => item.context?.modal !== true);
    assert.match(inside.context.modalId, /^[0-9a-f]{64}$/u);
    assert.match(inside.context.controlId, /^[0-9a-f]{64}$/u);
    assert.equal(outside.context?.modal, false);
  } finally {
    await driver.close().catch(() => {});
    await browserHost.close().catch(() => {});
    await site.close();
    await rm(room, { recursive: true, force: true });
  }
});

test('이미 열린 T5 관리 브라우저는 다른 앱 뒤에 있어도 세 번 연속 정확한 창을 앞으로 가져온다', {
  skip: process.platform !== 'darwin',
}, async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-activation-live-'));
  const browserHost = makePersistentBrowserHost({
    root: room, namespace: `t5-activation-${process.pid}-${Date.now()}`,
    binary: DEFAULT_AGENT_BROWSER_BINARY,
  });
  try {
    await browserHost.connection();
    let processId = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await openApplication('Finder');
      const activation = await browserHost.activate();
      assert.equal(activation.visible, true, `activation ${attempt + 1} must become visible`);
      assert.equal(activation.application, 'Google Chrome');
      assert.ok(Number.isInteger(activation.processId));
      processId ??= activation.processId;
      assert.equal(activation.processId, processId, '같은 관리 브라우저 창을 다시 앞으로 가져와야 한다');
    }
    await browserHost.close();
    assert.equal(await managedBrowserProcessForProfile(browserHost.profileDirectory), null,
      '반복검사 뒤 관리 Chrome 프로세스가 남으면 안 된다');
  } finally {
    await browserHost.close().catch(() => {});
    await rm(room, { recursive: true, force: true });
  }
});

test('Browser Hand는 ref 없는 실제 contenteditable 제목·본문을 관측해 입력하고 재확인한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-editable-live-'));
  const site = await fixture();
  const browserHost = host(room, `t5-editable-${process.pid}-${Date.now()}`);
  const driver = makeAgentBrowserDriver({
    ownerId: 'editor-conversation', clientInstanceId: 'editor-runtime',
    outputDirectory: join(room, 'artifacts'), browserHost,
  });
  const tool = makeBrowserObservationTool({ driver, authorizeEffect: async () => ({ allowed: true }) });
  const common = {
    url: null, tabId: null, full: null, maxChars: 5000, fullPage: null,
    observationId: null, ref: null, editableId: null, text: null, filePath: null, effect: null,
  };
  try {
    const opened = await tool.execute({ ...common, action: 'navigate', url: `${site.base}/editor` });
    const observed = opened;
    assert.deepEqual(observed.observation.editables.map((item) => item.kind), ['title', 'body']);
    const declared = {
      kind: 'external_send', summary: '웹 초안 입력', targets: [`${site.base}/editor`],
      reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
    };
    const title = await tool.execute({
      ...common, action: 'fill_editable', tabId: opened.tab.tabId,
      observationId: observed.observation.observationId,
      editableId: observed.observation.editables[0].editableId, text: '티파이브 소개', effect: declared,
    });
    const bodyFact = title.after.editables.find((item) => item.kind === 'body');
    const body = await tool.execute({
      ...common, action: 'fill_editable', tabId: opened.tab.tabId,
      observationId: title.after.observationId, editableId: bodyFact.editableId,
      text: '사용자의 목적을 실제 결과로 이어주는 개인 조력자입니다.', effect: declared,
    });
    assert.equal(body.action.textChars, 31);
    assert.equal(body.after.editables.find((item) => item.kind === 'title').textChars, 7);
    assert.equal(body.after.editables.find((item) => item.kind === 'body').textChars, 31);
    assert.match(body.after.text, /발행/u);
  } finally {
    await driver.close().catch(() => {});
    await browserHost.close().catch(() => {});
    await site.close();
    await rm(room, { recursive: true, force: true });
  }
});

test('단일 Browser Hand는 managed Playwright provider로 iframe editor를 엄격히 결속해 입력한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-managed-playwright-editor-live-'));
  const site = await fixture();
  const browserHost = host(room, `t5-managed-playwright-${process.pid}-${Date.now()}`);
  const driver = makeAgentBrowserDriver({
    ownerId: 'provider-conversation', clientInstanceId: 'provider-runtime',
    outputDirectory: join(room, 'artifacts'), browserHost,
    editorProvider: makeManagedPlaywrightEditorProvider({ browserHost }),
  });
  const tool = makeBrowserObservationTool({ driver, authorizeEffect: async () => ({ allowed: true }) });
  const common = {
    url: null, tabId: null, full: null, maxChars: 5000, fullPage: null,
    observationId: null, ref: null, editableId: null, text: null, filePath: null, effect: null,
  };
  try {
    const opened = await tool.execute({ ...common, action: 'navigate', url: `${site.base}/provider-editor` });
    const observed = opened;
    assert.equal(observed.observation.editables.length, 2);
    assert.deepEqual(observed.observation.editables.map((item) => item.textPreview), ['이전 제목', '이전 본문']);
    assert.ok(observed.observation.editables.every((item) => item.provider === 'managed_playwright'));
    const declared = {
      kind: 'external_send', summary: 'provider editor 입력', targets: [`${site.base}/provider-editor`],
      reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
    };
    const title = await tool.execute({
      ...common, action: 'fill_editable', tabId: opened.tab.tabId,
      observationId: observed.observation.observationId,
      editableId: observed.observation.editables[0].editableId, text: '새 제목', effect: declared,
    });
    assert.equal(title.editorProvider.provider, 'managed_playwright');
    assert.equal(title.editorProvider.contentMatched, true);
    const bodyFact = title.after.editables.find((item) => item.textPreview === '이전 본문');
    const body = await tool.execute({
      ...common, action: 'fill_editable', tabId: opened.tab.tabId,
      observationId: title.after.observationId, editableId: bodyFact.editableId,
      text: '첫 문단\n\n둘째 문단', effect: declared,
    });
    assert.equal(body.editorProvider.contentMatched, true);
    assert.match(body.after.editables.find((item) => item.editableId === bodyFact.editableId).textPreview, /첫 문단/u);
  } finally {
    await driver.close().catch(() => {});
    await browserHost.close().catch(() => {});
    await site.close();
    await rm(room, { recursive: true, force: true });
  }
});
