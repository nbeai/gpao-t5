// **정직한 미완 고지가 목적미달 판정을 끄지 않는다** (라이브 실측 2026-08-14 · gpt-5.1).
//
// 밟은 회차(`docs/03-verification/evidence/live5-2026-08-14/run-125806/과업2-*.json`):
//   원장  `local.locate` → `{candidates:[], canWiden:true, suggestDepth:5, placesToLook:[셋]}`
//   답    *"…「표 폴더」…를 못 찾고 있어. … 순매출 계산 자체를 **아직** 못 하고 있어. …
//          표 폴더가 어느 자리 아래에 있는지 한 번만 짚어 줄 수 있어**?**"*
//   결과  턴이 그대로 닫혔다 — 되부름이 한 번도 안 돌았다.
//
// **커널은 「더 넓힐 수 있다」는 사실을 손에서 받아 쥐고 있었다.** 그런데 답에 `아직` 이
// 있다는 이유로 `빈손으로끝났나` 의 첫 줄(`미완료를밝혔나 → false`)이 갈래 ②를 통째로 껐다.
// 즉 구조가 *"정직하게 못 했다고 말하면 멈춘다"* 였고, 뒤집으면 *"계속 가려면 거짓말해야
// 한다"* 다. 오너 정의로는 **정직한 미완 고지와 목적 미달은 한 턴에 함께 있는 것이 정상**이다.
//
// 재는 것은 **배타가 끊겼는가** 하나다. 그물은 안 넓힌다 — 되부름을 여는 재료는 여전히
// 영수증의 사실(안 연 후보 · 넓힐 수 있는 찾기)이고, 그 사실이 없으면 예전처럼 안 선다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { 미완료를밝혔나, 빈손으로끝났나, 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';

// 라이브 답 그대로(길이만 줄였다) — `아직` 과 물음표가 한 답에 같이 있다.
const 정직한답 = '지금 내 쪽에서 "표 폴더"라는 이름을 컴퓨터 안에서 못 찾고 있어.'
  + ' 홈 전체를 3단계까지 뒤졌는데 후보가 안 나와.'
  + ' 그래서 순매출 계산 자체를 아직 못 하고 있어.'
  + ' 표 폴더가 어느 자리 아래에 있는지 한 번만 짚어 줄 수 있어?';

// 같은 뜻인데 미완 고지 낱말이 없는 답 — 재료는 같고 말투만 다르다(반대시험 ③).
const 고지없는답 = '"표 폴더"라는 이름을 컴퓨터 안에서 찾지 못하고 있어.'
  + ' 표 폴더가 어느 자리 아래에 있는지 한 번만 짚어 줄 수 있어?';

/** 라이브 영수증 그대로의 `local.locate` — 후보 0 · 넓힐 수 있음 · 볼 자리 셋. */
function 판({ 넓힐수있나 = true } = {}) {
  const tools = demoTools({});
  tools.tools['local.locate'] = {
    id: 'local.locate',
    async handler() {
      return {
        result: {
          candidates: [],
          searched: { from: '/home', depth: 3, folders: 8 },
          ...(넓힐수있나
            ? {
              canWiden: true,
              suggestDepth: 5,
              placesToLook: [
                { label: 'ZoomLauncher', path: '/Volumes/ZoomLauncher', kind: 'volume' },
                { label: 'GPAO-T5', path: '/home/GPAO-T5', kind: 'folder' },
                { label: '일감', path: '/home/일감', kind: 'folder' },
              ],
            }
            // 다 훑었고 더 볼 자리가 없다 — 손이 그 사실을 냈다(반대시험 ②).
            : {}),
        },
        userSafeSummary: '"표 폴더"에 해당하는 자리를 못 찾았어요. 폴더 8개를 3단계까지 훑었어요.',
      };
    },
  };
  return tools;
}

function 문맥(tools, 응답들, 본것) {
  let i = 0;
  const ids = Object.keys(tools.tools);
  return {
    tools,
    env: demoEnv({ include: ids, hands: ids }),
    model: {
      async respond(tc) {
        본것.push(Object.keys(tc).filter((k) => ['goalNotReached', 'candidatesUnopened', 'searchNotExhausted'].includes(k)));
        const r = 응답들[Math.min(i, 응답들.length - 1)];
        i += 1;
        return r;
      },
    },
  };
}

async function 돌리기({ 답, 넓힐수있나 = true }) {
  const 본것 = [];
  const tools = 판({ 넓힐수있나 });
  await runTurn({ text: '표 폴더가 어디 있는지 찾아줘' }, 문맥(tools, [
    { text: '', toolCalls: [{ name: 'local.locate', args: { what: '표 폴더', depth: 3 } }] },
    답,
  ], 본것));
  return 본것.flat();
}

test('정직 고지 + 근거 있음 → 목적미달이 선다 (라이브 실측 회차)', async () => {
  const 간사실 = await 돌리기({ 답: 정직한답 });
  assert.ok(간사실.includes('searchNotExhausted'),
    `**커널이 손에서 받은 「더 볼 자리」를 한 번도 안 셌다** — 모델에게 간 사실: ${JSON.stringify(간사실)}`);
});

test('반대시험: 정직 고지 + 근거 없음 → 여전히 목적미달이 아니다 (과잉 되부름 방지)', async () => {
  const 간사실 = await 돌리기({ 답: 정직한답, 넓힐수있나: false });
  assert.deepEqual(간사실, [],
    `다 훑어 더 볼 자리가 없는 턴을 되부름으로 끌고 갔다 — 사용자는 같은 말을 두 번 듣고 예산만 탄다: ${JSON.stringify(간사실)}`);
});

test('반대시험: 정직 고지 없음 + 근거 있음 → 예전 그대로 선다', async () => {
  const 간사실 = await 돌리기({ 답: 고지없는답 });
  assert.ok(간사실.includes('searchNotExhausted'),
    `예전에 물던 자리가 깨졌다 — 모델에게 간 사실: ${JSON.stringify(간사실)}`);
});

test('반대시험: `미완료를밝혔나` 를 쓰는 다른 자리(출구 검증)의 계약은 그대로다', () => {
  // ① 문구 판정 자체는 안 건드렸다.
  assert.equal(미완료를밝혔나('정산 폴더 둘을 읽었는데 8월 자료는 아직 없어서 못 봤어요.'), true);
  // ② `빈손으로끝났나` 의 정직 예외도 그대로다(r3 봉인과 같은 문장).
  const t = '정산 폴더 둘을 읽었는데 8월 자료는 아직 없어서 못 봤어요. 7월은 매출 2,630,000원이에요.';
  assert.equal(빈손으로끝났나(t), false);
  assert.equal(빈손으로끝났나('아직 그 자리는 못 봤어요', { 가져온것: 0 }), false);
  // ③ 출구의 부분읽기 그물 — 정직한 미완료 고지는 여전히 되돌리지 않는다.
  const receipts = [{
    failureState: 'none',
    actualCall: { tool: 'local.file', args: { action: 'read' } },
    result: { path: '/a/2026-08 정산/2026-08 매출정산.csv', 같은자리파일: ['8월 정산내역.csv'] },
  }];
  assert.equal(완료주장검증({
    reply: '2026-08 매출정산.csv 는 2,120,000원이야. 나머지는 아직 못 봤어.', receipts, 원장글: '',
  }).일치, true);
});
