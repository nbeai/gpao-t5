import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); return `http://127.0.0.1:${server.address().port}`; }
const fileArgs = (args) => ({ query: null, scope: null, path: null, handles: null, maxCandidates: null,
  placements: null, planId: null, effect: null, sourceUses: null, purpose: null, unknowns: null, ...args });
const attachmentArgs = (args) => ({ attachmentId: null, filePath: null, maxChars: null, maxCells: null, maxPages: null,
  outputName: null, resultRelativePath: null, expectedResultJson: null, expectedStdoutIncludes: null,
  operationHandle: null, outputHandle: null, sourceManifestId: null, query: null, pageHandles: null, ...args });

test('실제 콘솔은 선택 원본을 결과 Artifact와 runtime provenance로 결속한다', async (t) => {
  const room = await mkdtemp(join(tmpdir(), 't5-file-reconciliation-console-')); const workspace = join(room, 'workspace');
  const resultDir = join(workspace, '결과'); await mkdir(workspace); await mkdir(resultDir);
  const source = join(room, '7월매출.csv'); const output = join(resultDir, '취합결과.csv');
  await writeFile(source, '월,매출\n7월,1200000\n'); await writeFile(output, '분기,매출\n3분기,1200000\n');
  let call = 0; let manifestId; const errors = [];
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace, computerFileRoots: [room],
    fileIndexSearch: async () => [source], onError: (error) => errors.push(error?.stack ?? String(error)), modelFactory: () => ({ async respond(input) {
      call += 1;
      if (call === 1) return { text: '', toolCalls: [{ id: 'find-hand', name: 'tool_search', args: { query: '컴퓨터 파일 찾기 취합 원본 결속' } }] };
      if (call === 2) return { text: '', toolCalls: [{ id: 'find-source', name: 'file_reality', args: fileArgs({ action: 'search', query: '7월 매출 1200000', scope: 'computer', maxCandidates: 5 }) }] };
      if (call === 3) { const found = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        return { text: '', toolCalls: [{ id: 'bind-source', name: 'file_reality', args: fileArgs({ action: 'bind_sources',
          sourceUses: [{ handle: found.candidates[0].handle, usage: '7월 확정 매출' }], purpose: '3분기 매출 취합', unknowns: ['8월 자료 미수신'] }) }] }; }
      if (call === 4) { const bound = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result; manifestId = bound.manifestId;
        return { text: '', toolCalls: [{ id: 'register-result', name: 'attachment', args: attachmentArgs({ action: 'register_output',
          filePath: output, sourceManifestId: manifestId }) }] }; }
      if (call === 5) { const registered = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        assert.equal(registered.sourceProvenance.state, 'verified'); assert.equal(registered.sourceProvenance.sources.length, 1);
        return { text: '', toolCalls: [{ id: 'complete', name: 'work_completion', args: { outcome: 'achieved', inputSettlements: [] } }] }; }
      return { text: '7월 원본을 다시 확인해 취합결과를 준비했습니다. 8월 자료는 아직 반영되지 않았습니다.', toolCalls: [] };
    } }) });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); });
  const base = await listen(server); const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: '7월매출.csv를 근거로 결과/취합결과.csv를 등록하고 8월 미수신도 알려줘' }) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify({ result, errors }));
  assert.match(result.reply, /8월 자료는 아직 반영되지 않았습니다/u); assert.ok(manifestId);
  assert.equal(result.artifacts.length, 1);
  const detail = await fetch(`${base}/sessions/${session.id}`).then((item) => item.json());
  const artifact = detail.transcript.findLast((item) => item.role === 'assistant')?.result?.artifacts?.[0];
  assert.ok(artifact?.humanReceipt, JSON.stringify(detail.transcript));
  assert.match(artifact.humanReceipt.confirmed.join(' '), /원본 1개/u);
  assert.equal(errors.length, 0, errors.join('\n'));
});
