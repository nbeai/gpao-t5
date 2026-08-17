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

// 실측(오너 라이브 2026-07-28): "t5demo-idle 라는 게 돌고 있는데, 그거 꺼줘."
// T5 가 대상을 정확히 찾아 놓고 **"터미널 손이 열리지 않아 제가 직접 끄지는 못했어요 —
// 터미널에서 kill 4356 실행하면 됩니다"** 라고 답했다. 터미널은 있었고 같은 턴에 실제로
// 돌기까지 했다. 턴의 도구 상한에 닿아 손을 뺐을 뿐이다.
// 같은 실패가 깃허브에서도 났다("저장소 목록 도구가 안 떠 있어").
//
// **없앤 것과 이번 턴에 못 쓰는 것은 다른 사실이다.** 그 차이를 안 주면 모델은 빈칸을
// "능력 없음"으로 메우고, 다음 문장은 늘 사용자에게 떠넘기는 말이 된다.
test('손을 거둘 때는 이유를 준다 — "없다"로 읽히지 않게', async () => {
  const { buildModelMessages } = await import('../src/runtime/model-provider.js');
  const 기본 = { currentRequest: '꺼줘', selfStateFacts: {}, authorityFacts: {} };

  const 없을때 = buildModelMessages(기본);
  assert.ok(!/이번 턴에 쓸 수 있는 손/.test(없을때.system), '평소에도 이 말이 나오면 잡음이다');

  const 다썼을때 = buildModelMessages({ ...기본, toolBudgetSpent: true });
  assert.match(다썼을때.system, /손이 없어진 게 아니라/, '손이 없다고 오해할 자리가 그대로다');
  assert.match(다썼을때.system, /다음 턴에는 다시/, '이어갈 수 있다는 사실이 없다');
});

test('상한에 닿으면 그 사실이 모델 입력까지 간다', async () => {
  const { buildTaskContext } = await import('../src/kernel/l1-intent/task-context.js');
  const 공통 = {
    intent: { currentRequest: '꺼줘' },
    selfState: { connectedTools: [], currentModel: { id: 'x' }, limits: [] },
    plan: { understoodTask: '', successCriteria: [], needsApproval: [], forbidden: [], toolsToUse: [], blockedTools: [] },
    receipts: [],
  };
  assert.equal(buildTaskContext(공통).toolBudgetSpent, undefined);
  assert.equal(buildTaskContext({ ...공통, toolBudgetSpent: true }).toolBudgetSpent, true);
});

