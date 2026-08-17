// turn.js 호출 순서 동결 (HRT-ST-002 nextAction)
//
// 왜 이게 먼저인가: 원장이 `turn.js` 정리의 절대 게이트로 **"모델 호출 순서와 횟수 의도치
// 않은 변화 0"** 을 요구한다. 그런데 지금 그것을 기계로 판정할 자리가 없다 — 회귀는 결과를
// 보지 순서를 보지 않는다. 그래서 한 줄도 옮기기 전에 순서를 먼저 못박는다.
//
// P90-1 에서 전역 보완 호출이 회귀를 만든 적이 있다. 그때 깨진 것은 답이 아니라 **순서**였다.
//
// 이 검사는 문구를 재지 않는다. **누가 어떤 순서로 불렸는가**만 본다.
//   · 모델 호출은 `tc` 의 어느 칸이 켜졌는지와 도구를 몇 개 줬는지로 구분한다
//     (그것이 "이 호출이 무엇을 하는 호출인가"의 기계 사실이다)
//   · 도구 실행은 손 이름으로 남긴다
// 원문·답변·도구 인자는 여기 들어오지 않는다.
//
// **정리 중 이 파일을 고쳐서 통과시키면 안 된다.** 순서가 바뀌었다면 그것이 회귀다.
// 의도한 변경이라면 왜 바뀌어야 하는지를 먼저 적고 별도 커밋으로 바꾼다
// (원장 forbiddenFixes: "호출 순서 기반 기존 시험을 수정해 회귀 은폐").
// ── **손이 하나 늘었다: `telegram.inbox`**(2026-08-17 · 국면 4 슬라이스 1) ────
// `tools=12` → `tools=13`. **왕복은 이번에도 안 늘었다** — 이 검사가 지키는 것은 그쪽이다.
// 값을 치르는 근거(불변식 B — 코어 도구 하나는 매 API 콜 비용): 채널 손이 **전부 보내는
// 쪽**이었다(telegram.send · slack.post · mail.send). 받은 것을 꺼내 보는 손이 0개라
// "텔레그램으로 뭐 왔어?" 가 **끝날 자리가 없었다** — state-probe channel-inbox 가
// 「훑은 파일 66 · 조회 손 검색어 다섯 0건 · 걸린 1건은 양성대조 telegram.send 뿐」으로
// 그 부재를 기계로 세워 뒀다. `session.search` 가 밟은 그 병이다: 가진 것을 못 쓰면 없는 것과
// 같고, 여기는 가진 것조차 없었다.
// 이 손은 읽기(read)라 승인 카드가 없고, 설명문에 발동 조건을 안 박았다(유도 · session.search
// 규율). 모델이 안 부르면 그 경로는 통째로 안 돈다. 검사: test/channel-inbox-hand.test.js.
//
// ── **손이 또 하나 늘었다: `ask.user`**(2026-08-05 · S8 ④) ──────────────────
// `tools=11` → `tools=12`. **왕복은 이번에도 안 늘었다.**
// 값을 치르는 근거: 지금까지 **커널이 자기 문장으로 되물었다**(`turn.js` 세 자리).
// 말은 프로세스의 것인데 커널이 대신 했다(§1). 그 자리를 모델에게 돌려주는 값이다.
// **질문 총량은 안 늘었다** — 늘리는 장치를 하나도 안 만들었고, 모델이 안 부르면 그 경로는
// 통째로 안 돈다. 그 계약은 `test/ask-user-replaces-clarify.test.js` 가 따로 잰다.
//
// ── **손이 하나 늘었다: `web.search`**(2026-08-05 · S8 ③) ────────────────────
// `tools=10` → `tools=11`. **왕복은 한 번도 안 늘었다** — 이 검사가 지키는 것은 그쪽이고,
// 표식의 도구 수는 "이번 호출에 무엇을 쥐여 줬나"라는 다른 축이다.
//
// 그래도 공짜가 아니다(불변식 B — 코어 도구 하나는 매 API 콜 비용). 그 값을 치르기로 한
// 근거는 오너 라이브 실측이다: 찾기와 읽기가 한 칸에 섞여 있어 모델이 **"후보만 보여 줘"를
// 부를 수 없었고**, 그래서 첫 결과에 운을 맡긴 채 막히면 질의 문구만 바꿨다(세 번 다).
// 같은 코드로 6턴을 돌려 4턴만 맞은 편차가 거기서 나왔다. **고를 기회를 여는 값이다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

// 이 호출이 무엇을 하는 호출인가 — tc 의 켜진 칸과 쥐어준 도구 수.
const 관심칸 = ['workContractAssessment', 'workStateSettlement', 'answerOnly',
  'unmetDeliverable', 'chatOutputContract', 'currentActionScope'];
const 표식 = (tc, opts) => {
  const 켜진칸 = 관심칸.filter((k) => tc?.[k] !== undefined && tc?.[k] !== null && tc?.[k] !== false);
  return `model[${켜진칸.join('+') || '-'}|tools=${opts?.tools?.length ?? 0}${opts?.requiredTool ? '|req' : ''}]`;
};

