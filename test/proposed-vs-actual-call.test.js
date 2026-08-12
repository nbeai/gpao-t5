// **제안과 실행은 다른 칸이다** — 부르지 않은 호출을 "실제 호출"로 기록하지 않는다.
//
// 계약(`contracts.js`): `actualCall` 은 *"호출 안 했으면 null"*.
//
// 그런데 다중 호출 줄 세우기(2026-08-04)를 넣으면서 `못한호출남기기` 가 **미실행 호출에도**
// `actualCall` 을 채웠다. 이유는 있었다 — 그래야 모델이 자기 호출을 돌려받는다. 하지만
// 그건 **다른 칸이 필요했던 것**이지 이 칸을 쓸 이유가 아니다. 지금 상태는 원장이
// "부르지 않은 것"을 "부른 것"으로 말한다. **원장이 거짓이면 셀프후드도 말귀도 그 위에 못 선다.**
//
// 어휘는 이미 있었다: `task-context` 가 실패한 호출의 인자를 `attemptedWith`
// (*"실패한 시도의 제안값(확인된 사실 아님)"*)로 싣는다. 같은 구분을 영수증에도 세운다.
//
// ── 두 가지를 **동시에** 지켜야 한다 ──────────────────────────────────────
//   ① 원장이 정직하다 — 안 부른 것은 `actualCall: null`
//   ② 모델이 자기 호출을 잃지 않는다 — 신분·인자·이유가 그대로 돌아간다
// ①만 지키면 조용한 축소가 돌아오고, ②만 지키면 원장이 거짓이 된다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 같은 손을 같은 인자로 두 번 내는 턴 — 두 번째는 중복이라 **실행되지 않는다**. */
/** 무대는 **한 번만** 세운다 — 같은 턴을 네 번 돌릴 이유가 없다. */
let 한번;
const 되풀이턴 = () => (한번 ??= 되풀이턴만들기());

async function 되풀이턴만들기() {
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 'proposed-')));
  const 영수증들 = [];
  const 받은칸 = [];
  const 같은호출 = (i) => ({
    providerCallId: `call_${i}`, name: 'local.file', args: { action: 'list', path: 방 },
  });
  const model = {
    async respond(tc, opts = {}) {
      받은칸.push(tc);
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !this.냈나) {
        this.냈나 = true;
        return { text: '', toolCalls: [같은호출(1), 같은호출(2)] };
      }
      return '봤어요.';
    },
  };
  const ledger = { entries: [], append(rec) { 영수증들.push(rec); return rec; } };
  await runTurn({ text: '이 폴더 두 번 봐줘' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [방], dataDir: 방 }) }),
    model, ledger,
  });
  return { 영수증들, 받은칸 };
}

test('부르지 않은 호출의 영수증은 **`actualCall` 이 null 이다**', async () => {
  const { 영수증들 } = await 되풀이턴();
  const 안부른것 = 영수증들.filter((r) => (r?.failureState ?? 'none') !== 'none');
  assert.ok(안부른것.length > 0, '이 시험이 성립하려면 못 부른 호출이 하나는 있어야 한다');
  for (const r of 안부른것) {
    assert.equal(r.actualCall, null,
      `부르지 않았는데 "실제 호출"로 기록됐다 — 원장이 거짓이다: ${JSON.stringify(r.actualCall)}`);
  }
});

test('그래도 모델은 **자기 호출을 돌려받는다**(신분·인자·이유)', async () => {
  const { 영수증들 } = await 되풀이턴();
  const 안부른것 = 영수증들.filter((r) => (r?.failureState ?? 'none') !== 'none');
  for (const r of 안부른것) {
    assert.ok(r.제안한호출, '모델이 낸 호출이 어디에도 안 남았다 — 조용한 축소가 돌아온다');
    assert.equal(r.제안한호출.tool, 'local.file');
    assert.ok(r.제안한호출.providerCallId || r.제안한호출.callRef,
      '신분이 없다 — 모델은 자기가 시킨 것과 못 잇는다');
    assert.ok(String(r.userSafeSummary ?? '').trim(), '왜 안 했는지가 사람 말로 없다');
  }
});

test('실제로 부른 호출은 `actualCall` 이 있다(과잉 적용 금지)', async () => {
  const { 영수증들 } = await 되풀이턴();
  const 부른것 = 영수증들.filter((r) => (r?.failureState ?? 'none') === 'none' && r?.result !== undefined);
  assert.ok(부른것.length > 0, '실행이 하나도 없다 — 이 시험이 반대 방향을 못 잰다');
  for (const r of 부른것) {
    assert.ok(r.actualCall?.tool, '실제로 부른 호출인데 actualCall 이 비었다');
  }
});

test('모델 입력에도 그 호출이 **자기 것으로** 돌아간다', async () => {
  const { 받은칸 } = await 되풀이턴();
  const 전문 = JSON.stringify(받은칸);
  assert.match(전문, /call_1|call_2/,
    '못 부른 호출의 공급자 신분이 모델 입력에서 사라졌다 — 모델은 둘을 시켰다고 믿은 채 답을 쓴다');
});
