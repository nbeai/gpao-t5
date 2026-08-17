// **임의 터미널 네트워크는 실행 전에 묻는다** — P0 외부 효과 경계.
//
// ── 무엇이 유보였나 (라이브로 갈랐다) ──────────────────────────────────────
// 계획서 v3.1 §20·§22 는 *"임의 명령 실행은 계속 유보"* 라고 적어 뒀다. **코드에 그런 유보는
// 없다** — `terminal-run.js` 는 셸을 통째로 주고 명령 목록도 없다. 실제 마찰은 다른 자리였다:
//
//   되돌릴 수 있는 쓰기   카드 없음 · 그냥 실행됐다 (라이브 확인: 파일이 생겼다)
//   읽기성 네트워크        **카드가 떴다** (`curl -s -o /dev/null https://example.com`)
//
// `reach` 는 파일 쓰기를 막아도 POST·DELETE·업로드·웹훅 같은 **바깥 쓰기**를 막지 않는다.
// 네트워크를 열어 성공했다는 사실은 읽기 증명이 아니다. 임의 셸 네트워크는 정확한 명령을
// 사용자에게 보여 주고 승인받은 뒤에만 `reach` 로 실행한다. 공개 웹 읽기는 `web.collect`가 맡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';
import { explainAuthority, UNKNOWN_KIND } from '../src/kernel/l2-plan/authority.js';

/** 모드별로 정해진 답을 내는 가짜 실행기. 실제 네트워크·셸을 안 탄다. */
function 실행기(대본) {
  const 부른것 = [];
  const run = async (command, opts) => {
    부른것.push({ command, mode: opts.mode });
    const r = 대본[opts.mode] ?? { exitCode: 0, stdout: '', stderr: '' };
    return { command, cwd: opts.cwd, mode: opts.mode, durationMs: 1, ...r };
  };
  return { run, 부른것 };
}

const 네트워크막힘 = { exitCode: 6, stdout: '', stderr: 'curl: (6) Could not resolve host: example.com' };
const 쓰기막힘 = { exitCode: 1, stdout: '', stderr: "touch: 유보.txt: Operation not permitted" };

// ── ① 네트워크 효과는 probe에서 멈춘다 ────────────────────────────────────
test('임의 터미널 네트워크는 자동 reach로 다시 돌지 않는다', async () => {
  const { run, 부른것 } = 실행기({
    probe: 네트워크막힘,
    reach: { exitCode: 0, stdout: '200', stderr: '' },
  });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });

  const p = await 손.probe('curl -s -o /dev/null -w "%{http_code}" https://example.com');
  assert.notEqual(p.changes, false, '외부 효과 가능성을 로컬 무변경으로 읽어 자동 실행했다');
  assert.equal(toolActionKind({ toolId: 'local.terminal', args: p }), UNKNOWN_KIND);
  assert.equal(explainAuthority({ kind: UNKNOWN_KIND, toolId: 'local.terminal' }).needsApproval, true);
  assert.deepEqual(부른것.map((x) => x.mode), ['probe'], '승인 전에 reach가 실행됐다');
});

// ── ② 쓰기로 막힌 명령은 그대로 승인으로 간다 (회귀) ─────────────────────
test('파일을 바꾸려는 명령도 기존처럼 묻는다', async () => {
  const { run, 부른것 } = 실행기({ probe: 쓰기막힘, reach: 쓰기막힘 });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });

  const p = await 손.probe('touch 유보.txt');
  assert.equal(p.changes, true, '쓰기 시도는 그대로 변경으로 읽어야 한다');

  const r = await 손.handler({ command: 'touch 유보.txt' });
  assert.equal(r.blocked, true);
  assert.equal(r.needsGrant, true, '승인 카드로 가야 한다');
  assert.match(r.userSafeSummary, /파일을 바꾸는 일/, '카드 이유는 probe 가 말한 그대로여야 한다');
  assert.ok(!부른것.some((x) => x.mode === 'reach'), '파일 쓰기 판정에 불필요한 네트워크를 열었다');
});

// ── ③ 승인 뒤에도 승인한 효과만 연다 ─────────────────────────────────────
test('네트워크 승인은 reach로 실행하고 로컬 쓰기까지 함께 열지 않는다', async () => {
  const { run, 부른것 } = 실행기({
    probe: 네트워크막힘,
    reach: { exitCode: 0, stdout: '200', stderr: '' },
    granted: { exitCode: 0, stdout: 'all-open', stderr: '' },
  });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });
  const r = await 손.handler({
    command: 'curl -s https://example.com',
    granted: true,
    probeResult: { command: 'curl -s https://example.com', mode: 'probe', ...네트워크막힘 },
  });
  assert.equal(r.result.stdout, '200');
  assert.deepEqual(부른것.map((x) => x.mode), ['reach'], '네트워크 승인으로 all-open granted를 열었다');
});

