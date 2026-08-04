// **답을 다시 쓸 때 세 진실이 같은가** — 커널이 돌려준 답 · 화면으로 흐른 조각 · 저장된 답.
//
// F-8(후속 장부): 사람 사용시험 라이브에서 **저장된 답 안에 서로 어긋나는 두 답이 이어붙었다.**
//   앞 = "터미널을 대신 써서 Documents 안을 볼게. 잠깐만. ```bash ls -al ~/Documents"
//   뒤 = "`~/Documents`는 지금 내가 직접 볼 수 있는 작업 폴더 범위 밖이라…"
// 이음새는 닫히지 않은 코드펜스였다. 화면 문제가 아니라 **저장된 답 자체**가 그랬다.
//
// ── 왜 이 검사를 먼저 세우는가 ─────────────────────────────────────────────
// 한 번 고치려다 되돌렸다(2026-08-04). 커널 단독 경로는 옳게 만들었는데 서버 경로에서
// 갈리는 것을 못 잡았고, **어디서 갈리는지 모른 채 고치고 있었다.** 장부에 그때 이렇게 적었다:
// *"되돌림 경로에서 (커널 reply)·(SSE 조각 누적)·(저장된 답) 셋이 같은지를 먼저 재는 검사.
// 세 진실이 갈리는 자리를 못 박고 나서 고친다."* 이 파일이 그 검사다.
//
// ── 되돌림은 이어감이 아니라 대체다 ────────────────────────────────────────
// `미리보기정렬` 의 마지막 갈래는 *"화면을 물릴 수 없으므로 답이 화면을 따라온다"* 였다.
// 그 전제는 되돌릴 방법이 없던 시절의 것이다. 출구 검증이 답을 **다시 쓰기로 정한** 경우는
// 이어감이 아니라 대체이고, 이어붙이면 사용자는 자기모순인 답을 받는다.
//
// **중간에 흐른 말 + 최종 답**처럼 잃으면 안 되는 이어감은 그대로 둔다 — 여기서 재는 것은
// 되돌림 경로 하나뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

/** SSE 본문에서 답 조각을 순서대로 모은다 — `answer_reset` 이 오면 **거기서 다시 시작**한다. */
function 조각누적(sse) {
  let 누적 = '';
  for (const 덩이 of sse.split('\n\n')) {
    const 종류 = /^event:\s*(\S+)/m.exec(덩이)?.[1];
    if (종류 === 'answer_reset') { 누적 = ''; continue; }
    if (종류 !== 'answer_delta') continue;
    const d = /^data:\s*(.+)$/m.exec(덩이)?.[1];
    if (!d) continue;
    try { 누적 += String(JSON.parse(d).text ?? ''); } catch { /* 조각 하나가 깨져도 계속 */ }
  }
  return 누적;
}

/**
 * **되돌림이 실제로 일어나는 턴**을 만든다.
 * 손을 하나도 안 쓰고 "다 옮겼어요"라고 답하면 출구 검증이 사실을 돌려주고, 모델이 고쳐 쓴다.
 */
async function 되돌림턴() {
  const dir = await mkdtemp(join(tmpdir(), 't5-rewrite-'));
  const 첫답 = '요청하신 파일 전부 옮겨 뒀어요.';
  const 고친답 = '아직 아무것도 옮기지 않았어요. 어떤 기준으로 옮길까요?';
  let 되돌림받음 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.completionMismatch) {
        되돌림받음 = true;
        opts.onDelta?.(고친답);
        return 고친답;
      }
      opts.onDelta?.(첫답);
      return 첫답;
    },
  };
  const store = new SessionStore(dir);
  const server = makeServer({ store, env: demoEnv({ include: [] }), tools: demoTools({}), model });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const start = await (await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '파일 정리해줘' }),
    })).json();
    const sse = await (await fetch(`${base}/turn/stream?sessionId=${s.id}&streamId=${start.streamId}`)).text();
    const saved = await store.load(s.id);
    const last = saved.transcript[saved.transcript.length - 1];
    return { 되돌림받음, 첫답, 고친답, 저장된답: String(last?.result?.reply ?? ''), 화면누적: 조각누적(sse) };
  } finally { await new Promise((r) => server.close(r)); }
}

test('되돌림이 실제로 일어나는 턴이다(이 검사가 성립하는 조건)', async () => {
  const r = await 되돌림턴();
  assert.ok(r.되돌림받음, '출구 검증이 안 돌았다 — 이 대본으로는 F-8 을 못 잰다');
});

test('저장된 답에 **앞의 답이 이어붙지 않는다**', async () => {
  const { 저장된답, 첫답, 고친답 } = await 되돌림턴();
  assert.ok(저장된답.includes(고친답),
    `고쳐 쓴 답이 저장 안 됐다: ${JSON.stringify(저장된답.slice(0, 120))}`);
  assert.equal(저장된답.includes(첫답), false,
    `되돌리기로 한 답이 저장된 답에 그대로 남았다 — 사용자는 자기모순인 답을 받는다:\n${저장된답.slice(0, 200)}`);
});

test('화면으로 흐른 것과 저장된 답이 **같다**', async () => {
  const { 화면누적, 저장된답 } = await 되돌림턴();
  assert.equal(화면누적, 저장된답,
    `사용자가 본 것과 저장된 것이 갈렸다.\n화면: ${JSON.stringify(화면누적.slice(0, 160))}\n저장: ${JSON.stringify(저장된답.slice(0, 160))}`);
});

test('화면에도 **앞의 답이 남지 않는다**', async () => {
  const { 화면누적, 첫답 } = await 되돌림턴();
  assert.equal(화면누적.includes(첫답), false,
    `되돌린 답이 화면에 그대로 남았다: ${화면누적.slice(0, 200)}`);
});
