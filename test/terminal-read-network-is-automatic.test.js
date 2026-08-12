// **읽기성 네트워크는 묻지 않는다** — 오너 결정 2026-08-06(터미널 유보 해제).
//
// ── 무엇이 유보였나 (라이브로 갈랐다) ──────────────────────────────────────
// 계획서 v3.1 §20·§22 는 *"임의 명령 실행은 계속 유보"* 라고 적어 뒀다. **코드에 그런 유보는
// 없다** — `terminal-run.js` 는 셸을 통째로 주고 명령 목록도 없다. 실제 마찰은 다른 자리였다:
//
//   되돌릴 수 있는 쓰기   카드 없음 · 그냥 실행됐다 (라이브 확인: 파일이 생겼다)
//   읽기성 네트워크        **카드가 떴다** (`curl -s -o /dev/null https://example.com`)
//
// `curl` 조회·`git pull`·`npm ls`·`gh pr list` 는 이 컴퓨터를 하나도 안 바꾼다. 자동성 헌장의
// 넷(비밀값·되돌릴 수 없는 파괴·새 상대 첫 전송·돈) 어디에도 안 걸린다. 그런데 물었다.
//
// 그리고 **웹 손은 이미 임의 주소로 자동 GET 을 한다**(`web.collect`). 같은 일을 터미널에서만
// 물었다 — 능력의 문제가 아니라 두 손이 다른 선을 쓰던 것이다.
//
// ── 고칠 재료가 이미 다 있었다 ────────────────────────────────────────────
//   `sandbox.js`   `reach` 모드 = 쓰기✗ · 네트워크✓ · 비밀✗   ← 있는데 터미널이 안 썼다
//   `terminal-run.js` `executionBlock` 이 `why:'network'` 를 따로 낸다  ← 가를 재료도 있었다
//
// 둘을 이으면 끝이다. 명령 목록을 만들지 않는다(§sandbox.js 첫 문단 — 목록은 항상 뚫린다).
// 판정은 그대로 **돌려 보고 안다**: 네트워크에만 막혔으면 네트워크만 열고 다시 돌린다.
//
// ── 안 여는 것 ────────────────────────────────────────────────────────────
// 쓰기·비밀·시그널·AppleEvent 는 reach 에서도 그대로 닫힌다. 그래서 "아무것도 안 바꿨다"는
// 증명이 유지된다. 바꾸려는 명령은 여전히 승인으로 간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

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

// ── ① 네트워크로만 막힌 명령은 자동으로 돈다 ────────────────────────────
test('읽기성 네트워크는 카드를 안 띄운다 — reach 로 다시 돌려 사실을 낸다', async () => {
  const { run, 부른것 } = 실행기({
    probe: 네트워크막힘,
    reach: { exitCode: 0, stdout: '200', stderr: '' },
  });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });

  const p = await 손.probe('curl -s -o /dev/null -w "%{http_code}" https://example.com');
  assert.equal(p.changes, false, '네트워크만 막힌 것은 "바꾸려 했다"가 아니다 — 카드로 가면 안 된다');

  const r = await 손.handler({ command: 'curl -s -o /dev/null -w "%{http_code}" https://example.com' });
  assert.ok(!r.blocked, `막히면 안 된다: ${r.userSafeSummary}`);
  assert.equal(r.result.stdout, '200', '실제로 돈 결과가 와야 한다');
  assert.deepEqual(부른것.map((x) => x.mode), ['probe', 'reach', 'probe', 'reach'],
    'probe 로 재 보고 네트워크만 막혔으면 reach 로 한 번 더 — granted 를 쓰지 않는다');
});

// ── ② 쓰기로 막힌 명령은 그대로 승인으로 간다 (회귀) ─────────────────────
test('바꾸려는 명령은 여전히 묻는다 — 유보 해제가 쓰기를 열지 않는다', async () => {
  // **`reach` 도 쓰기를 막는다**(`sandbox.js` 의 `deny file-write*` 는 reach 조건 밖이다).
  // 그래서 열어 봐도 같은 벽에 막히고, 그 사실이 "이건 진짜 변경 시도"라는 증명이 된다.
  const { run, 부른것 } = 실행기({ probe: 쓰기막힘, reach: 쓰기막힘 });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });

  const p = await 손.probe('touch 유보.txt');
  assert.equal(p.changes, true, '쓰기 시도는 그대로 변경으로 읽어야 한다');

  const r = await 손.handler({ command: 'touch 유보.txt' });
  assert.equal(r.blocked, true);
  assert.equal(r.needsGrant, true, '승인 카드로 가야 한다');
  assert.match(r.userSafeSummary, /파일을 바꾸는 일/, '카드 이유는 probe 가 말한 그대로여야 한다');
  // 열어 본 것 자체는 맞다 — 알아맞히지 않고 돌려 보는 것이 이 설계다.
  assert.ok(부른것.some((x) => x.mode === 'reach'), '알아맞히지 말고 열어 봐야 한다');
});

// ── ③ 네트워크를 연 뒤에도 바꾸려 하면 묻는다 ───────────────────────────
test('네트워크를 열었더니 이번엔 파일을 바꾸려 하면 — 거기서 묻는다', async () => {
  const { run } = 실행기({ probe: 네트워크막힘, reach: 쓰기막힘 });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });

  const r = await 손.handler({ command: 'curl -s https://example.com -o 받은것.html' });
  assert.equal(r.blocked, true, 'reach 에서 쓰기에 막히면 그때는 승인이다');
  assert.equal(r.needsGrant, true);
});

// ── ④ 실패를 삼키는 명령은 자동으로 안 넘긴다 (회귀) ─────────────────────
test('실패를 삼키는 명령은 네트워크 갈래로 새지 않는다', async () => {
  const { run, 부른것 } = 실행기({ probe: { exitCode: 0, stdout: '', stderr: '' } });
  const 손 = makeLocalTerminalTool({ run, cwd: '/tmp' });

  const p = await 손.probe('curl -s https://example.com 2>/dev/null || true');
  assert.equal(p.changes, true, 'exit 0 을 못 믿는 명령은 모르면 승인 쪽이다');
  assert.ok(!부른것.some((x) => x.mode === 'reach'));
});
