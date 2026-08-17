import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import {
  controlSchemasForCategories, modelSchemasFor, splitModelControlCalls,
} from '../src/kernel/l2-plan/model-control.js';

const controls = ['skill.propose', 'automation.propose', 'automation.control', 'automation.observe',
  'agent.propose', 'work.state'];
const controlPrefixes = new Set(['control', 'skill', 'automation', 'agent', 'work', 'memory', 'ask', 'approval']);
const isControl = (name) => controlPrefixes.has(String(name).split('.')[0]);

function fresh(model, extra = {}) {
  return {
    env: demoEnv(), tools: demoTools(), modelControls: controls, model,
    memory: { promoted: [], candidates: [], observed: [] },
    automationReality: {
      candidates: { observed: true, total: 0, truncated: false, items: [] },
      jobs: { observed: true, total: 0, truncated: false, items: [] },
      recentRuns: { observed: true, total: 0, truncated: false, items: [] },
    },
    ...extra,
  };
}

test('selector category는 선언된 여섯 범주까지 실제 control schema 합집합으로 확장된다', () => {
  assert.deepEqual(controlSchemasForCategories(['memory']).map((x) => x.name),
    ['memory.propose', 'memory.cite', 'memory.correction', 'memory.withdraw']);
  assert.deepEqual(controlSchemasForCategories(['automation', 'skill', 'agent']).map((x) => x.name),
    ['skill.propose', 'automation.propose', 'automation.control', 'automation.observe', 'agent.propose']);
  assert.deepEqual(splitModelControlCalls([{ name: 'control.select', args: {
    categories: ['memory', 'unknown', 'memory', 'automation'],
  } }]).controlSelection, ['memory', 'automation']);
  const all = ['memory', 'automation', 'skill', 'agent', 'work', 'question'];
  assert.deepEqual(splitModelControlCalls([{ name: 'control.select', args: {
    categories: [...all, 'memory'],
  } }]).controlSelection, all);
  assert.deepEqual(controlSchemasForCategories(all).map((schema) => schema.name), [
    'skill.propose', 'automation.propose', 'automation.control', 'automation.observe',
    'agent.propose', 'work.state', 'memory.propose', 'memory.cite', 'memory.correction',
    'memory.withdraw', 'ask.user',
  ]);
});

test('두 번째 모델 입력은 선택 범주를 영향 없는 사실로 받는다', () => {
  const messages = buildModelMessages({
    currentRequest: '앞으로 목록으로 써줘', identity: { name: 'T5' }, selfStateFacts: {},
    controlSelection: { categories: ['memory'] },
  });
  assert.match(messages.system, /구조 제출 범주: memory/);
  assert.match(messages.system, /선택 자체는 기억·예약·설정·질문·상태 변경이 아니다/);
});

test('fresh greeting은 execution hands 순서를 보존하고 actual controls 대신 selector 하나만 본다', async () => {
  const seen = [];
  const ctx = fresh({ async respond(_tc, opts = {}) {
    seen.push(opts.tools ?? []);
    return '안녕하세요.';
  } });
  await runTurn({ text: '안녕' }, ctx);
  assert.equal(seen.length, 1);
  const names = seen[0].map((x) => x.name);
  assert.deepEqual(names.filter(isControl), ['control.select']);
  const selfState = buildSelfState(ctx.env);
  const baselineHands = modelSchemasFor(selfState, null);
  assert.deepEqual(seen[0].slice(0, baselineHands.length), baselineHands,
    'selector가 기존 execution hands의 schema·순서·접두를 바꿨다');
  const selectorChars = JSON.stringify(seen[0].filter((x) => isControl(x.name))).length;
  const fullControlChars = JSON.stringify(modelSchemasFor(selfState, controls).filter((x) => isControl(x.name))).length;
  assert.ok(selectorChars < 1500,
    '작은 selector가 실제 control schemas만큼 커졌다');
  assert.ok(fullControlChars - selectorChars > 8000,
    `control schema 절감이 실측 8KB보다 작다(${fullControlChars} → ${selectorChars})`);
  assert.deepEqual(ctx.modelCallAccounting.records.map((x) => x.purpose), ['primary']);
});

