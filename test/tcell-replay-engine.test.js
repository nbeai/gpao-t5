// TG-4 반대시험(명세 §16 TG-4 + §9·§10 + 감사 2026-07-29) — 검증된 사실 묶음만 판정한다.
// 감사 재현 입력을 전부 포함한다: 안 돌린 사례 통과 · 상태 건너뛰기 · 종착 부활 ·
// trace 미확인 · 임의 decision · z 오염 · 마찰 지표 누락.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  wilsonLowerBound, isSuccessfulOutcome, foldOutcomes, structuralReplay, counterfactualReplay,
  minimumSuiteGaps, runReplaySuite, transitionCell, distinctTurnsOf, makeVerifiedReplayPacket,
  validateReplayPacket, TCELL_THRESHOLDS, FRICTION_METRICS, MATURITY_LADDER, REQUIRED_COMPARISON_METRICS,
} from '../src/kernel/l5-growth/tcell-replay-engine.js';
import { makeReplayCase } from '../src/kernel/l5-growth/tcell-replay.js';
import { makeTCellCandidate } from '../src/kernel/l5-growth/tcell-core.js';

// 근거 저장소 — **주장이 아니라 기록을 돌려준다.** 시험도 제품과 같은 계약을 쓴다.
const 저장소 = (records = {}) => ({ get: (r) => records[r] ?? null });
const 관찰기록 = (turnId, sessionId = 's') => ({ type: 'tool_result', sessionId, turnId, signal: { valence: 'failure', summary: 'x' } });
const 기본기록 = (cellId = undefined) => ({
  'ledger:s:1': 관찰기록('1'), 'ledger:s:2': 관찰기록('2'),
  'confirm:1': { confirmed: true, at: 10, ...(cellId ? { tcellId: cellId } : {}) },
  'transfer:1': { executed: true, passed: true, at: 20, ...(cellId ? { tcellId: cellId } : {}) },
});
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
const 통과실행 = () => [실행('p1', { held: ['positive 성립'] }), 실행('n1', { held: ['negative 성립'] }), 실행('b1', { held: ['boundary 성립'] })];
const 측정 = (over = {}) => ({
  activeTargetAccuracy: 0.7, unnecessaryQuestions: 2, unnecessaryConfirmations: 1,
  userInterventions: 2, userCorrections: 1, missedApprovals: 0, turnsToSuccess: 4, ...over,
});
const 완전묶음 = (over = {}) => makeVerifiedReplayPacket({
  cases: 기본사례(), executions: 통과실행(), evidenceStore: 저장소(기본기록()),
  baseline: 측정(), candidate: 측정({ activeTargetAccuracy: 0.9, unnecessaryQuestions: 1, turnsToSuccess: 3 }),
  userConfirmationRef: 'confirm:1', now: 100, ...over,
});
const 상태 = (cell, pk, outcomes) => transitionCell(cell, pk, outcomes).cell.state;

test('감사 P1-1: 안 돌린 사례는 통과가 아니라 판정 불가다', () => {
  const c = 세포();
  const cases = [사례('positive', 'p1'),
    makeReplayCase({ id: 'n1', kind: 'negative', sourceRefs: ['ledger:s:1'], expected: { mustHold: [], mustNotHappen: ['붕괴'] } }),
    makeReplayCase({ id: 'b1', kind: 'boundary', sourceRefs: ['ledger:s:1'], expected: { mustHold: [], mustNotHappen: ['넘침'] } })];
  const r = runReplaySuite(c, 완전묶음({ cases, executions: [실행('p1', { held: ['positive 성립'] })] }));
  assert.equal(r.verdict, 'insufficient_evidence', `안 돌린 사례가 ${r.verdict} 가 됐다`);
  assert.ok(r.missing.some((m) => m.startsWith('execution:')));
  const ok = runReplaySuite(c, 완전묶음({ cases, executions: [실행('p1', { held: ['positive 성립'] }), 실행('n1'), 실행('b1')] }));
  assert.equal(ok.verdict, 'passed', `대조군이 통과하지 않는다: ${JSON.stringify(ok.missing)}`);
});

