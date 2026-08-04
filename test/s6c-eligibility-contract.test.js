// **S6-c 그물 — 승인은 성공할 수 있는 일에만 청한다.**
//
// `approvalEligibility` 자리의 뜻은 turn.js 주석에 이미 적혀 있다:
//   *"이 자리가 없으면 앞선 탐색 뒤 모델이 실재하지 않는 연결을 골랐을 때,
//     사용자는 **존재하지 않는 연결을 승인하는 카드**를 보게 된다."*
//
// §10 규율 12 대로 **개수가 아니라 계약**을 잰다:
//   "두 자리에서 같은 모양으로 부른다"(모양) ❌
//   → **"못 하는 일에 카드 0 · 막힌 사실이 원장에 남고 모델에게 간다 ·
//      묻는 인자가 실제로 실행될 인자다"**(계약) ⭕
//
// 준비 문서 §2 는 1번을 **"같음"** 으로 적었지만 §8 이 밝혔듯 **읽어서 판단한 것**이다.
// 여기서 밟는다. 읽어서 이미 갈리는 자리가 보인다 —
//   계획 경로(turn.js:1168): `planIntent.toolArgs?.[id] ?? planIntent.fileOp ?? {}`  ← **추정**
//   걸음 경로(turn.js:1920): 모델이 낸 `args`                                        ← **실제**
// 물어보는 것이 다르면 답도 다를 수 있다. ⑤가 그 자리를 겨눈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

/**
 * 막는 손 하나로 판을 만든다.
 * @param 막나 - 물어본 인자를 보고 막을지 결정한다(인자 의존 계약을 흉내 낸다).
 */
function 판({ 막나 = (a) => String(a?.path ?? '').startsWith('/바깥') } = {}) {
  const 물어본인자 = [];
  const 실행된인자 = [];
  const 원장에남은것 = [];
  const 모델이본것 = [];
  const tools = demoTools({
    localFile: {
      async approvalEligibility(a) {
        물어본인자.push(a);
        return 막나(a)
          ? { allowed: false, userSafeSummary: '그 자리는 지금 못 봐요.', nextSafeAction: '작업 폴더 안에서 다시.' }
          : { allowed: true };
      },
      async handler(a) { 실행된인자.push(a); return { result: { path: a?.path ?? 'x', items: [] } }; },
    },
  });
  return {
    물어본인자, 실행된인자, 원장에남은것, 모델이본것,
    ctx: (model) => ({
      env: demoEnv(), tools, pending: new Map(),
      ledger: { append: (rec) => { 원장에남은것.push(rec); return rec; }, entries: [] },
      model: {
        async respond(tc, opts) {
          모델이본것.push(tc);
          return model.respond(tc, opts);
        },
      },
    }),
  };
}

// **본선 왕복만 센다.** 턴 안에는 도구를 **하나만** 쥐여 주는 내부 호출이 섞여 있다
// (작업 상태 수집·기억 제안 같은 통제 호출). 처음엔 `opts.tools?.length` 로만 갈랐다가
// 두 번째 손을 그 통제 호출에 내보냈고, 런타임이 옳게 버린 것을 **제품 결함으로 읽을 뻔했다**
// (2026-08-05). 손이 여럿 실려 온 왕복이 본선이다.
const 본선 = (opts) => (opts?.tools ?? []).length > 1;

/** 계획 경로 — 첫 응답이 바로 그 손이다. */
const 계획경로모델 = (인자) => ({
  냈나: false,
  async respond(_tc, opts = {}) {
    if (본선(opts) && !this.냈나) {
      this.냈나 = true;
      return { text: '', toolCalls: [{ name: 'local.file', args: 인자 }] };
    }
    return '봤어요.';
  },
});

