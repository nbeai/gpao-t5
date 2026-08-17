import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createModelCallAccounting,
  instrumentModelCalls,
  MODEL_CALL_PURPOSES,
  restoreModelCallAccounting,
} from '../src/runtime/model-call-accounting.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { dumpModelCallMetric, markInterruptedModelCalls } from '../src/runtime/prompt-dump.js';

const packet = { currentRequest: '민감한 사용자 원문', identity: { name: 'T5' } };

test('논리 respond 한 번을 purpose·차선·실제 usage·TTFT와 함께 한 건으로 닫는다', async () => {
  let delta;
  const model = {
    async respond(_tc, opts) {
      opts.onCallIdentity?.({
        selection: { provider: 'openai', requestModelId: 'gpt-test', generation: 7 },
        actualRequestModelId: 'gpt-test', responseModelId: 'gpt-test-2026',
        usage: {
          prompt_tokens: 11, completion_tokens: 5, total_tokens: 16,
          prompt_tokens_details: { cached_tokens: 3 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      });
      delta = () => opts.onDelta?.('첫 조각');
      delta();
      return '완료';
    },
  };
  const accounting = createModelCallAccounting({ lane: 'foreground', role: 'default', turnRef: 't-1' });
  const wrapped = instrumentModelCalls(model, () => accounting);
  assert.equal(await wrapped.respond(packet, { accountingPurpose: 'primary', onDelta: () => {} }), '완료');
  const [record] = accounting.records;
  assert.equal(record.purpose, 'primary');
  assert.equal(record.lane, 'foreground');
  assert.equal(record.status, 'succeeded');
  assert.equal(record.tokens.source, 'actual');
  assert.equal(record.tokens.coverage, 'reported_response');
  assert.deepEqual(record.tokens, {
    source: 'actual', coverage: 'reported_response', estimateVersion: null,
    input: 11, output: 5, total: 16, cacheRead: 3, cacheWrite: null, reasoning: 2,
  });
  assert.equal(record.provider, 'openai');
  assert.equal(record.requestModelId, 'gpt-test');
  assert.equal(record.connectionGeneration, 7);
  assert.equal(typeof record.durationMs, 'number');
  assert.equal(typeof record.ttftMs, 'number');
  assert.equal(record.upstreamAttempts, null, '공급자 내부 재시도를 논리 호출수로 지어내면 안 된다');
});

test('usage가 없으면 입력·출력을 추정하고, delta가 없으면 TTFT는 null이다', async () => {
  const model = { async respond(_tc, opts) {
    opts.onCallIdentity?.({ selection: { provider: 'anthropic', requestModelId: 'claude-test' }, usage: null });
    return { text: '짧은 답', toolCalls: [{ name: 'local.file', args: { action: 'list' } }] };
  } };
  const accounting = createModelCallAccounting({ lane: 'foreground' });
  const wrapped = instrumentModelCalls(model, () => accounting);
  await wrapped.respond(packet, { accountingPurpose: 'tool_loop', tools: [{ name: 'local.file' }] });
  const [record] = accounting.records;
  assert.equal(record.tokens.source, 'estimate');
  assert.equal(record.tokens.coverage, 'logical_respond');
  assert.equal(record.tokens.estimateVersion, 't5-char-v1');
  assert.ok(record.tokens.input > 0);
  assert.ok(record.tokens.output > 0);
  assert.equal(record.tokens.total, record.tokens.input + record.tokens.output);
  assert.equal(record.ttftMs, null, '스트림 조각이 없는데 전체 시간을 TTFT로 쓰면 안 된다');
  assert.ok(record.inputBreakdown.system >= 0);
  assert.ok(record.inputBreakdown.tools > 0);
});

test('requiredTool은 입력 추정에 포함되고 구성비가 추정임을 밝힌다', async () => {
  const call = async (requiredTool) => {
    const accounting = createModelCallAccounting();
    const wrapped = instrumentModelCalls({ async respond() { return 'ok'; } }, () => accounting);
    await wrapped.respond(packet, { accountingPurpose: 'required_tool_followup', requiredTool });
    return accounting.records[0];
  };
  const none = await call(undefined);
  const required = await call('local.file');
  assert.equal(none.inputBreakdown.requiredTool, 0);
  assert.ok(required.inputBreakdown.requiredTool > 0);
  assert.ok(required.tokens.input > none.tokens.input);
  assert.equal(required.inputBreakdownSource, 'estimate');
  assert.equal(required.inputBreakdownVersion, 't5-char-v1');
});

test('원래 없던 onDelta를 계측기가 만들지 않는다', async () => {
  let seen;
  const accounting = createModelCallAccounting();
  const wrapped = instrumentModelCalls({ async respond(_tc, opts) {
    seen = typeof opts.onDelta;
    return 'ok';
  } }, () => accounting);
  await wrapped.respond(packet, { accountingPurpose: 'welcome' });
  assert.equal(seen, 'undefined', '계측 때문에 provider가 streaming 경로로 바뀌었다');
  assert.equal(accounting.records[0].ttftMs, null);
});

test('같은 모델을 두 번 decorate해도 논리 호출·예산은 한 번만 센다', async () => {
  const accounting = createModelCallAccounting();
  let budget = 0;
  const once = instrumentModelCalls({ async respond() { return 'ok'; } }, () => accounting, () => { budget += 1; });
  const twice = instrumentModelCalls(once, () => accounting, () => { budget += 1; });
  await twice.respond(packet, { accountingPurpose: 'primary' });
  assert.equal(accounting.records.length, 1);
  assert.equal(budget, 1);
});

test('이미 감싼 모델을 다른 sink로 넘기면 새 sink에만 한 건 기록한다', async () => {
  const a = createModelCallAccounting({ turnRef: 'A' });
  const b = createModelCallAccounting({ turnRef: 'B' });
  let upstream = 0;
  const base = { async respond() { upstream += 1; return 'ok'; } };
  const wrappedA = instrumentModelCalls(base, () => a);
  const wrappedB = instrumentModelCalls(wrappedA, () => b);
  await wrappedB.respond(packet, { accountingPurpose: 'primary' });
  assert.equal(upstream, 1);
  assert.equal(a.records.length, 0, '이전 요청 sink로 오귀속됐다');
  assert.deepEqual(b.records.map((record) => record.turnRef), ['B']);
});

test('timeout·cancel·일반 실패를 finally에서 서로 다른 terminal 상태로 닫는다', async () => {
  const errors = [
    Object.assign(new Error('늦음'), { isModelTimeout: true }),
    Object.assign(new Error('중단'), { name: 'AbortError' }),
    new Error('고장'),
  ];
  const expected = ['timeout', 'cancelled', 'failed'];
  for (let i = 0; i < errors.length; i += 1) {
    const accounting = createModelCallAccounting({ lane: 'foreground' });
    const wrapped = instrumentModelCalls({ async respond() { throw errors[i]; } }, () => accounting);
    await assert.rejects(() => wrapped.respond(packet, { accountingPurpose: 'answer_retry' }));
    assert.equal(accounting.records[0].status, expected[i]);
    assert.equal(typeof accounting.records[0].durationMs, 'number');
    assert.equal(accounting.records[0].tokens.output, null, '실패 응답의 없는 출력 토큰을 0으로 지어냈다');
    assert.equal(accounting.records[0].tokens.total, null, '실패 호출의 전체 토큰은 provider usage 없이는 모른다');
  }
});

test('provider usage의 null과 실제 0을 구별한다', async () => {
  const accounting = createModelCallAccounting({ lane: 'foreground' });
  const wrapped = instrumentModelCalls({ async respond(_tc, opts) {
    opts.onCallIdentity?.({ usage: {
      input_tokens: 4, output_tokens: 0, cache_read_input_tokens: 0,
    } });
    return '';
  } }, () => accounting);
  await wrapped.respond(packet, { accountingPurpose: 'primary' });
  assert.equal(accounting.records[0].tokens.output, 0);
  assert.equal(accounting.records[0].tokens.cacheRead, 0);
  assert.equal(accounting.records[0].tokens.cacheWrite, null);
  assert.equal(accounting.records[0].tokens.reasoning, null);
});

test('덤프는 await 전에 started를 남기고 원문·응답·비밀을 기록하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-call-accounting-'));
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const accounting = createModelCallAccounting({ lane: 'foreground', env: { GPAO_T5_PROMPT_DUMP: dir } });
  const wrapped = instrumentModelCalls({ async respond() { await wait; return '비밀 응답'; } }, () => accounting);
  const pending = wrapped.respond({ currentRequest: 'sk-live-12345678901234567890' }, {
    accountingPurpose: 'primary',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const startedPath = accounting.dumpPaths[0];
  const started = JSON.parse(await readFile(startedPath, 'utf8'));
  assert.equal(started.status, 'started');
  assert.equal(JSON.stringify(started).includes('sk-live'), false);
  assert.equal(JSON.stringify(started).includes('비밀 응답'), false);
  release();
  await pending;
  assert.equal(accounting.records[0].status, 'succeeded');
  assert.equal(accounting.dumpPaths.length, 1, 'started와 terminal을 호출 두 건처럼 만들었다');
  assert.equal((await readdir(dir)).length, 1, 'callId 하나가 파일 두 개로 늘었다');
  assert.equal(JSON.parse(await readFile(accounting.dumpPaths[0], 'utf8')).status, 'succeeded');
});

test('metric dump 경계가 호출자가 보탠 원문 필드를 폐기한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-call-safe-dump-'));
  const path = await dumpModelCallMetric({
    callId: 'call-safe', sequence: 1, purpose: 'primary', status: 'started',
    rawPrompt: 'sk-live-12345678901234567890', errorMessage: '민감한 오류 원문',
    inputBreakdown: { system: 3, user: 'sk-live-중첩원문', surprise: '민감한 추가 필드' },
    tokens: { source: 'estimate', input: 3, note: '민감한 원문' },
    requestModelId: 'sk-live-12345678901234567890',
    responseModelId: 'model-safe-name',
    inputBreakdownSource: 'sk-live-최상위비밀12345678901234567890',
    inputBreakdownVersion: '민감한 버전 원문',
    durationMs: 'sk-live-duration-12345678901234567890',
    ttftMs: { raw: '민감한 TTFT' },
    upstreamAttempts: { note: '민감한 시도 원문' },
  }, { GPAO_T5_PROMPT_DUMP: dir });
  const body = await readFile(path, 'utf8');
  assert.equal(body.includes('sk-live'), false);
  assert.equal(body.includes('민감한 오류 원문'), false);
  assert.equal(body.includes('rawPrompt'), false);
  assert.equal(body.includes('errorMessage'), false);
  assert.equal(body.includes('중첩원문'), false);
  assert.equal(body.includes('민감한 추가 필드'), false);
  assert.equal(body.includes('tokens.note'), false);
  const saved = JSON.parse(body);
  assert.equal(saved.inputBreakdown.system, 3);
  assert.equal(saved.inputBreakdown.user, null);
  assert.equal(saved.tokens.input, 3);
  assert.equal(Object.hasOwn(saved.tokens, 'note'), false);
  assert.equal(saved.requestModelId.includes('12345678901234567890'), false,
    '사용자가 넣을 수 있는 model id의 비밀 모양이 원문으로 남았다');
  assert.match(saved.requestModelId, /가림/);
  assert.equal(saved.responseModelId, 'model-safe-name');
  assert.equal(saved.inputBreakdownSource, null);
  assert.equal(saved.inputBreakdownVersion, null);
  assert.equal(saved.durationMs, null);
  assert.equal(saved.ttftMs, null);
  assert.equal(saved.upstreamAttempts, null);
  assert.equal(body.includes('최상위비밀'), false);
  assert.equal(body.includes('민감한 시도 원문'), false);
});

