import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { withModelTimeout, ModelTimeoutError } from '../src/runtime/model-timeout.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

// 안정성 P-STAB-1: 느린/멈춘 모델이 턴을 무한 매달아 세션 큐를 막지 않게 타임아웃으로 바운드한다.

// ── 데코레이터 단위 ──
test('withModelTimeout: ms 초과 응답은 ModelTimeoutError로 reject', async () => {
  const slow = { respond: () => new Promise((r) => { const t = setTimeout(() => r('late'), 500); t.unref?.(); }) };
  await assert.rejects(() => withModelTimeout(slow, 40).respond({ currentRequest: 'x' }), (e) => e instanceof ModelTimeoutError && e.isModelTimeout === true);
});

test('withModelTimeout: 빠른 응답은 그대로 통과', async () => {
  const fast = { respond: async () => 'quick' };
  assert.equal(await withModelTimeout(fast, 1000).respond({ currentRequest: 'x' }), 'quick');
});

test('withModelTimeout: ms<=0이면 원본 그대로(무제한)', () => {
  const m = { respond: async () => 'x' };
  assert.equal(withModelTimeout(m, 0), m);
  assert.equal(withModelTimeout(m, undefined), m);
});

// ── 제어 가능한 모델(느림↔빠름 전환) ──
function controllableModel() {
  const ctl = { mode: 'fast' };
  const model = {
    async respond(tc) {
      if (ctl.mode === 'hang') return new Promise(() => {}); // 절대 안 끝남(멈춘 모델)
      return `말씀하신 "${tc.currentRequest}" 이해했어요.`;
    },
  };
  return { ctl, model };
}

const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
function parseSSE(text) {
  return text.split('\n\n').filter((b) => b.trim()).map((block) => {
    const ev = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) ev.type = line.slice(7);
      else if (line.startsWith('data: ')) { try { ev.data = JSON.parse(line.slice(6)); } catch { ev.data = {}; } }
    }
    return ev;
  });
}
const stream = async (base, sessionId, text) => {
  const { streamId } = await (await post(base, '/turn/stream-start', { sessionId, text })).json();
  return parseSSE(await (await fetch(`${base}/turn/stream?sessionId=${sessionId}&streamId=${streamId}`)).text());
};

async function withServer(deps, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-mto-'));
  const server = makeServer({ store: new SessionStore(dir), ...deps });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

// ── 헤드라인: 멈춘 모델은 스트림을 무한 매달지 않고 바운드된다 ──
test('스트림: 멈춘 모델은 타임아웃으로 recoverable_error+complete로 닫힌다(무한 매달림 금지)', async () => {
  const { ctl, model } = controllableModel();
  ctl.mode = 'hang';
  await withServer({ model, modelTimeoutMs: 60 }, async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const evs = await stream(base, s.id, '안녕');
    const types = evs.map((e) => e.type);
    assert.ok(types.includes('recoverable_error'), '타임아웃은 recoverable_error로');
    assert.ok(types.includes('complete'), '항상 complete로 닫힌다');
    const re = evs.find((e) => e.type === 'recoverable_error');
    assert.match(re.data.text, /늦어/, '느린 모델을 사용자 언어로');
  });
});

// ── 헤드라인: 멈춘 모델이 세션 큐를 막지 않는다(다음 턴 정상) ──
test('멈춘 모델 턴 뒤에도 같은 세션 다음 턴은 정상 완료(큐 안 막힘)', async () => {
  const { ctl, model } = controllableModel();
  await withServer({ model, modelTimeoutMs: 60 }, async (base) => {
    const s = await (await post(base, '/sessions')).json();
    ctl.mode = 'hang';
    const first = await stream(base, s.id, '첫 요청');
    assert.ok(first.map((e) => e.type).includes('recoverable_error'), '첫 턴은 타임아웃');
    // 큐가 풀렸다면 다음 턴은 정상적으로 돈다.
    ctl.mode = 'fast';
    const second = await stream(base, s.id, '둘째 요청');
    const complete = second.find((e) => e.type === 'complete');
    assert.ok(complete, '둘째 턴도 complete로 닫힘');
    assert.notEqual(complete.data.kind, 'error', '큐가 안 막혀 정상 완료(에러 아님)');
  });
});

// 타임아웃 0(무제한)이면 빠른 모델은 그대로 정상 — 데코레이터가 정상 흐름을 방해하지 않는다.
test('타임아웃 무제한(0)이어도 정상 턴은 그대로 complete', async () => {
  await withServer({ modelTimeoutMs: 0 }, async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const evs = await stream(base, s.id, '안녕');
    const complete = evs.find((e) => e.type === 'complete');
    assert.ok(complete && complete.data.kind !== 'error');
  });
});

// P6-19 자연스러운 거버넌스: 서버가 recoverable_error를 내보내도 클라이언트가 trace만 지우면
// 사용자는 아무 설명 없이 멈춘 것처럼 느낀다. 회복 안내는 같은 턴의 사용자 언어 메시지로 남아야 한다.
test('Work Chat은 recoverable_error를 같은 턴의 회복 안내로 렌더한다', async () => {
  const html = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'surface', 'web', 'index.html'), 'utf8');
  assert.match(html, /addEventListener\('recoverable_error'/, 'SSE recoverable_error를 듣는다');
  assert.match(html, /function renderRecovery/, '회복 안내 렌더러가 있다');
  assert.match(html, /const recovery = await streamTurn/, 'submit 경로가 회복 payload를 받는다');
  assert.match(html, /다음: \$\{r\.nextSafeAction\}/, '다음 안전 행동을 사용자에게 남긴다');
});