/**
 * 걸음 경로 — 읽기 하나를 먼저 **성공**시키고 **다음 왕복**에서 그 손을 낸다.
 *
 * 앞 걸음이 성공이어야 하는 이유(2026-08-05 밟음): 처음엔 앞 걸음을 막히는 터미널로 뒀는데,
 * 그러면 `turnReceipts` 에 `actualCall` 있는 실패가 하나 섞여 사다리 판정이 달라진다 —
 * **걸음 경로가 우연히 통과한다.** 우연한 초록 위에서 "두 경로가 같다"고 닫으면
 * 그 우연이 사라지는 다음 변경에서 조용해진다(S6-b 의 `break` 가 그랬다).
 */
const 걸음경로모델 = (인자) => ({
  단계: 0,
  async respond(_tc, opts = {}) {
    if (!본선(opts)) return '봤어요.';
    this.단계 += 1;
    if (this.단계 === 1) {
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
    }
    if (this.단계 === 2) return { text: '', toolCalls: [{ name: 'local.file', args: 인자 }] };
    return '봤어요.';
  },
});

const 경로들 = [['계획 경로', 계획경로모델], ['걸음 경로', 걸음경로모델]];
const 막힐인자 = { action: 'read', path: '/바깥/보고서.md' };
/** 손이 거절한 **그 요청**이 실행된 횟수. 허용된 다른 걸음은 세지 않는다. */
const 막힌것실행 = (p) => p.실행된인자.filter((a) => String(a?.path ?? '').startsWith('/바깥')).length;

for (const [이름, 모델만들기] of 경로들) {
  test(`① **못 하는 일에 승인 카드가 안 뜬다** — ${이름}`, async () => {
    const p = 판();
    const r = await runTurn({ text: '바깥 보고서 좀 봐줘' }, p.ctx(모델만들기(막힐인자)));
    assert.notEqual(r.kind, 'approval',
      `${이름}: **성공할 수 없는 일에 카드를 띄웠다** — 사용자는 승인해도 안 되는 것을 승인한다.\n`
      + `카드: ${JSON.stringify(r.approval ?? r.pendingId ?? r)}`);
    // **막힌 그 요청만 센다.** 걸음 경로는 앞 걸음(허용된 읽기)을 정당하게 실행한다 —
    // 전체 실행 수를 0 으로 재면 정상 동작을 결함으로 읽는다.
    assert.equal(막힌것실행(p), 0, `${이름}: 막혔다고 해 놓고 실행했다`);
  });

  test(`② **막힌 사실이 원장에 남는다** — ${이름}`, async () => {
    const p = 판();
    await runTurn({ text: '바깥 보고서 좀 봐줘' }, p.ctx(모델만들기(막힐인자)));
    const 막힌것 = p.원장에남은것.filter((r) => (r?.failureState ?? 'none') !== 'none');
    assert.ok(막힌것.length > 0,
      `${이름}: 막혔는데 원장에 아무것도 없다 — 감사도 사용자도 왜 안 됐는지 못 본다.\n`
      + `원장: ${JSON.stringify(p.원장에남은것.map((r) => r?.intended))}`);
  });

  // **재료의 칸 이름은 `receipts` 가 아니다.** 처음 이 그물을 쓸 때 `tc.receipts` 를 재서
  // 양 경로가 다 빨갛게 나왔다 — 없는 칸을 쟀으니 당연했다(2026-08-05). 영수증은
  // `buildTaskContext` 에서 **`turnExchange`(모델이 낸 호출) 와 `evidenceFacts`(그 밖)** 로 갈려 실린다.
  // 실제로 모델이 받는 자리를 잰다.
  const 막힘실렸나 = (tc) => [...(tc?.turnExchange ?? []), ...(tc?.evidenceFacts ?? [])]
    .some((x) => (x?.failureState ?? 'none') !== 'none');

  test(`③ **막힌 사실이 이 턴 안에서 모델에게 간다** — ${이름}`, async () => {
    const p = 판();
    await runTurn({ text: '바깥 보고서 좀 봐줘' }, p.ctx(모델만들기(막힐인자)));
    const 나중 = p.모델이본것.slice(1);
    assert.ok(나중.length > 0,
      `${이름}: 막히고 나서 모델을 다시 안 불렀다 — 한 왕복을 태우고 템플릿만 말한다(F-2 의 병).`);
    assert.equal(나중.some(막힘실렸나), true,
      `${이름}: **막힌 사실이 모델 재료에 없다** — 원리 ⑤(귀결은 모델에게 돌아간다)가 끊긴다.`);
  });

  // ── ⑥ **왜 막혔는지만이 아니라 다음에 무엇을 하면 되는지도 간다** ──────────
  //
  // turn.js:1668 이 이미 계약을 적어 뒀다:
  //   *"**도구가 남긴 말이 먼저다.** 도구는 자기가 왜 막혔는지 정확히 안다.
  //     사다리는 도구 종류를 모르는 일반 폴백이라, 앞세우면 파일 실패에 웹 문구가 나간다 —
  //     실측: 원장엔 정확한 문장이 있었는데 사다리가 덮어써서 모델이 터미널 명령을 시켰다."*
  //
  // 막다른 답 금지는 사용자면의 계약이고, 이건 **모델면의 같은 계약**이다.
  // 다음 길이 없으면 모델은 "안 되는구나"에서 멈추거나 엉뚱한 손을 고른다.
  test(`⑥ **손이 알려 준 다음 길이 모델에게 간다** — ${이름}`, async () => {
    const p = 판();
    await runTurn({ text: '바깥 보고서 좀 봐줘' }, p.ctx(모델만들기(막힐인자)));
    const 마지막 = JSON.stringify(p.모델이본것.at(-1));
    assert.match(마지막, /그 자리는 지금 못 봐요/,
      `${이름}: 왜 막혔는지가 모델 재료에 없다`);
    assert.ok(마지막.includes('작업 폴더 안에서 다시'),
      `${이름}: **손이 알려 준 다음 길이 사라졌다.**\n`
      + '손은 "작업 폴더 안에서 다시" 라고 정확히 말했는데 모델은 그 말을 못 받는다.\n'
      + '덮어쓴 문구가 사실과 다르면 더 나쁘다 — 모델은 없는 한계를 피해 계획을 다시 짠다.');
  });
}