test('재시작은 남아 있는 started를 interrupted로 정직하게 닫는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-call-interrupted-'));
  const env = { GPAO_T5_PROMPT_DUMP: dir };
  const path = await dumpModelCallMetric({
    callId: 'call-crashed', sequence: 1, purpose: 'primary', status: 'started',
  }, env);
  assert.equal(await markInterruptedModelCalls(env), 1);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).status, 'interrupted');
  assert.equal(await markInterruptedModelCalls(env), 0, '이미 닫힌 호출을 다시 세면 안 된다');
});

test('승인 경계용 snapshot은 순번과 닫힌 기록을 재시작 뒤 이어받는다', async () => {
  const first = createModelCallAccounting({ lane: 'foreground', turnRef: 't-1' });
  const one = instrumentModelCalls({ async respond() { return '하나'; } }, () => first);
  await one.respond(packet, { accountingPurpose: 'primary' });
  const restored = restoreModelCallAccounting(first.snapshot(), { turnRef: 't-2' });
  const two = instrumentModelCalls({ async respond() { return '둘'; } }, () => restored);
  await two.respond(packet, { accountingPurpose: 'final_response' });
  assert.deepEqual(restored.records.map((r) => r.sequence), [1, 2]);
  assert.deepEqual(restored.records.map((r) => r.purpose), ['primary', 'final_response']);
});

