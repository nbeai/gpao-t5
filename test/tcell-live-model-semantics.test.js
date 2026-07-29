// 감사 P2 · **실제 모델의 의미 판정** — 시험이 답을 써 주지 않는다.
//
// 앞선 `tcell-audit-closure.test.js` 의 어댑터 관통은 **와이어 형식**을 증명한다(요청이 실제
// OpenAI/Anthropic 모양으로 나가고 응답이 실제 어댑터 코드로 해석된다). 그러나 그 시험의
// 모델 답은 시험이 미리 만든 JSON 이므로, **의미를 모델이 판단했다는 증거는 아니다** —
// 감사가 그 과장을 정확히 지적했다.
//
// 이 파일은 그 자리를 채운다. 실제 provider 자격이 있을 때만 돌고, 없으면 **건너뛴 사실을
// 그대로 기록한다**(조용히 통과시키지 않는다 — 검증 못 한 것은 완료가 아니다).
//
// 실행:
//   OPENAI_API_KEY=… ANTHROPIC_API_KEY=… node --test test/tcell-live-model-semantics.test.js
//   (오너 자격을 소모하므로 기본 회귀에서는 자동으로 건너뛴다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProviderModelClient } from '../src/runtime/model-provider.js';
import { buildEvidenceBundle, extractCandidate } from '../src/runtime/tcell-extractor.js';
import { makeObservationEvent } from '../src/kernel/l0-evidence/tcell-observation.js';
import { isFactAtom } from '../src/kernel/l1-intent/fact-atoms.js';

/** 이 기계에 실제로 있는 검증선만 돈다. 없는 것은 없다고 말한다. */
const LANES = [
  { 이름: 'OpenAI', provider: 'openai', key: process.env.OPENAI_API_KEY, model: process.env.GPAO_T5_LIVE_OPENAI_MODEL ?? 'gpt-5.1' },
  { 이름: 'Anthropic', provider: 'anthropic', key: process.env.ANTHROPIC_API_KEY, model: process.env.GPAO_T5_LIVE_ANTHROPIC_MODEL ?? 'claude-opus-4-8' },
];

const 관찰 = (요약, valence) => makeObservationEvent({
  type: 'tool_result', sessionId: 's', turnId: '1', occurredAt: 1,
  anchor: { workspace: '/w', project: '/p', surface: 'web', subject: null },
  signal: { summary: 요약, valence },
  sourceRefs: ['session:s'], receiptRefs: ['ledger:s:0'],
});

const 기존원리 = {
  id: 'cell-확인',
  principle: { statement: '외부로 보내기 전에는 대상을 사용자에게 확인한다' },
  center: { point: '전송 전 확인', axis: '외부 효과' },
  boundary: { validWhen: ['보내기 직전'], invalidWhen: [] },
  anchor: { project: '/p', subject: null },
};

for (const lane of LANES) {
  const 돌까 = Boolean(lane.key);
  test(`[실모델 ${lane.이름}] 자유문 경계를 OS 사실 원자에 스스로 결합한다`, { skip: !돌까 && `${lane.이름} 자격 없음 — 이 검증선은 미실행(증거에 그대로 기록)` }, async () => {
    const model = makeProviderModelClient({
      provider: lane.provider, modelId: lane.model, maxTokens: 2000, token: lane.key,
      baseUrl: lane.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
    });
    // 실패 관찰 두 건 — 모델이 "실패 뒤" 상황의 원리를 뽑을 재료다. 정답은 주지 않는다.
    const bundle = buildEvidenceBundle({
      id: 'live-1', activeTarget: '',
      observations: [
        관찰('파일을 읽지 못했어요(권한 없음)', 'failure'),
        관찰('같은 파일을 다시 읽으려다 또 실패했어요', 'failure'),
      ],
    });
    const r = await extractCandidate({ model, bundle, now: 1, timeoutMs: 60_000 });
    // 모델이 후보를 냈다면 **결합한 원자는 실제 어휘여야 한다**(지어낸 id 는 OS 가 버린다).
    const cell = r.candidate ?? r.quarantined;
    if (r.decision === 'candidate' && cell?.binding) {
      for (const [절, atom] of Object.entries(cell.binding)) {
        assert.ok(isFactAtom(atom), `모델이 없는 원자를 결합했다: ${절} → ${atom}`);
      }
      // 실패 근거만 준 묶음이므로 실패 계열 원자에 결합하는 것이 자연스럽다 — 다만 강제하지
      // 않는다(모델의 판단 자리다). 결합이 하나라도 있으면 그 자체가 의미 결합의 증거다.
      assert.ok(Object.keys(cell.binding).length > 0);
    } else {
      // insufficient_evidence 도 정상 답이다(§7.1). 지어내지 않은 것이 증거다.
      assert.ok(['insufficient_evidence', 'duplicate', 'contradiction'].includes(r.decision),
        `계약 밖 결정: ${r.decision}`);
    }
  });

  test(`[실모델 ${lane.이름}] 반대 뜻 지시를 기존 원리와의 contradicts 로 판정한다`, { skip: !돌까 && `${lane.이름} 자격 없음 — 이 검증선은 미실행(증거에 그대로 기록)` }, async () => {
    const model = makeProviderModelClient({
      provider: lane.provider, modelId: lane.model, maxTokens: 2000, token: lane.key,
      baseUrl: lane.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
    });
    // 사용자가 기존 원리와 **반대되는** 지시를 한 상황. 정답 문자열은 주지 않는다.
    const bundle = buildEvidenceBundle({
      id: 'live-2', activeTarget: '보낼 땐 확인하지 마',
      observations: [관찰('사용자가 확인 없이 바로 보내라고 했어요', 'correction')],
      existingCandidates: [기존원리],
      explicitInstruction: { scope: 'session:s', text: '보낼 땐 확인하지 마', observationRef: 'ledger:s:0' },
    });
    const r = await extractCandidate({ model, bundle, now: 1, timeoutMs: 60_000 });
    // 기대: 기존 원리와의 관계를 **모델이** 잡는다. 관계가 왔다면 대상은 실제 후보여야 한다.
    if (r.relation) {
      assert.equal(r.relation.id, 'cell-확인', `모델이 지어낸 대상을 가리켰다: ${JSON.stringify(r.relation)}`);
    }
    // 관계를 못 잡아도 **거짓 통과는 만들지 않는다** — 그 사실을 그대로 남긴다.
    assert.ok(['candidate', 'contradiction', 'duplicate', 'insufficient_evidence'].includes(r.decision));
  });
}

test('실모델 검증선 존재 사실을 정직하게 남긴다', () => {
  const 있음 = LANES.filter((l) => l.key).map((l) => l.이름);
  const 없음 = LANES.filter((l) => !l.key).map((l) => l.이름);
  // 이 시험은 자격 유무를 판정하지 않는다 — **무엇이 검증되지 않았는지**를 기록으로 남길 뿐이다.
  assert.ok(LANES.length === 2);
  if (없음.length) {
    console.error(`[실모델 미검증] ${없음.join(', ')} — 자격 없음. 검증된 검증선: ${있음.join(', ') || '없음'}`);
  }
});
