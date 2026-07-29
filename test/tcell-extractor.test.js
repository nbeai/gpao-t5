// TG-3 반대시험(명세 §16): 번들 밖 사실 격리 · insufficient=정상 · 한 사례 전역화 차단 · 모델 실패 무해.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceBundle, extractCandidate, wakeSignal, groupObservations, groupKeyOf, statementAffinity, relateToExisting } from '../src/runtime/tcell-extractor.js';

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

test('wake 신호는 판단이 아니라 힌트다 — 정정·실패·기존 정규식 경로가 모두 입력이다', async () => {
  assert.equal(wakeSignal([관찰(1)]).wake, false);
  assert.equal(wakeSignal([관찰(1, { type: 'user_correction' })]).wake, true);
  assert.equal(wakeSignal([관찰(1, { signal: { summary: 'x', valence: 'failure' } }), 관찰(2, { signal: { summary: 'y', valence: 'failure' } })]).wake, true);
  // 기존 detectCandidate(정규식) 결과가 판단이 아니라 wake 입력 하나로 축소된다.
  const { detectCandidate } = await import('../src/kernel/l1-intent/context-mesh.js');
  const hit = detectCandidate('앞으로 보고서는 목록으로 줘');
  const w = wakeSignal([관찰(1)], { regexHit: hit });
  assert.equal(w.정규식, Boolean(hit));
  assert.equal(w.wake, Boolean(hit), '정규식 신호가 wake 에 연결되지 않았다');
});

// ── TG-3 독립 감사 반영 반대시험 ──
test('감사 P1: 비밀·schema 손상 관찰은 modelReadable 이 true 여도 번들에 들어가지 않는다', () => {
  const 비밀 = 관찰(9, { privacy: { modelReadable: true, containsSecret: true } });
  const 손상 = 관찰(8, { signal: { summary: 'x', valence: '이상한값' } });
  const 손상2 = 관찰(7, { schemaVersion: 99 });
  const b = buildEvidenceBundle({ observations: [관찰(1), 비밀, 손상, 손상2] });
  assert.equal(b.observations.length, 1, `자격 없는 관찰이 모델 입력에 실렸다: ${b.observations.length}`);
  assert.equal(b.observations[0].id, 1);
  // 묶음 나누기에서도 같은 자격 검사를 쓴다.
  const g = groupObservations([관찰(1), 비밀, 손상]);
  assert.equal([...g.values()].flat().length, 1);
});

test('감사 P1: 잘못된 모델 출력(boundary.validWhen: 7 등)에도 추출기는 죽지 않는다', async () => {
  const bundle = buildEvidenceBundle({ observations: [관찰(1)] });
  const 이상한출력들 = [
    출력({ boundary: { validWhen: 7, invalidWhen: null, mustNotOverride: 3 } }),
    출력({ principle: 7 }),
    출력({ trace: { observationRefs: 'ref' } }),
    출력({ center: 42 }),
    JSON.stringify([1, 2, 3]),
    JSON.stringify({ decision: 'candidate' }),
  ];
  for (const o of 이상한출력들) {
    let r;
    await assert.doesNotReject(async () => { r = await extractCandidate({ model: { async respond() { return o; } }, bundle }); },
      `출력에 죽었다: ${o.slice(0, 40)}`);
    assert.ok(r.decision, '결과가 없다');
    if (r.candidate) assert.deepEqual(r.candidate.authority.allowedInfluence, ['none']);
  }
});

test('감사 P1: 타이머 누수 없음 — 즉답 6회가 즉시 끝난다', async () => {
  const bundle = buildEvidenceBundle({ observations: [관찰(1)] });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 6; i++) {
    await extractCandidate({ model: { async respond() { return 출력(); } }, bundle, timeoutMs: 20_000 });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 500, `즉답인데 ${ms}ms 걸렸다`);
  // 남은 타이머가 있으면 이 테스트 파일이 20초를 붙잡는다(게이트 벽시계로 드러났던 결함).
});

test('감사 P1: 번들 상한 12 · 프로젝트·주제·신호군별 묶음', () => {
  const many = Array.from({ length: 20 }, (_, i) => 관찰(i + 1));
  assert.equal(buildEvidenceBundle({ observations: many }).observations.length, 12);
  const g = groupObservations([
    관찰(1, { anchor: { workspace: null, project: 'A', surface: null, subject: '정산' } }),
    관찰(2, { anchor: { workspace: null, project: 'A', surface: null, subject: '정산' }, signal: { summary: 'x', valence: 'failure' } }),
    관찰(3, { anchor: { workspace: null, project: 'B', surface: null, subject: '정산' } }),
  ]);
  assert.equal(g.size, 3, `묶음이 나뉘지 않았다: ${[...g.keys()]}`);
  assert.ok(groupKeyOf(관찰(1, { anchor: { project: 'A', subject: '정산' } })).startsWith('A//정산//'));
});

test('감사 P1: 문자열이 달라도 같은 의미면 중복 — relation 으로 수렴한다', async () => {
  assert.ok(statementAffinity('실패한 손은 같은 인자로 반복하지 않는다', '실패한 손은 같은 인자로 반복하지 않습니다.') >= 0.8);
  const rel = relateToExisting('실패한 손은 같은 인자로 반복하지 않습니다', [{ id: 'c0', statement: '실패한 손은 같은 인자로 반복하지 않는다.' }]);
  assert.equal(rel.kind, 'same_center');
  const bundle = buildEvidenceBundle({ observations: [관찰(1)],
    existingCandidates: [{ id: 'c0', principle: { statement: '실패한 손은 같은 인자로 반복하지 않습니다.' } }] });
  const r = await extractCandidate({ model: { async respond() { return 출력(); } }, bundle });
  assert.equal(r.decision, 'duplicate', '의미 중복이 새 세포가 됐다');
  assert.equal(r.relation.kind, 'same_center');
});

test('감사 P1: 명시적 사용자 지시 범위는 재확인 후보로 강등되지 않는다', async () => {
  const bundle = buildEvidenceBundle({ observations: [관찰(1)], explicitInstruction: { scope: 'project:T5', text: '보고서는 목록으로' } });
  const r = await extractCandidate({ model: { async respond() { return 출력(); } }, bundle });
  assert.equal(r.candidate.authority.requiresUserConfirmation, false, '명시 지시가 재확인 후보로 강등됐다');
  // 추정(명시 지시 없음)은 그대로 확인 필요.
  const r2 = await extractCandidate({ model: { async respond() { return 출력(); } }, bundle: buildEvidenceBundle({ observations: [관찰(1)] }) });
  assert.equal(r2.candidate.authority.requiresUserConfirmation, true);
});
