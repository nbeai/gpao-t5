import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makePersistentBrowserHost } from '../src/persistent-browser-host.js';

test('T5 브라우저 호스트는 한 지속 프로필과 안정된 restore 설정으로 CDP를 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-host-'));
  const calls = [];
  const host = makePersistentBrowserHost({
    root: room,
    run: async (args, options) => {
      calls.push({ args, environment: options?.environment });
      return {
        exitCode: 0, stderr: '', stdout: JSON.stringify({
          success: true, data: { cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/t5' },
        }),
      };
    },
  });
  try {
    assert.equal((await host.connection()).cdpUrl, 'ws://127.0.0.1:9222/devtools/browser/t5');
    const args = calls[0].args;
    assert.ok(args.includes('--profile'));
    assert.match(args[args.indexOf('--profile') + 1], /identity\/default\/profile$/u);
    assert.equal(args[args.indexOf('--headed') + 1], 'true');
    assert.equal(args[args.indexOf('--restore-save') + 1], 'always');
    assert.equal(args[args.indexOf('--idle-timeout') + 1], '0');
    assert.notEqual(calls[0].environment.AGENT_BROWSER_AUTOSAVE_INTERVAL_MS, '0');
    assert.deepEqual(host.profile, { id: 'default', kind: 'managed_persistent', selected: true });
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('로그인 창 활성화 결과는 실제 platform activator 성공 여부를 그대로 말한다', async () => {
  const seen = [];
  const host = makePersistentBrowserHost({
    root: '/private/tmp/t5-browser-host-activate',
    run: async () => ({ exitCode: 0, stderr: '', stdout: '{"success":true,"data":{"cdpUrl":"ws://127.0.0.1:9222/devtools/browser/t5"}}' }),
    activateWindow: async () => { seen.push('activate'); return { visible: true, application: 'T5 Browser' }; },
  });
  assert.deepEqual(await host.activate(), { visible: true, application: 'T5 Browser' });
  assert.deepEqual(seen, ['activate']);
});

test('T5 브라우저 로그인 초기화는 정확한 확인 뒤에만 지속 프로필을 지운다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-reset-'));
  const host = makePersistentBrowserHost({
    root: room,
    run: async (args) => ({
      exitCode: 0, stderr: '', stdout: args.includes('cdp-url')
        ? '{"success":true,"data":{"cdpUrl":"ws://127.0.0.1:9222/devtools/browser/t5"}}'
        : '{"success":true,"data":{"closed":true}}',
    }),
  });
  await host.connection();
  await mkdir(host.profileDirectory, { recursive: true });
  const marker = join(host.profileDirectory, 'login-state');
  await writeFile(marker, 'private');
  await assert.rejects(() => host.reset({ confirmation: 'wrong' }), /confirmation/u);
  await access(marker);
  const reset = await host.reset({ confirmation: 'RESET_T5_BROWSER' });
  assert.equal(reset.reset, true);
  await assert.rejects(() => access(host.identityRoot), { code: 'ENOENT' });
});

test('로그인 초기화 경로에 심볼릭 링크가 끼면 관리 범위 밖 자료를 지우지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-reset-link-'));
  const outside = await mkdtemp(join(tmpdir(), 't5-browser-reset-outside-'));
  const marker = join(outside, 'default', 'keep-me');
  await mkdir(join(outside, 'default'), { recursive: true });
  await writeFile(marker, 'keep');
  await symlink(outside, join(room, 'identity'));
  const host = makePersistentBrowserHost({
    root: room,
    run: async () => ({ exitCode: 0, stderr: '', stdout: '{"success":true,"data":{}}' }),
  });
  try {
    await assert.rejects(() => host.reset({ confirmation: 'RESET_T5_BROWSER' }), /symlink|managed browser root/u);
    await access(marker);
  } finally {
    await rm(room, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