test('purpose 누락은 제품 호출을 숨기지 않고 unlabeled로 드러낸다', async () => {
  const accounting = createModelCallAccounting({ lane: 'background' });
  const wrapped = instrumentModelCalls({ async respond() { return 'x'; } }, () => accounting);
  await wrapped.respond(packet);
  assert.equal(accounting.records[0].purpose, 'unlabeled');
  assert.equal(accounting.records[0].lane, 'background');
});

test('일반 인사 한 번은 foreground primary 한 호출로만 기록된다', async () => {
  const ctx = {
    env: demoEnv(), tools: demoTools(),
    model: { async respond() { return '안녕하세요.'; } },
  };
  await runTurn({ text: '안녕', turnRef: 'turn-greeting' }, ctx);
  assert.equal(ctx.modelCallAccounting.records.length, 1);
  assert.equal(ctx.modelCallAccounting.records[0].purpose, 'primary');
  assert.equal(ctx.modelCallAccounting.records[0].lane, 'foreground');
});

test('실제 승인 카드도 직렬화·재시작 뒤 같은 회계 순번을 이어간다', async () => {
  const localTerminal = {
    async probe(command) {
      return { command, cwd: '/tmp', changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } };
    },
    async handler(args) {
      return { result: { command: args.command, exitCode: 0, stdout: '', cwd: '/tmp' }, userSafeSummary: '실행함' };
    },
  };
  let planned = false;
  const model = { async respond(tc, opts = {}) {
    if (tc?.workContractAssessment) {
      return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
    }
    if (opts.tools?.length && !planned) {
      planned = true;
      return { text: '', toolCalls: [{
        providerCallId: 'call_restart', name: 'local.terminal', args: { command: 'rm -rf 임시' },
      }] };
    }
    return '끝났어요.';
  } };
  const firstCtx = { env: demoEnv(), tools: demoTools({ localTerminal }), model };
  const card = await runTurn({ text: '임시 지워줘', turnRef: 'turn-before' }, firstCtx);
  assert.equal(card.kind, 'approval');
  const before = firstCtx.modelCallAccounting.snapshot();
  const persisted = structuredClone(Object.fromEntries(firstCtx.pending));
  assert.equal(persisted[card.pendingId].modelCallAccounting.sequence, before.sequence);

  const resumedCtx = {
    env: demoEnv(), tools: demoTools({ localTerminal }), model,
    pending: new Map(Object.entries(persisted)),
  };
  await runTurn({ approve: card.pendingId, turnRef: 'turn-after' }, resumedCtx);
  assert.ok(resumedCtx.modelCallAccounting.records.length > before.records.length);
  assert.deepEqual(
    resumedCtx.modelCallAccounting.records.slice(0, before.records.length).map((r) => r.callId),
    before.records.map((r) => r.callId),
  );
  assert.equal(resumedCtx.modelCallAccounting.records.at(-1).sequence, resumedCtx.modelCallAccounting.records.length);
  assert.equal(resumedCtx.왕복수, resumedCtx.modelCallAccounting.sequence,
    '승인 재시작에서 기존 왕복 예산과 회계가 갈라졌다');
});

