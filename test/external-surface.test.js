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
import { surfaceOf, buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { readFileSync } from 'node:fs';

const searched = {
  intended: 'web.collect 실행',
  failureState: 'none',
  actualCall: { tool: 'web.collect', args: { request: '부오상회 을지로점 네이버 플레이스' } },
  userSafeSummary: '찾아서 읽었어요: 을지로술집 부오상회 을지로점 다녀온 후기.',
  result: {
    title: '을지로술집 부오상회 을지로점 다녀온 후기',
    markdown: '후기 본문'.repeat(50),   // 라이브 영수증엔 본문이 있다 — 읽은 양의 근거
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
  const p = surfaceOf(searched);
  assert.equal(p.action, 'search_then_read', '발화에서 예측한 분류가 아니라 실제로 한 일의 사후 기록');
  assert.equal(p.requested, '부오상회 을지로점 네이버 플레이스');
  assert.equal(p.read.url, 'https://m.blog.naver.com/rudysdiary/224220020495');
});

test('같이 나왔지만 **안 읽은 후보**도 남는다(다음 길이 된다)', () => {
  const p = surfaceOf(searched);
  assert.ok(p.notRead.fromSearch.includes('https://www.diningcode.com/profile.php?rid=m2ty3SBBhxxd'));
  assert.ok(!p.notRead.fromSearch.includes(p.read.url), '읽은 것을 안 읽은 후보에 또 넣지 않는다');
});

test('주소를 직접 받아 읽었으면 "찾아서 읽었다"고 하지 않는다', () => {
  const p = surfaceOf(direct);
  assert.equal(p.action, 'read_url');
  assert.doesNotMatch(promptFor([direct]).user, /사용자가 준 주소가 아니에요/,
    '직접 준 주소를 "찾아서 읽었다"고 하면 그건 틀린 사실이다');
  assert.doesNotMatch(promptFor([direct]).user, /검색이 준 나머지 후보/, '검색을 안 했으면 후보 이야기도 없다');
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

test('실패한 실행에는 표면 사실이 붙지 않는다(못 읽은 것에 읽은 경로를 말하지 않는다)', () => {
  assert.equal(surfaceOf({ actualCall: { tool: 'web.collect' }, failureState: 'blocked', result: {}, sources: [] }), undefined);
  assert.equal(surfaceOf(null), undefined);
});

// ── P2-9 완료 기준 (오너 지정) ──────────────────────────────────────────
// 큰 분류 체계를 만들지 않는다. 검사할 것은 **사실이 정확히 갔는가**뿐이다.

test('그 페이지에서 아직 안 연 곳이 다음 경로로 간다', () => {
  const r = {
    actualCall: { tool: 'web.collect', args: { request: 'https://m.place.naver.com/restaurant/1/home' } },
    failureState: 'none',
    result: {
      title: '팔식당', markdown: '본문',
      links: ['https://m.place.naver.com/restaurant/1/review/visitor', 'https://other.example/ad'],
    },
    sources: [{ sourceUrl: 'https://m.place.naver.com/restaurant/1/home', title: '팔식당' }],
  };
  const s = surfaceOf(r);
  assert.deepEqual(s.notRead.onPage, ['https://m.place.naver.com/restaurant/1/review/visitor'],
    '같은 사이트 안의 안 연 곳만 다음 경로다(광고·외부 링크는 길이 아니다)');
  assert.match(promptFor([r]).user, /아직 안 연 곳:.*review\/visitor/);
});

test('얼마나 읽었는지가 사실로 간다("보이는 만큼"의 근거)', () => {
  const { user } = promptFor([searched]);
  assert.match(user, /본문 \d+자/, '읽은 양을 모르면 "전부 읽었다"고 말하게 된다');
});

// **핵심**: 브라우저 부재는 실패가 아니다. failureState 는 건드리지 않는다.
test('브라우저 부재를 실패로 기록하지 않는다 — 능력 한계로 말한다', async () => {
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { toolCapabilityLine } = await import('../src/kernel/tool-labels.js');
  const self = buildSelfState(demoEnv());
  const line = toolCapabilityLine('web.collect', self);
  assert.match(line, /눌러 보지는 못한다|버튼·탭|스크롤/, '못 하는 것도 능력 문장이 말해야 한다');
  assert.match(line, /주소를 직접 받으면/, '되는 길도 함께 말한다(막다른 답 금지)');
  // 능력 부재가 영수증의 실패로 새면 T5 가 "막혔다"고 말하게 된다(P2-8 과 충돌).
  const { FAILURE } = await import('../src/kernel/contracts.js');
  assert.equal(FAILURE?.browser_unavailable, undefined, '능력 부재를 실패 어휘에 넣지 않는다');
});

test('사후 기록은 두 가지뿐이다(큰 분류 체계를 만들지 않는다)', () => {
  assert.equal(surfaceOf(searched).action, 'search_then_read');
  assert.equal(surfaceOf(direct).action, 'read_url');
  // routeKind 11개·surfaceType 12개 같은 열거가 다시 생기면 이 파일부터 커진다.
  const src = readFileSync(new URL('../src/kernel/l1-intent/task-context.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /place_home|visitor_review|external\.collect_review/, '표면 유형 열거 금지(네이버 전용이 된다)');
});

// ── 결과 요약: 앞부분 절단 금지 (오너 지시 2026-07-27) ────────────────────
// 예전엔 JSON.stringify 후 앞 1200자를 잘랐다. 뒤에 있던 링크·관찰 사실이 통째로 사라졌고,
// 무엇이 잘렸는지도 안 보였다. 원문은 영수증에 남고, 모델 입력에는 **판단에 필요한 사실**만 간다.
test('웹 결과 요약에 제목·본문 길이·링크가 남는다(뒤가 잘려 사라지지 않는다)', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const out = compactResult({
    title: '어떤 페이지', markdown: '본문'.repeat(3000),
    links: ['https://a.example/1', 'https://a.example/2'],
  });
  assert.match(out, /제목: 어떤 페이지/);
  assert.match(out, /본문 6000자/, '얼마나 긴 글이었는지가 사라지면 안 된다');
  assert.match(out, /https:\/\/a\.example\/2/, '링크는 JSON 뒤쪽에 있어서 예전 방식이면 잘렸다');
  assert.doesNotMatch(out, /^\{/, 'JSON 덩어리가 아니라 읽을 수 있는 사실이어야 한다');
});

test('브라우저 결과 요약에 본 범위·못 본 범위·더 열 것·조작이 남는다', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const out = compactResult({
    title: '어떤 화면', markdown: '가'.repeat(5000),
    observation: {
      seen: { chars: 12000, of: 40666, percent: 30 }, unseen: { chars: 28666, percent: 70 },
      moreBelow: true, canOpen: [{ ref: 'e1', text: '리뷰', kind: 'tab' }],
      acted: { kind: 'scroll', times: 3, stopped: 'no_new_content' },
    },
  });
  for (const must of [/30%/, /28666자/, /아래 남음: 있음/, /리뷰\(tab, ref=e1\)/, /3번 내렸어요/]) {
    assert.match(out, must, `요약에서 빠지면 모델이 그 빈칸을 지어낸다: ${must}`);
  }
});

test('잘릴 때는 **가운데를 접고 얼마가 생략됐는지 말한다**(앞부분만 남기지 않는다)', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const out = compactResult({ title: 'x', markdown: `시작${'중간'.repeat(3000)}끝맺음` });
  assert.match(out, /가운데 \d+자 생략/, '무엇이 생략됐는지 보여야 한다');
  assert.match(out, /끝맺음/, '앞부분만 남기면 결론이 통째로 사라진다');
});
