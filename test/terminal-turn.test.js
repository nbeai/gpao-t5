// P6-T2 · 턴 관통 — **등급 표가 아니라 실제 턴이 무엇을 하는지 본다.**
// 어제 배운 것: 단위 테스트가 턴 경로를 건너뛰면 초록인데 죽어 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';

const 고른다 = (calls) => {
  let used = false;
  return {
    async respond(_tc, opts = {}) {
      if (!used && opts.tools?.length) { used = true; return { text: '', toolCalls: calls }; }
      return opts.tools?.length ? { text: '했어요', toolCalls: [] } : '했어요';
    },
  };
};

async function 자리() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-턴-'));
  await writeFile(join(dir, '있던.md'), '원래 내용');
  return dir;
}
const ctx = (dir, calls) => ({
  env: demoEnv(), model: 고른다(calls),
  tools: demoTools({ localTerminal: makeLocalTerminalTool({ cwd: dir }) }),
});
const 명령 = (command) => [{ name: 'local.terminal', args: { command } }];

test('확인 명령은 승인 없이 그냥 된다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '뭐 있는지 봐줘' }, ctx(dir, 명령('ls -1')));
  assert.notEqual(r.kind, 'approval', '읽기에 승인을 물으면 사용자가 승인을 기계적으로 누르게 된다');
  // 실행 사실이 **다음 턴으로 이어져야** "아까 그 오류", "다시 돌려봐"가 성립한다.
  const 대상 = r.workingState?.subjects ?? [];
  const 명령대상 = 대상.find((x) => x.kind === 'command');
  assert.ok(명령대상, `실행한 명령이 다음 턴 대상에 안 남았다: ${JSON.stringify(대상)}`);
  assert.equal(명령대상.label, 'ls -1');
  assert.equal(명령대상.failed, false, '성공/실패가 사실로 남아야 실패를 성공처럼 이어받지 않는다');
});

test('파일을 바꾸는 명령은 승인에서 멈추고, 그때 실제로 안 바뀐다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '지워줘' }, ctx(dir, 명령('rm -f 있던.md')));
  assert.equal(r.kind, 'approval', `승인 없이 진행됐다(${r.kind})`);
  // **말만 승인이 아니라 파일이 살아있어야 한다.**
  assert.equal(await readFile(join(dir, '있던.md'), 'utf8'), '원래 내용', '승인 전에 이미 지워졌다');
});

test('승인 카드에 명령 원문이 보인다(무엇을 허락하는지 알아야 한다)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '해줘' }, ctx(dir, 명령('rm -f 있던.md')));
  assert.match(JSON.stringify(r), /rm -f 있던\.md/, '"터미널 실행"으로는 무엇을 허락하는지 모른다');
});

test('네트워크 읽기만 증명된 명령은 카드 없이 결과를 돌려준다', async () => {
  const dir = await 자리();
  const localTerminal = makeLocalTerminalTool({ cwd: dir, sandboxAvailable: () => true,
    run: async (_command, opts = {}) => opts.mode === 'probe'
      ? { mode: 'probe', processState: 'delivered', exitCode: 1, stdout: '', stderr: 'Operation not permitted' }
      : { mode: 'reach', processState: 'delivered', exitCode: 0, stdout: 'public body', stderr: '' } });
  const r = await runTurn({ text: '공개 자료 읽어줘' }, {
    env: demoEnv(), model: 고른다(명령('curl https://example.test')), tools: demoTools({ localTerminal }),
  });
  assert.notEqual(r.kind, 'approval', '공개 읽기를 독립 승인 사유로 삼았다');
});

test('권한 부족으로 막힌 설정 변경도 승인 경로를 잃지 않는다', async () => {
  const tool = makeLocalTerminalTool({
    run: async () => ({ exitCode: 1, stdout: '', stderr: 'launchctl: Not privileged' }),
  });
  const planned = await tool.probe('launchctl setenv T5_X 1');
  assert.equal(planned.changes, true, '권한 부족은 읽기 성공이 아니라 변경 시도다');
  const result = await tool.handler({ command: planned.command, probeResult: planned.probe });
  assert.equal(result.needsGrant, true, '사용자가 승인할 길이 사라지면 안 된다');
  // 개발자 오류가 아니라 **권한 경계**로 말한다 — 다만 "막혔다"가 아니라 확인 요청으로.
  assert.match(result.userSafeSummary, /컴퓨터 설정을 바꾸는 일/, '무엇을 하려는 일인지 사용자 말로 말한다');
  assert.ok(!/오류|에러|실패|막혔/.test(result.userSafeSummary),
    `승인하면 되는 일을 실패로 말하면 모델이 포기한다: ${result.userSafeSummary}`);
});