test('동시에 도는 두 foreground 요청은 sequence·turnRef·records를 섞지 않는다', async () => {
  let releaseA;
  const waitA = new Promise((resolve) => { releaseA = resolve; });
  const make = (turnRef, wait) => {
    const accounting = createModelCallAccounting({ lane: 'foreground', turnRef });
    const model = instrumentModelCalls({ async respond() { if (wait) await wait; return turnRef; } }, () => accounting);
    return { accounting, model };
  };
  const a = make('turn-A', waitA);
  const b = make('turn-B');
  const pa = a.model.respond(packet, { accountingPurpose: 'primary' });
  await b.model.respond(packet, { accountingPurpose: 'primary' });
  releaseA();
  await pa;
  assert.deepEqual(a.accounting.records.map((r) => [r.sequence, r.turnRef]), [[1, 'turn-A']]);
  assert.deepEqual(b.accounting.records.map((r) => [r.sequence, r.turnRef]), [[1, 'turn-B']]);
  assert.notEqual(a.accounting.records[0].callId, b.accounting.records[0].callId);
});

test('동시에 도는 두 runTurn도 공유 base model 위에서 각자 sequence 1이다', async () => {
  const shared = { async respond(tc) {
    await new Promise((resolve) => setTimeout(resolve, tc.currentRequest === 'A' ? 5 : 1));
    return `답 ${tc.currentRequest}`;
  } };
  const a = { env: demoEnv(), tools: demoTools(), model: shared };
  const b = { env: demoEnv(), tools: demoTools(), model: shared };
  await Promise.all([
    runTurn({ text: 'A', turnRef: 'turn-A' }, a),
    runTurn({ text: 'B', turnRef: 'turn-B' }, b),
  ]);
  assert.deepEqual(a.modelCallAccounting.records.map((r) => [r.sequence, r.turnRef]), [[1, 'turn-A']]);
  assert.deepEqual(b.modelCallAccounting.records.map((r) => [r.sequence, r.turnRef]), [[1, 'turn-B']]);
});

