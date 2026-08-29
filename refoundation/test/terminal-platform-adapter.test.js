import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('macOS local_change profile은 managed target만 쓰고 sibling write를 물리 차단한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-platform-local-change-'));
  try {
    const target = join(room, 'target.txt'); const outside = join(room, 'outside.txt');
    const adapter = await makeTerminalPlatformAdapter({ platform: 'darwin', managedWorkspace: room });
    const launch = await adapter.prepare({ program: '/bin/zsh', cwd: room, env: process.env,
      args: ['-lc', `printf target > ${JSON.stringify(target)}; printf outside > ${JSON.stringify(outside)}`],
      declaredEffect: { kind: 'local_change', targets: [target] } });
    const { spawn } = await import('node:child_process');
    const child = spawn(launch.program, launch.args, { cwd: room, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code] = await new Promise((resolve) => child.once('close', (...args) => resolve(args)));
    assert.notEqual(code, 0); assert.match(stderr, /operation not permitted/i);
    assert.equal(await readFile(target, 'utf8'), 'target');
    await assert.rejects(readFile(outside, 'utf8'), { code: 'ENOENT' });
    assert.equal(launch.confinement.targetWriteConfined, true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('macOS local_change는 declared file의 없는 부모와 heredoc temp만 열고 sibling은 계속 차단한다', async (context) => {
  if (process.platform !== 'darwin') return context.skip('macOS Seatbelt qualification');
  const room = await mkdtemp(join(tmpdir(), 't5-platform-new-parent-'));
  try {
    const target = join(room, 'result', 'nested', 'target.txt'); const sibling = join(room, 'result', 'sibling.txt');
    const adapter = await makeTerminalPlatformAdapter({ platform: 'darwin', managedWorkspace: room });
    const launch = await adapter.prepare({ program: '/bin/zsh', cwd: room, env: process.env,
      args: ['-c', `mkdir -p result/nested; cat <<'EOF' > result/nested/target.txt\nok\nEOF\nprintf no > result/sibling.txt`],
      declaredEffect: { kind: 'local_change', targets: [target] } });
    try {
      const { spawn } = await import('node:child_process');
      const child = spawn(launch.program, launch.args, { cwd: room, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });
      const [code] = await new Promise((resolve) => child.once('close', (...args) => resolve(args)));
      assert.notEqual(code, 0); assert.equal(await readFile(target, 'utf8'), 'ok\n');
      await assert.rejects(readFile(sibling, 'utf8'), { code: 'ENOENT' });
    } finally { await launch.cleanup(); }
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('macOS observation profile은 file·network·signal·Apple event 경계를 함께 닫는다', async () => {
  const adapter = await makeTerminalPlatformAdapter({
    platform: 'darwin', checkExecutable: async () => {}, canonicalize: async (value) => value,
  });
  const launch = await adapter.prepareObservationProbe({
    program: '/bin/sh', args: ['-c', 'printf ok'], cwd: '/tmp', env: {},
  });
  try {
    assert.match(launch.args[1], /deny file-write\*/u);
    assert.match(launch.args[1], /deny network\*/u);
    assert.match(launch.args[1], /allow network-outbound \(remote ip "localhost:\*"\)/u);
    assert.match(launch.args[1], /deny signal/u);
    assert.match(launch.args[1], /deny appleevent-send/u);
  } finally { await launch.cleanup(); }
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

test('Windows target과 non-target Linux adapter는 macOS profile을 복제하지 않고 미자격 사실을 밝힌다', async () => {
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

test('macOS observation probe는 읽기는 바로 끝내고 write·실패 삼키기 효과는 실제 변경 없이 상승시킨다', async (context) => {
  if (process.platform !== 'darwin') return context.skip('macOS Seatbelt qualification');
  const { mkdtemp, rm, writeFile, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const room = await mkdtemp(join(tmpdir(), 't5-terminal-observation-probe-'));
  const source = join(room, 'source.txt'); const target = join(room, 'target.txt');
  await writeFile(source, 'OBSERVED-42\n');
  const adapter = await makeTerminalPlatformAdapter();
  const tool = makeExecTool({ workspace: room, terminalPlatformAdapter: adapter });
  try {
    const observed = await tool.execute({ command: `cat ${JSON.stringify(source)}`, cwd: null, effect: null });
    assert.equal(observed.exitCode, 0);
    assert.equal(observed.stdout, 'OBSERVED-42\n');
    assert.equal(observed.confinement.kind, 'macos_observation_probe');
    const blocked = await tool.execute({
      command: `printf changed > ${JSON.stringify(target)} || true`, cwd: null, effect: null,
    });
    assert.equal(blocked.state, 'effect_declaration_required');
    assert.equal(blocked.exitCode, 77);
    assert.equal(blocked.probeChangedNothing, true);
    await assert.rejects(access(target));
    const changed = await tool.execute({ command: `printf changed > ${JSON.stringify(target)}`, cwd: null,
      effect: { kind: 'local_change', targets: [target], confirmation: 'not_applicable' } });
    assert.equal(changed.exitCode, 0);
    assert.equal(await import('node:fs/promises').then(({ readFile }) => readFile(target, 'utf8')), 'changed');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('macOS observation probe는 loopback만 열고 protected secret read를 실제 원문 전에 막는다', async (context) => {
  if (process.platform !== 'darwin') return context.skip('macOS Seatbelt qualification');
  const { createServer } = await import('node:http');
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const room = await mkdtemp(join(tmpdir(), 't5-terminal-observation-boundaries-'));
  const secretRoot = join(room, 'secret'); await mkdir(secretRoot);
  const secret = join(secretRoot, 'token'); await writeFile(secret, 'DO-NOT-READ');
  let requests = 0;
  const server = createServer((_request, response) => { requests += 1; response.end('unexpected'); });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  try {
    const adapter = await makeTerminalPlatformAdapter({ protectedReadRoots: [secretRoot] });
    const tool = makeExecTool({ workspace: room, terminalPlatformAdapter: adapter });
    const network = await tool.execute({
      command: `curl -fsS http://127.0.0.1:${server.address().port}/probe`, cwd: null, effect: null,
    });
    assert.equal(network.state, 'completed');
    assert.equal(network.exitCode, 0);
    assert.equal(network.stdout, 'unexpected');
    assert.equal(requests, 1);
    const protectedRead = await tool.execute({ command: `cat ${JSON.stringify(secret)}`, cwd: null, effect: null });
    assert.equal(protectedRead.state, 'protected_read_denied');
    assert.doesNotMatch(`${protectedRead.stdout}\n${protectedRead.stderr}`, /DO-NOT-READ/u);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(room, { recursive: true, force: true });
  }
});
