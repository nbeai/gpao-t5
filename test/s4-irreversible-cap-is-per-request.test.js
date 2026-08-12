// **S4 반대시험 — 되돌릴 수 없는 것 3 은 「한 요청당」이다**(상태 지도 §12-S4 · turn.js:2027).
//
// `turn-budget.js:15-17` 은 이미 규율을 적어 놓았다:
//   *"승인 재개에도 **누적**한다(리셋하면 무한이다)."*
// 그런데 지켜진 것은 왕복 축뿐이었다. 외부효과 두 칸과 벽시계는 `executePlan` 의 **지역
// 변수**라서 승인 재개가 `executePlan` 을 새로 부를 때마다 0 이 된다 — 카드가 N 번 뜨면
// 되돌릴 수 없는 실행이 **3×N** 이다. 안전 뒷단이 카드 개수만큼 늘어난다.
//
// 오픈북:
//   헤르메스 `agent/iteration_budget.py:36-44` — 예산은 객체가 들고 `consume()` 이 한 자리에서
//     깎는다. 진입마다 새로 만드는 자리가 없다(환불은 `refund()` 라는 **명시된 자리** 하나뿐).
//   클로드코드(나) — 승인 재개는 같은 요청의 이어감이고, 예산이 재개로 리셋되지 않는다.
//
// 여기서 재는 것은 **실행 횟수 하나**다. 카드가 몇 번 뜨든 되돌릴 수 없는 실행은 3 을 안 넘는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/**
 * 카드가 뜰 때마다 **새 명령**을 하나씩 내는 대본.
 * 명령이 매번 다르므로 되풀이 차단에 걸리지 않는다 — 물리는 것은 예산뿐이다.
 */
async function 무대() {
  const dir = await mkdtemp(join(tmpdir(), 's4-irrev-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 실행된명령 = [];
  const localTerminal = {
    async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) {
      실행된명령.push(a.command);
      return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '했어요.' };
    },
  };
  let 낸수 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && 낸수 < 20) {
        낸수 += 1;
        return { text: '', toolCalls: [{
          providerCallId: `call_${낸수}`, name: 'local.terminal', args: { command: `rm -rf 임시-${낸수}` },
        }] };
      }
      return '했어요.';
    },
  };
  return { dir, localFile, localTerminal, model, 실행된명령 };
}

test('S4 — 승인 카드가 여러 번 떠도 되돌릴 수 없는 실행은 상한 3 을 넘지 않는다', async () => {
  const { localFile, localTerminal, model, 실행된명령 } = await 무대();
  const ctx = { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model };

  let r = await runTurn({ text: '임시 폴더들 지워줘' }, ctx);
  assert.equal(r.kind, 'approval', '이 시험은 승인 카드가 떠야 성립한다');
  let 카드수 = 1;
  // 사용자가 계속 허락한다. 카드가 몇 번 뜨든 예산은 **한 요청의 것**이다.
  while (r.kind === 'approval' && 카드수 < 8) {
    r = await runTurn({ approve: r.pendingId }, ctx);
    if (r.kind === 'approval') 카드수 += 1;
  }

  assert.ok(카드수 >= 3,
    `카드가 ${카드수}번밖에 안 떠서 3×N 을 못 잰다 — 이 시험이 성립하려면 카드가 여러 번 떠야 한다`);
  assert.ok(실행된명령.length <= 3,
    `되돌릴 수 없는 실행이 ${실행된명령.length}번 돌았다(상한 3) — 승인 재개마다 예산이 0 으로 리셋된다: ${실행된명령.join(' · ')}`);
});

test('S4 — 새 발화는 되돌릴 수 없는 예산을 새로 연다(옛 요청이 새 요청을 굶기지 않는다)', async () => {
  const { localFile, localTerminal, model, 실행된명령 } = await 무대();
  const ctx = { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model };

  let r = await runTurn({ text: '임시 폴더들 지워줘' }, ctx);
  let 회 = 0;
  while (r.kind === 'approval' && 회 < 8) { r = await runTurn({ approve: r.pendingId }, ctx); 회 += 1; }
  const 첫요청실행 = 실행된명령.length;
  assert.ok(첫요청실행 > 0, '첫 요청에서 아무것도 안 돌아 이 시험이 성립하지 않는다');

  // **새 발화**다. 여기서 이어받으면 두 번째 요청은 아무것도 못 한다 — 그건 반대 방향의 고장이다.
  r = await runTurn({ text: '이번엔 다른 임시 폴더를 지워줘' }, ctx);
  assert.ok(r.kind === 'approval' || 실행된명령.length > 첫요청실행,
    '새 발화인데 되돌릴 수 없는 예산이 소진된 채였다 — 리셋 자리가 새 발화에 없다');
});