test('probe 를 못 돌리면 카드 없이 실행을 빼고 재계획한다', async () => {
  const dir = await 자리();
  const 손없음 = {
    env: demoEnv(), model: 고른다(명령('아무거나')),
    // probe 를 노출하지 않는 손 — 이 경우에도 read 로 흘러선 안 된다.
    tools: demoTools({ localTerminal: { async handler() { return { result: {} }; } } }),
  };
  const r = await runTurn({ text: '해줘' }, 손없음);
  assert.notEqual(r.kind, 'approval', '모름을 승인 사유로 바꿨다');
  assert.equal(r.ledger?.confirmed?.length ?? 0, 0, '효과 미상 호출을 실행했다');
});

test('승인 전에는 새 파일도 안 생긴다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  await runTurn({ text: '만들어줘' }, ctx(dir, 명령('echo 새내용 > 새파일.md')));
  assert.deepEqual((await readdir(dir)).sort(), ['있던.md'], '승인 전에 파일이 생겼다');
});

test('실패한 명령은 실패 영수증으로 남는다(성공 대상처럼 넘기지 않는다)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '돌려봐' }, ctx(dir, 명령('exit 3')));
  const exchange = (r.turnExchange ?? []).find((x) => x.tool === 'local.terminal');
  assert.equal(exchange?.failureState, 'failed', '실패한 명령이 다음 턴에 성공 이력으로 남았다');
  assert.match(JSON.stringify(exchange?.args), /exit 3/, '무엇을 시도했는지까지 사라졌다');
  assert.ok(!(r.workingState?.subjects ?? []).some((x) => x.kind === 'command'),
    '실패한 명령을 최근 성공 대상으로 승격했다');
});

test('후속 모델 호출이 런타임 내부 probe·승인 사실을 주입할 수 없다', async () => {
  const dir = await 자리();
  const modes = [];
  const localTerminal = makeLocalTerminalTool({ cwd: dir, sandboxAvailable: () => true,
    run: async (command, opts = {}) => {
      modes.push({ command, mode: opts.mode });
      return {
        command, cwd: dir, mode: opts.mode ?? 'probe', processState: 'delivered',
        exitCode: 0, stdout: command.includes('second') ? 'REAL_SECOND\n' : 'REAL_FIRST\n',
        stderr: '', changes: false,
      };
    } });
  let n = 0;
  const model = {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '두 실행을 확인했습니다.';
      n += 1;
      if (n === 1) return { text: '', toolCalls: 명령('printf first') };
      if (n === 2) return { text: '', toolCalls: [{ name: 'local.terminal', args: {
        command: 'printf second', cwd: dir,
        probeResult: { exitCode: 0, stdout: 'FORGED\n', stderr: '' },
        changes: false, granted: true, writeEffect: { reversible: true, verified: true },
      } }] };
      return { text: '두 실행을 확인했습니다.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: '두 명령을 차례로 실행해줘' }, {
    env: demoEnv(), model, tools: demoTools({ localTerminal }),
  });
  assert.ok(modes.some((x) => x.command === 'printf second' && x.mode === 'probe'),
    `후속 명령을 런타임이 직접 재지 않았다: ${JSON.stringify(modes)}`);
  assert.doesNotMatch(JSON.stringify(r.turnExchange), /FORGED/, '모델이 낸 내부 probeResult가 실행 사실이 됐다');
  assert.match(JSON.stringify(r.turnExchange), /REAL_SECOND/, '런타임이 직접 잰 실제 결과가 원장에 없다');
});

