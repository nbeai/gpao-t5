// **후보는 손 하나가 아니라 턴이 갖는다.**
//
// 라이브(내가 직접 돌림 2026-08-05 · 같은 문장 5턴): `web.collect` 가 4번 막혔고
// **네 번 다 `다른후보` 가 0개**였다. 계약은 지켜졌다 — 그 네 번은 모델이 **주소를 직접 넣어**
// 부른 호출이라 검색 이력이 없었고, *"검색을 안 했으면 후보를 지어내지 않는다"* 가 맞게 돌았다.
//
// **그런데 바로 그 턴에 `web.search` 가 후보 8개를 이미 받아 놓고 있었다.**
// 계약은 관통했고 목적은 안 지켜졌다. 후보가 **호출 단위로만 살아서** 그렇다 —
// 찾은 손과 막힌 손이 남남이라, 왼손이 쥔 것을 오른손이 못 쓴다.
//
// 그래서 자리를 옮긴다. 후보는 **이번 턴이 가진 사실**이고, 막힌 영수증은 그 자리로 돌아간다.
//
// ── 이것이 심문이 아닌 이유 ──────────────────────────────────────────────
// 커널은 **어느 후보가 좋은지 정하지 않는다.** 이미 이 턴에서 실제로 받아 둔 목록을,
// 이미 열어 본 곳만 빼고, 그대로 옆에 놓아 준다. 판단은 모델이 한다(§1.2 · 절대원칙 8).
// 없는 것을 만들어 주지도 않는다 — 검색을 안 한 턴에는 아무것도 안 붙는다(아래 반대시험).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const intent = { currentRequest: '오늘 한국 증시 상황 알려줘', answerMode: 'complex_work' };
const 자기상태 = () => buildSelfState(demoEnv());
const 짜기 = (receipts) => buildTaskContext({ intent, selfState: 자기상태(), receipts });

/** 라이브 그대로: 찾는 손이 후보 여덟을 받았다. */
const 찾음 = {
  intended: '증시 확인', failureState: 'none', userSafeSummary: '8곳을 찾았어요.',
  actualCall: { tool: 'web.search', args: { query: '코스피 지수' }, providerCallId: 'call_S' },
  읽은상태: '후보만',
  result: {
    검색어: '코스피 지수', provider: '덕덕고', 읽은상태: '후보만',
    후보: [
      { 순위: 1, title: '네이버 금융', url: 'https://finance.naver.com/sise/', snippet: '' },
      { 순위: 2, title: '인베스팅닷컴 코스피', url: 'https://kr.investing.com/indices/kospi', snippet: '' },
      { 순위: 3, title: '한국거래소', url: 'https://www.krx.co.kr/idx', snippet: '' },
      { 순위: 4, title: '구글 파이낸스', url: 'https://google.example/finance/KOSPI', snippet: '' },
    ],
  },
};

/** 라이브 그대로: 모델이 **주소를 직접 넣어** 불렀고 막혔다 — 그래서 검색 이력이 없다. */
const 막힘 = {
  intended: '증시 확인', failureState: 'blocked',
  userSafeSummary: '그 사이트가 접근을 막고 있어요.',
  nextSafeAction: '다른 자료로 다시 찾아볼까요?',
  actualCall: { tool: 'web.collect', args: { request: 'https://kr.investing.com/indices/kospi' }, providerCallId: 'call_B' },
  다음수단: [{ 방법: 'search', 왜: '다른 자료로 검색을 다시 한다' }],
  막힌곳: [{ url: 'https://kr.investing.com/indices/kospi', fetchState: 'blocked' }],
};

