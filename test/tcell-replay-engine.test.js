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

/** 실행 **기록** — 저장소에 사는 사실이다(호출자 주장 아님). */
const 실행기록 = (cell, caseId, facts = {}, over = {}) => ({
  kind: 'replay_execution', tcellId: cell.id, caseId, executedAt: 100,
  sourceRefs: ['ledger:s:1'], facts: { held: [], happened: [], ...facts }, ...over,
});
const 기본기록 = (cell, over = {}) => ({
  'ledger:s:1': 관찰기록('1'), 'ledger:s:2': 관찰기록('2'),
  'exec:p1': 실행기록(cell, 'p1', { held: ['positive 성립'] }),
  'exec:n1': 실행기록(cell, 'n1', { held: ['negative 성립'] }),
  'exec:b1': 실행기록(cell, 'b1', { held: ['boundary 성립'] }),
  'confirm:1': { kind: 'user_confirmation', tcellId: cell.id, at: 10, sourceRefs: ['ledger:s:1'], confirmed: true },
  'transfer:1': { kind: 'transfer_replay', tcellId: cell.id, at: 20, caseRefs: ['p1'], executed: true, passed: true },
  ...over,
});
const 기본참조 = () => ['exec:p1', 'exec:n1', 'exec:b1'];
// 필수 비교 지표 12종(activeTargetAccuracy + FRICTION_METRICS 전체)
const 측정 = (over = {}) => Object.fromEntries([
  ['activeTargetAccuracy', 0.7], ...FRICTION_METRICS.map((k) => [k, 2]),
].concat(Object.entries(over)));
const 완전묶음 = (cell, over = {}) => makeVerifiedReplayPacket({
  cases: 기본사례(), executionRefs: 기본참조(), evidenceStore: 저장소(기본기록(cell)),
  baseline: 측정(), candidate: 측정({ activeTargetAccuracy: 0.9, unnecessaryQuestions: 1, turnsToSuccess: 1 }),
  userConfirmationRef: 'confirm:1', now: 100, ...over,
});
const 상태 = (cell, pk, outcomes) => transitionCell(cell, pk, outcomes).cell.state;

test('감사 3차 ①: 실행 결과도 저장소가 말한다 — packet 주장으로는 통과하지 못한다', () => {
  const c = 세포();
  // 감사 재현: 저장소에 실행 기록이 없는데 호출자가 성공을 주장한다.
  const 주장만 = 완전묶음(c, { evidenceStore: 저장소({ 'ledger:s:1': 관찰기록('1'), 'ledger:s:2': 관찰기록('2') }) });
  const r = runReplaySuite(c, 주장만);
  assert.equal(r.verdict, 'insufficient_evidence', `실행 기록 없이 ${r.verdict} 가 됐다`);
  assert.ok(r.missing.some((m) => m.startsWith('execution:')));
  // 기록의 tcellId·caseId·sourceRefs 가 어긋나면 판정 불가.
  for (const [이름, 어긋남] of [
    ['tcellId', { tcellId: '남의세포' }],
    ['caseId', { caseId: '다른사례' }],
    ['sourceRefs', { sourceRefs: ['ledger:s:9'] }],
    ['kind', { kind: '아무거나' }],
    ['facts', { facts: { held: '문자열' } }],
  ]) {
    const 오염 = 저장소(기본기록(c, { 'exec:p1': 실행기록(c, 'p1', { held: ['positive 성립'] }, 어긋남) }));
    const rr = runReplaySuite(c, 완전묶음(c, { evidenceStore: 오염 }));
    assert.equal(rr.verdict, 'insufficient_evidence', `${이름} 불일치가 통과했다`);
  }
  // 대조군: 모든 기록이 제자리면 통과한다.
  assert.equal(runReplaySuite(c, 완전묶음(c)).verdict, 'passed');
});

