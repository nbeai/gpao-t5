import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';
import { makeNaverIdentityBroker } from '../src/naver-identity-broker.js';

const nulls = { tabId: null, full: null, maxChars: 5_000, fullPage: null,
  observationId: null, ref: null, editableId: null, modalIntent: null, text: null,
  textFilePath: null, textFileStartLine: null, filePath: null, attachmentId: null, effect: null };

test('기존 Browser observations가 기존 connection 표면의 하나의 Naver identity로 결속된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-naver-identity-console-'));
  const broker = makeNaverIdentityBroker(); let turn = 0;
  const driver = {
    profile: { id: 'default', kind: 'managed_persistent', selected: true },
    userControlActive: () => false, available: async () => ({ available: true }),
    status: async () => ({ state: 'ready' }), profiles: async () => ({ profiles: [driver.profile] }),
    tabs: async () => ({ tabs: [] }), editables: async () => ({ editables: [] }),
    pageSecretFacts: async () => ({ secretFieldCount: 0, secretValuesObserved: false }),
    async navigate(url) {
      const mail = new URL(url).hostname === 'mail.naver.com';
      return { tab: { tabId: mail ? 'mail' : 'blog', targetId: mail ? 'm' : 'b',
        url: mail ? 'https://mail.naver.com/v2/folders/0/all' : 'https://blog.naver.com/' },
      snapshot: { text: mail ? '받은메일함 메일 검색' : '로그아웃 내 블로그 글쓰기', refs: {} } };
    }, close: async () => {},
  };
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    browserHost: { profile: driver.profile }, browserDriverFactory: () => driver,
    workspaceConnectionServices: [broker],
    webReadOptions: { resolveHost: async () => ['223.130.200.107'],
      fetchImpl: async () => new Response('<html><body><div id="root"></div><script>app()</script></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }) },
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'read-mail', name: 'web_read', args: {
        url: 'https://mail.naver.com/', maxChars: 5_000, visibleBrowser: 'user_interaction' } }] };
      if (turn === 2) return { text: '', toolCalls: [{ id: 'browser-mail', name: 'browser', args: {
        action: 'navigate', ...nulls, url: 'https://mail.naver.com/' } }] };
      if (turn === 3) return { text: '', toolCalls: [{ id: 'read-blog', name: 'web_read', args: {
        url: 'https://blog.naver.com/', maxChars: 5_000, visibleBrowser: 'user_interaction' } }] };
      if (turn === 4) return { text: '', toolCalls: [{ id: 'browser-blog', name: 'browser', args: {
        action: 'navigate', ...nulls, url: 'https://blog.naver.com/' } }] };
      if (turn === 5) return { text: '', toolCalls: [{ id: 'identity', name: 'connection', args: {
        action: 'inspect', id: 'naver', actionId: null } }] };
      const receipt = JSON.parse(input.messages.findLast((message) => message.name === 'connection').content);
      assert.equal(receipt.result.connection.state, 'ready');
      assert.deepEqual(receipt.result.connection.capabilities,
        { mail_web: true, blog_web: true, mail_protocol: false });
      return { text: '같은 T5 네이버 로그인으로 메일과 블로그가 준비됐습니다.', toolCalls: [] };
    } }),
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '네이버 메일과 블로그 상태를 확인해줘' }) }).then((response) => response.json());
    assert.match(String(result.reply ?? ''), /메일과 블로그가 준비/u, JSON.stringify(result));
  } finally {
    await server.closeBrowsers(); server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((done) => server.close(done)); await rm(room, { recursive: true, force: true });
  }
});

