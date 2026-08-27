import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('실제 콘솔은 모호한 단서로 컴퓨터 후보를 찾고 선택한 파일만 다시 연다', async (t) => {
  const room = await mkdtemp(join(tmpdir(), 't5-file-reality-console-'));
  const workspace = join(room, 'workspace'); const archive = join(room, 'archive'); const organized = join(room, '정리예정');
  await Promise.all([mkdir(workspace), mkdir(archive), mkdir(organized)]);
  const target = join(archive, '기억안나는자료.txt');
  await writeFile(target, '한빛상사 여름 행사 견적 478만원\n파란 포장으로 확정\n');
  let turn = 0; const visible = []; const errors = [];
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace, computerFileRoots: [room],
    fileIndexSearch: async () => [target], onError: (error) => errors.push(error?.stack ?? String(error)),
    modelFactory: () => ({ async respond(input) {
      turn += 1; visible.push(input.tools.map((tool) => tool.name));
      if (turn === 1) return { text: '', toolCalls: [{ id: 'discover-files', name: 'tool_search', args: {
        query: '컴퓨터 전체 파일 찾기 이름 위치 모름 내용 단서 중복 최종본 버전',
      } }] };
      if (turn === 2) return { text: '', toolCalls: [{ id: 'search-files', name: 'file_reality', args: {
        action: 'search', query: '한빛상사 파란 포장 478만원', scope: 'computer', path: null,
        handles: null, maxCandidates: 5, placements: null,
      } }] };
      if (turn === 3) {
        const observed = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        assert.equal(observed.contentIncluded, false);
        assert.equal(observed.candidates[0].displayName, '기억안나는자료.txt', JSON.stringify(observed.candidates));
        return { text: '', toolCalls: [{ id: 'inspect-file', name: 'file_reality', args: {
          action: 'inspect', query: null, scope: null, path: null,
          handles: [observed.candidates[0].handle], maxCandidates: null, placements: null,
        } }] };
      }
      if (turn === 4) {
        const inspected = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        assert.match(inspected.content ?? '', /한빛상사 여름 행사 견적 478만원/u, JSON.stringify(inspected));
        return { text: '', toolCalls: [{ id: 'plan-file', name: 'file_reality', args: {
          action: 'plan', query: null, scope: null, path: null, handles: null, maxCandidates: null,
          placements: [{ handle: inspected.file.handle, destinationDirectory: organized }],
        } }] };
      }
      if (turn === 5) {
        const planned = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        assert.equal(planned.readyToApply, true); assert.equal(planned.filesChanged, 0);
        return { text: '', toolCalls: [{ id: 'complete-file-search', name: 'work_completion',
          args: { outcome: 'achieved', inputSettlements: [] } }] };
      }
      return { text: '한빛상사 여름 행사 견적 478만원 자료를 찾았습니다.', toolCalls: [] };
    } }),
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  });
  const base = await listen(server);
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: '이름은 기억 안 나는데 한빛상사 파란 포장 478만원 견적 파일 찾아줘' }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify({ result, errors }));
  assert.match(result.reply, /478만원 자료를 찾았습니다/u);
  assert.equal(visible[0].includes('file_reality'), false);
  assert.equal(visible[1].includes('file_reality'), true);
  assert.equal(errors.length, 0, errors.join('\n'));
});