test('왕복 예산이 1이면 selector가 두 번째 모델 호출을 열지 않는다', async () => {
  let calls = 0;
  const ctx = fresh({ async respond() {
    calls += 1;
    return { text: '범주만 골라요.', toolCalls: [{
      name: 'control.select', args: { categories: ['memory'] },
    }] };
  } }, { processEnv: { GPAO_T5_TURN_ROUNDTRIPS: '1' } });
  const result = await runTurn({ text: '기억 요청' }, ctx);
  assert.equal(calls, 1);
  assert.equal(ctx.modelCallAccounting.records.some((record) => record.purpose === 'control_disclosure'), false);
  assert.equal(ctx.왕복수, 1);
  assert.equal(ctx.답잘림, false);
  assert.equal(result.reply, '이 응답에서는 추가로 남기거나 설정하거나 물을 내용이 아직 미정이에요.');
});

test('disclosure 호출이 실패하면 router 성공 문장을 버리고 정직한 미반영 사실로 끝낸다', async () => {
  let calls = 0;
  const ctx = fresh({ async respond(_tc, opts = {}) {
    calls += 1;
    if (calls === 1) return {
      text: '기억했어요.',
      // 공개 전 args는 무시하고 name에서 category만 복구해야 한다.
      toolCalls: [{ name: 'memory.propose', args: { statement: '믿으면 안 되는 첫 인자' } }],
    };
    throw new Error('disclosure failed');
  } });
  const result = await runTurn({ text: '기억 관련 요청' }, ctx);
  assert.equal(result.reply, '이 응답에서는 추가로 남기거나 설정하거나 물을 내용이 아직 미정이에요.');
  assert.equal(result.memorySuggestion, null);
  assert.equal(calls, 2);
  assert.equal(ctx.modelCallAccounting.records.find((record) => record.purpose === 'control_disclosure')?.status, 'failed');
});

test('disclosure가 정상 텍스트만 내고 actual control이 0이면 성공 주장으로 닫지 않는다', async () => {
  const ctx = fresh({ async respond(_tc, opts = {}) {
    if ((opts.tools ?? []).some((tool) => tool.name === 'control.select')) return {
      text: '', toolCalls: [{ name: 'control.select', args: { categories: ['automation'] } }],
    };
    return '매주 예약했어요.';
  } });
  const result = await runTurn({ text: '매주 정산 알려줘' }, ctx);
  assert.equal(result.reply, '이 응답에서는 추가로 남기거나 설정하거나 물을 내용이 아직 미정이에요.');
  assert.equal(result.automationProposal, null);
  assert.equal(ctx.modelCallAccounting.records.filter((record) => record.purpose === 'control_disclosure').length, 1);
});

test('agent·question disclosure 실패도 category나 사용자 의도를 지어내지 않는 같은 고지를 쓴다', async (t) => {
  for (const category of ['agent', 'question']) await t.test(category, async () => {
    const ctx = fresh({ async respond(_tc, opts = {}) {
      if ((opts.tools ?? []).some((tool) => tool.name === 'control.select')) return {
        text: category === 'agent' ? '담당을 만들었어요.' : '질문을 정했어요.',
        toolCalls: [{ name: 'control.select', args: { categories: [category] } }],
      };
      throw new Error('disclosure failed');
    } });
    const result = await runTurn({ text: '모호한 요청' }, ctx);
    assert.equal(result.reply, '이 응답에서는 추가로 남기거나 설정하거나 물을 내용이 아직 미정이에요.');
    assert.equal(result.reply.includes(category), false, '내부 category가 사용자면에 샜다');
  });
});

test('memory 선택은 한 번만 실제 schema를 공개하고 기존 memory consumer까지 도달한다', async () => {
  const toolsets = [];
  const ctx = fresh({ async respond(_tc, opts = {}) {
    const names = (opts.tools ?? []).map((x) => x.name);
    toolsets.push(names);
    if (names.includes('control.select')) return { text: '', toolCalls: [{
      name: 'control.select', args: { categories: ['memory'] },
    }] };
    return { text: '앞으로 목록으로 쓸게요.', toolCalls: [{ name: 'memory.propose', args: {
      kind: 'preference', statement: '보고서는 목록으로 쓴다',
      evidence: { quote: '앞으로 보고서는 목록으로 써줘', appliesTo: 'future' },
    } }] };
  } });
  const result = await runTurn({ text: '앞으로 보고서는 목록으로 써줘' }, ctx);
  assert.equal(toolsets.length, 2);
  assert.deepEqual(toolsets[1].filter(isControl),
    ['memory.propose', 'memory.cite', 'memory.correction', 'memory.withdraw']);
  assert.equal(result.memorySuggestion?.statement, '보고서는 목록으로 쓴다');
  assert.deepEqual(ctx.modelCallAccounting.records.map((x) => x.purpose), ['primary', 'control_disclosure']);
  assert.equal(ctx.왕복수, ctx.modelCallAccounting.sequence);
});