test('설정의 네이버 로그인 버튼은 managed Browser handoff를 열고 완료 확인 뒤 Mail·Blog를 함께 재관측한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-naver-settings-login-'));
  const broker = makeNaverIdentityBroker({ profileHandle: null }); let handoff = false; let loggedIn = false;
  const driver = {
    profile: { id: 'managed-profile', kind: 'managed_persistent', selected: true },
    async beginUserLogin(url) { handoff = true; return { state: 'user_control_required',
      profile: this.profile, tab: { url }, handoff: { visible: true, inputOwner: 'user' } }; },
    async loginStatus() { assert.equal(handoff, true); handoff = false; loggedIn = true;
      return { state: 'handoff_complete_candidate', profile: this.profile, tab: { url: 'https://www.naver.com/' } }; },
    async navigate(url) { const mail = new URL(url).hostname === 'mail.naver.com';
      if (!loggedIn) return { tab: { url: 'https://nid.naver.com/nidlogin.login' },
        snapshot: { text: 'NAVER 로그인' } };
      return {
      tab: { url: mail ? 'https://mail.naver.com/v2/folders/0/all' : 'https://blog.naver.com/' },
      snapshot: { text: mail ? '받은메일함 메일 검색' : '로그아웃 내 블로그 글쓰기' },
    }; }, async close() {},
  };
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    browserDriverFactory: () => driver, workspaceConnectionServices: [broker],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond() { return { text: 'fixture', toolCalls: [] }; } }),
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = await fetch(`${base}/connections/doctor`).then((response) => response.json());
    const naver = before.connections.find((item) => item.id === 'naver');
    assert.equal(naver.actions[0].label, '네이버 로그인'); assert.equal('credentialRequest' in naver, false);
    const started = await fetch(`${base}/connections/naver/action`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actionId: 'login' }) });
    assert.equal(started.status, 200); assert.equal((await started.json()).refreshConnections, true);
    const during = await fetch(`${base}/connections/doctor`).then((response) => response.json());
    assert.equal(during.connections.find((item) => item.id === 'naver').actions[0].label, '로그인 완료 확인');
    const checked = await fetch(`${base}/connections/naver/action`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actionId: 'check-login' }) });
    assert.equal(checked.status, 200); assert.equal((await checked.json()).performed, true);
    const after = await fetch(`${base}/connections/doctor`).then((response) => response.json());
    const ready = after.connections.find((item) => item.id === 'naver');
    assert.equal(ready.state, 'ready'); assert.equal(ready.capabilities.mail_web, true);
    assert.equal(ready.capabilities.blog_web, true); assert.equal(ready.actions.length, 0);
  } finally {
    await server.closeBrowsers(); server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((done) => server.close(done)); await rm(room, { recursive: true, force: true });
  }
});

test('ready Naver connection은 compact Naver adapter를 개통해 Mail 목록을 한 호출로 모델에 준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-naver-adapter-console-'));
  const broker = makeNaverIdentityBroker({ profileHandle: 'managed-profile' });
  const readyObservation = (url, text) => ({ state: 'observed', profile: { id: 'managed-profile' },
    tab: { url }, observation: { text } });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: readyObservation('https://mail.naver.com/v2/folders/0/all', '받은메일함') });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://blog.naver.com/' },
    result: readyObservation('https://section.blog.naver.com/BlogHome.naver', '로그아웃 내 블로그 글쓰기') });
  const mailText = [
    '- checkbox "보낸 사람네이버오전 03:1923.0KB메일 제목새로운 기기에서 로그인 되었습니다." [ref=e20]',
    '  - button "읽은 메일" [ref=e21]', '  - button "보낸 사람 네이버" [ref=e22]',
    '  - link "메일 제목 새로운 기기에서 로그인 되었습니다." [ref=e23]',
    '  - button "메일 본문 미리보기 열기" [ref=e24]',
  ].join('\n');
  const driver = {
    profile: { id: 'managed-profile', kind: 'managed_persistent', selected: true },
    userControlActive: () => false, available: async () => ({ available: true }),
    async navigate(url) { return { tab: { tabId: 'mail', targetId: 'target', url },
      snapshot: { text: mailText, refs: {}, totalChars: mailText.length, truncated: false } }; },
    async editables() { return { editables: [] }; },
    async pageSecretFacts() { return { secretFieldCount: 0, secretValuesObserved: false }; },
    async close() {},
  };
  let turn = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    browserDriverFactory: () => driver, workspaceConnectionServices: [broker],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'connection', name: 'connection',
        args: { action: 'inspect', id: 'naver', actionId: null } }] };
      if (turn === 2) { assert.ok(input.tools.some((tool) => tool.name === 'naver'));
        return { text: '', toolCalls: [{ id: 'mail-list', name: 'naver', args: {
          action: 'mail_list', query: null, messageHandle: null, attachmentHandle: null,
          draftHandle: null, recipients: null, subject: null, body: null, attachmentIds: null,
          limit: 3, effect: { kind: 'observe', targets: ['https://mail.naver.com/'],
            confirmation: 'not_applicable', rollbackOfToolCallId: null },
        } }] }; }
      const receipt = JSON.parse(input.messages.findLast((message) => message.name === 'naver').content);
      assert.equal(receipt.result.messages[0].sender, '네이버');
      assert.equal('observation' in receipt.result, false);
      return { text: '새로운 기기에서 로그인 되었습니다. — 네이버 — 오전 03:19', toolCalls: [] };
    } }),
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '최근 네이버 메일을 확인해줘' }) }).then((response) => response.json());
    assert.match(String(result.reply ?? ''), /새로운 기기/u, JSON.stringify(result)); assert.equal(turn, 3);
  } finally {
    await server.closeBrowsers(); server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((done) => server.close(done)); await rm(room, { recursive: true, force: true });
  }
});
