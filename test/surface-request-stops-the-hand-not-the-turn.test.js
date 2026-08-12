// **표면 요청은 그 손을 멈추지 턴의 목적을 멈추지 않는다** (콘솔 라이브 2026-08-12).
//
// 밟은 회차 — 「네이버에서 팔식당 검색해서 플레이스에 있는 후기 분석해줄 수 있어?」
//   원장 실측: 모델이 부른 손은 `connector.connect` **하나뿐**. 그것이 Client ID·Secret
//   입력면(`surfaceRequest`)을 요청하자 **턴이 그대로 닫혔고**, 답은 *"후기를 복사해서
//   붙여 주세요"* 였다. 그런데 공개 페이지를 읽는 데 자격은 필요 없고
//   `web.search`·`web.collect`·`browser.observe` 는 **한 번도 안 불렸다**.
//
// 옛 계약의 근거(2026-07-27 실측)는 *"비밀 입력창을 띄웠는데 모델이 그걸 실패로 보고 같은
// 손을 다시 골라 카드가 두 번 떴다"* 였고 **그 문장은 그대로 옳다** — 다만 그 손에 대해서만
// 참이다. 그래서 무는 자리를 손 단위로 옮긴다:
//   · 표면을 요청한 **그 손**은 이 턴에 다시 안 부른다(인자가 달라도)
//   · 안 써 본 손이 남아 있으면 **목적은 계속 쫓는다**
//   · 남은 손이 없으면 예전처럼 물러난다 — 그때는 정말로 사용자 차례다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// **선언된 손의 손잡이만 갈아 끼운다.** 선언에 없는 id 를 넣으면 커널이 「없는 손」으로
// 걸러 내고, 그러면 이 검사는 표면 요청이 아니라 **미선언**을 재게 된다(가짜 초록).
// 표면 요청 역은 `local.discovery`(선언돼 있고 읽기 손이라 등급이 안 흔들린다)가 맡는다.
const 표면손 = 'local.discovery';
const 읽는손 = 'web.search';

function 판(부른것, { 읽기손 = true } = {}) {
  const tools = demoTools({});
  tools.tools[표면손] = {
    id: 표면손,
    async handler(args) {
      부른것.push({ tool: 표면손, args });
      // **실물대로 낸다.** `surfaceRequest` 는 `blocked` 경로에서만 영수증에 실린다
      // (`tool-runner.js:183`) — 이걸 빼면 이 검사는 표면 요청이 아니라 평범한 성공을 재게 된다.
      return {
        blocked: true,
        surfaceRequest: { kind: 'secret_input', connector: 'naver', label: '네이버', fields: ['clientId'] },
        userSafeSummary: '네이버 연결에는 Client ID·Client Secret 가 필요해요.',
      };
    },
  };
  if (읽기손) {
    tools.tools[읽는손] = {
      id: 읽는손,
      async handler(args) {
        부른것.push({ tool: 읽는손, args });
        return {
          result: { candidates: [{ title: '팔식당', url: 'https://example.kr/8' }] },
          sources: [{ url: 'https://example.kr/8', title: '팔식당' }],
          userSafeSummary: '후보 1곳을 찾았어요.',
        };
      },
    };
  } else {
    delete tools.tools[읽는손];
  }
  return tools;
}

const 손목록 = (tools) => Object.keys(tools.tools);

function 문맥(tools, 응답들) {
  let i = 0;
  return {
    tools,
    env: demoEnv({ include: 손목록(tools), hands: 손목록(tools) }),
    model: {
      async respond() {
        const r = 응답들[Math.min(i, 응답들.length - 1)];
        i += 1;
        return typeof r === 'function' ? r() : r;
      },
    },
  };
}

test('표면을 요청해도 안 써 본 손이 남았으면 목적을 계속 쫓는다', async () => {
  const 부른것 = [];
  const tools = 판(부른것);
  const ctx = 문맥(tools, [
    { text: '', toolCalls: [{ name: 표면손, args: { subject: '네이버' } }] },
    { text: '', toolCalls: [{ name: 읽는손, args: { query: '팔식당' } }] },
    '팔식당 후보를 찾았어요.',
  ]);
  await runTurn({ text: '네이버에서 팔식당 후기 분석해줘' }, ctx);
  const 부른손 = 부른것.map((c) => c.tool);
  assert.ok(부른손.includes(읽는손),
    `**표면 요청 하나가 턴 전체를 멈췄다** — 부른 손: ${부른손.join(', ') || '(없음)'}`);
});

test('그 표면을 요청한 손은 같은 턴에 다시 안 부른다 — 카드 두 장 사고(2026-07-27)', async () => {
  const 부른것 = [];
  const tools = 판(부른것);
  const ctx = 문맥(tools, [
    { text: '', toolCalls: [{ name: 표면손, args: { subject: '네이버' } }] },
    // 모델이 같은 손을 인자만 바꿔 다시 고른다 — 옛 사고의 모양 그대로
    { text: '', toolCalls: [{ name: 표면손, args: { subject: 'naver 다시' } }] },
    '연결이 필요해요.',
  ]);
  await runTurn({ text: '네이버 붙여줘' }, ctx);
  const 연결부름 = 부른것.filter((c) => c.tool === 표면손).length;
  assert.equal(연결부름, 1, `**같은 손이 ${연결부름}번 불렸다** — 표면 요청 뒤 재호출이 열려 있다`);
});

test('갈 곳이 없으면 예전처럼 물러난다 — 그때는 정말로 사용자 차례다', async () => {
  const 부른것 = [];
  const tools = 판(부른것, { 읽기손: false });
  const ctx = 문맥(tools, [
    { text: '', toolCalls: [{ name: 표면손, args: { subject: '네이버' } }] },
    '연결이 필요해요.',
  ]);
  const r = await runTurn({ text: '네이버 붙여줘' }, ctx);
  assert.equal(부른것.length, 1, '남은 손이 없는데 더 불렀다');
  assert.ok(r, '턴이 닫히지 않았다');
});
