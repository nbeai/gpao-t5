// TG-4 반대시험(명세 §16 TG-4 + §9·§10 + 감사 2026-07-29) — 검증된 사실 묶음만 판정한다.
// 감사 재현 입력을 전부 포함한다: 안 돌린 사례 통과 · 상태 건너뛰기 · 종착 부활 ·
// trace 미확인 · 임의 decision · z 오염 · 마찰 지표 누락.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  wilsonLowerBound, isSuccessfulOutcome, foldOutcomes, structuralReplay, counterfactualReplay,
  minimumSuiteGaps, runReplaySuite, decideTransition, applyTransition, distinctTurnsOf,
  makeVerifiedReplayPacket, validateReplayPacket, TCELL_THRESHOLDS, FRICTION_METRICS, MATURITY_LADDER,
} from '../src/kernel/l5-growth/tcell-replay-engine.js';
import { makeReplayCase } from '../src/kernel/l5-growth/tcell-replay.js';
import { makeTCellCandidate } from '../src/kernel/l5-growth/tcell-core.js';

const 근거저장소 = (refs = ['ledger:s:1', 'ledger:s:2']) => ({ has: (r) => refs.includes(r) });
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
const 기본사례 = () => [사례('positive', 'p1'), 사례('negative', 'n1'), 사례('boundary', 'b1')];
const 실행 = (id, facts = {}) => ({ caseId: id, executedAt: 100, facts: { held: [], happened: [], ...facts } });
const 통과실행 = () => [
  실행('p1', { held: ['positive 성립'] }), 실행('n1', { held: ['negative 성립'] }), 실행('b1', { held: ['boundary 성립'] }),
];
const 관찰 = (turnId, ref) => ({ id: `o-${ref}`, sessionId: 's', turnId, receiptRefs: [ref], type: 'tool_result', signal: { valence: 'failure', summary: 'x' } });
const 두턴관찰 = () => [관찰('1', 'ledger:s:1'), 관찰('2', 'ledger:s:2')];
const 완전묶음 = (over = {}) => makeVerifiedReplayPacket({
  cases: 기본사례(), executions: 통과실행(), observations: 두턴관찰(), evidenceStore: 근거저장소(),
  baseline: { unnecessaryQuestions: 2, turnsToSuccess: 4, activeTargetAccuracy: 0.7 },
  candidate: { unnecessaryQuestions: 1, turnsToSuccess: 3, activeTargetAccuracy: 0.9 },
  userConfirmation: { confirmed: true, at: 1 }, now: 100, ...over,
});

test('감사 P1-1: 안 돌린 사례는 통과가 아니라 판정 불가다', () => {
  const c = 세포();
  // mustNotHappen 만 있는 negative/boundary — 실행 증거가 없으면 통과할 수 없다.
  const cases = [사례('positive', 'p1'),
    makeReplayCase({ id: 'n1', kind: 'negative', sourceRefs: ['x'], expected: { mustHold: [], mustNotHappen: ['붕괴'] } }),
    makeReplayCase({ id: 'b1', kind: 'boundary', sourceRefs: ['x'], expected: { mustHold: [], mustNotHappen: ['넘침'] } })];
  const r = runReplaySuite(c, 완전묶음({ cases, executions: [실행('p1', { held: ['positive 성립'] })] }));
  assert.equal(r.verdict, 'insufficient_evidence', `안 돌린 사례가 ${r.verdict} 가 됐다`);
  assert.equal(r.overallPassed, false);
  assert.ok(r.missing.some((m) => m.startsWith('execution:')), `실행 누락이 보고되지 않았다: ${r.missing}`);
  // 전부 실행하면 정상 통과한다(대조군 — 그냥 다 막는 게 아니다).
  const ok = runReplaySuite(c, 완전묶음({ cases, executions: [실행('p1', { held: ['positive 성립'] }), 실행('n1'), 실행('b1')] }));
  assert.equal(ok.verdict, 'passed');
});

test('감사 P1-1: baseline·candidate 가 없으면 counterfactual 은 통과가 아니다', () => {
  assert.equal(counterfactualReplay(null, null).insufficient, true);
  assert.equal(counterfactualReplay(null, null).passed, false);
  const r = runReplaySuite(세포(), 완전묶음({ baseline: null, candidate: null }));
  assert.equal(r.verdict, 'insufficient_evidence');
  assert.ok(r.missing.includes('baseline/candidate'));
});

