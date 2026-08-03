// **모델이 고른 것을 런타임이 조용히 버린다** — S1 실모델 6회차가 잡은 벽.
//
// 실측(2026-08-04, gpt-5.1 · 437개 fixture · 회차 6 B팔): 모델이 한 응답에서 `local.file move`
// 를 **다섯 개** 냈다(backup-1329.png · 2071.png · 2556.png · 4078.png · 1218.svg → images/).
// 실제로 옮겨진 것은 **마지막 하나뿐**이었다. 나머지 넷은 실행도, 실패도, 사용자 고지도 없다.
//
// 벽은 **두 겹**이고, S1 의 플래그가 정확히 바깥 겹을 걷는다:
//
//   ① 심문 겹 (플래그 OFF · A 팔)
//      `turn.js` `currentRequestCalls` 가 호출 둘 이상 + 안전 바닥 후보에서 돈다. 판정이
//      흔들리면 `currentFileCallFromText` 로 떨어지고 그것도 못 잡으면 `modelChosen = []` —
//      **모델이 고른 다섯 개가 통째로 사라진다. 실행 0.**
//
//   ② 입자 겹 (양팔 공통)
//      `tool-schema.js`  toolArgs[id] = { ...(toolArgs[id] ?? {}), ...args }  ← 같은 손을 하나로 합친다
//      `turn.js`         const toolId = parts.neededTools?.[0]               ← 그중 첫 손 하나만 집는다
//      그래서 다섯을 골라도 **마지막 하나**만 실행된다.
//
// 실측 대조(같은 대본·같은 다섯 호출): A 팔 **0개** 이동 · B 팔 **1개** 이동.
// 회차 장부와 맞는다 — A 이동 0·0·0, B 이동 0·0·1.
//
// 즉 T5 의 실행 입자는 "한 걸음 = 한 파일"이 아니라 **"한 왕복 = 한 호출"** 이고,
// 걸음 상한 6과 곱하면 한 턴 최대 6개다. 437개 앞에서 구조적으로 불가능하며
// **그 불가능이 모델에게도 사용자에게도 안 보인다.**
//
// 이 검사는 그 사실을 못박는다. 고치면 여기가 먼저 빨개진다 — 그때가 기뻐할 자리다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { callsToIntentParts } from '../src/kernel/l2-plan/tool-schema.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';

const 파일들 = ['backup-1329.png', 'backup-2071.png', 'backup-2556.png', 'backup-4078.png', 'backup-1218.svg'];

test('입자 ①: 같은 손의 여러 호출이 하나로 합쳐진다(뒤가 이긴다)', () => {
  const selfState = buildSelfState(demoEnv());
  const calls = 파일들.map((f) => ({ name: 'local.file', args: { action: 'move', path: f, to: `images/${f}` } }));
  const parts = callsToIntentParts(calls, selfState);
  assert.deepEqual(parts.neededTools, ['local.file'], '손은 하나로 접힌다');
  // **다섯 개를 냈는데 인자는 하나다.** 그리고 그 하나는 마지막 것이다.
  assert.equal(parts.toolArgs['local.file'].path, 'backup-1218.svg',
    '합쳐진 인자가 마지막 호출이 아니면 이 검사의 전제가 바뀐 것이다');
  assert.equal(Object.keys(parts.toolArgs).length, 1);
});

/** 같은 대본으로 한 팔을 돌린다 — move 다섯을 한 응답에 낸다. */
async function 다섯을내본다(주객회복) {
  const 원래 = process.env.T5_MODEL_SOVEREIGN;
  if (주객회복) process.env.T5_MODEL_SOVEREIGN = '1';
  else delete process.env.T5_MODEL_SOVEREIGN;
  try {
    const dir = await mkdtemp(join(tmpdir(), 's1-wall-'));
    await mkdir(join(dir, 'images'), { recursive: true });
    for (const f of 파일들) await writeFile(join(dir, f), `내용 ${f}`);
    const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
    let 냈나 = false;
    const model = {
      async respond(tc, opts = {}) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        if (opts.tools?.length && !냈나) {
          냈나 = true;
          return { text: '', toolCalls: 파일들.map((f) => ({
            name: 'local.file', args: { action: 'move', path: join(dir, f), to: join(dir, 'images', f) },
          })) };
        }
        return '정리했어요.';
      },
    };
    const r = await runTurn({ text: 'backup 파일들 images 로 옮겨줘' },
      { env: demoEnv(), tools: demoTools({ localFile }), model });
    return { r, 옮겨진것: 파일들.filter((f) => existsSync(join(dir, 'images', f))) };
  } finally {
    if (원래 === undefined) delete process.env.T5_MODEL_SOVEREIGN;
    else process.env.T5_MODEL_SOVEREIGN = 원래;
  }
}

test('벽 ①(A 팔): 심문이 판정에 실패하면 고른 다섯이 **통째로** 사라진다 — 실행 0', async () => {
  const { r, 옮겨진것 } = await 다섯을내본다(false);
  assert.deepEqual(옮겨진것, [],
    `A 팔에서 무언가 옮겨졌다면 심문 폴백이 바뀐 것이다 — 옮겨진 것: ${옮겨진것.join(', ')}`);
  assert.deepEqual(r.ledger.confirmed, [], '실행이 하나도 없다');
  // **버린 사실이 어디에도 없다.** 이게 더 나쁘다 — 모델도 사용자도 모른다.
  assert.equal(JSON.stringify(r).includes('backup-1329.png'), false,
    '버려진 호출이 답이나 원장에 나타난다면 최소한 보이기는 하는 것이다 — 그때 이 줄을 고친다');
  assert.equal(r.kind, 'reply');
});

test('벽 ②(B 팔): 심문을 걷으면 살아남지만 입자가 하나로 합쳐진다 — 실행 1', async () => {
  const { r, 옮겨진것 } = await 다섯을내본다(true);
  assert.deepEqual(옮겨진것, ['backup-1218.svg'],
    `B 팔의 입자가 바뀌었다면 이 검사를 고칠 게 아니라 기뻐할 자리다 — 옮겨진 것: ${옮겨진것.join(', ')}`);
  assert.equal(r.ledger.confirmed.length, 1, '다섯을 골랐는데 하나만 실행된다');
});

test('두 벽의 차이가 회차 장부와 같다(A 0 · B 1)', async () => {
  // 이 검사가 이 파일의 핵심이다. 실모델 6회차에서 A 는 이동 0·0·0, B 는 0·0·1 이었다.
  // 같은 벽을 대본 모델로 재현하면 A 0 · B 1 — **회차 결과는 우연이 아니라 구조다.**
  const A = await 다섯을내본다(false);
  const B = await 다섯을내본다(true);
  assert.equal(A.옮겨진것.length, 0);
  assert.equal(B.옮겨진것.length, 1);
  assert.ok(B.옮겨진것.length > A.옮겨진것.length,
    '심문 제거가 실행을 여는 방향이 아니라면 S1 가설의 기계적 근거가 사라진 것이다');
});
