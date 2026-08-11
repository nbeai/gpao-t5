// **채점기의 자도 검사를 받는다** — 오늘 이 자가 두 번 틀렸다(2026-08-11).
//
// 계측기가 틀리면 표가 거짓말을 하고, 그 표로 수리 방향을 정하면 하루가 탄다.
// 여기 붙인 셋은 **실제 유료 회차의 손기록**이다(지어낸 대본이 아니다):
//
//   ㉠ 느슨했던 자   *"네이버 지목 + 아무거나 읽음"* → **첫 화면만 열어도 통과**했다(오너 지적)
//   ㉡ 조였다가 거짓 실패  *"검색 걸음 **뒤에** 읽기"* → 한 걸음이 검색이자 읽기인 회차를 ✕ 로 찍었다.
//                    그리고 `search.naver` 를 문자열로만 봐서 `www.naver.com/search.naver?…`
//                    (메인으로 리다이렉트된 **틀린 주소**)를 검색으로 세었다
//   ㉢ 지금 자      *"검색 결과를 실제로 읽은 성공한 걸음이 있는가"* 하나로 세운다
//
// 이 파일이 재는 것은 제품이 아니라 **자**다. 자가 흔들리면 여기서 먼저 빨개진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 문장표 } from '../scripts/live/organ-round.mjs';

const 네이버줄 = 문장표.find((x) => x.칸 === '칸4 자력완결');
const 판정 = (손기록) => 네이버줄.판정({ 손기록, 답: '' });

// 실측 t5-organ-10dRSB · luHUPY — 모델이 **주소를 잘못 지었다**(호스트가 www.naver.com).
// 실제로는 통합검색이 아니라 메인이 떴고, 답도 그렇게 말했다.
const 틀린주소 = [
  { tool: 'browser.observe', args: { action: 'open', url: 'https://www.naver.com/search.naver?query=%EC%A0%84%EC%84%B8%EC%82%AC%EA%B8%B0' } },
  { tool: 'browser.act', args: { action: 'scroll', times: 3 } },
];
// 실측 t5-organ-O3QoMu — 한 걸음(`web.collect`)이 **검색이자 읽기**였다.
const 한걸음에검색과읽기 = [
  { tool: 'browser.observe', args: { action: 'open', url: 'https://www.naver.com' } },
  { tool: 'browser.act', args: { action: 'click', ref: 'e28' } },
  { tool: 'web.collect', args: { request: 'https://search.naver.com/search.naver?query=%EC%A0%84%EC%84%B8%EC%82%AC%EA%B8%B0', selectionGoal: 'latest_evidence' } },
];
// 첫 화면만 열고 끝 — 느슨했던 자가 통과시키던 그 모양.
const 첫화면만 = [
  { tool: 'browser.observe', args: { action: 'open', url: 'https://www.naver.com' } },
  { tool: 'desktop.screen', args: { action: 'observe' } },
];

test('첫 화면만 열면 안 통과한다 — 사용자 문장은 "검색 결과 알려줘"다', async () => {
  assert.equal((await 판정(첫화면만)).통과, false, '느슨한 자가 되살아났다');
});

test('틀린 주소로 메인이 뜬 것은 검색이 아니다 — 경로 문자열이 아니라 호스트로 본다', async () => {
  const v = await 판정(틀린주소);
  assert.equal(v.통과, false,
    `**www.naver.com/search.naver 를 검색으로 셌다** — 실제로는 메인이 떴다: ${v.사실}`);
});

test('한 걸음이 검색이자 읽기여도 통과한다 — 거짓 실패를 만들지 않는다', async () => {
  const v = await 판정(한걸음에검색과읽기);
  assert.equal(v.통과, true,
    `**되는 것을 실패로 찍었다**(계측기 결함) — web.collect 가 검색 결과를 직접 읽었다: ${v.사실}`);
});

test('화면 손으로 치고 읽은 길도 통과한다 — 손의 종류는 안 묻는다', async () => {
  // 실크롬을 켜고 주소창에 naver 를 치고, 검색창에 질의어를 치고, 화면을 읽는 길.
  // 이 길에는 주소가 영수증 인자에 안 실린다 — 그래서 ㉯ 갈래가 따로 있다.
  const v = await 판정([
    { tool: 'desktop.act', args: { action: 'launch', app: 'Google Chrome' } },
    { tool: 'desktop.act', args: { action: 'type', 대상: { label: '주소창' }, 값: 'naver.com' } },
    { tool: 'desktop.act', args: { action: 'type', 대상: { label: '검색창' }, 값: '전세사기' } },
    { tool: 'desktop.act', args: { action: 'press_key', 값: 'return' } },
    { tool: 'desktop.screen', args: { action: 'observe' } },
  ]);
  assert.equal(v.통과, true, `브라우저 손만 통과시키면 PM 오류(2026-08-11)가 되살아난다: ${v.사실}`);
});

test('치기만 하고 안 읽으면 안 통과한다 — "알려줘"가 안 닫힌다', async () => {
  const v = await 판정([
    { tool: 'desktop.act', args: { action: 'type', 대상: { label: '검색창' }, 값: '전세사기' } },
  ]);
  assert.equal(v.통과, false, v.사실);
});

test('막힌 걸음은 세지 않는다 — 실패한 읽기를 읽음으로 적지 않는다', async () => {
  const v = await 판정([
    { tool: 'web.collect', failureState: 'blocked', args: { request: 'https://search.naver.com/search.naver?query=x' } },
  ]);
  assert.equal(v.통과, false, v.사실);
});
