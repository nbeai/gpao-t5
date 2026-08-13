// 터미널 descriptor 는 손 전체를 `reversible:false` 로 선언한다. 하지만 예산이 세야 하는 것은
// 손 이름이 아니라 **이번 실제 호출의 효과**다. 읽기·probe·명령 부재 실패가 좁은 예산 3을
// 먹으면, 바로 다음의 다른 대안이 실행되지 않고 사용자에게 명령이 넘어간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const 작업계약답 = (tc) => tc?.workContractAssessment
  ? { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] }
  : null;

async function 읽기무대({ calls }) {
  const dir = await mkdtemp(join(tmpdir(), 'terminal-effect-budget-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 실행 = [];
  const 본문맥 = [];
  const localTerminal = {
    async probe(command) {
      const exitCode = command === 'missing-runtime' ? 127 : 0;
      return {
        command, cwd: dir, changes: false,
        probe: { exitCode, stdout: '', stderr: exitCode ? 'not found' : '', mode: 'probe' },
      };
    },
    async handler(args) {
      실행.push(args.command);
      const exitCode = args.command === 'missing-runtime' ? 127 : 0;
      return {
        result: { command: args.command, cwd: dir, exitCode, stdout: '', stderr: exitCode ? 'not found' : '', applied: false },
        userSafeSummary: exitCode ? '그 실행 파일이 없어요.' : '확인만 했어요.',
      };
    },
  };
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      본문맥.push(structuredClone(tc));
      const 계약 = 작업계약답(tc);
      if (계약) return 계약;
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: calls.map((command, i) => ({
          providerCallId: `read_${i}`, name: 'local.terminal', args: { command },
        })) };
      }
      return '확인했어요.';
    },
  };
  return {
    dir, 실행, 본문맥,
    ctx: { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model },
  };
}

test('읽기·probe·exit 127은 되돌릴 수 없는 예산을 쓰지 않아 같은 턴의 다른 대안이 실행된다', async () => {
  const 무대 = await 읽기무대({
    calls: ['inspect-one', 'inspect-two', 'missing-runtime', 'alternative-path', 'inspect-five', 'inspect-six'],
  });
  const 이전 = process.env.GPAO_T5_TURN_IRREVERSIBLE;
  process.env.GPAO_T5_TURN_IRREVERSIBLE = '3';
  try {
    await runTurn({ text: '상태를 확인하고 한 방법이 없으면 다른 방법으로 이어가' }, 무대.ctx);
  } finally {
    if (이전 === undefined) delete process.env.GPAO_T5_TURN_IRREVERSIBLE;
    else process.env.GPAO_T5_TURN_IRREVERSIBLE = 이전;
  }

  assert.deepEqual(무대.실행,
    ['inspect-one', 'inspect-two', 'missing-runtime', 'alternative-path', 'inspect-five', 'inspect-six'],
    '실제 변경이 없는 호출이 좁은 예산을 먹어 5개 이상 안전한 조사가 잘렸다');
  assert.equal(무대.ctx.그밖수 ?? 0, 0, '읽기·명령 부재 실패가 되돌릴 수 없는 외부효과로 세어졌다');
  const 효과가간문맥 = 무대.본문맥.filter((tc) => tc.turnBudget || tc.guardrailNotes?.length);
  const 첫판 = 효과가간문맥.find((tc) => tc.toolStepsLeft === 40 && tc.turnBudget);
  assert.equal(첫판?.turnBudget?.그밖예산 - 첫판?.turnBudget?.그밖쓴것, 3,
    '첫 판믐터 총 걸음과 위험별 잔량을 따로 공급해야 한다');
  assert.ok(효과가간문맥.some((tc) => tc.turnBudget?.그밖쓴것 === 0 && tc.toolStepsLeft > 0),
    '모델에게 실제 잔여 예산이 가지 않았다');
  const 마지막예산 = 효과가간문맥.findLast((tc) => tc.turnBudget);
  assert.ok(마지막예산.toolStepsLeft >= 5,
    `읽기를 더 실행할 수 있는데 비가역 잔량 3을 총 걸음으로 알렸다: ${마지막예산.toolStepsLeft}`);
  assert.equal(마지막예산.turnBudget.그밖예산 - 마지막예산.turnBudget.그밖쓴것, 3,
    '비가역 위험 잔량은 총 걸음과 별도 사실로 보존해야 한다');
  assert.ok(효과가간문맥.some((tc) => tc.guardrailNotes?.some((n) => n.종류 === '실행효과'
    && /실제 변경 효과가 없/.test(n.사람말))),
  '모델에게 실제 명령 효과 분류가 가지 않았다');
});

