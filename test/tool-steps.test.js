// P6-L · 한 턴 안에서 손을 이어 쓴다 — **말로 끊기던 자리를 잇는다.**
//
// 실측: "이 프로젝트 테스트 돌려봐"에 T5 가 "package.json 존재만 확인됐고, 실제 테스트 명령은
// 아직 실행되지 않았습니다"라며 사용자에게 `npm test` 를 대신 치라고 했다. 모델은 다음 걸음을
// 정확히 알고 있었다 — **손이 한 번밖에 안 나갔다.** 그 걸음을 잇는 것이 이 파일의 검사 대상이다.
//
// 새 안전 체계를 만들지 않았으므로, 여기서 확인할 것은 **기존 경계가 그대로인가**이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { 턴예산 } from '../src/kernel/turn-budget.js';

/** 지정한 도구 호출을 순서대로 하나씩 내놓는 모델. 다 쓰면 말로 끝낸다. */
function 걸음마다(계획) {
  let i = 0;
  return {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '정리했어요';
      if (i >= 계획.length) return { text: '다 했어요', toolCalls: [] };
      const 걸음 = 계획[i]; i += 1;
      return { text: '', toolCalls: [걸음] };
    },
    쓴걸음: () => i,
  };
}

const 명령 = (command) => ({ name: 'local.terminal', args: { command } });

/** 실제 실행 대신 무엇이 불렸는지만 기록하는 손(안전 경계 검사에 집중). */
function 기록하는손() {
  const 불린것 = [];
  return {
    불린것,
    도구: {
      async probe(command) { return { command, cwd: '/어딘가', changes: /rm |> /.test(command), probe: { exitCode: 0, stdout: '', stderr: '' } }; },
      async handler(args) {
        불린것.push(args.command ?? JSON.stringify(args));
        return { result: { command: args.command, exitCode: 0, stdout: '결과', cwd: '/어딘가' }, userSafeSummary: '실행했어요.' };
      },
    },
  };
}
const ctx = (model, 손) => ({ env: demoEnv(), model, tools: demoTools({ localTerminal: 손.도구 }) });

test('찾기 → 확인 → 실행이 한 턴에서 이어진다', async () => {
  const 손 = 기록하는손();
  const r = await runTurn({ text: '이 프로젝트 테스트 돌려봐' },
    ctx(걸음마다([명령('ls'), 명령('cat package.json'), 명령('npm test')]), 손));
  assert.equal(r.kind, 'reply');
  assert.deepEqual(손.불린것, ['ls', 'cat package.json', 'npm test'],
    '한 걸음에서 끊기면 나머지를 사용자에게 말로 넘기게 된다');
});

test('모든 걸음이 원장에 남는다', async () => {
  const 손 = 기록하는손();
  const r = await runTurn({ text: '해줘' }, ctx(걸음마다([명령('ls'), 명령('pwd'), 명령('date')]), 손));
  assert.equal((r.ledger?.confirmed ?? []).length, 3, `걸음 수와 원장이 안 맞는다: ${JSON.stringify(r.ledger)}`);
});

// ── 기존 경계는 그대로다 ────────────────────────────────────────────────
test('승인이 필요한 걸음은 실행하지 않고 멈춘다', async () => {
  const 손 = 기록하는손();
  await runTurn({ text: '정리해줘' },
    // 두 번째 걸음이 파일을 지운다(probe 가 changes=true 로 본다) → 거기서 멈춰야 한다.
    ctx(걸음마다([명령('ls'), 명령('rm -rf 어딘가'), 명령('echo 끝')]), 손));
  assert.deepEqual(손.불린것, ['ls'], '이어 쓰기가 승인 경계를 넘었다 — 사용자가 허락하지 않은 일이 실행됐다');
});