test('재감사 ①: 빈 baseline/candidate 는 통과가 아니라 판정 불가다', () => {
  // 감사 재현 입력 그대로: baseline:{}, candidate:{}
  const r = runReplaySuite(세포(), 완전묶음({ baseline: {}, candidate: {} }));
  assert.equal(r.verdict, 'insufficient_evidence', `빈 측정값이 ${r.verdict} 가 됐다`);
  assert.equal(r.counterfactual.insufficient, true);
  // 필수 지표 하나만 빠져도 판정 불가.
  for (const k of REQUIRED_COMPARISON_METRICS) {
    const 결측 = 측정(); delete 결측[k];
    assert.equal(runReplaySuite(세포(), 완전묶음({ baseline: 결측 })).verdict, 'insufficient_evidence', `${k} 없이 판정됐다`);
    const 비수치 = 측정({ [k]: '많음' });
    assert.equal(runReplaySuite(세포(), 완전묶음({ candidate: 비수치 })).verdict, 'insufficient_evidence', `${k} 비수치가 판정됐다`);
  }
});

test('재감사 ②: 존재하지 않는 사례 근거·세포 근거는 통과하지 못하고, 남의 계보도 막힌다', () => {
  const c = 세포();
  // 감사 재현: case sourceRefs 가 저장소에 없다.
  const 지어낸 = [사례('positive', 'p1', { sourceRefs: ['없는근거'] }), 사례('negative', 'n1'), 사례('boundary', 'b1')];
  const r = runReplaySuite(c, 완전묶음({ cases: 지어낸 }));
  assert.equal(r.verdict, 'insufficient_evidence', '지어낸 사례 근거가 통과했다');
  assert.ok(r.missing.some((m) => m.startsWith('case.sourceRef:')));
  // 세포 trace 근거 자체가 저장소에 없으면 판정 불가.
  const 빈저장소 = runReplaySuite(c, 완전묶음({ evidenceStore: 저장소({ 'confirm:1': { confirmed: true, at: 1 } }) }));
  assert.ok(빈저장소.missing.some((m) => m.startsWith('observation:')), '없는 세포 근거가 통과했다');
  // 저장소에 있어도 이 세포의 계보 밖 근거로 만든 사례는 막는다.
  const 남의근거 = [사례('positive', 'p1', { sourceRefs: ['ledger:s:9'] }), 사례('negative', 'n1'), 사례('boundary', 'b1')];
  const r2 = runReplaySuite(c, 완전묶음({ cases: 남의근거, evidenceStore: 저장소({ ...기본기록(), 'ledger:s:9': 관찰기록('9') }) }));
  assert.ok(r2.missing.some((m) => m.startsWith('case.lineage:')), '남의 근거로 만든 사례가 통과했다');
});

test('재감사 ③: 확인·transfer 는 참조로 조회된 기록일 때만 인정된다', () => {
  const c = 세포({ authority: { requiresUserConfirmation: true } });
  // 감사 재현: ref 없이 confirmed:true 만 주장 → 인정되지 않는다(그 필드는 이제 없다).
  assert.equal(makeVerifiedReplayPacket({ userConfirmation: { confirmed: true } }).userConfirmationRef, null);
  assert.equal(상태(c, 완전묶음({ userConfirmationRef: null })), 'M1_candidate', 'ref 없는 확인이 인정됐다');
  // 참조가 저장소에 없으면 판정 불가.
  const r = runReplaySuite(c, 완전묶음({ userConfirmationRef: 'confirm:없음' }));
  assert.ok(r.missing.some((m) => m.startsWith('confirmation:')), '없는 확인 기록이 통과했다');
  // 내용이 다르면(다른 세포의 확인) 판정 불가.
  const 남의확인 = 저장소({ ...기본기록(), 'confirm:1': { confirmed: true, at: 1, tcellId: '남의세포' } });
  assert.ok(runReplaySuite(c, 완전묶음({ evidenceStore: 남의확인 })).missing.includes('confirmation.content'));
  // transfer 도 같다: 주장만으로는 M4 가 없다.
  let m3 = 세포({ state: 'M3_limited', effect: { eligibleCount: 20, successCount: 20 }, authority: { requiresUserConfirmation: false } });
  assert.equal(상태(m3, 완전묶음({ transferRef: null })), 'M3_limited', 'transfer 없이 M4 가 됐다');
  assert.equal(상태(m3, 완전묶음({ transferRef: 'transfer:없음' })), 'M3_limited', '없는 transfer 기록으로 M4 가 됐다');
  assert.equal(상태(m3, 완전묶음({ transferRef: 'transfer:1' })), 'M4_stable', '정상 transfer 기록이 인정되지 않았다');
  const 실패transfer = 저장소({ ...기본기록(), 'transfer:1': { executed: true, passed: false, at: 5 } });
  assert.equal(상태(m3, 완전묶음({ transferRef: 'transfer:1', evidenceStore: 실패transfer })), 'M3_limited');
});