test('혼합 행렬: 변경 0 읽기 5개 뒤 비가역 효과 3개를 정확히 센다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terminal-effect-mixed-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 실행 = [];
  const localTerminal = {
    async probe(command) {
      return { command, cwd: dir, changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } };
    },
    async handler(args) {
      실행.push(args.command);
      const applied = args.command.startsWith('future-effect-');
      return {
        result: { command: args.command, cwd: dir, exitCode: 0, stdout: '', stderr: '', applied },
        userSafeSummary: applied ? '외부 효과가 생겼어요.' : '확인만 했어요.',
      };
    },
  };
  const calls = [
    ...Array.from({ length: 5 }, (_, i) => `safe-read-${i}`),
    ...Array.from({ length: 3 }, (_, i) => `future-effect-${i}`),
  ];
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      const 계약 = 작업계약답(tc);
      if (계약) return 계약;
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: calls.map((command, i) => ({
          providerCallId: `mixed_${i}`, name: 'local.terminal', args: { command },
        })) };
      }
      return '정리했어요.';
    },
  };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model };
  const 이전 = process.env.GPAO_T5_TURN_IRREVERSIBLE;
  process.env.GPAO_T5_TURN_IRREVERSIBLE = '3';
  try {
    await runTurn({ text: '안전한 조사 후 효과가 있는 일을 한도 내에서 진행해' }, ctx);
  } finally {
    if (이전 === undefined) delete process.env.GPAO_T5_TURN_IRREVERSIBLE;
    else process.env.GPAO_T5_TURN_IRREVERSIBLE = 이전;
  }
  assert.deepEqual(실행, calls, '안전한 읽기가 위험 잔량을 먹거나 비가역 효과가 빠졌다');
  assert.equal(ctx.그밖수, 3);
  assert.equal(ctx.되돌릴수있는것수 ?? 0, 0);
});

