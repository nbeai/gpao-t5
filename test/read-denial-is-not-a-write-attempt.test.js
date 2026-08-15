// **「모른다」를 「바꾼다」로 승격하면 카드가 사용자에게 거짓말을 한다.**
//
// 라이브 실측(2026-08-15 · §7-v · 같은 발화 2/2 재현): 오너가 *"로그 폴더에 최근 에러 있는지
// 봐줘"* 라고 했고, 모델이 고른 명령은 **아무것도 안 바꾸는 읽기**였다:
//
//   cd ~ && find . -maxdepth 6 -type f \( -name '*log*' … \) 2>/dev/null | head -50
//
// 승인 카드가 떴고 **사용자는 답을 못 받았다.** 카드가 이렇게 말했다:
//   why "내용을 남기거나 덮어쓰는 일이라 실행 전에 확인받아요"  ← 거짓. 바뀌는 것이 없다
//
// 기제(코드로 밟았다 · 첫 진단은 틀렸고 감시자가 잡았다):
//   방아쇠는 `Permission denied` 가 **아니다.** 명령 안의 `2>/dev/null` 이다 —
//   `실패를삼킴`(terminal-run.js:192)이 물어 `why:'unreadable_exit'` 가 되고, 그 문장은
//   **정직하다**("실패해도 성공처럼 끝나서 시험만으로는 결과를 알 수 없어요").
//   거짓은 그 다음 한 곳에서 생긴다 — `changes: looksBlocked(r)`(local-terminal.js:147)가
//   **「막혔다」를 「바꾼다」로 승격**하고, 그것이 kind 'write' → "덮어쓰는 일"이 된다.
//
// **승인을 없애는 수리가 아니다.** 미상은 자동 탈출구가 없어(authority.js:212) write 보다
// 오히려 조인다. 규칙은 그대로다 — **모르면 승인으로 가되, 모른다고 말한다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionBlock } from '../src/runtime/terminal-run.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { explainAuthority, UNKNOWN_KIND } from '../src/kernel/l2-plan/authority.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';

// 라이브 원본이 남긴 명령 그대로다(지어낸 문자열이 아니다).
const 실측명령 = "cd ~ && find . -maxdepth 6 -type f \\( -name '*log*' -o -name '*.out' -o -name '*.err' \\) 2>/dev/null | head -50";

test('실패를 삼키는 명령의 판정은 「모른다」다 — 이 문장 자체는 정직하다', () => {
  const b = executionBlock({ command: 실측명령, exitCode: 0, stdout: '', stderr: '' });
  assert.equal(b.why, 'unreadable_exit');
  assert.doesNotMatch(b.userWhy, /바꾸는 일|덮어쓰/, '도구는 이미 사실대로 말하고 있다');
});

test('모름을 「바꾼다」로 승격하지 않는다 — 그래야 카드가 거짓을 안 말한다', async () => {
  const 손 = makeLocalTerminalTool({
    sandboxAvailable: () => true,
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });
  const p = await 손.probe(실측명령, { cwd: '/x' });
  assert.notEqual(p.changes, true, '「바꾼다」는 주장이다 — 증명 못 했으면 안 세운다');
  assert.notEqual(p.changes, false, '「안 바꾼다」도 주장이다 — 자동으로 흘리지 않는다');
  // 그리고 그 결과가 등급까지 이어져야 한다. 여기가 끊기면 고친 것이 안 닿는다.
  assert.equal(toolActionKind({ toolId: 'local.terminal', args: p }), UNKNOWN_KIND);
});

test('반대시험 — 진짜 막힌 쓰기는 그대로 「바꾼다」다 (안전이 안 깎인다)', async () => {
  const 손 = makeLocalTerminalTool({
    sandboxAvailable: () => true,
    run: async () => ({ exitCode: 1, stdout: '', stderr: 'zsh: operation not permitted: out.txt' }),
  });
  const p = await 손.probe('echo x > out.txt', { cwd: '/x' });
  assert.equal(p.changes, true, '쓰려다 막힌 것은 바꾸려 한 증거다');
  assert.equal(toolActionKind({ toolId: 'local.terminal', args: p }), 'write');
});

// ── 둘째 갈래 (라이브 12-57-57 에서 재현 · §7-x-3) ────────────────────────
// 같은 거짓 문장을 내는 갈래가 **둘**이었다. 첫 라이브가 unreadable_exit 를 먼저 밟았을 뿐이다.
// 이 회차의 명령에는 `2>/dev/null` 이 없다:
//   find . -maxdepth 3 -type f \( -iname '*log*' -o -iname '*error*' \) -print
// 그런데 카드가 **"파일을 바꾸는 일이라"**고 말했다 — catch-all(terminal-run.js) 이
// `Permission denied|operation not permitted|EPERM|EACCES` 를 전부 `why:'write'` 로 단정한다.
// `find` 가 **읽을 수 없는 폴더**를 만나면 그 말이 나온다. 증거는 「막혔다」뿐이다.
test('읽다가 막힌 것을 「바꾸려던 것」으로 단정하지 않는다', () => {
  const b = executionBlock({ command: 'find . -type f -print', exitCode: 1, stdout: '', stderr: 'find: ./Library/Mail: Permission denied' });
  assert.equal(b.kind, 'sandbox', '막힌 것은 사실이므로 승인 경로는 그대로다');
  assert.notEqual(b.why, 'write', '증거는 「막혔다」뿐이다 — 「바꾸려 했다」는 주장이다');
  assert.doesNotMatch(b.userWhy, /바꾸는 일|덮어쓰/, '사용자에게 거짓을 말하지 않는다');
});

test('반대시험 — 쓰려 했다는 증거가 있으면 그대로 write 다 (보존 시험)', () => {
  // 막힌 이름이 **명령이 쓰려던 자리**(리다이렉트 대상)면 그건 추측이 아니라 증거다.
  // 이 칸은 수리 전에도 초록이고 수리 후에도 초록이어야 한다 — 안전이 안 깎였다는 증명이다.
  // (`Read-only file system` 을 새로 잡는 것은 **이번 사용자 결과에 필요 없는 신규 탐지**라
  //  뺐다 — 문구 목록 확장은 이 저장소가 이미 버린 방식이다. 감시자 조정 3 · §7-y 표에 「안 밟음」)
  const b = executionBlock({ command: 'echo x > out.txt', exitCode: 1, stdout: '', stderr: 'zsh: operation not permitted: out.txt' });
  assert.equal(b.why, 'write');
});

test('미상 승인 카드는 모른다고 말하고, 승인은 그대로 요구한다', () => {
  const r = explainAuthority({ kind: UNKNOWN_KIND, toolId: 'local.terminal' });
  assert.equal(r.needsApproval, true, '모르면 승인으로 — 이 규칙은 안 바뀐다');
  assert.doesNotMatch(r.why, /덮어쓰는 일|밖으로 나가는 일/, '안 밟은 사실을 카드에 적지 않는다');
  assert.match(r.why, /확정/, '왜 묻는지를 사실대로 말한다');
});