test('감사 P1-2: 상태는 한 계단씩만 오르고 종착 상태는 자동 부활하지 않는다', () => {
  const pk = 완전묶음();
  // M1 → M4 직행 불가(한 칸씩).
  const m1 = 세포({ state: 'M1_candidate', effect: { eligibleCount: 100, successCount: 100 }, authority: { requiresUserConfirmation: false } });
  const d1 = decideTransition(m1, pk);
  assert.equal(d1.state, 'M2_replayed', `M1 에서 ${d1.state} 로 뛰었다`);
  // rolled_back / quarantined 부활 불가.
  for (const 종착 of ['rolled_back', 'quarantined']) {
    const c = 세포({ state: 종착, effect: { eligibleCount: 100, successCount: 100 }, authority: { requiresUserConfirmation: false } });
    const d = decideTransition(c, pk);
    assert.equal(d.state, 종착, `${종착} 이 ${d.state} 로 부활했다`);
    assert.deepEqual(d.allowedInfluence, ['none']);
    // 적용 단계도 막는다(결정이 오염돼도).
    const 적용 = applyTransition(c, { state: 'M4_stable', allowedInfluence: ['answer_anchor'] });
    assert.equal(적용.state, 종착, `적용에서 ${종착} 이 부활했다`);
    assert.deepEqual(적용.authority.allowedInfluence, []);
  }
});

test('감사 P1-3: trace 는 실제 근거 저장소로 확인하고, 턴 수는 턴 신분으로 센다', () => {
  const c = 세포({ trace: { observationRefs: ['없는참조1', '없는참조2'], corrections: [] } });
  // 저장소가 없으면 판정 불가(확인 못 한 것은 통과가 아니다).
  assert.equal(structuralReplay(c, null).insufficient, true);
  // 저장소가 있으면 존재하지 않는 참조는 실패다.
  const st = structuralReplay(c, 근거저장소());
  assert.equal(st.passed, false, '존재하지 않는 참조가 tracePassed 가 됐다');
  // 같은 턴의 영수증 2개는 서로 다른 턴 2개가 아니다.
  const 한턴 = 세포();
  assert.equal(distinctTurnsOf(한턴, [관찰('7', 'ledger:s:1'), 관찰('7', 'ledger:s:2')]).count, 1, '같은 턴이 2턴으로 부풀었다');
  assert.equal(distinctTurnsOf(한턴, 두턴관찰()).count, 2);
  // 턴 신분이 없으면 근거로 세지 않는다.
  assert.equal(distinctTurnsOf(한턴, [관찰(null, 'ledger:s:1'), 관찰('', 'ledger:s:2')]).count, 0);
  // 전이에 실제로 반영된다: 같은 턴 근거만으로는 M1 을 못 넘는다.
  const d = decideTransition(세포({ authority: { requiresUserConfirmation: false } }),
    완전묶음({ observations: [관찰('7', 'ledger:s:1'), 관찰('7', 'ledger:s:2')] }));
  assert.equal(d.state, 'M1_candidate', `같은 턴 근거로 ${d.state} 가 됐다`);
});

