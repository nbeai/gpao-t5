// 임의 셸은 명령의 의미를 구조화해 증명할 수 없다. 따라서 probe 는 네트워크를 실제로
// 열어 보지 않는다. 공개 web GET 자동성은 구조화 web 손의 계약이고, local.terminal 의
// 임의 TCP/HTTP 송신과 같은 권위가 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';

function 실행기(대본) {
  const 부른것 = [];
  const run = async (command, opts) => {
    부른것.push({ command, mode: opts.mode });
    const r = 대본[opts.mode] ?? { exitCode: 0, stdout: '', stderr: '' };
    return { command, cwd: opts.cwd, mode: opts.mode, durationMs: 1, ...r };
  };
  return { run, 부른것 };
}

const 네트워크막힘 = { exitCode: 1, stdout: '', stderr: 'PermissionError: [Errno 1] Operation not permitted' };

test('임의 터미널 네트워크는 probe 에서 미증명 효과로 남고 실제 전달 모드로 재실행되지 않는다', async () => {
  const { run, 부른것 } = 실행기({
    probe: 네트워크막힘,
    reach: { exitCode: 0, stdout: 'sent', stderr: '' },
  });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });

  const p = await 손.probe('python3 opaque-script.py');
  assert.equal(p.changes, true, '효과를 증명하지 못한 임의 셸 네트워크가 자동 권위를 얻었다');
  assert.deepEqual(부른것.map((x) => x.mode), ['probe'], '승인 전에 네트워크가 열린 reach 로 재실행했다');

  const r = await 손.handler({ command: p.command, probeResult: p.probe });
  assert.equal(r.blocked, true);
  assert.equal(r.needsGrant, true);
  assert.match(r.nextSafeAction, /웹|채널|확인/, '구조화된 다음 수단이나 승인 경계를 모델에게 남기지 않았다');
  assert.deepEqual(부른것.map((x) => x.mode), ['probe']);
});

test('actual-host: Python TCP 우회도 승인 0에서 한 바이트도 전달하지 않는다',
  { skip: !sandboxAvailable() && '이 컴퓨터는 샌드박스 없음' }, async (t) => {
    let 받은바이트 = 0;
    const server = createServer((socket) => socket.on('data', (chunk) => { 받은바이트 += chunk.length; }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const { port } = server.address();
    const command = `python3 -c "import socket;s=socket.socket();s.connect(('127.0.0.1',${port}));s.sendall(b'leak')"`;
    const 손 = makeLocalTerminalTool({ cwd: '/tmp' });

    const p = await 손.probe(command);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(p.changes, true, '임의 TCP 송신을 읽기로 분류했다');
    assert.equal(받은바이트, 0, `승인 전에 ${받은바이트}바이트가 실제 전달됐다`);
  });

test('로컬 읽기·탐색·계산은 계속 자동이고 reach 를 요구하지 않는다', async () => {
  const { run, 부른것 } = 실행기({ probe: { exitCode: 0, stdout: '2', stderr: '' } });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });
  const p = await 손.probe('python3 opaque-script.py');
  assert.equal(p.changes, false);
  const r = await 손.handler({ command: p.command, probeResult: p.probe });
  assert.equal(r.blocked, undefined);
  assert.equal(r.result.stdout, '2');
  assert.deepEqual(부른것.map((x) => x.mode), ['probe']);
});