test('automation+skill 두 category도 한 번 공개하고 두 기존 consumer를 함께 살린다', async () => {
  const ctx = fresh({ async respond(_tc, opts = {}) {
    const names = (opts.tools ?? []).map((tool) => tool.name);
    if (names.includes('control.select')) return { text: '', toolCalls: [{
      name: 'control.select', args: { categories: ['automation', 'skill'] },
    }] };
    return { text: '반복 작업을 준비했어요.', toolCalls: [
      { name: 'automation.propose', args: { statement: '매주 정산', operation: 'create' } },
      { name: 'skill.propose', args: { name: '정산', purpose: '정산', steps: [], resultContract: {}, replayCases: [] } },
    ] };
  } });
  const result = await runTurn({ text: '매주 정산하는 방식을 맡아줘' }, ctx);
  assert.equal(result.automationProposal?.statement, '매주 정산');
  assert.equal(result.skillProposal?.name, '정산');
  assert.equal(ctx.modelCallAccounting.records.filter((x) => x.purpose === 'control_disclosure').length, 1);
});

test('agent·work·question category는 각각 기존 분리 소비자에 도달한다', async (t) => {
  const cases = [
    ['agent', { name: 'agent.propose', args: { name: '조사 담당', purpose: '조사' } },
      (result) => result.agentProposal?.name === '조사 담당'],
    ['work', { name: 'work.state', args: { changes: [{ type: 'agreement_set', utteranceQuote: '42명으로 하자' }] } },
      (_result, ctx) => ctx.workStateSnapshot?.().workStateProposal?.changes?.[0]?.utteranceQuote === '42명으로 하자'],
    ['question', { name: 'ask.user', args: { question: '어느 형식으로 할까요?', options: [{ label: '표' }, { label: '목록' }] } },
      (result) => result.kind === 'clarify' && result.question === '어느 형식으로 할까요?'],
  ];
  for (const [category, call, verify] of cases) await t.test(category, async () => {
    const ctx = fresh({ async respond(_tc, opts = {}) {
      const names = (opts.tools ?? []).map((tool) => tool.name);
      if (names.includes('control.select')) return { text: '', toolCalls: [{
        name: 'control.select', args: { categories: [category] },
      }] };
      return { text: category === 'question' ? '' : '반영했어요.', toolCalls: [call] };
    } });
    const result = await runTurn({ text: `${category} 요청` }, ctx);
    assert.equal(Boolean(verify(result, ctx)), true);
  });
});

test('selector와 실행 손이 함께 나오면 실행은 한 번만 하고 disclosure로 재실행하지 않는다', async () => {
  let webCalls = 0;
  let rounds = 0;
  let followupControls = [];
  const tools = demoTools({ webSearch: { async handler(args) {
    webCalls += 1;
    return { result: { query: args.query, candidates: [] }, userSafeSummary: '검색했어요.' };
  } } });
  const ctx = fresh({ async respond(_tc, opts = {}) {
    rounds += 1;
    if (rounds === 1) return { text: '', toolCalls: [
      { name: 'control.select', args: { categories: ['memory'] } },
      { providerCallId: 'web-mixed', name: 'web.search', args: { query: 'Node.js' } },
    ] };
    followupControls = (opts.tools ?? []).map((tool) => tool.name).filter(isControl);
    if (_tc.controlSelection?.categories?.includes('memory')) return {
      text: '검색하고 기억 후보도 만들었어요.', toolCalls: [{
        name: 'memory.propose', args: { statement: 'Node.js 자료를 목록으로 정리한다' },
      }],
    };
    return '검색 결과를 정리했어요.';
  } }, { tools });
  const result = await runTurn({ text: 'Node.js 찾아서 목록 선호도 기억해줘' }, ctx);
  assert.equal(webCalls, 1);
  assert.equal(ctx.modelCallAccounting.records.filter((x) => x.purpose === 'control_disclosure').length, 0);
  assert.equal(result.memorySuggestion?.statement, 'Node.js 자료를 목록으로 정리한다');
  assert.deepEqual(followupControls,
    ['memory.propose', 'memory.cite', 'memory.correction', 'memory.withdraw']);
});

