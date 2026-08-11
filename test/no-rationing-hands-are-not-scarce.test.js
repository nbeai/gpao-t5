// **아껴 쓰지 않게 한다** — 넷 다 「빼는 일」이다 (오너 지시 2026-08-11).
//
// 실측(깨끗한 판 · *"네이버 열어서 전세사기 검색 결과 알려줘"*):
// ```
// 손    browser.observe:open → desktop.screen:observe   (2걸음)
// 결과  네이버 **첫 화면**만 열고 끝. 검색 안 함
// T5 말 "검색창에 직접 글자를 입력해 검색 버튼을 누르는 행동은 제 권한으로는 아직 못 합니다"
//       ← 30분 전 같은 판에서 desktop.act:type 으로 실제로 쳤다. **거짓이다**
// ```
// 한 병이다 — **아껴 쓰고 사람에게 넘긴다.** 원인 넷이 코드에 특정돼 있고 넷 다 빼는 일이다:
//   ① 걸음 상한 6        한 턴 도구 실행 6회
//   ② 왕복 예산 12       한 작업 모델 호출 12회
//   ③ `toolStepsLeft`   남은 걸음이 **작은 숫자로** 모델 방에 실린다 → 모델이 아낀다
//   ④ 결재 ① 미집행     "칸에 글자 넣기는 자동"이 오너 승인됐는데 코드는 여전히 카드다
//
// **안 건드리는 것**: 헌장 넷(비밀값·불가역 파괴·새 상대 첫 외부 전송·돈)·원장·안전 바닥.
// 그게 우리가 가진 것이고 상한을 걷어도 되는 이유다(정본 §7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { 턴예산 } from '../src/kernel/turn-budget.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';
import { decideAutoGrant, UNKNOWN_KIND } from '../src/kernel/l2-plan/authority.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

// ── 대본 모델 — 결정적이다(유료 라이브 없이 걸음 수를 잰다) ──────────────────
function 걸음마다(계획) {
  let i = 0;
  return {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '정리했어요';
      if (i >= 계획.length) return { text: '다 했어요', toolCalls: [] };
      const 걸음 = 계획[i]; i += 1;
      return { text: '', toolCalls: [걸음] };
    },
  };
}
const 명령 = (command) => ({ name: 'local.terminal', args: { command } });
function 기록하는손() {
  const 불린것 = [];
  return {
    불린것,
    도구: {
      async probe(command) { return { command, cwd: '/어딘가', changes: /rm |> /.test(command), probe: { exitCode: 0, stdout: '', stderr: '' } }; },
      async handler(args) {
        불린것.push(args.command);
        return { result: { command: args.command, exitCode: 0, stdout: '결과', cwd: '/어딘가' }, userSafeSummary: '실행했어요.' };
      },
    },
  };
}
const ctx = (model, 손) => ({ env: demoEnv(), model, tools: demoTools({ localTerminal: 손.도구 }) });

// ── ①② 상한 — 비교군 축: 클로드코드는 한 과업에 도구를 20~50번 쓴다 ──────────
//
// 상한을 **없애는 것이 아니다.** 무한 루프 방지는 그대로 두고, "정직한 목적 하나"가
// 상한에 걸리지 않게 한다. 20걸음은 지어낸 값이 아니라 비교군의 실측 하한이다.
test('한 목적이 스무 걸음이면 스무 걸음을 간다 — 6·12 에 걸려 사람에게 넘기지 않는다', async () => {
  const 손 = 기록하는손();
  const 스물 = Array.from({ length: 20 }, (_, i) => 명령(`echo ${i}`));
  await runTurn({ text: '끝까지 해줘' }, ctx(걸음마다(스물), 손));
  assert.equal(손.불린것.length, 20,
    `**${손.불린것.length}걸음에서 잘렸다** — 모델은 다음 걸음을 알고 있는데 런타임이 아끼게 만든다`);
});

test('왕복 예산이 비교군 하한(20)을 담는다 — 비용 축은 예산 한 곳이다', () => {
  assert.ok(턴예산({}).왕복 >= 20,
    `왕복 예산 ${턴예산({}).왕복} — 한 과업에 도구를 20~50번 쓰는 비교군 축을 애초에 못 담는다`);
});