test('예산을 넘겨 계속 돌지 않는다', async () => {
  const 손 = 기록하는손();
  const 많이 = Array.from({ length: 20 }, (_, i) => 명령(`echo ${i}`));
  await runTurn({ text: '계속해' }, ctx(걸음마다(많이), 손));
  // **경계 자체가 계약이다**(무한 루프 방지). 숫자는 예산에서 파생한다 — 예전엔 7을 손으로
  // 적어 뒀는데 그건 `MAX_TOOL_STEPS = 6` 시절의 값이라, 예산으로 바꾸자 뜻 없이 빨개졌다.
  // 이 대본은 걸음마다 한 명령씩 내므로 걸음 수는 왕복 수에 계획 1걸음을 더한 만큼이 상한이다.
  const 예산 = 턴예산({});
  assert.ok(손.불린것.length <= 예산.왕복 + 1,
    `예산이 안 먹는다(${손.불린것.length}걸음 · 왕복예산 ${예산.왕복}) — 한 턴이 끝없이 길어진다`);
  assert.ok(손.불린것.length < 많이.length, '모델이 낸 것을 끝까지 다 돌면 경계가 없는 것이다');
});

test('예산을 조이면 **그만큼** 일찍 멈춘다(우연히 멈춘 게 아니다)', async () => {
  // 위 검사만으로는 "어쩌다 멈췄다"와 "예산이 물었다"를 못 가른다. 예산을 바꿔 보면 갈린다.
  const 원래 = process.env.GPAO_T5_TURN_ROUNDTRIPS;
  process.env.GPAO_T5_TURN_ROUNDTRIPS = '2';
  try {
    const 손 = 기록하는손();
    const 많이 = Array.from({ length: 20 }, (_, i) => 명령(`echo ${i}`));
    await runTurn({ text: '계속해' }, ctx(걸음마다(많이), 손));
    assert.ok(손.불린것.length <= 3,
      `왕복 예산을 2로 줄였는데 ${손.불린것.length}걸음 돌았다 — 무는 것은 예산이 아니다`);
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_TURN_ROUNDTRIPS;
    else process.env.GPAO_T5_TURN_ROUNDTRIPS = 원래;
  }
});

test('같은 손을 같은 인자로 되풀이하지 않는다', async () => {
  const 손 = 기록하는손();
  await runTurn({ text: '해줘' }, ctx(걸음마다([명령('ls'), 명령('ls'), 명령('ls')]), 손));
  assert.equal(손.불린것.filter((c) => c === 'ls').length, 1, '같은 일을 반복하면 제자리를 돈다');
});

test('걸음이 없으면 예전처럼 한 번에 끝난다(멀쩡한 턴을 늘리지 않는다)', async () => {
  const 손 = 기록하는손();
  const r = await runTurn({ text: '안녕' }, ctx(걸음마다([]), 손));
  assert.equal(r.kind, 'reply');
  assert.deepEqual(손.불린것, []);
});

// ── 상한 4→6 (2026-08-01, H08 실측) — 전역 변경의 다섯 증명 ──────────────
// 실제 파일 목적(자리 찾기 1~2 + 판별 + 읽기 + 별도 결과물 쓰기)이 4걸음을 정직하게 넘어
// 모델이 일을 알고도 소진으로 멈췄다. 상한은 예산이지 유도가 아니다 — 다음 다섯을 증명한다:
// ① 단순 대화 추가 호출 0 ② 일반 읽기 흐름 걸음 증가 0 ③ 같은 손 반복 0(지문이 담당)
// ④ 최대 호출 상한은 유지된다(위 검사) ⑤ 걸음은 모델이 고를 때만 생긴다(상한이 걸음을 만들지 않는다).
test('상한 증명 ①⑤: 도구가 필요 없는 턴은 상한과 무관하게 호출 0', async () => {
  const 손 = 기록하는손();
  const model = { async respond() { return '안녕하세요!'; } };
  await runTurn({ text: '안녕' }, ctx(model, 손));
  assert.deepEqual(손.불린것, [], '상한을 올렸다고 걸음이 생기면 그건 유도다');
});

