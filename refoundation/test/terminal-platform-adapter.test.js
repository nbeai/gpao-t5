import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { makeExecTool } from '../src/exec-tool.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

test('macOS adapter는 canonical protected roots와 Keychain CLI를 child sandbox에 결속한다', async () => {
  const adapter = await makeTerminalPlatformAdapter({
    platform: 'darwin', protectedReadRoots: ['/alias/a', '/alias/b'],
    checkExecutable: async () => {}, canonicalize: async (value) => value.replace('/alias', '/real'),
  });
  const launch = await adapter.prepare({ program: '/bin/sh', args: ['-c', 'printf ok'],
    cwd: '/tmp', env: { PATH: '/usr/bin:/bin' } });
  assert.equal(launch.program, '/usr/bin/sandbox-exec');
  assert.equal(launch.args[2], '/bin/sh');
  assert.match(launch.args[1], /\/real\/a/u);
  assert.match(launch.args[1], /\/usr\/bin\/security/u);
  assert.deepEqual(launch.confinement, {
    kind: 'macos_seatbelt', qualified: true, protectedRootCount: 2,
    protectedExecutableCount: 0, keychainCliBlocked: true,
  });
});

test('없는 optional root는 비밀이 있다고 꾸미지 않고 다른 canonical root 보호를 유지한다', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const adapter = await makeTerminalPlatformAdapter({
    platform: 'darwin', protectedReadRoots: ['/exists', '/missing'], checkExecutable: async () => {},
    canonicalize: async (value) => { if (value === '/missing') throw missing; return '/real/exists'; },
  });
  const launch = await adapter.prepare({ program: '/bin/sh', args: [], cwd: '/tmp', env: {} });
  assert.equal(launch.confinement.protectedRootCount, 1);
  assert.match(launch.args[1], /\/real\/exists/u);
});

test('Windows·Linux adapter는 macOS profile을 복제하지 않고 미자격 사실을 밝힌다', async () => {
  for (const platform of ['win32', 'linux']) {
    const adapter = await makeTerminalPlatformAdapter({ platform });
    const launch = await adapter.prepare({ program: 'shell', args: ['arg'], cwd: '/tmp', env: {} });
    assert.equal(launch.program, 'shell');
    assert.equal(launch.confinement.qualified, false);
    assert.equal(launch.confinement.kind, 'platform_passthrough');
  }
});

test('exec 제품 경로는 adapter가 준비한 launch와 content-free confinement receipt를 사용한다', async () => {
  let prepares = 0;
  const terminalPlatformAdapter = { async prepare(launch) {
    prepares += 1;
    return { ...launch, confinement: {
      kind: 'fixture_confinement', qualified: true, protectedRootCount: 1,
    } };
  } };
  const result = await makeExecTool({
    workspace: '/private/tmp', terminalPlatformAdapter,
  }).execute({ command: 'printf adapter-ok', cwd: null,
    effect: { kind: 'observe', summary: 'adapter', targets: [], reversible: true,
      backupAvailable: false, recipientNew: false, approvalToken: null } });
  assert.equal(prepares, 1);
  assert.equal(result.stdout, 'adapter-ok');
  assert.deepEqual(result.confinement, {
    kind: 'fixture_confinement', qualified: true, protectedRootCount: 1,
  });
});

test('제품 entry는 T5 credential roots와 Keychain root를 adapter에 주입한다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /makeTerminalPlatformAdapter/u);
  assert.match(source, /dirname\(connectionFile\)/u);
  assert.match(source, /Library', 'Keychains/u);
  assert.match(source, /terminalPlatformAdapter,/u);
});
