// 국면 5 슬라이스 1 「일반 클릭」 — 술어 한 벌·전달·경계말을 문다.
//
// 선빨강 실측(국면5-b-s1-선빨강-2회): 모델 회차 3/3 미달 · 클릭 0. 원인 사슬:
// ①판정(tab/expander 만) ②전달(canOpen 이 링크·버튼 버림) ③능력 문장(「탭·더보기만」).
// 이 검사가 무는 것은 ①②의 코드 경계(술어 단위 · canOpen 전달 · 경계말)다.
// 수집·클릭의 **술어 동일성 자체**는 여기서 못 문다(둘 다 evaluate 문자열 주입) —
// 그 증거는 라이브 반대시험 ㉯㉰(수집에서 걸러진 것이 클릭에서도 거절되는가)가 진다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { 클릭가능술어, 클릭판정술어 } from '../src/runtime/browser.js';
import { observationFacts, makeBrowserActTool } from '../src/runtime/browser-tool.js';

const 술어 = new Function(`return (${클릭가능술어})`)();
const 판정술어 = new Function(`return (${클릭판정술어})`)();
const ORIGIN = 'http://127.0.0.1:9999';

/** 가짜 요소 — 술어가 읽는 면만 만든다(DOM 불필요 · 의존성 0 유지). */
const 요소 = ({ tag = 'BUTTON', href, type, form } = {}) => ({
  tagName: tag, href, type,
  closest: (sel) => (sel === 'form' ? form ?? null : null),
});

test('술어: 같은 사이트 링크는 누른다 · 바깥 링크는 안 누른다', () => {
  assert.equal(술어(요소({ tag: 'A', href: `${ORIGIN}/자세히` }), ORIGIN), true);
  assert.equal(술어(요소({ tag: 'A', href: 'https://example.com/소식' }), ORIGIN), false);
  assert.equal(술어(요소({ tag: 'A', href: undefined }), ORIGIN), false);
});

test('외부 링크 배제는 사라지지 않고 이유·주소 사실이 된다', () => {
  assert.deepEqual(판정술어(요소({ tag: 'A', href: 'https://example.com/소식?token=숨김' }), ORIGIN), {
    된다: false, 이유: 'external_link', address: 'https://example.com/소식?token=숨김',
  });
});

test('술어: 폼 밖 버튼은 type 미지정이어도 누른다 — 옛 필터의 과잉 배제 자리(선빨강 실측)', () => {
  // HTMLButtonElement 의 .type 기본값은 submit 이다 — 폼 밖이면 제출할 폼이 없다.
  assert.equal(술어(요소({ type: 'submit' }), ORIGIN), true);
  assert.equal(술어(요소({ type: undefined }), ORIGIN), true);
  assert.equal(술어(요소({ type: 'button' }), ORIGIN), true);
});

test('술어: 폼 소속 제출 컨트롤과 POST 폼 소속은 안 누른다', () => {
  const GET폼 = { method: 'get' };
  const POST폼 = { method: 'post' };
  assert.equal(술어(요소({ type: 'submit', form: GET폼 }), ORIGIN), false);
  assert.equal(술어(요소({ type: undefined, form: GET폼 }), ORIGIN), false, '기본값 submit — 폼 안이면 제출 컨트롤이다');
  assert.equal(술어(요소({ type: 'button', form: POST폼 }), ORIGIN), false, 'POST 폼 소속은 종류 불문 배제');
  assert.equal(술어(요소({ type: 'button', form: GET폼 }), ORIGIN), true, 'GET 폼의 일반 버튼은 누른다');
});

test('전달: canOpen 이 링크·버튼을 버리지 않고 kind 와 함께 싣는다 (상한 12 유지)', () => {
  const view = {
    url: 'http://127.0.0.1:9999/가게', title: '동네가게', text: '본문'.repeat(200), textTotal: 400,
    scroll: { y: 0, viewport: 100, total: 100 },
    actionable: [
      { ref: 'e1', role: 'tab', text: '후기' },
      { ref: 'e2', role: 'button', text: '공지 펼치기' },
      { ref: 'e3', role: 'link', text: '자세히 보기', href: 'http://127.0.0.1:9999/자세히' },
      { ref: 'e4', role: 'button', text: '펼침', expanded: 'false' },
      ...Array.from({ length: 20 }, (_, i) => ({ ref: `x${i}`, role: 'link', text: `링크${i}` })),
    ],
  };
  const facts = observationFacts(view);
  const kinds = Object.fromEntries(facts.canOpen.map((c) => [c.ref, c.kind]));
  assert.equal(kinds.e1, 'tab');
  assert.equal(kinds.e2, 'button');
  assert.equal(kinds.e3, 'link');
  assert.equal(kinds.e4, 'expander');
  assert.equal(facts.canOpen.length, 12, '상한 12 는 이 슬라이스에서 안 바꾼다(슬라이스 ② 몫)');
});

test('전달: 외부 링크는 canOpen과 분리된 blockedOpen 사실로 실린다', () => {
  const facts = observationFacts({
    url: `${ORIGIN}/`, title: '판', text: '본문'.repeat(200), textTotal: 400,
    scroll: { y: 0, viewport: 100, total: 100 }, actionable: [],
    blockedOpen: [{ ref: 'e9', role: 'link', text: '다른 출처', reason: 'external_link', address: 'https://example.com/소식?token=숨김' }],
  });
  assert.deepEqual(facts.blockedOpen, [{ ref: 'e9', text: '다른 출처', reason: 'external_link', address: 'https://example.com/%EC%86%8C%EC%8B%9D' }]);
});

test('경계 영수증: 외부 링크는 이동 0 + 이유·주소·다음 수단 사실을 낸다', async () => {
  const act = makeBrowserActTool({ browser: {
    click: async () => ({ clicked: false, reason: 'external_link', boundary: {
      reason: 'external_link', address: 'https://example.com/소식',
      next: { kind: 'public_web_source', address: 'https://example.com/소식' },
    } }),
    profileKind: () => 'isolated',
  } });
  const r = await act.handler({ action: 'click', ref: 'e9' });
  assert.equal(r.blocked, true);
  assert.deepEqual(r.result.observation.boundary.next, { kind: 'public_web_source', address: 'https://example.com/소식' });
  assert.match(r.nextSafeAction, /공개 원문 주소/);
});

test('경계말: 술어가 거절한 클릭은 경계로 말한다 — 실패가 아니다', async () => {
  const act = makeBrowserActTool({
    browser: { click: async () => ({ clicked: false, reason: 'not_clickable' }), profileKind: () => 'isolated' },
  });
  const r = await act.handler({ action: 'click', ref: 'e9' });
  assert.equal(r.blocked, true);
  assert.match(r.userSafeSummary, /폼을 제출하거나 바깥 사이트로 나가는 걸음/);
  assert.ok(!r.failureState, '경계는 failureState 가 아니다');
});

test('경계말: 사라진 ref 는 사라졌다고 말한다(낡은 ref 경계 유지 — 반대시험 ㉱)', async () => {
  const act = makeBrowserActTool({
    browser: { click: async () => ({ clicked: false, reason: 'gone' }), profileKind: () => 'isolated' },
  });
  const r = await act.handler({ action: 'click', ref: '없는것' });
  assert.equal(r.blocked, true);
  assert.match(r.userSafeSummary, /화면에서 사라졌어요/);
});