test('제품의 모든 직접 respond 호출에는 purpose가 붙어 있다', async () => {
  const files = [
    '../src/kernel/turn.js', '../src/surface/server.js', '../src/surface/welcome.js',
    '../src/runtime/canonical-automation-runtime.js', '../src/kernel/l5-growth/tcell-grow.js',
  ];
  for (const relative of files) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!/\.(?:respond)\(/.test(lines[i])) continue;
      // 호출을 결정하지 않고 시간만 재는 투명 위임 래퍼다. 실제 목적은 커널 호출부가 붙인다.
      if (lines[i].includes('model.respond(...args)')) continue;
      const window = lines.slice(i, i + 22).join('\n');
      assert.match(window, /accountingPurpose\s*:/,
        `${relative}:${i + 1} 모델 호출 목적이 없다`);
      assert.doesNotMatch(window, /accountingPurpose\s*:\s*['"]unlabeled['"]/,
        `${relative}:${i + 1} 제품 호출이 unlabeled를 명시했다`);
    }
    for (const match of source.matchAll(/accountingPurpose\s*:\s*['"]([^'"]+)['"]/g)) {
      assert.ok(MODEL_CALL_PURPOSES.includes(match[1]),
        `${relative} 알 수 없는 모델 호출 목적: ${match[1]}`);
    }
  }
});