test('감사 P2: 성공·effect·replay 상태가 한 통로에서 나오고, z 오염은 NaN 이 아니다', () => {
  // 예측 없는 개선은 이 원리의 공이 아니다.
  assert.equal(isSuccessfulOutcome({ improvementObserved: true }), false);
  assert.equal(isSuccessfulOutcome({ predictedImprovement: true, improvementObserved: true }), true);
  assert.equal(isSuccessfulOutcome({ predictedImprovement: true, improvementObserved: true, userCorrected: true }), false);
  assert.equal(isSuccessfulOutcome({ toolExitOk: true, predictedImprovement: true }), false);
  // 단일 통로 집계.
  const e = foldOutcomes([
    { predictedImprovement: true, improvementObserved: true },
    { predictedImprovement: true, improvementObserved: false, failureKind: 'x' },
    { predictedImprovement: true, improvementObserved: false, failureKind: 'x' },
    { predictedImprovement: true, improvementObserved: true, userCorrected: true },
    { authorityViolated: true },
  ]);
  assert.equal(e.eligibleCount, 5);
  assert.equal(e.successCount, 1);
  assert.equal(e.userCorrectionCount, 1);
  assert.equal(e.authorityViolationCount, 1);
  assert.equal(e.sameFailureRecurrenceCount, 1, '같은 실패 재발이 집계되지 않았다');
  assert.ok(e.wilsonLowerBound > 0 && e.wilsonLowerBound < 1);
  // 잘못된 z 는 NaN 이 아니라 0.
  for (const z of [0, -1, NaN, 'x', null]) assert.equal(wilsonLowerBound(5, 10, z), 0, `z=${z} 에서 NaN/이상값`);
  // 적용이 replay 상태·caseRefs·시각·effect 를 함께 갱신한다(두 진실 금지).
  const c = 세포({ state: 'M1_candidate', authority: { requiresUserConfirmation: false } });
  const d = decideTransition(c, 완전묶음());
  const 적용 = applyTransition(c, d, { outcomes: [{ predictedImprovement: true, improvementObserved: true }] });
  assert.notEqual(적용.replay.status, 'untested', 'M2 로 올라갔는데 replay 상태가 untested 다');
  assert.deepEqual(적용.replay.caseRefs, ['p1', 'n1', 'b1']);
  assert.equal(적용.replay.lastRunAt, 100);
  assert.equal(적용.effect.eligibleCount, 1);
});

test('감사 P2: 마찰 지표 전체를 본다 — 클릭·불필요 확인·개입·잘못된 도구 선택 포함', () => {
  for (const m of ['clicks', 'unnecessaryConfirmations', 'userInterventions', 'wrongToolChoices']) {
    assert.ok(FRICTION_METRICS.includes(m), `마찰 지표에 ${m} 이 없다`);
    const base = { [m]: 1, activeTargetAccuracy: 0.7 };
    const r = counterfactualReplay(base, { [m]: 3, activeTargetAccuracy: 0.99 });
    assert.equal(r.passed, false, `${m} 이 늘었는데 성장으로 봤다`);
  }
});

test('명세 검사: positive 만·negative 붕괴·authority 실패·점수 과신 — 전부 승격 실패', () => {
  const c = 세포();
  // positive 만
  const only = runReplaySuite(c, 완전묶음({ cases: [사례('positive', 'p1')], executions: [실행('p1', { held: ['positive 성립'] })] }));
  assert.equal(only.overallPassed, false);
  assert.deepEqual(minimumSuiteGaps(c, [사례('positive', 'p1')]).sort(), ['boundary', 'negative']);
  // negative 붕괴
  const n = makeReplayCase({ id: 'n1', kind: 'negative', sourceRefs: ['x'], expected: { mustHold: [], mustNotHappen: ['붕괴'] } });
  const 붕괴 = runReplaySuite(c, 완전묶음({ cases: [사례('positive', 'p1'), n, 사례('boundary', 'b1')],
    executions: [실행('p1', { held: ['positive 성립'] }), 실행('n1', { happened: ['붕괴'] }), 실행('b1', { held: ['boundary 성립'] })] }));
  assert.equal(붕괴.negativePassed, false);
  assert.equal(붕괴.overallPassed, false);
  // authority 실패 → 격리(표본 100/100 이어도)
  const 행동 = 세포({ principle: { statement: '보낼 때 대상 확정 후 보낸다', type: 'execution' },
    effect: { eligibleCount: 100, successCount: 100 }, authority: { requiresUserConfirmation: false } });
  const auth = makeReplayCase({ id: 'a1', kind: 'boundary', sourceRefs: ['x'],
    expected: { mustHold: [], mustNotHappen: ['승인 없이 전송'], expectedActionKind: 'send' } });
  const d = decideTransition(행동, 완전묶음({ cases: [...기본사례(), auth],
    executions: [...통과실행(), 실행('a1', { happened: ['승인 없이 전송'], actionKind: 'send' })] }));
  assert.equal(d.state, 'quarantined', `authority 실패인데 ${d.state}`);
  // 점수가 높아도 승인 요구는 안 꺼진다.
  const 확인필요 = 세포({ effect: { eligibleCount: 200, successCount: 200 }, authority: { requiresUserConfirmation: true } });
  assert.equal(decideTransition(확인필요, 완전묶음({ userConfirmation: null })).state, 'M1_candidate');
  const 적용 = applyTransition(확인필요, decideTransition(확인필요, 완전묶음()));
  assert.equal(적용.authority.requiresUserConfirmation, true, '승격이 승인 요구를 껐다');
});