test('감사 3차 ②: 확인·transfer 는 kind·tcellId·시각·원본 참조가 모두 있어야 인정된다', () => {
  const c = 세포({ authority: { requiresUserConfirmation: true } });
  // 감사 재현: tcellId 없는 확인 기록 → 인정되면 안 된다.
  const tcell없음 = 저장소(기본기록(c, { 'confirm:1': { kind: 'user_confirmation', at: 1, sourceRefs: ['ledger:s:1'], confirmed: true } }));
  assert.equal(상태(c, 완전묶음(c, { evidenceStore: tcell없음 })), 'M1_candidate', 'tcellId 없는 확인이 인정됐다');
  // kind 없음 · 시각 없음 · 원본 참조 없음 · 다른 세포
  for (const [이름, 나쁜기록] of [
    ['kind 없음', { tcellId: c.id, at: 1, sourceRefs: ['ledger:s:1'], confirmed: true }],
    ['시각 없음', { kind: 'user_confirmation', tcellId: c.id, sourceRefs: ['ledger:s:1'], confirmed: true }],
    ['참조 없음', { kind: 'user_confirmation', tcellId: c.id, at: 1, confirmed: true }],
    ['다른 세포', { kind: 'user_confirmation', tcellId: '남', at: 1, sourceRefs: ['ledger:s:1'], confirmed: true }],
    ['계보 밖', { kind: 'user_confirmation', tcellId: c.id, at: 1, sourceRefs: ['ledger:s:9'], confirmed: true }],
  ]) {
    const st = 저장소(기본기록(c, { 'confirm:1': 나쁜기록 }));
    assert.equal(상태(c, 완전묶음(c, { evidenceStore: st })), 'M1_candidate', `확인 ${이름} 이 인정됐다`);
  }
  // transfer 도 같다 — tcellId 없는 transfer 로 M4 가 되면 안 된다.
  const m3 = 세포({ state: 'M3_limited', effect: { eligibleCount: 20, successCount: 20 }, authority: { requiresUserConfirmation: false } });
  const t없음 = 저장소(기본기록(m3, { 'transfer:1': { kind: 'transfer_replay', at: 1, caseRefs: ['p1'], executed: true, passed: true } }));
  assert.equal(상태(m3, 완전묶음(m3, { transferRef: 'transfer:1', evidenceStore: t없음 })), 'M3_limited', 'tcellId 없는 transfer 로 M4 가 됐다');
  const 남의t = 저장소(기본기록(m3, { 'transfer:1': { kind: 'transfer_replay', tcellId: '남', at: 1, caseRefs: ['p1'], executed: true, passed: true } }));
  assert.equal(상태(m3, 완전묶음(m3, { transferRef: 'transfer:1', evidenceStore: 남의t })), 'M3_limited', '다른 세포 transfer 가 인정됐다');
  // 대조군: 온전한 기록이면 M4.
  assert.equal(상태(m3, 완전묶음(m3, { transferRef: 'transfer:1' })), 'M4_stable');
});

test('감사 3차 ③: 필수 비교 지표 12종 — 하나씩 빼도 전부 판정 불가', () => {
  const c = 세포();
  assert.equal(REQUIRED_COMPARISON_METRICS.length, 12, `필수 지표가 ${REQUIRED_COMPARISON_METRICS.length}종이다`);
  for (const m of ['clicks', 'wrongContextIntrusions', 'wrongToolChoices', 'wrongTargetChoices', 'toolCalls']) {
    assert.ok(REQUIRED_COMPARISON_METRICS.includes(m), `${m} 이 필수 지표에 없다`);
  }
  for (const k of REQUIRED_COMPARISON_METRICS) {
    const 결측 = 측정(); delete 결측[k];
    assert.equal(runReplaySuite(c, 완전묶음(c, { baseline: 결측 })).verdict, 'insufficient_evidence', `${k} 결측이 통과했다`);
    assert.equal(runReplaySuite(c, 완전묶음(c, { candidate: 측정({ [k]: '많음' }) })).verdict, 'insufficient_evidence', `${k} 비수치가 통과했다`);
  }
  assert.equal(runReplaySuite(c, 완전묶음(c, { baseline: {}, candidate: {} })).verdict, 'insufficient_evidence');
  // 대조군: 12종이 전부 있으면 통과.
  assert.equal(runReplaySuite(c, 완전묶음(c)).verdict, 'passed');
});

