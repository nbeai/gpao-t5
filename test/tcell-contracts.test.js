// TG-0 계약 봉인 반대시험 (명세 §16 TG-0 검사 3건 + 계약 단위 검사).
// 세 축(성숙도·영향·권한)은 절대 합치지 않는다 — confidence·승인·활성도가 권한을 만들지 못한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTCellCandidate, validateTCell, influenceCeilingFor,
  assertAuthorityInvariant, assertCompressionSafe, MATURITY_LEVELS,
} from '../src/kernel/l5-growth/tcell-core.js';
import {
  makeObservationEvent, observationFromCorrection, validateObservationEvent,
} from '../src/kernel/l0-evidence/tcell-observation.js';
import { makeReplayResult, validateReplayCase, makeReplayCase } from '../src/kernel/l5-growth/tcell-replay.js';
import { makeTSphere, validateTSphere } from '../src/kernel/l5-growth/t-sphere.js';

const 온전한후보 = (over = {}) => makeTCellCandidate({
  principle: { statement: '터미널 실패 후 같은 신호를 반복하지 않는다', type: 'recovery', hypothesisConfidence: 0.4 },
  boundary: { validWhen: ['터미널 실패 직후'], invalidWhen: ['사용자가 재시도를 명시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
  trace: { observationRefs: ['obs-1', 'obs-2'], corrections: [] },
  ...over,
});

// ── 명세 지정 반대시험 ① — 필수 trace 없는 후보는 quarantined ──
test('필수 trace 없는 후보는 quarantined 로 저장되고 영향 0 이다', () => {
  const 무근거 = 온전한후보({ trace: { observationRefs: [], corrections: [] } });
  const r = validateTCell(무근거);
  assert.equal(r.ok, false);
  assert.equal(r.cell.state, 'quarantined', '근거 없는 후보가 격리되지 않았다');
  assert.deepEqual(r.cell.authority.allowedInfluence, ['none'], '격리된 후보에 영향이 남았다');
});

// ── 명세 지정 반대시험 ② — confidence 1.0 이어도 authority 를 바꾸지 못함 ──
test('confidence 1.0 이어도 성숙도 상한 밖 영향·권한을 얻지 못한다', () => {
  const 과신 = 온전한후보();
  과신.principle.hypothesisConfidence = 1.0;
  과신.authority.allowedInfluence = ['answer_anchor']; // M1 후보가 답 앵커를 주장
  const errors = assertAuthorityInvariant(과신);
  assert.ok(errors.some((e) => e.includes('answer_anchor')), `confidence 가 권한이 됐다: ${errors}`);
  // 상한 표 자체가 confidence 를 모른다 — M1 은 언제나 같은 상한.
  assert.deepEqual(influenceCeilingFor('M1_candidate'), ['none', 'candidate_context']);
  const r = validateTCell(과신);
  assert.equal(r.cell.state, 'quarantined');
});

// ── 명세 지정 반대시험 ③ — 한 correction 으로 radius project/global 생성 불가 ──
test('한 번의 정정으로 project/global 반경 원리가 생기지 않는다', () => {
  const 한번 = 온전한후보({
    trace: { observationRefs: ['obs-1'], corrections: [{ ref: 'corr-1' }] },
    geometry: { radius: 'global', depth: 0, sphereStability: 0 },
  });
  const r = validateTCell(한번);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('반경')), `단일 사례 전역화가 통과됐다: ${r.errors}`);
  assert.equal(radiusCeilingFor({ trace: { observationRefs: ['obs-1'] }, replay: { status: 'untested' } }), 'task');
});

// ── 계약 단위 검사 ──
test('온전한 후보는 통과하고, 현재 요청 우선 계약은 끌 수 없다', () => {
  const ok = validateTCell(온전한후보());
  assert.equal(ok.ok, true, `온전한 후보가 거절됐다: ${ok.errors}`);
  const 변조 = 온전한후보();
  변조.authority.mustNotOverrideCurrentRequest = false;
  assert.ok(assertAuthorityInvariant(변조).some((e) => e.includes('현재 요청')));
  // makeTCellCandidate 는 입력이 꺼도 다시 켠다.
  assert.equal(makeTCellCandidate({ authority: { mustNotOverrideCurrentRequest: false } })
    .authority.mustNotOverrideCurrentRequest, true);
});

