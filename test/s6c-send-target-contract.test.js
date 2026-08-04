// **S6-c 그물 — 보낼 상대와 내용은 확정된 채로 카드에 오르고, 승인한 그것이 그대로 나간다.**
//
// S6-PREP §2 의 4번(send 대상·내용 확정). 여기 걸린 절대 게이트는 셋이다 —
// **승인 전 효과 0 · 오대상 실행 0 · 원장↔영수증↔실물 불일치 0.**
// 헌장으로는 ③(새 상대 첫 전송)이 정면으로 닿는다.
//
// **실제 전송은 일어나지 않는다.** `senders` 로 **기록만 하는 손**을 주입한다 —
// 오너 지시(2026-08-05): *"전송을 두 번째 손으로 밀어 카드가 뜨는지만 보면 된다 —
// 실행까지 안 가도 확정된다."* 그 계약을 이 파일 전체에 적용한다.
//
// §10 규율 12 대로 **개수가 아니라 계약**을 잰다:
//   "두 자리가 같은 함수를 부른다"(모양) ❌
//   → **"빈 대상 카드 0 · 보인 것과 나간 것이 같다 · 발화 원문을 통째로 안 보낸다 ·
//      경로에 안 갈린다"**(계약) ⭕
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 본선 = (opts) => (opts?.tools ?? []).length > 1;

/** **아무것도 보내지 않는 손.** 무엇을 보내려 했는지만 적는다. */
function 판() {
  const 보내려한것 = [];
  const tools = demoTools({
    senders: {
      'telegram.send': {
        isFixture: true,
        async handler(a) {
          보내려한것.push(a);
          return { result: { sent: true }, userSafeSummary: '보냈어요.' };
        },
      },
    },
    localFile: { async handler(a) { return { result: { path: a?.path ?? 'x', items: [] } }; } },
  });
  return { 보내려한것, ctx: (model) => ({ env: demoEnv(), tools, model, pending: new Map() }) };
}

const 계획경로모델 = (인자) => ({
  냈나: false,
  async respond(_tc, opts = {}) {
    if (본선(opts) && !this.냈나) {
      this.냈나 = true;
      return { text: '', toolCalls: [{ name: 'telegram.send', args: 인자 }] };
    }
    return '했어요.';
  },
});

/** 걸음 경로 — 읽기 하나를 먼저 하고 **다음 왕복**에서 전송을 낸다. */
const 걸음경로모델 = (인자) => ({
  단계: 0,
  async respond(_tc, opts = {}) {
    if (!본선(opts)) return '했어요.';
    this.단계 += 1;
    if (this.단계 === 1) {
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
    }
    if (this.단계 === 2) return { text: '', toolCalls: [{ name: 'telegram.send', args: 인자 }] };
    return '했어요.';
  },
});

const 경로들 = [['계획 경로', 계획경로모델], ['걸음 경로', 걸음경로모델]];
const 발화 = '민수에게 회의 30분 늦는다고 텔레그램 보내줘';
const 제대로된인자 = { target: '민수', text: '회의 30분 늦어요' };

/** 카드에 실제로 보인 글자 전부. 표면이 무엇을 그리든 객체에 있는 사실을 본다. */
const 카드글자 = (r) => JSON.stringify(r?.pending ?? []);

