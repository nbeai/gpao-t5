import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectToolbox } from '../src/surface/toolbox-view.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { liveDeps } from '../src/surface/live-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

// 토큰 없는 라이브 deps로 서버를 띄운다 → slack.post는 연결 필요(needs_connection).
async function withLiveServer(processEnv, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-cdw-'));
  const { env, tools, descriptors } = liveDeps(processEnv);
  const server = makeServer({ store: new SessionStore(dir), env, tools, descriptors });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

// 핵심: 작업 중 필요한 도구가 연결 안 됨 → connectionNeeded로 구조화(채팅 안 안내 카드용).
test('연결 필요: 미연결 슬랙 요청 → connectionNeeded(원래 작업 보존)', async () => {
  await withLiveServer({}, async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '슬랙에 회의 시작이라고 올려줘' })).json();
    assert.equal(r.kind, 'reply');
    assert.ok(r.connectionNeeded, '연결 안내가 표면화됨');
    assert.equal(r.connectionNeeded.toolId, 'slack.post');
    assert.equal(r.connectionNeeded.label, '슬랙 게시');
    assert.match(r.connectionNeeded.requestText, /회의 시작/, '원래 작업 보존(pending context)');
    // 미연결이라 실제 전송 승인(approval)으로 가지 않는다 — 몰래 승인 흐름 안 만든다.
    assert.notEqual(r.kind, 'approval');
  });
});

// 토큰이 있으면(연결됨) 연결 안내를 내지 않는다 — 정상 실행 경로.
test('연결됨: 토큰 있으면 슬랙 요청은 connectionNeeded 없음(승인 경로로)', async () => {
  await withLiveServer({ SLACK_BOT_TOKEN: 'xoxb-test' }, async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '슬랙에 회의 시작이라고 올려줘' })).json();
    assert.equal(r.connectionNeeded, undefined, '연결됐으면 안내 카드 없음');
    assert.equal(r.kind, 'approval', '연결됐으면 A2 승인 경로');
  });
});

// 감사 보정(필수): 연결 안내는 작업 복귀 경로 → 재접속/새로고침(historical)에도 transcript에 남아야 한다.
test('재접속: connectionNeeded가 transcript에 복원된다(pending context 유지)', async () => {
  await withLiveServer({}, async (base) => {
    const s = await (await post(base, '/sessions')).json();
    await post(base, '/turn', { sessionId: s.id, text: '슬랙에 회의 시작이라고 올려줘' });
    // 세션 재접속(GET) → 저장된 transcript의 assistant result에 연결 안내가 남아 있어야 UI가 복귀 경로를 그린다.
    const reloaded = await (await fetch(`${base}/sessions/${s.id}`)).json();
    const asst = reloaded.transcript.find((e) => e.role === 'assistant');
    assert.ok(asst?.result?.connectionNeeded, '재접속 transcript에도 연결 안내가 남음');
    assert.equal(asst.result.connectionNeeded.toolId, 'slack.post');
    assert.match(asst.result.connectionNeeded.requestText, /회의 시작/, '원래 작업도 함께 복원');
  });
});

// 선택 보정: connectHint는 연결·설정 계열에만. blocked/gray엔 부정확하므로 없음.
test('connectHint: needs_connection엔 있고, blocked에는 없다', () => {
  const { env, descriptors } = liveDeps({});
  const withBlocked = buildSelfState({
    model: { authSignal: 'ok' },
    connections: [{ id: 'slack.post', status: 'blocked', connected: true }],
    grantedAuthorities: [],
  });
  const blockedSlack = projectToolbox(withBlocked, descriptors).tools.find((t) => t.id === 'slack.post');
  assert.equal(blockedSlack.connectHint, undefined, 'blocked엔 연결 안내 부정확 → 없음');
  const needsConn = projectToolbox(buildSelfState(env), descriptors).tools.find((t) => t.id === 'slack.post');
  assert.ok(needsConn.connectHint, 'needs_connection엔 준비 안내 있음');
});

// 연결 불필요한 작업은 connectionNeeded를 내지 않는다(흐름 미교란).
test('일반 작업: 연결 안내 없음', async () => {
  await withLiveServer({}, async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '안녕' })).json();
    assert.equal(r.connectionNeeded, undefined);
  });
});

// 도구함 상세: 실행 준비 안 된 도구는 정직한 연결 준비 안내(죽은 '연결하기' 버튼 대신 텍스트).
test('도구함: 미실행 도구는 connectHint(준비 안내), 실행 가능 도구는 없음', () => {
  const { env, descriptors } = liveDeps({}); // slack.post 연결 필요
  const { tools } = projectToolbox(buildSelfState(env), descriptors);
  const slack = tools.find((t) => t.id === 'slack.post');
  assert.ok(slack.connectHint && slack.connectHint.includes('연결이 준비되면'));
  const web = tools.find((t) => t.id === 'web.collect'); // 사용 가능
  assert.equal(web.connectHint, undefined, '실행 가능 도구엔 준비 안내 없음(죽은 안내 방지)');
});
