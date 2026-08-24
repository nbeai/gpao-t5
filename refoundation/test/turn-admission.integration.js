import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('실행 중 같은 대화의 새 발화는 말풍선·원장 전에 409로 명확히 거부된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-turn-admission-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: () => ({ async respond() {
    entered(); await gate; return { text: '첫 작업 완료', toolCalls: [] };
  } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '첫 작업', attachmentIds: [] }),
    }).then((response) => response.json());
    const streamResponse = await fetch(`${base}/turn/stream?sessionId=${session.id}&streamId=${first.streamId}`);
    await started;
    const secondResponse = await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '왜 못하고 있지?', attachmentIds: [] }),
    });
    const second = await secondResponse.json();
    assert.equal(secondResponse.status, 409);
    assert.equal(second.code, 'session_running');
    const during = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.equal(JSON.stringify(during).includes('왜 못하고 있지?'), false);
    release(); await streamResponse.text();
    const completed = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.deepEqual(completed.transcript.filter((entry) => entry.role === 'user').map((entry) => entry.text), ['첫 작업']);
  } finally {
    release?.(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('콘솔은 서버 접수 성공 뒤에만 사용자 말풍선을 만들고 busy 입력을 보존한다', async () => {
  const html = await readFile(new URL('../../src/surface/web/index.html', import.meta.url), 'utf8');
  const submit = html.slice(html.indexOf('async function submit()'), html.indexOf('function renderRecovery'));
  assert.ok(submit.indexOf('await startTurn(') < submit.indexOf("const box = turnBox()"));
  assert.match(submit, /session_running[\s\S]*입력한 내용은 그대로 두었습니다[\s\S]*return/u);
  assert.ok(submit.lastIndexOf("text.value = ''") > submit.indexOf("const box = turnBox()"));
});