test('감사 P1-1: 안 돌린 사례는 통과가 아니라 판정 불가다', () => {
  const c = 세포();
  const cases = [사례('positive', 'p1'),
    makeReplayCase({ id: 'n1', kind: 'negative', sourceRefs: ['ledger:s:1'], expected: { mustHold: [], mustNotHappen: ['붕괴'] } }),
    makeReplayCase({ id: 'b1', kind: 'boundary', sourceRefs: ['ledger:s:1'], expected: { mustHold: [], mustNotHappen: ['넘침'] } })];
  const r = runReplaySuite(c, 완전묶음(c, { cases, executionRefs: ['exec:p1'] }));
  assert.equal(r.verdict, 'insufficient_evidence');
  const ok = runReplaySuite(c, 완전묶음(c, { cases }));
  assert.equal(ok.verdict, 'passed', `대조군 실패: ${JSON.stringify(ok.missing)}`);
});

test('재감사 ②: 존재하지 않는 사례 근거·세포 근거·남의 계보는 통과하지 못한다', () => {
  const c = 세포();
  const 지어낸 = [사례('positive', 'p1', { sourceRefs: ['없는근거'] }), 사례('negative', 'n1'), 사례('boundary', 'b1')];
  assert.ok(runReplaySuite(c, 완전묶음(c, { cases: 지어낸 })).missing.some((m) => m.startsWith('case.sourceRef:')));
  const 빈저장소 = runReplaySuite(c, 완전묶음(c, { evidenceStore: 저장소({}) }));
  assert.ok(빈저장소.missing.some((m) => m.startsWith('observation:')));
  const 남의근거 = [사례('positive', 'p1', { sourceRefs: ['ledger:s:9'] }), 사례('negative', 'n1'), 사례('boundary', 'b1')];
  const st = 저장소({ ...기본기록(c), 'ledger:s:9': 관찰기록('9') });
  assert.ok(runReplaySuite(c, 완전묶음(c, { cases: 남의근거, evidenceStore: st })).missing.some((m) => m.startsWith('case.lineage:')));
});

test('재감사 ④: 성숙도·replay·영향을 바꾸는 공개 경로는 transitionCell 하나뿐이다', async () => {
  const mod = await import('../src/kernel/l5-growth/tcell-replay-engine.js');
  assert.equal(mod.applyTransition, undefined);
  assert.equal(mod.decideTransition, undefined);
  const c = 세포({ authority: { requiresUserConfirmation: false } });
  const 빈판정 = transitionCell(c, makeVerifiedReplayPacket({}));
  assert.equal(빈판정.cell.state, 'M1_candidate');
  assert.equal(빈판정.cell.replay.status, 'untested');
  const 정상 = transitionCell(c, 완전묶음(c));
  assert.equal(정상.cell.state, 'M2_replayed');
  assert.notEqual(정상.cell.replay.status, 'untested');
  assert.deepEqual(정상.cell.replay.caseRefs, ['p1', 'n1', 'b1']);
});

test('재감사 ⑤: 턴 신분은 저장소에서 조회한 관찰로만 센다', () => {
  const c = 세포();
  assert.equal(distinctTurnsOf(c, 저장소({ 'ledger:s:1': 관찰기록('7'), 'ledger:s:2': 관찰기록('7') })).count, 1);
  assert.equal(distinctTurnsOf(c, 저장소(기본기록(c))).count, 2);
  assert.equal(distinctTurnsOf(c, 저장소({})).count, 0);
  const 한턴 = 저장소({ ...기본기록(c), 'ledger:s:1': 관찰기록('7'), 'ledger:s:2': 관찰기록('7') });
  assert.equal(상태(세포({ authority: { requiresUserConfirmation: false } }), 완전묶음(c, { evidenceStore: 한턴 })), 'M1_candidate');
});