test('막힌 읽기가 같은 턴의 검색 후보로 돌아간다', () => {
  const tc = 짜기([찾음, 막힘]);
  const x = tc.turnExchange.find((e) => e.providerCallId === 'call_B');
  assert.ok(x, '막힌 호출이 교환에 없다');
  assert.ok(x.다른후보?.length, '턴이 후보 넷을 쥐고 있는데 막힌 손에는 0개가 갔다 — 라이브에서 4/4 로 난 자리');
  const 준주소 = x.다른후보.map((c) => c.url);
  assert.ok(준주소.includes('https://google.example/finance/KOSPI'));
  assert.ok(준주소.includes('https://www.krx.co.kr/idx'));
  assert.ok(x.다음수단.some((m) => m.방법 === 'read_url'), '부를 수 있는 수로 와야 한다 — 목록만으로는 못 간다');
});

test('방금 막힌 그 주소는 다시 권하지 않는다', () => {
  const tc = 짜기([찾음, 막힘]);
  const x = tc.turnExchange.find((e) => e.providerCallId === 'call_B');
  assert.ok(!x.다른후보.some((c) => c.url === 'https://kr.investing.com/indices/kospi'),
    '같은 벽으로 두 번 보내는 것은 다음 수가 아니다');
});

test('이미 읽은 곳도 다시 권하지 않는다', () => {
  const 읽음 = {
    intended: '증시 확인', failureState: 'none', userSafeSummary: '공개 자료로 확인했어요.',
    actualCall: { tool: 'web.collect', args: { request: 'https://finance.naver.com/sise/' }, providerCallId: 'call_R' },
    sources: [{ sourceUrl: 'https://finance.naver.com/sise/', title: '네이버 금융' }],
    result: { title: '네이버 금융', markdown: '코스피 6,358.95' },
  };
  const tc = 짜기([찾음, 읽음, 막힘]);
  const x = tc.turnExchange.find((e) => e.providerCallId === 'call_B');
  assert.ok(!x.다른후보.some((c) => c.url === 'https://finance.naver.com/sise/'),
    '방금 읽은 곳을 "다음에 읽어 볼 곳"으로 내밀었다');
});

// ── 반대시험 둘: 없는 것을 만들지 않는다 · 있는 것을 덮지 않는다 ─────────────
test('턴에 후보가 없으면 아무것도 지어내지 않는다', () => {
  const tc = 짜기([막힘]);
  const x = tc.turnExchange.find((e) => e.providerCallId === 'call_B');
  assert.equal(x.다른후보, undefined, '검색을 한 적이 없는데 후보가 생겼다');
  assert.ok(x.다음수단?.some((m) => m.방법 === 'search'), '그래도 길은 남아야 한다');
});

test('손이 스스로 후보를 실었으면 그것을 덮지 않는다', () => {
  const 손이쥔것 = {
    ...막힘,
    다른후보: [{ title: '손이 직접 고른 곳', url: 'https://hand.example/pick' }],
    다음수단: [{ 방법: 'read_url', url: 'https://hand.example/pick', 왜: '검색에서 같이 나온 곳' }],
  };
  const tc = 짜기([찾음, 손이쥔것]);
  const x = tc.turnExchange.find((e) => e.providerCallId === 'call_B');
  assert.deepEqual(x.다른후보.map((c) => c.url), ['https://hand.example/pick'],
    '손이 직접 쥔 사실을 커널이 갈아치웠다 — 커널은 빈 자리를 메울 뿐이다');
});

test('성공한 읽기에는 손대지 않는다 — 막힌 자리만 메운다', () => {
  const 읽음 = {
    intended: '증시 확인', failureState: 'none', userSafeSummary: '공개 자료로 확인했어요.',
    actualCall: { tool: 'web.collect', args: { request: 'https://tokti.example/report' }, providerCallId: 'call_OK' },
    sources: [{ sourceUrl: 'https://tokti.example/report', title: '리포트' }],
    result: { title: '리포트', markdown: '코스피 6,358.95' },
  };
  const tc = 짜기([찾음, 읽음]);
  const x = tc.turnExchange.find((e) => e.providerCallId === 'call_OK');
  assert.equal(x.다른후보, undefined, '성공한 읽기의 재료는 손이 만든 그대로여야 한다');
  assert.ok(x.data, '성공한 호출은 내용이 간다(이 계약은 그대로다)');
});
