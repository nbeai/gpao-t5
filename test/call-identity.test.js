// **모델이 발급한 호출 신분은 끝까지 살아남는다.**
//
// 왜 이 파일이 있는가: T5 는 모델에게 "네가 이렇게 불렀지"라며 도구 대화를 돌려준다.
// 그런데 그 대화의 id 는 **모델이 발급한 적 없는 것**이었다 — 와이어에서 `tool_call.id` 를
// 아예 안 읽고(`parseWireCall`), 돌려줄 때 `c1, c2…` 로 새로 지었다(`task-context.js`).
// 내용은 맞고 짝도 맞지만 **신분이 지어낸 것**이다. 그래서 런타임은 "모델이 무엇을
// 요청했는가"와 "T5 가 무엇을 했는가"를 경계 너머로 잇지 못한다.
//
// 회귀 2,183 건이 전부 초록인 채로 이 결함이 살아 있었다. 검사가 **짝이 맞는지**만 봤고
// **누가 발급했는지**를 안 봤기 때문이다. 그래서 여기서 그것만 잰다.
//
// ── 두 신분을 섞지 않는다 (오너 지시 2026-08-04) ─────────────────────────────
//   `providerCallId` — 공급자가 발급한 것. 없으면 **없는 것이다.**
//   `ref`            — T5 내부 상관용. 언제나 있다.
// Gemini 의 `functionCall` 규약에는 id 가 아예 없다 — 거기에 공급자 ID 를 지어내지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_PROVIDERS, buildModelMessages } from '../src/runtime/model-provider.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { runTurn } from '../src/kernel/turn.js';

const selfState = buildSelfState(demoEnv());
const intent = { currentRequest: '정산.csv 읽어줘', answerMode: 'complex_work' };

// ── ① 파싱: 공급자가 준 신분을 읽는다 ──────────────────────────────────────
test('OpenAI 단발 응답의 tool_calls[].id 가 살아남는다', () => {
  const json = { choices: [{ message: { tool_calls: [
    { id: 'call_AbC123', type: 'function', function: { name: 'local_file', arguments: '{"action":"read"}' } },
  ] } }] };
  const [c] = MODEL_PROVIDERS.openai.extractToolCalls(json);
  assert.equal(c.providerCallId, 'call_AbC123', '공급자가 발급한 신분을 버렸다');
  // 이 계층은 **와이어 이름 그대로** 낸다 — 되돌리기는 `callModel` 이 노출 목록과 대조해 한다.
  assert.equal(c.name, 'local_file');
});

test('Anthropic tool_use.id 가 살아남는다', () => {
  const json = { content: [{ type: 'tool_use', id: 'toolu_01XyZ', name: 'local_file', input: { action: 'read' } }] };
  const [c] = MODEL_PROVIDERS.anthropic.extractToolCalls(json);
  assert.equal(c.providerCallId, 'toolu_01XyZ');
});

test('Gemini 규약에는 id 가 없다 — **지어내지 않는다**', () => {
  const json = { candidates: [{ content: { parts: [{ functionCall: { name: 'local_file', args: { action: 'read' } } }] } }] };
  const [c] = MODEL_PROVIDERS.gemini.extractToolCalls(json);
  assert.equal(c.providerCallId, undefined,
    '없는 신분을 만들어 붙이면 "모델이 발급했다"는 말이 거짓이 된다');
  assert.equal(c.name, 'local_file', '신분이 없어도 호출 자체는 온전해야 한다');
});

// ── ② 스트리밍: 조각나도 신분이 남는다 ─────────────────────────────────────
test('스트리밍 조각에 나뉘어 온 id 도 하나로 이어진다', async () => {
  const 조각 = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_', function: { name: 'local_', arguments: '{"act' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'XY9', function: { name: 'file', arguments: 'ion":"read"}' } }] } }] },
  ].map((o) => `data: ${JSON.stringify(o)}\n\n`).join('') + 'data: [DONE]\n\n';

  const fetchImpl = async () => ({
    ok: true, status: 200,
    body: { getReader: () => { let 냈나 = false; return { async read() {
      if (냈나) return { done: true };
      냈나 = true;
      return { done: false, value: new TextEncoder().encode(조각) };
    } }; } },
  });
  const { makeProviderModelClient } = await import('../src/runtime/model-provider.js');
  const client = makeProviderModelClient(
    { provider: 'openai', token: 't', modelId: 'm', baseUrl: 'http://x', maxTokens: 100 },
    { fetchImpl },
  );
  const out = await client.respond({ system: 's', user: 's', currentRequest: 'u' }, {
    tools: [{ name: 'local.file', description: 'd', parameters: { type: 'object' } }],
    onDelta: () => {},
  });
  const [c] = out.toolCalls ?? [];
  assert.ok(c, '스트림에서 도구 호출을 못 만들었다');
  assert.equal(c.providerCallId, 'call_XY9', '조각난 id 가 이어지지 않았다');
});

