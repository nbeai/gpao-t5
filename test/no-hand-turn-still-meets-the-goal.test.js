// **손을 하나도 안 쓴 턴도 목적을 잰다** — F-83 (콘솔 라이브 실측 2026-08-12).
//
// 밟은 회차: *"내 컴퓨터에 엑셀 파일 있어? 찾아서 어디 있는지 알려줘."* → **손 0건** ·
// 답 *"이 컴퓨터 파일 시스템에 직접 접근 권한이 없는 상태라서…"* 였다. 프롬프트에는
// `local.file`·`local.locate` 가 실려 있었다. 같은 문장의 직전 회차는 손 3건으로 됐다.
//
// 왜 아무도 안 물었나 — 사슬 3단(재현으로 확인):
//   ① 목적미달 ④ 가 `if (부른것들.length)` 를 전제로 돌아 손 0건이면 갈래가 안 선다
//   ② 손을 안 고른 턴은 빠른 경로로 빠져 `executePlan` 에 안 들어간다(고리가 거기 산다)
//   ③ 빠른 경로를 우회시켜도 걸음이 0이면 호출 ⑧이 안 돌아 `finalOut` 이 비고,
//      목적미달의 `답글원문` 이 빈 문자열이 된다 → 어떤 갈래도 안 문다
//
// 오픈북 — 비교군은 **답이 나가기 직전**에 원장을 본다:
//   · 헤르메스 `kanban_stop.py:88-101` — 종결 도구가 원장에 없으면 완성된 답을 억누르고
//     손을 쥔 채 루프로 되돌린다. *"Never end a turn with only a promise of future action."*
//   · 헤르메스 `conversation_loop.py:7196-7205` — `final_response = None; continue` 로
//     **완성된 답을 버리고** 넛지를 user 역할로 넣는다
//   · 오픈클로 `docs/concepts/agent-loop.md:96` — `before_agent_reply` 가 답이 나가기 전 자리
//   · 클로드코드: 도구 목록이 곧 능력이다 — 손을 쥐고 "권한이 없다"고 말하지 않는다
//
// 이 검사가 무는 것은 **목적미달이 서고 손 전량이 다시 모델 앞에 서는가**다. 무엇을 고를지는
// 여전히 모델의 몫이라 「반드시 손을 부른다」는 안 잰다 — 그건 대본이지 운전이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 무능선언 = '지금은 제가 이 컴퓨터 파일 시스템에 직접 접근 권한이 없는 상태라서 확인해 드릴 수 없습니다.';

/**
 * 손을 **하나도 안 고르는** 모델. 완료형 판정 호출에만 CHAT 을 돌려줘서 경로가 실물과 같아진다
 * (모든 호출에 같은 문장을 돌려주면 엉뚱한 경로를 재게 된다).
 */
function 문맥({ 답 = 무능선언, 손없음 = false } = {}) {
  const tools = demoTools({});
  const ids = Object.keys(tools.tools);
  const 본것 = [];
  return {
    본것,
    ctx: {
      tools,
      // `손없음` — 선언도 손도 없는 판. 「쓸 손이 하나도 없다」는 이 자리에서만 참이다
      // (`hands` 만 비우면 선언이 남아 `있는손()` 이 여전히 선다).
      env: 손없음 ? demoEnv({ include: [], hands: [] }) : demoEnv({ include: ids, hands: ids }),
      model: {
        async respond(tc, opts = {}) {
          if (tc.workContractAssessment || opts.requiredTool === 'work.deliverable') {
            return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
          }
          본것.push({
            미달: Object.keys(tc).filter((k) => ['goalNotReached', 'candidatesUnopened',
              'searchNotExhausted', 'unmetDeliverable', 'partialRead', 'completionMismatch'].includes(k)),
            안써본손: tc.goalNotReached?.안써본손 ?? null,
            쥔손수: (opts.tools ?? []).length,
            마지막이력: (tc.recentTurns ?? []).slice(-1)[0] ?? null,
          });
          return 답;
        },
      },
    },
  };
}

const 되부름들 = (본것) => 본것.filter((v) => v.미달.includes('goalNotReached'));

test('① 손 0건으로 「못 한다」를 닫으려 하면 목적미달이 서고 손 전량과 함께 되부름이 돈다', async () => {
  const { ctx, 본것 } = 문맥();
  await runTurn({ text: '내 컴퓨터에 엑셀 파일 있어? 찾아서 어디 있는지 알려줘.' }, ctx);

  const 되부름 = 되부름들(본것);
  assert.ok(되부름.length, `**손 0건 턴이 목적미달을 통째로 빠져나갔다** — 호출별 미달 사실: ${
    JSON.stringify(본것.map((v) => v.미달))}`);
  assert.ok(되부름[0].쥔손수 > 0, '되부름이 손을 안 쥐여 줬다 — 사실만 주고 길을 뺏으면 같은 답이 또 난다');
  // 「한 번도 안 갔다」의 알맹이 — 안 써 본 손이 **전량** 사실로 간다(파일 손이 그 안에 있다).
  assert.ok((되부름[0].안써본손 ?? []).includes('local.file'),
    `안 써 본 손이 사실로 안 갔다: ${JSON.stringify(되부름[0].안써본손)}`);
  const 넛지 = 되부름.find((v) => v.마지막이력?.role === 'user'
    && /예고|손을 부르거나/.test(String(v.마지막이력?.text ?? '')));
  assert.ok(넛지, '되부름이 턴의 계약을 user 역할로 말하지 않았다(오픈북 conversation_loop.py:7182-7185)');
});

test('② 정직한 미완 고지는 안 문다 — 밝히고 있는 답을 거짓으로 몰지 않는다', async () => {
  const { ctx, 본것 } = 문맥({ 답: '엑셀 파일을 아직 다 확인하지 못 했어요. 어디까지 봤는지 남겨 둘게요.' });
  await runTurn({ text: '내 컴퓨터에 엑셀 파일 있어? 찾아서 어디 있는지 알려줘.' }, ctx);
  assert.equal(되부름들(본것).length, 0,
    `정직한 미완 고지에 목적미달이 붙었다: ${JSON.stringify(본것.map((v) => v.미달))}`);
});

test('③ 평범한 대화 답에는 안 붙는다 — 잔소리를 늘리지 않는다', async () => {
  const { ctx, 본것 } = 문맥({ 답: '안녕하세요! 반가워요.' });
  await runTurn({ text: '안녕하세요' }, ctx);
  assert.equal(되부름들(본것).length, 0,
    `할 일이 없는 인사에 목적미달이 붙었다: ${JSON.stringify(본것.map((v) => v.미달))}`);
});

test('④ 쓸 손이 하나도 없으면 안 문다 — 없는 길을 권하지 않는다', async () => {
  const { ctx, 본것 } = 문맥({ 손없음: true });
  await runTurn({ text: '내 컴퓨터에 엑셀 파일 있어? 찾아서 어디 있는지 알려줘.' }, ctx);
  assert.equal(되부름들(본것).length, 0,
    `쓸 손이 없는데 목적미달이 붙었다: ${JSON.stringify(본것.map((v) => v.미달))}`);
});
