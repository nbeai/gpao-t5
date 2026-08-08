// **④ 의 전제가 서는 길 — 사용자 사실(user_fact)이 기억 정의역에 있다** (봉인 · 2026-08-09).
//
// 진단(5단계 사전 점검 + 진단 1회): 씨앗 "나 요즘 밤마다 콜라 마시면서 넷플릭스 봐.
// 기억해 둬."에 모델이 기억 채널을 4회 연속 안 불렀고, 답은 "이해해 둘게"라고 **약속만**
// 했다(원장 호출 0 · 채널 설명의 약속 금지 문구가 있는데도 — 문장 층의 한계 재실측).
// 원인: 정의역(선호·원칙)에 사용자 사실의 자리가 없었다. 낱말 그물 확장(detectCandidate)이
// 아니라 종류를 만든다(구조 · PM 승인). user_fact 는 자동 반영 없이 확인 카드 경로만 탄다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitModelControlCalls, modelSchemasFor } from '../src/kernel/l2-plan/model-control.js';
import { makeCandidate, confirmCandidate, isInfluenceEligible, admittedEntries } from '../src/kernel/l1-intent/context-mesh.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

test('스키마와 소비가 user_fact 를 안다 — 종류가 있어야 모델이 적을 자리가 있다', () => {
  const 스키마 = modelSchemasFor(buildSelfState(demoEnv()), ['memory.propose']);
  const 제안 = 스키마.find((s) => s.name === 'memory.propose');
  assert.ok(제안, 'memory.propose 가 스키마에 없다');
  assert.ok(JSON.stringify(제안.parameters).includes('user_fact'), '스키마 kind 에 user_fact 가 없다');
  const { memorySuggestion } = splitModelControlCalls([{
    name: 'memory.propose',
    args: { kind: 'user_fact', statement: '밤마다 콜라 마시면서 넷플릭스 봄', evidence: { utteranceQuote: '밤마다 콜라 마시면서 넷플릭스 봐', speechAct: 'declaration', appliesTo: 'from_now_on' } },
  }]);
  assert.equal(memorySuggestion?.kind, 'user_fact', 'user_fact 가 다른 종류로 뭉개졌다');
});

test('user_fact 는 확인 뒤에만 영향하고, 확인되면 물음의 낱말과 무관하게 실린다 (④ 의 재료)', () => {
  const memory = { candidates: [makeCandidate('c1', 'user_fact', '밤마다 콜라 마시면서 넷플릭스 봄')], promoted: [] };
  assert.equal(isInfluenceEligible(memory.candidates[0]), false, '확인 전 후보가 영향한다 — 승격 게이트 붕괴');
  const r = confirmCandidate(memory, 'c1');
  assert.equal(r.ok, true, `user_fact 승격이 막혔다: ${r.reason}`);
  assert.equal(isInfluenceEligible(r.entry), true, '확인된 user_fact 가 영향 자격이 없다');
  const 실린것 = admittedEntries(memory, '내가 뭘 마시는지 알아?');
  assert.ok(실린것.some((e) => e.kind === 'user_fact' && e.statement.includes('콜라')),
    '확인된 사용자 사실이 프롬프트 재료에 안 실린다 — ④ 는 낱말 겹침 운에 매달리게 된다');
});

test('반대시험: 모르는 종류는 여전히 preference 로 접힌다 — 정의역은 열거로만 는다', () => {
  const { memorySuggestion } = splitModelControlCalls([{
    name: 'memory.propose',
    args: { kind: '아무거나', statement: 'x', evidence: { utteranceQuote: 'x', speechAct: 'declaration', appliesTo: 'from_now_on' } },
  }]);
  assert.equal(memorySuggestion?.kind, 'preference', '열거 밖 종류가 그대로 통과됐다');
});