test('관찰: 비밀 포함이면 모델이 읽을 수 없고, 요약은 원문 저장 수준으로 길 수 없다', () => {
  const ev = makeObservationEvent({ type: 'tool_result', signal: { summary: 'ok', valence: 'success' }, privacy: { containsSecret: true, modelReadable: true } });
  assert.equal(ev.privacy.modelReadable, false, '비밀 관찰이 모델에 열렸다');
  const 정정 = observationFromCorrection('가'.repeat(2000), {});
  assert.ok(정정.signal.summary.length <= 300, '정정 원문이 통째로 저장됐다');
  assert.equal(validateObservationEvent(정정).ok, true);
  assert.equal(validateObservationEvent({ ...ev, type: '해킹' }).ok, false);
});

test('replay: overallPassed 는 다섯 축 전원 통과이며, 근거 없는 replay 는 거절된다', () => {
  const 넷만 = makeReplayResult({ positivePassed: true, negativePassed: true, boundaryPassed: true, authorityPassed: true, tracePassed: false });
  assert.equal(넷만.overallPassed, false, '부분 통과가 통과가 됐다');
  assert.equal(makeReplayResult({ positivePassed: true, negativePassed: true, boundaryPassed: true, authorityPassed: true, tracePassed: true }).overallPassed, true);
  assert.equal(validateReplayCase(makeReplayCase({ kind: 'positive', sourceRefs: [], expected: { mustHold: ['x'] } })).ok, false);
});

test('압축(M5)은 원본 trace 를 잃으면 실패하고, T-Sphere 는 중심 없이 서지 못한다', () => {
  const 압축 = 온전한후보(); 압축.state = 'M5_compressed'; 압축.trace.derivedFrom = ['a'];
  assert.ok(assertCompressionSafe(압축, [{ id: 'a' }, { id: 'b' }]).some((e) => e.includes('b')));
  assert.equal(validateTSphere(makeTSphere({ centerPoint: '', memberIds: ['a'] })).ok, false);
  assert.equal(validateTSphere(makeTSphere({ centerPoint: '복구는 반복이 아니라 전환', memberIds: ['a'], stability: 0.3 })).ok, true);
  assert.equal(MATURITY_LEVELS.length, 9);
});

// ── TG-0 재감사 반영(2026-07-29) — 감사가 재현한 실패 입력 그대로 ──
import { radiusCeilingFor, assertRangesValid } from '../src/kernel/l5-growth/tcell-core.js';

test('감사 1: 임의 JSON(allowedInfluence: 7 등)에도 검증기는 던지지 않고 격리한다(total function)', () => {
  const 이상한것들 = [
    (() => { const c = 온전한후보(); c.authority.allowedInfluence = 7; return c; })(),
    (() => { const c = 온전한후보(); c.trace = '문자열'; return c; })(),
    (() => { const c = 온전한후보(); c.boundary = 42; return c; })(),
    null, 'JSON아님', 7, [], { 아무거나: true },
  ];
  for (const 입력 of 이상한것들) {
    let r;
    assert.doesNotThrow(() => { r = validateTCell(입력); }, `던졌다: ${JSON.stringify(입력)?.slice(0, 40)}`);
    assert.equal(r.ok, false);
    assert.equal(r.cell.state, 'quarantined');
    assert.deepEqual(r.cell.authority.allowedInfluence, ['none']);
  }
  assert.doesNotThrow(() => validateObservationEvent({ signal: 7, privacy: 'x', sourceRefs: 3 }));
  assert.doesNotThrow(() => validateTSphere({ relations: 5, memberIds: 'a' }));
  assert.doesNotThrow(() => validateReplayCase({ expected: 9, sourceRefs: 1 }));
});

test('감사 2: 범위 밖 수치·상태는 전부 거절된다(confidence 2 · 음수 횟수 · stability 9 · 가짜 replay 상태)', () => {
  const 오염 = 온전한후보();
  오염.principle.hypothesisConfidence = 2;
  오염.effect.failureCount = -3;
  오염.geometry.sphereStability = 9;
  오염.replay.status = '존재하지않는상태';
  const errors = assertRangesValid(오염);
  assert.ok(errors.some((e) => e.includes('confidence')), `confidence 2 통과: ${errors}`);
  assert.ok(errors.some((e) => e.includes('failureCount')));
  assert.ok(errors.some((e) => e.includes('sphereStability')));
  assert.ok(errors.some((e) => e.includes('replay 상태')));
  const r = validateTCell(오염);
  assert.equal(r.ok, false);
  assert.equal(r.cell.state, 'quarantined');
});