// ── ④ 실패를 삼키는 명령은 자동으로 안 넘긴다 (회귀) ─────────────────────
test('실패를 삼키는 명령은 네트워크 갈래로 새지 않는다', async () => {
  const { run, 부른것 } = 실행기({ probe: { exitCode: 0, stdout: '', stderr: '' } });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });

  const p = await 손.probe('curl -s https://example.com 2>/dev/null || true');
  // 계약은 **"모르면 승인 쪽"**이고 그건 그대로다. 바뀐 것은 그 계약을 세우는 방식이다 —
  // 예전엔 `changes:true`(= "바꾼다"는 **주장**)로 세웠고, 그래서 카드가 아무것도 안 바꾸는
  // 명령에 "내용을 남기거나 덮어쓰는 일이라"고 **거짓**을 말했다(라이브 실측 2026-08-15 · §7-w).
  // 이제는 판정 불능을 판정 불능으로 두고 **미상 → 무조건 카드**로 간다(오히려 조인다).
  // 그래서 여기서 무는 것도 구현 모양이 아니라 **제품 결과**다.
  assert.notEqual(p.changes, false, '「안 바꾼다」로 흘려 자동으로 보내지 않는다');
  assert.equal(toolActionKind({ toolId: 'local.terminal', args: p }), UNKNOWN_KIND);
  assert.equal(explainAuthority({ kind: UNKNOWN_KIND, toolId: 'local.terminal' }).needsApproval, true,
    'exit 0 을 못 믿는 명령은 모르면 승인 쪽이다');
  assert.ok(!부른것.some((x) => x.mode === 'reach'));
});

test('실물 반례: 승인 전 POST는 로컬 sink에 한 건도 도착하지 않는다', {
  skip: !sandboxAvailable() && 'macOS sandbox reach 경로에서만 재현',
}, async () => {
  const 받은것 = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      받은것.push({ method: req.method, url: req.url, body });
      res.end('ok');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const port = server.address().port;
    const control = await fetch(`http://127.0.0.1:${port}/control`, { method: 'POST', body: 'control' });
    assert.equal(control.status, 200, 'sink 양성 대조가 서지 않았다');
    assert.equal(받은것.length, 1, 'sink가 직접 POST도 못 받는다');
    받은것.length = 0;

    const py = [
      'import socket',
      `s=socket.create_connection(("127.0.0.1",${port}))`,
      's.sendall(b"POST /pwned HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\nContent-Length: 14\\r\\n\\r\\nt5-reach-proof")',
      's.close()',
    ].join(';');
    const command = `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -c ${JSON.stringify(py)}`;
    const 손 = makeLocalTerminalTool({ cwd: '/tmp' });
    const p = await 손.probe(command, { cwd: '/tmp', timeoutMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(받은것.length, 0, `승인 전에 외부 효과가 도착했다: ${JSON.stringify(받은것)}`);
    assert.notEqual(p.changes, false, 'POST를 실행하고 read로 분류했다');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('실물 반례: 로컬 쓰기 승인으로 네트워크까지 함께 열리지 않는다', {
  skip: !sandboxAvailable() && 'macOS sandbox effect profile 경로에서만 재현',
}, async () => {
  const 받은것 = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      받은것.push({ method: req.method, url: req.url, body });
      res.end('ok');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const port = server.address().port;
    const dir = await mkdtemp(join(tmpdir(), 't5-write-grant-'));
    const py = [
      'import socket',
      `s=socket.create_connection(("127.0.0.1",${port}))`,
      's.sendall(b"POST /scope-widened HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\nContent-Length: 14\\r\\n\\r\\nt5-write-grant")',
      's.close()',
    ].join(';');
    const command = `echo made > made.txt && PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -c ${JSON.stringify(py)}`;
    const 손 = makeLocalTerminalTool({ cwd: dir });
    const p = await 손.probe(command, { cwd: dir, timeoutMs: 10_000 });
    assert.equal(p.changes, true, '전제: 첫 효과는 로컬 쓰기로 확인돼야 한다');

    await 손.handler({ command, cwd: dir, granted: true, probeResult: p.probe });
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(await readFile(join(dir, 'made.txt'), 'utf8'), 'made\n', '승인한 로컬 쓰기가 실행되지 않았다');
    assert.equal(받은것.length, 0, `파일 승인으로 네트워크까지 열렸다: ${JSON.stringify(받은것)}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