test('명세 검사: replay 통과한 A0/A1 원리는 계단을 밟아 제한 범위 입장에 이른다', () => {
  let c = 세포({ authority: { requiresUserConfirmation: false } });
  // M1 → M2
  let d = decideTransition(c, 완전묶음());
  c = applyTransition(c, d);
  assert.equal(c.state, 'M2_replayed');
  // 결과가 쌓이면 M2 → M3(제한 범위 영향 가능)
  c.effect = { ...c.effect, eligibleCount: 6, successCount: 6 };
  d = decideTransition(c, 완전묶음());
  c = applyTransition(c, d);
  assert.equal(c.state, 'M3_limited');
  assert.ok(c.authority.allowedInfluence.includes('plan_hint') && c.authority.allowedInfluence.includes('default_value'),
    '검증된 A0/A1 원리가 제한 범위에서도 입장하지 못한다');
  assert.ok(!c.authority.allowedInfluence.includes('answer_anchor'));
  // transfer replay 없이는 M4 로 못 간다.
  c.effect = { ...c.effect, eligibleCount: 20, successCount: 20, userCorrectionCount: 0 };
  assert.equal(decideTransition(c, 완전묶음()).state, 'M3_limited');
  const 전이통과 = decideTransition(c, 완전묶음({ transfer: { executed: true, passed: true } }));
  assert.equal(전이통과.state, 'M4_stable');
  assert.equal(applyTransition(c, 전이통과).replay.status, 'passed_transfer');
});

test('total function: 임의 입력에도 던지지 않고, 묶음 완결성은 정직하게 보고된다', () => {
  for (const 이상 of [null, 7, 'x', [], { effect: 'nope' }, { effect: { authorityViolationCount: 'x' } }]) {
    assert.doesNotThrow(() => decideTransition(이상, 이상));
    assert.doesNotThrow(() => runReplaySuite(이상, 이상));
    assert.doesNotThrow(() => applyTransition(이상, 이상));
    assert.doesNotThrow(() => validateReplayPacket(이상, 이상));
    assert.doesNotThrow(() => distinctTurnsOf(이상, 이상));
    assert.doesNotThrow(() => foldOutcomes(이상));
  }
  assert.equal(decideTransition({ state: 'M1_candidate', effect: { authorityViolationCount: 'x' } }, {}).state, 'quarantined');
  assert.equal(MATURITY_LADDER.length, 6);
  assert.equal(TCELL_THRESHOLDS.candidateDistinctTurns, 2);
});

test('구조 경계: replay 엔진은 실행 수단을 받지도 부르지도 않는다(§9.3)', async () => {
  const src = (await readFile('src/kernel/l5-growth/tcell-replay-engine.js', 'utf8'))
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'execution'/g, "'<원리종류>'"); // 원리 '종류' 이름은 실행 수단이 아니다
  // **호출 패턴**을 본다 — 데이터 이름(executions = 실행 '증거' 목록)은 실행 수단이 아니다.
  const 금지패턴 = [
    /\bchild_process\b/, /\brequire\s*\(/, /\bimport\s*\(/, /\bfetch\s*\(/,
    /\bexecSync\b/, /\.exec\s*\(/, /\bspawn\w*\s*\(/, /\bwriteFile\b/, /\bappendFile\b/,
    /\breadFile\b/, /\.handler\s*\(/, /\bctx\.tools\b/, /\btools\s*[.[]/, /\bprocess\.\w/,
  ];
  for (const 금지 of 금지패턴) {
    assert.ok(!금지.test(src), `replay 엔진이 실행 수단(${금지})에 닿는다 — 계획·권한 판정까지만이다`);
  }
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./tcell-core.js', './tcell-replay.js'], `허용 밖 의존: ${imports}`);
});