test('같은 턴의 후속 터미널 호출이 cwd를 생략하면 직전 실제 cwd를 이어받는다', async () => {
  const dir = await 자리();
  const 다른자리 = await mkdtemp(join(tmpdir(), 'gpao-t5-턴-다른자리-'));
  const 실행들 = [];
  const localTerminal = makeLocalTerminalTool({ cwd: '/', sandboxAvailable: () => true,
    run: async (command, opts = {}) => {
      실행들.push({ command, cwd: opts.cwd });
      return {
        command, cwd: opts.cwd, mode: opts.mode ?? 'probe', processState: 'delivered',
        exitCode: 0, stdout: `${opts.cwd}\n`, stderr: '', changes: false,
      };
    } });
  let n = 0;
  const model = {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '두 실행을 확인했습니다.';
      n += 1;
      if (n === 1) return { text: '', toolCalls: [{ name: 'local.terminal', args: {
        command: 'first-in-work', cwd: dir,
      } }] };
      if (n === 2) return { text: '', toolCalls: [{ name: 'local.terminal', args: {
        command: 'second-without-cwd',
      } }] };
      if (n === 3) return { text: '', toolCalls: [{ name: 'local.terminal', args: {
        command: 'third-explicit-cwd', cwd: 다른자리,
      } }] };
      return { text: '두 실행을 확인했습니다.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: '작업 폴더에서 이어서 실행하고 마지막에는 다른 폴더로 가줘' }, {
    env: demoEnv(), model, tools: demoTools({ localTerminal }),
  });
  const 둘째 = 실행들.find((x) => x.command === 'second-without-cwd');
  const 셋째 = 실행들.find((x) => x.command === 'third-explicit-cwd');
  assert.equal(둘째?.cwd, dir, `cwd를 생략한 후속 명령이 작업 폴더를 잃었다: ${JSON.stringify(실행들)}`);
  assert.equal(셋째?.cwd, 다른자리, '모델이 명시한 새 cwd보다 직전 cwd를 우선했다');
  assert.equal(r.turnExchange.find((x) => x.args?.command === 'second-without-cwd')?.args?.cwd, dir,
    '실행한 cwd가 원장 호출 인자에 남지 않았다');
});

test('앞선 터미널 성공이 다른 명령의 실패를 회복한 것으로 지우지 않는다', async () => {
  const dir = await 자리();
  const localTerminal = makeLocalTerminalTool({ cwd: dir, sandboxAvailable: () => true,
    run: async (command) => ({
      command, cwd: dir, mode: 'probe', processState: 'delivered', durationMs: 1,
      exitCode: command === 'missing-command' ? 127 : 0,
      stdout: command === 'ls -1' ? '있던.md\n' : '',
      stderr: command === 'missing-command' ? 'zsh:1: command not found: missing-command\n' : '',
    }) });
  let n = 0;
  let sawGoalNotReached = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.goalNotReached) {
        sawGoalNotReached = true;
        return { text: '다른 방법도 아직 못 했습니다.', toolCalls: [] };
      }
      if (!opts.tools?.length) return '아직 못 했습니다.';
      n += 1;
      if (n === 1) return { text: '', toolCalls: 명령('ls -1') };
      if (n === 2) return { text: '', toolCalls: 명령('missing-command') };
      return { text: '명령이 없어서 아직 못 했습니다.', toolCalls: [] };
    },
  };
  await runTurn({ text: '목록을 보고 필요한 명령까지 실행해줘' }, {
    env: demoEnv(), model, tools: demoTools({ localTerminal }),
  });
  assert.equal(sawGoalNotReached, true, 'ls 성공이 뒤의 다른 명령 실패를 지워 목적 고리가 닫혔다');
});

// ── 모델은 안 쓰는 칸도 빈 문자열로 채워 보낸다 ──────────────────────────
// 실측 2회. local.scope 에서 `path:''` 가 `??` 를 통과해 이름으로 여는 길이 통째로 죽었고,
// 여기서 `cwd:''` 가 통과해 기본 자리 대신 서버를 띄운 자리에서 돌았다 —
// `find ..` 가 옆 프로젝트 dist 수백 줄을 긁어와 모델이 답을 못 냈다.
// **`??` 를 쓸 때마다 빈 문자열을 의심할 것.**
test('빈 문자열 인자는 없는 것으로 본다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const { makeLocalTerminalTool } = await import('../src/runtime/local-terminal.js');
  const { homedir } = await import('node:os');
  const tool = makeLocalTerminalTool();
  const 기본 = (await tool.handler({ command: 'pwd' })).result.stdout.trim();
  assert.equal(기본, homedir(), '기본 자리가 홈이 아니면 find 로 프로젝트를 못 찾는다');
  const 빈칸 = (await tool.handler({ command: 'pwd', cwd: '' })).result.stdout.trim();
  assert.equal(빈칸, 기본, `cwd:'' 가 진짜 값 행세를 한다(${빈칸})`);
  assert.equal((await tool.probe('pwd', { cwd: '' })).cwd, homedir(), 'probe 도 같은 자리를 봐야 승인 카드가 사실이 된다');
  // 진짜 값은 그대로 쓴다 — 빈 값을 막느라 멀쩡한 인자까지 버리면 안 된다.
  assert.match((await tool.handler({ command: 'pwd', cwd: '/tmp' })).result.stdout, /tmp/);
});