// ── ③ 원장·모델 입력: 신분이 자기 행동에 붙어 돌아온다 ─────────────────────
test('turnExchange 는 공급자 신분을 쓰고, T5 내부 ref 와 섞지 않는다', () => {
  const rec = {
    intended: '파일 읽기', failureState: 'none', userSafeSummary: '읽었어요.',
    actualCall: { tool: 'local.file', args: { action: 'read', path: '정산.csv' }, providerCallId: 'call_REAL1' },
    result: { path: '/집/정산.csv', text: '내용' },
  };
  const tc = buildTaskContext({ intent, selfState, receipts: [rec] });
  const x = tc.turnExchange?.[0];
  assert.ok(x, '실행이 교환에 없다');
  assert.equal(x.providerCallId, 'call_REAL1', '모델이 발급한 신분이 사라졌다');
  assert.ok(x.ref, 'T5 내부 상관용 ref 가 없다');
  assert.notEqual(x.ref, x.providerCallId, '두 신분을 한 칸에 섞으면 구분이 사라진다');
});

test('신분 없이 만들어진 호출에는 공급자 신분을 붙이지 않는다', () => {
  // 런타임이 문맥에서 세운 호출(폴백 경로)은 모델이 발급한 것이 아니다.
  const rec = {
    intended: '파일 읽기', failureState: 'none', userSafeSummary: '읽었어요.',
    actualCall: { tool: 'local.file', args: { action: 'read', path: '정산.csv' } },
    result: { path: '/집/정산.csv', text: '내용' },
  };
  const tc = buildTaskContext({ intent, selfState, receipts: [rec] });
  assert.equal(tc.turnExchange?.[0]?.providerCallId, undefined,
    '없는 신분을 지어냈다 — 모델이 발급한 적 없는 것을 발급했다고 말하게 된다');
});

// ── ④ 다음 공급자 입력: 그 신분 그대로 나간다 ──────────────────────────────
test('OpenAI 와이어의 tool_call_id 가 모델이 발급한 그 신분이다', () => {
  const rec = {
    intended: '읽기', failureState: 'none', userSafeSummary: '읽었어요.',
    actualCall: { tool: 'local.file', args: { action: 'read' }, providerCallId: 'call_REAL1' },
    result: { text: '내용 알맹이' },
  };
  const m = buildModelMessages(buildTaskContext({ intent, selfState, receipts: [rec] }));
  const body = JSON.parse(MODEL_PROVIDERS.openai.body(
    { modelId: 'm', maxTokens: 100, baseUrl: 'http://x' }, m, { tools: [] },
  ));
  const assistant = body.messages.find((x) => x.role === 'assistant' && x.tool_calls);
  const toolMsg = body.messages.find((x) => x.role === 'tool');
  assert.equal(assistant?.tool_calls?.[0]?.id, 'call_REAL1', '모델에게 자기가 안 낸 신분을 돌려준다');
  assert.equal(toolMsg?.tool_call_id, 'call_REAL1', '결과가 원래 호출에 안 붙는다');
});

test('Anthropic 와이어의 tool_use_id 도 그 신분이다', () => {
  const rec = {
    intended: '읽기', failureState: 'none', userSafeSummary: '읽었어요.',
    actualCall: { tool: 'local.file', args: { action: 'read' }, providerCallId: 'toolu_01XyZ' },
    result: { text: '내용 알맹이' },
  };
  const m = buildModelMessages(buildTaskContext({ intent, selfState, receipts: [rec] }));
  const body = JSON.parse(MODEL_PROVIDERS.anthropic.body(
    { modelId: 'm', maxTokens: 100, baseUrl: 'http://x' }, m, { tools: [] },
  ));
  const 전문 = JSON.stringify(body);
  assert.ok(전문.includes('toolu_01XyZ'), 'Anthropic 와이어가 원래 신분을 안 싣는다');
});

