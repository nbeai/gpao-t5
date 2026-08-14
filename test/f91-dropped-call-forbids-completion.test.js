// **F-91 — 큐에서 떨어진 호출은 「다 했어요」를 막는다.** 계획서 §5-1 반대시험 ⑤ 뒷 문장.
//
// 감사(`design/T5-LEDGER-SEVEN-AUDIT-ko.md` §5)가 이 조항을 **「반만 선다」**로 판정했다:
// 증발 **방지**는 F-68 이 세웠고(같은 파일 `p-op51-queue-loss-forbids-completion.test.js`),
// 증발 **뒤 완료 금지**는 안 섰다. 결정적 재현(감사 · 이 레인 재확인 2026-08-12):
//
//   turn.js `못한호출남기기` 는 계약대로 `actualCall: null` 을 쓰고 호출 신분은 `제안한호출` 에 둔다
//   exit-verification `못한걸음` 그물은 `r?.actualCall?.tool` 을 요구한다
//   → 떨어진 네 사유(예산소진·없는손·승인대기중단·되묻기중단) 전부 `일치=true` 로 통과했고,
//     **같은 영수증에 actualCall 만 채운 대조군은 막혔다** — 차이를 만드는 칸이 정확히 하나다.
//
// 사용자 피해: 모델이 다섯을 시켰는데 셋만 돌고 둘이 큐에서 떨어졌는데 답은 「다 했어요」다.
//
// ── 원인은 ㉮(그물)다. ㉯(부르는 쪽이 세서 넘김)가 아니다 ──────────────────
// F-88 은 자동화 사실이 **통제 채널로 흘러 영수증에 아예 안 닿기 때문에** 부르는 쪽이 셌다.
// 여기는 다르다 — 떨어진 사실은 이미 **영수증 안에**(`제안한호출`) 있고 그물이 그 영수증을
// 이미 받고 있다. 커널이 다시 세서 넘기면 그게 두 진실이다(turn.js:405 주석이 미리 적어 둔
// 그 매듭). 그래서 고칠 자리는 **그물이 쓰는 어휘 한 줄**이고, 쓸 어휘는 이미 저장소에 있다:
// `turn.js:408` `const 무슨호출 = (rec) => rec?.actualCall ?? rec?.제안한호출 ?? null;`
//
// **`actualCall: null` 계약은 안 깬다**(반대시험 ⑥) — 실행 안 된 호출에 실행 신분을 붙이면
// 원장이 거짓이 된다(`tool-receipt.js:45-47` · `turn.js:2904-2908`).
//
// 오픈북(헤르메스): `agent/kanban_stop.py:88-101` — *"Never end a turn with only a promise of
// future action."* 그리고 `agent/conversation_loop.py:7196-7205` 의 억누르기 —
// *"clear final_response while continuing so a later budget exhaustion path does not treat the
// narrated stop as a completed answer."* **예산에 걸려 못 한 일이 남았는데 서술된 종료를
// 완료된 답으로 취급하지 않는다**가 그 자리의 계약이고, 이 결함이 정확히 그 반대였다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { TruthLedger } from '../src/kernel/l0-evidence/ledger.js';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';
import { receipt, blockedReceipt } from '../src/kernel/l0-evidence/tool-receipt.js';

// ── 재료 ────────────────────────────────────────────────────────────────────

/** `turn.js` 못한호출남기기(:2374-2396)가 내는 영수증 **그대로**. 모양을 새로 짓지 않는다. */
const 떨어진영수증 = (tool, args, 왜, 사람말) => receipt({
  intended: `${tool} 실행`,
  actualCall: null,
  제안한호출: { tool, args, callRef: '걸음2' },
  failureState: 왜 === '되풀이' ? 'cancelled' : 'blocked',
  userSafeSummary: 사람말,
  diagnosticTrace: { callId: '걸음2', 순번: 2, tool, reason: 왜 },
});

