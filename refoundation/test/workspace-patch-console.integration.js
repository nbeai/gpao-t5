import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeConsoleServer } from '../src/console-server.js';

const post = (base, path, body) => fetch(`${base}${path}`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (response) => ({ status: response.status, body: await response.json() }));

test('실제 Console은 workspace_patch preview→apply→최종 답을 한 Run에서 관통한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-workspace-console-')); const workspace = join(root, 'workspace');
  const stateDir = join(root, 'state'); await (await import('node:fs/promises')).mkdir(workspace);
  await writeFile(join(workspace, 'config.json'), '{"revision":1}'); let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond({ tools, messages }) {
      turn += 1;
      if (turn === 1) {
        assert.ok(tools.some((tool) => tool.name === 'tool_search'));
        return { text: '', toolCalls: [{ id: 'find-patch', name: 'tool_search', args: {
          query: '여러 파일 구조화 수정 생성 transaction rollback',
        } }] };
      }
      assert.ok(tools.some((tool) => tool.name === 'workspace_patch'));
      if (turn === 2) return { text: '', toolCalls: [{ id: 'preview', name: 'workspace_patch', args: {
        action: 'preview', planHandle: null, undoHandle: null, operations: [
          { type: 'modify', path: 'config.json', to: null, content: '{"revision":2}' },
          { type: 'create', path: 'literal.txt', to: null, content: '$HOME literal' },
        ],
      } }] };
      if (turn === 3) {
        const receipt = JSON.parse([...messages].reverse().find((item) => (
          item.role === 'tool' && item.name === 'workspace_patch'
        )).content);
        return { text: '', toolCalls: [{ id: 'apply', name: 'workspace_patch', args: {
        action: 'apply', planHandle: receipt.result.planHandle, undoHandle: null, operations: [],
      } }] };
      }
      if (turn === 5) {
        const currentRequest = [...messages].reverse().find((item) => item.role === 'user')?.content ?? '';
        assert.match(currentRequest, /T5 CURRENT REVERSIBLE PROJECT CHANGE/u);
        assert.match(currentRequest, /durableUndoHandles=\["undo_/u);
        const receipts = [...messages].reverse().filter((item) => item.role === 'tool'
          && item.name === 'workspace_patch').map((item) => JSON.parse(item.content));
        const undoHandle = receipts.find((item) => item.result?.undoHandle)?.result.undoHandle;
        return { text: '', toolCalls: [{ id: 'rollback', name: 'workspace_patch', args: {
          action: 'rollback', planHandle: null, undoHandle, operations: [],
        } }] };
      }
      if (turn === 6) return { text: '두 파일을 이전 상태로 복원했어요.', toolCalls: [] };
      return { text: '두 파일을 함께 적용하고 다시 확인했어요.', toolCalls: [] };
    } }),
    onError: () => {},
  });
  server.on('request', () => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = (await post(base, '/sessions', {})).body;
    const response = await post(base, '/turn', { sessionId: session.id,
      text: '설정과 literal 파일을 함께 수정해줘' });
    assert.equal(response.status, 200); assert.match(response.body.reply, /두 파일/u);
    assert.equal(await readFile(join(workspace, 'config.json'), 'utf8'), '{"revision":2}');
    assert.equal(await readFile(join(workspace, 'literal.txt'), 'utf8'), '$HOME literal');
    const undone = await post(base, '/turn', { sessionId: session.id, text: '방금 두 파일 변경을 되돌려줘' });
    assert.equal(undone.status, 200, JSON.stringify(undone.body)); assert.match(undone.body.reply, /복원/u);
    assert.equal(await readFile(join(workspace, 'config.json'), 'utf8'), '{"revision":1}');
    await assert.rejects(readFile(join(workspace, 'literal.txt')), { code: 'ENOENT' });
  } finally {
    server.closeWakeStreams(); await server.closeCommandExplainer(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true });
  }
});
