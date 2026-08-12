// **와이어가 넷인데 한 곳만 빠진다** — 그 계열을 여기서 끝낸다.
//
// 밟은 사실(라이브 2026-08-06). 카톡 창을 눈으로 찍어 그림을 손까지 올렸고,
// 손의 말도 *"화면을 보고 말씀드릴게요"* 로 바꿨다. 그런데 모델은 여전히
// *"이 환경에선 카톡 창 안의 글자를 직접 읽어오지 못해서"* 라고 답했다.
//
// 이유: 오너 콘솔은 **ChatGPT 계정 경로**로 서고, 그 와이어의 `responsesExchange` 가
// **그림을 통째로 버리고 있었다.** 바로 그 함수 위 주석이 2026-08-04 의 같은 사고를 적고 있다 —
// *"여기가 통째로 비어 있었다 … 다른 와이어는 전부 교환을 싣는데 이 경로만 빠져 있어서."*
//
// **같은 계열이 두 번 났다.** 한 와이어를 고치면 다음 와이어에서 또 난다.
// 그래서 이 검사는 **와이어 하나가 아니라 전부**를 훑는다. 새 와이어가 늘면 여기서 걸린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_PROVIDERS } from '../src/runtime/model-provider.js';
import { responsesInput } from '../src/runtime/chatgpt-model-client.js';

const 그림달린교환 = [{
  ref: 'p1', tool: 'desktop.screen', args: { action: 'observe' },
  summary: '그 창은 글자로는 못 읽어서 화면을 보고 말씀드릴게요.',
  그림: { mime: 'image/jpeg', base64: 'P'.repeat(2000) },
}];
const 말 = { system: 's', user: 'u', history: [], exchange: 그림달린교환 };

/** 모든 와이어를 한 자리에 세운다 — 하나라도 빠지면 여기가 빈다. */
const 와이어들 = [
  ...Object.entries(MODEL_PROVIDERS).map(([이름, spec]) => ({
    이름, 몸통: (cfg) => String(spec.body({ modelId: 'x', baseUrl: 'https://x/v1', ...cfg }, 말)),
  })),
  { 이름: 'chatgpt', 몸통: (cfg) => JSON.stringify(responsesInput({ ...말, ...cfg })) },
];

test('그림을 실을 수 있는 와이어가 하나도 안 빠진다 — 계정 경로만 못 보는 일이 없다', () => {
  const 버리는곳 = 와이어들
    .filter(({ 몸통 }) => !몸통({ 눈있음: true }).includes('P'.repeat(2000)))
    .map(({ 이름 }) => 이름);
  assert.deepEqual(버리는곳, [],
    `**이 와이어로 쓰는 사용자만 화면을 못 본다**: ${버리는곳.join(' · ')}`);
});

test('눈이 없다고 밝히면 어느 와이어도 안 싣는다 — 규율도 같이 간다', () => {
  const 그냥싣는곳 = 와이어들
    .filter(({ 몸통 }) => 몸통({ 눈있음: false }).includes('P'.repeat(2000)))
    .map(({ 이름 }) => 이름);
  assert.deepEqual(그냥싣는곳, [],
    `**못 읽는 모델에 그림을 보낸다** — 하드 실패다: ${그냥싣는곳.join(' · ')}`);
});

test('못 실었으면 그 사실을 글로 남긴다 — 어느 와이어든', () => {
  const 조용한곳 = 와이어들
    .filter(({ 몸통 }) => !/그림을 볼 수 없|화면 증거/.test(몸통({ 눈있음: false })))
    .map(({ 이름 }) => 이름);
  assert.deepEqual(조용한곳, [], `**조용히 버린다** — 모델은 눈이 없다는 것도 모른다: ${조용한곳.join(' · ')}`);
});
