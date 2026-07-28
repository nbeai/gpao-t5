// P-OP-1 A · **probe 는 시험이어야 한다**
//
// 실측 사고(오너 라이브 2026-07-28, 웹 화면):
//   사용자: "그럼 그거 꺼줘."
//   화면:   "종료 명령이 probe 모드라 실제 적용은 안 됐어요 (applied:false)"
//   실제:   openclaw 가 죽었다
//
// 세 겹이 한 번에 뚫렸다:
//   ① probe 샌드박스가 시그널을 안 막았다 — 파일 쓰기와 네트워크만 막고 있었다
//   ② 그래서 `changes:false` 로 읽혔다. 승인 카드가 안 떴다
//   ③ 원장에 `applied:false` 로 남았다 — 이미 벌어진 일을 안 벌어진 것으로 기록했다
//
// 목록을 늘려 고치지 않는다(`killall` 을 막으면 `pkill` 로 뚫린다).
// **효과의 종류**를 닫고, 막힌 사실을 정확한 이름으로 부른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandboxProfile } from '../src/runtime/sandbox.js';
import { executionBlock, runCommand } from '../src/runtime/terminal-run.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

test('probe 자리는 남의 프로세스를 건드릴 수 없다', () => {
  const p = sandboxProfile('probe', { secrets: [] });
  assert.match(p, /\(deny signal\)/, '시그널이 열려 있으면 probe 는 시험이 아니라 실행이다');
  assert.match(p, /\(deny appleevent-send\)/, '다른 앱을 원격 조종하는 통로가 열려 있다');
  // reach 도 읽기 자리다 — 같은 보장이 필요하다
  assert.match(sandboxProfile('reach', { secrets: [] }), /\(deny signal\)/);
  // granted 는 승인을 받은 뒤다. 여기까지 막으면 "꺼줘"를 영영 못 한다(능력 축소 금지)
  assert.ok(!/\(deny signal\)/.test(sandboxProfile('granted', { secrets: [] })));
});

test('끄려다 막힌 것을 "파일을 바꾸려 했다"로 말하지 않는다', () => {
  const 문구들 = [
    'zsh:kill:1: kill 123 failed: operation not permitted',
    'killall: warning: kill -term 123: Operation not permitted',
    'pkill: signalling pid 123: Operation not permitted',
  ];
  for (const stderr of 문구들) {
    const b = executionBlock({ exitCode: 1, command: 'killall x', stderr });
    assert.equal(b.why, 'signal', `막힌 종류를 못 알아봤다: ${stderr}`);
    assert.match(b.userWhy, /끄는 일이라/);
    assert.ok(!b.userWhy.includes('파일'), `없는 변경을 말했다: ${b.userWhy}`);
  }
});

test('끄는 명령은 승인으로 간다 — 어느 도구를 쓰든', async () => {
  for (const stderr of [
    'zsh:kill:1: kill 123 failed: operation not permitted',
    'killall: warning: kill -term 123: Operation not permitted',
    'pkill: signalling pid 123: Operation not permitted',
  ]) {
    const tool = makeLocalTerminalTool({ run: async (c) => ({ exitCode: 1, stdout: '', stderr, command: c }) });
    const p = await tool.probe('killall something', {});
    assert.equal(p.changes, true, `승인 없이 지나간다: ${stderr}`);
  }
});

// **대역이 아니라 진짜로 확인한다.** 이 사고는 대역으로는 안 잡혔다 —
// 샌드박스가 실제로 무엇을 허용하는지가 문제였기 때문이다.
test('진짜 프로세스를 만들어도 probe 는 죽이지 못한다', async () => {
  const 대상 = (await runCommand('/bin/sleep 30 >/dev/null 2>&1 & echo $!', { mode: 'raw', timeoutMs: 5000 }))
    .stdout.trim();
  const pid = Number(대상);
  assert.ok(pid > 0, '시험 대상을 못 만들었다');
  try {
    for (const c of [`kill ${pid}`, 'killall sleep', 'pkill -x sleep']) {
      await runCommand(c, { mode: 'probe', timeoutMs: 8000 });
      let 살아있음 = true;
      try { process.kill(pid, 0); } catch { 살아있음 = false; }
      assert.equal(살아있음, true, `probe 가 실제로 죽였다: ${c}`);
    }
  } finally {
    try { process.kill(pid, 'SIGKILL'); } catch { /* 이미 없음 */ }
  }
});
