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
// 발화는 POST 본문으로만(URL 노출 금지). streamId로 구독. 재접속은 lastEventId(원문 없음).
const stream = async (base, sessionId, params) => {
  if (params.text != null) {
    const { streamId } = await (await post(base, '/turn/stream-start', { sessionId, text: params.text })).json();
    return parseSSE(await (await fetch(`${base}/turn/stream?sessionId=${sessionId}&streamId=${streamId}`)).text());
  }
  const qs = new URLSearchParams({ sessionId, ...params }).toString();
  return parseSSE(await (await fetch(`${base}/turn/stream?${qs}`)).text());
};

test('스트림: 진행 상태 이벤트 + 항상 complete로 닫힘(무한 대기 금지)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const events = await stream(base, s.id, { text: '뉴스 조사해줘' });
    const types = events.map((e) => e.type);
    assert.ok(types.includes('heartbeat'), '연결 생존 신호(heartbeat)');
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

test('같은 세션 동시 스트림: eventId 중복·transcript 유실이 없다', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const [first, second] = await Promise.all([
      stream(base, s.id, { text: '첫 번째 뉴스 조사해줘' }),
      stream(base, s.id, { text: '두 번째 뉴스 조사해줘' }),
    ]);
    const combined = [...first, ...second];
    const ids = combined.filter((e) => Number.isInteger(e.id)).map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, '같은 세션 eventId는 중복되면 안 된다');
    assert.equal(combined.filter((e) => e.type === 'complete').length, 2, '두 turn 모두 명시 종료');

    const reloaded = await (await fetch(`${base}/sessions/${s.id}`)).json();
    assert.equal(reloaded.transcript.length, 4, '두 turn 모두 transcript에 남아야 한다');
    assert.deepEqual(
      reloaded.transcript.filter((e) => e.role === 'user').map((e) => e.text).sort(),
      ['두 번째 뉴스 조사해줘', '첫 번째 뉴스 조사해줘'].sort(),
    );
    assert.equal(reloaded.transcript.filter((e) => e.role === 'assistant').length, 2);
  });
});

test('스트림 내부 오류도 recoverable_error + complete로 닫고 멈추지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-sse-error-'));
  const eventLog = {
    async nextEventId() { throw new Error('event-log-down'); },
    async append() {},
    async since() { return []; },
    async lastIsTerminal() { return false; },
  };
  const server = makeServer({ store: new SessionStore(dir), eventLog });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const originalError = console.error;
  console.error = () => {};
  try {
    const s = await (await post(base, '/sessions')).json();
    const events = await stream(base, s.id, { text: '뉴스 조사해줘' });
    const types = events.map((e) => e.type);
    assert.ok(types.includes('heartbeat'), '오류 전 heartbeat가 있어야 한다');
    assert.ok(types.includes('recoverable_error'), '오류를 사용자 안전 상태로 닫는다');
    assert.equal(types.at(-1), 'complete', '내부 오류여도 complete로 닫힌다');
  } finally {
    console.error = originalError;
    await new Promise((r) => server.close(r));
  }
});

// 프라이버시(blocker): 사용자 원문은 URL query가 아니라 POST 본문으로만. GET에 streamId 없으면 실행 안 함.
test('프라이버시: text를 GET query에 실어도 실행되지 않는다(원문 URL 노출 금지)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    // 구식(원문 query) 시도 → streamId 없으니 만료 오류 + complete(실행 안 됨)
    const events = parseSSE(await (await fetch(`${base}/turn/stream?sessionId=${s.id}&text=${encodeURIComponent('비밀 메시지')}`)).text());
    const types = events.map((e) => e.type);
    assert.ok(!types.includes('trace_status'), 'text query로는 턴이 실행되지 않는다');
    assert.equal(types.at(-1), 'complete');
    // 세션에도 그 발화가 남지 않음
    const reloaded = await (await fetch(`${base}/sessions/${s.id}`)).json();
    assert.equal(reloaded.transcript.length, 0, '원문 query는 기록되지 않는다');
  });
});

test('stream-start: streamId 발급, 일회성 구독(재사용/만료 시 실행 안 함)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const { streamId } = await (await post(base, '/turn/stream-start', { sessionId: s.id, text: '안녕' })).json();
    assert.match(streamId, /^[a-f0-9-]{36}$/);
    const first = parseSSE(await (await fetch(`${base}/turn/stream?sessionId=${s.id}&streamId=${streamId}`)).text());
    assert.ok(first.some((e) => e.type === 'trace_status'), '첫 구독은 실행');
    // 같은 streamId 재사용 → 일회성이라 실행 안 됨
    const again = parseSSE(await (await fetch(`${base}/turn/stream?sessionId=${s.id}&streamId=${streamId}`)).text());
    assert.ok(!again.some((e) => e.type === 'trace_status'), '재사용 불가');
    assert.equal(again.at(-1).type, 'complete');
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
