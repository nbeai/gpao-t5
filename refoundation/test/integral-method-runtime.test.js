import assert from 'node:assert/strict';
import test from 'node:test';

import { makeIntegralMethodRuntime } from '../src/integral-method-runtime.js';

const manifestId = 'sources-11111111'; const sessionId = 'session-11111111';
function store(sourceCount = 2) {
  const sources = Array.from({ length: sourceCount }, (_, index) => ({
    path: `/synthetic/source-${index + 1}.xlsx`, displayName: `source-${index + 1}.xlsx`,
    sha256: String(index + 1).repeat(64),
  }));
  return { async verify() { return { state: 'verified', manifestId }; },
    async read() { return { manifestId, sessionId, sources }; } };
}
const sourceObserver = async (source, { handle }) => ({ handle, displayName: source.displayName,
  path: source.path, sha256: source.sha256, kind: 'xlsx', projection: [
    '[sheet:Ledger]', 'A1=Item', 'B1=Amount (KRW)', `A2=X-${handle.at(-1)}`,
    `B2=${handle.endsWith('1') ? 100000 : 90000}`,
  ].join('\n') });

function contract() {
  return { schema: 't5.integral-outcome-method.v1', work: { workId: 'work-11111111', revision: 1 },
    human: { purpose: '차이 확인', useContext: '지급 전 검토', audience: '담당자' },
    strategy: { primaryOutcome: '차이만 전달', requestedScope: ['금액 차이'],
      excludedScope: ['정상 항목'], sufficientWhen: ['두 자료의 차이와 근거 확인'] },
    reality: { sourceManifestId: manifestId,
      exactInputHandles: ['source-00000001', 'source-00000002'], unresolvedFacts: [] },
    method: { operators: ['compare', 'calculate'], checks: ['exact source coverage'],
      expectedOutputs: [{ name: 'answer', kind: 'answer', effect: 'observe' }] },
    form: { deliverableForms: ['answer'], informationOrder: ['결론', '근거'],
      visualHierarchyGoals: ['차이 우선'] } };
}

test('다중 exact manifest만 deferred Integral Method를 준비하고 동적 atom schema를 연다', async () => {
  const runtime = makeIntegralMethodRuntime({ sourceManifestStore: store(), sessionId,
    currentWork: async () => ({ workId: 'work-11111111', revision: 1, status: 'active' }), sourceObserver });
  const ready = await runtime.prepare({ manifestId });
  assert.equal(ready.state, 'ready'); assert.deepEqual(ready.activatedTools, ['integral_method']);
  assert.equal(ready.integralMethod.sourceCount, 2);
  assert.doesNotMatch(ready.integralMethod.sourcePacket, /\/synthetic\//u);
  const atomIds = runtime.tool.parameters.properties.claimEvidence.properties.claims.items
    .properties.evidenceAtomIds.items.enum;
  assert.match(atomIds[0], /^atom-\d{4}$/u);
  assert.equal(new Set(atomIds).size, atomIds.length);
});

test('Integral Method는 source를 전후 재검증하고 내부 handle 없는 human outcomes만 모델에 돌려준다', async () => {
  const runtime = makeIntegralMethodRuntime({ sourceManifestStore: store(), sessionId,
    currentWork: async () => ({ workId: 'work-11111111', revision: 1, status: 'active' }), sourceObserver });
  await runtime.prepare({ manifestId });
  const atomIds = runtime.tool.parameters.properties.claimEvidence.properties.claims.items
    .properties.evidenceAtomIds.items.enum;
  const result = await runtime.tool.execute({ contract: contract(), claimEvidence: {
    schema: 't5.atom-claim-evidence.v1', sourceManifestId: manifestId,
    coverage: { state: 'complete', observedHandles: ['source-00000001', 'source-00000002'], unresolvedHandles: [] },
    claims: [{ claimId: 'amount-gap', state: 'conflict', summary: '두 자료의 금액이 다르다.',
      sourceRefs: [{ handle: 'source-00000001', location: 'Ledger!A2:B2' },
        { handle: 'source-00000002', location: 'Ledger!A2:B2' }],
      evidenceAtomIds: [atomIds[0]], calculations: [] }], excludedFindings: [],
  } });
  assert.equal(result.state, 'verified'); assert.equal(result.outcomeCount, 1);
  const projection = runtime.tool.projectResultForModel(result);
  assert.equal(projection.state, 'verified'); assert.equal(projection.outcomes.length, 1);
  assert.match(JSON.stringify(projection), /source-1\.xlsx|source-2\.xlsx/u);
  assert.doesNotMatch(JSON.stringify(projection), /source-000000|atom-\d|\/synthetic\//u);
  assert.match(projection.next, /final user answer directly/u);
});

test('단일 source와 active Work 부재는 제품 Method를 활성화하지 않는다', async () => {
  const single = makeIntegralMethodRuntime({ sourceManifestStore: store(1), sessionId,
    currentWork: async () => ({ workId: 'work-11111111', revision: 1, status: 'active' }), sourceObserver });
  assert.deepEqual(await single.prepare({ manifestId }), { state: 'not_activated', reason: 'single_source_path' });
  const inactive = makeIntegralMethodRuntime({ sourceManifestStore: store(), sessionId,
    currentWork: async () => null, sourceObserver });
  assert.deepEqual(await inactive.prepare({ manifestId }), {
    state: 'not_activated', reason: 'active_work_revision_absent',
  });
});
