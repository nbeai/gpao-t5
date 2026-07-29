// TG-3 생산 관통(감사 2026-07-29): **실제 모델 어댑터가 EvidenceBundle 을 받는가.**
// 예전엔 추출 호출이 일반 조립을 타서 실제 모델에게 user:"" 가 갔다(번들 0건). 가짜 HTTP 로
// OpenAI·Claude 스펙 양쪽 와이어를 열어 번들 내용이 실제 요청 본문에 실리는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMessages, buildExtractionMessages, makeProviderModelClient, resolveModelConfigFromInput } from '../src/runtime/model-provider.js';
import { buildEvidenceBundle, extractCandidate } from '../src/runtime/tcell-extractor.js';

const 관찰 = (id) => ({ id: `o${id}`, type: 'tool_result', sessionId: 's', turnId: null, taskId: null, occurredAt: 1,
  anchor: { workspace: null, project: 'T5', surface: null, subject: '정산' },
  signal: { summary: `실행 사실 ${id}`, valence: 'failure' }, sourceRefs: ['session:s'], receiptRefs: [`ledger:s:${id}`],
  privacy: { modelReadable: true, containsSecret: false }, schemaVersion: 1 });

const 번들 = () => buildEvidenceBundle({
  activeTarget: '정산 파일 다시 봐줘', observations: [관찰(1), 관찰(2)],
  existingCandidates: [{ id: 'c0', principle: { statement: '기존 원리' }, center: { point: '복구', axis: '전환' },
    boundary: { validWhen: ['실패 직후'], invalidWhen: ['재시도 지시'] }, anchor: { project: 'T5', subject: '정산' } }],
});

test('추출 호출은 일반 조립이 아니라 전용 경계를 탄다 — 사용자 메시지가 비지 않는다', () => {
  const b = 번들();
  const m = buildModelMessages({ tcellExtract: b });
  assert.ok(m.user.length > 0, '추출 메시지의 사용자 내용이 비었다(감사 재현: user:"")');
  assert.ok(m.user.includes('ledger:s:1') && m.user.includes('ledger:s:2'), '관찰 참조가 실리지 않았다');
  assert.ok(m.user.includes('실행 사실 1'), '관찰 요약이 실리지 않았다');
  assert.ok(m.user.includes('c0') && m.user.includes('복구'), '기존 후보의 중심이 실리지 않았다');
  assert.ok(m.user.includes('실패 직후'), '기존 후보의 경계가 실리지 않았다');
  assert.ok(m.system.includes('insufficient_evidence'), '구조화 출력 계약이 없다');
  assert.deepEqual(m.history, [], '추출에 대화 이력이 섞였다');
  // 일반 턴 조립은 그대로다(회귀 없음).
  const 일반 = buildModelMessages({ currentRequest: '안녕', identity: { name: 'T5' } });
  assert.ok(일반.user.includes('안녕'));
});

for (const [provider, modelId] of [['openai', 'gpt-5.1'], ['anthropic', 'claude-fable-5']]) {
  test(`${provider} 어댑터 와이어: 번들이 실제 요청 본문에 실려 나간다`, async () => {
    let 보낸본문 = null;
    const fetchImpl = async (_url, opts) => {
      보낸본문 = JSON.parse(opts.body);
      const json = provider === 'anthropic'
        ? { content: [{ type: 'text', text: JSON.stringify({ decision: 'insufficient_evidence' }) }] }
        : { choices: [{ message: { content: JSON.stringify({ decision: 'insufficient_evidence' }) } }] };
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
    };
    // 사용자 연결 경로가 만드는 실제 구성 그대로(기본 baseUrl 포함).
    const cfg = resolveModelConfigFromInput({ provider, key: 'test-key', modelId });
    assert.ok(cfg, `${provider} 구성 해석 실패`);
    const client = makeProviderModelClient(cfg, { fetchImpl });
    const b = 번들();
    const r = await extractCandidate({ model: client, bundle: b, timeoutMs: 5000 });
    assert.ok(보낸본문, '요청이 나가지 않았다');
    const 사용자 = JSON.stringify(보낸본문);
    assert.ok(사용자.includes('ledger:s:1'), `${provider} 와이어에 관찰 참조가 없다`);
    assert.ok(사용자.includes('실행 사실 1'), `${provider} 와이어에 관찰 요약이 없다`);
    assert.ok(사용자.includes('복구'), `${provider} 와이어에 기존 후보 중심이 없다`);
    assert.equal(r.decision, 'insufficient_evidence', '모델 응답 해석이 실패했다');
  });
}

test('전용 경계는 대본을 늘리지 않는다 — 지시문 예산 상한', async () => {
  const m = buildExtractionMessages(번들());
  // §0-C-2 로 **사실 어휘**(OS 상황 원자)가 지시문에 실리게 됐다. 어휘는 대본이 아니라 사실
  // 공급이므로 예산을 갈라 지킨다 — 지시문(어휘 제외)은 기존 상한 그대로, 어휘는 원자 수에
  // 비례한 상한(원자당 60자). 이렇게 두면 "지시문이 비대해진다"와 "어휘가 비대해진다"가
  // 서로를 가리지 않는다.
  const { FACT_ATOMS, atomVocabularyLines } = await import('../src/kernel/l1-intent/fact-atoms.js');
  const 어휘 = atomVocabularyLines().join('\n');
  assert.ok(m.system.includes(어휘), '사실 어휘가 지시문에 실리지 않았다(§0-C-2 미배선)');
  const 지시문만 = m.system.replace(어휘, '');
  assert.ok(지시문만.length < 1000, `추출 지시문(어휘 제외)이 비대해졌다: ${지시문만.length}자`);
  assert.ok(어휘.length <= Object.keys(FACT_ATOMS).length * 60,
    `사실 어휘가 원자당 60자를 넘었다: ${어휘.length}자 / ${Object.keys(FACT_ATOMS).length}원자`);
});
