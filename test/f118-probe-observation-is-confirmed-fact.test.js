// F-118 — 성공한 읽기 probe 의 관측이 원장에서 「추정」으로 분류된다.
//
// 선빨강(기계 사실): A0 계약(local-terminal.js 머리 주석)은 *"probe 성공 → 아무것도 안
// 바꿨다는 증명. 그대로 답한다"* 이고 제품은 실제로 그 결과로 사용자에게 답한다.
// 그런데 성공 갈래가 `applied:false`(local-terminal.js `실제로돌았나` = granted|reach 만)를
// 실으므로 `확인된사실()` 이 떨어지고, `projectReceipts()` 의 else 갈래가 그 관측을
// **estimated(호출 없이 모델 지식으로만 답한 경우)** 로 민다. 한 제품에 두 진실이 선다:
//   · 턴 중 "[이번 턴 실행 사실]" 스트림(turn-surface.js:71)에서 실측이 빠진다
//   · 최종 답 분류(turn.js·server.js projectReceipts 5곳)에서 실측이 「추정」이 된다
// 라이브 증상(2026-08-15 · 그냥써본다 10회): 터미널을 잡은 회차도 "지금까지 확인한 것만
// 보면" 류의 자신 없는 답으로 끝났다.
//
// 수리 방향(유도·사실 채움): applied 의 뜻(변경이 실렸나)은 그대로 둔다 — 뒤집으면
// 2026-08-03(실패 삼킨 쓰기가 confirmed 로 섬)이 재개봉된다. 대신 성공한 probe 가
// 이미 증명한 사실 하나(`probeChangedNothing` — 막힌 갈래에는 이미 있는 칸)를 성공
// 갈래에도 싣고, 원장은 그 사실이 있으면 「변경 없이 확인됨」으로 센다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { receipt } from '../src/kernel/l0-evidence/tool-receipt.js';
import { 확인된사실, projectReceipts } from '../src/kernel/l0-evidence/ledger.js';

/** 성공한 읽기 probe 를 실물 경로(도구 핸들러)로 만든다 — 결과 모양을 지어내지 않는다. */
async function 읽기probe영수증() {
  const tool = makeLocalTerminalTool({
    // probe 모드로 돌아 진짜 stdout 을 낸 읽기 명령의 실행기 사실.
    // sandboxed 는 실행기가 실제로 sandbox-exec 로 감쌌을 때만 싣는 증명이다
    // (terminal-run.js — 아래 ⑧ 이 실물 실행기가 정말 이 칸을 내는지 문다).
    run: async (command, { mode }) => ({ mode, exitCode: 0, stdout: '     232 시작문서/새-세션에게-보낼-메세지.md', stderr: '', durationMs: 12, sandboxed: true }),
    sandboxAvailable: () => true,
  });
  const r = await tool.handler({ command: 'wc -l 시작문서/*.md' });
  return receipt({
    intended: 'local.terminal',
    actualCall: { tool: 'local.terminal', args: { command: 'wc -l 시작문서/*.md' } },
    result: r.result,
    userSafeSummary: r.userSafeSummary,
  });
}

test('① 성공한 읽기 probe 는 확인된 사실이다 — 제품이 그 결과로 답하기 때문이다', async () => {
  const rec = await 읽기probe영수증();
  assert.equal(rec.lifecycle, 'delivered');
  assert.equal(확인된사실(rec), true,
    'A0 로 사용자에게 답한 관측이 원장에서 확인으로 안 선다 — 한 제품에 두 진실');
});

test('② 그 관측은 추정 칸으로 가지 않는다', async () => {
  const rec = await 읽기probe영수증();
  const p = projectReceipts([rec]);
  assert.equal(p.estimated.length, 0, '실측이 「호출 없이 모델 지식으로만 답한 경우」로 분류됐다');
  assert.equal(p.confirmed.length, 1);
});

test('③ 확인 문장은 변경을 주장하지 않는다 — 손이 낸 원문이 그대로 실린다', async () => {
  // 2026-08-03 반례를 다시 열지 않는 조건: `cp … 2>/dev/null || true` 처럼 실패를 삼킨
  // 명령도 같은 갈래로 오는데, 그 확인이 「변경이 일어났다」로 읽히면 안 된다.
  // 커널이 문구를 덧붙이지 않는다(§24 · 감시자 지적: 작문 과잉) — 손이 이미
  // '확인만 했어요 — 아직 아무것도 바꾸지 않았어요.' 를 말하고, 확인 칸은 그 원문이다.
  const rec = await 읽기probe영수증();
  const p = projectReceipts([rec]);
  assert.ok(!/실행했어요/.test(p.confirmed[0] ?? ''), '확인 문장이 실행(변경)을 주장한다');
  assert.match(p.confirmed[0] ?? '', /확인만 했어요|바꾸지 않았어요/,
    '변경 없음 사실이 확인 문장에 없다 — 손의 원문이 안 실렸다');
});

