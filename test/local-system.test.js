// P-OP-1 A · 이 컴퓨터가 지금 어떤 상태인가
//
// 실측(오너 라이브 2026-07-28, 웹 화면): "컴퓨터가 요즘 느린데, 바꾸지 말고 원인만 봐줘."
// T5 는 부하·메모리·발열·디스크까지 읽고도 **무엇이 CPU 를 먹는지는 못 봤고**,
// "Activity Monitor 에서 CPU 탭 보시면 돼요"라고 사용자에게 떠넘겼다.
//
// 원인은 권한이 아니라 구조였다 — `/bin/ps` 는 setuid root 라 `sandbox-exec` 가 실행 자체를
// 거부한다. 규칙으로 못 연다. 그래서 셸·샌드박스를 안 거치되, 위험은 다른 방식으로 없앤다.
//
// 불변식:
//   ① 사용자 말이 명령에 들어갈 자리가 없다 — 명령·인자를 T5 가 고정 조립한다
//   ② **명령 인자를 읽지 않는다** — `--token=…` 같은 비밀이 거기 산다
//   ③ 읽기만 한다 — 승인이 필요 없고, 아무것도 바뀌지 않는다
//   ④ 못 봤으면 원문을 사용자면에 옮기지 않고 다음 길을 준다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topProcesses, makeLocalSystemTool } from '../src/runtime/local-system.js';
import { demoDescriptors } from '../src/surface/demo-context.js';

/** 진짜 ps 를 안 돌리는 대역 — 무엇을 어떤 인자로 부르려 했는지 기록한다. */
function 가짜ps(stdout, { fail } = {}) {
  const 기록 = [];
  const run = (file, args, opts, cb) => {
    기록.push({ file, args });
    setImmediate(() => cb(fail ? new Error(fail) : null, stdout ?? ''));
  };
  return { run, 기록 };
}

const 표 = [
  '  PID  %CPU %MEM COMM',
  '58549 103.7  2.1 /usr/local/bin/openclaw',
  ' 1156  41.6  3.4 /Applications/Claude.app/Contents/MacOS/Claude Helper',
  '  412  34.9  0.3 /System/Library/PrivateFrameworks/SkyLight.framework/WindowServer',
].join('\n');

test('명령과 인자를 T5 가 고정 조립한다 — 사용자 말이 들어갈 자리가 없다', async () => {
  const 가짜 = 가짜ps(표);
  await topProcesses({ run: 가짜.run, limit: 3 });
  const c = 가짜.기록[0];
  assert.equal(c.file, '/bin/ps', '셸을 거치면 거기가 새는 자리다');
  assert.ok(Array.isArray(c.args), '인자가 문자열이면 주입 경로가 생긴다');
  // **`comm` 이지 `command`/`args` 가 아니다** — 인자에 섞인 비밀을 안 읽는다
  assert.ok(c.args.includes('pid,pcpu,pmem,comm'), `인자 형식이 바뀌었다: ${c.args.join(' ')}`);
  assert.ok(!c.args.some((a) => /command|args/.test(a)), '명령 인자를 읽으면 비밀이 딸려 온다');
});

test('실행 파일 이름만 남고 전체 경로·인자는 안 남는다', async () => {
  const 가짜 = 가짜ps(표);
  const r = await topProcesses({ run: 가짜.run, limit: 3 });
  assert.deepEqual(r.processes.map((p) => p.name), ['openclaw', 'Claude Helper', 'WindowServer']);
  assert.ok(!JSON.stringify(r).includes('/usr/local/bin'), '전체 경로가 프롬프트를 먹는다');
  assert.equal(r.processes[0].cpu, 103.7, '숫자는 사용자가 판단할 근거라 남는다');
  assert.equal(r.total, 3);
});

test('사용자가 준 값이 커도 상한을 넘지 않는다', async () => {
  const 많은표 = ['  PID  %CPU %MEM COMM',
    ...Array.from({ length: 200 }, (_, i) => `${i + 1} 1.0 1.0 /bin/p${i}`)].join('\n');
  const r = await topProcesses({ run: 가짜ps(많은표).run, limit: 9999 });
  assert.ok(r.processes.length <= 40, `상한이 없다: ${r.processes.length}`);
  assert.equal(r.total, 200, '전체 개수는 사실대로');
});

test('못 봤으면 원문을 사용자면에 옮기지 않고 다음 길을 준다', async () => {
  const tool = makeLocalSystemTool({ run: 가짜ps('', { fail: 'EACCES /bin/ps 어쩌고' }).run });
  const out = await tool.handler({});
  assert.equal(out.failed, true);
  assert.ok(!out.userSafeSummary.includes('EACCES'), '기계 말이 사용자면에 샜다');
  assert.equal(out.diagnosticTrace.includes('EACCES'), true, '진단면에는 남아야 원인을 좁힌다');
  assert.ok(out.nextSafeAction, '막다른 답으로 끝났다');
});

test('읽기 손이라 승인을 요구하지 않는다 — 아무것도 바꾸지 않으니까', () => {
  const d = demoDescriptors().find((x) => x.id === 'local.system');
  assert.ok(d, '선언이 없으면 모델이 못 본다');
  assert.equal(d.toolKind, 'read');
  assert.equal(d.needsApproval, false);
  assert.ok(d.operatorFact, 'T5 가 먼저 맡을 수 있는 일로 안 보인다');
});

