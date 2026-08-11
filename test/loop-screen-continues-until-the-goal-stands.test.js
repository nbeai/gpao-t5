// **화면·브라우저 과업도 한 턴 안에서 이어 간다** (P6-L 세 번째 조항 · 2026-08-11).
//
// 루프는 이미 있다(`turn.js` P6-L). 상한(`MAX_TOOL_STEPS=6`)도 남아돈다. **없는 것은 발동
// 조건**이다 — 산출물이어가기는 `plan.deliverables` 미충족일 때만, 후보이어가기는 `local.locate`
// 후보를 안 열었을 때만 연다. 화면·브라우저에는 해당 조항이 없어서 **한 걸음 뒤 그대로 끝났다.**
//
// 실측(실기기 채점기 2026-08-11 · 통과 1/3):
//   ✕ "카카오톡 창을 앞으로 띄워줘"  손 0회 · `desktop.screen:status desktop.act:focus` · 기준자 Claude
//   ✕ "네이버 열어서 전세사기 검색"   손 0회 · `browser.observe:open browser.act:scroll` · 기준자 chrome://newtab/
// 938턴 걸음 **중앙값 2** 의 얼굴이 이것이다. 드라이버는 카톡 창 후보 둘을 정확히 냈는데
// 모델은 *"창이 여러 개라 모르겠어요"* 로 끝냈다 — 손이 없어서가 아니라 **한 번밖에 못 써서다.**
//
// 계약(기존 두 조항과 같은 모양 · **손만 안 좁힌다** — PM 추가 조항 2026-08-11):
//   · 강제하지 않는다 — `requiredTool` 없이 **원장의 사실만** 주고 고르는 것은 모델에 남긴다
//   · 한 턴에 한 번 · 예산·상한을 그대로 탄다
//   · **같은 지문의 실행만 남으면 멈춘다**(같은 `bulk_move` 를 여덟 번 낸 실측이 있다)
//   · 여는 것은 원장의 기계 사실 둘 — ① 회복 안 된 막힌 걸음 ② 손을 쓰고도 빈손(심문·약속)
//     으로 끝나는 답. 그리고 **안 써 본 손이 남았을 때만** 연다(갈 곳이 없으면 안 연다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoContext } from '../src/surface/demo-context.js';

/** 창이 여럿이라 한 번은 막히고, 창을 좁혀 주면 목표가 서는 손. */
function 창여럿인손() {
  const 부른것 = [];
  return {
    부른것,
    async handler(args = {}) {
      부른것.push(args);
      if (!args.창제목) {
        return {
          blocked: true,
          userSafeSummary: '그 앱 창이 여러 개라 어느 것을 앞으로 띄울지 알 수 없어요.',
          다음수단: [
            { 방법: 'focus', window: 14963, 왜: '카카오톡 · 박종윤' },
            { 방법: 'focus', window: 14960, 왜: '카카오톡 · 카카오톡' },
          ],
        };
      }
      return {
        result: { 단계: 'goal_verified', 행동: 'focus', 확인방법: '드라이버 확인(front)' },
        userSafeSummary: '카카오톡 을(를) 앞으로 띄웠어요.',
      };
    },
  };
}

const 브라우저연결 = { 'browser.observe': { connected: true }, 'browser.act': { connected: true } };

const 계약답 = { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };

test('막힌 채 끝나지 않는다 — 후보를 받은 화면 걸음은 한 턴 안에서 이어 걷는다', async () => {
  const 손 = 창여럿인손();
  const 받은 = [];
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return 계약답;
      받은.push(tc);
      if (!손.부른것.length) {
        return { text: '', toolCalls: [{ providerCallId: 'c1', name: 'desktop.act', args: { action: 'focus', app: 'KakaoTalk' } }] };
      }
      // 원장 사실을 받으면 후보 하나를 골라 이어 간다(고르는 것은 모델의 몫이다).
      if (tc?.goalNotReached) {
        return { text: '', toolCalls: [{ providerCallId: 'c2', name: 'desktop.act', args: { action: 'focus', app: 'KakaoTalk', 창제목: '박종윤' } }] };
      }
      if (손.부른것.length >= 2) return { text: '카카오톡 창을 앞으로 띄웠어요.' };
      // **여기가 지금의 병이다** — 막힌 자리에서 말로 끝낸다.
      return { text: '카카오톡 창이 여러 개라 어느 것을 띄울지 알 수 없어요.' };
    },
  };
  const ctx = demoContext({ desktopAct: 손 });
  const r = await runTurn({ text: '카카오톡 창을 앞으로 띄워줘.' }, { ...ctx, model });

  assert.ok(받은.some((tc) => tc?.goalNotReached),
    '**화면 걸음이 막힌 채 끝났는데 되부름이 없다** — 모델은 후보를 손에 쥐고도 못 걷는다');
  assert.equal(손.부른것.length, 2,
    `**손이 한 번밖에 안 나갔다** — 938턴 걸음 중앙값 2 의 그 자리다: ${JSON.stringify(손.부른것)}`);
  assert.match(String(r.reply ?? ''), /띄웠어요/,
    `이어 걷고도 답이 안 바뀌었다: ${r.reply}`);
});

