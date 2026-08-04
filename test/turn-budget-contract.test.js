// **예산 구속 계약 반대시험** — 오너 지시 2026-08-04, 네 항목.
//
//   ① 왕복은 이 작업의 **모든 모델 호출**이고 승인 재개에도 누적한다.
//   ② 예산 소진은 `cancelled` 가 아니다. 못 한 호출은 미완료 사실로 남아
//      `unresolved` 와 working state 에서 사라지면 안 된다.
//   ③ 남은 큐는 **임의의 다음 발화에 붙어 실행되지 않는다.** 새 요청이 우선하고,
//      옛 큐가 현재 요청을 침해하는 실행은 **절대 0**이다.
//   ④ `reversible` 두 칸은 비용 모델이 아니라 **외부효과 폭주 뒷단**이다. 긴 실행은
//      벽시계와 사용자 취소가 **큐 전체에** 전파돼야 한다.
//
// 기존 Authority · 호출별 ToolReceipt · 순서 · providerCallId · 중복 방지는 그대로 선다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 파일 N개와 목적지 폴더가 있는 무대. */
async function 파일무대(n) {
  const dir = await mkdtemp(join(tmpdir(), 'budget-c-'));
  await mkdir(join(dir, '모음'), { recursive: true });
  const 파일들 = Array.from({ length: n }, (_, i) => `자료-${String(i).padStart(3, '0')}.txt`);
  for (const f of 파일들) await writeFile(join(dir, f), `내용 ${f}`);
  return { dir, 파일들, localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) };
}

/** 심문에 정직하게 답하고, 첫 응답에 `내는것(dir)` 을 한꺼번에 내는 대본 모델. */
function 대본(내는것) {
  let 냈나 = false;
  const 부른것 = [];
  const model = {
    async respond(tc, opts = {}) {
      부른것.push(tc?.workContractAssessment ? '완료계약'
        : tc?.currentActionAssessment ? '현재행동'
          : opts.tools?.length ? '계획/걸음' : '답');
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && !냈나) { 냈나 = true; return { text: '', toolCalls: 내는것() }; }
      return '했어요.';
    },
  };
  return { model, 부른것 };
}

const 이동호출 = (dir, 파일들) => 파일들.map((f, i) => ({
  providerCallId: `call_${i}`, name: 'local.file',
  args: { action: 'move', path: join(dir, f), to: join(dir, '모음', f) },
}));

// ── ① 왕복은 모든 모델 호출이다 ────────────────────────────────────────────
test('① 왕복 예산은 심문·계획·최종 답까지 전부 센다', async () => {
  const { dir, 파일들, localFile } = await 파일무대(3);
  const { model, 부른것 } = 대본(() => 이동호출(dir, 파일들));
  const 원래 = process.env.GPAO_T5_TURN_ROUNDTRIPS;
  process.env.GPAO_T5_TURN_ROUNDTRIPS = '3';
  try {
    await runTurn({ text: '자료 옮겨줘' }, { env: demoEnv(), tools: demoTools({ localFile }), model });
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_TURN_ROUNDTRIPS;
    else process.env.GPAO_T5_TURN_ROUNDTRIPS = 원래;
  }
  // 심문 두 종이 왕복에 안 잡히면 3 예산에서 모델이 4번 넘게 불린다.
  assert.ok(부른것.length <= 4,
    `왕복 예산 3인데 모델을 ${부른것.length}번 불렀다(${부른것.join(' → ')}) — 심문이 예산 밖에 있다`);
  assert.ok(부른것.includes('현재행동') || 부른것.includes('완료계약'),
    '이 대본으로는 심문이 안 돌아 ①을 못 잰다');
});

test('① 승인 재개는 왕복을 **이어받는다**(리셋하면 예산이 무한이 된다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'budget-resume-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const localTerminal = {
    async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '했어요.' }; },
  };
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{ providerCallId: 'call_A', name: 'local.terminal', args: { command: 'rm -rf 임시' } }] };
      }
      return '했어요.';
    },
  };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model };
  const 카드 = await runTurn({ text: '임시 지워줘' }, ctx);
  assert.equal(카드.kind, 'approval', '이 시험은 승인 카드가 떠야 성립한다');
  const 카드시점 = ctx.왕복수;
  assert.ok(카드시점 > 0, '왕복이 안 세어졌다');
  await runTurn({ approve: 카드.pendingId }, ctx);
  assert.ok(ctx.왕복수 > 카드시점,
    `승인 재개에서 왕복이 ${카드시점} → ${ctx.왕복수} 로 누적되지 않았다 — 카드가 여러 번이면 예산이 무한이다`);
});