/** 바꾼 것 0 · 확인된 실행 1 — 다른 그물(`확인된실행 === 0`)이 먼저 물지 않게 깐다(F-88 과 같은 자리). */
const 읽기성공 = receipt({
  intended: '파일 읽기',
  actualCall: { tool: 'local.file', args: { action: 'read', path: '/방/정산.csv' } },
  result: { path: '/방/정산.csv', text: '항목,금액\n' },
  failureState: 'none',
  userSafeSummary: '정산.csv 를 읽었어요.',
});

const 완료문장 = '요청하신 것을 전부 처리했어요.';
const 재다 = (reply, ...떨어진것) => 완료주장검증({
  reply, receipts: [읽기성공, ...떨어진것], 원장글: '[]',
});

// ── ① 다섯을 골랐는데 둘이 큐에서 떨어진 턴 — **밟은 그 자리**(진짜 턴 루프) ──
//
// 되돌릴 수 있는 손 예산을 3 으로 두고 손 다섯을 한 응답에 낸다. 셋이 돌고 둘은
// `못한호출남기기('예산소진')` 로 원장에 남는다 — F-68 이 세운 바로 그 사실이다.
// 그 턴의 최종 답이 「전부 처리했어요」면 출구가 물어야 한다.

const 손다섯 = Array.from({ length: 5 }, (_, i) => ({
  name: 'local.file', args: { action: 'move', path: `/tmp/f91-${i}`, to: '/tmp/f91-done' },
}));

function 다섯중둘이떨어지는판() {
  const 실행 = [];
  const 되부름 = [];
  const 파일손 = { async handler(args) {
    실행.push(args.path);
    return { result: { ok: true, applied: true, path: args.path } };
  } };
  const tools = demoTools({
    localFile: 파일손,
  });
  const 원장 = new TruthLedger();
  const model = {
    냈나: false,
    async respond(tc, opts = {}) {
      // 출구가 사실을 돌려준 자리 — 모델은 그 사실을 보고 정직하게 고쳐 쓴다.
      if (tc?.completionMismatch) {
        되부름.push(String(tc.completionMismatch.사실 ?? ''));
        return '셋은 확인했고, 남은 둘은 아직 못 했어요.';
      }
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'none' } }] };
      if (tc?.workStateSettlement) return { text: '', toolCalls: [{ name: 'work.state', args: { noChange: true } }] };
      if ((opts?.tools ?? []).length > 1 && !this.냈나) { this.냈나 = true; return { text: '', toolCalls: 손다섯 }; }
      return 완료문장;
    },
  };
  return { 실행, 되부름, 원장, tools, model };
}

test('① 다섯 중 둘이 큐에서 떨어진 턴은 「전부 처리했어요」로 안 닫힌다 — 진짜 턴 루프', async () => {
  const p = 다섯중둘이떨어지는판();
  const r = await runTurn({ text: '이것들 좀 다 확인해줘' }, {
    env: demoEnv({ hands: ['local.process', 'local.locate', 'local.system', 'local.discovery', 'local.file'] }),
    tools: p.tools,
    pending: new Map(),
    ledger: p.원장,
    processEnv: { GPAO_T5_TURN_REVERSIBLE: '3' },
    model: p.model,
  });

  // 전제: 실제로 떨어졌다(이 전제가 깨지면 아래 판정은 다른 것을 재는 것이다).
  const 떨어진것 = p.원장.entries.filter((e) => e?.diagnosticTrace?.reason === '예산소진');
  assert.equal(p.실행.length, 3, `예산 3인데 ${p.실행.length}번 돌았다 — 전제가 깨졌다`);
  assert.ok(떨어진것.length >= 2, `큐에서 떨어진 호출이 원장에 안 남았다(F-68 자리): ${떨어진것.length}건`);

  assert.equal(p.되부름.length, 1, '같은 미완료 사실로 모델을 중복 호출했다');
  assert.match(String(r.reply), /못 했/, `최종 답이 정직해지지 않았다: ${r.reply}`);
  assert.doesNotMatch(String(r.reply), /전부 처리했어요/, '거짓 완료가 그대로 사용자에게 갔다');
});