test('감사 3: M5 압축 trace 검사가 통합 검증에 연결됐다 — 원본 없는 압축본은 통과하지 못한다', () => {
  const 압축 = 온전한후보(); 압축.state = 'M5_compressed'; 압축.trace.derivedFrom = [];
  const r = validateTCell(압축);
  assert.equal(r.ok, false, '원본 없는 M5 가 통과했다');
  assert.ok(r.errors.some((e) => e.includes('derivedFrom')), `${r.errors}`);
  // 원본 목록을 주면 소실도 잡는다.
  const 소실 = 온전한후보(); 소실.state = 'M5_compressed'; 소실.trace.derivedFrom = ['a'];
  const r2 = validateTCell(소실, null, { sourceCells: [{ id: 'a' }, { id: 'b' }] });
  assert.ok(r2.errors.some((e) => e.includes('b')));
});

test('감사 4(재감사 2 강화): TG-0 반경 상한은 task 고정 — passed_transfer + M4 도 열지 못한다', () => {
  const 통계만 = 온전한후보({ trace: { observationRefs: ['1', '2', '3', '4', '5', '6'], corrections: [] } });
  assert.equal(radiusCeilingFor(통계만), 'task', '통계가 곧 권한이 됐다');
  통계만.geometry.radius = 'global';
  assert.equal(validateTCell(통계만).ok, false);
  // 재감사 2 재현 입력 그대로: 미확인 M4/global/answer_anchor → 격리.
  const 미확인 = 온전한후보({ trace: { observationRefs: ['1', '2', '3', '4', '5', '6'], corrections: [] } });
  미확인.state = 'M4_stable';
  미확인.replay.status = 'passed_transfer';
  미확인.geometry.radius = 'global';
  미확인.authority.allowedInfluence = ['answer_anchor'];
  const r = validateTCell(미확인);
  assert.equal(r.ok, false, 'requiresUserConfirmation 표시만으로 global 영향이 열렸다');
  assert.equal(r.cell.state, 'quarantined');
  assert.deepEqual(r.cell.authority.allowedInfluence, ['none']);
});

test('재감사 1: 존재하지 않는 derivedFrom + 원본 미제공 → 검증 불능은 통과가 아니라 격리다', () => {
  const 가짜 = 온전한후보(); 가짜.state = 'M5_compressed'; 가짜.trace.derivedFrom = ['does-not-exist'];
  const r = validateTCell(가짜); // sourceCells 미제공
  assert.equal(r.ok, false, '가짜 원본 trace 가 통과했다');
  assert.equal(r.cell.state, 'quarantined');
  // 원본을 주면 양방향 일치 검사: 목록에 없는 원본(소실)과 원본 없는 목록(가짜) 둘 다.
  const r2 = validateTCell(가짜, null, { sourceCells: [{ id: 'real-1' }] });
  assert.ok(r2.errors.some((e) => e.includes('does-not-exist')), `${r2.errors}`);
  assert.ok(r2.errors.some((e) => e.includes('real-1')));
});

test('재감사 3: 비문자 배열 원소는 전부 격리된다', () => {
  const 오염들 = [
    온전한후보({ trace: { observationRefs: [null, {}], corrections: [] } }),
    (() => { const c = 온전한후보(); c.boundary.validWhen = [7]; return c; })(),
    (() => { const c = 온전한후보(); c.replay.caseRefs = [42]; return c; })(),
    (() => { const c = 온전한후보(); c.authority.prohibitedActionKinds = ['']; return c; })(),
  ];
  for (const cell of 오염들) {
    const r = validateTCell(cell);
    assert.equal(r.ok, false, `비문자 원소가 통과했다: ${JSON.stringify(r.errors)}`);
    assert.equal(r.cell.state, 'quarantined');
  }
  assert.equal(validateObservationEvent(makeObservationEvent({ type: 'tool_result', sourceRefs: [1] })).ok, false);
  assert.equal(validateReplayCase(makeReplayCase({ kind: 'positive', sourceRefs: [{}], expected: { mustHold: ['x'] } })).ok, false);
  assert.equal(validateTSphere(makeTSphere({ centerPoint: '중심', memberIds: [3], stability: 0.1 })).ok, false);
});