test('재감사 ④: 성숙도·replay·영향을 바꾸는 공개 경로는 transitionCell 하나뿐이다', async () => {
  // 위조 decision 을 넣을 공개 함수 자체가 없다(applyTransition·decideTransition 비공개).
  const mod = await import('../src/kernel/l5-growth/tcell-replay-engine.js');
  assert.equal(mod.applyTransition, undefined, 'applyTransition 이 공개돼 있다');
  assert.equal(mod.decideTransition, undefined, 'decideTransition 이 공개돼 있다');
  // 단일 통로는 packet 에서 다시 계산한다 — 자료가 없으면 승격도 replay 기록도 없다.
  const c = 세포({ authority: { requiresUserConfirmation: false } });
  const 빈판정 = transitionCell(c, makeVerifiedReplayPacket({}));
  assert.equal(빈판정.cell.state, 'M1_candidate', '자료 없이 승격됐다');
  assert.equal(빈판정.cell.replay.status, 'untested');
  assert.equal(빈판정.decision.replay.verdict, 'insufficient_evidence');
  // 정상 승격은 replay 상태가 함께 간다(두 진실 금지).
  const 정상 = transitionCell(c, 완전묶음());
  assert.equal(정상.cell.state, 'M2_replayed');
  assert.notEqual(정상.cell.replay.status, 'untested', 'M2 인데 replay 가 untested 다');
  assert.deepEqual(정상.cell.replay.caseRefs, ['p1', 'n1', 'b1']);
});

test('재감사 ⑤: 턴 신분은 저장소에서 조회한 관찰로만 센다', () => {
  const c = 세포();
  // 감사 재현: 임의 turnId 두 개를 넘겨 2턴으로 인정받던 경로가 이제 없다(인자가 저장소다).
  assert.equal(distinctTurnsOf(c, 저장소({ 'ledger:s:1': 관찰기록('7'), 'ledger:s:2': 관찰기록('7') })).count, 1, '같은 턴이 2턴으로 부풀었다');
  assert.equal(distinctTurnsOf(c, 저장소(기본기록())).count, 2);
  assert.equal(distinctTurnsOf(c, 저장소({ 'ledger:s:1': 관찰기록(null), 'ledger:s:2': 관찰기록('') })).count, 0);
  assert.equal(distinctTurnsOf(c, 저장소({})).count, 0, '조회되지 않는 근거가 턴으로 셈됐다');
  // 전이에 반영된다.
  const 한턴저장소 = 저장소({ ...기본기록(), 'ledger:s:1': 관찰기록('7'), 'ledger:s:2': 관찰기록('7') });
  assert.equal(상태(세포({ authority: { requiresUserConfirmation: false } }), 완전묶음({ evidenceStore: 한턴저장소 })), 'M1_candidate');
});

test('감사 P1-2: 상태는 한 계단씩, 종착 상태는 자동 부활하지 않는다', () => {
  const pk = 완전묶음();
  const m1 = 세포({ state: 'M1_candidate', effect: { eligibleCount: 100, successCount: 100 }, authority: { requiresUserConfirmation: false } });
  assert.equal(상태(m1, pk), 'M2_replayed', 'M1 에서 뛰었다');
  for (const 종착 of ['rolled_back', 'quarantined']) {
    const c = 세포({ state: 종착, effect: { eligibleCount: 100, successCount: 100 }, authority: { requiresUserConfirmation: false } });
    const out = transitionCell(c, pk);
    assert.equal(out.cell.state, 종착, `${종착} 이 부활했다`);
    assert.deepEqual(out.cell.authority.allowedInfluence, ['none'], '종착 상태에 영향이 남았다');
  }
});