// ── ⑦ **붙어 있는 손을 없다고 말하지 않는다** ────────────────────────────────
//
// `blockedReceipt` 는 이유를 안 준 호출부에 `reason:'not_executable'` 을 **채워 넣었다.**
// 그런데 그 값은 `증거종류()` 가 읽는 **증거**다 — "호출 없음 + 실행 불가 ⇒ 도구가 없는 것".
// 그래서 손이 **이 요청만** 거절한 자리에서도 모델은 *"그 일을 맡는 도구가 아직 준비되지
// 않았어요"* 를 받았다. 손은 붙어 있고 방금 자기 계약을 말했는데도.
//
// 이건 거짓 성공의 거울상이다 — **없는 실패를 지어내는 것**. 모델은 있지도 않은 한계를
// 피해 계획을 다시 짜고, 사용자는 되는 일을 안 된다고 듣는다.
// ⑥ 과 겹치지 않는다: ⑥ 은 "다음 길이 도착하는가", ⑦ 은 "도착한 사실이 참인가"다.
test('⑦ **거절을 "도구 없음"으로 지어내지 않는다** — 기본값을 증거로 쓰지 않는다', async () => {
  for (const [이름, 모델만들기] of 경로들) {
    const p = 판();
    await runTurn({ text: '바깥 보고서 좀 봐줘' }, p.ctx(모델만들기(막힐인자)));
    for (const tc of p.모델이본것) {
      assert.doesNotMatch(JSON.stringify(tc), /도구가 아직 준비되지 않았어요/,
        `${이름}: **붙어 있는 손을 "아직 준비되지 않았다"고 모델에게 말했다.**\n`
        + '손은 연결돼 있고 이 요청만 거절했다. 없는 한계를 지어내면 모델은 그것을 피해 계획을 짜고,\n'
        + '되는 일이 안 되는 일이 된다 — 거짓 성공의 거울상이다.\n'
        + "원인 자리: blockedReceipt 가 이유 없는 차단에 `reason:'not_executable'` 을 채우면\n"
        + '증거종류() 가 그것을 증거로 읽어 tool_missing 계단을 세운다.');
    }
  }
});

