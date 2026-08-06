// **공급자가 한 번 딸꾹질했다고 턴을 끝내지 않는다.**
//
// 오너 화면(2026-08-06). 카톡 화면을 한 번 본 뒤로 무슨 말을 해도 같은 문장이 나왔다:
//   *"처리 중 문제가 있었어요. 다음: 잠시 후 같은 요청을 다시 해볼까요?"*
// 사용자가 **"다시해봐"** 라고 해도, **"아까 지시한 내용 다시 해봐"** 라고 해도 똑같았다.
//
// 오너 지적: *"티파이브가 한 번 시도하고 실패한 시도를 재반복 안 하는 건 좋은데,
// 그렇다고 사용자가 재시도를 명령했을 때도 무조건 거부하면 안 되는 거 아닐까?"*
//
// 맞다. 그리고 더 앞이 있다 — **사용자가 말하기 전에 우리가 한 번 다시 해야 한다.**
// 공급자 5xx 는 저쪽 사정이고 대개 일시적이다. 우리가 안 하면 사용자가 대신 말해야 하고,
// 그건 사용자 비용(0번 · 에너지)을 우리가 안 내고 사용자에게 넘기는 것이다.
//
// 규율: **한 번만**(무한히 매달리지 않는다) · **저쪽 사정일 때만**(4xx 는 우리 잘못이라
// 다시 해도 같다) · **밟은 사실은 남긴다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProviderModelClient } from '../src/runtime/model-provider.js';

const cfg = { provider: 'openai', token: 'k', modelId: 'gpt-5.1', baseUrl: 'https://x/v1', maxTokens: 100 };
const 답 = { choices: [{ message: { content: '했어요' } }] };

function 가짜fetch(응답들) {
  const 부른것 = [];
  return {
    부른것,
    async fetch() {
      const r = 응답들[Math.min(부른것.length, 응답들.length - 1)];
      부른것.push(1);
      return { ok: r.status < 400, status: r.status, async json() { return r.body ?? {}; }, async text() { return JSON.stringify(r.body ?? {}); } };
    },
  };
}

test('공급자 5xx 는 한 번 다시 해본다 — 사용자가 "다시해봐" 하기 전에', async () => {
  const f = 가짜fetch([{ status: 500, body: { error: { message: 'server_error' } } }, { status: 200, body: 답 }]);
  const client = makeProviderModelClient(cfg, { fetchImpl: f.fetch });
  const r = await client.respond({ currentRequest: 'x' }, {});
  assert.equal(String(r), '했어요',
    '**한 번 딸꾹질에 턴이 죽는다** — 사용자는 같은 문장만 계속 본다');
  assert.equal(f.부른것.length, 2, `다시 안 해봤다: ${f.부른것.length}회`);
});

test('두 번 넘게는 안 한다 — 무한히 매달리면 사용자만 기다린다', async () => {
  const f = 가짜fetch([{ status: 500, body: {} }]);
  const client = makeProviderModelClient(cfg, { fetchImpl: f.fetch });
  await client.respond({ currentRequest: 'x' }, {}).catch(() => null);
  assert.equal(f.부른것.length, 2, `**계속 매달린다**: ${f.부른것.length}회`);
});

test('우리 잘못(4xx)은 다시 안 한다 — 같은 답이 온다', async () => {
  const f = 가짜fetch([{ status: 400, body: { error: { message: 'bad request' } } }]);
  const client = makeProviderModelClient(cfg, { fetchImpl: f.fetch });
  await client.respond({ currentRequest: 'x' }, {}).catch(() => null);
  assert.equal(f.부른것.length, 1, `**틀린 요청을 그대로 또 보낸다**: ${f.부른것.length}회`);
});

test('자격 문제(401)도 다시 안 한다 — 다시 해도 안 열린다', async () => {
  const f = 가짜fetch([{ status: 401, body: {} }]);
  const client = makeProviderModelClient(cfg, { fetchImpl: f.fetch });
  await client.respond({ currentRequest: 'x' }, {}).catch(() => null);
  assert.equal(f.부른것.length, 1);
});