test('감사 P1-3: trace 는 실제 근거로 확인한다', () => {
  const c = 세포({ trace: { observationRefs: ['없는참조1', '없는참조2'], corrections: [] } });
  assert.equal(structuralReplay(c, null).insufficient, true);
  assert.equal(structuralReplay(c, 저장소(기본기록())).passed, false, '없는 참조가 tracePassed 가 됐다');
  assert.equal(structuralReplay(세포(), 저장소(기본기록())).passed, true);
});

test('감사 P2: 성공·effect·replay 상태가 한 통로에서 나오고, z 오염은 NaN 이 아니다', () => {
  assert.equal(isSuccessfulOutcome({ improvementObserved: true }), false);
  assert.equal(isSuccessfulOutcome({ predictedImprovement: true, improvementObserved: true }), true);
  assert.equal(isSuccessfulOutcome({ toolExitOk: true, predictedImprovement: true }), false);
  const e = foldOutcomes([
    { predictedImprovement: true, improvementObserved: true },
    { predictedImprovement: true, improvementObserved: false, failureKind: 'x' },
    { predictedImprovement: true, improvementObserved: false, failureKind: 'x' },
    { predictedImprovement: true, improvementObserved: true, userCorrected: true },
    { authorityViolated: true },
  ]);
  assert.equal(e.eligibleCount, 5); assert.equal(e.successCount, 1);
  assert.equal(e.sameFailureRecurrenceCount, 1); assert.equal(e.authorityViolationCount, 1);
  for (const z of [0, -1, NaN, 'x', null]) assert.equal(wilsonLowerBound(5, 10, z), 0, `z=${z}`);
  const out = transitionCell(세포({ authority: { requiresUserConfirmation: false } }), 완전묶음(),
    [{ predictedImprovement: true, improvementObserved: true }]);
  assert.equal(out.cell.effect.eligibleCount, 1);
  assert.equal(out.cell.replay.lastRunAt, 100);
});

test('감사 P2: 마찰 지표 전체를 본다 — 클릭·불필요 확인·개입·잘못된 도구 선택 포함', () => {
  for (const m of ['clicks', 'unnecessaryConfirmations', 'userInterventions', 'wrongToolChoices']) {
    assert.ok(FRICTION_METRICS.includes(m), `마찰 지표에 ${m} 이 없다`);
    const r = counterfactualReplay(측정({ [m]: 1 }), 측정({ [m]: 3, activeTargetAccuracy: 0.99 }));
    assert.equal(r.passed, false, `${m} 이 늘었는데 성장으로 봤다`);
  }
});

test('명세 검사: positive 만·negative 붕괴·authority 실패·점수 과신 — 전부 승격 실패', () => {
  const c = 세포();
  assert.equal(runReplaySuite(c, 완전묶음({ cases: [사례('positive', 'p1')], executions: [실행('p1', { held: ['positive 성립'] })] })).overallPassed, false);
  assert.deepEqual(minimumSuiteGaps(c, [사례('positive', 'p1')]).sort(), ['boundary', 'negative']);
  const n = makeReplayCase({ id: 'n1', kind: 'negative', sourceRefs: ['ledger:s:1'], expected: { mustHold: [], mustNotHappen: ['붕괴'] } });
  const 붕괴 = runReplaySuite(c, 완전묶음({ cases: [사례('positive', 'p1'), n, 사례('boundary', 'b1')],
    executions: [실행('p1', { held: ['positive 성립'] }), 실행('n1', { happened: ['붕괴'] }), 실행('b1', { held: ['boundary 성립'] })] }));
  assert.equal(붕괴.negativePassed, false);
  // authority 실패 → 격리(표본 100/100 이어도)
  const 행동 = 세포({ principle: { statement: '보낼 때 대상 확정 후 보낸다', type: 'execution' },
    effect: { eligibleCount: 100, successCount: 100 }, authority: { requiresUserConfirmation: false } });
  const auth = makeReplayCase({ id: 'a1', kind: 'boundary', sourceRefs: ['ledger:s:1'],
    expected: { mustHold: [], mustNotHappen: ['승인 없이 전송'], expectedActionKind: 'send' } });
  assert.equal(상태(행동, 완전묶음({ cases: [...기본사례(), auth],
    executions: [...통과실행(), 실행('a1', { happened: ['승인 없이 전송'], actionKind: 'send' })] })), 'quarantined');
  // 점수가 높아도 승인 요구는 안 꺼진다.
  const 확인필요 = 세포({ effect: { eligibleCount: 200, successCount: 200 }, authority: { requiresUserConfirmation: true } });
  assert.equal(transitionCell(확인필요, 완전묶음()).cell.authority.requiresUserConfirmation, true);
});

