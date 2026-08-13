import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

test('재읽은 파생 파일이 목적과 다르면 같은 턴에 수정하고 최신 실물을 다시 읽는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'derived-artifact-repair-'));
  const work = join(root, 'work'); const state = join(root, 'state');
  const input = join(work, 'input.csv'); const output = join(work, 'result.tsv');
  await mkdir(work, { recursive: true });
  await writeFile(input, 'item,amount\nA,3\nA,4\n', 'utf8');
  const localFile = makeLocalFileTool({ roots: [work], home: work, dataDir: state });
  let ordinary = 0; const assessments = [];
  const model = { async respond(tc) {
    if (tc?.workContractAssessment) return { text: '', toolCalls: [{
      name: 'work.deliverable', args: { output: 'file', sourcePolicy: 'selected' },
    }] };
    if (tc?.currentActionAssessment) return { text: '', toolCalls: [{
      name: 'work.current_actions', args: { unclear: false,
        requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index) },
    }] };
    if (tc?.deliverableVerification) {
      const satisfied = tc.deliverableVerification.readback.text === 'A\t7\n';
      assessments.push(satisfied);
      return { text: '', toolCalls: [{ name: 'work.deliverable', args: {
        output: 'file', satisfied, reason: satisfied ? 'exact' : 'wrong total',
      } }] };
    }
    if (tc?.artifactMismatch) return { text: '', toolCalls: [{ name: 'local.file', args: {
      action: 'write', path: output, text: 'A\t7\n', source: [input],
    } }] };
    if (tc?.artifactReadbackRequired || tc?.artifactAssessmentRequired) {
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: output } }] };
    }
    ordinary += 1;
    if (ordinary === 1) return { text: '', toolCalls: [{ name: 'local.file', args: {
      action: 'write', path: output, text: 'A\t6\n', source: [input],
    } }] };
    if (ordinary === 2) return { text: '', toolCalls: [{
      name: 'local.file', args: { action: 'read', path: output },
    }] };
    return '정확한 결과 파일을 다시 확인했어요.';
  } };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile }), model };
  const result = await runTurn({ text: `${input}을 집계해 ${output}로 만들어` }, ctx);
  assert.notEqual(result.kind, 'approval');
  assert.deepEqual(assessments, [false, true], JSON.stringify(result.turnExchange));
  assert.equal(await readFile(output, 'utf8'), 'A\t7\n');
  const reads = result.turnExchange.filter((entry) => entry.tool === 'local.file'
    && entry.args?.action === 'read' && entry.args?.path === output);
  assert.equal(reads.length, 2, '수정한 최신 파일을 다시 읽지 않았다');
});
