// **cfg 를 만드는 자리가 둘인데 한 곳만 눈을 적었다.**
//
// 밟은 사실(라이브 2026-08-06). 그림을 손까지 올리고 와이어 넷을 다 고쳤는데도
// 모델은 *"현재 모델에선 그 창 안의 실제 대화 텍스트를 읽어오는 기능이 막혀 있어서"* 라 답했다.
// 그 문장은 우리가 보낸 `그림못보냄말` 을 그대로 옮긴 것이었다 —
// 오너 콘솔은 **저장된 연결**로 서는데, 그 길(`resolveModelConfigFromInput`)에는
// `눈있음` 칸이 아예 없어서 언제나 fails-closed 로 떨어지고 있었다.
//
// 오늘 이 계열이 세 번 났다(교환 → 와이어 → cfg). 원인은 하나다:
// **같은 사실을 두 곳에서 따로 조립한다.** 그래서 판정을 **한 자리**로 모으고,
// cfg 를 만드는 길 전부가 그 자리를 지나게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelConfig, resolveModelConfigFromInput } from '../src/runtime/model-provider.js';

test('저장된 연결도 눈 판정을 받는다 — 콘솔이 이 길로 선다', () => {
  const cfg = resolveModelConfigFromInput({ provider: 'openai', key: 'k', modelId: 'gpt-5.1' });
  assert.equal(cfg?.눈있음, true,
    `**저장된 연결로 쓰면 화면을 영영 못 본다**: ${JSON.stringify(cfg)}`);
});

test('두 길이 같은 답을 낸다 — 어느 문으로 들어와도 같은 모델이다', () => {
  const 환경길 = resolveModelConfig({ GPAO_T5_MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'k', GPAO_T5_MODEL_ID: 'gpt-5.1' });
  const 저장길 = resolveModelConfigFromInput({ provider: 'openai', key: 'k', modelId: 'gpt-5.1' });
  assert.equal(환경길?.눈있음, 저장길?.눈있음,
    `**들어온 문에 따라 눈이 생겼다 없어졌다 한다**: 환경 ${환경길?.눈있음} · 저장 ${저장길?.눈있음}`);
});

test('무엇에 붙는지 모르는 서버에는 안 보낸다 — fails closed 는 그대로다', () => {
  const cfg = resolveModelConfigFromInput({ provider: 'openai_compatible', modelId: 'm', baseUrl: 'http://127.0.0.1:1/v1' });
  assert.notEqual(cfg?.눈있음, true,
    '**로컬 아무 서버에나 그림을 보낸다** — 못 읽으면 턴이 통째로 죽는다');
});

test('끄고 싶으면 끌 수 있다 — 벤더가 바뀌면 여기부터 끈다', () => {
  const cfg = resolveModelConfig({
    GPAO_T5_MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'k', GPAO_T5_MODEL_VISION: '0',
  });
  assert.notEqual(cfg?.눈있음, true, '끌 수가 없다');
});