test('상한 증명 ②⑤: 모델이 한 걸음에서 멈추면 정확히 한 걸음만 돈다', async () => {
  const 손 = 기록하는손();
  await runTurn({ text: '해줘' }, ctx(걸음마다([명령('ls')]), 손));
  assert.deepEqual(손.불린것, ['ls'], '상한 상향이 일반 흐름의 걸음 수를 바꾸면 안 된다');
});

// ── P90-2 단계2 · 완료 형태 판정을 산문 파싱에 맡기지 않는다 ────────────────
//
// 실측(2026-08-02, 로컬 파일 경로 6회): 이 판정 호출이 전체 모델 시간의 **36.6%**를 쓴다.
// 본선 왕복 평균 4.62초인데 이 호출만 7.33초다 — 도구도 없고 답이 4글자인데 더 느리다.
// 이유는 `directWrite` 가 아닐 때 **도구 없이 산문을 받아 정규식으로 읽기** 때문이다.
// 6회 중 2회는 모델이 파싱 안 되는 산문(47·49·55자)을 내서 재시도가 돌았고,
// 회차3은 두 번 다 실패해 17초를 태우고 보수 폴백으로 떨어졌다.
//
// 계약: 판정은 **구조 채널**로 받는다. 산문 파싱은 구조 채널을 모르는 provider 를 위한
// 폴백으로만 남는다(코드가 이미 structured → parse 순서로 읽는다).
// 판정 스키마는 실행 도구가 아니라 `{output: 'chat'|'file'}` 하나뿐이라, 이것만 주고
// requiredTool 로 강제하면 모델이 "다음 실제 걸음"을 여기서 소비할 수 없다.
test('P90-2: 완료 형태 판정 호출은 구조 채널을 준다(산문 파싱 의존 금지)', async () => {
  const 판정호출 = [];
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) {
        판정호출.push({ tools: (opts.tools ?? []).map((t) => t.name), requiredTool: opts.requiredTool });
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      }
      // 첫 호출: 읽기만 고른다 — directWrite 가 **아닌** 경로를 태운다.
      if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '정산.csv' } }] };
      return '정리했어요.';
    },
  };
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-p90-2-'));
  await runTurn({ text: '정산.csv 읽고 보기 좋게 정리해서 파일로 만들어줘' }, {
    env: demoEnv(),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });

  assert.ok(판정호출.length >= 1, '완료 형태 판정 호출이 있어야 한다');
  for (const 호출 of 판정호출) {
    assert.deepEqual(호출.tools, ['work.deliverable'],
      `판정 호출에 구조 채널이 없다 — 산문 파싱에 맡기면 파싱 실패 시 왕복이 하나 더 든다(실측 6회 중 2회)`);
    assert.equal(호출.requiredTool, 'work.deliverable',
      '강제하지 않으면 모델이 산문으로 답할 수 있다');
  }
});

test('P90-2: 구조 채널로 답하면 판정 호출은 한 번뿐이다(재시도 루프 미발화)', async () => {
  let 판정횟수 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) {
        판정횟수 += 1;
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      }
      if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '정산.csv' } }] };
      return '정리했어요.';
    },
  };
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-p90-2b-'));
  await runTurn({ text: '정산.csv 읽고 정리해줘' }, {
    env: demoEnv(),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });
  assert.equal(판정횟수, 1, `구조 채널이 답했는데 재시도가 돌았다 — 실제 ${판정횟수}회`);
});

