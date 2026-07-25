import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

// SSE 텍스트 → 이벤트 목록. (턴이 짧아 res.end() 후 전체가 한 번에 온다.)
function parseSSE(text) {
  return text.split('\n\n').filter((b) => b.trim()).map((block) => {
    const ev = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('id: ')) ev.id = Number(line.slice(4));
      else if (line.startsWith('event: ')) ev.type = line.slice(7);
      else if (line.startsWith('data: ')) { try { ev.data = JSON.parse(line.slice(6)); } catch { ev.data = {}; } }
    }
    return ev;
  });
}

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-sse-'));
  const server = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}
const stream = async (base, sessionId, params) => {
  const qs = new URLSearchParams({ sessionId, ...params }).toString();
  return parseSSE(await (await fetch(`${base}/turn/stream?${qs}`)).text());
};

test('스트림: 진행 상태 이벤트 + 항상 complete로 닫힘(무한 대기 금지)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const events = await stream(base, s.id, { text: '뉴스 조사해줘' });
    const types = events.map((e) => e.type);
    assert.ok(types.includes('trace_status'), '요청 이해 상태');
    assert.ok(types.includes('tool_progress'), '도구 실행 진행');
    assert.equal(types.at(-1), 'complete', '항상 complete로 닫힌다(무한 대기 금지)');
    // eventId 단조 증가
    const ids = events.filter((e) => Number.isInteger(e.id)).map((e) => e.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    // 모델 사고 원문이 아니라 사용자 언어 상태만
    const traceTexts = events.filter((e) => e.type === 'trace_status').map((e) => e.data.text);
    assert.ok(traceTexts.every((t) => /요청|답변|정리|이해/.test(t)));
  });
});

test('스트림: 승인 필요 turn도 approval_required + complete로 닫힌다', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const events = await stream(base, s.id, { text: '슬랙 #general에 안녕이라고 올려줘' });
    const types = events.map((e) => e.type);
    assert.ok(types.includes('approval_required'), '승인 상태 표면화');
    assert.equal(types.at(-1), 'complete', '승인 대기여도 스트림은 닫힌다');
  });
});

test('재접속: lastEventId 이후의 durable 이벤트만 재생(진실은 EventLog에 남았다)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const first = await stream(base, s.id, { text: '뉴스 조사해줘' });
    const maxId = Math.max(...first.filter((e) => Number.isInteger(e.id)).map((e) => e.id));
    // lastEventId=1 로 재접속 → id>1 durable만 + reconnected
    const resumed = await stream(base, s.id, { lastEventId: '1' });
    assert.ok(resumed.every((e) => !Number.isInteger(e.id) || e.id > 1), '이미 받은 건 다시 안 옴');
    assert.ok(resumed.some((e) => e.type === 'reconnected'), '재접속 신호');
    const rec = resumed.find((e) => e.type === 'reconnected');
    assert.equal(rec.data.terminal, true, '완료된 turn은 terminal');
    // 전부 받은 뒤 재접속하면(lastEventId=maxId) 추가 durable 없음
    const none = await stream(base, s.id, { lastEventId: String(maxId) });
    assert.equal(none.filter((e) => Number.isInteger(e.id)).length, 0);
  });
});

// T3 회귀: 세션 격리 — 두 대화의 스트림이 서로를 막지 않고 각자 complete로 닫힌다.
test('T3 회귀: 동시 세션 스트림이 서로 안 막고 각자 complete', async () => {
  await withServer(async (base) => {
    const a = await (await post(base, '/sessions')).json();
    const b = await (await post(base, '/sessions')).json();
    const [ea, eb] = await Promise.all([
      stream(base, a.id, { text: '뉴스 조사해줘' }),
      stream(base, b.id, { text: '안녕' }),
    ]);
    assert.equal(ea.map((e) => e.type).at(-1), 'complete');
    assert.equal(eb.map((e) => e.type).at(-1), 'complete');
  });
});

// 스트림과 /turn(POST)이 같은 지속 경로를 쓴다 — 스트림 후에도 transcript가 정상이어야.
test('스트림 turn도 transcript에 지속된다(POST와 동일 경로)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    await stream(base, s.id, { text: '안녕' });
    const reloaded = await (await fetch(`${base}/sessions/${s.id}`)).json();
    assert.equal(reloaded.transcript.length, 2, '[user 안녕, assistant reply]');
    assert.equal(reloaded.transcript[1].result.kind, 'reply');
  });
});
