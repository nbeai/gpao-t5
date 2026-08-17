// P0 터미널 효과 계약 — 모델의 선언은 권한이 아니고, 사용자가 보고 승인한 효과만 연다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';
import { runCommand } from '../src/runtime/terminal-run.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 애매한탐침 = (command, cwd) => ({
  command, cwd, mode: 'probe', sandboxed: true, exitCode: 1, stdout: '',
  stderr: 'operation not permitted', durationMs: 1,
});

async function sink() {
  const 받은것 = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { 받은것.push({ method: req.method, url: req.url, body }); res.end('ok'); });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, 받은것, port: server.address().port };
}

const 한번고른다 = (call) => {
  let used = false;
  return { async respond(_tc, opts = {}) {
    if (!used && opts.tools?.length) { used = true; return { text: '', toolCalls: [call] }; }
    return opts.tools?.length ? { text: '했어요', toolCalls: [] } : '했어요';
  } };
};

test('A: 애매한 probe여도 network 선언은 sink 0→승인→1로 이어진다', {
  skip: !sandboxAvailable() && 'macOS sandbox effect profile 경로에서만 재현',
}, async () => {
  const { server, 받은것, port } = await sink();
  try {
    const dir = await mkdtemp(join(tmpdir(), 't5-effect-network-'));
    const py = [
      'import socket',
      `s=socket.create_connection(("127.0.0.1",${port}))`,
      's.sendall(b"POST /network HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\nContent-Length: 14\\r\\n\\r\\neffect-network")',
      's.close()',
    ].join(';');
    const command = `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -c ${JSON.stringify(py)}`;
    const localTerminal = makeLocalTerminalTool({
      cwd: dir,
      run: async (cmd, opts) => {
        const r = await runCommand(cmd, opts);
        // 실행기가 한 번도 보지 못한 오류 문구를 내도, probe 효과 0은 실물 샌드박스가 재다.
        return opts.mode === 'probe' ? { ...r, stderr: 'operation not permitted' } : r;
      },
    });
    const context = {
      env: demoEnv(),
      model: 한번고른다({ name: 'local.terminal', args: { command, cwd: dir, effects: ['network'] } }),
      tools: demoTools({ localTerminal }),
    };

    const first = await runTurn({ text: '테스트 수신자에게 보내줘' }, context);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(first.kind, 'approval');
    assert.equal(받은것.length, 0, '승인 전 network 효과가 발생했다');
    assert.match(JSON.stringify(first.pending), /네트워크/, '카드에 열 효과가 없다');

    await runTurn({ approve: first.pendingId }, context);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(받은것, [{ method: 'POST', url: '/network', body: 'effect-network' }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('A·B: 승인한 network+write 집합만 열린다 — 파일 1·POST 1', {
  skip: !sandboxAvailable() && 'macOS sandbox effect profile 경로에서만 재현',
}, async () => {
  const { server, 받은것, port } = await sink();
  const child = spawn('/bin/sleep', ['30']);
  try {
    const dir = await mkdtemp(join(tmpdir(), 't5-effect-set-'));
    const py = [
      'import socket',
      `s=socket.create_connection(("127.0.0.1",${port}))`,
      's.sendall(b"POST /both HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\nContent-Length: 11\\r\\n\\r\\neffect-both")',
      's.close()',
    ].join(';');
    const command = `echo made > made.txt; PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -c ${JSON.stringify(py)}; kill -TERM ${child.pid} 2>/dev/null || true`;
    const 손 = makeLocalTerminalTool({ cwd: dir });

    const r = await 손.handler({
      command, cwd: dir, granted: true, effects: ['network', 'write'],
      probeResult: 애매한탐침(command, dir),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(r.result?.effects?.join(','), 'network,write', '실행 원장에 승인 효과 집합이 없다');
    assert.equal(await readFile(join(dir, 'made.txt'), 'utf8'), 'made\n', '승인한 write가 실행되지 않았다');
    assert.deepEqual(받은것, [{ method: 'POST', url: '/both', body: 'effect-both' }],
      '승인한 network가 정확히 한 번 실행되지 않았다');
    assert.doesNotThrow(() => process.kill(child.pid, 0), '승인하지 않은 signal까지 열렸다');
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* 시험 소유 자식만 정리 */ }
    await new Promise((resolve) => server.close(resolve));
  }
});

test('C: 거짓 network 선언은 write를 자동으로 열지 않는다', {
  skip: !sandboxAvailable() && 'macOS sandbox effect profile 경로에서만 재현',
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-effect-lie-'));
  const command = 'echo pwned > must-not-exist.txt';
  const 손 = makeLocalTerminalTool({ cwd: dir });
  const r = await 손.handler({
    command, cwd: dir, granted: true, effects: ['network'],
    probeResult: 애매한탐침(command, dir),
  });

  assert.equal(existsSync(join(dir, 'must-not-exist.txt')), false, '선언하지 않은 write까지 열렸다');
  assert.notEqual(r.result?.exitCode, 0, '거짓 선언이 성공으로 승격했다');
});

test('효과 집합은 중복·순서를 정규화하고 모르는 효과를 열지 않는다', async () => {
  const 부른것 = [];
  const 손 = makeLocalTerminalTool({
    cwd: '/tmp',
    run: async (command, opts) => {
      부른것.push({ command, ...opts });
      return { command, cwd: '/tmp', mode: opts.mode, effects: opts.effects, exitCode: 0, stdout: '', stderr: '' };
    },
  });
  await 손.handler({
    command: 'opaque', granted: true, effects: ['write', 'network', 'write', '모름'],
    probeResult: 애매한탐침('opaque', '/tmp'),
  });
  assert.deepEqual(부른것.map(({ mode, effects }) => ({ mode, effects })), [
    { mode: 'effects', effects: ['network', 'write'] },
  ]);
});

test('엄격 계약: effects 없는 blocked_unproven 승인은 아무 효과도 열지 않는다', async () => {
  let 실행 = 0;
  const 손 = makeLocalTerminalTool({
    cwd: '/tmp',
    run: async () => { 실행 += 1; return { mode: 'write', exitCode: 0, stdout: '', stderr: '' }; },
  });
  const r = await 손.handler({
    command: 'opaque', granted: true,
    probeResult: 애매한탐침('opaque', '/tmp'),
  });
  assert.equal(r.blocked, true);
  assert.equal(실행, 0, '효과가 승인 내용에 없는데 실행했다');
});
