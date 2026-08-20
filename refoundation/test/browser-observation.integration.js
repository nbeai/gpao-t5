import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { sessionNameForOwner } from '../src/agent-browser-driver.js';

test('실제 콘솔 모델이 browser navigate의 렌더링 snapshot을 읽고 같은 Run에 Receipt를 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-observe-console-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let modelTurn = 0;
  const driver = {
    profile: { id: 'default', kind: 'managed_persistent', selected: true },
    async available() { return { available: true, version: '0.34.0' }; },
    async navigate(url) { return {
      tab: { tabId: 't1', targetId: 'target-1', title: '동적 사업주 화면', url },
      snapshot: { text: '- heading "사업을 더 쉽게" [ref=e1]\n- text "예약과 주문을 관리하세요"', refs: { e1: { role: 'heading', name: '사업을 더 쉽게' } }, totalChars: 52, truncated: false },
    }; },
    async status() { return { state: 'ready' }; },
    async profiles() { return { profiles: [this.profile] }; },
    async tabs() { return { tabs: [] }; },
    async snapshot() { throw new Error('not used'); },
    async screenshot() { throw new Error('not used'); },
    async close() {},
  };
  const server = makeConsoleServer({
    stateDir, workspace, browserDriverFactory: () => driver,
    modelFactory: () => ({ async respond(input) {
      modelTurn += 1;
      if (modelTurn === 1) {
        const browser = input.tools.find((tool) => tool.name === 'browser');
        assert.ok(browser);
        assert.deepEqual(browser.parameters.properties.action.enum, [
          'status', 'profiles', 'tabs', 'navigate', 'snapshot', 'screenshot', 'click', 'fill', 'submit',
          'login_start', 'login_status', 'login_cancel', 'download', 'upload',
        ]);
        return { text: '', toolCalls: [{ id: 'observe-page', name: 'browser', args: {
          action: 'navigate', url: 'https://example.com/app', tabId: null,
          full: null, maxChars: 20_000, fullPage: null,
          observationId: null, ref: null, text: null, filePath: null, effect: null,
        } }] };
      }
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.state, 'observed');
      assert.match(receipt.result.observation.text, /사업을 더 쉽게/);
      return { text: '렌더링된 화면에서 “사업을 더 쉽게”와 예약·주문 관리 안내를 확인했어요.', toolCalls: [] };
    } }),
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'browser-model' }),
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
      body: JSON.stringify({ sessionId: session.id, text: '이 동적 페이지를 실제로 보고 알려줘' }),
    }).then((response) => response.json());
    assert.match(reply.reply, /사업을 더 쉽게/);
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    const completed = run.events.filter((event) => event.type === 'tool_completed');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].payload.receipt.actualCall.name, 'browser');
    assert.equal(completed[0].payload.receipt.result.tab.tabId, 't1');
    assert.match(completed[0].payload.receipt.result.observation.observationId, /^[0-9a-f]{64}$/);
  } finally {
    await server.closeBrowsers?.();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('콘솔 모델이 download ref를 사용하고 실제 managed file 영수증의 경로·hash를 답에 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-download-console-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const file = join(stateDir, 'browser', 'fixture', 'downloads', 'report.pdf');
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(join(stateDir, 'browser', 'fixture', 'downloads'), { recursive: true })]);
  await writeFile(file, Buffer.from('%PDF-1.7\nconsole-download'), { mode: 0o600 });
  let phase = 0;
  let observed;
  const driver = {
    profile: { id: 'isolated', kind: 'managed_isolated', selected: true },
    userControlActive: () => false,
    async available() { return { available: true, version: '0.34.0' }; },
    async navigate() { return {
      tab: { tabId: 't1', targetId: 'target-1', title: '보고서', url: 'https://example.com/reports' },
      snapshot: { text: '- link "월간 보고서" [ref=e2]', refs: { e2: { role: 'link', name: '월간 보고서' } }, totalChars: 30, truncated: false },
    }; },
    async elementFacts() { return { type: null, autocomplete: null, href: 'https://example.com/report.pdf', download: 'report.pdf' }; },
    async download({ ref }) { return {
      action: { kind: 'download', ref },
      tab: { tabId: 't1', targetId: 'target-1', title: '보고서', url: 'https://example.com/reports' },
      snapshot: { text: '- link "월간 보고서" [ref=e2]', refs: { e2: { role: 'link', name: '월간 보고서' } }, totalChars: 30, truncated: false },
      network: { totalRequests: 1, truncated: false, requests: [{ method: 'GET', address: 'https://example.com/report.pdf', resourceType: 'Document', status: 200, mimeType: 'application/pdf' }] },
      file: { path: file, bytes: 25, sha256: 'd'.repeat(64), mimeType: 'application/pdf', trust: 'untrusted_external' },
      source: { address: 'https://example.com/report.pdf', queryOmitted: false },
    }; },
    async status() { return { state: 'ready' }; }, async profiles() { return { profiles: [this.profile] }; },
    async tabs() { return { tabs: [] }; }, async snapshot() { throw new Error('not used'); },
    async screenshot() { throw new Error('not used'); }, async close() {},
  };
  const nulls = { url: null, tabId: null, full: null, maxChars: 20_000, fullPage: null, observationId: null, ref: null, text: null, filePath: null, effect: null };
  const server = makeConsoleServer({
    stateDir, workspace, browserDriverFactory: () => driver,
    modelFactory: () => ({ async respond(input) {
      phase += 1;
      if (phase === 1) return { text: '', toolCalls: [{ id: 'open-reports', name: 'browser', args: { action: 'navigate', ...nulls, url: 'https://example.com/reports' } }] };
      if (phase === 2) {
        observed = JSON.parse(input.messages.at(-1).content).result.observation;
        return { text: '', toolCalls: [{ id: 'download-report', name: 'browser', args: {
          action: 'download', ...nulls, tabId: 't1', observationId: observed.observationId, ref: 'e2',
          effect: { kind: 'local_change', summary: '월간 보고서 다운로드', targets: ['https://example.com/reports'], reversible: true, backupAvailable: false, recipientNew: false, approvalToken: null },
        } }] };
      }
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.file.sha256, 'd'.repeat(64));
      return { text: `다운로드했습니다: ${receipt.result.file.path} (${receipt.result.file.bytes} bytes)`, toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: '월간 보고서를 다운로드해줘' }) }).then((response) => response.json());
    assert.match(reply.reply, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    const receipt = run.events.filter((event) => event.type === 'tool_completed').at(-1).payload.receipt;
    assert.equal(receipt.actualCall.name, 'browser');
    assert.equal(receipt.result.file.trust, 'untrusted_external');
    assert.equal(receipt.result.before.observationId, observed.observationId);
  } finally {
    await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('콘솔 upload는 현재 사용자 문장에 적힌 exact path만 file input으로 외부 전송한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-upload-console-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const file = join(await realpath(room), 'business-profile.pdf');
  await mkdir(workspace, { recursive: true });
  await writeFile(file, Buffer.from('%PDF-1.7\nupload-console'));
  let phase = 0;
  let uploads = 0;
  const sha256 = 'e'.repeat(64);
  const driver = {
    profile: { id: 'isolated', kind: 'managed_isolated', selected: true }, userControlActive: () => false,
    async available() { return { available: true, version: '0.34.0' }; },
    async navigate() { return {
      tab: { tabId: 't1', targetId: 'target-1', title: '자료 제출', url: 'https://example.com/upload' },
      snapshot: { text: '- button "사업자 자료" [ref=e8]', refs: { e8: { role: 'button', name: '사업자 자료' } }, totalChars: 33, truncated: false },
    }; },
    async elementFacts() { return { type: 'file', autocomplete: null, href: null, download: null }; },
    async uploadFileFacts(candidate) { return { path: candidate, bytes: 23, sha256, mimeType: 'application/pdf', trust: 'user_selected_local' }; },
    async upload({ ref, filePath, expectedSha256 }) {
      uploads += 1; assert.equal(expectedSha256, sha256);
      return {
        action: { kind: 'upload', ref },
        tab: { tabId: 't1', targetId: 'target-1', title: '자료 제출', url: 'https://example.com/upload' },
        snapshot: { text: '- button "사업자 자료" [ref=e8]: business-profile.pdf', refs: { e8: { role: 'button', name: '사업자 자료' } }, totalChars: 55, truncated: false },
        network: { totalRequests: 1, truncated: false, requests: [{ method: 'POST', address: 'https://example.com/api/upload', resourceType: 'Fetch', status: 200, mimeType: 'application/json' }] },
        file: { path: filePath, bytes: 23, sha256, mimeType: 'application/pdf', trust: 'user_selected_local' },
      };
    },
    async status() { return { state: 'ready' }; }, async profiles() { return { profiles: [this.profile] }; },
    async tabs() { return { tabs: [] }; }, async snapshot() { throw new Error('not used'); },
    async screenshot() { throw new Error('not used'); }, async close() {},
  };
  const nulls = { url: null, tabId: null, full: null, maxChars: 20_000, fullPage: null, observationId: null, ref: null, text: null, filePath: null, effect: null };
  const server = makeConsoleServer({
    stateDir, workspace, browserDriverFactory: () => driver,
    modelFactory: () => ({ async respond(input) {
      phase += 1;
      if (phase === 1) return { text: '', toolCalls: [{ id: 'open-upload', name: 'browser', args: { action: 'navigate', ...nulls, url: 'https://example.com/upload' } }] };
      if (phase === 2) {
        const observation = JSON.parse(input.messages.at(-1).content).result.observation;
        return { text: '', toolCalls: [{ id: 'upload-file', name: 'browser', args: {
          action: 'upload', ...nulls, tabId: 't1', observationId: observation.observationId,
          ref: 'e8', filePath: file,
          effect: { kind: 'external_send', summary: '사업자 자료 업로드', targets: ['https://example.com/upload'], reversible: true, backupAvailable: false, recipientNew: false, approvalToken: null },
        } }] };
      }
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.network.requests[0].method, 'POST');
      return { text: `업로드했습니다: ${receipt.result.file.path}`, toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: `이 파일을 업로드해줘: ${file}` }) }).then((response) => response.json());
    assert.match(reply.reply, /업로드했습니다/);
    assert.equal(uploads, 1);
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    const receipt = run.events.filter((event) => event.type === 'tool_completed').at(-1).payload.receipt;
    assert.equal(receipt.result.file.path, file);
    assert.equal(receipt.result.file.sha256, sha256);
    assert.equal(receipt.result.after.refScope.tabId, 't1');
  } finally {
    await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('사용자가 visible browser에서 직접 로그인한 뒤 다음 턴 login_status만 page observation을 모델에 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-login-handoff-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let phase = 0;
  let active = false;
  const calls = [];
  const driver = {
    profile: { id: 'isolated', kind: 'managed_isolated', selected: true },
    userControlActive: () => active,
    async available() { return { available: true, version: '0.34.0' }; },
    async beginUserLogin(url) {
      calls.push(['login_start', url]); active = true;
      return {
        state: 'user_control_required', pageObserved: false, secretValuesObserved: false,
        tab: { tabId: 't1', targetId: 'target-1', title: '', url },
        handoff: { visible: false, inputOwner: 'user', modelActionsBlocked: true, canReveal: true },
      };
    },
    async loginStatus() {
      calls.push(['login_status']); active = false;
      return {
        state: 'handoff_complete_candidate', secretFieldsPresent: false, secretValuesObserved: false,
        continuityEstablished: true,
        tab: { tabId: 't1', targetId: 'target-1', title: '사업자 대시보드', url: 'https://example.com/dashboard' },
        snapshot: { text: '- heading "사업자 대시보드" [ref=e1]', refs: { e1: { role: 'heading', name: '사업자 대시보드' } }, totalChars: 40, truncated: false },
        handoff: { visible: false, inputOwner: 'user', resumedHeadless: true },
      };
    },
    async status() { return { state: 'ready' }; }, async profiles() { return { profiles: [this.profile] }; },
    async revealUserLogin() { calls.push(['login_reveal']); return { visible: true, application: 'T5 Browser' }; },
    async tabs() { return { tabs: [] }; }, async navigate() { throw new Error('not used'); },
    async snapshot() { throw new Error('must not observe login form'); }, async screenshot() { throw new Error('not used'); },
    async close() {},
  };
  const nulls = { url: null, tabId: null, full: null, maxChars: 20_000, fullPage: null, observationId: null, ref: null, text: null, filePath: null, effect: null };
  const server = makeConsoleServer({
    stateDir, workspace, browserDriverFactory: () => driver,
    modelFactory: () => ({ async respond(input) {
      phase += 1;
      if (phase === 1) return { text: '', toolCalls: [{ id: 'login', name: 'browser', args: {
        action: 'login_start', ...nulls, url: 'https://example.com/login',
      } }] };
      if (phase === 2) {
        const receipt = JSON.parse(input.messages.at(-1).content);
        assert.equal(receipt.result.pageObserved, false);
        return { text: '전용 브라우저에서 직접 로그인한 뒤 완료했다고 알려주세요.', toolCalls: [] };
      }
      if (phase === 3) return { text: '', toolCalls: [{ id: 'login-status', name: 'browser', args: {
        action: 'login_status', ...nulls, tabId: 't1',
      } }] };
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.match(receipt.result.observation.text, /사업자 대시보드/);
      assert.equal(receipt.result.continuityEstablished, true);
      return { text: '로그인 뒤 사업자 대시보드를 확인했어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: '사업자 페이지에 로그인해야 해' }) }).then((response) => response.json());
    assert.match(first.reply, /직접 로그인/);
    assert.deepEqual(first.browserHandoff, {
      active: true, visible: false, canReveal: true, provider: 'browser',
    });
    const revealed = await fetch(`${base}/browser/login/reveal`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    }).then((response) => response.json());
    assert.equal(revealed.visible, true);
    const second = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: '로그인 완료했어' }) }).then((response) => response.json());
    assert.match(second.reply, /사업자 대시보드/);
    assert.deepEqual(calls, [
      ['login_start', 'https://example.com/login'], ['login_reveal'], ['login_status'],
    ]);
    const run = await fetch(`${base}/runs/${second.runId}`).then((response) => response.json());
    const receipt = run.events.find((event) => event.type === 'tool_completed').payload.receipt;
    assert.equal(receipt.result.secretValuesObserved, false);
    assert.equal(JSON.stringify(receipt).includes('password'), false);
  } finally {
    await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('browser screenshot Receipt의 previewUrl은 기존 콘솔 markdown에서 읽을 실제 이미지 바이트를 낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-preview-console-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const screenshotBytes = Buffer.from('PNG-PREVIEW-FIXTURE');
  await mkdir(workspace, { recursive: true });
  let turn = 0;
  const driverFor = (screenshotPath) => ({
    profile: { id: 'isolated', kind: 'managed_isolated', selected: true },
    async available() { return { available: true, version: '0.34.0' }; },
    async screenshot() { return {
      tab: { tabId: 't1', targetId: 'target-1', title: '미리보기', url: 'https://example.com/' },
      file: { path: screenshotPath, bytes: screenshotBytes.length, sha256: 'b'.repeat(64), mimeType: 'image/png' },
    }; },
    async status() { return { state: 'ready' }; }, async profiles() { return { profiles: [this.profile] }; },
    async tabs() { return { tabs: [] }; }, async navigate() { throw new Error('not used'); },
    async snapshot() { throw new Error('not used'); }, async close() {},
  });
  const server = makeConsoleServer({
    stateDir, workspace, browserDriverFactory: async (sessionId) => {
      const directory = join(stateDir, 'browser', sessionNameForOwner(sessionId), 'artifacts');
      const screenshotPath = join(directory, 'browser-11111111-1111-4111-8111-111111111111.png');
      await mkdir(directory, { recursive: true });
      await writeFile(screenshotPath, screenshotBytes);
      return driverFor(screenshotPath);
    },
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'preview-model' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'capture-page', name: 'browser', args: {
        action: 'screenshot', url: null, tabId: 't1', full: null, maxChars: null, fullPage: true,
        observationId: null, ref: null, text: null, filePath: null, effect: null,
      } }] };
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.match(receipt.result.file.previewUrl, /^\/browser-artifacts\/t5-[0-9a-f]{20}\/browser-[0-9a-f-]{36}\.png$/);
      return { text: `![브라우저 미리보기](${receipt.result.file.previewUrl})`, toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '화면을 캡처해서 보여줘' }),
    }).then((response) => response.json());
    const previewUrl = /\((\/browser-artifacts\/t5-[0-9a-f]{20}\/browser-[0-9a-f-]{36}\.png)\)/.exec(reply.reply)?.[1];
    const preview = await fetch(`${base}${previewUrl}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), screenshotBytes);
    const missing = await fetch(`${base}/browser-artifacts/t5-00000000000000000000/browser-00000000-0000-4000-8000-000000000000.png`);
    assert.equal(missing.status, 404);
  } finally {
    await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('browser preview URL은 서버 재시작 뒤에도 같은 영속 screenshot을 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-preview-restart-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const session = 't5-0123456789abcdef0123';
  const file = 'browser-22222222-2222-4222-8222-222222222222.png';
  const directory = join(stateDir, 'browser', session, 'artifacts');
  const bytes = Buffer.from('PERSISTENT-PREVIEW');
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(directory, { recursive: true })]);
  await writeFile(join(directory, file), bytes);
  const makeServer = () => makeConsoleServer({
    stateDir, workspace,
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }),
  });
  const path = `/browser-artifacts/${session}/${file}`;
  let server = makeServer();
  try {
    for (let restart = 0; restart < 2; restart += 1) {
      await new Promise((resolve, reject) => {
        server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      await new Promise((resolve) => server.close(resolve));
      if (restart === 0) server = makeServer();
    }
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('세 사용자 턴에서 최신 browser ref로 fill 뒤 submit하고 각 행동 후 관측·network를 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-action-console-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let phase = 0;
  let observed;
  let filled;
  let fills = 0;
  let submits = 0;
  const page = (value = '') => ({
    tab: { tabId: 't1', targetId: 'target-1', title: '가게 검색', url: 'https://example.com/shop' },
    snapshot: {
      text: `- textbox "가게 이름" [ref=e4]${value ? `: ${value}` : ''}`,
      refs: {
        e4: { role: 'textbox', name: '가게 이름' },
        e5: { role: 'button', name: '확인' },
      }, totalChars: 60, truncated: false,
    },
  });
  const driver = {
    profile: { id: 'isolated', kind: 'managed_isolated', selected: true },
    async available() { return { available: true, version: '0.34.0' }; },
    async navigate() { return page(); },
    async elementFacts() { return { type: 'text', autocomplete: null, href: null }; },
    async submitFacts() { return {
      element: { type: 'submit', autocomplete: null, href: null, download: null },
      secretFieldCount: 0, fileInputCount: 0,
    }; },
    async fill({ ref, text }) {
      fills += 1;
      return {
        ...page(text), action: { kind: 'fill', ref, textChars: text.length },
        network: { totalRequests: 1, truncated: false, requests: [{
          method: 'GET', address: 'https://example.com/suggest', queryOmitted: true,
          resourceType: 'Fetch', status: 200, mimeType: 'application/json',
        }] },
      };
    },
    async submit({ ref }) {
      submits += 1;
      return {
        action: { kind: 'submit', ref },
        tab: { tabId: 't1', targetId: 'target-1', title: '접수 완료', url: 'https://example.com/submit' },
        snapshot: { text: '- heading "접수 완료" [ref=e7]', refs: { e7: { role: 'heading', name: '접수 완료' } }, totalChars: 34, truncated: false },
        network: { totalRequests: 1, truncated: false, requests: [{ method: 'POST', address: 'https://example.com/submit', resourceType: 'Document', status: 200, mimeType: 'text/html' }] },
      };
    },
    async status() { return { state: 'ready' }; }, async profiles() { return { profiles: [this.profile] }; },
    async tabs() { return { tabs: [] }; }, async snapshot() { throw new Error('not used'); },
    async screenshot() { throw new Error('not used'); }, async close() {},
  };
  const nulls = { url: null, full: null, maxChars: 20_000, fullPage: null, text: null, filePath: null, effect: null };
  const server = makeConsoleServer({
    stateDir, workspace, browserDriverFactory: () => driver,
    modelFactory: () => ({ async respond(input) {
      phase += 1;
      if (phase === 1) return { text: '', toolCalls: [{ id: 'open-shop', name: 'browser', args: {
        action: 'navigate', ...nulls, url: 'https://example.com/shop', tabId: null, observationId: null, ref: null,
      } }] };
      if (phase === 2) {
        observed = JSON.parse(input.messages.at(-1).content).result.observation;
        return { text: '가게 이름 입력칸을 확인했어요.', toolCalls: [] };
      }
      if (phase === 3) return { text: '', toolCalls: [{ id: 'fill-shop', name: 'browser', args: {
        action: 'fill', ...nulls, tabId: 't1', observationId: observed.observationId,
        ref: 'e4', text: '봄 카페', effect: {
          kind: 'external_send', summary: '가게 검색어 입력', targets: ['https://example.com/shop'],
          reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
        },
      } }] };
      if (phase === 4) {
        const receipt = JSON.parse(input.messages.at(-1).content);
        assert.equal(receipt.result.state, 'acted');
        assert.equal(receipt.result.action.textChars, 4);
        assert.equal(receipt.result.network.requests[0].address, 'https://example.com/suggest');
        assert.match(receipt.result.after.text, /봄 카페/);
        filled = receipt.result.after;
        return { text: '가게 이름에 “봄 카페”를 입력했고 자동완성 요청도 확인했어요.', toolCalls: [] };
      }
      if (phase === 5) return { text: '', toolCalls: [{ id: 'submit-shop', name: 'browser', args: {
        action: 'submit', ...nulls, tabId: 't1', observationId: filled.observationId, ref: 'e5',
        effect: {
          kind: 'external_send', summary: '가게 신청 제출', targets: ['https://example.com/shop'],
          reversible: true, backupAvailable: false, recipientNew: false, approvalToken: null,
        },
      } }] };
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.action.kind, 'submit');
      assert.equal(receipt.result.network.requests[0].method, 'POST');
      assert.match(receipt.result.after.text, /접수 완료/);
      return { text: '제출했고 접수 완료 화면을 확인했어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: '가게 검색 화면을 열어줘' }) }).then((response) => response.json());
    assert.match(first.reply, /입력칸/);
    const second = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: '거기에 봄 카페라고 입력해줘' }) }).then((response) => response.json());
    assert.match(second.reply, /자동완성 요청/);
    assert.equal(fills, 1);
    const run = await fetch(`${base}/runs/${second.runId}`).then((response) => response.json());
    const receipt = run.events.find((event) => event.type === 'tool_completed').payload.receipt;
    assert.equal(receipt.actualCall.name, 'browser');
    assert.equal(receipt.result.before.observationId, observed.observationId);
    const third = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: '좋아. 그 내용으로 제출해줘' }) }).then((response) => response.json());
    assert.match(third.reply, /접수 완료/);
    assert.equal(submits, 1);
    const submitRun = await fetch(`${base}/runs/${third.runId}`).then((response) => response.json());
    const submitReceipt = submitRun.events.find((event) => event.type === 'tool_completed').payload.receipt;
    assert.equal(submitReceipt.result.before.observationId, filled.observationId);
    assert.equal(submitReceipt.result.navigation.to, 'https://example.com/submit');
  } finally {
    await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('browser submit 결제 효과는 실제 제출 전에 exact-call 승인으로 멈춘다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-payment-boundary-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let phase = 0;
  let observationId;
  let submits = 0;
  const driver = {
    profile: { id: 'isolated', kind: 'managed_isolated', selected: true },
    async available() { return { available: true, version: '0.34.0' }; },
    async navigate() { return {
      tab: { tabId: 't1', targetId: 'target-1', title: '결제', url: 'https://shop.example/cart' },
      snapshot: { text: '- button "결제" [ref=e2]', refs: { e2: { role: 'button', name: '결제' } }, totalChars: 24, truncated: false },
    }; },
    async submitFacts() { return {
      element: { type: 'submit', autocomplete: null, href: null, download: null },
      secretFieldCount: 0, fileInputCount: 0,
    }; },
    async submit() { submits += 1; throw new Error('must not execute before approval'); },
    async status() { return { state: 'ready' }; }, async profiles() { return { profiles: [this.profile] }; },
    async tabs() { return { tabs: [] }; }, async snapshot() { throw new Error('not used'); },
    async screenshot() { throw new Error('not used'); }, async close() {},
  };
  const nulls = { url: null, full: null, maxChars: 20_000, fullPage: null, observationId: null, ref: null, text: null, filePath: null, effect: null };
  const server = makeConsoleServer({
    stateDir, workspace, browserDriverFactory: () => driver,
    modelFactory: () => ({ async respond(input) {
      phase += 1;
      if (phase === 1) return { text: '', toolCalls: [{ id: 'open-cart', name: 'browser', args: {
        action: 'navigate', ...nulls, url: 'https://shop.example/cart',
      } }] };
      if (phase === 2) {
        observationId = JSON.parse(input.messages.at(-1).content).result.observation.observationId;
        return { text: '', toolCalls: [{ id: 'pay', name: 'browser', args: {
          action: 'submit', ...nulls, tabId: 't1', observationId, ref: 'e2',
          effect: { kind: 'payment', summary: '상품 결제', targets: ['https://shop.example/cart'], reversible: false, backupAvailable: false, recipientNew: false, approvalToken: null },
        } }] };
      }
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.state, 'approval_required');
      return { text: '결제는 승인 전이라 실행하지 않았어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: '장바구니 상품을 결제해줘' }) }).then((response) => response.json());
    assert.equal(reply.kind, 'approval');
    assert.match(reply.reply, /실행하지 않았/);
    assert.equal(reply.pending[0].preview.what, 'browser submit');
    assert.equal(submits, 0);
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    const receipt = run.events.filter((event) => event.type === 'tool_completed').at(-1).payload.receipt;
    assert.equal(receipt.actualCall, null);
    assert.equal(receipt.outcome, 'not_executed');
  } finally {
    await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
