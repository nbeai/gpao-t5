import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runAgent } from '../src/agent-loop.js';
import { FileSourceManifestStore } from '../src/file-source-manifest-store.js';
import { makeFileRealityTool } from '../src/file-reality-tool.js';
import { makeIntegralMethodRuntime } from '../src/integral-method-runtime.js';
import { deferTools } from '../src/tool-search.js';

const args = (value) => ({ query: null, scope: null, path: null, handles: null,
  maxCandidates: null, placements: null, planId: null, effect: null, sourceUses: null,
  purpose: null, unknowns: null, standardization: null, ...value });

test('bind_sources가 연 optional Method는 Reality 1회 뒤 모델의 직접 최종 답으로 끝난다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-integral-flow-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const left = join(workspace, 'left-ledger.txt'); const right = join(workspace, 'right-ledger.txt');
  await writeFile(left, 'left 100000'); await writeFile(right, 'right 90000');
  try {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const manifests = new FileSourceManifestStore(join(root, 'manifests'));
    const integral = makeIntegralMethodRuntime({ sourceManifestStore: manifests, sessionId,
      currentWork: async () => ({ workId: 'work-11111111', revision: 1, status: 'active' }),
      sourceObserver: async (source, { handle }) => ({ handle, displayName: source.displayName,
        path: source.path, sha256: source.sha256, kind: 'xlsx', projection: [
          '[sheet:Ledger]', 'A1=Item', 'B1=Amount (KRW)', `A2=${source.displayName}`,
          `B2=${source.path === left ? 100000 : 90000}`,
        ].join('\n') }) });
    const reality = makeFileRealityTool({ workspace, home: root, platform: 'test',
      computerRoots: [root], sourceManifestStore: manifests, sessionId,
      indexSearch: async () => [left, right], onSourcesBound: (manifest) => integral.prepare({
        manifestId: manifest.manifestId,
      }) });
    const tools = deferTools([reality, integral.tool], { coreNames: ['file_reality'] });
    let turn = 0; let handles = null;
    const result = await runAgent({ request: '두 원장의 금액 차이만 알려줘', tools,
      model: { async respond({ tools: visible, messages }) {
        turn += 1;
        if (turn === 1) return { text: '', toolCalls: [{ id: 'search', name: 'file_reality',
          args: args({ action: 'search', query: 'ledger', scope: 'workspace', maxCandidates: 5 }) }] };
        if (turn === 2) {
          const observed = JSON.parse(messages.at(-1).content).result; handles = observed.candidates.map((item) => item.handle);
          return { text: '', toolCalls: [{ id: 'bind', name: 'file_reality', args: args({ action: 'bind_sources',
            sourceUses: handles.map((handle) => ({ handle, usage: '금액 대조', columnMappings: null })),
            purpose: '두 원장 금액 차이 확인', unknowns: [] }) }] };
        }
        if (turn === 3) {
          assert.ok(visible.some((tool) => tool.name === 'integral_method'));
          const packet = JSON.parse(messages.at(-1).content).result.integralMethod.sourcePacket;
          const manifestId = packet.match(/sourceManifest=.*"manifestId":"([^"]+)/u)[1];
          const firstAtom = visible.find((tool) => tool.name === 'integral_method').parameters.properties
            .claimEvidence.properties.claims.items.properties.evidenceAtomIds.items.enum[0];
          return { text: '', toolCalls: [{ id: 'method', name: 'integral_method', args: {
            contract: { schema: 't5.integral-outcome-method.v1', work: { workId: 'work-11111111', revision: 1 },
              human: { purpose: '차이 확인', useContext: '지급 전', audience: '담당자' },
              strategy: { primaryOutcome: '차이', requestedScope: ['금액 차이'], excludedScope: ['정상'],
                sufficientWhen: ['두 금액과 차이 확인'] },
              reality: { sourceManifestId: manifestId,
                exactInputHandles: ['source-00000001', 'source-00000002'], unresolvedFacts: [] },
              method: { operators: ['compare', 'calculate'], checks: ['전체 source'],
                expectedOutputs: [{ name: 'answer', kind: 'answer', effect: 'observe' }] },
              form: { deliverableForms: ['answer'], informationOrder: ['결론', '근거'],
                visualHierarchyGoals: ['차이 우선'] } },
            claimEvidence: { schema: 't5.atom-claim-evidence.v1', sourceManifestId: manifestId,
              coverage: { state: 'complete', observedHandles: ['source-00000001', 'source-00000002'], unresolvedHandles: [] },
              claims: [{ claimId: 'amount-gap', state: 'conflict', summary: '두 원장 금액이 10,000원 다르다.',
                sourceRefs: [{ handle: 'source-00000001', location: 'Ledger!A2:B2' },
                  { handle: 'source-00000002', location: 'Ledger!A2:B2' }],
                evidenceAtomIds: [firstAtom], calculations: [] }],
              excludedFindings: [] },
          } }] };
        }
        assert.equal(visible.some((tool) => tool.name === 'integral_method'), false);
        assert.match(JSON.parse(messages.at(-1).content).result.outcomes[0].summaries[0], /10,000원/u);
        return { text: '두 원장은 100,000원과 90,000원으로 10,000원 차이입니다.', toolCalls: [] };
      } } });
    assert.equal(result.answer, '두 원장은 100,000원과 90,000원으로 10,000원 차이입니다.');
    assert.equal(result.modelTurns, 4);
    assert.deepEqual(result.receipts.map((receipt) => receipt.actualCall?.name), [
      'file_reality', 'file_reality', 'integral_method',
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