// ── P90-2 후속 · 확인된 중간 결과를 기다림 동안 보여준다 ────────────────────
//
// 실측(2026-08-03, 로컬 파일 경로 6회): 도구 턴 20초 동안 사용자가 보는 것은
// `○○ 실행 중이에요` 하나뿐이고, 첫 내용(answer_delta)은 **마지막 왕복에서야** 뜬다
// (첫 유용한 내용 중앙 17.5초). 기다림이 비어 있다.
//
// 재료는 이미 있다 — 도구 실행 직후 영수증이 `userSafeSummary` 를 들고 온다.
// 그건 모델 내용이 아니라 **OS 가 만든 사용자 언어 문장**이다("3곳이 후보예요",
// "정산_3월_수정.csv 을(를) 읽었어요"). `partial_result` 사건 타입도 이미 선언돼
// 있고 durable 집합에 들어 있다(재접속 복구됨). 생산자만 없었다.
//
// 계약:
//   · **성공 영수증만.** 실패는 복구 사다리와 최종 답이 정직하게 다룬다 — 중간에 흘리면
//     사용자가 두 번 놀란다.
//   · **실행 후 사실만.** 계획서 §4-5 "실행 전 성공 예고 금지" — 영수증은 결과이지 예고가 아니다.
//   · **영수증 신분과 결합.** 계획서 §4 측정 기준: first_grounded_content 는 "단순한 확인 중
//     문구가 아니라 receipt 신분 또는 검증된 중간 결과와 결합" 돼야 한다.
//   · 모델 내용을 싣지 않는다(참고 원천 두 곳의 공통 규율과 같다).
test('P90-2: 성공한 도구 걸음은 확인된 사실을 partial_result 로 먼저 보여준다', async () => {
  const 사건 = [];
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-partial-'));
  await writeFile(join(dir, '정산.csv'), '항목,금액\n임대료,500000\n');
  const 읽는모델 = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '정산.csv' } }] };
      return '정리했어요.';
    },
  };
  await runTurn({ text: '정산.csv 읽고 알려줘' }, {
    env: demoEnv(),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model: 읽는모델,
    emit: async (type, payload) => { 사건.push({ type, payload }); },
  });

  const 중간 = 사건.filter((e) => e.type === 'partial_result');
  assert.ok(중간.length >= 1, `확인된 중간 결과가 하나도 안 나갔다 — 나간 사건: ${사건.map((e) => e.type).join(', ')}`);
  const 첫 = 중간[0].payload ?? {};
  assert.ok(String(첫.text ?? '').trim(), '사용자에게 보일 문장이 비었다');
  // 신분은 **이 턴 원장에서의 자리**다. 커널 영수증에는 receiptRef 가 없다(그건 표면이
  // 발급한다) — 있지도 않은 필드를 신분으로 적으면 검사도 문서도 거짓이 된다.
  assert.equal(typeof 첫.step, 'number',
    '실행 신분(원장 자리)이 없으면 "확인 중" 문구와 구분되지 않는다(계획서 §4 측정 기준)');
  assert.ok(첫.step >= 1, '원장 자리는 1부터다');

  // 진행 표시보다 **뒤**에 온다 — 실행 전 예고가 아니라 실행 후 사실이라는 뜻이다.
  const 진행 = 사건.findIndex((e) => e.type === 'tool_progress');
  const 결과 = 사건.findIndex((e) => e.type === 'partial_result');
  assert.ok(진행 >= 0 && 결과 > 진행, '중간 결과가 실행 전에 나갔다(성공 예고 금지)');
});

test('P90-2: 실패한 걸음은 중간 결과로 흘리지 않는다', async () => {
  const 사건 = [];
  const 터지는손 = { async handler() { throw new Error('boom'); } };
  const 모델 = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '없는것.csv' } }] };
      return '못 했어요.';
    },
  };
  await runTurn({ text: '없는것.csv 읽어줘' }, {
    env: demoEnv(), tools: demoTools({ localFile: 터지는손 }), model: 모델,
    emit: async (type, payload) => { 사건.push({ type, payload }); },
  });
  assert.equal(사건.filter((e) => e.type === 'partial_result').length, 0,
    '실패를 중간 결과로 흘리면 사용자가 두 번 놀란다 — 실패는 최종 답이 정직하게 다룬다');
});

