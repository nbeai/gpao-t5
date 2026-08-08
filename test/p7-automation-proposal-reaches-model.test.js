// **⑦ 의 봉인 — 예약 후보가 모델 입력까지 닿는다** (PM 지목 요구 2026-08-09).
//
// E3 실측: ⑦ 얼굴(후보 3/3 · 말이 안 따라옴 · 거짓 실패 "스스로 먼저 말 걸 수 없어요")이
// 0/3 로 재현되지 않았다 — [이번 턴에 세운 예약 후보] 블록이 이미 배선돼 닿아 있었다.
// 이 봉인은 그 배선을 지킨다: 화면 배선은 automation-proposal-reaches-screen 이 지키고,
// **모델 입력** 배선은 여기가 지킨다 — 둘 중 하나가 끊기면 ⑦ 은 옛 얼굴로 돌아간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMessages } from '../src/runtime/model-provider.js';

test('예약 후보 블록이 모델 입력에 실린다 — 안 실리면 모델이 "먼저 말 못 걸어요"를 지어낸다', () => {
  const { system } = buildModelMessages({
    currentRequest: '매주 월요일 아침에 지난주 정산 정리해서 알려줘',
    automationProposal: { statement: '매주 월요일 아침에 지난주 정산 정리해서 알려주기', state: 'proposed' },
  });
  const 글 = String(system);
  assert.match(글, /이번 턴에 세운 예약 후보/, '예약 후보 블록이 모델 입력에 없다 — E3 이전 얼굴로 돌아간다');
  assert.match(글, /매주 월요일 아침에 지난주 정산 정리해서 알려주기/, '후보 문장이 안 실렸다');
});

test('반대시험: 후보가 없는 턴에는 블록이 없다 — 없는 것을 있다고 말하지 않는다', () => {
  const { system } = buildModelMessages({ currentRequest: '오늘 날씨 어때' });
  assert.doesNotMatch(String(system), /이번 턴에 세운 예약 후보/,
    '후보 없는 턴에 예약 블록이 실렸다 — 지어낸 사실이다');
});
