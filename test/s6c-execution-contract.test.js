// **S6-c 그물 — 실행은 판정한 그것을, 신분을 잃지 않고, 정직하게 적는다.**
//
// S6-PREP §2 의 10번(`계약실행`). 열 판정의 마지막이고, 앞의 아홉이 옳아도 **여기서 다른 것을
// 실행하면 전부 무의미해지는** 자리다. 절대 게이트 셋이 걸린다 —
// **오대상 실행 0 · 중복 실행 0 · 원장↔영수증↔실물 불일치 0.**
//
// 함수 자체는 이미 한 벌이다(`계약실행` 하나를 두 레인이 부른다). 그래서 잴 것은
// "같은 함수를 부르나"가 아니라 **같은 계약으로 실행되나**다.
//
// §10 규율 12 대로 **개수가 아니라 계약**을 잰다:
//   "두 자리가 `계약실행` 을 부른다"(모양) ❌
//   → **"판정한 인자가 실행된다 · 모델이 낸 그 호출이라는 신분이 이어진다 ·
//      실패를 성공으로 적지 않는다 · 한 번 시킨 것이 두 번 돌지 않는다"**(계약) ⭕
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 본선 = (opts) => (opts?.tools ?? []).length > 1;

function 판({ 실패 = false } = {}) {
  const 실행 = [];
  const 원장 = [];
  const tools = demoTools({
    localProcess: {
      async handler(a) {
        실행.push(a);
        // **실패는 손의 계약대로 알린다** — `{failed:true}` 다.
        // 처음엔 `{failureState:'failed'}` 로 썼는데 런타임은 그 칸을 안 본다.
        // 그래서 성공으로 기록됐고, 하마터면 **제 모형의 실수를 제품 결함으로 읽을 뻔했다**
        // (2026-08-05 — 이 흐름에서 세 번째다).
        if (실패) return { failed: true, userSafeSummary: '그건 지금 안 됐어요.' };
        return { result: { ok: true, lines: ['첫줄'] } };
      },
    },
    localFile: { async handler(a) { return { result: { path: a?.path ?? 'x', items: [] } }; } },
  });
  return {
    실행, 원장,
    ctx: (model) => ({
      env: demoEnv(), tools, model, pending: new Map(),
      ledger: { append: (rec) => { 원장.push(rec); return rec; }, entries: [] },
    }),
  };
}

/** 모델이 **구체 인자**로 낸 호출. 발화 원문과 다른 값이라야 갈림이 드러난다. */
const 호출 = {
  name: 'local.process',
  args: { action: 'logs', name: 't5demo', lines: 20 },
  providerCallId: 'call_abc123',
};

const 계획경로모델 = () => ({
  냈나: false,
  async respond(_tc, opts = {}) {
    if (본선(opts) && !this.냈나) { this.냈나 = true; return { text: '', toolCalls: [호출] }; }
    return '했어요.';
  },
});

const 걸음경로모델 = () => ({
  단계: 0,
  async respond(_tc, opts = {}) {
    if (!본선(opts)) return '했어요.';
    this.단계 += 1;
    if (this.단계 === 1) {
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
    }
    if (this.단계 === 2) return { text: '', toolCalls: [호출] };
    return '했어요.';
  },
});

const 경로들 = [['계획 경로', 계획경로모델], ['걸음 경로', 걸음경로모델]];
const 돈것 = (p) => p.실행.filter((a) => a?.action === 'logs');

