// TG-3 반대시험(명세 §16): 번들 밖 사실 격리 · insufficient=정상 · 한 사례 전역화 차단 · 모델 실패 무해.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceBundle, extractCandidate, wakeSignal } from '../src/runtime/tcell-extractor.js';

const 관찰 = (id, over = {}) => ({ id, type: 'tool_result', sessionId: 's', turnId: null, taskId: null, occurredAt: 1,
  anchor: { workspace: null, project: null, surface: null, subject: null },
  signal: { summary: '봤어요', valence: 'success' }, sourceRefs: ['session:s'], receiptRefs: [`ledger:s:${id}`],
  privacy: { modelReadable: true, containsSecret: false }, schemaVersion: 1, ...over });

const 출력 = (over = {}) => JSON.stringify({
  decision: 'candidate',
  principle: { statement: '실패한 손은 같은 인자로 반복하지 않는다', type: 'recovery' },
  center: { point: '복구', axis: '전환', horizontalSignals: [] },
  boundary: { validWhen: ['실패 직후'], invalidWhen: ['사용자가 재시도 지시'], needsReviewWhen: [], mustNotOverride: ['current_user_request'] },
  trace: { observationRefs: ['ledger:s:1'] },
  counterexamples: [], suggestedRadius: 'task', ...over });

test('비밀 관찰은 번들에 실리지 않고, 정상 후보는 검증을 지나 M1 로 나온다', async () => {
  const bundle = buildEvidenceBundle({ observations: [관찰(1), 관찰(2, { privacy: { modelReadable: false, containsSecret: true } })] });
  assert.equal(bundle.observations.length, 1, '비가독 관찰이 모델 입력에 실렸다');
  const r = await extractCandidate({ model: { async respond() { return 출력(); } }, bundle });
  assert.equal(r.decision, 'candidate');
  assert.equal(r.candidate.state, 'M1_candidate');
  assert.deepEqual(r.candidate.authority.allowedInfluence, ['none']);
});

test('번들 밖 사실을 낸 후보는 격리된다(영향 0)', async () => {
  const bundle = buildEvidenceBundle({ observations: [관찰(1)] });
  const r = await extractCandidate({ model: { async respond() { return 출력({ trace: { observationRefs: ['ledger:s:1', '지어낸참조'] } }); } }, bundle });
  assert.equal(r.quarantined?.state, 'quarantined', '번들 밖 참조가 통과했다');
  assert.deepEqual(r.quarantined.authority.allowedInfluence, ['none']);
});

test('insufficient_evidence 는 정상 결과 · 중복 문장은 새 후보를 만들지 않는다', async () => {
  assert.equal((await extractCandidate({ model: {}, bundle: buildEvidenceBundle({}) })).decision, 'insufficient_evidence');
  const bundle = buildEvidenceBundle({ observations: [관찰(1)],
    existingCandidates: [{ id: 'c0', principle: { statement: '실패한 손은 같은 인자로 반복하지 않는다' } }] });
  assert.equal((await extractCandidate({ model: { async respond() { return 출력(); } }, bundle })).decision, 'duplicate');
});

test('한 사례 전역화 차단: suggestedRadius global 은 task 로 강등된다', async () => {
  const bundle = buildEvidenceBundle({ observations: [관찰(1)] });
  const r = await extractCandidate({ model: { async respond() { return 출력({ suggestedRadius: 'global' }); } }, bundle });
  assert.equal(r.decision, 'candidate');
  assert.equal((r.candidate ?? r.quarantined).geometry.radius, 'task', '한 사례가 전역화됐다');
});

test('모델 실패·시간초과·비JSON 은 던지지 않고 빈 결과 — 기본 대화를 막지 않는다', async () => {
  const bundle = buildEvidenceBundle({ observations: [관찰(1)] });
  for (const model of [
    { async respond() { throw new Error('죽음'); } },
    { async respond() { return 'JSON 아님'; } },
    { async respond() { return new Promise(() => {}); } }, // 영원히 안 옴
  ]) {
    let r;
    await assert.doesNotReject(async () => { r = await extractCandidate({ model, bundle, timeoutMs: 50 }); });
    assert.equal(r.decision, 'insufficient_evidence');
  }
});

test('wake 신호는 판단이 아니라 힌트다 — 정정 1 또는 실패 2 에서만 깨운다', () => {
  assert.equal(wakeSignal([관찰(1)]).wake, false);
  assert.equal(wakeSignal([관찰(1, { type: 'user_correction' })]).wake, true);
  assert.equal(wakeSignal([관찰(1, { signal: { summary: 'x', valence: 'failure' } }), 관찰(2, { signal: { summary: 'y', valence: 'failure' } })]).wake, true);
});