test('① 새 발화는 예산을 새로 연다(옛 요청의 소비가 새 요청을 굶기지 않는다)', async () => {
  const { dir, 파일들, localFile } = await 파일무대(2);
  const { model } = 대본(() => 이동호출(dir, 파일들));
  const ctx = { env: demoEnv(), tools: demoTools({ localFile }), model };
  await runTurn({ text: '자료 옮겨줘' }, ctx);
  const 첫턴 = ctx.왕복수;
  assert.ok(첫턴 > 0);
  await runTurn({ text: '고마워' }, ctx);
  assert.ok(ctx.왕복수 < 첫턴 + 첫턴, `새 발화에서 왕복이 안 초기화됐다(${ctx.왕복수})`);
});

// ── ② 예산 소진은 취소가 아니다 ────────────────────────────────────────────
test('② 예산으로 못 한 호출은 **미완료 사실**로 남는다(unresolved·working state)', async () => {
  const { dir, 파일들, localFile } = await 파일무대(20);
  const { model } = 대본(() => 이동호출(dir, 파일들));
  const 원래 = process.env.GPAO_T5_TURN_REVERSIBLE;
  process.env.GPAO_T5_TURN_REVERSIBLE = '5';
  let r;
  try {
    r = await runTurn({ text: '자료 옮겨줘' }, { env: demoEnv(), tools: demoTools({ localFile }), model });
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_TURN_REVERSIBLE;
    else process.env.GPAO_T5_TURN_REVERSIBLE = 원래;
  }
  const 옮겨진것 = 파일들.filter((f) => existsSync(join(dir, '모음', f)));
  assert.ok(옮겨진것.length >= 4 && 옮겨진것.length <= 6,
    `외부효과 뒷단 5가 안 물었다(${옮겨진것.length}개 이동)`);
  // **unresolved 에 남아야 한다** — cancelled 로 두면 "이미 된 일"과 같은 자리에 들어간다.
  assert.ok(r.ledger.unconfirmed.length > 0,
    `못 한 일이 미완료로 안 남았다: ${JSON.stringify(r.ledger)}`);
  assert.ok(r.ledger.unconfirmed.some((s) => s.includes('남겨') || s.includes('멈췄')),
    `왜 못 했는지가 사용자면에 없다: ${JSON.stringify(r.ledger.unconfirmed.slice(0, 3))}`);
  // working state 에도 남아야 다음 턴이 이어받는다.
  assert.ok(r.workingState?.blocked, '중간에 멈춘 사실이 현재 상태에서 사라졌다');
});

test('② 못 한 호출도 순번·신분과 함께 남는다(순서를 잃지 않는다)', async () => {
  const { dir, 파일들, localFile } = await 파일무대(12);
  const { model } = 대본(() => 이동호출(dir, 파일들));
  const 원래 = process.env.GPAO_T5_TURN_REVERSIBLE;
  process.env.GPAO_T5_TURN_REVERSIBLE = '3';
  const 원장 = [];
  try {
    await runTurn({ text: '자료 옮겨줘' },
      { env: demoEnv(), tools: demoTools({ localFile }), model, ledger: { entries: 원장, append: (x) => 원장.push(x) } });
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_TURN_REVERSIBLE;
    else process.env.GPAO_T5_TURN_REVERSIBLE = 원래;
  }
  const 못한것 = 원장.filter((e) => (e.failureState ?? 'none') !== 'none');
  assert.ok(못한것.length > 0, '예산으로 못 한 호출이 원장에 없다');
  assert.ok(못한것.every((e) => e.failureState !== 'cancelled'),
    '예산 소진을 cancelled 로 적었다 — 미완료가 "이미 된 일"과 같은 자리에 들어간다');
  // 신분은 `제안한호출` 에 남는다 — 부르지 않은 것을 "실제 호출"로 적으면 원장이 거짓이 된다.
  assert.ok(못한것.every((e) => e.actualCall === null),
    '부르지 않은 호출이 "실제 호출"로 기록됐다');
  assert.ok(못한것.some((e) => e.제안한호출?.providerCallId?.startsWith('call_')),
    '모델이 낸 신분이 못 한 호출에서 사라졌다');
  assert.ok(못한것.some((e) => Number.isInteger(e.diagnosticTrace?.순번)), '순번이 사라졌다');
});

