// **S6-c 그물 — 한 턴에 쓰기로 한 만큼만 쓴다. 두 레인이 같은 지갑을 본다.**
//
// S6-PREP §2 의 9번(예산 계수). 계수기 자체는 이미 한 벌이다 —
// `되돌릴수있는것쓴것`·`그밖쓴것` 은 `executePlan` 스코프의 변수 하나이고
// 계획 레인(1628)과 걸음 레인(2188)이 같은 것을 올린다.
//
// 그래서 잴 것은 "같은 변수를 쓰나"가 아니라 **그 값을 보고 멈추나**다.
//
// §10 규율 12 대로 **개수가 아니라 계약**을 잰다:
//   "두 자리에서 += 1 한다"(모양) ❌
//   → **"상한을 넘겨 돌지 않는다 · 한쪽이 쓴 것이 다른 쪽 상한에 든다 ·
//      못 한 것은 사실로 남는다 · 왜 멈췄는지가 모델에게 간다"**(계약) ⭕
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 본선 = (opts) => (opts?.tools ?? []).length > 1;

/** 되돌릴 수 있다고 **선언된** 손 셋. 예산 축을 하나만 건드려 재기 위해서다. */
const 손셋 = [
  { name: 'local.process', args: { action: 'status' } },
  { name: 'local.locate', args: { query: 'x' } },
  { name: 'local.system', args: { action: 'info' } },
];

function 판({ 예산 = '1' } = {}) {
  const 실행 = [];
  const 모델이본것 = [];
  const 기록 = (이름) => ({ async handler() { 실행.push(이름); return { result: { ok: true } }; } });
  const tools = demoTools({
    localProcess: 기록('local.process'),
    localLocate: 기록('local.locate'),
    localSystem: 기록('local.system'),
  });
  return {
    실행, 모델이본것,
    ctx: (model) => ({
      env: demoEnv(), tools, pending: new Map(),
      processEnv: { GPAO_T5_TURN_REVERSIBLE: 예산 },
      model: { async respond(tc, opts) { 모델이본것.push(tc); return model.respond(tc, opts); } },
    }),
  };
}

/** 계획 경로 — 첫 응답에 셋을 한꺼번에 낸다. */
const 계획경로모델 = () => ({
  냈나: false,
  async respond(_tc, opts = {}) {
    if (본선(opts) && !this.냈나) { this.냈나 = true; return { text: '', toolCalls: 손셋 }; }
    return '했어요.';
  },
});

/**
 * 걸음 경로 — 하나를 먼저 내고, **다음 왕복에 둘을 한꺼번에** 낸다.
 * 왕복마다 하나씩만 내면 예산에 걸리기 전에 모델이 멈춰서 **남길 것이 안 생긴다** —
 * 그러면 ② 는 제품이 아니라 모형의 한계를 재게 된다(2026-08-05 밟음).
 */
const 걸음경로모델 = () => ({
  단계: 0,
  async respond(_tc, opts = {}) {
    if (!본선(opts)) return '했어요.';
    this.단계 += 1;
    if (this.단계 === 1) return { text: '', toolCalls: [손셋[0]] };
    if (this.단계 === 2) return { text: '', toolCalls: [손셋[1], 손셋[2]] };
    return '했어요.';
  },
});

const 경로들 = [['계획 경로', 계획경로모델], ['걸음 경로', 걸음경로모델]];

for (const [이름, 모델만들기] of 경로들) {
  test(`① **상한을 넘겨 돌지 않는다** — ${이름}`, async () => {
    const p = 판({ 예산: '1' });
    await runTurn({ text: '이것들 좀 확인해줘' }, p.ctx(모델만들기()));
    assert.equal(p.실행.length, 1,
      `${이름}: **예산이 1인데 ${p.실행.length}번 돌았다.**\n`
      + `돈 손: ${JSON.stringify(p.실행)}\n`
      + '예산은 한 턴이 사용자 모르게 커지는 것을 막는 자리다. 세기만 하고 안 보면 없는 것과 같다.');
  });

  test(`② **못 한 것은 사실로 남는다** — 조용히 사라지지 않는다 — ${이름}`, async () => {
    // **경로마다 "남길 것"이 생기는 상황이 다르다.** 걸음 경로에 예산 1을 주면 모델은
    // 나머지를 낼 기회조차 없다 — 남길 것이 없는 게 맞다(처음엔 그걸 결함으로 읽을 뻔했다,
    // 2026-08-05). 예산을 하나 더 줘서 **모델이 낸 뒤 예산에 걸리는** 자리를 만든다.
    const 계획인가 = 이름 === '계획 경로';
    const p = 판({ 예산: 계획인가 ? '1' : '2' });
    await runTurn({ text: '이것들 좀 확인해줘' }, p.ctx(모델만들기()));
    const 마지막 = p.모델이본것.at(-1) ?? {};
    const 글자 = JSON.stringify(마지막);
    const 못한것 = [...(마지막.turnExchange ?? []), ...(마지막.evidenceFacts ?? [])]
      .filter((x) => (x?.failureState ?? 'none') !== 'none');
    assert.ok(못한것.length > 0,
      `${이름}: **예산에 걸려 못 한 손이 모델 재료에 없다.**\n`
      + '모델은 자기가 시킨 것이 다 됐다고 믿고 답을 쓴다 — 조용한 축소는 거짓 성공으로 끝난다.\n'
      + `재료: ${글자.slice(0, 400)}`);
    assert.match(글자, /남겨 뒀어요|만큼만|만큼 하고/,
      `${이름}: **왜 멈췄는지**가 사람 말로 안 적혔다 — 못 했다는 사실만 있고 이유가 없다.`);
  });
}

test('③ **한쪽이 쓴 것이 다른 쪽 상한에 든다** — 지갑이 두 개가 아니다', async () => {
  const p = 판({ 예산: '2' });
  // 계획 레인에서 하나 쓰고, 걸음 레인에서 둘을 더 시도한다 — 지갑이 하나면 하나만 더 된다.
  await runTurn({ text: '이것들 좀 확인해줘' }, p.ctx({
    단계: 0,
    async respond(_tc, opts = {}) {
      if (!본선(opts)) return '했어요.';
      this.단계 += 1;
      if (this.단계 === 1) return { text: '', toolCalls: [손셋[0]] };            // 계획 레인
      if (this.단계 === 2) return { text: '', toolCalls: [손셋[1]] };            // 걸음 레인
      if (this.단계 === 3) return { text: '', toolCalls: [손셋[2]] };            // 예산 밖
      return '했어요.';
    },
  }));
  assert.equal(p.실행.length, 2,
    `**두 레인이 각자 지갑을 들고 있다** — 예산 2인데 ${p.실행.length}번 돌았다.\n`
    + `돈 손: ${JSON.stringify(p.실행)}\n`
    + '계획 레인이 쓴 것이 걸음 레인 상한에 안 들어가면, 한 턴의 총량이 상한의 두 배가 된다.');
});

test('④ **예산이 넉넉하면 다 한다** — 상한이 일을 방해하지 않는다', async () => {
  const p = 판({ 예산: '50' });
  await runTurn({ text: '이것들 좀 확인해줘' }, p.ctx(계획경로모델()));
  assert.equal(p.실행.length, 3,
    `예산이 남았는데 ${p.실행.length}번만 돌았다 — 상한이 없는 벽을 만들면 그게 더 나쁘다.\n`
    + `돈 손: ${JSON.stringify(p.실행)}`);
});
