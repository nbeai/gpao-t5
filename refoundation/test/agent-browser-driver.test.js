import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeAgentBrowserDriver, sanitizedNetworkFacts, sessionNameForOwner } from '../src/agent-browser-driver.js';

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
  assert.deepEqual(calls, [['--version'], ['--namespace', 't5-refoundation', '--json', 'session', 'list']]);
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
