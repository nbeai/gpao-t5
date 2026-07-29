// TG-4 반대시험(명세 §16 TG-4 + §9·§10) — replay 는 실행하지 않고 판정만 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  wilsonLowerBound, isSuccessfulOutcome, structuralReplay, counterfactualReplay,
  minimumSuiteGaps, runReplaySuite, decideTransition, applyTransition, TCELL_THRESHOLDS,
} from '../src/kernel/l5-growth/tcell-replay-engine.js';
import { makeReplayCase } from '../src/kernel/l5-growth/tcell-replay.js';
import { makeTCellCandidate } from '../src/kernel/l5-growth/tcell-core.js';

const 세포 = (over = {}) => {
  const c = makeTCellCandidate({
    principle: { statement: '막힌 손은 같은 인자로 반복하지 않는다', type: 'recovery' },
    boundary: { validWhen: ['실패 직후'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
    trace: { observationRefs: ['ledger:s:1', 'ledger:s:2'], corrections: [] },
    ...over,
  });
  if (over.state) c.state = over.state;
  if (over.effect) c.effect = { ...c.effect, ...over.effect };
  if (over.authority) c.authority = { ...c.authority, ...over.authority };
  return c;
};
const 사례 = (kind, id, extra = {}) => makeReplayCase({
  id, kind, sourceRefs: ['ledger:s:1'],
  expected: { mustHold: [`${kind} 성립`], mustNotHappen: [], ...(extra.expected ?? {}) }, ...extra,
});
const 사실 = (...ids) => Object.fromEntries(ids.map((id) => [id, { held: [`${id.split(':')[0]} 성립`] }]));
const 통과사실 = { p1: { held: ['positive 성립'] }, n1: { held: ['negative 성립'] }, b1: { held: ['boundary 성립'] } };
const 기본 = ['positive', 'negative', 'boundary'].map((k, i) => 사례(k, [`p1`, `n1`, `b1`][i]));

test('Wilson 하한: 표본이 없거나 이상하면 0, 범위는 0..1, 표본이 늘수록 올라간다', () => {
  assert.equal(wilsonLowerBound(0, 0), 0);
  assert.equal(wilsonLowerBound('x', 5), 0);
  assert.equal(wilsonLowerBound(-3, 5) >= 0, true);
  assert.ok(wilsonLowerBound(5, 5) < 1 && wilsonLowerBound(5, 5) > 0.4);
  assert.ok(wilsonLowerBound(50, 50) > wilsonLowerBound(5, 5), '표본이 커도 하한이 안 오른다');
  assert.ok(wilsonLowerBound(8, 10) > wilsonLowerBound(5, 10));
});

test('성공은 exit 0 이 아니다 — 개선 관찰 + 정정·위반·오대상 없음', () => {
  assert.equal(isSuccessfulOutcome({ toolExitOk: true }), false, 'exit 0 만으로 성공이 됐다');
  assert.equal(isSuccessfulOutcome({ improvementObserved: true }), true);
  assert.equal(isSuccessfulOutcome({ improvementObserved: true, userCorrected: true }), false);
  assert.equal(isSuccessfulOutcome({ improvementObserved: true, authorityViolated: true }), false);
  assert.equal(isSuccessfulOutcome({ improvementObserved: true, wrongAnchor: true }), false);
});

test('명세 검사①: positive 만 통과하면 승격 실패 — 최소 suite 미달도 통과가 아니다', () => {
  const c = 세포();
  const r = runReplaySuite(c, [사례('positive', 'p1')], { observedFacts: 통과사실 });
  assert.equal(r.positivePassed, true);
  assert.equal(r.overallPassed, false, 'positive 만으로 통과했다');
  assert.deepEqual(minimumSuiteGaps(c, [사례('positive', 'p1')]).sort(), ['boundary', 'negative']);
  // 사례가 아예 없으면 "실패가 없다"는 통과가 아니다.
  assert.equal(runReplaySuite(c, []).overallPassed, false);
});

test('명세 검사②: negative 가 정상 흐름을 망치면 실패', () => {
  const c = 세포();
  const 망침 = { ...통과사실, n1: { held: [], happened: ['정상 흐름 붕괴'] } };
  const cases = [사례('positive', 'p1'), makeReplayCase({ id: 'n1', kind: 'negative', sourceRefs: ['x'],
    expected: { mustHold: [], mustNotHappen: ['정상 흐름 붕괴'] } }), 사례('boundary', 'b1')];
  const r = runReplaySuite(c, cases, { observedFacts: 망침 });
  assert.equal(r.negativePassed, false);
  assert.equal(r.overallPassed, false);
});

test('명세 검사③: authority case 실패면 격리 — 점수와 무관하다', () => {
  const c = 세포({ principle: { statement: '보낼 때는 대상 확정 후 보낸다', type: 'execution' },
    effect: { eligibleCount: 100, successCount: 100 } });
  const auth = makeReplayCase({ id: 'a1', kind: 'boundary', sourceRefs: ['x'],
    expected: { mustHold: [], mustNotHappen: ['승인 없이 전송'], expectedActionKind: 'send' } });
  const 사실2 = { ...통과사실, a1: { happened: ['승인 없이 전송'], actionKind: 'send' } };
  const r = runReplaySuite(c, [...기본, auth], { observedFacts: 사실2 });
  assert.equal(r.authorityPassed, false);
  const d = decideTransition(c, { replay: r, transferPassed: true, userConfirmed: true, distinctTurns: 9 });
  assert.equal(d.state, 'quarantined', `authority 실패인데 ${d.state} 가 됐다`);
  assert.deepEqual(d.allowedInfluence, ['none']);
});

test('명세 검사④: 점수가 높아도 A2 자동 승인 0 — 승격이 승인 요구를 끄지 못한다', () => {
  const c = 세포({ effect: { eligibleCount: 200, successCount: 200 }, authority: { requiresUserConfirmation: true } });
  const r = runReplaySuite(c, 기본, { observedFacts: 통과사실 });
  assert.equal(r.overallPassed, true);
  // 사용자 확인이 필요한데 확인이 없으면 M1 에 머문다.
  assert.equal(decideTransition(c, { replay: r, distinctTurns: 9 }).state, 'M1_candidate');
  // 확인 후 승격되더라도 requiresUserConfirmation 은 그대로 — 성숙도가 승인을 대신하지 않는다.
  const d = decideTransition(c, { replay: r, userConfirmed: true, distinctTurns: 9, transferPassed: true });
  assert.equal(d.state, 'M4_stable');
  const 적용 = applyTransition(c, d);
  assert.equal(적용.authority.requiresUserConfirmation, true, '승격이 승인 요구를 껐다');
  assert.equal(적용.authority.mustNotOverrideCurrentRequest, true);
});

test('명세 검사⑤: replay 통과한 A0/A1 원리는 제한 범위 입장이 가능하다(마찰 금지)', () => {
  const c = 세포({ effect: { eligibleCount: 6, successCount: 6 }, authority: { requiresUserConfirmation: false } });
  const r = runReplaySuite(c, 기본, { observedFacts: 통과사실 });
  const d = decideTransition(c, { replay: r, distinctTurns: 2 });
  assert.equal(d.state, 'M3_limited', `${d.state}: ${d.reason}`);
  assert.ok(d.allowedInfluence.includes('plan_hint') && d.allowedInfluence.includes('default_value'),
    '검증된 A0/A1 원리가 제한 범위에서도 입장하지 못한다');
  assert.ok(!d.allowedInfluence.includes('answer_anchor'), 'M3 가 answer_anchor 까지 얻었다');
});

test('counterfactual: 마찰이 늘면 통과가 아니다(정확도만 올라도 불인정)', () => {
  const base = { unnecessaryQuestions: 1, turnsToSuccess: 3, activeTargetAccuracy: 0.8 };
  assert.equal(counterfactualReplay(base, { ...base, activeTargetAccuracy: 0.9 }).passed, true);
  const 마찰증가 = counterfactualReplay(base, { ...base, unnecessaryQuestions: 3, activeTargetAccuracy: 0.99 });
  assert.equal(마찰증가.passed, false, '질문이 늘었는데 성장으로 봤다');
  assert.equal(마찰증가.regressions[0].metric, 'unnecessaryQuestions');
  assert.equal(counterfactualReplay(base, { ...base, activeTargetAccuracy: 0.5 }).passed, false);
  // suite 에 연결돼 있다: 마찰이 늘면 positive 도 통과가 아니다.
  const r = runReplaySuite(세포(), 기본, { observedFacts: 통과사실, baseline: base, candidate: { ...base, toolCalls: 9 } });
  assert.equal(r.positivePassed, false);
});

test('전이 계단: 근거 turn 부족·표본 부족은 올라가지 못하고, 임계는 상수 한 곳에서 온다', () => {
  const r = runReplaySuite(세포(), 기본, { observedFacts: 통과사실 });
  // 서로 다른 turn 근거 2개 미만이면 M1.
  const 한근거 = 세포({ trace: { observationRefs: ['ledger:s:1'], corrections: [] } });
  assert.equal(decideTransition(한근거, { replay: r, distinctTurns: 1 }).state, 'M1_candidate');
  // 표본이 임계 미만이면 M2.
  const 적은표본 = 세포({ effect: { eligibleCount: TCELL_THRESHOLDS.limitedMinEligibleOutcomes - 1, successCount: 4 } });
  assert.equal(decideTransition(적은표본, { replay: r, distinctTurns: 2, userConfirmed: true }).state, 'M2_replayed');
  // 정정률이 높으면 M4 로 못 간다.
  const 정정많음 = 세포({ effect: { eligibleCount: 20, successCount: 20, userCorrectionCount: 5 } });
  assert.notEqual(decideTransition(정정많음, { replay: r, distinctTurns: 3, transferPassed: true, userConfirmed: true }).state, 'M4_stable');
  // transfer replay 없이 M4 없음.
  const 전이없음 = 세포({ effect: { eligibleCount: 20, successCount: 20 } });
  assert.equal(decideTransition(전이없음, { replay: r, distinctTurns: 3, userConfirmed: true }).state, 'M3_limited');
});

test('total function: 임의 입력에도 던지지 않는다', () => {
  for (const 이상 of [null, 7, 'x', [], { effect: 'nope' }, { effect: { authorityViolationCount: 'x' } }]) {
    assert.doesNotThrow(() => decideTransition(이상, { replay: null }));
    assert.doesNotThrow(() => structuralReplay(이상));
    assert.doesNotThrow(() => runReplaySuite(이상, 이상));
    assert.doesNotThrow(() => counterfactualReplay(이상, 이상));
    assert.doesNotThrow(() => applyTransition(이상, null));
  }
  assert.equal(decideTransition({ effect: { authorityViolationCount: 'x' } }).state, 'quarantined');
});

test('구조 경계: replay 엔진은 실행 수단을 받지도 부르지도 않는다(§9.3)', async () => {
  const src = (await readFile('src/kernel/l5-growth/tcell-replay-engine.js', 'utf8'))
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'execution'/g, "'<원리종류>'"); // 원리 '종류' 이름은 실행 수단이 아니다
  // 실행·입출력 수단에 닿는 모든 통로 — 하나라도 있으면 replay 가 실행하는 것이다.
  for (const 금지 of ['tools', 'fetch(', 'handler(', 'exec', 'spawn', 'runCommand', 'require(', 'import(', 'writeFile', 'appendFile', 'child_process']) {
    assert.ok(!src.includes(금지), `replay 엔진이 실행 수단(${금지})에 닿는다 — 계획·권한 판정까지만이다`);
  }
  // 자기 층(L5 순수 계약) 밖을 import 하지 않는다.
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./tcell-core.js', './tcell-replay.js'], `허용 밖 의존: ${imports}`);
});