for (const 시나리오 of [{
  이름: '비가역 상한 뒤의 안전한 읽기는 계속 실행되고 네 번째 비가역 호출만 막힌다',
  calls: ['future-effect-0', 'future-effect-1', 'future-effect-2', 'safe-read-after-limit', 'future-effect-3'],
}, {
  이름: '안전한 읽기 다섯 번 뒤에도 비가역 호출은 셋만 실행되고 네 번째만 막힌다',
  calls: ['safe-read-0', 'safe-read-1', 'safe-read-2', 'safe-read-3', 'safe-read-4',
    'future-effect-0', 'future-effect-1', 'future-effect-2', 'future-effect-3'],
}]) test(시나리오.이름, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terminal-effect-after-limit-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 실행 = [];
  const 본문맥 = [];
  const localTerminal = {
    async probe(command) {
      const changes = command.startsWith('future-effect-');
      return { command, cwd: dir, changes, probe: { exitCode: changes ? 1 : 0, stdout: '', stderr: '' } };
    },
    async handler(args) {
      실행.push(args.command);
      const applied = args.command.startsWith('future-effect-');
      return {
        result: { command: args.command, cwd: dir, exitCode: 0, stdout: applied ? '' : '확인 결과', stderr: '', applied },
        userSafeSummary: applied ? '외부 효과가 생겼어요.' : '확인 결과를 읽었어요.',
      };
    },
  };
  const calls = 시나리오.calls;
  let 다음 = 0;
  const model = {
    async respond(tc, opts = {}) {
      본문맥.push(structuredClone(tc));
      const 계약 = 작업계약답(tc);
      if (계약) return 계약;
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && 다음 < calls.length) {
        const command = calls[다음++];
        return { text: '', toolCalls: [{
          providerCallId: `after_limit_${다음}`, name: 'local.terminal', args: { command },
        }] };
      }
      return '확인 결과까지 반영해 정리했어요.';
    },
  };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model };
  const 이전 = process.env.GPAO_T5_TURN_IRREVERSIBLE;
  process.env.GPAO_T5_TURN_IRREVERSIBLE = '3';
  let 결과;
  try {
    결과 = await runTurn({ text: '세 번 변경한 뒤 상태를 읽고, 허용 범위를 넘는 변경은 하지 마' }, ctx);
    for (let i = 0; i < 4 && 결과.kind === 'approval'; i += 1) {
      결과 = await runTurn({ approve: 결과.pendingId }, ctx);
    }
  } finally {
    if (이전 === undefined) delete process.env.GPAO_T5_TURN_IRREVERSIBLE;
    else process.env.GPAO_T5_TURN_IRREVERSIBLE = 이전;
  }

  assert.deepEqual(실행, calls.slice(0, -1),
    '위험 상한이 턴 전체를 닫아 안전한 읽기까지 막았거나 네 번째 비가역 호출을 실행했다');
  assert.equal(ctx.그밖수, 3);
  assert.ok([...(결과.ledger?.confirmed ?? []), ...(결과.ledger?.estimated ?? [])]
    .some((s) => /확인 결과/.test(s)),
    '상한 뒤 안전한 읽기 결과가 원장에 도달하지 않았다');
  assert.ok((결과.ledger?.unconfirmed ?? []).some((s) => /되돌리기 어려운 일/.test(s)),
    '네 번째 비가역 호출이 blocked 사실로 남지 않았다');
  assert.ok(본문맥.some((tc) => tc.turnExchange?.some((r) => r.args?.command?.startsWith('safe-read')
    && /확인 결과/.test(r.data ?? ''))),
    '상한 뒤 안전한 읽기 결과가 모델 입력에 도달하지 않았다');
  assert.match(결과.reply ?? '', /확인 결과/, '상한 뒤 읽은 사실이 최종 답에 도달하지 않았다');
});

test('같은 명령의 정확한 재시도는 실행 0, 다른 대안은 남은 예산으로 실행한다', async () => {
  const 무대 = await 읽기무대({ calls: ['same-inspection', 'same-inspection', 'different-alternative'] });
  await runTurn({ text: '같은 확인은 반복하지 말고 다른 길로 이어가' }, 무대.ctx);
  assert.deepEqual(무대.실행, ['same-inspection', 'different-alternative']);
  assert.equal(무대.ctx.그밖수 ?? 0, 0);
});

test('실제 쓰기 명령은 승인 뒤에만 실행되고 되돌릴 수 없는 예산을 그대로 쓴다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terminal-effect-write-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  let 실행수 = 0;
  const localTerminal = {
    async probe(command) {
      return { command, cwd: dir, changes: true, probe: { exitCode: 1, stderr: 'blocked', mode: 'probe' } };
    },
    async handler(args) {
      실행수 += 1;
      return {
        result: { command: args.command, cwd: dir, exitCode: 0, stdout: '', stderr: '', applied: true },
        userSafeSummary: '실행했어요.',
      };
    },
  };
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      const 계약 = 작업계약답(tc);
      if (계약) return 계약;
      if (tc?.currentActionAssessment) return { text: '', toolCalls: [{
        name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        },
      }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'mutating-operation' } }] };
      }
      return '실행했어요.';
    },
  };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model };
  const 카드 = await runTurn({ text: '변경 작업을 실행해' }, ctx);
  assert.equal(카드.kind, 'approval');
  assert.equal(실행수, 0, '승인 전에 실제 쓰기가 실행됐다');
  await runTurn({ approve: 카드.pendingId }, ctx);
  assert.equal(실행수, 1);
  assert.equal(ctx.그밖수, 1, '실제 쓰기가 좁은 외부효과 예산에서 빠졌다');
});
