import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runAgent } from '../src/agent-loop.js';
import { prepareModelSelectedBatchObservation } from './helpers/nx-model-selected-batch-observation.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 't5-nx2-selected-')); const workspace = join(root, 'workspace');
  await mkdir(workspace); await writeFile(join(workspace, '매출기록.csv'), 'month,revenue\n8,90\n');
  await writeFile(join(workspace, '미수금현황.csv'), 'customer,amount\n한빛,120\n');
  return { root, workspace };
}

test('모델이 고른 candidate set만 한 호출에서 exact reopen하고 path를 모델에 내지 않는다', async () => {
  const app = await fixture();
  try {
    const batch = await prepareModelSelectedBatchObservation({ workspace: app.workspace });
    assert.equal(batch.state, 'ready'); assert.equal(batch.candidates.length, 2);
    assert.doesNotMatch(batch.context, new RegExp(app.root.replaceAll('\\', '\\\\'), 'u'));
    const selected = batch.candidates.find((item) => item.displayIdentity === '미수금현황.csv').candidateRef;
    const result = await batch.tool.execute({ selectedCandidateRefs: [selected], purpose: '미수금 확인' });
    assert.equal(result.selectedCount, 1);
    assert.deepEqual(result.observations.map((item) => item.displayIdentity), ['미수금현황.csv']);
    assert.match(result.observations[0].content, /한빛,120/u);
    assert.doesNotMatch(JSON.stringify(batch.tool.projectResultForModel(result)), new RegExp(app.root.replaceAll('\\', '\\\\'), 'u'));
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('stale·symlink·hardlink와 candidate 상한 밖 reality는 observation으로 승격하지 않는다', async () => {
  const app = await fixture();
  try {
    const batch = await prepareModelSelectedBatchObservation({ workspace: app.workspace });
    const selected = batch.candidates[0].candidateRef;
    await writeFile(join(app.workspace, batch.candidates[0].displayIdentity), 'changed');
    await assert.rejects(batch.tool.execute({ selectedCandidateRefs: [selected], purpose: '확인' }), /changed/u);
    await symlink(join(app.root, 'outside'), join(app.workspace, 'link.csv'));
    await link(join(app.workspace, '미수금현황.csv'), join(app.workspace, 'hardlink.csv'));
    const afterLink = await prepareModelSelectedBatchObservation({ workspace: app.workspace });
    assert.equal(afterLink.candidates.some((item) => item.displayIdentity === 'link.csv'), false);
    assert.equal(afterLink.candidates.some((item) => item.displayIdentity === 'hardlink.csv'), false);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('같은 model turn의 선택과 batch 관측 뒤 최종 답으로 끝나며 Direct는 Tool 0이다', async () => {
  const app = await fixture();
  try {
    const batch = await prepareModelSelectedBatchObservation({ workspace: app.workspace });
    const receivable = batch.candidates.find((item) => item.displayIdentity === '미수금현황.csv').candidateRef;
    let turn = 0;
    const result = await runAgent({ request: `받을 돈 확인\n\n${batch.context}`, tools: [batch.tool],
      model: { async respond({ messages }) {
        turn += 1;
        if (turn === 1) return { text: '', toolCalls: [{ id: 'observe', name: 'bounded_reality',
          args: { selectedCandidateRefs: [receivable], purpose: '받을 돈 확인' } }] };
        assert.match(messages.at(-1).content, /한빛,120/u);
        return { text: '한빛 미수금은 120입니다.', toolCalls: [] };
      } } });
    assert.equal(result.modelTurns, 2); assert.equal(result.receipts.length, 1);
    assert.equal(result.answer, '한빛 미수금은 120입니다.');

    const direct = await runAgent({ request: `매출이 뭔지 설명해줘\n\n${batch.context}`, tools: [batch.tool],
      model: { async respond() { return { text: '매출은 판매로 얻은 총수입입니다.', toolCalls: [] }; } } });
    assert.equal(direct.modelTurns, 1); assert.equal(direct.receipts.length, 0);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});
