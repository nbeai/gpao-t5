import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BROWSER_NAMESPACE, makeAgentBrowserDriver, sanitizedNetworkFacts,
  secureBrowserStatePermissions, sessionNameForOwner,
} from '../src/agent-browser-driver.js';

test('T5 Session은 경로·사용자 식별자를 노출하지 않는 안정된 agent-browser session 이름을 쓴다', () => {
  const first = sessionNameForOwner('session-user-visible-123');
  assert.match(first, /^t5-[0-9a-f]{20}$/);
  assert.equal(first, sessionNameForOwner('session-user-visible-123'));
  assert.notEqual(first, sessionNameForOwner('other'));
  assert.doesNotMatch(first, /user|visible|123/);
});

test('driver navigate는 격리 session에서 open 뒤 compact snapshot을 같은 탭 사실로 합친다', async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args.includes('open')) return { exitCode: 0, stdout: JSON.stringify({ success: true, data: { tabId: 't1', targetId: 'target-1', title: 'Example', url: 'https://example.com/' } }), stderr: '' };
    return { exitCode: 0, stdout: JSON.stringify({ success: true, data: { snapshot: '- heading "Example" [ref=e1]', refs: { e1: { role: 'heading', name: 'Example' } }, tabId: 't1', targetId: 'target-1', title: 'Example', url: 'https://example.com/' } }), stderr: '' };
  };
  const room = await mkdtemp(join(tmpdir(), 't5-agent-browser-driver-'));
  try {
    const driver = makeAgentBrowserDriver({ ownerId: 'owner-1', outputDirectory: room, run });
    const result = await driver.navigate('https://example.com/');
    assert.equal(result.tab.tabId, 't1');
    assert.equal(result.snapshot.refs.e1.role, 'heading');
    assert.ok(calls[0].includes('--session'));
    assert.ok(calls[0].includes('--namespace'));
    assert.ok(calls[0].includes('--profile'));
    assert.ok(calls[0].includes('--no-auto-dialog'));
    assert.equal(calls[0][calls[0].indexOf('--headed') + 1], 'false');
    assert.ok(calls[0].includes('open'));
    assert.ok(calls[1].includes('snapshot'));
    assert.ok(calls[1].includes('-i'));
    assert.ok(calls[1].includes('-c'));
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('status는 session list만 읽고 브라우저를 새로 띄우지 않는다', async () => {
  const calls = [];
  const driver = makeAgentBrowserDriver({
    ownerId: 'passive-status', outputDirectory: '/private/tmp',
    run: async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: JSON.stringify({ success: true, data: { sessions: [] } }), stderr: '' };
    },
  });
  const status = await driver.status();
  assert.equal(status.running, false);
  assert.equal(status.tabCount, 0);
  assert.deepEqual(calls, [['--version'], ['--namespace', BROWSER_NAMESPACE, '--json', 'session', 'list']]);
});

test('session list의 실제 문자열 항목도 현재 running session으로 읽는다', async () => {
  const ownerId = 'active-status';
  const session = sessionNameForOwner(ownerId);
  const driver = makeAgentBrowserDriver({
    ownerId, outputDirectory: '/private/tmp',
    run: async (args) => ({
      exitCode: 0, stderr: '',
      stdout: args.includes('--version') ? 'agent-browser 0.34.0\n'
        : JSON.stringify({ success: true, data: { sessions: [session] } }),
    }),
  });
  const status = await driver.status();
  assert.equal(status.running, true);
  assert.equal(status.tabCount, null);
});

