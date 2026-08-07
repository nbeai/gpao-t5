// **손이 낸 그림이 답을 만드는 자리까지 간다.**
//
// 오너 질책(2026-08-07): *"이전까지 멀쩡하게 되던 걸 지금은 안 된다고 하고…"*
// 밟았더니 회귀가 아니었다. **처음부터 끊겨 있었다.**
//
// ```
// 손이 그림을 낸다              out.그림 = 55,892B      O
// 옆길이 받는다                 그림받기 호출           O
// 이번턴그림 에 담긴다           Map.set                O
// 답을 만드는 buildTaskContext   이번턴그림 을 안 넘김   ★ 여기
// ```
//
// `turn.js:1919` 는 `receipts` 는 넘기면서 `이번턴그림` 을 안 넘겼다. 뒤쪽 두 자리(2206·2461)
// 에만 있었다. 그래서 **모델은 그림을 한 번도 본 적이 없다.**
//
// 아침에 계산기를 읽은 것은 접근성 트리가 그 창을 잡아서 **글자로** 읽은 것이다.
// 오너가 아침 커밋으로 되돌려 재 봤을 때도 못 읽었다 — 판 통과는 그 환경에서만 참이었고,
// **그림 경로는 그때도 끊겨 있었다.** 검사가 함수를 직접 부르면 이 자리를 못 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('답을 만드는 자리가 이번 턴 그림을 넘긴다 — 여기가 비면 그림은 영영 안 간다', () => {
  const 글 = readFileSync(fileURLToPath(new URL('../src/kernel/turn.js', import.meta.url)), 'utf8');
  const 담는곳 = (글.match(/이번턴그림\.set\(/g) ?? []).length;
  assert.ok(담는곳 > 0, '그림을 담는 자리가 사라졌다');
  // `buildTaskContext` 로 넘기는 자리마다 그림이 함께 가야 한다.
  const 넘기는곳 = 글.split('buildTaskContext({').slice(1);
  const 빠진곳 = 넘기는곳
    .map((조각, i) => [i, 조각.slice(0, 1800)])
    // 이번 턴 영수증을 싣는 자리만 본다 — 계획 전 자리는 그림이 있을 수 없다.
    .filter(([, 조각]) => /receipts:\s*turnReceipts/.test(조각))
    .filter(([, 조각]) => !/이번턴그림/.test(조각))
    .map(([i]) => `buildTaskContext #${i + 1}`);
  assert.deepEqual(빠진곳, [],
    `**이번 턴 영수증은 싣고 그림은 안 싣는 자리가 있다** — 모델이 화면을 못 본다:\n${빠진곳.join('\n')}`);
});

test('그림을 호출 신분으로도 걸어 둔다 — 객체 동일성은 언젠가 깨진다', () => {
  const 글 = readFileSync(fileURLToPath(new URL('../src/kernel/turn.js', import.meta.url)), 'utf8');
  assert.match(글, /이번턴그림\.set\((?:신분\.)?providerCallId|providerCallId,\s*방금그림|신분\.providerCallId/,
    '**객체 하나에만 건다** — 영수증이 한 번만 복사돼도 그림이 조용히 사라진다');
});