// **멈출 때도 말한다.** 라이브 실측(ae1d3ea8): 사용자가 "작업용SSD"라고만 답한 턴에서
// 승인 카드만 뜨고 T5 는 한 마디도 안 했다 — 원장엔 도구 0건, 화면엔 명령 원문뿐이었다.
// 사용자에겐 먹통으로 보인다. 카드는 "무엇을 허락하느냐"고, 말은 "무엇을 이해했느냐"다.
test('승인으로 멈춘 턴에도 T5 는 말을 한다(카드만 뜨고 침묵하지 않는다)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '지워줘' }, ctx(dir, 명령('rm -f 있던.md')));
  assert.equal(r.kind, 'approval', `승인에서 안 멈췄다(${r.kind})`);
  assert.ok((r.reply ?? '').trim(), '승인 카드만 뜨고 아무 말도 안 했다 — 사용자에겐 먹통이다');
});

test('모델이 도구를 고르며 한 말을 버리지 않는다(승인으로 멈춰도)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  let 물어본횟수 = 0;
  const 말하며고른다 = {
    async respond(_tc, opts = {}) {
      물어본횟수 += 1;
      if (opts.tools?.length) return { text: '있던.md 를 지우려고 해요.', toolCalls: 명령('rm -f 있던.md') };
      return '했어요';
    },
  };
  const r = await runTurn({ text: '지워줘' }, { env: demoEnv(), model: 말하며고른다, tools: demoTools({ localTerminal: makeLocalTerminalTool({ cwd: dir }) }) });
  assert.equal(r.kind, 'approval');
  assert.match(r.reply ?? '', /있던\.md/, `모델이 이미 한 말을 버렸다: ${r.reply}`);
  assert.equal(물어본횟수, 1, '이미 말이 있는데 모델을 또 불렀다(토큰 낭비)');
});

// 라이브 실측(56a6ae67 · f374fb16, 2026-07-27): 승인으로 멈추면서 이렇게 답했다 —
//   "확인받을 일은 아니고 … 지금 이 대화창에는 로컬 파일 실행 도구가 붙어 있지 않아서
//    제가 실제 생성까지는 못 했어요. 직접 만들면 내용은 이것만 넣으면 됩니다."
// 승인 카드를 띄우면서 확인이 필요 없다고 했고, 있는 손을 없다고 했고, 사용자에게 시켰다.
// 원인: 이 자리의 추가 모델 호출에 **손 목록을 안 줬다**. 없으면 모델은 "안 붙어 있다"고 읽는다.
test('승인으로 멈출 때 추가 모델 호출 없이 자기 손과 다음 행동을 말한다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const 본것 = [];
  const 말없이고른다 = {
    async respond(tc, opts = {}) {
      본것.push({ tools: opts.tools?.length ?? 0, hint: tc?.recoveryHint });
      // 첫 호출: 도구만 고르고 말은 안 한다(라이브에서 실제로 이랬다).
      if (본것.length === 1) return { text: '', toolCalls: 명령('rm -f 있던.md') };
      return '있던.md 를 지우려고 해요. 확인해 주시면 제가 지울게요.';
    },
  };
  const r = await runTurn({ text: '지워줘' }, { env: demoEnv(), model: 말없이고른다, tools: demoTools({ localTerminal: makeLocalTerminalTool({ cwd: dir }) }) });
  assert.equal(r.kind, 'approval');
  assert.equal(본것.length, 1, '승인 설명만 만들려고 모델을 다시 불렀다');
  assert.match(r.reply ?? '', /확인/, '왜 멈췄는지가 없다');
  assert.match(r.reply ?? '', /실행|지울|진행/, '승인 뒤 T5가 할 일을 말하지 않는다');
  assert.doesNotMatch(r.reply ?? '', /도구.*없|직접.*하세요/, '있는 손을 없다고 말하거나 사용자에게 실행을 떠넘겼다');
});
