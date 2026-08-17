// **C2 반대시험 — 같은 원장·같은 답을 두 번 재지 않는다**(상태 지도 §12-C2 · turn.js:2469·696).
//
// `완료주장검증` 은 한 턴에 두 자리에서 돈다:
//   · 걸음 루프의 `목적미달()`  — **되게 만드는** 자리(손 전량으로 되돌린다)
//   · 출구의 `출구검증()`       — **정직하게 말하게 하는** 자리(answerOnly 로 되돌린다)
// 두 역할은 서로 다르므로 **둘 다 남는다.** 다만 자가 같으면 답도 같다 — 인자만 보는 순수
// 함수다. 그런데 부를 때마다 `JSON.stringify([이번턴영수증, 앞턴교환, 대화 전체 원장])` 을 새로
// 만들고 그 위에서 이름·명령 대조를 처음부터 다시 돌린다. 원장이 길수록 그대로 비용이다.
//
// 오픈북:
//   헤르메스 `agent/iteration_budget.py:45-49`(`refund`) — 같은 걸음을 두 번 값 매기지 않으려고
//     있는 자리. 두 번 세는 것을 고치는 방식이 "세는 자리를 없애기"가 아니라 "되돌리기"다.
//   클로드코드(나) — 같은 입력에 같은 판정을 두 번 계산하지 않는다.
//
// 재는 것은 **계산 횟수 하나**다. 그물의 세기는 아래 ②③ 이 따로 지킨다 —
// **출구 그물을 약하게 만들면 그건 수리가 아니라 제거다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 손 하나를 쓰고 원장과 어긋나지 않는 답을 내는 대본(그물이 안 무는 정상 턴). */
async function 무대(최종답 = '자료를 읽었어요.') {
  const dir = await mkdtemp(join(tmpdir(), 'c2-once-'));
  await writeFile(join(dir, '자료.txt'), '내용');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{
          providerCallId: 'call_1', name: 'local.file', args: { action: 'read', path: join(dir, '자료.txt') },
        }] };
      }
      return 최종답;
    },
  };
  return { dir, localFile, model };
}

test('C2 — 같은 원장·같은 답이면 완료 대조가 한 턴에 한 번만 계산된다', async () => {
  const { localFile, model } = await 무대();
  const ctx = { env: demoEnv(), tools: demoTools({ localFile }), model };
  await runTurn({ text: '자료 읽어줘' }, ctx);
  // 진단면 계측 — `ctx.출구그물`·`ctx.화면자리지연` 과 같은 자리다(§10 계측기).
  const 셈 = ctx.완료검증셈;
  assert.ok(셈, '완료 대조 계측기가 없다 — 두 번 도는지 셀 수가 없다');
  assert.ok(셈.잰것 + 셈.재사용 >= 2,
    `이 대본으로는 완료 대조가 ${셈.잰것 + 셈.재사용}번밖에 안 불려 C2 를 못 잰다`);
  assert.equal(셈.잰것, 1,
    `같은 원장·같은 답인데 ${셈.잰것}번 계산했다 — 대화 전체 원장을 그만큼 다시 직렬화한다`);
});

test('C2 — 출구 그물은 그대로다: 원장에 없는 완료 주장은 여전히 모델에게 돌아간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c2-net-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 받은사실 = [];
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.completionMismatch) { 받은사실.push(tc.completionMismatch); return '아직 못 했어요.'; }
      // 원장에 없는 명령을 **글로만** 적는다(라이브 실측 2026-08-04 의 그 모양).
      return '터미널에서 직접 확인해 볼게요.\n\n```bash\nls -al ~/문서모음\n```';
    },
  };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile }), model };
  const r = await runTurn({ text: '폴더 좀 봐줘' }, ctx);
  assert.ok(받은사실.length >= 1,
    `답에 명령만 적고 안 돌렸는데 출구 그물이 안 물었다 — 재사용이 그물을 약하게 만들었다: ${JSON.stringify(r.reply)}`);
  assert.equal(ctx.modelCallAccounting.records.filter((x) => x.purpose === 'completion_repair').length, 1,
    '완료 불일치 되부름이 회계에서 빠졌거나 두 번 기록됐다');
  assert.deepEqual(ctx.modelCallAccounting.records.map((x) => x.purpose), ['primary', 'completion_repair'],
    '첫 답과 완료 보정 두 호출의 목적·순서가 회계와 어긋났다');
});

test('C2 — 재사용은 한 턴 안에서만이다(지난 턴 판정을 물려받지 않는다)', async () => {
  const { localFile, model } = await 무대();
  const ctx = { env: demoEnv(), tools: demoTools({ localFile }), model };
  await runTurn({ text: '자료 읽어줘' }, ctx);
  assert.equal(ctx.완료검증셈.잰것, 1, '첫 턴에서 대조가 한 번 돌아야 이 시험이 성립한다');
  // 두 번째 턴도 **자기 턴의 것만** 센다. 0 이면 지난 턴 판정을 물려받은 것이고,
  // 2 면 메모도 계측도 턴을 넘어 쌓인 것이다 — 둘 다 재사용이 턴 경계를 넘은 모양이다.
  await runTurn({ text: '자료 한 번 더 봐줘' }, ctx);
  assert.equal(ctx.완료검증셈.잰것, 1,
    `두 번째 턴의 대조 계산이 ${ctx.완료검증셈.잰것}번이다 — 재사용이 턴 경계를 넘었다`);
});

test('C2 — 두 자리는 그대로 있다(되게 만드는 자리와 말하게 하는 자리는 다르다)', async () => {
  const turn = await readFile(join(뿌리, 'src/kernel/turn.js'), 'utf8');
  assert.match(turn, /사실\.completionMismatch = \{ 사실: 검증\.모델에게/,
    '걸음 루프가 목적미달 사실을 모델에게 주는 자리가 사라졌다 — 그건 재사용이 아니라 제거다');
  assert.match(turn, /ctx\.출구되돌림 = true/,
    '출구가 "한 턴에 한 번" 계약을 잃었다');
  assert.match(turn, /if \(검증\.일치\) return reply/,
    '출구가 대조 결과로 갈리는 자리를 잃었다');
});