for (const [이름, 모델만들기] of 경로들) {
  test(`① **새 상대에게는 묻는다 — 그리고 묻기 전에 안 보낸다**(헌장 ③) — ${이름}`, async () => {
    const p = 판();
    const r = await runTurn({ text: 발화 }, p.ctx(모델만들기(제대로된인자)));
    assert.equal(r.kind, 'approval', `${이름}: 모르는 상대에게 첫 전송이 카드 없이 갔다 — 헌장 ③ 의 본체다`);
    assert.deepEqual(p.보내려한것, [],
      `${이름}: **카드가 떴는데 이미 보냈다** — 절대 게이트 "승인 전 효과 0" 위반.\n`
      + `보내려 한 것: ${JSON.stringify(p.보내려한것)}`);
  });

  test(`② **카드에 대상과 내용이 확정돼 있다** — 빈 대상 카드 0 — ${이름}`, async () => {
    const p = 판();
    const r = await runTurn({ text: 발화 }, p.ctx(모델만들기(제대로된인자)));
    assert.equal(r.kind, 'approval');
    const 카드 = (r.pending ?? []).find((x) => x.action === 'telegram.send');
    assert.ok(카드, `${이름}: 전송 카드가 없다`);
    // **표면이 그리는 자리를 잰다.** 처음엔 카드 전체 글자에서 찾았는데, 그러면
    // `reason.whatChanges` 하나만 살아 있어도 통과한다 — 미리보기를 통째로 버리는 주입이
    // 그물을 빠져나갔다(2026-08-05). 사용자가 보는 칸은 `preview` 다.
    assert.equal(카드.preview?.where, '민수',
      `${이름}: **어디로 보내는지가 미리보기에 없다.** 사용자가 무엇을 허락하는지 모르는 승인은 승인이 아니다.\n`
      + `미리보기: ${JSON.stringify(카드.preview)}`);
    assert.equal(카드.preview?.what, '회의 30분 늦어요',
      `${이름}: **무엇을 보내는지가 미리보기에 없다.**\n미리보기: ${JSON.stringify(카드.preview)}`);
    assert.equal(카드.reason?.whatChanges, '민수에 "회의 30분 늦어요"를 실제로 보내요.',
      `${이름}: 왜 묻는지가 구체 대상·내용으로 안 적혔다 — 받은 것: ${카드.reason?.whatChanges}`);
  });

  test(`③ **거절하면 안 나간다** — ${이름}`, async () => {
    const p = 판();
    const 판모음 = p.ctx(모델만들기(제대로된인자));
    const 카드 = await runTurn({ text: 발화 }, 판모음);
    assert.equal(카드.kind, 'approval');
    await runTurn({ reject: 카드.pendingId }, 판모음);
    assert.deepEqual(p.보내려한것, [],
      `${이름}: **거절했는데 나갔다** — 절대 게이트 "거절 뒤 실행 0" 위반`);
  });

  test(`④ **승인하면 카드에 보인 그것이 나간다** — 오대상 실행 0 — ${이름}`, async () => {
    const p = 판();
    const 판모음 = p.ctx(모델만들기(제대로된인자));
    const 카드 = await runTurn({ text: 발화 }, 판모음);
    assert.equal(카드.kind, 'approval');
    await runTurn({ approve: 카드.pendingId }, 판모음);
    assert.equal(p.보내려한것.length, 1,
      `${이름}: 승인 뒤 전송이 ${p.보내려한것.length}번이다(정확히 한 번이어야 한다)`);
    const 나간것 = p.보내려한것[0];
    assert.equal(나간것.target, '민수',
      `${이름}: **카드에 보인 상대와 다른 곳으로 갔다.**\n나간 것: ${JSON.stringify(나간것)}`);
    assert.equal(나간것.text, '회의 30분 늦어요',
      `${이름}: **카드에 보인 내용과 다른 것이 갔다.**\n나간 것: ${JSON.stringify(나간것)}`);
  });

  // ── ⑤ **발화 원문을 통째로 보내지 않는다**(P6-7) ───────────────────────────
  //
  // `turn.js:1583` 의 계약: *"send류는 분리된 {target, text}로 실행한다
  // (문장 전체를 그대로 보내지 않는다)."* 이 계약이 없으면 상대는
  // "민수에게 회의 30분 늦는다고 텔레그램 보내줘" 라는 **지시문**을 받는다.
  test(`⑤ **상대가 받는 것은 지시문이 아니다** — ${이름}`, async () => {
    const p = 판();
    const 판모음 = p.ctx(모델만들기(제대로된인자));
    const 카드 = await runTurn({ text: 발화 }, 판모음);
    await runTurn({ approve: 카드.pendingId }, 판모음);
    const 나간것 = p.보내려한것[0] ?? {};
    assert.notEqual(나간것.text, 발화,
      `${이름}: **사용자가 T5 에게 한 말이 그대로 상대에게 갔다.**\n`
      + '"텔레그램 보내줘" 는 T5 에게 한 지시지 민수에게 할 말이 아니다.');
    assert.equal(나간것.request, undefined,
      `${이름}: 발화 원문이 \`request\` 로 실려 나갔다 — 판정한 인자가 아닌 것이 실행됐다`);
  });
}

test('⑥ **대상을 모르면 카드를 안 만든다** — 빈 대상으로 보내지 않는다', async () => {
  for (const [이름, 모델만들기] of 경로들) {
    const p = 판();
    // 모델이 대상 없이 전송을 골랐다 — 실제로 그런다.
    const r = await runTurn({ text: '이거 좀 보내줘' }, p.ctx(모델만들기({ text: '내용만 있음' })));
    assert.deepEqual(p.보내려한것, [],
      `${이름}: **어디로 보낼지 모르는 채 나갔다** — 오대상 실행의 자리다`);
    if (r.kind === 'approval') {
      assert.doesNotMatch(카드글자(r), /"target":\s*""/,
        `${이름}: 빈 대상으로 카드가 떴다 — 사용자는 어디로 가는지 모르고 누른다.\n카드: ${카드글자(r)}`);
    }
  }
});

test('⑦ **같은 전송이면 두 경로가 같게 끝난다** — 헌장 ③ 이 왕복에 안 갈린다', async () => {
  const 결과 = async (모델만들기) => {
    const p = 판();
    const 판모음 = p.ctx(모델만들기(제대로된인자));
    const 카드 = await runTurn({ text: 발화 }, 판모음);
    const 카드떴나 = 카드.kind === 'approval';
    if (카드떴나) await runTurn({ approve: 카드.pendingId }, 판모음);
    return { 카드떴나, 나간것: p.보내려한것.map((x) => ({ target: x.target, text: x.text })) };
  };
  const 계획 = await 결과(계획경로모델);
  const 걸음 = await 결과(걸음경로모델);
  assert.deepEqual(걸음, 계획,
    `같은 전송인데 경로에 따라 다르게 끝났다 — F-20 이 정확히 그 병이었다.\n`
    + `  계획: ${JSON.stringify(계획)}\n  걸음: ${JSON.stringify(걸음)}`);
});