// 실측(오너 라이브 2026-07-28): 승인 카드가 뜨고 사용자가 승인했는데 **아무 일도 안 일어났다.**
// 두 종류를 섞었기 때문이다 — 자기보존(승인해도 안 함)과 승인 경계(승인하면 함).
// 섞으면 "꺼줘"가 영영 안 된다. 그건 능력 축소다(절대원칙 §0-A).
test('승인 경계와 자기보존을 가른다 — 승인하면 실제로 실행된다', async () => {
  const { lifecycleRisk } = await import('../src/runtime/lifecycle-guard.js');

  // 자기보존: 승인해도 하지 않는다
  const 자기 = lifecycleRisk(`kill ${process.pid}`);
  assert.ok(자기 && !자기.approvable, 'T5 가 자기를 끄는 것이 승인으로 열리면 안 된다');

  // 승인 경계: 승인하면 한다
  const 남의것 = lifecycleRisk('kill 999999');
  assert.ok(남의것?.approvable, '남의 프로그램을 끄는 일이 영영 막히면 능력 축소다');

  // 승인 없이는 여전히 막힌다
  const tool = makeLocalTerminalTool({ run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
  const 승인전 = await tool.handler({ command: 'kill 999999' });
  assert.equal(승인전.blocked, true, '승인 없이 지나갔다');

  // 승인하면 실제로 돈다
  let 돌았나 = false;
  const 승인후도구 = makeLocalTerminalTool({
    run: async (c, o) => { 돌았나 = o?.mode === 'signal'; return { exitCode: 0, stdout: '', stderr: '', command: c }; },
  });
  const 승인후 = await 승인후도구.handler({ command: 'kill 999999', granted: true });
  assert.ok(!승인후.blocked, '승인했는데 아직도 막힌다');
  assert.equal(돌았나, true, '승인했는데 signal 효과 프로파일로 안 돌았다');
});

// 실측(오너 라이브 2026-07-29, A): 대상이 **실제로 죽었는데** T5 가
// `pgrep -af '<이름>'` 으로 확인하려다 그 명령을 실행하는 **셸 자신**을 후보로 잡아
// "바로 다시 살아났어요" 라고 보고하고 부모·launchd 까지 조사하겠다고 했다.
//   실제 상태 종료 · 원장 해석 생존 · 사용자 보고 재실행 · 다음 제안 더 강한 조사
// A~H 공통 계약(실행 결과·원장·답변이 같은 사실을 본다) 위반이다.
//
// 이름 패턴이 아니라 **승인받은 명령에 적힌 정확한 PID** 로 확인한다.
test('끈 것은 이름이 아니라 그 PID 로 확인한다', async () => {
  const { makeLocalTerminalTool } = await import('../src/runtime/local-terminal.js');
  const 죽은PID = 999_000_001; // 존재하지 않는 pid — alive() 가 false 를 준다
  const tool = makeLocalTerminalTool({
    // 이름 검색이 자기 자신을 잡아 "살아 있다" 처럼 보이는 상황을 그대로 재현한다
    run: async (c) => ({ exitCode: 0, stdout: `${죽은PID}\n`, stderr: '', command: c }),
  });
  const r = await tool.handler({ command: `kill ${죽은PID} && pgrep -af 'mymemo-idle'`, granted: true });

  assert.ok(r.result.terminated, '끈 대상의 상태가 사실로 안 남는다');
  assert.deepEqual(r.result.terminated, [{ pid: 죽은PID, stillRunning: false }]);
  assert.match(r.userSafeSummary, /껐어요/, `stdout 이 pid 를 뱉어도 살아있다고 말하면 안 된다: ${r.userSafeSummary}`);
  assert.ok(!/다시|살아났/.test(r.userSafeSummary));
});

test('실제로 살아 있으면 껐다고 말하지 않는다', async () => {
  const { makeLocalTerminalTool } = await import('../src/runtime/local-terminal.js');
  const tool = makeLocalTerminalTool({ run: async (c) => ({ exitCode: 0, stdout: '', stderr: '', command: c }) });
  // `run` 이 대역이라 실제로는 아무 것도 안 죽는다 — `alive()` 만 진짜로 확인한다.
  // 살아 있는 대상이 필요하니 진짜 자식을 하나 띄운다(자기 pid 는 자기보존 경계에 걸린다).
  const { spawn } = await import('node:child_process');
  const 자식 = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  자식.unref();
  try {
    const r2 = await tool.handler({ command: `kill ${자식.pid} 999000002`, granted: true, effects: ['signal'] });
    assert.ok(r2.result.terminated.some((x) => x.pid === 자식.pid && x.stillRunning === true),
      '살아 있는 대상을 죽었다고 말한다');
    assert.match(r2.userSafeSummary, /아직 돌고 있어요/);
  } finally { try { process.kill(자식.pid, 'SIGKILL'); } catch { /* 이미 없음 */ } }
});

test('승인 전(probe)이나 끄는 명령이 아니면 종료 확인을 붙이지 않는다', async () => {
  const { makeLocalTerminalTool } = await import('../src/runtime/local-terminal.js');
  const tool = makeLocalTerminalTool({ run: async (c) => ({ exitCode: 0, stdout: 'ok', stderr: '', command: c }) });
  const 읽기 = await tool.handler({ command: 'ls -la' });
  assert.equal(읽기.result.terminated, undefined, '끄는 일이 아닌데 종료 확인을 붙였다');
});
