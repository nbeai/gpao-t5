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
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

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

test('상한을 넘겨 계속 돌지 않는다', async () => {
  const 손 = 기록하는손();
  const 많이 = Array.from({ length: 20 }, (_, i) => 명령(`echo ${i}`));
  await runTurn({ text: '계속해' }, ctx(걸음마다(많이), 손));
  // 상한 자체가 계약이다(무한 루프 방지). 수치는 MAX_TOOL_STEPS 설계값(6)+계획 1걸음을 따른다 —
  // H08 실측으로 4→6 상향(2026-08-01, 실제 파일 목적이 4걸음을 정직하게 넘었다).
  assert.ok(손.불린것.length <= 7, `상한이 안 먹는다(${손.불린것.length}걸음) — 한 턴이 끝없이 길어진다`);
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