// ── ①-2 **같은 손으로 다섯을 낸 판** — 라이브가 이 구멍을 잡았다 ────────────
//
// 첫 수리(그물 어휘를 `제안한호출` 로 넓힌 것)만으로는 라이브가 **안 물었다**(실측 4/4 ·
// gpt-5.1 · 예산 3 · 정산 CSV 다섯 개 읽기). 이유는 걸음 열쇠가 `손|동사` 뿐이라
// **읽기 셋이 성공했다는 이유로 떨어진 읽기 둘이 「회복됐다」로 걷혔기** 때문이다.
// 사용자 자리에서 7월을 읽은 것과 11월을 못 읽은 것은 **다른 일**이다.
// 그리고 계획서 §5-1 ⑤ 가 말한 그 판(*"다섯 중 둘이 떨어진다"*)이 대개 **같은 손**이다.
//
// 그래서 회복 대조는 **대상까지 보고** 한다 — 같은 파일을 다시 읽어 됐으면 지나가고,
// 다른 파일이 됐다고 못 읽은 파일이 지워지지는 않는다.
test('①-2 같은 손 다섯 중 둘이 떨어진 판 — 읽기 셋이 성공해도 못 읽은 둘이 안 지워진다', () => {
  const 읽음 = (path) => receipt({
    intended: '파일 읽기',
    actualCall: { tool: 'local.file', args: { action: 'read', path } },
    result: { path }, failureState: 'none', userSafeSummary: `${path} 를 읽었어요.`,
  });
  const 못읽음 = (path) => 떨어진영수증('local.file', { action: 'read', path }, '예산소진',
    '한 번에 할 수 있는 만큼만 하고 나머지는 남겨 뒀어요.');
  const receipts = [
    읽음('/방/7월_정산.csv'), 읽음('/방/8월_정산.csv'), 읽음('/방/9월_정산.csv'),
    못읽음('/방/10월_정산.csv'), 못읽음('/방/11월_정산.csv'),
  ];
  const r = 완료주장검증({ reply: 완료문장, receipts, 원장글: '[]' });
  assert.equal(r.일치, false,
    '다섯 중 둘이 떨어졌는데 「전부 처리했어요」가 그대로 나갔다 — 같은 손이라 회복으로 걷혔다');
  assert.match(String(r.모델에게), /11월_정산\.csv|10월_정산\.csv/,
    '어느 대상이 안 됐는지가 모델에게 안 갔다 — 손 이름만으로는 무엇을 못 했는지 모른다');
});

test('①-3 **같은 대상**을 다시 읽어 성공했으면 지나간다 — 회복은 그대로 회복이다', () => {
  const path = '/방/10월_정산.csv';
  const receipts = [
    떨어진영수증('local.file', { action: 'read', path }, '예산소진', '남겨 뒀어요.'),
    receipt({
      intended: '파일 읽기',
      actualCall: { tool: 'local.file', args: { action: 'read', path } },
      result: { path }, failureState: 'none', userSafeSummary: '읽었어요.',
    }),
  ];
  assert.equal(완료주장검증({ reply: 완료문장, receipts, 원장글: '[]' }).일치, true,
    '같은 대상을 다시 해서 됐는데 물었다 — 회복을 벌하는 개입이다');
});

// ── ② 떨어지는 사유 넷이 **전부** 문다 ──────────────────────────────────────
//
// 하나만 물면 나머지 셋으로 그대로 샌다. 감사가 표로 재현한 넷을 그대로 건다.
const 사유넷 = [
  ['예산소진', '한 번에 할 수 있는 만큼만 하고 나머지는 남겨 뒀어요.'],
  ['없는손', '그 손은 지금 없어요.'],
  ['승인대기중단', '먼저 확인을 받아야 해서 이건 아직 안 했어요.'],
  ['되묻기중단', '먼저 확인할 게 있어 이건 아직 안 했어요.'],
];

