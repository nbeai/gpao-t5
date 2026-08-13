// **S6-c 그물 — 지난 턴의 못 끝낸 일이 이번 발화에 섞여 조용히 돌지 않는다.**
//
// S6-PREP §2 의 6번(이월·발화밖 파괴). 여기 걸린 절대 게이트는 **"현재 요청 침해 0"** 이다.
//
// 이 판정의 뜻은 `turn.js:906` 에 적혀 있다:
//   *"**버리는 대신 보인다**: 지난 턴에 시도했다 못 끝낸 행동과 같은 지문이 이번 턴에
//     다시 나오면, 되돌릴 수 있든 없든 자동으로 실행하지 않고 **승인 카드로 올린다.**
//     판단을 대신 하는 게 아니라 '이건 이번 발화가 아니라 지난 턴에서 왔다'는 사실만 세운다."*
//
// §10 규율 12 대로 **개수가 아니라 계약**을 잰다:
//   "두 경로가 `이월행동` 을 부른다"(모양) ❌
//   → **"이월은 자동 실행 0 · 카드로 선다 · 조용히 사라지지 않는다 ·
//      이번 요청을 막지 않는다 · 경로에 안 갈린다"**(계약) ⭕
//
// ── 216칸 표만으로는 부족하다 ────────────────────────────────────────────────
// 표는 **경계**의 판정을 잰다. 3번에서 밟았듯 잃어버릴 수 있는 자리는 경계 **다음**이다 —
// 경계가 `needsApproval:true` 를 세워도 카드 만드는 자리에서 다시 판정하면 걸음이
// 카드도 실행도 원장도 없이 사라졌다. 그래서 여기서는 **제품 흐름**으로 잰다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 본선 = (opts) => (opts?.tools ?? []).length > 1;

/** 지난 턴에 **못 끝낸** 파일 삭제 하나. 이것이 이월의 씨앗이다. */
const 지난턴못끝낸것 = [{
  tool: 'local.file',
  args: { action: 'delete', path: '지난것.md' },
  failureState: 'blocked',
  summary: '그때는 못 했어요.',
}];

function 판({ priorExchange = 지난턴못끝낸것 } = {}) {
  const 실행된 = [];
  const 원장 = [];
  const tools = demoTools({
    localFile: {
      async handler(a) { 실행된.push(a); return { result: { path: a?.path ?? 'x', items: [] } }; },
    },
  });
  return {
    실행된, 원장,
    ctx: (model) => ({
      env: demoEnv(), tools, model, pending: new Map(), priorExchange,
      ledger: { append: (rec) => { 원장.push(rec); return rec; }, entries: [] },
    }),
  };
}

/** 이월된 그 호출을 **다시** 낸다 — 지문이 같아야 이월이다. */
const 이월호출 = { name: 'local.file', args: { action: 'delete', path: '지난것.md' } };

const 계획경로모델 = (호출) => ({
  냈나: false,
  async respond(_tc, opts = {}) {
    if (본선(opts) && !this.냈나) { this.냈나 = true; return { text: '', toolCalls: [호출] }; }
    return '했어요.';
  },
});

