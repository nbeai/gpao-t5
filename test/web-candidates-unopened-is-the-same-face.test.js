// **찾는 손은 파일 쪽만이 아니다** (콘솔 라이브 2026-08-12).
//
// 밟은 회차 — 「네이버에서 팔식당 검색해서 플레이스에 있는 후기 분석해줄 수 있어?」
//   원장 실측(수리 뒤 2회차): `web.search`(후보 8) → `browser.observe(open place.naver.com)`.
//   후보 여덟을 받아 놓고 **한 곳도 안 열고 주소를 지어내** 열었다가 DNS 오류를 만났고,
//   답은 *"플레이스 후기를 복붙해 주세요"* 였다.
//
// 「자리를 찾는 일(파일)」과 「곳을 찾는 일(웹)」은 같은 얼굴인데, 목적미달 탐지기 ②가
// `local.locate` 만 보고 있었다. 손 이름으로 가르면 같은 병이 손 수만큼 되살아난다 —
// 오너 지시(2026-08-12): *"운전법이 아니라 경우의 수가 된다."*
//
// 「열었나」도 같은 결로 넓힌다: **후보가 가리키는 그 곳**을 실제로 불렀어야 연 것이다.
// 아무 주소나 연 것은 후보를 연 것이 아니다 — 지어낸 주소가 정확히 그 자리다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 후보들 = [
  { 순위: 1, title: '팔식당 청담', url: 'https://m.place.naver.com/restaurant/1747125291/home' },
  { 순위: 2, title: '팔식당 블로그 후기', url: 'https://blog.example.kr/8' },
];

function 판(부른것, { 열주소 } = {}) {
  const tools = demoTools({});
  tools.tools['web.search'] = {
    id: 'web.search',
    async handler(args) {
      부른것.push({ tool: 'web.search', args });
      return {
        result: { 후보: 후보들, 읽은상태: '후보만' },
        sources: [{ url: 후보들[0].url, title: 후보들[0].title }],
        userSafeSummary: `'${args.query}' 로 ${후보들.length}곳을 찾았어요. 아직 열어 보지는 않았어요`,
      };
    },
  };
  tools.tools['web.collect'] = {
    id: 'web.collect',
    async handler(args) {
      부른것.push({ tool: 'web.collect', args });
      return {
        result: { url: args.url, markdown: '후기 본문…' },
        sources: [{ url: args.url, title: '팔식당' }],
        userSafeSummary: '읽었어요.',
      };
    },
  };
  return { tools, 열주소 };
}

function 문맥(tools, 응답들) {
  let i = 0;
  const ids = Object.keys(tools.tools);
  return {
    tools,
    env: demoEnv({ include: ids, hands: ids }),
    model: { async respond() { const r = 응답들[Math.min(i, 응답들.length - 1)]; i += 1; return r; } },
  };
}

test('웹 후보를 받아 놓고 한 곳도 안 열면 목적에 안 닿은 것이다 — 되부른다', async () => {
  const 부른것 = [];
  const { tools } = 판(부른것);
  const ctx = 문맥(tools, [
    { text: '', toolCalls: [{ name: 'web.search', args: { query: '팔식당 네이버 플레이스' } }] },
    // 라이브에서 실제로 일어난 모양: 후보를 안 열고 **주소를 지어내** 연다
    { text: '', toolCalls: [{ name: 'web.collect', args: { url: 'https://place.naver.com' } }] },
    { text: '플레이스 후기를 복붙해 주시겠어요?', toolCalls: [] },
    { text: '', toolCalls: [{ name: 'web.collect', args: { url: 후보들[0].url } }] },
    '팔식당 후기를 정리했어요.',
  ]);
  await runTurn({ text: '팔식당 플레이스 후기 분석해줘' }, ctx);
  const 연주소 = 부른것.filter((c) => c.tool === 'web.collect').map((c) => c.args.url);
  assert.ok(연주소.includes(후보들[0].url),
    `**후보를 쥐고 안 열었는데 턴이 닫혔다** — 연 주소: ${연주소.join(', ') || '(없음)'}`);
});

test('후보의 그 곳을 실제로 열었으면 더 안 되부른다 — 그물이 안 넓어졌다', async () => {
  const 부른것 = [];
  const { tools } = 판(부른것);
  const ctx = 문맥(tools, [
    { text: '', toolCalls: [{ name: 'web.search', args: { query: '팔식당' } }] },
    { text: '', toolCalls: [{ name: 'web.collect', args: { url: 후보들[0].url } }] },
    '팔식당 후기를 정리했어요. 맛 칭찬이 많고 대기가 길다는 말이 반복돼요.',
  ]);
  await runTurn({ text: '팔식당 후기 분석해줘' }, ctx);
  const 연횟수 = 부른것.filter((c) => c.tool === 'web.collect').length;
  assert.equal(연횟수, 1, `후보를 열었는데 ${연횟수}번 더 돌았다 — 되부름이 과하다`);
});

test('지어낸 주소를 연 것은 후보를 연 것이 아니다', async () => {
  const 부른것 = [];
  const { tools } = 판(부른것);
  const ctx = 문맥(tools, [
    { text: '', toolCalls: [{ name: 'web.search', args: { query: '팔식당' } }] },
    { text: '', toolCalls: [{ name: 'web.collect', args: { url: 'https://place.naver.com' } }] },
    { text: '못 열었어요. 복붙해 주세요?', toolCalls: [] },
    { text: '', toolCalls: [{ name: 'web.collect', args: { url: 후보들[1].url } }] },
    '다른 후보에서 후기를 찾았어요.',
  ]);
  await runTurn({ text: '팔식당 후기 분석해줘' }, ctx);
  const 연주소 = 부른것.filter((c) => c.tool === 'web.collect').map((c) => c.args.url);
  assert.ok(연주소.length >= 2 && 연주소.some((u) => 후보들.some((c) => c.url === u)),
    `지어낸 주소 하나로 「열었다」가 서 버렸다 — 연 주소: ${연주소.join(', ')}`);
});