test('driver screenshot은 지정 출력 폴더 밖 경로를 받지 않고 실제 파일 hash를 계산한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-agent-browser-shot-'));
  const run = async (args) => {
    const path = args.find((value) => value.endsWith('.png'));
    if (!path) return { exitCode: 0, stdout: JSON.stringify({ success: true, data: { tabs: [{ tabId: 't1', targetId: 'target-1', url: 'https://example.com/', active: true }] } }), stderr: '' };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, Buffer.from('PNG-FIXTURE'));
    return { exitCode: 0, stdout: JSON.stringify({ success: true, data: { path, tabId: 't1', targetId: 'target-1', url: 'https://example.com/' } }), stderr: '' };
  };
  try {
    const driver = makeAgentBrowserDriver({ ownerId: 'owner-2', outputDirectory: room, run });
    const result = await driver.screenshot({ tabId: 't1', fullPage: true });
    assert.match(result.file.path, new RegExp(`^${room.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(result.file.bytes, 11);
    assert.match(result.file.sha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('CLI 비정상 종료는 성공 JSON으로 승격하지 않는다', async () => {
  const driver = makeAgentBrowserDriver({
    ownerId: 'owner-3', outputDirectory: '/private/tmp',
    run: async () => ({ exitCode: 1, stdout: '', stderr: 'browser crashed' }),
  });
  await assert.rejects(() => driver.tabs(), /browser crashed/);
});

test('network facts는 query·header를 버리고 관측 가능한 전송 사실만 남긴다', () => {
  const facts = sanitizedNetworkFacts({ requests: [{
    method: 'post', url: 'https://shop.example/search?q=private&token=secret',
    headers: { authorization: 'Bearer secret' }, resourceType: 'Fetch', status: 200,
    mimeType: 'application/json',
  }] });
  assert.deepEqual(facts, {
    totalRequests: 1, truncated: false,
    requests: [{
      method: 'POST', address: 'https://shop.example/search', queryOmitted: true,
      resourceType: 'Fetch', status: 200, mimeType: 'application/json',
    }],
  });
  assert.doesNotMatch(JSON.stringify(facts), /private|secret|authorization/i);
});

test('click·fill은 action 직전 network를 비우고 행동 후 snapshot과 sanitized network를 돌려준다', async () => {
  const calls = [];
  const run = async (args) => {
    const command = args.slice(args.indexOf('--json') + 1);
    calls.push(command);
    if (command[0] === 'network' && command.includes('--clear')) return { exitCode: 0, stderr: '', stdout: '{"success":true,"data":{}}' };
    if (command[0] === 'network') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { requests: [{ method: 'GET', url: 'https://example.com/suggest?q=coffee', resourceType: 'Fetch', status: 200 }] } }) };
    if (command[0] === 'snapshot') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { snapshot: '- textbox "검색" [ref=e4]', refs: { e4: { role: 'textbox', name: '검색' } } } }) };
    if (command[0] === 'tab' && command[1] === 'list') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { tabs: [{ tabId: 't1', url: 'https://example.com/', active: true }] } }) };
    return { exitCode: 0, stderr: '', stdout: '{"success":true,"data":{}}' };
  };
  const driver = makeAgentBrowserDriver({ ownerId: 'actions', outputDirectory: '/private/tmp', run });
  const fill = await driver.fill({ tabId: 't1', ref: 'e4', text: 'coffee' });
  assert.deepEqual(fill.action, { kind: 'fill', ref: 'e4', textChars: 6 });
  assert.equal(fill.network.requests[0].address, 'https://example.com/suggest');
  assert.equal(fill.network.requests[0].queryOmitted, true);
  assert.ok(calls.some((args) => args.join(' ') === 'network requests --clear'));
  assert.ok(calls.some((args) => args.join(' ') === 'fill @e4 coffee'));
  assert.equal(JSON.stringify(fill).includes('coffee'), false);
});

test('snapshot이 만든 ref를 쓸 때 같은 활성 tab을 재선택해 ref를 지우지 않는다', async () => {
  const calls = [];
  const run = async (args) => {
    const command = args.slice(args.indexOf('--json') + 1);
    calls.push(command);
    if (command[0] === 'open') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { url: 'https://example.com/' } }) };
    if (command[0] === 'snapshot') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { tabId: 't1', url: 'https://example.com/', snapshot: '- textbox "검색" [ref=e4]', refs: { e4: { role: 'textbox', name: '검색' } } } }) };
    if (command[0] === 'tab' && command[1] === 'list') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { tabs: [{ tabId: 't1', url: 'https://example.com/', active: true }] } }) };
    if (command[0] === 'get') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { value: command.at(-1) === 'type' ? 'text' : null } }) };
    return { exitCode: 0, stderr: '', stdout: '{"success":true,"data":{}}' };
  };
  const driver = makeAgentBrowserDriver({ ownerId: 'stable-ref', outputDirectory: '/private/tmp', run });
  await driver.navigate('https://example.com/');
  const facts = await driver.elementFacts({ tabId: 't1', ref: 'e4' });
  assert.equal(facts.type, 'text');
  assert.equal(calls.some((args) => args[0] === 'tab' && args[1] === 't1'), false);
  assert.ok(calls.some((args) => args.join(' ') === 'get attr @e4 type'));
});

test('submit은 exact ref의 submit·secret·file 사실을 확인하고 click 뒤 POST·새 snapshot을 돌려준다', async () => {
  const calls = [];
  let submitted = false;
  const run = async (args) => {
    const command = args.slice(args.indexOf('--json') + 1);
    calls.push(command);
    if (command[0] === 'open') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { url: 'https://example.com/form' } }) };
    if (command[0] === 'click') { submitted = true; return { exitCode: 0, stderr: '', stdout: '{"success":true,"data":{}}' }; }
    if (command[0] === 'snapshot') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: submitted
      ? { tabId: 't1', url: 'https://example.com/submit', snapshot: '- heading "접수 완료" [ref=e1]', refs: { e1: { role: 'heading', name: '접수 완료' } } }
      : { tabId: 't1', url: 'https://example.com/form', snapshot: '- button "확인" [ref=e5]', refs: { e5: { role: 'button', name: '확인' } } } }) };
    if (command[0] === 'tab' && command[1] === 'list') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { tabs: [{ tabId: 't1', url: submitted ? 'https://example.com/submit' : 'https://example.com/form', active: true }] } }) };
    if (command[0] === 'get' && command[1] === 'attr') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { value: command.at(-1) === 'type' ? 'submit' : null } }) };
    if (command[0] === 'get' && command[1] === 'count') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { count: 0 } }) };
    if (command[0] === 'network' && command.includes('--clear')) return { exitCode: 0, stderr: '', stdout: '{"success":true,"data":{}}' };
    if (command[0] === 'network') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { requests: [{ method: 'POST', url: 'https://example.com/submit', resourceType: 'Document', status: 200, mimeType: 'text/html' }] } }) };
    return { exitCode: 0, stderr: '', stdout: '{"success":true,"data":{}}' };
  };
  const driver = makeAgentBrowserDriver({ ownerId: 'submit', outputDirectory: '/private/tmp', run });
  await driver.navigate('https://example.com/form');
  const facts = await driver.submitFacts({ tabId: 't1', ref: 'e5' });
  assert.deepEqual(facts, {
    element: { type: 'submit', autocomplete: null, href: null, download: null },
    secretFieldCount: 0, fileInputCount: 0,
  });
  const result = await driver.submit({ tabId: 't1', ref: 'e5' });
  assert.deepEqual(result.action, { kind: 'submit', ref: 'e5' });
  assert.equal(result.network.requests[0].method, 'POST');
  assert.match(result.snapshot.text, /접수 완료/);
  assert.ok(calls.some((args) => args.join(' ') === 'click @e5'));
  assert.ok(calls.some((args) => args.join(' ').includes('autocomplete~="cc-number"')));
});

test('submit 전 secret·file count 관측 형식이 깨지면 0으로 꾸미지 않고 닫힌다', async () => {
  const driver = makeAgentBrowserDriver({
    ownerId: 'submit-count-failure', outputDirectory: '/private/tmp',
    run: async () => ({ exitCode: 0, stderr: '', stdout: '{"success":true,"data":{}}' }),
  });
  await assert.rejects(
    () => driver.submitFacts({ tabId: 't1', ref: 'e5' }),
    /invalid element count/,
  );
});

test('user login handoff는 같은 persistent profile을 headed로 열고 비밀 field가 사라진 뒤에만 headless snapshot을 돌려준다', async () => {
  const calls = [];
  let secretFieldCount = 1;
  const run = async (args) => {
    const headed = args[args.indexOf('--headed') + 1];
    const command = args.slice(args.indexOf('--json') + 1);
    calls.push({ headed, command });
    if (command[0] === 'tab' && command[1] === 'list') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { tabs: [{ tabId: 't1', url: secretFieldCount ? 'https://example.com/login' : 'https://example.com/dashboard', active: true }] } }) };
    if (command[0] === 'get' && command[1] === 'count') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { count: secretFieldCount } }) };
    if (command[0] === 'snapshot') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { tabId: 't1', url: 'https://example.com/dashboard', snapshot: '- heading "대시보드" [ref=e1]', refs: { e1: { role: 'heading', name: '대시보드' } } } }) };
    return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { url: command[1] ?? '' } }) };
  };
  const driver = makeAgentBrowserDriver({ ownerId: 'manual-login', outputDirectory: '/private/tmp', run });
  const started = await driver.beginUserLogin('https://example.com/login');
  assert.equal(started.state, 'user_control_required');
  assert.equal(started.pageObserved, false);
  assert.equal(driver.userControlActive(), true);
  assert.ok(calls.some((call) => call.headed === 'true' && call.command[0] === 'open'));
  assert.equal(calls.some((call) => call.command[0] === 'snapshot'), false);

  const waiting = await driver.loginStatus({ tabId: 't1' });
  assert.equal(waiting.state, 'user_action_required');
  assert.equal(waiting.secretFieldsPresent, true);
  assert.equal(waiting.pageObserved, false);

  secretFieldCount = 0;
  const completed = await driver.loginStatus({ tabId: 't1' });
  assert.equal(completed.state, 'handoff_complete_candidate');
  assert.equal(completed.secretFieldsPresent, false);
  assert.match(completed.snapshot.text, /대시보드/);
  assert.equal(driver.userControlActive(), false);
  assert.ok(calls.some((call) => call.headed === 'false' && call.command[0] === 'open'));
});

test('browser close 직후 소켓 정리 경합만 한 번 재연결하고 다른 실패로 넓히지 않는다', async () => {
  let calls = 0;
  const driver = makeAgentBrowserDriver({
    ownerId: 'lifecycle-race', outputDirectory: '/private/tmp',
    run: async () => {
      calls += 1;
      if (calls === 1) return { exitCode: 1, stdout: '', stderr: '{"error":"Failed to connect: No such file or directory (os error 2)","success":false}' };
      return { exitCode: 0, stderr: '', stdout: '{"success":true,"data":{"tabs":[]}}' };
    },
  });
  assert.deepEqual(await driver.tabs(), { tabs: [] });
  assert.equal(calls, 2);
});

test('browser restore 상태는 디렉터리 0700·파일 0600이고 symlink가 끼면 닫힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-state-mode-'));
  const state = join(room, '.agent-browser');
  const nested = join(state, 'sessions');
  try {
    await mkdir(nested, { recursive: true, mode: 0o755 });
    const file = join(nested, 'state.json');
    await writeFile(file, '{}', { mode: 0o644 });
    await secureBrowserStatePermissions(state);
    assert.equal((await stat(state)).mode & 0o777, 0o700);
    assert.equal((await stat(nested)).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await symlink(file, join(state, 'linked-state'));
    await assert.rejects(() => secureBrowserStatePermissions(state), /symbolic links/);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('사용자가 login handoff를 취소하면 headed session을 닫고 model action을 다시 연다', async () => {
  const calls = [];
  const driver = makeAgentBrowserDriver({
    ownerId: 'cancel-login', outputDirectory: '/private/tmp',
    run: async (args) => {
      const command = args.slice(args.indexOf('--json') + 1);
      calls.push(command);
      if (command[0] === 'tab') return { exitCode: 0, stderr: '', stdout: '{"success":true,"data":{"tabs":[{"tabId":"t1","url":"https://example.com/login","active":true}]}}' };
      return { exitCode: 0, stderr: '', stdout: '{"success":true,"data":{}}' };
    },
  });
  await driver.beginUserLogin('https://example.com/login');
  const cancelled = await driver.cancelUserLogin();
  assert.equal(cancelled.state, 'user_control_cancelled');
  assert.equal(driver.userControlActive(), false);
  assert.ok(calls.some((command) => command[0] === 'close'));
});
