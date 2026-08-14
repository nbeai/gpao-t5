// 터미널 · **전달조차 안 된 것을 「명령이 없다」고 말하지 않는다** (라이브 4회차 실측 2026-08-13)
//
// 밟은 사실(실모델 gpt-5.1 · 4회 중 2회 재현):
//   모델이 없는 작업 폴더를 줬다 — `cwd: "/home/work"`
//   spawn 이 실패했다(프로세스에 전달조차 안 됨):
//     {"command":"logstat --help","cwd":"/home/work","exitCode":-1,"durationMs":36,
//      "stdout":"","stderr":"실행을 시작하지 못했어요: spawn /usr/bin/sandbox-exec ENOENT",
//      "failedBy":"env","failReason":"missing","applied":false}
//   T5 는 그것을 **"그 명령이 이 컴퓨터에 없어요"** 라고 말했다. 같은 회차에서 `printf` 에도
//   똑같이 말했다 — printf 는 이 컴퓨터에 있다. **거짓 진단이다.**
//   그리고 `다음수단` 이 비어 있어 이어갈 길이 하나도 없었다. 모델은 그 말을 믿고 같은
//   잘못된 자리로 세 번 더 갔고 과업이 통째로 실패했다.
//
// 닫는 문장: **터미널이 실행되지 못했을 때, T5 는 못 한 이유를 사실대로 말하고
//            이어갈 수 있는 자리를 준다.**
//
// 반대시험을 같이 문다 — 진짜로 없는 명령은 **여전히** `missing` 이어야 한다.
// 그게 없으면 갈래를 가른 게 아니라 뭉갠 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executionBlock } from '../src/runtime/terminal-run.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

/** 이 컴퓨터에 확실히 없는 자리. 라이브의 `/home/work` 와 같은 모양이다. */
const 없는자리 = () => {
  const p = join(tmpdir(), `gpao-t5-없는자리-${process.pid}-${Math.random().toString(36).slice(2)}`);
  assert.equal(existsSync(p), false, '전제: 이 자리는 없어야 한다');
  return p;
};

test('spawn 이 실패한 것을 「명령이 없다」로 부르지 않는다 (라이브 실측 객체 그대로)', () => {
  const 실측 = {
    command: 'logstat --help', cwd: '/home/work', exitCode: -1, durationMs: 36,
    stdout: '', stderr: '실행을 시작하지 못했어요: spawn /usr/bin/sandbox-exec ENOENT',
  };
  const b = executionBlock(실측);
  assert.notEqual(b?.why, 'missing',
    '전달조차 안 된 것을 「그 명령이 없다」로 분류했다 — 모델은 있는 명령을 포기한다');
  assert.notEqual(b?.userWhy, '그 명령이 이 컴퓨터에 없어요',
    '거짓 진단이다. printf 에도 같은 말을 했다(라이브 실측)');
});

test('없는 자리라는 것을 알면 그 사실을 말한다', () => {
  const cwd = 없는자리();
  const b = executionBlock({
    command: 'printf "3\\t1\\n"', cwd, exitCode: -1,
    stdout: '', stderr: '실행을 시작하지 못했어요: spawn /usr/bin/sandbox-exec ENOENT',
  });
  assert.equal(b?.kind, 'env', '승인해도 달라지지 않는 자리다 — env 그대로');
  assert.equal(b?.why, 'cwd_missing', `못 돈 이유를 사실로 안 부른다: ${JSON.stringify(b)}`);
  assert.match(b?.userWhy ?? '', /자리/, `무엇이 없었는지 안 말한다: ${b?.userWhy}`);
  assert.ok(!/명령이 이 컴퓨터에 없어요/.test(b?.userWhy ?? ''), '거짓 진단이 남아 있다');
});

test('반대시험 · 진짜로 없는 명령은 여전히 missing 이다', () => {
  assert.equal(executionBlock({ exitCode: 127, stderr: 'zsh: command not found: pytest', stdout: '' })?.why,
    'missing', '갈래를 가른 게 아니라 뭉갰다 — 진짜 없는 명령을 못 알아본다');
  assert.equal(executionBlock({ exitCode: 127, stderr: 'zsh: command not found: pytest', stdout: '' })?.userWhy,
    '그 명령이 이 컴퓨터에 없어요');
});

test('local.terminal · 없는 자리로 부르면 사실을 말하고 이어갈 자리를 준다', async () => {
  const 기본자리 = await mkdtemp(join(tmpdir(), 'gpao-t5-기본자리-'));
  const 없는곳 = 없는자리();
  const r = await makeLocalTerminalTool({ cwd: 기본자리 })
    .handler({ command: 'printf "3\\t1\\n"', cwd: 없는곳, timeoutMs: 8000 });

  assert.equal(r.result.exitCode, -1, '전제: spawn 이 실패해야 한다');
  assert.notEqual(r.result.failReason, 'missing',
    `있는 명령(printf)을 「없다」고 적었다: ${JSON.stringify(r.result)}`);
  assert.ok(!/명령이 이 컴퓨터에 없어요/.test(r.userSafeSummary),
    `거짓 진단을 사용자에게 말한다: ${r.userSafeSummary}`);

  // **이어갈 자리를 준다.** 말만 바꾸고 길을 안 주면 모델은 같은 자리로 또 간다(실측 3회).
  assert.ok(Array.isArray(r.result.다음수단) && r.result.다음수단.length,
    `못 한 이유만 말하고 이어갈 자리를 안 줬다: ${JSON.stringify(r.result)}`);
  assert.ok(r.result.다음수단.some((m) => m?.cwd === 기본자리),
    `도구가 아는 자리를 알면서 안 줬다: ${JSON.stringify(r.result.다음수단)}`);

  // **만든 것과 닿은 것은 다르다.** 모델 입력까지 실제로 가는지 본다.
  assert.match(String(compactResult(r.result) ?? ''), new RegExp(기본자리.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    '결과에는 실었는데 모델 입력에는 안 간다');
});

test('반대시험 · local.terminal 은 진짜 없는 명령을 여전히 「없다」고 말한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-없는명령-'));
  const r = await makeLocalTerminalTool({ cwd: dir })
    .handler({ command: 'gpao-t5-이런명령은-없다-a1b2c3 --help', timeoutMs: 8000 });
  assert.equal(r.result.failedBy, 'env');
  assert.equal(r.result.failReason, 'missing',
    `진짜 없는 명령을 못 알아본다 — 갈래를 뭉갠 것이다: ${JSON.stringify(r.result)}`);
  assert.match(r.userSafeSummary, /명령이 이 컴퓨터에 없어요/);
  assert.equal(r.result.다음수단, undefined, '멀쩡한 자리에서 자리 이야기를 꺼내면 소음이다');
});