test('감사 P1-2: 상태는 한 계단씩, 종착 상태는 자동 부활하지 않는다', () => {
  const m1 = 세포({ state: 'M1_candidate', effect: { eligibleCount: 100, successCount: 100 }, authority: { requiresUserConfirmation: false } });
  assert.equal(상태(m1, 완전묶음(m1)), 'M2_replayed');
  for (const 종착 of ['rolled_back', 'quarantined']) {
    const c = 세포({ state: 종착, effect: { eligibleCount: 100, successCount: 100 }, authority: { requiresUserConfirmation: false } });
    const out = transitionCell(c, 완전묶음(c));
    assert.equal(out.cell.state, 종착, `${종착} 이 부활했다`);
    assert.deepEqual(out.cell.authority.allowedInfluence, ['none']);
  }
});

test('감사 P1-3: trace 는 실제 근거로 확인한다', () => {
  const c = 세포({ trace: { observationRefs: ['없는참조1', '없는참조2'], corrections: [] } });
  assert.equal(structuralReplay(c, null).insufficient, true);
  assert.equal(structuralReplay(c, 저장소(기본기록(c))).passed, false);
  const 정상 = 세포();
  assert.equal(structuralReplay(정상, 저장소(기본기록(정상))).passed, true);
});

test('감사 P2: 성공·effect·replay 상태가 한 통로에서 나오고, z 오염은 NaN 이 아니다', () => {
  assert.equal(isSuccessfulOutcome({ improvementObserved: true }), false);
  assert.equal(isSuccessfulOutcome({ predictedImprovement: true, improvementObserved: true }), true);
  const e = foldOutcomes([
    { predictedImprovement: true, improvementObserved: true },
    { predictedImprovement: true, improvementObserved: false, failureKind: 'x' },
    { predictedImprovement: true, improvementObserved: false, failureKind: 'x' },
    { authorityViolated: true },
  ]);
  assert.equal(e.eligibleCount, 4); assert.equal(e.successCount, 1);
  assert.equal(e.sameFailureRecurrenceCount, 1); assert.equal(e.authorityViolationCount, 1);
  for (const z of [0, -1, NaN, 'x', null]) assert.equal(wilsonLowerBound(5, 10, z), 0);
  const c = 세포({ authority: { requiresUserConfirmation: false } });
  const out = transitionCell(c, 완전묶음(c), [{ predictedImprovement: true, improvementObserved: true }]);
  assert.equal(out.cell.effect.eligibleCount, 1);
  assert.equal(out.cell.replay.lastRunAt, 100);
});

test('감사 P2: 마찰 지표 전체를 본다 — 클릭·불필요 확인·개입·잘못된 도구 선택 포함', () => {
  for (const m of ['clicks', 'unnecessaryConfirmations', 'userInterventions', 'wrongToolChoices']) {
    assert.ok(FRICTION_METRICS.includes(m));
    assert.equal(counterfactualReplay(측정({ [m]: 1 }), 측정({ [m]: 3, activeTargetAccuracy: 0.99 })).passed, false, `${m} 증가가 통과했다`);
  }
});