// 상한을 **없애지는 않았다**. 이 검사가 빠지면 위 검사가 무한 루프의 허가증이 된다.
test('상한은 남아 있다 — 끝없이 돌지 않는다', async () => {
  const 손 = 기록하는손();
  const 예산 = 턴예산({});
  const 많이 = Array.from({ length: 예산.왕복 * 3, }, (_, i) => 명령(`echo ${i}`));
  await runTurn({ text: '계속해' }, ctx(걸음마다(많이), 손));
  assert.ok(손.불린것.length <= 예산.왕복 + 1,
    `예산이 안 문다(${손.불린것.length}걸음 · 왕복예산 ${예산.왕복})`);
  assert.ok(손.불린것.length < 많이.length, '모델이 낸 것을 끝까지 다 돌면 경계가 없는 것이다');
});

test('벽시계가 왕복을 목 조르지 않는다 — 상한 하나를 걷고 다른 상한이 대신 물면 그대로다', () => {
  const b = 턴예산({});
  // 한 왕복이 8초(실측 회차 어림)라면 벽시계가 왕복보다 먼저 물어선 안 된다.
  assert.ok(b.벽시계ms >= b.왕복 * 8_000,
    `벽시계 ${b.벽시계ms}ms 가 왕복 ${b.왕복}회보다 먼저 문다 — 예산을 올린 것이 시늉이 된다`);
});

// ── ③ 아껴 쓰라는 신호를 주지 않는다 ──────────────────────────────────────
//
// 원래 목적은 반대였다(H08): 남은 걸음을 몰라서 모델이 **거짓 소진**을 지어냈다.
// 그 사실은 그대로 두되, **작은 숫자**로 주면 그 자체가 배급 신호다.
// 그래서 넉넉할 때는 숫자를 안 싣고 「아껴 쓰라는 뜻이 아니다」를 구조로 드러낸다.
const 태우기 = (p) => String(buildModelMessages({
  currentRequest: '네이버 열어서 전세사기 검색 결과 알려줘',
  ...buildTaskContext({
    processEnv: {},
    selfState: { currentModel: { id: 't' }, connectedTools: [], riskyActions: [], limits: {} },
    intent: { answerMode: 'work', goal: 'x', currentRequest: '네이버 열어서 전세사기 검색 결과 알려줘' },
    plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [], ...p,
  }),
}).system ?? '');

test('넉넉히 남았으면 숫자를 안 준다 — 숫자는 그 자체가 아끼라는 신호다', () => {
  const 방 = 태우기({ toolStepsLeft: 40 });
  assert.doesNotMatch(방, /40번 더 이어 쓸 수 있다/,
    '**남은 걸음을 숫자로 세어 준다** — 모델은 그 숫자를 예산으로 읽고 아낀다');
  assert.match(방, /아껴/, '「아껴 쓰라는 뜻이 아니다」가 구조로 안 드러난다');
});

test('진짜 모자랄 때는 숫자를 준다 — 거짓 소진(H08)이 되살아나지 않는다', () => {
  assert.match(태우기({ toolStepsLeft: 2 }), /2번 더 이어 쓸 수 있다/,
    '모자란 것을 안 알려주면 모델이 빈칸을 소진으로 메운다');
});

// ── ④ 결재 ① 집행 — 칸에 글자 넣기는 자동, 카드는 밖으로 나가는 걸음에만 ──────
//
// 자동의 조건 **셋을 모두** 만족할 때만이다:
//   요소로 짚었고 · 그 요소가 보안 칸이 아니고 · 그 창의 요소 목록을 실제로 읽어냈다.
// 하나라도 못 세우면 카드다(fail-closed).
const 짚은칸 = (더) => ({ action: 'type', 대상: { id: 's1:26', label: '검색창' }, 값: '전세사기', 눌러본사실: { 찾음: true, 값있음: true, 역할: 'AXTextField', 본창: { app: 'Chrome', 제목: 'NAVER' }, ...더 } });
const 등급 = (args) => toolActionKind({ toolId: 'desktop.act', args });

