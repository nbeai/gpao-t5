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

/** 되돌릴 수 있는 실제 파일 효과 셋. 첫 호출은 plan, 나머지는 step 큐다. */
const 손셋 = [
  { name: 'local.file', args: { action: 'move', path: '/tmp/s6c-a', to: '/tmp/s6c-done' } },
  { name: 'local.file', args: { action: 'move', path: '/tmp/s6c-b', to: '/tmp/s6c-done' } },
  { name: 'local.file', args: { action: 'move', path: '/tmp/s6c-c', to: '/tmp/s6c-done' } },
];

function 판({ 예산 = '1' } = {}) {
  const 실행 = [];
  const 모델이본것 = [];
  const 원장 = [];
  const 기록 = { async handler(args) {
    실행.push(args.path);
    return { result: { ok: true, applied: true, path: args.path }, userSafeSummary: '옮겼어요.' };
  } };
  const tools = demoTools({
    localFile: 기록,
  });
  return {
    실행, 모델이본것, 원장,
    ctx: (model) => ({
      env: demoEnv(), tools, pending: new Map(),
      processEnv: { GPAO_T5_TURN_REVERSIBLE: 예산 },
      ledger: { entries: 원장, append(rec) { 원장.push(rec); return rec; } },
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
  test(`① **실제 효과 상한을 넘겨 돌지 않는다** — ${이름}`, async () => {
    const p = 판({ 예산: '1' });
    await runTurn({ text: '이것들 좀 확인해줘' }, p.ctx(모델만들기()));
    assert.equal(p.실행.length, 1,
      `${이름}: 실제 효과 예산 1인데 ${p.실행.length}번 실행했다: ${JSON.stringify(p.실행)}`);
  });

  test(`② **못 한 실제 효과는 예산소진 영수증으로 남는다** — ${이름}`, async () => {
    // **경로마다 "남길 것"이 생기는 상황이 다르다.** 걸음 경로에 예산 1을 주면 모델은
    // 나머지를 낼 기회조차 없다 — 남길 것이 없는 게 맞다(처음엔 그걸 결함으로 읽을 뻔했다,
    // 2026-08-05). 예산을 하나 더 줘서 **모델이 낸 뒤 예산에 걸리는** 자리를 만든다.
    const p = 판({ 예산: 이름 === '계획 경로' ? '1' : '2' });
    await runTurn({ text: '이것들 좀 확인해줘' }, p.ctx(모델만들기()));
    const 못한것 = p.원장.filter((x) => x?.diagnosticTrace?.reason === '예산소진');
    assert.ok(못한것.length > 0, `${이름}: 예산에 막힌 호출 영수증이 원장에 없다`);
  });
}

test('③ 계획·걸음 두 레인의 실제 효과가 한 지갑을 공유한다', async () => {
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
  assert.equal(p.실행.length, 2, `계획과 걸음이 지갑을 따로 썼다: ${JSON.stringify(p.실행)}`);
});

test('④ **예산이 넉넉하면 다 한다** — 상한이 일을 방해하지 않는다', async () => {
  const p = 판({ 예산: '50' });
  await runTurn({ text: '이것들 좀 확인해줘' }, p.ctx(계획경로모델()));
  assert.equal(p.실행.length, 3,
    `예산이 남았는데 ${p.실행.length}번만 돌았다 — 상한이 없는 벽을 만들면 그게 더 나쁘다.\n`
    + `돈 손: ${JSON.stringify(p.실행)}`);
});
