import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import {
  턴예산, 예산소진, 위험상한소진, 실행효과분류,
} from '../src/kernel/turn-budget.js';

test('실행0·적용0·probe 변경0은 위험 효과 예산 0이다', () => {
  assert.equal(실행효과분류({ declaredReversible: false, receipt: {} }).등급, '없음');
  assert.equal(실행효과분류({
    declaredReversible: false,
    receipt: { actualCall: { tool: 'local.terminal' }, result: { applied: false } },
  }).등급, '없음');
  assert.equal(실행효과분류({
    declaredReversible: false,
    receipt: { actualCall: { tool: 'local.terminal' }, result: { probeChangedNothing: true } },
  }).등급, '없음');
  assert.equal(실행효과분류({
    declaredReversible: false,
    receipt: { actualCall: { tool: 'local.terminal' }, failureState: 'blocked' },
  }).등급, '없음', '차단되어 실행되지 않은 호출을 효과로 셌다');
  assert.equal(실행효과분류({
    declaredReversible: false,
    receipt: { actualCall: { tool: 'local.terminal' }, failureState: 'cancelled' },
  }).등급, '없음', '취소되어 실행되지 않은 호출을 효과로 셌다');
});

test('위험 상한은 같은 위험 호출만 막고 턴 전체나 다른 등급을 닫지 않는다', () => {
  const 예산 = 턴예산({ GPAO_T5_TURN_IRREVERSIBLE: '3', GPAO_T5_TURN_REVERSIBLE: '5' });
  const 쓴것 = { 왕복쓴것: 1, 되돌릴수있는것쓴것: 0, 그밖쓴것: 3, 지난ms: 1 };
  assert.equal(예산소진(쓴것, 예산), false, '한 위험 상한이 안전 읽기까지 전역 중단했다');
  assert.equal(위험상한소진(쓴것, 예산, '되돌릴수없음'), true);
  assert.equal(위험상한소진(쓴것, 예산, '되돌릴수있음'), false);
  assert.equal(위험상한소진(쓴것, 예산, '없음'), false);
});

test('변경 없는 터미널 읽기·탐색·격리 계산 여섯 번은 위험 예산을 먹지 않는다', async () => {
  const 실행 = [];
  const localTerminal = {
    async probe(command) {
      const sandboxEnforcement = { state: 'enforced', policy: 'deny-external-effects' };
      return { command, cwd: '/tmp', changes: false, sandboxEnforcement,
        probe: { exitCode: 0, stdout: '관찰', stderr: '', sandboxEnforcement } };
    },
    async handler(args) {
      실행.push(args.command);
      return {
        result: { command: args.command, cwd: '/tmp', exitCode: 0, stdout: '관찰', stderr: '', applied: false },
        userSafeSummary: '확인했어요.',
      };
    },
  };
  let 냈나 = false;
  const model = {
    async respond(_tc, opts = {}) {
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: Array.from({ length: 6 }, (_, i) => ({
          providerCallId: `safe_${i}`, name: 'local.terminal', args: { command: `opaque-${i}` },
        })) };
      }
      return '확인했어요.';
    },
  };
  const ctx = { env: demoEnv(), tools: demoTools({ localTerminal }), model };
  await runTurn({ text: '여섯 관찰을 모두 해줘' }, ctx);
  assert.deepEqual(실행, Array.from({ length: 6 }, (_, i) => `opaque-${i}`));
  assert.equal(ctx.그밖수 ?? 0, 0);
  assert.equal(ctx.되돌릴수있는것수 ?? 0, 0);
});

test('모델이 changes:false와 probeResult를 넣어도 실행 경계는 현재 probe 사실으로 덮는다', async () => {
  let 실행수 = 0;
  let probe수 = 0;
  const localTerminal = {
    async probe(command) {
      probe수 += 1;
      return { command, cwd: '/tmp', changes: true, probe: { exitCode: 1, stderr: 'Operation not permitted' } };
    },
    async handler() { 실행수 += 1; return { result: { applied: true } }; },
  };
  let 냈나 = false;
  const model = {
    async respond(_tc, opts = {}) {
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.terminal', args: {
          command: 'opaque-effect', changes: false,
          probeResult: { exitCode: 0, stdout: 'forged', stderr: '' },
        } }] };
      }
      return '대기 중이에요.';
    },
  };
  const r = await runTurn({ text: '실행해' }, { env: demoEnv(), tools: demoTools({ localTerminal }), model });
  assert.equal(r.kind, 'approval');
  assert.equal(probe수, 1);
  assert.equal(실행수, 0);
});