const 걸음경로모델 = (호출) => ({
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
const 지운것 = (p) => p.실행된.filter((a) => a?.action === 'delete');

for (const [이름, 모델만들기] of 경로들) {
  test(`① **이월된 파괴는 자동으로 실행되지 않는다** — ${이름}`, async () => {
    const p = 판();
    const r = await runTurn({ text: '작업 폴더 정리 좀 도와줘' }, p.ctx(모델만들기(이월호출)));
    assert.deepEqual(지운것(p), [],
      `${이름}: **지난 턴에서 온 삭제가 이번 발화에 섞여 조용히 실행됐다.**\n`
      + `실행된 것: ${JSON.stringify(지운것(p))}\n`
      + '절대 게이트 "현재 요청 침해"의 자리다 — 사용자는 이번에 그걸 시키지 않았다.');
    assert.notEqual(r.kind, 'approval', `${이름}: 요청 밖 이월이 승인카드로 바뀌었다`);
    assert.match(JSON.stringify(p.원장), /out_of_scope|current_request_only/,
      `${이름}: 실행 제외 이유가 원장에 없다`);
  });

  test(`② **이월은 카드가 아니라 요청 밖 실행 제외로 남는다** — ${이름}`, async () => {
    const p = 판();
    const r = await runTurn({ text: '작업 폴더 정리 좀 도와줘' }, p.ctx(모델만들기(이월호출)));
    assert.notEqual(r.kind, 'approval');
    assert.equal(r.pendingId, undefined);
    assert.match(JSON.stringify(p.원장), /out_of_scope|current_request_only/);
  });

  test(`③ **이월은 승인으로 되살릴 수 없고 실행 0이다** — ${이름}`, async () => {
    const p = 판();
    const 판모음 = p.ctx(모델만들기(이월호출));
    const 결과 = await runTurn({ text: '작업 폴더 정리 좀 도와줘' }, 판모음);
    assert.notEqual(결과.kind, 'approval');
    assert.deepEqual(지운것(p), []);
  });
}

test('④ **같은 이월이면 두 경로가 같게 끝난다**', async () => {
  const 결과 = async (모델만들기) => {
    const p = 판();
    const 판모음 = p.ctx(모델만들기(이월호출));
    const 카드 = await runTurn({ text: '작업 폴더 정리 좀 도와줘' }, 판모음);
    const 카드떴나 = 카드.kind === 'approval';
    if (카드떴나) await runTurn({ approve: 카드.pendingId }, 판모음);
    return { 카드떴나, 지운것: 지운것(p).map((a) => a.path) };
  };
  const 계획 = await 결과(계획경로모델);
  const 걸음 = await 결과(걸음경로모델);
  assert.deepEqual(걸음, 계획,
    `같은 이월인데 경로에 따라 다르게 끝났다.\n`
    + `  계획: ${JSON.stringify(계획)}\n  걸음: ${JSON.stringify(걸음)}`);
});

// ── ⑤ **이월 하나가 이번 요청을 막지 않는다** ────────────────────────────────
//
// `turn.js:1065` 의 계약: *"계획 경로는 승인이 걸리면 턴 전체가 거기서 서는데, 대표 자리에
// 지난 턴 행동이 앉으면 **이번 요청이 이월 하나 때문에 못 돈다** — 그게 심문이 내던 병
// 그대로다. 줄 뒤로 보내면 이번 요청이 계획 경로에서 먼저 끝나고, 이월은 걸음 루프에서
// 승인 카드로 선다. **순서가 곧 계약이다.**"*
test('⑤ **이월이 이번 요청을 막지 않는다** — 이번 것이 먼저 돌고 이월은 카드로 선다', async () => {
  const p = 판();
  const r = await runTurn({ text: '작업 폴더 좀 보여줘' }, p.ctx({
    단계: 0,
    async respond(_tc, opts = {}) {
      if (!본선(opts)) return '봤어요.';
      this.단계 += 1;
      // 모델이 **이월을 먼저** 내고 이번 요청을 뒤에 냈다 — 순서가 계약을 시험한다.
      if (this.단계 === 1) {
        return { text: '', toolCalls: [이월호출, { name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
      }
      return '봤어요.';
    },
  }));
  const 본것 = p.실행된.filter((a) => a?.action === 'list');
  assert.equal(본것.length, 1,
    '**이번 요청이 이월 하나 때문에 안 돌았다.** 지난 턴의 못 끝낸 일이 앞에 섰다고\n'
    + `이번에 시킨 일을 못 하면, 사용자는 자기 요청이 사라진 것으로 본다.\n실행된 것: ${JSON.stringify(p.실행된)}`);
  assert.deepEqual(지운것(p), [], '이월된 파괴가 자동 실행됐다');
  assert.notEqual(r.kind, 'approval', '이월이 승인카드로 바뀌었다');
  assert.match(JSON.stringify(p.원장), /out_of_scope|current_request_only/);
});