test('④ **같은 요청을 두 경로가 같게 판정한다** — 막힘이 경로에 안 갈린다', async () => {
  const 결과 = async (모델만들기) => {
    const p = 판();
    const r = await runTurn({ text: '바깥 보고서 좀 봐줘' }, p.ctx(모델만들기(막힐인자)));
    return {
      카드떴나: r.kind === 'approval',
      막힌것실행됐나: 막힌것실행(p) > 0,
      원장에막힘: p.원장에남은것.some((x) => (x?.failureState ?? 'none') !== 'none'),
    };
  };
  const 계획 = await 결과(계획경로모델);
  const 걸음 = await 결과(걸음경로모델);
  assert.deepEqual(걸음, 계획,
    `같은 요청인데 경로에 따라 다르게 판정됐다 — 한쪽에서만 막히거나 한쪽에서만 카드가 뜬다.\n`
    + `  계획: ${JSON.stringify(계획)}\n  걸음: ${JSON.stringify(걸음)}`);
});

// ── ⑤ **묻는 인자가 실제로 실행될 인자다** ────────────────────────────────────
//
// 읽어서 보이는 갈림: 계획 경로는 `planIntent.toolArgs?.[id] ?? planIntent.fileOp ?? {}`,
// 즉 **의도에서 추정한 인자**로 묻는다. 걸음 경로는 모델이 낸 **실제 인자**로 묻는다.
//
// 손의 계약이 인자에 달려 있으면(대개 그렇다 — "그 경로는 작업 폴더 밖") 이 차이가
// 그대로 오판이 된다. 두 방향 다 나쁘다:
//   ㄱ. 추정이 헐거워 `allowed:true` → 못 할 일이 계획에 남고 **사용자는 함정 카드**를 본다.
//   ㄴ. 추정이 빡빡해 `allowed:false` → **될 일인데 손을 뺀다**("그건 못 해요"라고 거짓말).
test('⑤ **eligibility 는 실제로 실행될 인자로 묻는다**(지어낸 인자로 묻지 않는다)', async () => {
  const 물어본것 = { 계획: null, 걸음: null };
  for (const [이름, 모델만들기, 칸] of [['계획 경로', 계획경로모델, '계획'], ['걸음 경로', 걸음경로모델, '걸음']]) {
    const p = 판({ 막나: () => false });   // 막지 않는다 — **무엇을 물었는지**만 본다
    await runTurn({ text: '바깥 보고서 좀 봐줘' }, p.ctx(모델만들기(막힐인자)));
    const 물음 = p.물어본인자.at(-1);
    const 실행 = p.실행된인자.at(-1);
    물어본것[칸] = { 물음, 실행 };
    assert.ok(물음, `${이름}: eligibility 를 아예 안 물었다 — 계약 자리가 비었다`);
    assert.deepEqual(물음, 실행,
      `${이름}: **물어본 인자와 실행된 인자가 다르다.**\n`
      + `  물음: ${JSON.stringify(물음)}\n  실행: ${JSON.stringify(실행)}\n`
      + '손의 계약은 인자에 달려 있다. 지어낸 인자로 물으면 판정이 실제와 무관해진다 —\n'
      + '될 일을 못 한다고 하거나, 못 할 일에 승인 카드를 띄운다.');
  }
});