for (const [이름, 모델만들기] of 경로들) {
  test(`① **모델이 낸 그 인자가 실행된다** — 발화 원문으로 갈아치우지 않는다 — ${이름}`, async () => {
    const p = 판();
    await runTurn({ text: '로그 좀 보여줘' }, p.ctx(모델만들기()));
    const 실행 = 돈것(p).at(-1);
    assert.ok(실행, `${이름}: 모델이 고른 손이 아예 안 돌았다`);
    assert.deepEqual(실행, 호출.args,
      `${이름}: **판정한 인자와 실행된 인자가 다르다.**\n`
      + `  모델: ${JSON.stringify(호출.args)}\n  실행: ${JSON.stringify(실행)}\n`
      + '이 파일이 곳곳에서 싸우는 병이다 — 판정·미리보기·실행이 같은 인자를 봐야 한다(두 진실 금지).');
    assert.equal(실행.request, undefined,
      `${이름}: 발화 원문이 \`request\` 로 실려 실행됐다 — 모델이 이해해서 고른 것을 원문으로 되돌린 것이다`);
  });

  test(`② **모델이 낸 그 호출이라는 신분이 이어진다** — ${이름}`, async () => {
    const p = 판();
    await runTurn({ text: '로그 좀 보여줘' }, p.ctx(모델만들기()));
    const 실행기록 = p.원장.filter((r) => r?.actualCall?.tool === 'local.process');
    assert.equal(실행기록.length, 1, `${이름}: 실행 기록이 ${실행기록.length}건이다`);
    const 신분 = 실행기록[0].actualCall;
    assert.equal(신분.providerCallId, 'call_abc123',
      `${이름}: **공급자가 발급한 신분이 끊겼다.**\n`
      + `원장의 호출: ${JSON.stringify(신분)}\n`
      + '신분이 끊기면 "모델이 무엇을 요청했는가"와 "T5 가 무엇을 했는가"를 경계 너머로 못 잇는다.');
    assert.ok(신분.callRef, `${이름}: T5 내부 상관용 신분(callRef)이 없다 — 원장에서 순서를 잃는다`);
  });

  test(`③ **실패를 성공으로 적지 않는다** — ${이름}`, async () => {
    const p = 판({ 실패: true });
    await runTurn({ text: '로그 좀 보여줘' }, p.ctx(모델만들기()));
    const 실행기록 = p.원장.filter((r) => r?.actualCall?.tool === 'local.process');
    assert.equal(실행기록.length, 1, `${이름}: 실행 기록이 ${실행기록.length}건이다`);
    assert.notEqual(실행기록[0].failureState, 'none',
      `${이름}: **손이 실패했는데 원장에 성공으로 적혔다.**\n`
      + `기록: ${JSON.stringify(실행기록[0].userSafeSummary)}\n`
      + '절대 게이트 "거짓 성공"의 자리다 — 모델도 사용자도 안 된 일을 된 일로 읽는다.');
  });

  test(`④ **한 번 시킨 것이 두 번 돌지 않는다** — 중복 실행 0 — ${이름}`, async () => {
    const p = 판();
    await runTurn({ text: '로그 좀 보여줘' }, p.ctx(모델만들기()));
    assert.equal(돈것(p).length, 1,
      `${이름}: **같은 호출이 ${돈것(p).length}번 돌았다.**\n`
      + `돈 것: ${JSON.stringify(돈것(p))}\n`
      + '절대 게이트 "중복 실행"의 자리다 — `date`·전송처럼 두 번 돌면 결과가 갈리는 손이 있다.');
  });
}

test('⑤ **같은 호출이면 두 경로가 같게 실행된다**', async () => {
  const 결과 = async (모델만들기) => {
    const p = 판();
    await runTurn({ text: '로그 좀 보여줘' }, p.ctx(모델만들기()));
    return {
      실행: 돈것(p),
      원장: p.원장.filter((r) => r?.actualCall?.tool === 'local.process')
        .map((r) => ({ args: r.actualCall.args, 실패: r.failureState })),
    };
  };
  const 계획 = await 결과(계획경로모델);
  const 걸음 = await 결과(걸음경로모델);
  assert.deepEqual(걸음, 계획,
    `같은 호출인데 경로에 따라 다르게 실행됐다 — 열 판정의 마지막 자리다.\n`
    + `  계획: ${JSON.stringify(계획)}\n  걸음: ${JSON.stringify(걸음)}`);
});