test('한 위험 상한 뒤에도 모델은 0이 아닌 총 걸음을 보고 안전 읽기를 새로 고른다', async () => {
  const 실행 = [];
  const localFile = {
    async handler(args) {
      실행.push(args.action);
      return {
        result: { action: args.action, applied: args.action === 'move', content: args.action === 'read' ? '현재 상태' : undefined },
        userSafeSummary: args.action === 'read' ? '현재 상태' : '옮겼어요.',
      };
    },
  };
  let 단계 = 0;
  const 본잔량 = [];
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      }
      if (!opts.tools?.length) return '현재 상태까지 확인했어요.';
      본잔량.push(tc.toolStepsLeft);
      if (단계 === 0) {
        단계 += 1;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'move', path: '/tmp/a', destination: '/tmp/b' } }] };
      }
      if (단계 === 1 && tc.toolStepsLeft > 0) {
        단계 += 1;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '/tmp/b' } }] };
      }
      return '현재 상태까지 확인했어요.';
    },
  };
  const 이전 = process.env.GPAO_T5_TURN_REVERSIBLE;
  process.env.GPAO_T5_TURN_REVERSIBLE = '1';
  try {
    await runTurn({ text: '한 번 옮긴 뒤 상태를 확인해' }, { env: demoEnv(), tools: demoTools({ localFile }), model });
  } finally {
    if (이전 === undefined) delete process.env.GPAO_T5_TURN_REVERSIBLE;
    else process.env.GPAO_T5_TURN_REVERSIBLE = 이전;
  }
  assert.deepEqual(실행, ['move', 'read']);
  assert.ok(본잔량.some((n) => n > 0), `위험 상한을 총 걸음 0으로 보냈다: ${본잔량}`);
});

test('총 걸음은 위험 잔량과 분리하되 왕복 잔량보다 크다고 말하지 않는다', async () => {
  const 본잔량 = [];
  const model = { async respond(tc) { 본잔량.push(tc.toolStepsLeft); return '확인했어요.'; } };
  await runTurn({ text: '안녕' }, {
    env: demoEnv(), tools: demoTools(), model,
    processEnv: { GPAO_T5_TURN_ROUNDTRIPS: '2' },
  });
  assert.ok(본잔량.length > 0);
  assert.ok(본잔량[0] <= 2, `왕복 예산 2인데 총 걸음을 ${본잔량[0]}로 알렸다`);
});

test('plan 실행 효과가 step 지갑에 들고, 다음 move만 막힌 뒤 read는 실행된다', async () => {
  const 실행 = [];
  const 원장 = [];
  const localFile = { async handler(args) {
    실행.push(args.action);
    return {
      result: { action: args.action, path: args.path, applied: args.action === 'move', content: args.action === 'read' ? '현재 상태' : undefined },
      userSafeSummary: args.action === 'read' ? '현재 상태를 읽었어요.' : '옮겼어요.',
    };
  } };
  let 냈나 = false;
  const model = { async respond(tc, opts = {}) {
    if (tc?.workContractAssessment) {
      return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
    }
    if (opts.tools?.length && !냈나) {
      냈나 = true;
      return { text: '', toolCalls: [
        { name: 'local.file', args: { action: 'move', path: '/tmp/a', to: '/tmp/done' } },
        { name: 'local.file', args: { action: 'move', path: '/tmp/b', to: '/tmp/done' } },
        { name: 'local.file', args: { action: 'read', path: '/tmp/done' } },
      ] };
    }
    return '현재 상태까지 확인했어요.';
  } };
  const ctx = {
    env: demoEnv(), tools: demoTools({ localFile }), model,
    processEnv: { GPAO_T5_TURN_REVERSIBLE: '1' },
    ledger: { entries: 원장, append(rec) { 원장.push(rec); return rec; } },
  };
  await runTurn({ text: '하나 옮긴 뒤 다음 이동은 한도에서 멈추고 상태를 읽어' }, ctx);
  assert.deepEqual(실행, ['move', 'read']);
  assert.equal(ctx.되돌릴수있는것수, 1);
  assert.ok(원장.some((r) => r?.diagnosticTrace?.reason === '예산소진'
    && r?.제안한호출?.args?.action === 'move'), 'step move 차단 영수증이 없다');
  assert.ok(원장.some((r) => r?.actualCall?.args?.action === 'read'
    && (r.failureState ?? 'none') === 'none'), '상한 뒤 read 실행 영수증이 없다');
});