test('같은 지문의 실행만 남으면 멈춘다 — 밀어붙이는 것이 진전을 만들지 않는다', async () => {
  const 손 = 창여럿인손();
  const 같은호출 = { providerCallId: 'c1', name: 'desktop.act', args: { action: 'focus', app: 'KakaoTalk' } };
  let 되부름 = 0;
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return 계약답;
      if (tc?.goalNotReached) { 되부름 += 1; return { text: '', toolCalls: [같은호출] }; }
      if (!손.부른것.length) return { text: '', toolCalls: [같은호출] };
      return { text: '카카오톡 창이 여러 개라 어느 것을 띄울지 알 수 없어요.' };
    },
  };
  const r = await runTurn({ text: '카카오톡 창을 앞으로 띄워줘.' }, { ...demoContext({ desktopAct: 손 }), model });
  assert.equal(되부름, 1, '한 턴에 한 번을 넘겼다 — 왕복이 그냥 탄다');
  assert.equal(손.부른것.length, 1,
    `**같은 지문을 다시 실행했다** — 제자리를 돈다: ${JSON.stringify(손.부른것)}`);
  assert.ok(String(r.reply ?? '').trim(), '멈추면서 답까지 잃었다');
});

test('반대시험: 목표가 선 턴에는 안 문다 — 된 일을 다시 하지 않는다', async () => {
  const 부른것 = [];
  const 되는손 = {
    async handler(args = {}) {
      부른것.push(args);
      return { result: { 단계: 'goal_verified', 행동: 'focus' }, userSafeSummary: '앞으로 띄웠어요.' };
    },
  };
  const 받은 = [];
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return 계약답;
      받은.push(tc);
      if (!부른것.length) return { text: '', toolCalls: [{ providerCallId: 'c1', name: 'desktop.act', args: { action: 'focus', app: 'Chrome' } }] };
      return { text: '크롬 창을 앞으로 띄웠어요.' };
    },
  };
  await runTurn({ text: '크롬 창을 앞으로 띄워줘.' }, { ...demoContext({ desktopAct: 되는손 }), model });
  assert.ok(!받은.some((tc) => tc?.goalNotReached),
    '목표가 섰는데 되부름이 돌았다 — 없는 공백을 지어내고 왕복을 태운다');
  assert.equal(부른것.length, 1, '된 일을 다시 했다');
});

test('반대시험: 화면 손을 안 쓴 턴은 조용하다', async () => {
  const 받은 = [];
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return 계약답;
      받은.push(tc);
      return { text: '요즘 많이 힘드셨겠어요. 어떻게 도와드릴까요?' };
    },
  };
  await runTurn({ text: '요즘 가게가 너무 힘들다' }, { ...demoContext({}), model });
  assert.ok(!받은.some((tc) => tc?.goalNotReached), '화면 손을 한 번도 안 쓴 턴에 그물이 물었다');
});

// ── 브라우저: **보기만 하고 약속으로 끝나지 않는다** ────────────────────────────
// 실측의 두 번째 줄이다 — `browser.observe:open` 한 번 하고 *"바로 검색해 볼게요"* 로 끝났다.
test('보기만 하고 약속으로 끝나면 사실을 주고 한 번 되부른다', async () => {
  const 부른것 = [];
  const observe = {
    sourceLedgerRequired: false,
    async handler(args = {}) {
      부른것.push(['observe', args]);
      return {
        result: { title: '네이버', markdown: '네이버 첫 화면', observation: { url: 'https://naver.com' } },
        userSafeSummary: '화면으로 확인했어요: 네이버.',
      };
    },
  };
  const act = {
    sourceLedgerRequired: false,
    async handler(args = {}) { 부른것.push(['act', args]); return { result: { 단계: 'goal_verified', markdown: '전세사기 검색 결과' }, userSafeSummary: '눌렀어요.' }; },
  };
  const 받은 = [];
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return 계약답;
      받은.push(tc);
      if (!부른것.length) return { text: '', toolCalls: [{ providerCallId: 'b1', name: 'browser.observe', args: { action: 'open', url: 'https://naver.com' } }] };
      if (tc?.goalNotReached) return { text: '', toolCalls: [{ providerCallId: 'b2', name: 'browser.act', args: { action: 'click', ref: 'r1' } }] };
      if (부른것.length >= 2) return { text: '전세사기 검색 결과를 가져왔어요.' };
      return { text: '네이버를 열었어요. 이어서 전세사기를 검색해 볼게요.' };
    },
  };
  const r = await runTurn({ text: '네이버 열어서 전세사기 검색 결과 알려줘.' }, {
    ...demoContext({ browserObserve: observe, browserAct: act, factOverrides: 브라우저연결 }), model,
  });
  assert.ok(받은.some((tc) => tc?.goalNotReached),
    '**보기만 하고 약속으로 끝났는데 되부름이 없다** — 약속이 완료를 대신한다');
  assert.equal(부른것.length, 2, `브라우저 손이 한 번밖에 안 나갔다: ${JSON.stringify(부른것)}`);
  assert.match(String(r.reply ?? ''), /가져왔어요/);
});

test('반대시험: 보고 나서 내용으로 답하면 안 문다 — 정상 관찰 턴에 왕복을 안 태운다', async () => {
  const 부른것 = [];
  const observe = {
    sourceLedgerRequired: false,
    async handler(args = {}) {
      부른것.push(args);
      return { result: { title: '네이버', markdown: '전세사기 특별법 관련 기사 다섯 건' }, userSafeSummary: '화면으로 확인했어요: 네이버.' };
    },
  };
  const 받은 = [];
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return 계약답;
      받은.push(tc);
      if (!부른것.length) return { text: '', toolCalls: [{ providerCallId: 'b1', name: 'browser.observe', args: { action: 'open', url: 'https://naver.com' } }] };
      return { text: '전세사기 특별법 관련 기사 다섯 건이 올라와 있어요.' };
    },
  };
  await runTurn({ text: '네이버 열어서 전세사기 검색 결과 알려줘.' }, {
    ...demoContext({ browserObserve: observe, factOverrides: 브라우저연결 }), model,
  });
  assert.ok(!받은.some((tc) => tc?.goalNotReached),
    '내용으로 답한 정상 관찰 턴에 그물이 물었다 — 사용자가 그 왕복을 기다린다');
  assert.equal(부른것.length, 1);
});