test('칸에 글자 넣기는 자동이다 — 결재 ① (오너 승인 완료)', () => {
  const kind = 등급(짚은칸());
  assert.equal(decideAutoGrant({ kind }), true,
    `**타이핑에 카드가 뜬다**(kind=${kind}) — 네이버가 손 2회로 통과하는 자리다`);
});

test('보안 칸은 자동에서 빠진다 — 헌장 ①(비밀값은 사람만)은 안 건드린다', () => {
  const kind = 등급(짚은칸({ 역할: 'AXSecureTextField', 보안칸: true }));
  assert.equal(decideAutoGrant({ kind }), false, '**비밀값 칸에 글자가 조용히 들어간다**');
});

test('탐침이 그 창의 요소 목록을 못 읽었으면 카드다 — 모름은 자동이 아니다', () => {
  assert.equal(decideAutoGrant({ kind: 등급({ action: 'type', 대상: { label: '검색창' }, 값: 'x', 눌러본사실: { 찾음: false } }) }), false);
  assert.equal(등급({ action: 'type', 대상: { label: '검색창' }, 값: 'x' }), UNKNOWN_KIND,
    '돌려 본 사실이 아예 없는데 자동으로 흘렀다');
});

test('좌표로 짚은 글자 넣기는 그대로 카드다 — 이름 없는 자리는 약속할 수 없다', () => {
  const kind = 등급({ action: 'type', 대상: { x: 100, y: 200 }, 값: 'x', 눌러본사실: { 찾음: true, 값있음: true } });
  assert.equal(decideAutoGrant({ kind }), false);
});

// ── 카드가 남아야 하는 자리 셋 — 여기가 안전이 사는 곳이다 ────────────────────
test('신고된 전송은 그대로 카드다 — 헌장 ③ 은 안 느슨해진다', () => {
  const kind = 등급({ ...짚은칸(), 기대: { 바깥으로: true, 값: '전세사기' } });
  assert.equal(kind, 'send');
  assert.equal(decideAutoGrant({ kind }), false);
});

test('칸 내용이 실린 엔터는 그대로 카드다 — 밖으로 나가는 걸음이다', () => {
  const kind = 등급({ action: 'press_key', 값: 'return', 눌러본사실: { 칸내용: '전세사기', 본창: { app: 'Chrome' } } });
  assert.equal(decideAutoGrant({ kind }), false,
    '**칸 내용이 그대로 실행되는 걸음이 카드 없이 나간다**');
});

test('전송 버튼 누르기는 그대로 카드다 — 값 없는 버튼은 미상이다', () => {
  const kind = 등급({ action: 'click', 대상: { id: 's1:7', label: '보내기' }, 눌러본사실: { 찾음: true, 값있음: false } });
  assert.equal(kind, UNKNOWN_KIND);
  assert.equal(decideAutoGrant({ kind }), false);
});

// 탐침 자체도 보안 칸을 자동 쪽으로 흘리면 안 된다 — 손이 낸 기계 사실에서 막는다.
test('탐침은 보안 칸을 「찾음」으로 내주지 않는다 — 자동의 재료를 애초에 안 만든다', async () => {
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'Chrome' }, windows: [{ id: 9, pid: 77 }], 본창: { id: 9, app: 'Chrome', pid: 77 },
        elements: [{ id: 's1:3', 토큰: 's1:3', role: 'AXSecureTextField', label: '비밀번호', 창: 9, pid: 77, isEnabled: true }],
      }),
      act: () => ({ ok: true }),
    }],
  });
  const 눌러본사실 = await 손.probe({ action: 'type', app: 'Chrome', 대상: { id: 's1:3', label: '비밀번호' } });
  assert.notEqual(눌러본사실?.찾음, true,
    `**보안 칸이 「찾음」으로 나온다** — 자동 조건의 재료가 그대로 선다: ${JSON.stringify(눌러본사실)}`);
  assert.equal(decideAutoGrant({ kind: 등급({ action: 'type', 대상: { id: 's1:3' }, 값: 'x', 눌러본사실 }) }), false);
});