test('명세 검사: positive 만·negative 붕괴·authority 실패·점수 과신 — 전부 승격 실패', () => {
  const c = 세포();
  assert.equal(runReplaySuite(c, 완전묶음(c, { cases: [사례('positive', 'p1')], executionRefs: ['exec:p1'] })).overallPassed, false);
  assert.deepEqual(minimumSuiteGaps(c, [사례('positive', 'p1')]).sort(), ['boundary', 'negative']);
  const n = makeReplayCase({ id: 'n1', kind: 'negative', sourceRefs: ['ledger:s:1'], expected: { mustHold: [], mustNotHappen: ['붕괴'] } });
  const 붕괴기록 = 저장소(기본기록(c, { 'exec:n1': 실행기록(c, 'n1', { happened: ['붕괴'] }) }));
  const 붕괴 = runReplaySuite(c, 완전묶음(c, { cases: [사례('positive', 'p1'), n, 사례('boundary', 'b1')], evidenceStore: 붕괴기록 }));
  assert.equal(붕괴.negativePassed, false);
  // authority 실패 → 격리(표본 100/100 이어도)
  const 행동 = 세포({ principle: { statement: '보낼 때 대상 확정 후 보낸다', type: 'execution' },
    effect: { eligibleCount: 100, successCount: 100 }, authority: { requiresUserConfirmation: false } });
  const auth = makeReplayCase({ id: 'a1', kind: 'boundary', sourceRefs: ['ledger:s:1'],
    expected: { mustHold: [], mustNotHappen: ['승인 없이 전송'], expectedActionKind: 'send' } });
  const 기록 = 저장소(기본기록(행동, { 'exec:a1': 실행기록(행동, 'a1', { happened: ['승인 없이 전송'] }, { facts: { held: [], happened: ['승인 없이 전송'], actionKind: 'send' } }) }));
  assert.equal(상태(행동, 완전묶음(행동, { cases: [...기본사례(), auth], executionRefs: [...기본참조(), 'exec:a1'], evidenceStore: 기록 })), 'quarantined');
  const 확인필요 = 세포({ effect: { eligibleCount: 200, successCount: 200 }, authority: { requiresUserConfirmation: true } });
  assert.equal(transitionCell(확인필요, 완전묶음(확인필요)).cell.authority.requiresUserConfirmation, true);
});

test('명세 검사: replay 통과한 A0/A1 원리는 계단을 밟아 제한 범위 입장에 이른다', () => {
  let c = 세포({ authority: { requiresUserConfirmation: false } });
  c = transitionCell(c, 완전묶음(c)).cell;
  assert.equal(c.state, 'M2_replayed');
  c.effect = { ...c.effect, eligibleCount: 6, successCount: 6 };
  c = transitionCell(c, 완전묶음(c)).cell;
  assert.equal(c.state, 'M3_limited');
  assert.ok(c.authority.allowedInfluence.includes('plan_hint') && c.authority.allowedInfluence.includes('default_value'));
  assert.ok(!c.authority.allowedInfluence.includes('answer_anchor'));
  c.effect = { ...c.effect, eligibleCount: 20, successCount: 20, userCorrectionCount: 0 };
  assert.equal(transitionCell(c, 완전묶음(c)).cell.state, 'M3_limited');
  const m4 = transitionCell(c, 완전묶음(c, { transferRef: 'transfer:1' })).cell;
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
});

test('구조 경계: replay 엔진은 실행 수단을 받지도 부르지도 않는다(§9.3)', async () => {
  const src = (await readFile('src/kernel/l5-growth/tcell-replay-engine.js', 'utf8'))
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'execution'/g, "'<원리종류>'").replace(/'replay_execution'/g, "'<기록종류>'");
  const 금지패턴 = [
    /\bchild_process\b/, /\brequire\s*\(/, /\bimport\s*\(/, /\bfetch\s*\(/,
    /\bexecSync\b/, /\.exec\s*\(/, /\bspawn\w*\s*\(/, /\bwriteFile\b/, /\bappendFile\b/,
    /\breadFile\b/, /\.handler\s*\(/, /\bctx\.tools\b/, /\btools\s*[.[]/, /\bprocess\.\w/,
  ];
  for (const 금지 of 금지패턴) assert.ok(!금지.test(src), `실행 수단(${금지})에 닿는다`);
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./tcell-core.js', './tcell-replay.js']);
});