// ── ③ 남은 큐가 다음 발화를 침해하지 않는다 ────────────────────────────────
test('③ 남은 큐는 **다음 발화에 붙어 실행되지 않는다**(침해 절대 0)', async () => {
  const { dir, 파일들, localFile } = await 파일무대(20);
  const 실행된인자 = [];
  const 원핸들러 = localFile.handler.bind(localFile);
  localFile.handler = async (a) => { 실행된인자.push(a); return 원핸들러(a); };
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && !냈나) { 냈나 = true; return { text: '', toolCalls: 이동호출(dir, 파일들) }; }
      return '했어요.';
    },
  };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile }), model };
  const 원래 = process.env.GPAO_T5_TURN_REVERSIBLE;
  process.env.GPAO_T5_TURN_REVERSIBLE = '4';
  try {
    await runTurn({ text: '자료 옮겨줘' }, ctx);
    const 첫턴이동 = 실행된인자.filter((a) => a.action === 'move').length;
    assert.ok(첫턴이동 >= 3 && 첫턴이동 <= 5, `첫 턴 이동이 예산과 안 맞는다: ${첫턴이동}`);

    // **전혀 다른 요청**이 온다. 남은 16개가 여기 붙어 돌면 안 된다.
    실행된인자.length = 0;
    await runTurn({ text: '오늘 날씨 어때?' }, ctx);
    assert.deepEqual(실행된인자.filter((a) => a.action === 'move'), [],
      `옛 큐가 새 요청에 붙어 실행됐다 — 사용자가 시키지 않은 파일이 움직였다: ${JSON.stringify(실행된인자)}`);
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_TURN_REVERSIBLE;
    else process.env.GPAO_T5_TURN_REVERSIBLE = 원래;
  }
});

// ── ④ 외부효과 뒷단 · 벽시계 · 취소 ────────────────────────────────────────
test('④ 되돌릴 수 없는 손은 **좁게** 잡힌다(비용이 아니라 외부효과다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'budget-irrev-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 돈것 = [];
  const localTerminal = {
    async probe(command) { return { command, cwd: dir, changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { 돈것.push(a.command); return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '했어요.' }; },
  };
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: Array.from({ length: 8 }, (_, i) => ({
          providerCallId: `call_${i}`, name: 'local.terminal', args: { command: `echo ${i}` },
        })) };
      }
      return '했어요.';
    },
  };
  const 원래 = process.env.GPAO_T5_TURN_IRREVERSIBLE;
  process.env.GPAO_T5_TURN_IRREVERSIBLE = '2';
  try {
    await runTurn({ text: '여덟 개 돌려줘' }, { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model });
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_TURN_IRREVERSIBLE;
    else process.env.GPAO_T5_TURN_IRREVERSIBLE = 원래;
  }
  assert.ok(돈것.length <= 2,
    `되돌릴 수 없는 손이 ${돈것.length}번 돌았다 — 외부효과 뒷단이 안 문다: ${돈것.join(', ')}`);
});

test('④ 사용자 취소는 **큐 전체**를 세운다(도구 timeout 으로는 못 잡는 자리)', async () => {
  const { dir, 파일들, localFile } = await 파일무대(20);
  let 취소됨 = false;
  const 원핸들러 = localFile.handler.bind(localFile);
  const 실행수 = { n: 0 };
  localFile.handler = async (a) => {
    실행수.n += 1;
    if (실행수.n === 3) 취소됨 = true; // 사용자가 세 번째쯤 "멈춰"를 눌렀다
    return 원핸들러(a);
  };
  const { model } = 대본(() => 이동호출(dir, 파일들));
  await runTurn({ text: '자료 옮겨줘' }, {
    env: demoEnv(), tools: demoTools({ localFile }), model,
    취소됐나: () => 취소됨,
  });
  assert.ok(실행수.n <= 4,
    `"멈춰" 뒤에도 손이 계속 움직였다(${실행수.n}번) — 취소가 큐에 전파되지 않는다`);
  assert.ok(실행수.n >= 3, '이 시험이 성립하려면 취소 전에 몇 걸음은 돌아야 한다');
});

