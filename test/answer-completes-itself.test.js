// **답은 끝까지 나간다.** 잘렸다고 안내하는 게 아니라, 이어 써서 완성한다.
//
// 라이브(오너 2026-08-05): `오늘 한국 증시 상황 알려줘` 에 답이 문장 한가운데
// *"예를 들어 스윙이면"* 에서 끊겼다. 나는 **"여기서 잘렸어요"라고 말하는 것**으로 고쳤다.
// 오너 질책:
//   *"맥스토큰이 정해져 있다면 그 한계 내에서 정리를 잘 한 출력값을 내야 하는 게 맞는 거지,
//    여기서 잘렸습니다라고 안내하는 게 무슨 소용이야. 또는 메시지 영역을 두 번, 세 번에
//    나누어서 필요한 만큼 다 출력하게 해도 되잖아."*
//   *"사용자의 목적 달성을 위해서 시스템이 움직여야지. 니들이 정한 원칙들이 우선이 아니라고!"*
//
// 맞다. 사용자는 증시 정보를 원했지 잘림 안내를 원한 게 아니다. 정직은 **끝까지 못 냈을 때**
// 쓰는 것이지, 낼 수 있는데 안 내고 대신 하는 말이 아니다(최상위 §0).
//
// 그래서 계약을 이렇게 잡는다:
//   · 상한에 닿으면 **이어 써서 완성한다**(사용자는 나눠졌다는 걸 몰라도 된다)
//   · 이어 써도 안 끝나면 그때 사실을 말한다
//   · 상한 자체도 답 한 편이 들어갈 만큼은 된다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProviderModelClient, DEFAULT_MAX_TOKENS } from '../src/runtime/model-provider.js';

const 응답 = (finish, text) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  text: async () => '{}',
  json: async () => ({ choices: [{ message: { content: text }, finish_reason: finish }], model: 'gpt-5.1' }),
});

function 판(차례) {
  let n = 0;
  const 부른것 = [];
  const c = makeProviderModelClient(
    { provider: 'openai', modelId: 'gpt-5.1', baseUrl: 'https://api.openai.test/v1', token: 't', maxTokens: 1024 },
    { fetchImpl: async (url, init) => { 부른것.push(JSON.parse(init?.body ?? '{}')); const r = 차례[Math.min(n, 차례.length - 1)]; n += 1; return 응답(r[0], r[1]); } },
  );
  return { c, 부른것, 횟수: () => n };
}

const 도구 = [{ name: 'web.collect', description: 'x', parameters: { type: 'object', properties: {} } }];
const 부르기 = (c) => c.respond({ system: 's', user: 'u', history: [], exchange: [] }, { tools: 도구 });

test('① **끊기면 이어 써서 완성한다** — 사용자는 온전한 답을 받는다', async () => {
  const { c, 횟수 } = 판([['length', '오늘 증시는 강세입니다. 예를 들어 스윙이면'], ['stop', ' 분할 매도를 보세요.']]);
  const out = await 부르기(c);
  assert.ok(횟수() >= 2, `끊겼는데 이어 쓰지 않았다(호출 ${횟수()}회)`);
  assert.match(out.text, /예를 들어 스윙이면 분할 매도를 보세요\./,
    `**이어 쓴 것이 앞과 안 붙었다**: ${JSON.stringify(out.text)}`);
  assert.ok(!out.잘림, '완성했는데 잘렸다고 남겼다 — 사용자에게 쓸데없는 말이 나간다');
});

test('② **이어 쓸 때 앞에 쓴 것을 모델에게 준다** — 같은 말을 다시 쓰지 않게', async () => {
  const { c, 부른것 } = 판([['length', '앞부분입니다'], ['stop', ' 뒷부분입니다']]);
  await 부르기(c);
  const 둘째 = JSON.stringify(부른것[1] ?? {});
  assert.match(둘째, /앞부분입니다/, `이어 쓰는 호출에 앞 내용이 없다: ${둘째.slice(0, 200)}`);
});

test('③ **이어 써도 안 끝나면 그때 사실을 남긴다** — 무한히 붙들지 않는다', async () => {
  const { c, 횟수 } = 판([['length', '가'], ['length', '나'], ['length', '다'], ['length', '라'], ['length', '마']]);
  const out = await 부르기(c);
  assert.equal(out.잘림, true, '끝내 못 끝냈는데 그 사실이 없다');
  assert.ok(횟수() <= 4, `이어 쓰기가 안 멈춘다(${횟수()}회) — 비용과 지연이 무한해진다`);
  assert.match(out.text, /가나다/, `이어 쓴 조각이 버려졌다: ${JSON.stringify(out.text)}`);
});

test('④ **손을 부르는 답은 이어 쓰지 않는다** — 도구 호출을 두 번 만들면 중복 실행이다', async () => {
  const c = makeProviderModelClient(
    { provider: 'openai', modelId: 'gpt-5.1', baseUrl: 'https://api.openai.test/v1', token: 't', maxTokens: 1024 },
    { fetchImpl: async () => ({
      ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{}',
      json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '읽어볼게요', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_collect', arguments: '{}' } }] } }] }),
    }) },
  );
  const out = await c.respond({ system: 's', user: 'u', history: [], exchange: [] }, { tools: 도구 });
  assert.equal(out.toolCalls.length, 1, '손 호출이 사라지거나 늘었다');
});

test('⑤ **상한이 답 한 편은 들어갈 만큼은 된다** — 1024 는 한국어 답 한 편도 못 담았다', () => {
  assert.ok(DEFAULT_MAX_TOKENS >= 4000,
    `기본 상한이 ${DEFAULT_MAX_TOKENS} 다. 라이브에서 한국어 답 한 편이 그대로 잘렸다.`);
});
