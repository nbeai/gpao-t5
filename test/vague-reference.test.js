// P2-8 · "그거"를 정규식이 판정하지 않는다 (§0 「앞」 · §24)
//
// 라이브 실측(2026-07-27) — 같은 대화, 같은 모호함, 정반대 결과:
//   "그거 정리해줘" → clarify: "무엇을 말씀하시는 걸까요? (직전 대화 / 특정 파일 / 할 일)"
//   "이거 요약해줘" → 팔식당을 정확히 요약
// 갈린 이유는 하나뿐이다 — "정리"는 ACTION_SIGNALS 정규식에 있고 "요약"은 없었다.
// **모델은 할 수 있었다.** 우리가 모델을 부르기도 전에 가로챈 것이다.
//
// 오너 지시: "말 해석은 기계적으로 접근하면 또 실패할 확률이 높다."
// 그래서 정규식을 손보지 않았다(다음 단어에서 또 난다). **비켰다.**
import { 계약of } from './subject-contract.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { recentTurns } from '../src/kernel/l1-intent/conversation.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { workingStateFacts } from '../src/kernel/l0-evidence/working-state.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const page = {
  sourceLedgerRequired: true,
  subjectOf: 계약of('web.collect'),
  async handler() {
    return {
      result: { title: '팔식당 : 네이버', markdown: '청담동 돼지고기구이', links: [] },
      sources: [{ sourceUrl: 'https://m.place.naver.com/restaurant/1/home', title: '팔식당 : 네이버' }],
      userSafeSummary: '공개 자료로 확인했어요: 팔식당 : 네이버.',
    };
  },
};

/** 페이지를 하나 읽은 뒤, 모호한 지시어로 이어 말한다. */
async function afterReading(secondUtterance, { tools = demoTools({ webCollector: page }) } = {}) {
  const seen = [];
  const transcript = [];
  const scripts = [
    { toolCalls: [{ name: 'web.collect', args: { request: 'https://map.naver.com/p/entry/place/1' } }], text: '팔식당은 청담동 고깃집이에요.' },
    { text: '정리했어요.' },
  ];
  let turnNo = 0;
  const ctx = {
    env: demoEnv(), tools, modelSupportsSearch: true,
    model: {
      async respond(tc, opts = {}) {
        seen.push(tc);
        const s = scripts[turnNo];
        if (s.toolCalls && opts.tools?.length && !s.used) { s.used = true; return { text: '', toolCalls: s.toolCalls }; }
        return opts.tools?.length ? { text: s.text, toolCalls: [] } : s.text;
      },
    },
  };
  const results = [];
  for (const text of ['https://map.naver.com/p/entry/place/1 분석해줘', secondUtterance]) {
    ctx.recentTurns = recentTurns(transcript);
    const r = await runTurn({ text }, ctx);
    results.push(r);
    transcript.push({ role: 'user', text });
    transcript.push({ role: 'assistant', result: r });
    if (r.workingState) ctx.workingState = r.workingState;
    turnNo += 1;
  }
  return { seen, results };
}

test('"그거 정리해줘" 를 하드코딩 문장으로 되묻지 않는다(모델이 판단한다)', async () => {
  const { results } = await afterReading('그거 정리해줘');
  assert.notEqual(results[1].kind, 'clarify', '정규식이 모델보다 먼저 답을 가로채면 안 된다');
  assert.doesNotMatch(JSON.stringify(results[1]), /무엇을 말씀하시는 걸까요/,
    '기계적 관용어구가 반복되는 원인이었다');
});

test('같은 상황에서 "정리"와 "요약"이 다르게 갈리지 않는다(정규식 단어 하나가 흐름을 바꾸면 안 된다)', async () => {
  const a = await afterReading('그거 정리해줘');
  const b = await afterReading('이거 요약해줘');
  assert.equal(a.results[1].kind, b.results[1].kind,
    `"정리"=${a.results[1].kind} vs "요약"=${b.results[1].kind} — 단어 하나로 갈렸다`);
});

test('되묻는 대신 **"그거"가 무엇인지 사실로** 모델에게 간다', async () => {
  const { seen } = await afterReading('그거 정리해줘');
  const facts = workingStateFacts(seen.at(-1).workingState) ?? '';
  assert.match(facts, /팔식당/, '현재 대상을 모르면 그때는 모델이 물어야 맞다 — 아는데 묻는 게 문제였다');
});

// ── 안전은 안 풀린다 ────────────────────────────────────────────────────
test('모호해도 위험한 실행은 여전히 승인에서 잡힌다(clarify 는 안전 게이트가 아니었다)', async () => {
  const { results } = await afterReading('그거 지워줘');
  const r = results[1];
  if (r.kind === 'approval') {
    assert.ok(r.pending?.length, '승인 카드에 대상이 있어야 한다');
  } else {
    // 승인 카드가 아니라면 **실행도 없어야** 한다(조용한 삭제 금지).
    assert.doesNotMatch(JSON.stringify(r.ledger ?? {}), /삭제|delete/, '승인 없이 지운 흔적이 있으면 안 된다');
  }
});

test('말귀(interpret)의 신호 자체는 그대로 둔다 — 정규식을 손보지 않았다(다음 단어에서 또 난다)', () => {
  // 이 값은 여전히 계산된다. 다만 **턴을 가로채지 않는다.** 신호와 결정을 분리한 것이 이번 수정이다.
  assert.equal(interpret('그거 정리 좀').needsClarification, true);
});