for (const [왜, 사람말] of 사유넷) {
  test(`② 떨어진 사유 「${왜}」 — 「전부 처리했어요」가 막힌다`, () => {
    const r = 재다(완료문장, 떨어진영수증('channel.send', { action: 'send' }, 왜, 사람말));
    assert.equal(r.일치, false,
      `${왜} 로 떨어진 호출이 있는데 「전부 처리했어요」가 그대로 나갔다`);
    assert.equal(r.사용자에게, false);
    assert.match(String(r.모델에게), /channel\.send/,
      '어느 걸음이 안 됐는지가 모델에게 안 갔다 — 사실 없이 되돌리면 모델이 고쳐 쓸 수 없다');
  });
}

// ── ③ 전부 실행된 턴은 그대로 통과한다 — 그물이 안 넓어졌다 ────────────────
test('③ 전부 실행된 턴은 그대로 나간다 — 참·거짓을 가르는 자다', () => {
  const 성공둘 = receipt({
    intended: '보내기',
    actualCall: { tool: 'channel.send', args: { action: 'send' } },
    result: { ok: true }, failureState: 'none', userSafeSummary: '보냈어요.',
  });
  assert.equal(완료주장검증({ reply: 완료문장, receipts: [읽기성공, 성공둘], 원장글: '[]' }).일치, true,
    '떨어진 것이 하나도 없는 턴까지 물었다 — 정상 턴이 전부 걸린다');
});

test('③-2 막혔다가 **같은 걸음으로 다시 해서 된 것**은 지나간다 — 정상 회복', () => {
  const 다시해서됨 = receipt({
    intended: '보내기',
    actualCall: { tool: 'channel.send', args: { action: 'send' } },
    result: { ok: true }, failureState: 'none', userSafeSummary: '보냈어요.',
  });
  const r = 완료주장검증({
    reply: 완료문장,
    receipts: [읽기성공, 떨어진영수증('channel.send', { action: 'send' }, '예산소진', '남겨 뒀어요.'), 다시해서됨],
    원장글: '[]',
  });
  assert.equal(r.일치, true, '같은 걸음을 나중에 성공했는데 물었다 — 회복을 벌하는 개입이다');
});

test('③-3 되풀이라 건너뛴 것(cancelled)은 안 문다 — 사용자의 뜻이지 못 한 일이 아니다', () => {
  const r = 재다(완료문장, 떨어진영수증('local.file', { action: 'read' }, '되풀이', '방금 한 것과 같은 일이라 다시 하지 않았어요.'));
  assert.equal(r.일치, true, 'cancelled 를 막힘으로 셌다 — 승인 재개 정산 게이트가 그것으로 한 번 닫혔다(2026-08-04)');
});

// ── ④ `actualCall` 이 없다고 다 거는 게 아니다 ─────────────────────────────
//
// 그물이 여는 열쇠는 **`제안한호출` 이 있는 영수증**(= 모델이 고른 호출인데 안 부른 것)이지
// "actualCall 이 없음"이 아니다. 통제 채널·관측 영수증은 애초에 `제안한호출` 이 없다.
test('④ 제안한호출이 없는 영수증(통제 채널·관측·blockedReceipt)은 안 문다', () => {
  // 실물 함수로 짓는다 — 모양을 지어내면 계약이 바뀌어도 검사가 모른다.
  const 막힌것 = blockedReceipt('기억 정리', 'memory.control', '그건 지금 못 해요.');
  assert.equal(막힌것.actualCall, null, '전제: blockedReceipt 는 actualCall 이 null 이다');
  assert.equal(막힌것.제안한호출, undefined, '전제: 제안한호출 칸이 없다');
  assert.equal(재다(완료문장, 막힌것).일치, true,
    'actualCall 이 없다는 이유만으로 물었다 — 통제 채널만 낸 정상 턴이 전부 걸린다');
});

