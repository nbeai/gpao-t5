// **약속으로 턴을 닫지 않는다** — 되부름의 넛지 축 (오픈북 2026-08-12).
//
// 밟은 회차(콘솔 라이브): 「네이버에서 팔식당 검색해서 플레이스 후기 분석해줄 수 있어?」
//   `connector.connect` 가 표면을 요청 → 되부름이 돌고 `goalNotReached` 사실이 **두 번** 갔다.
//   그런데 모델은 손을 안 고르고 *"흐름은 이렇게 잡을게요 … 분석해 드릴게요."* 라는
//   **계획**으로 턴을 닫았다. 사실은 갔는데 행동이 안 났다.
//
// 오픈북 — 비교군은 같은 자리에서 셋을 더 한다:
//   ① 넛지를 **user 역할 메시지**로 넣는다(`conversation_loop.py:7182-7185`)
//   ② 문장이 지시다 — *"do not narrate intent"* · *"Never end a turn with only a
//      promise of future action."*(`kanban_stop.py:96-100`)
//   ③ 횟수로 묶는다(`max_attempts 2`) — 우리는 `이어가기상한` 이 그 자리다
//
// 이 검사가 무는 것은 **넛지가 실제로 모델 앞에 서는가** 하나다. 무엇을 고를지는 여전히
// 모델의 몫이라 「반드시 손을 부른다」를 재지 않는다 — 그건 대본이지 운전이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

function 판() {
  const tools = demoTools({});
  tools.tools['local.discovery'] = {
    id: 'local.discovery',
    async handler() {
      return {
        blocked: true,
        surfaceRequest: { kind: 'secret_input', connector: 'naver' },
        userSafeSummary: '네이버 연결에는 키가 필요해요.',
      };
    },
  };
  tools.tools['web.search'] = {
    id: 'web.search',
    async handler() {
      return {
        result: { 후보: [{ 순위: 1, title: '팔식당', url: 'https://m.place.naver.com/x' }] },
        sources: [{ url: 'https://m.place.naver.com/x', title: '팔식당' }],
        userSafeSummary: '1곳 찾았어요.',
      };
    },
  };
  return tools;
}

function 문맥(tools, 응답들, 본것) {
  let i = 0;
  const ids = Object.keys(tools.tools);
  return {
    tools,
    env: demoEnv({ include: ids, hands: ids }),
    model: {
      async respond(tc) {
        본것.push({
          미달: Object.keys(tc).filter((k) => ['goalNotReached', 'candidatesUnopened', 'searchNotExhausted'].includes(k)),
          마지막이력: (tc.recentTurns ?? []).slice(-1)[0] ?? null,
        });
        const r = 응답들[Math.min(i, 응답들.length - 1)];
        i += 1;
        return r;
      },
    },
  };
}

test('계획으로 닫으려 하면 되부름이 user 역할로 계약을 말한다', async () => {
  const 본것 = [];
  const tools = 판();
  await runTurn({ text: '네이버에서 팔식당 후기 분석해줘' }, 문맥(tools, [
    { text: '', toolCalls: [{ name: 'local.discovery', args: { subject: '네이버' } }] },
    '흐름은 이렇게 잡을게요. 분석해 드릴게요.',
  ], 본것));

  const 넛지 = 본것.find((v) => v.마지막이력?.role === 'user'
    && /예고|손을 부르거나/.test(String(v.마지막이력?.text ?? '')));
  assert.ok(넛지, `**되부름이 계약을 말하지 않았다** — 호출별 마지막 이력: ${
    JSON.stringify(본것.map((v) => v.마지막이력?.text?.slice(0, 30) ?? null))}`);
  assert.ok(넛지.미달.length, '넛지만 가고 원장 사실이 안 갔다 — 지시가 사실을 대신하면 안 된다');
});

test('목적에 닿은 턴에는 넛지가 안 붙는다 — 잔소리를 늘리지 않는다', async () => {
  const 본것 = [];
  const tools = 판();
  await runTurn({ text: '팔식당 찾아줘' }, 문맥(tools, [
    { text: '', toolCalls: [{ name: 'web.search', args: { query: '팔식당' } }] },
    { text: '', toolCalls: [{ name: 'web.collect', args: { url: 'https://m.place.naver.com/x' } }] },
    '팔식당 후기를 정리했어요. 맛 칭찬이 많아요.',
  ], 본것));
  const 넛지수 = 본것.filter((v) => /예고|손을 부르거나/.test(String(v.마지막이력?.text ?? ''))).length;
  assert.ok(넛지수 <= 1, `목적에 닿았는데 넛지가 ${넛지수}번 붙었다`);
});
