// **연결 없이 지금 닿는 것도 사실이다** (콘솔 라이브 2026-08-12 · 오너 직접 시험 포함).
//
// `[바깥 자료에 닿는 현실]` 블록은 미연결 서비스마다 「직접 연결 없음(연결하면 가능) —
// 연결하면 … — 붙이는 길: …」 만 말했다. 연결 **없이** 지금 무엇이 되는지는 한 줄도 없었다.
//
// 밟은 회차: *"네이버에서 팔식당 검색해서 플레이스 후기 분석해줄 수 있어?"* →
// 모델이 `connector.connect` 를 먼저 골라 Client ID·Secret 를 요구했다. 여러 회차에서
// 반복됐고 오너가 직접 연 콘솔에서도 같았다. **모델이 지어낸 게 아니라 우리가 그렇게 말했다** —
// 같은 파일의 옛 흉터(2026-08-05 *"우리가 사용자 입으로 말했다"*)와 같은 계열이다.
//
// 고치는 방식은 지시 추가가 아니라 **빠진 사실 한 쪽을 채우는 것**이다. 바로 위 `reach` 가
// 이미 닿는 손들을 열거하고 있고, 공개 자료는 그 손으로 지금 읽힌다. 어느 길로 갈지는
// 그대로 모델이 고른다(§24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 기본 = {
  currentRequest: '네이버에서 팔식당 검색해서 플레이스에 있는 후기 분석해줄 수 있어?',
  identity: { name: 'T5' },
};

const 현실 = (reach) => ({
  ...기본,
  externalReality: {
    ...(reach ? { reach: [{ label: '웹 읽기', operation: 'collect' }] } : {}),
    services: [{
      label: '네이버', aliases: ['naver'], connected: false, connectable: true,
      jobsWhenConnected: ['검색 결과 가져오기'],
      paths: [{ kind: 'api_key', label: 'API 키' }],
    }],
  },
});

test('미연결 서비스 줄이 「연결 없이 지금 되는 것」도 말한다', () => {
  const m = buildModelMessages(현실(true));
  assert.match(m.system, /연결 없이도: 공개된 자료는 위 손으로 지금 읽을 수 있다/,
    `**연결하면 가능만 말하고 지금 되는 것을 안 말한다** — 모델이 연결부터 고른다`);
});

test('그 줄이 「연결하면 가능」과 같은 자리에 선다 — 한쪽만 보이지 않게', () => {
  const m = buildModelMessages(현실(true));
  const 연결하면 = m.system.indexOf('연결하면 가능');
  const 연결없이 = m.system.indexOf('연결 없이도');
  assert.ok(연결하면 >= 0 && 연결없이 > 연결하면,
    `두 사실이 같은 자리에 안 선다 (연결하면=${연결하면} · 연결없이=${연결없이})`);
});

test('닿는 손이 없으면 그 줄도 없다 — 못 지킬 말을 하지 않는다', () => {
  const m = buildModelMessages(현실(false));
  assert.doesNotMatch(m.system, /연결 없이도: 공개된 자료/,
    '닿는 손이 하나도 없는데 「지금 읽을 수 있다」고 말한다');
});

test('연결된 서비스에는 안 붙는다 — 잔소리를 늘리지 않는다', () => {
  const m = buildModelMessages({
    ...기본,
    externalReality: {
      reach: [{ label: '웹 읽기' }],
      services: [{ label: '노션', connected: true }],
    },
  });
  assert.doesNotMatch(m.system, /연결 없이도: 공개된 자료/,
    '이미 연결된 서비스에까지 그 줄이 붙었다');
});