test('Gemini 와이어는 id 칸 자체를 만들지 않는다(규약에 없다)', () => {
  const rec = {
    intended: '읽기', failureState: 'none', userSafeSummary: '읽었어요.',
    actualCall: { tool: 'local.file', args: { action: 'read' } },
    result: { text: '내용 알맹이' },
  };
  const m = buildModelMessages(buildTaskContext({ intent, selfState, receipts: [rec] }));
  const body = JSON.parse(MODEL_PROVIDERS.gemini.body(
    { modelId: 'm', maxTokens: 100, baseUrl: 'http://x' }, m, { tools: [] },
  ));
  const 전문 = JSON.stringify(body);
  assert.equal(/"(id|tool_call_id|tool_use_id)"/.test(전문), false,
    `Gemini 규약에 없는 신분 칸을 만들었다: ${전문.slice(0, 300)}`);
  assert.ok(전문.includes('내용 알맹이'), '신분이 없다고 결과까지 빠지면 안 된다');
});

// ── ⑤ 종단: 모델이 낸 신분이 다음 호출까지 간다 ────────────────────────────
test('종단 — 모델이 낸 신분이 실행을 지나 다음 모델 입력에 그대로 온다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'call-id-'));
  await writeFile(join(dir, '정산.csv'), '항목,금액\n임대료,500000\n');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  let 냈나 = false;
  let 두번째tc = null;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{
          providerCallId: 'call_FROM_MODEL', name: 'local.file',
          args: { action: 'read', path: join(dir, '정산.csv') },
        }] };
      }
      if (tc?.turnExchange?.length && !두번째tc) 두번째tc = tc;
      return '읽었어요.';
    },
  };
  await runTurn({ text: '정산.csv 읽어줘' }, { env: demoEnv(), tools: demoTools({ localFile }), model });
  assert.ok(두번째tc, '실행 뒤 모델을 다시 안 불렀다 — 이 시험이 성립하지 않는다');
  assert.equal(두번째tc.turnExchange[0].providerCallId, 'call_FROM_MODEL',
    '실행을 지나며 모델이 발급한 신분이 사라졌다');
});

// ── ⑥ 공급자별 반대시험 — **일부러 깨뜨려 걸리는지 본다** ────────────────────
//
// 위 검사들은 "보존됐는가"를 본다. 그것만으로는 부족하다 — 어느 한 공급자에서만 신분이
// 새거나 지어내져도 나머지가 초록이면 통과한다. 그래서 공급자마다 **어긋난 상태를 만들어**
// 실제로 빨개지는지 확인한다(preflight 첫 판이 자기 자신과 비교해 늘 통과하던 병의 예방).

test('반대시험: 신분이 다르면 와이어에서 갈린다(짝만 맞으면 통과하는 검사 금지)', () => {
  const 만들기 = (providerCallId) => buildModelMessages(buildTaskContext({
    intent, selfState,
    receipts: [{
      intended: '읽기', failureState: 'none', userSafeSummary: '읽었어요.',
      actualCall: { tool: 'local.file', args: { action: 'read' }, providerCallId, callRef: '걸음1' },
      result: { text: '내용 알맹이' },
    }],
  }));
  const cfg = { modelId: 'm', maxTokens: 100, baseUrl: 'http://x' };
  const 진짜 = MODEL_PROVIDERS.openai.body(cfg, 만들기('call_REAL1'), { tools: [] });
  const 다른것 = MODEL_PROVIDERS.openai.body(cfg, 만들기('call_OTHER'), { tools: [] });
  assert.notEqual(진짜, 다른것, '신분을 바꿔도 와이어가 같다면 신분이 실리지 않는 것이다');
  assert.ok(진짜.includes('call_REAL1') && !진짜.includes('걸음1'),
    '공급자 신분이 있으면 그것이 이겨야 한다 — T5 내부 ref 가 와이어로 새면 안 된다');
});

test('반대시험: 공급자별로 신분이 실제로 실린다 — 한 곳이라도 빠지면 걸린다', () => {
  const tc = buildTaskContext({
    intent, selfState,
    receipts: [{
      intended: '읽기', failureState: 'none', userSafeSummary: '읽었어요.',
      actualCall: { tool: 'local.file', args: { action: 'read' }, providerCallId: 'call_REAL1', callRef: '걸음1' },
      result: { text: '내용 알맹이' },
    }],
  });
  const m = buildModelMessages(tc);
  const cfg = { modelId: 'm', maxTokens: 100, baseUrl: 'http://x' };
  // 신분을 **쓰는** 규약과 **안 쓰는** 규약을 나눠서 각자의 계약으로 잰다.
  const 신분쓰는곳 = ['openai', 'openai_oauth', 'openai_compatible', 'anthropic'];
  const 빠진곳 = [];
  for (const [name, spec] of Object.entries(MODEL_PROVIDERS)) {
    if (typeof spec.body !== 'function' || !신분쓰는곳.includes(name)) continue;
    if (!spec.body(cfg, m, { tools: [] }).includes('call_REAL1')) 빠진곳.push(name);
  }
  assert.deepEqual(빠진곳, [], `이 공급자들은 모델에게 지어낸 신분을 돌려준다: ${빠진곳.join(', ')}`);
});