test('명세 검사: replay 통과한 A0/A1 원리는 계단을 밟아 제한 범위 입장에 이른다', () => {
  let c = 세포({ authority: { requiresUserConfirmation: false } });
  c = transitionCell(c, 완전묶음()).cell;
  assert.equal(c.state, 'M2_replayed');
  c.effect = { ...c.effect, eligibleCount: 6, successCount: 6 };
  c = transitionCell(c, 완전묶음()).cell;
  assert.equal(c.state, 'M3_limited');
  assert.ok(c.authority.allowedInfluence.includes('plan_hint') && c.authority.allowedInfluence.includes('default_value'));
  assert.ok(!c.authority.allowedInfluence.includes('answer_anchor'));
  c.effect = { ...c.effect, eligibleCount: 20, successCount: 20, userCorrectionCount: 0 };
  assert.equal(transitionCell(c, 완전묶음()).cell.state, 'M3_limited', 'transfer 없이 M4 가 됐다');
  const m4 = transitionCell(c, 완전묶음({ transferRef: 'transfer:1' })).cell;
  assert.equal(m4.state, 'M4_stable');
  assert.equal(m4.replay.status, 'passed_transfer');
});

test('total function: 임의 입력에도 던지지 않는다', () => {
  for (const 이상 of [null, 7, 'x', [], { effect: 'nope' }, { effect: { authorityViolationCount: 'x' } }]) {
    assert.doesNotThrow(() => transitionCell(이상, 이상));
    assert.doesNotThrow(() => runReplaySuite(이상, 이상));
    assert.doesNotThrow(() => validateReplayPacket(이상, 이상));
    assert.doesNotThrow(() => distinctTurnsOf(이상, 이상));
    assert.doesNotThrow(() => foldOutcomes(이상));
    assert.doesNotThrow(() => counterfactualReplay(이상, 이상));
  }
  assert.equal(transitionCell({ state: 'M1_candidate', effect: { authorityViolationCount: 'x' } }, {}).cell.state, 'quarantined');
  assert.equal(MATURITY_LADDER.length, 6);
  assert.equal(TCELL_THRESHOLDS.candidateDistinctTurns, 2);
});

test('구조 경계: replay 엔진은 실행 수단을 받지도 부르지도 않는다(§9.3)', async () => {
  const src = (await readFile('src/kernel/l5-growth/tcell-replay-engine.js', 'utf8'))
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'execution'/g, "'<원리종류>'");
  const 금지패턴 = [
    /\bchild_process\b/, /\brequire\s*\(/, /\bimport\s*\(/, /\bfetch\s*\(/,
    /\bexecSync\b/, /\.exec\s*\(/, /\bspawn\w*\s*\(/, /\bwriteFile\b/, /\bappendFile\b/,
    /\breadFile\b/, /\.handler\s*\(/, /\bctx\.tools\b/, /\btools\s*[.[]/, /\bprocess\.\w/,
  ];
  for (const 금지 of 금지패턴) assert.ok(!금지.test(src), `실행 수단(${금지})에 닿는다`);
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./tcell-core.js', './tcell-replay.js'], `허용 밖 의존: ${imports}`);
});