test('④ 벽시계가 다 되면 큐가 선다(각 도구는 빨라도 합이 길면 사용자는 기다린다)', async () => {
  const { dir, 파일들, localFile } = await 파일무대(20);
  let 시각 = 0;
  const 원핸들러 = localFile.handler.bind(localFile);
  localFile.handler = async (a) => { 시각 += 1000; return 원핸들러(a); }; // 걸음마다 1초
  const { model } = 대본(() => 이동호출(dir, 파일들));
  const 원래 = process.env.GPAO_T5_TURN_WALLCLOCK_MS;
  process.env.GPAO_T5_TURN_WALLCLOCK_MS = '4000';
  try {
    await runTurn({ text: '자료 옮겨줘' }, {
      env: demoEnv(), tools: demoTools({ localFile }), model, now: () => 시각,
    });
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_TURN_WALLCLOCK_MS;
    else process.env.GPAO_T5_TURN_WALLCLOCK_MS = 원래;
  }
  const 옮겨진것 = 파일들.filter((f) => existsSync(join(dir, '모음', f)));
  assert.ok(옮겨진것.length <= 5,
    `벽시계 4초인데 ${옮겨진것.length}개(=${옮겨진것.length}초)를 돌았다 — 큐 전체 시간이 안 잡힌다`);
});

// ── 열지 않은 것: 기존 경계는 그대로 ───────────────────────────────────────
test('예산이 커져도 승인 경계는 그대로다 — 되돌릴 수 없는 것은 여전히 묻는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'budget-auth-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  let 돌았나 = 0;
  const localTerminal = {
    async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { 돌았나 += 1; return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '했어요.' }; },
  };
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{ providerCallId: 'c1', name: 'local.terminal', args: { command: 'rm -rf 임시폴더' } }] };
      }
      return '했어요.';
    },
  };
  const r = await runTurn({ text: '임시폴더 지워줘' }, { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model });
  assert.equal(r.kind, 'approval', '예산을 키우자 승인 경계가 새어 나갔다');
  assert.equal(돌았나, 0, '승인 전 효과 0 이 무너졌다');
});

// ── 산출물 이어가기가 **없는 진전을 짜내지 않는다** ────────────────────────
//
// 라이브 실측(2026-08-04, 재봉인 관통 A팔): 정리 요청에 FILE 계약이 서자 이어가기가
// `unmetDeliverable` 을 계속 밀었고, 모델은 **같은 bulk_move 를 여덟 번** 냈다.
// 중복 차단이 매번 막아 실물은 안전했지만 왕복 8개와 원장 8줄이 그냥 탔다.
// 그 턴의 이동은 261 에서 멈췄다 — 같은 문장·다른 턴에서는 367 이었다.
//
// 멈추는 근거는 판단이 아니라 **기계 사실**이다: 이미 이 턴에서 돈 지문을 그대로 다시 냈다.
test('이어가기: 모델이 **같은 실행만** 다시 내면 밀어붙이지 않는다', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'budget-nodup-')));
  await writeFile(join(dir, '가.txt'), 'x');
  let 밀린수 = 0;
  const 같은호출 = { name: 'local.file', args: { action: 'write', path: join(dir, '결과.md'), text: '정리' } };
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      if (tc?.unmetDeliverable) { 밀린수 += 1; return { text: '', toolCalls: [같은호출] }; }
      if (tc?.completionMismatch) return '아직 못 끝냈어요.';
      if (opts.tools?.length && !this.냈나) { this.냈나 = true; return { text: '', toolCalls: [같은호출] }; }
      return '했어요.';
    },
  };
  await runTurn({ text: '정리해서 결과.md 로 남겨줘' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });
  assert.ok(밀린수 <= 1,
    `같은 실행만 내는 모델을 ${밀린수}번 더 밀었다 — 왕복과 원장만 타고 진전은 0이다`);
});