test('반대시험: Gemini 는 신분을 받아도 규약에 없는 칸을 만들지 않는다', () => {
  // 같은 영수증(신분 있음)을 Gemini 와이어로 보내도 id 칸이 생기면 안 된다 —
  // 규약에 없는 자리에 신분을 끼워 넣으면 그 요청 자체가 깨진다.
  const m = buildModelMessages(buildTaskContext({
    intent, selfState,
    receipts: [{
      intended: '읽기', failureState: 'none', userSafeSummary: '읽었어요.',
      actualCall: { tool: 'local.file', args: { action: 'read' }, providerCallId: 'call_REAL1', callRef: '걸음1' },
      result: { text: '내용 알맹이' },
    }],
  }));
  const 전문 = MODEL_PROVIDERS.gemini.body({ modelId: 'm', maxTokens: 100, baseUrl: 'http://x' }, m, { tools: [] });
  assert.equal(전문.includes('call_REAL1'), false, 'Gemini 규약에 없는 자리로 신분이 샜다');
  assert.ok(전문.includes('내용 알맹이'), '신분을 안 싣는다고 결과까지 빠지면 안 된다');
});

test('반대시험: 못 실행한 호출의 신분도 원장에 남는다(실행된 것과 구분된 채)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'call-id-skip-'));
  await writeFile(join(dir, 'a.txt'), 'x');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  let 냈나 = false;
  let 두번째 = null;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [
          { providerCallId: 'call_DONE', name: 'local.file', args: { action: 'read', path: join(dir, 'a.txt') } },
          { providerCallId: 'call_SKIP', name: 'nonexistent.hand', args: {} },
        ] };
      }
      if ((tc?.turnExchange?.length || tc?.evidenceFacts?.length) && !두번째) 두번째 = tc;
      return '읽었어요.';
    },
  };
  await runTurn({ text: 'a.txt 읽어줘' },
    { env: demoEnv(), tools: demoTools({ localFile }), model });

  // **계약은 "모델에게 돌아가는가"다**(오너 지시) — 감사 원장이 아니라 모델 입력에서 잰다.
  assert.ok(두번째, '실행 뒤 모델을 다시 안 불렀다 — 이 시험이 성립하지 않는다');
  const 실린것 = [...(두번째.turnExchange ?? []), ...(두번째.evidenceFacts ?? [])];
  const 전문 = JSON.stringify(실린것);
  assert.ok(전문.includes('call_DONE'), '실행된 호출의 신분이 모델에게 안 간다');
  assert.ok(전문.includes('call_SKIP'),
    `못 실행한 호출의 신분이 사라졌다 — 모델은 자기가 시킨 것이 갔다고 믿는다: ${전문.slice(0, 400)}`);
  // 그리고 **둘이 구분돼야** 한다 — 안 간 것이 간 것처럼 보이면 더 나쁘다.
  //
  // **S2(2026-08-05): 구분하는 방식이 바뀌었다.** 예전엔 "못 간 호출은 교환에 없다"로 갈랐다.
  // 그런데 그러면 모델은 자기가 낸 호출이 **통째로 사라진 것**으로 본다 — 원리 ⑤ 위반이다
  // (OpenClaw 는 막힌 호출에도 `buildBlockedToolResult` 로 결과를 돌려준다).
  // 이제 교환은 "모델 자신의 행동 이력"이고, 간 것과 안 간 것은 **`failureState` 로** 갈린다.
  // 계약의 뜻은 그대로다: 안 간 것에 결과가 붙으면 안 된다.
  const 간것 = (두번째.turnExchange ?? []).find((x) => x.providerCallId === 'call_DONE');
  assert.ok(간것?.data !== undefined, '실행된 호출에는 결과가 붙는다');
  assert.equal(간것.failureState, undefined, '성공한 호출에 실패 상태가 붙었다');
  const 못간것 = (두번째.turnExchange ?? []).find((x) => x.providerCallId === 'call_SKIP');
  assert.ok(못간것, '못 간 호출이 모델의 행동 이력에서 사라졌다');
  assert.ok(못간것.failureState && 못간것.failureState !== 'none',
    '못 간 호출에 상태가 없다 — 간 것과 구분이 안 된다');
  assert.equal(못간것.data, undefined, '못 간 호출에 결과가 붙었다 — 안 간 것이 간 것처럼 보인다');
});

