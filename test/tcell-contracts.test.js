// TG-0 계약 봉인 반대시험 (명세 §16 TG-0 검사 3건 + 계약 단위 검사).
// 세 축(성숙도·영향·권한)은 절대 합치지 않는다 — confidence·승인·활성도가 권한을 만들지 못한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTCellCandidate, validateTCell, influenceCeilingFor, radiusCeilingForEvidence,
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
  assert.equal(radiusCeilingForEvidence({ observationRefs: ['obs-1'] }), 'task');
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
