// **잘린 답을 다 쓴 답인 것처럼 내지 않는다.** (절대 게이트 1 — 거짓 성공)
//
// 라이브(오너 2026-08-05): `오늘 한국 증시 상황 알려줘` 에 T5 의 답이
// **문장 한가운데서 끊겼다** — *"예를 들어 스윙이면"* 에서 그대로 멈췄다.
// 오너: *"왜 응답이 다 나오지 않고 중간에 짤리는거지?"*
//
// 원인은 둘이 맞물렸다:
//     const DEFAULT_MAX_TOKENS = 1024;                       // 출력 상한
//     finishReason: json?.choices?.[0]?.finish_reason ?? …   // 잡기는 한다
// 종료 사유를 **관측은 하는데 턴 경로에서 아무도 안 읽는다**(성장 판정과 연결 상태에만 쓰인다).
// 그래서 상한에서 잘린 답이 **잘린 줄 모른 채** 완결된 답처럼 나갔다.
//
// 상한을 올리는 것은 이 계약이 아니다. 상한은 얼마든 있을 수 있고, 언제나 닿을 수 있다.
// 계약은 **닿았을 때 그렇다고 말하는 것**이다 — 모르는 것을 아는 척하지 않는 것과 같은 계열이고,
// 파일 손의 문(`다음은 offset=…`)·웹의 창(`본문 N자 중 M자`)과도 같은 계약이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProviderModelClient } from '../src/runtime/model-provider.js';

const 응답 = (finish, text) => ({
  ok: true, status: 200,
  json: async () => ({
    choices: [{ message: { content: text }, finish_reason: finish }],
    model: 'gpt-5.1',
  }),
  text: async () => JSON.stringify({ choices: [{ message: { content: text }, finish_reason: finish }] }),
  headers: { get: () => 'application/json' },
});

const 판 = (finish, text) => makeProviderModelClient(
  { provider: 'openai', modelId: 'gpt-5.1', baseUrl: 'https://api.openai.test/v1', token: 't', maxTokens: 1024 },
  { fetchImpl: async () => 응답(finish, text) },
);

const 도구 = [{ name: 'web.collect', description: 'x', parameters: { type: 'object', properties: {} } }];

test('① **상한에서 잘리면 잘렸다고 사실을 낸다** — 라이브에서 놓친 그것', async () => {
  const out = await 판('length', '오늘 증시는 강세입니다. 예를 들어 스윙이면')
    .respond({ system: 's', user: 'u', history: [], exchange: [] }, { tools: 도구 });
  assert.equal(out?.잘림, true,
    '**답이 상한에서 끊겼는데 그 사실이 결과에 없다.**\n'
    + '종료 사유는 관측되고 있었지만 턴 경로에서 아무도 안 읽었다 — 곁길로만 흘렀다.\n'
    + `받은 것: ${JSON.stringify(out).slice(0, 200)}`);
});

test('② **정상 종료는 잘렸다고 하지 않는다** — 없는 결함을 만들지 않는다', async () => {
  const out = await 판('stop', '오늘 증시는 강세입니다.')
    .respond({ system: 's', user: 'u', history: [], exchange: [] }, { tools: 도구 });
  assert.ok(!out?.잘림, `정상 종료를 잘림으로 봤다: ${JSON.stringify(out).slice(0, 160)}`);
});

test('③ **종료 사유를 안 주는 공급자는 지어내지 않는다** — 모르면 모르는 대로', async () => {
  const out = await 판(null, '오늘 증시는 강세입니다.')
    .respond({ system: 's', user: 'u', history: [], exchange: [] }, { tools: 도구 });
  assert.ok(!out?.잘림, `종료 사유가 없는데 잘렸다고 단정했다: ${JSON.stringify(out).slice(0, 160)}`);
});

test('④ **와이어가 달라도 같은 사실을 낸다** — 이름만 다른 같은 것', async () => {
  const 앤트로픽 = makeProviderModelClient(
    { provider: 'anthropic', modelId: 'claude', baseUrl: 'https://api.anthropic.test', token: 't', maxTokens: 1024 },
    { fetchImpl: async () => ({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => '{}',
      json: async () => ({ content: [{ type: 'text', text: '끊긴 답' }], stop_reason: 'max_tokens' }),
    }) },
  );
  const out = await 앤트로픽.respond({ system: 's', user: 'u', history: [], exchange: [] }, { tools: 도구 });
  assert.equal(out?.잘림, true,
    `앤트로픽 와이어(max_tokens)에서는 못 잡았다: ${JSON.stringify(out).slice(0, 160)}`);
});