// ── 감사 반대시험 ① 실패는 아니지만 **끝나지도 않은** 걸음 ──────────────────
//
// lifecycle 은 (actualCall, failureState, result) 에서 파생된다. 호출은 했고 실패도
// 아닌데 result 가 없으면 `attempting` 이다 — 아직 아무것도 확인되지 않았다.
// `failureState !== 'none'` 만 보면 이게 성공 문장처럼 새어 나간다.
// 원장의 "확인한 것"(projectReceipts)이 쓰는 정의와 **같은 정의**를 써야 한다.
test('P90-2 반대시험: 결과 없는 attempting 걸음은 중간 결과로 나가지 않는다', async () => {
  const 사건 = [];
  // 실패하지 않고 **아무것도 반환하지 않는** 손. tool-runner 의 `out?.result ?? out` 이
  // undefined 가 되고, deriveLifecycle 이 attempting 으로 판정한다.
  // 그런데 userSafeSummary 는 기본 문구("… 실행 완료.")로 채워진다 — 겉보기엔 성공 문장이다.
  const 결과없는손 = { async handler() { /* 결과를 내지 않는다 */ } };
  const 모델 = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '정산.csv' } }] };
      return '알려드릴게요.';
    },
  };
  const out = await runTurn({ text: '정산.csv 읽어줘' }, {
    env: demoEnv(), tools: demoTools({ localFile: 결과없는손 }), model: 모델,
    emit: async (type, payload) => { 사건.push({ type, payload }); },
  });
  // 이 시험이 겨누는 상태가 실제로 만들어졌는지 먼저 확인한다 — 원장은 이 걸음을
  // "확인한 것"이 아니라 "추정"으로 센다(projectReceipts: result 가 없으면 confirmed 아님).
  assert.equal(out.ledger.confirmed.length, 0,
    `겨누는 상태가 안 만들어졌다 — 원장이 확인으로 셌다: ${JSON.stringify(out.ledger.confirmed)}`);
  assert.ok(out.ledger.estimated.length >= 1, '이 걸음이 원장 어디에도 안 남았다');

  assert.equal(사건.filter((e) => e.type === 'partial_result').length, 0,
    '끝나지도 않은 걸음을 확인된 사실로 흘렸다 — 원장은 이걸 "확인한 것"으로 세지 않는다');
});

// ── 감사 반대시험 ② 같은 문장을 내는 **서로 다른 두 실행** ──────────────────
//
// 문장으로 중복을 제거하면, 같은 손이 두 파일을 처리하고 요약이 같을 때 두 번째 실행
// 사실이 화면에서 사라진다. 신분은 문장이 아니라 **실행**이어야 한다.
test('P90-2 반대시험: 문장이 같아도 서로 다른 실행이면 각각 나간다', async () => {
  const 사건 = [];
  // 두 번 불려도 **같은 문장**을 내는 손. 실행은 둘, 문장은 하나.
  const 같은말손 = { async handler() { return { result: { ok: true }, userSafeSummary: '파일 하나를 정리했어요.' }; } };
  let 남은호출 = ['가.csv', '나.csv'];
  const 모델 = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && 남은호출.length) {
        const path = 남은호출.shift();
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path } }] };
      }
      return '두 개 다 정리했어요.';
    },
  };
  await runTurn({ text: '가.csv 랑 나.csv 정리해줘' }, {
    env: demoEnv(), tools: demoTools({ localFile: 같은말손 }), model: 모델,
    emit: async (type, payload) => { 사건.push({ type, payload }); },
  });
  const 중간 = 사건.filter((e) => e.type === 'partial_result');
  assert.equal(중간.length, 2,
    `실행 두 번인데 ${중간.length}번만 나갔다 — 문장으로 지우면 두 번째 실행 사실이 사라진다`);
  const 신분 = 중간.map((e) => e.payload?.step);
  assert.equal(new Set(신분).size, 2, `실행 신분이 겹친다: ${JSON.stringify(신분)}`);
});