test('사람 말로 답한다 — 숫자는 주되 기계 말은 없다', async () => {
  const tool = makeLocalSystemTool({ run: 가짜ps(표).run });
  const out = await tool.handler({ limit: 2 });
  assert.match(out.userSafeSummary, /openclaw/);
  assert.match(out.userSafeSummary, /103\.7/);
  for (const 기계말 of ['pcpu', 'comm', 'exitCode', 'stdout', '%CPU']) {
    assert.ok(!out.userSafeSummary.includes(기계말), `기계 말: ${기계말}`);
  }
});

// 실측(오너 라이브 2026-07-28, 웹 화면): `ps -p 63447 …` 이 승인 카드로 갔고, 카드가
// **"내용을 남기거나 덮어쓰는 일이라"** 고 말했다. ps 는 아무것도 안 바꾼다 —
// setuid 라 exec 자체가 거부된 것이고, 승인해도 달라지지 않는다.
// 목록이 아니라 사실로 가른다: 막힌 이름이 **명령 자리**면 아무것도 안 돈 것이다.
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

test('실행 자체가 거부된 것을 "바꾸려 했다"로 읽지 않는다', async () => {
  const 대역 = (stderr) => async () => ({ exitCode: 1, stdout: '', stderr, command: undefined });
  const 자리별 = [
    ['ps -p 1 -o pid,comm', 'zsh:1: operation not permitted: ps', false, '읽기인데 승인으로 갔다'],
    ['ps aux | head -3', 'zsh:1: operation not permitted: ps', false, '파이프 뒤도 명령 자리다'],
    ['echo hi > out.txt', 'zsh:1: operation not permitted: out.txt', true, '상대경로 쓰기를 놓쳤다'],
    ['echo x > /usr/bin/ps', 'zsh:1: operation not permitted: /usr/bin/ps', true, '실행파일에 쓰는 것도 쓰기다'],
    ['launchctl setenv X 1', 'Not privileged to set domain environment.', true, '설정 변경 승인 경로가 사라졌다'],
  ];
  for (const [cmd, stderr, 승인기대, 왜] of 자리별) {
    const tool = makeLocalTerminalTool({
      run: async (c) => ({ exitCode: 1, stdout: '', stderr, command: c }),
    });
    const p = await tool.probe(cmd, {});
    assert.equal(Boolean(p.changes), 승인기대, `${왜}: ${cmd}`);
  }
});

test('못 띄운 이유를 사람 말로 말한다 — 없는 변경을 지어내지 않는다', async () => {
  const { executionBlock } = await import('../src/runtime/terminal-run.js');
  const b = executionBlock({ exitCode: 1, command: 'ps aux', stderr: 'zsh:1: operation not permitted: ps' });
  assert.equal(b.kind, 'env');
  assert.match(b.userWhy, /아무것도 실행되지 않았어요/);
  for (const 거짓 of ['덮어쓰', '남기거나', '되돌리기 어려']) {
    assert.ok(!b.userWhy.includes(거짓), `없는 변경을 말했다: ${거짓}`);
  }
});

// 실측(오너 라이브 2026-07-28): "t5demo-idle 라는 게 돌고 있는데, 그거 꺼줘."
// T5 는 `local.process` 만 써보고 "그런 건 못 찾았어요"로 끝냈다. 정작 그 프로세스를 볼 수
// 있는 손(`local.system`)이 있는데 쓰지 않았다.
// 원인은 모델이 아니라 **선언이 실제보다 넓었던 것**이다 — 그 손은 T5 가 켠 것만 아는데
// 선언은 "계속 도는 것을 …끈다"로 읽혔다. 선언이 실제보다 넓으면 모델에게 하는 거짓말이다.
test('local.process 선언이 자기 범위를 사실대로 말한다', () => {
  const d = demoDescriptors().find((x) => x.id === 'local.process');
  const 전문 = `${d.capability} ${d.schema.description} ${d.operatorFact}`;
  assert.match(전문, /T5 가 켠 것/, '남의 프로세스까지 다루는 것처럼 읽힌다');
  assert.match(전문, /local\.system/, '못 찾았을 때 어디를 봐야 하는지가 없다');
});

test('T5가 켠 것이 아니면 막다른 답 대신 다음 길을 준다', async () => {
  const { makeLocalProcessTool } = await import('../src/runtime/local-process.js');
  const tool = makeLocalProcessTool({
    store: { find: async () => [], list: async () => [], update: async () => {} },
  });
  for (const action of ['stop', 'logs']) {
    const r = await tool.handler({ action, target: '남이켠프로그램' });
    assert.ok(r.failed || r.blocked, `${action}: 못 찾았는데 성공으로 남았다`);
    assert.match(r.userSafeSummary, /제가 켠 것 중에는/, `${action}: 범위를 안 밝혔다`);
    assert.ok(r.nextSafeAction?.includes('돌고 있는 것'), `${action}: 다음 길이 없다`);
  }
});