async function 무대({ 응답 }) {
  const dir = await mkdtemp(join(tmpdir(), 'turn-seq-'));
  await writeFile(join(dir, '정산.csv'), '항목,금액\n임대료,500000\n');
  const 순서 = [];
  const model = { async respond(tc, opts = {}) { 순서.push(표식(tc, opts)); return 응답(tc, opts); } };
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 원래 = localFile.handler.bind(localFile);
  localFile.handler = async (...a) => { 순서.push('tool[local.file]'); return 원래(...a); };
  // 승인이 나는 탈것 — 자동성 헌장(2026-08-03) 뒤 되돌릴 수 있는 파일 작업은 자동이라
  // **승인 카드 턴 자체를 만들 수 없다.** `local.terminal` 은 `reversible:false` 라 헌장 ②에 걸린다.
  const localTerminal = {
    async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { 순서.push('tool[local.terminal]'); return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '정리했어요.' }; },
  };
  return { ctx: { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model }, 순서 };
}

// ① 듣기만 하는 턴 — 도구를 안 쓰는 대화에서 모델을 두 번 넘게 부르지 않는다.
test('순서 동결 ①: 대화만 하는 턴은 계획 1 + 최종 답 1', async () => {
  const { ctx, 순서 } = await 무대({ 응답: (tc, o) => (o.tools?.length ? { text: '', toolCalls: [] } : '많이 힘드셨겠어요.') });
  const r = await runTurn({ text: '요즘 가게가 너무 힘들다' }, ctx);
  assert.equal(r.kind, 'reply');
  assert.deepEqual(순서, [
    'model[-|tools=13]',
    'model[answerOnly|tools=0]',
  ], '대화 턴의 모델 왕복이 바뀌었다 — 늘었다면 사용자는 그만큼 더 기다린다');
});

// ② 도구 한 걸음 — 계획 → 완료 형태 판정 → 실행 → 계획 → 최종 답.
//    판정 호출은 **구조 채널**로 간다(P90-2, 산문 파싱 재시도 소멸). 그것이 `req` 표식이다.
test('순서 동결 ②: 도구 한 걸음 턴은 모델 4회 · 도구 1회', async () => {
  const { ctx, 순서 } = await 무대({
    응답: (tc, o) => {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (o.tools?.length) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '정산.csv' } }] };
      return '정리했어요.';
    },
  });
  const r = await runTurn({ text: '정산.csv 읽고 알려줘' }, ctx);
  assert.equal(r.kind, 'reply');
  assert.deepEqual(순서, [
    'model[-|tools=13]',
    'model[workContractAssessment|tools=1|req]',
    'tool[local.file]',
    'model[-|tools=13]',
    'model[answerOnly|tools=0]',
  ], '도구 턴의 호출 순서가 바뀌었다');
});

// ③ 승인 경계 — **카드를 띄우는 턴은 실행하지 않는다.** 도구 호출이 순서에 없어야 한다.
test('순서 동결 ③: 승인 카드 턴은 모델 2회 · 도구 실행 0회', async () => {
  const { ctx, 순서 } = await 무대({
    응답: (tc, o) => {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (o.tools?.length) return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'rm -rf 임시폴더' } }] };
      return '지울까요?';
    },
  });
  const r = await runTurn({ text: '임시폴더 지워줘' }, ctx);
  assert.equal(r.kind, 'approval', '되돌릴 수 없는 명령은 헌장 ② 라 승인 경계다');
  assert.deepEqual(순서, [
    'model[-|tools=13]',
    'model[workContractAssessment|tools=1|req]',
  ], '승인 전에 실행이 끼어들었거나 모델 왕복이 바뀌었다');
  assert.ok(!순서.includes('tool[local.terminal]'), '승인 전 효과 0 — 카드 턴에서 손이 움직였다');
});

// ④ 승인 재개 — **실행이 먼저**다. 사용자가 이미 허락했으므로 다시 묻지 않는다.
test('순서 동결 ④: 승인 재개는 실행 먼저, 그다음 모델 2회', async () => {
  let 썼나 = false;
  const { ctx, 순서 } = await 무대({
    응답: (tc, o) => {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (썼나) return '임시폴더를 지웠어요.';
      if (o.tools?.length) return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'rm -rf 임시폴더' } }] };
      return '지울까요?';
    },
  });
  const 카드 = await runTurn({ text: '임시폴더 지워줘' }, ctx);
  assert.equal(카드.kind, 'approval');
  순서.length = 0;
  const t = ctx.tools.tools['local.terminal'];
  const 원래 = t.handler;
  t.handler = async (...a) => { 썼나 = true; return 원래(...a); };
  const r = await runTurn({ approve: 카드.pendingId }, ctx);
  assert.equal(r.kind, 'reply');
  assert.deepEqual(순서, [
    'tool[local.terminal]',
    'model[-|tools=13]',
  ], '승인 재개의 호출 순서가 바뀌었다 — 실행이 뒤로 가면 사용자는 허락한 일을 다시 기다린다');
});

// ⑤ 거절 — **모델을 부르지 않는다.** 거절 문구는 도구가 카드에 쓴 자기 말에서 나온다.
test('순서 동결 ⑤: 거절은 모델 호출 0 · 도구 실행 0', async () => {
  const { ctx, 순서 } = await 무대({
    응답: (tc, o) => {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (o.tools?.length) return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'rm -rf 임시폴더' } }] };
      return '지울까요?';
    },
  });
  const 카드 = await runTurn({ text: '임시폴더 지워줘' }, ctx);
  assert.equal(카드.kind, 'approval');
  순서.length = 0;
  const r = await runTurn({ reject: 카드.pendingId }, ctx);
  assert.equal(r.kind, 'reply');
  assert.deepEqual(순서, [], '거절에 모델이나 손이 움직였다 — 안 하기로 한 일에 비용이 든다');
  assert.ok(String(r.reply ?? '').trim(), '거절에도 사람 말은 남아야 한다');
});