test('미공개 actual control과 실행 손 혼합도 args를 버리고 후속에서 schema-valid 제출을 다시 받는다', async () => {
  let webCalls = 0;
  let rounds = 0;
  let followupControls = [];
  const tools = demoTools({ webSearch: { async handler() {
    webCalls += 1;
    return { result: { candidates: [] }, userSafeSummary: '검색했어요.' };
  } } });
  const ctx = fresh({ async respond(tc, opts = {}) {
    rounds += 1;
    if (rounds === 1) return { text: '검색했고 기억했어요.', toolCalls: [
      { name: 'memory.propose', args: { statement: 'schema를 못 본 값은 버려야 한다' } },
      { providerCallId: 'web-unshown-mixed', name: 'web.search', args: { query: 'Node.js' } },
    ] };
    assert.deepEqual(tc.controlSelection?.categories, ['memory']);
    followupControls = (opts.tools ?? []).map((tool) => tool.name).filter(isControl);
    return { text: '검색 뒤 기억 후보를 만들었어요.', toolCalls: [{
      name: 'memory.propose', args: { statement: 'Node.js 결과는 목록으로 정리한다' },
    }] };
  } }, { tools });
  const result = await runTurn({ text: 'Node.js를 찾고 목록 선호도 기억해줘' }, ctx);
  assert.equal(webCalls, 1);
  assert.equal(result.memorySuggestion?.statement, 'Node.js 결과는 목록으로 정리한다');
  assert.notEqual(result.memorySuggestion?.statement, 'schema를 못 본 값은 버려야 한다');
  assert.deepEqual(followupControls,
    ['memory.propose', 'memory.cite', 'memory.correction', 'memory.withdraw']);
});

test('공개되지 않은 actual control·unknown 선택·selector 재귀는 영향 0이다', async (t) => {
  await t.test('unshown actual control is re-requested through disclosure', async () => {
    const ctx = fresh({ async respond() { return { text: '기억했어요.', toolCalls: [{
      name: 'memory.propose', args: { statement: '숨은 기억' },
    }] }; } });
    const result = await runTurn({ text: '평범한 말' }, ctx);
    assert.equal(result.memorySuggestion?.statement, '숨은 기억');
    assert.equal(ctx.modelCallAccounting.records.filter((record) => record.purpose === 'control_disclosure').length, 1);
  });
  await t.test('unknown category', async () => {
    const ctx = fresh({ async respond(_tc, opts = {}) {
      return (opts.tools ?? []).some((tool) => tool.name === 'control.select')
        ? { text: '그대로 답해요.', toolCalls: [{ name: 'control.select', args: { categories: ['unknown'] } }] }
        : '그대로 답해요.';
    } });
    const result = await runTurn({ text: '평범한 말' }, ctx);
    assert.equal(result.memorySuggestion, null);
    assert.equal(result.reply, '이 응답에서는 추가로 남기거나 설정하거나 물을 내용이 아직 미정이에요.');
    assert.equal(ctx.modelCallAccounting.records.some((x) => x.purpose === 'control_disclosure'), false);
  });
  await t.test('recursive selector', async () => {
    let rounds = 0;
    const ctx = fresh({ async respond(_tc, opts = {}) {
      rounds += 1;
      if ((opts.tools ?? []).some((tool) => tool.name === 'control.select')) return {
        text: '', toolCalls: [{ name: 'control.select', args: { categories: ['memory'] } }],
      };
      return { text: '선택 채널만 확인해요.', toolCalls: [{ name: 'control.select', args: { categories: ['memory'] } }] };
    } });
    await runTurn({ text: '기억 관련 요청' }, ctx);
    assert.equal(ctx.modelCallAccounting.records.filter((x) => x.purpose === 'control_disclosure').length, 1);
    assert.ok(rounds <= 2, `selector가 ${rounds}회 재귀했다`);
  });
});