// ── ⑤ 정직한 미완 고지는 그대로 나간다 ─────────────────────────────────────
test('⑤ 못 한 것을 밝힌 답은 그대로 나간다 — 반대 방향의 거짓을 만들지 않는다', () => {
  const 떨어짐 = 떨어진영수증('channel.send', { action: 'send' }, '예산소진', '남겨 뒀어요.');
  assert.equal(재다('셋은 확인했고 남은 둘은 아직 못 했어요.', 떨어짐).일치, true,
    '정직한 미완 고지를 막았다');
  assert.equal(재다('남은 둘은 아직 안 했어요. 이어서 할까요?', 떨어짐).일치, true,
    '밝히고 되묻는 답을 막았다 — 심문을 벌하는 개입이다');
});

// ── ⑤-2 **새 자를 만들지 않았다** — 실행하다 막힌 걸음과 **같은 자**로 잰다 ──
//
// 이 수리는 그물의 정의역만 원장 계약에 맞춘 것이다. 그러므로 어떤 답에 대해서도
// 「실행했다 막힌 영수증」과 「부르지 못한 영수증」의 판정이 **같아야** 한다 — 다르면
// 두 진실이 하나 더 생긴 것이고, 그게 이 결함의 원래 모양이었다.
//
// (`남겨 뒀어요 … 할까요?` 처럼 공용 문구 판정 `미완료를밝혔나` 가 못 알아듣는 말투는
//  두 쪽에서 **똑같이** 물린다. 여기서 그 자를 무르게 고치지 않는다 — C5.)
test('⑤-2 떨어진 걸음과 실행하다 막힌 걸음이 같은 자로 재어진다', () => {
  const 실행실패 = receipt({
    intended: 'channel.send 실행',
    actualCall: { tool: 'channel.send', args: { action: 'send' } },
    failureState: 'blocked', userSafeSummary: '못 보냈어요.',
  });
  const 떨어짐 = 떨어진영수증('channel.send', { action: 'send' }, '예산소진', '남겨 뒀어요.');
  for (const 답 of [
    완료문장,
    '셋은 확인했고 남은 둘은 아직 못 했어요.',
    '둘은 남겨 뒀어요. 이어서 할까요?',
    '정리해 뒀어요.',
  ]) {
    assert.equal(재다(답, 떨어짐).일치, 재다(답, 실행실패).일치,
      `같은 답에 두 판정이 갈렸다(두 진실): ${답}`);
  }
});

// ── ⑥ `actualCall: null` 계약이 살아 있다 ──────────────────────────────────
test('⑥ 실행 안 된 호출에 실행 신분을 붙이지 않았다 — 원장 계약 불변', async () => {
  const p = 다섯중둘이떨어지는판();
  await runTurn({ text: '이것들 좀 다 확인해줘' }, {
    env: demoEnv({ hands: ['local.process', 'local.locate', 'local.system', 'local.discovery', 'local.file'] }),
    tools: p.tools,
    pending: new Map(),
    ledger: p.원장,
    processEnv: { GPAO_T5_TURN_REVERSIBLE: '3' },
    model: p.model,
  });
  const 떨어진것 = p.원장.entries.filter((e) => e?.diagnosticTrace?.reason === '예산소진');
  assert.ok(떨어진것.length >= 2, '전제: 떨어진 호출이 원장에 있다');
  for (const e of 떨어진것) {
    assert.equal(e.actualCall, null,
      '부르지 않은 호출에 `actualCall` 이 채워졌다 — 원장이 거짓이 된다(tool-receipt.js:45-47)');
    assert.ok(e.제안한호출?.tool, '호출 신분이 `제안한호출` 에 안 남았다 — 조용한 축소다');
  }
});