// ── ⑦ ChatGPT OAuth(Responses) 경로 — 다른 규약, 같은 계약 ──────────────────
//
// 이 공급자는 `chat/completions` 가 아니라 **Responses API** 를 쓴다. 규약이 다르다:
//   모델이 낸 호출  `{type:'function_call', call_id, name, arguments}`
//   그 결과        `{type:'function_call_output', call_id, output}`
//
// 처음 확인했을 때 여기엔 두 결함이 있었다(2026-08-04):
//   ① `call_id` 를 `callId` 라는 **세 번째 이름**으로 담아 커널이 못 읽었다
//   ② `input` 에 **교환 자체가 없었다** — 이 공급자 사용자만 자기 도구 대화를 통째로 못 받는다
// 한 공급자만 조용히 눈이 머는 자리라 여기서 따로 잰다.
test('Responses 경로: 모델이 낸 call_id 가 providerCallId 로 온다', async () => {
  const { toolCallFromLine } = await import('../src/runtime/chatgpt-model-client.js');
  const line = `data: ${JSON.stringify({
    type: 'response.output_item.done',
    item: { type: 'function_call', call_id: 'call_RESP1', name: 'local_file', arguments: '{"action":"read"}' },
  })}`;
  const c = toolCallFromLine(line);
  assert.ok(c, '호출을 못 뽑았다');
  assert.equal(c.providerCallId, 'call_RESP1',
    '공급자 신분이 커널이 읽는 이름으로 안 온다 — 이 공급자만 신분이 끊긴다');
});

test('Responses 경로: 다음 입력에 원래 call_id 의 function_call / function_call_output 이 실린다', async () => {
  const { responsesInput } = await import('../src/runtime/chatgpt-model-client.js');
  const m = buildModelMessages(buildTaskContext({
    intent, selfState,
    receipts: [{
      intended: '읽기', failureState: 'none', userSafeSummary: '읽었어요.',
      actualCall: { tool: 'local.file', args: { action: 'read' }, providerCallId: 'call_RESP1', callRef: '걸음1' },
      result: { text: '내용 알맹이' },
    }],
  }));
  const input = responsesInput(m);
  const 부름 = input.find((i) => i.type === 'function_call');
  const 결과 = input.find((i) => i.type === 'function_call_output');
  assert.ok(부름, '모델이 낸 호출이 다음 입력에 없다 — 이 공급자만 자기 행동을 못 본다');
  assert.equal(부름.call_id, 'call_RESP1', '원래 신분이 아니다');
  assert.ok(결과, '도구 결과가 다음 입력에 없다');
  assert.equal(결과.call_id, 'call_RESP1', '결과가 원래 호출에 안 붙는다');
  assert.ok(String(결과.output).includes('내용 알맹이'), '결과 알맹이가 빠졌다');
  // 사용자 발화는 여전히 정확히 한 번(교환을 붙이며 두 벌이 되면 안 된다).
  assert.equal(JSON.stringify(input).split('내용 알맹이').length - 1, 1, '같은 사실이 두 번 실렸다');
});

// ── ⑧ 승인 재개 — 사용자가 승인한 그 호출이라는 사실이 끊기지 않는다 ────────
test('최초 계획 승인도 신분을 봉인하고, 재개 뒤 영수증·모델 입력까지 같은 신분이 간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'call-id-approval-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const localTerminal = {
    async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '지웠어요.' }; },
  };
  let 냈나 = false;
  let 재개tc = null;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{
          providerCallId: 'call_APPROVED', name: 'local.terminal', args: { command: 'rm -rf 임시폴더' },
        }] };
      }
      if (tc?.turnExchange?.length && !재개tc) 재개tc = tc;
      return '지웠어요.';
    },
  };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model };
  const 카드 = await runTurn({ text: '임시폴더 지워줘' }, ctx);
  assert.equal(카드.kind, 'approval', '이 시험은 승인 카드가 떠야 성립한다');

  const 재개 = await runTurn({ approve: 카드.pendingId }, ctx);
  assert.equal(재개.kind, 'reply');
  assert.ok(재개tc, '승인 재개 뒤 모델을 다시 안 불렀다');
  const x = 재개tc.turnExchange.find((e) => e.tool === 'local.terminal');
  assert.ok(x, '승인해서 실행한 것이 모델 이력에 없다');
  assert.equal(x.providerCallId, 'call_APPROVED',
    '사용자가 승인한 그 호출이라는 사실이 재개 경계에서 끊겼다 — 모델은 자기가 낸 호출과 못 잇는다');
});