test('stateful 턴은 selector를 거치지 않고 기존 actual controls를 바로 유지한다', async () => {
  let firstNames = [];
  const ctx = fresh({ async respond(_tc, opts = {}) {
    if (!firstNames.length) firstNames = (opts.tools ?? []).map((x) => x.name);
    return '기억을 확인했어요.';
  } }, { memory: { promoted: [{ candidateId: 'm1', statement: '목록으로 쓴다' }], candidates: [], observed: [] } });
  await runTurn({ text: '내가 기억하라고 한 게 뭐야?' }, ctx);
  assert.equal(firstNames.includes('control.select'), false);
  assert.ok(firstNames.includes('memory.withdraw') && firstNames.includes('work.state'));
});

test('pending·carryable·automation state가 하나라도 있으면 보수적으로 full controls를 유지한다', async (t) => {
  const cases = [
    ['pending', { 승인대기카드: [{ id: 'p1' }] }],
    ['carryable', { carryableWork: ['이어갈 작업'] }],
    ['automation', { automationReality: {
      principalBound: true,
      candidates: { total: 0, truncated: false, items: [] },
      jobs: { total: 1, truncated: false, items: [{ jobRef: 'j1' }] },
      recentRuns: { total: 0, truncated: false, items: [] },
    } }],
  ];
  for (const [name, extra] of cases) await t.test(name, async () => {
    let firstNames = [];
    const ctx = fresh({ async respond(_tc, opts = {}) {
      if (!firstNames.length) firstNames = (opts.tools ?? []).map((tool) => tool.name);
      return '상태를 이어가요.';
    } }, extra);
    await runTurn({ text: '이어서 알려줘' }, ctx);
    assert.equal(firstNames.includes('control.select'), false);
    assert.ok(firstNames.includes('memory.propose') && firstNames.includes('work.state'));
  });
});

test('실제 서버의 새 세션 greeting도 selector 한 개만 받고 모델 호출은 한 번이다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'control-server-greeting-'));
  let calls = 0;
  let firstNames = [];
  const server = makeServer({
    store: new SessionStore(dir), startScheduler: false,
    model: { async respond(_tc, opts = {}) {
      calls += 1;
      if (!firstNames.length) firstNames = (opts.tools ?? []).map((tool) => tool.name);
      return '안녕하세요.';
    } },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const response = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '안녕' }),
    });
    assert.equal(response.ok, true);
    assert.equal(calls, 1);
    assert.deepEqual(firstNames.filter(isControl), ['control.select']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('assistant welcome 한 줄은 실질 상태가 아니다 — 첫 사용자 greeting도 selector를 유지한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'control-server-welcome-'));
  const turnToolsets = [];
  const env = { ...demoEnv(), model: { id: 'usable-test', authSignal: 'ok', healthState: 'usable' } };
  const server = makeServer({
    store: new SessionStore(dir), startScheduler: false, env,
    model: { async respond(tc, opts = {}) {
      if (tc.currentRequest === '안녕') turnToolsets.push((opts.tools ?? []).map((tool) => tool.name));
      return tc.currentRequest === '안녕' ? '반가워요.' : '첫 인사예요.';
    } },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const welcome = await fetch(`${base}/welcome`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id }),
    });
    assert.equal((await welcome.json()).state, 'greeted');
    await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '안녕' }),
    });
    assert.equal(turnToolsets.length, 1);
    assert.deepEqual(turnToolsets[0].filter(isControl), ['control.select']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('tool-offer dump도 full controls가 아니라 호출별 selector/공개 schema를 기록한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'control-offer-dump-'));
  const ctx = fresh({ async respond(_tc, opts = {}) {
    return (opts.tools ?? []).some((tool) => tool.name === 'control.select')
      ? { text: '', toolCalls: [{ name: 'control.select', args: { categories: ['memory'] } }] }
      : { text: '기억 후보예요.', toolCalls: [{ name: 'memory.propose', args: { statement: '목록으로 쓴다' } }] };
  } }, { processEnv: { GPAO_T5_PROMPT_DUMP: dir } });
  await runTurn({ text: '앞으로 목록으로 써줘' }, ctx);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const files = (await readdir(dir)).filter((name) => name.includes('손제시')).sort();
  assert.equal(files.length, 2);
  const records = await Promise.all(files.map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'))));
  assert.deepEqual(records.map((record) => record.통제채널), [
    ['control.select'], ['memory.propose', 'memory.cite', 'memory.correction', 'memory.withdraw'],
  ]);
});
