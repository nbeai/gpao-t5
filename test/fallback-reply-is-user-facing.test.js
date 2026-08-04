// **런타임이 답을 대신 쓸 때도 사용자의 말로 쓴다** — 내부 사정을 사용자면에 흘리지 않는다.
//
// 라이브 실측(2026-08-04 · 사람 사용시험 `web_freshness` · 실제 브라우저 · gpt-5.1):
//   사용자 "https://www.linkedin.com/feed/ 이 페이지 내용 읽어서 요약해줘"
//   화면   "그 사이트가 수집을 허용하지 않아요. **방금 한 것과 같은 일이라 다시 하지 않았어요.**
//           주소를 다시 확인해 주시겠어요?"
//
// 원장:
//   web.collect · blocked   · robots_disallow · "그 사이트가 수집을 허용하지 않아요."
//   web.collect · cancelled · (미실행)        · "방금 한 것과 같은 일이라 다시 하지 않았어요."
//
// 최종 답은 **모델이 쓴 것이 아니라** 런타임이 영수증 요약을 이어 붙인 것이다
// (`fallbackReplyFrom`). 그 과정에서 **런타임 내부의 중복 차단 문구**가 그대로 사용자에게 갔다.
//
// ── 왜 결함인가 ────────────────────────────────────────────────────────────
// 사용자는 **한 번** 물었다. "방금 한 것과 같은 일"은 사용자 기준으로 **사실이 아니다** —
// 런타임이 스스로 두 번 부르려다 스스로 건너뛴 내부 사정이다. 그걸 사용자면에 실으면
// 사용자는 자기가 하지도 않은 반복을 했다고 읽는다. 원장에는 남아야 하고(모델도 받아야 하고),
// **사용자면 문장에는 안 들어가야 한다.** 두 면은 원래 다른 계약이다(§원장/사용자면 분리).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackReplyFrom } from '../src/kernel/turn.js';

const 막힘 = {
  failureState: 'blocked', fetchState: 'robots_disallow',
  actualCall: { tool: 'web.collect', args: {} },
  userSafeSummary: '그 사이트가 수집을 허용하지 않아요.',
  nextSafeAction: '주소를 다시 확인해 주시겠어요?',
};
const 런타임취소 = {
  failureState: 'cancelled',
  actualCall: null,
  제안한호출: { tool: 'web.collect', args: {} },
  userSafeSummary: '방금 한 것과 같은 일이라 다시 하지 않았어요.',
};

test('런타임이 스스로 건너뛴 것은 **사용자면 답에 안 실린다**', () => {
  const 답 = fallbackReplyFrom([막힘, 런타임취소]);
  assert.doesNotMatch(답, /방금 한 것과 같은 일/,
    `내부 중복 차단 문구가 사용자에게 갔다 — 사용자는 한 번 물었는데 반복했다고 읽는다: "${답}"`);
  assert.match(답, /수집을 허용하지 않아요/, '진짜 막힌 이유는 남아야 한다');
  assert.match(답, /주소를 다시/, '다음 길이 사라졌다 — 막다른 답이 된다');
});

test('실제로 막힌 것만 있으면 그대로 말한다(과잉 제거 금지)', () => {
  const 답 = fallbackReplyFrom([막힘]);
  assert.match(답, /수집을 허용하지 않아요/);
});

test('취소만 있으면 **빈 답을 주지 않는다**', () => {
  const 답 = fallbackReplyFrom([런타임취소]);
  assert.ok(String(답).trim(), '취소를 걷어냈더니 사용자에게 빈 답이 갔다 — 그건 더 나쁘다');
});

test('성공만 있으면 성공을 말한다(기존 계약 유지)', () => {
  const 답 = fallbackReplyFrom([{ failureState: 'none', actualCall: { tool: 'local.file' }, userSafeSummary: '읽었어요.' }]);
  assert.match(답, /읽었어요/);
});
