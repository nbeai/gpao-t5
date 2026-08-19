import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeAgentBrowserDriver, sessionNameForOwner } from '../src/agent-browser-driver.js';

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
