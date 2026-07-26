// P2-8 · 요청↔결과 정합 — **무엇을 찾으려 했고 무엇을 실제로 읽었는가.**
//
// 실측 결함(2026-07-27, 오너 실사용):
//   모델 요청: web.collect{request: "부오상회 을지로점 **네이버 플레이스**"}
//   실제 읽음: m.blog.naver.com/... (검색 1위 블로그)
//   원장 기록: failureState = none  ← "성공"
//   모델 답변: "네이버 플레이스 원문은 **검색 수집이 제한돼서**…"
//
// 모델은 거짓말한 게 아니다. 플레이스를 못 받은 건 사실이고, **왜** 못 받았는지를 우리가 안 알려줘서
// 스스로 추측했다. 제한된 적은 없다 — 검색 결과에 플레이스가 아예 없었을 뿐이다(실측 확인).
//
// **불일치 탐지기를 만들지 않는다.** 요청문 토큰과 결과를 비교하는 휴리스틱은 다음에 또 어긋난다
// (절대원칙 8: 목록이 아니라 불변식). 사실만 준다 — 찾아서 읽었는지, 무엇을 안 읽었는지.
// 그게 맞는 자료인지는 모델이 판단한다(§24: 코드는 사실, 모델은 판단).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provenanceOf, buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const searched = {
  intended: 'web.collect 실행',
  failureState: 'none',
  actualCall: { tool: 'web.collect', args: { request: '부오상회 을지로점 네이버 플레이스' } },
  userSafeSummary: '찾아서 읽었어요: 을지로술집 부오상회 을지로점 다녀온 후기.',
  result: {
    title: '을지로술집 부오상회 을지로점 다녀온 후기',
    foundVia: {
      provider: '덕덕고',
      query: '부오상회 을지로점 네이버 플레이스',
      candidates: [
        { url: 'https://m.blog.naver.com/rudysdiary/224220020495' },
        { url: 'https://www.diningcode.com/profile.php?rid=m2ty3SBBhxxd' },
        { url: 'https://www.placeview.co.kr/id/MjEwNzY0NTgwNCAg' },
      ],
    },
  },
  sources: [{ sourceUrl: 'https://m.blog.naver.com/rudysdiary/224220020495', title: '…' }],
};
const direct = {
  intended: 'web.collect 실행',
  failureState: 'none',
  actualCall: { tool: 'web.collect', args: { request: 'https://m.place.naver.com/restaurant/1/home' } },
  userSafeSummary: '공개 자료로 확인했어요: 팔식당.',
  result: { title: '팔식당' },
  sources: [{ sourceUrl: 'https://m.place.naver.com/restaurant/1/home', title: '팔식당' }],
};

const promptFor = (receipts) => buildModelMessages(buildTaskContext({
  intent: { currentRequest: '분석해줘' }, selfState: buildSelfState(demoEnv()), receipts,
}));

test('찾아서 읽었으면 **무엇을 찾으려 했는지**가 사실로 남는다', () => {
  const p = provenanceOf(searched);
  assert.equal(p.sought, '부오상회 을지로점 네이버 플레이스');
  assert.equal(p.readUrl, 'https://m.blog.naver.com/rudysdiary/224220020495');
});

test('같이 나왔지만 **안 읽은 후보**도 남는다(다음 길이 된다)', () => {
  const p = provenanceOf(searched);
  assert.ok(p.others.includes('https://www.diningcode.com/profile.php?rid=m2ty3SBBhxxd'));
  assert.ok(!p.others.includes(p.readUrl), '읽은 것을 안 읽은 후보에 또 넣지 않는다');
});

test('주소를 직접 받아 읽었으면 아무 것도 만들지 않는다(군더더기 금지)', () => {
  assert.equal(provenanceOf(direct), undefined);
  assert.doesNotMatch(promptFor([direct]).user, /사용자가 준 주소가 아니에요/,
    '직접 준 주소를 "찾아서 읽었다"고 하면 그건 틀린 사실이다');
});

test('관통: 모델 입력에 요청·읽은 곳·안 읽은 곳이 함께 간다', () => {
  const { user } = promptFor([searched]);
  assert.match(user, /사용자가 준 주소가 아니에요/, '검색으로 찾은 것을 "사용자가 준 글"이라고 말한 실측이 있다');
  assert.match(user, /읽은 곳: https:\/\/m\.blog\.naver\.com/);
  assert.match(user, /나머지 후보\(이게 전부예요\):.*diningcode/);
  // 목록이 전부라는 사실이 없으면 모델이 "제한돼서"라고 이유를 지어낸다(실측).
  assert.match(user, /검색이 그걸 못 찾은 거예요\(막힌 게 아니에요\)/);
});

test('사실만 주고 판단은 강요하지 않는다(불일치 단정·지시 문구 금지)', () => {
  const { user } = promptFor([searched]);
  // "요청과 다른 자료다"라고 **런타임이 단정하면** 맞는 자료였을 때 모델을 오염시킨다.
  assert.doesNotMatch(user, /일치하지 않|틀린 자료|잘못된 결과|다시 찾아라|해라/);
});

test('실패한 실행에는 출처 이력이 붙지 않는다(못 읽은 것에 읽은 경로를 말하지 않는다)', () => {
  assert.equal(provenanceOf({ failureState: 'blocked', result: {}, sources: [] }), undefined);
  assert.equal(provenanceOf(null), undefined);
});