test('⑤ 반례: granted 로 실제 실행한 것에는 「변경 없음 증명」 칸이 없다', async () => {
  // 성공 갈래는 granted·reach·probe 가 공유한다 — 무조건 실으면 실제로 바꾼 명령에
  // "변경 없음"이 붙는다(감시자 지적 1). granted 는 applied:true 로 이미 확인이다.
  const tool = makeLocalTerminalTool({
    run: async (command, { mode }) => ({ mode, exitCode: 0, stdout: '', stderr: '', durationMs: 5 }),
    sandboxAvailable: () => true,
  });
  const r = await tool.handler({ command: 'mkdir 새폴더', granted: true });
  assert.equal(r.result.probeChangedNothing, undefined, 'granted 실행에 변경 없음 증명이 붙었다');
  assert.equal(r.result.applied, true);
});

test('⑥ 반례: 샌드박스가 없는 호스트에서는 「변경 없음 증명」이 서지 않는다', async () => {
  // 샌드박스의 부재를 안전의 증거로 읽지 않는다(terminal-run.js — 무샌드박스면 생 zsh).
  // 증명 없는 관측은 오늘까지의 규칙 그대로 미확인으로 남는다.
  const tool = makeLocalTerminalTool({
    run: async (command, { mode }) => ({ mode, exitCode: 0, stdout: '10 a.md', stderr: '', durationMs: 5 }),
    sandboxAvailable: () => false,
  });
  const r = await tool.handler({ command: 'wc -l a.md' });
  assert.equal(r.result?.probeChangedNothing, undefined, '샌드박스 없이 돈 것이 변경 없음 증명을 얻었다');
  const rec = receipt({
    intended: 'local.terminal',
    actualCall: { tool: 'local.terminal', args: { command: 'wc -l a.md' } },
    result: r.result, userSafeSummary: r.userSafeSummary,
  });
  assert.equal(확인된사실(rec), false, '증명 없는 관측이 확인으로 섰다 — 경계가 넓어졌다');
});

test('⑦ 반례: 가용성이 참이어도 실행기 증명이 없으면 「변경 없음 증명」이 서지 않는다', async () => {
  // 라벨(mode)·가용성(sandboxAvailable) 기준 구현과 증명(sandboxed) 기준 구현을 가르는 자.
  // 샌드박스가 "있다"고 조회돼도 이 실행이 실제로 그 안에서 돌았다는 건 실행기만 안다
  // (손 관리자 지적: terminal-run.js 는 라벨을 그대로 돌려준다 — 라벨은 증명이 아니다).
  const tool = makeLocalTerminalTool({
    run: async (command, { mode }) => ({ mode, exitCode: 0, stdout: '10 a.md', stderr: '', durationMs: 5 }),
    sandboxAvailable: () => true,
  });
  const r = await tool.handler({ command: 'wc -l a.md' });
  assert.equal(r.result?.probeChangedNothing, undefined,
    '실행기 증명 없이 변경 없음이 섰다 — 라벨·가용성으로 걸었다');
});

test('⑧ 실물 실행기는 샌드박스로 감쌌을 때만 sandboxed 증명을 낸다', async () => {
  // 스텁의 전제를 실물로 고정한다 — 실행기가 이 칸을 안 내면 위 검사들은 헛것을 문다.
  const { runCommand } = await import('../src/runtime/terminal-run.js');
  const { sandboxAvailable } = await import('../src/runtime/sandbox.js');
  const r = await runCommand('printf 증명', { mode: 'probe', timeoutMs: 10_000 });
  assert.equal(r.exitCode, 0);
  if (sandboxAvailable()) {
    assert.equal(r.sandboxed, true, '샌드박스로 돌았는데 증명 칸이 없다');
  } else {
    // 샌드박스 없는 호스트: 생 zsh 로 돌았으므로 증명이 없어야 한다(부재를 증거로 안 읽음).
    assert.equal(r.sandboxed, undefined, '샌드박스 없이 돌았는데 증명이 섰다');
  }
});

test('④ 반례: 변경 없음 증명이 없는 applied:false 는 여전히 확인이 아니다', () => {
  // probeChangedNothing 없이 applied:false 만 있는 영수증(다른 손·granted 실패 계열)은
  // 그대로 미확인이어야 한다 — 이 수리가 경계를 넓히지 않았다는 반례 고정.
  const rec = receipt({
    intended: 'local.terminal',
    actualCall: { tool: 'local.terminal', args: { command: 'cp a b' } },
    result: { exitCode: 0, applied: false },
    userSafeSummary: '`cp a b` 실행',
  });
  assert.equal(확인된사실(rec), false, '변경 없음 증명 없는 applied:false 가 확인으로 섰다 — 경계가 넓어졌다');
});
