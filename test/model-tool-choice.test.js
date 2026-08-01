// P2-5b · 도구 **선택**을 모델에게 — 집행은 그대로 런타임이.
//
// 왜: 어느 도구가 필요한지를 정규식이 정했다. 정규식이 못 알아들으면 GPT-5.5 도 못 했다.
// §24: 코드는 경계와 사실, 모델은 이해와 선택.
//
// **이 파일의 핵심 불변식**: 모델이 무엇을 고르든 안전 경계는 그대로다.
// 모델이 delete 를 골라도 승인 카드가 뜨고, 범위 밖은 막히고, 실행 안 된 건 실행 안 된 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolSchemasFor, callsToIntentParts } from '../src/kernel/l2-plan/tool-schema.js';
import { toolCallFromLine } from '../src/runtime/chatgpt-model-client.js';
import { runTurn } from '../src/kernel/turn.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());

// 모델이 도구를 고르는 상황을 흉내낸다. 실제 모델 대신 이 스텁이 선택을 돌려준다.
const modelChoosing = (calls, finalText = '했어요') => {
  let turn = 0;
  return {
    async respond(_tc, opts = {}) {
      turn += 1;
      const withTools = Boolean(opts.tools?.length);
      if (turn === 1 && withTools && calls.length) return { text: '', toolCalls: calls };
      return withTools ? { text: finalText, toolCalls: [] } : finalText;
    },
  };
};

// ── 스키마: 실행 가능한 것만 보여준다 ────────────────────────────────────
test('실행할 수 없는 도구는 모델에게 보여주지 않는다(되는 줄 알고 약속하면 안 된다)', () => {
  const names = toolSchemasFor(selfState).map((t) => t.name);
  assert.ok(names.includes('local.file'));
  assert.ok(!names.includes('mail.send'), '연결 안 된 도구를 고르게 하면 "된다더니 안 된다"가 된다');
});

test('스키마에 무엇을 할 수 있는지가 담긴다(모델이 고르려면 알아야 한다)', () => {
  const file = toolSchemasFor(selfState).find((t) => t.name === 'local.file');
  assert.match(file.description, /파일/);
  assert.deepEqual(file.parameters.properties.action.enum, ['list', 'read', 'write', 'move', 'delete', 'undo', 'versions']);
});

// ── 호출 → 커널 형태 변환 ────────────────────────────────────────────────
test('모델의 파일 호출은 fileOp 로 실려 권한 판정이 작업을 본다', () => {
  const parts = callsToIntentParts([{ name: 'local.file', args: { action: 'delete', path: 'a.md' } }], selfState);
  assert.deepEqual(parts.neededTools, ['local.file']);
  assert.deepEqual(parts.fileOp, { action: 'delete', path: 'a.md' });
});

test('모르는 도구 이름은 조용히 버린다(있는 척 금지)', () => {
  const parts = callsToIntentParts([{ name: 'nuke.everything', args: {} }, { name: 'web.collect', args: { request: '뉴스' } }], selfState);
  assert.deepEqual(parts.neededTools, ['web.collect']);
});

// ── 와이어: Responses 셰이프에서 도구 호출을 거둔다 ──────────────────────
test('스트림에서 도구 호출을 뽑는다', () => {
  const line = 'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"local.file","arguments":"{\\"action\\":\\"list\\"}","call_id":"c1"}}';
  assert.deepEqual(toolCallFromLine(line), { name: 'local.file', args: { action: 'list' }, callId: 'c1' });
});

test('인자가 깨졌으면 버린다(반쪽 인자로 실행하지 않는다)', () => {
  const line = 'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"local.file","arguments":"{깨짐"}}';
  assert.equal(toolCallFromLine(line), null);
});

test('텍스트 조각은 도구 호출로 오인하지 않는다', () => {
  assert.equal(toolCallFromLine('data: {"type":"response.output_text.delta","delta":"안녕"}'), null);
});

// ── 불변식: 모델이 무엇을 고르든 경계는 그대로 ───────────────────────────
test('모델이 삭제를 골라도 승인 없이 실행되지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-choice-'));
  await writeFile(join(dir, '중요.md'), '지워지면 안 됨');
  const ctx = {
    env: demoEnv(),
    model: modelChoosing([{ name: 'local.file', args: { action: 'delete', path: '중요.md' } }]),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
  };
  const r = await runTurn({ text: '작업 폴더 좀 정리해줘' }, ctx);
  assert.equal(r.kind, 'approval', `모델 선택이 승인을 우회했다: ${r.kind}`);
  await stat(join(dir, '중요.md')); // 없으면 throw
});

test('모델이 전송을 골라도 승인 게이트를 탄다', async () => {
  const ctx = {
    env: demoEnv(),
    model: modelChoosing([{ name: 'slack.post', args: { text: '회의 시작', target: '#일반' } }]),
    tools: demoTools(),
  };
  const r = await runTurn({ text: '팀에 알려줘' }, ctx);
  assert.ok(['approval', 'clarify'].includes(r.kind), `실제: ${r.kind}`);
  assert.deepEqual(r.ledger?.confirmed ?? [], [], '승인 전에는 실행 사실이 없다');
});

test('읽기처럼 안전한 선택은 그대로 진행한다(안전을 이유로 다 막지 않는다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-choice2-'));
  await writeFile(join(dir, '메모.md'), '내용');
  const ctx = {
    env: demoEnv(),
    model: modelChoosing([{ name: 'local.file', args: { action: 'list', path: '.' } }], '파일 1개 있어요'),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
  };
  const r = await runTurn({ text: '거기 뭐 있는지 봐줘' }, ctx);
  assert.equal(r.kind, 'reply');
  assert.ok((r.ledger?.confirmed ?? []).length > 0, '안전한 선택은 실행되고 원장에 남는다');
});

test('모델이 도구를 안 고르면 예전처럼 그냥 답한다(폴백 유지)', async () => {
  const ctx = { env: demoEnv(), model: modelChoosing([], '안녕하세요'), tools: demoTools() };
  const r = await runTurn({ text: '안녕' }, ctx);
  assert.equal(r.kind, 'reply');
  assert.equal(r.reply, '안녕하세요');
});

// ── P2-5b-2: 다른 provider 도 같은 계약 ──────────────────────────────────
// 라이브(ChatGPT)에서 검증된 것을 넓힌다. 셰이프만 다르고 계약은 같다:
// 도구를 주면 {text, toolCalls} 를 돌려주고, 이름은 와이어에서 안전하게 바꿨다가 되돌린다.
import { MODEL_PROVIDERS, makeProviderModelClient, wireToolName } from '../src/runtime/model-provider.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';

const TOOLS = [{ name: 'local.file', description: '파일', parameters: { type: 'object', properties: {} } }];
const tcFor = (text) => buildTaskContext({ intent: interpret(text), selfState });

test('와이어 이름 규칙: 점을 쓰지 못하는 서버가 있다(라이브 400 실측)', () => {
  assert.equal(wireToolName('local.file'), 'local_file');
  assert.match(wireToolName('local.file'), /^[a-zA-Z0-9_-]+$/);
});

test('OpenAI 계열: tools 를 싣고 tool_calls 를 되돌린다', () => {
  const body = JSON.parse(MODEL_PROVIDERS.openai.body({ modelId: 'x', maxTokens: 1 }, { system: 's', user: 'u' }, { tools: TOOLS }));
  assert.equal(body.tools[0].function.name, 'local_file');
  const calls = MODEL_PROVIDERS.openai.extractToolCalls({
    choices: [{ message: { tool_calls: [{ function: { name: 'local_file', arguments: '{"action":"list"}' } }] } }],
  });
  assert.deepEqual(calls, [{ name: 'local_file', args: { action: 'list' } }]);
});

test('Anthropic: input_schema 로 싣고 tool_use 를 읽는다', () => {
  const body = JSON.parse(MODEL_PROVIDERS.anthropic.body({ modelId: 'x', maxTokens: 1 }, { system: 's', user: 'u' }, { tools: TOOLS }));
  assert.equal(body.tools[0].input_schema.type, 'object');
  const calls = MODEL_PROVIDERS.anthropic.extractToolCalls({
    content: [{ type: 'text', text: '음' }, { type: 'tool_use', name: 'local_file', input: { action: 'read' } }],
  });
  assert.deepEqual(calls, [{ name: 'local_file', args: { action: 'read' } }]);
});

test('Gemini: function_declarations 로 싣고 functionCall 을 읽는다', () => {
  const body = JSON.parse(MODEL_PROVIDERS.gemini.body({ modelId: 'x', baseUrl: 'https://b' }, { system: 's', user: 'u' }, { tools: TOOLS }));
  assert.equal(body.tools[0].function_declarations[0].name, 'local_file');
  const calls = MODEL_PROVIDERS.gemini.extractToolCalls({
    candidates: [{ content: { parts: [{ functionCall: { name: 'local_file', args: { action: 'list' } } }] } }],
  });
  assert.deepEqual(calls, [{ name: 'local_file', args: { action: 'list' } }]);
});

test('provider 경로: 이름을 되돌려 커널 도구 id 로 준다', async () => {
  const client = makeProviderModelClient(
    { provider: 'anthropic', token: 'k', modelId: 'claude-x', baseUrl: 'https://api.anthropic.com' },
    { fetchImpl: async () => ({ status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'local_file', input: { action: 'list' } }] }) }) },
  );
  const out = await client.respond(tcFor('봐줘'), { tools: TOOLS });
  assert.deepEqual(out.toolCalls, [{ name: 'local.file', args: { action: 'list' } }]);
});

test('provider 경로: 모르는 도구 이름은 버린다(실행하지 않는다)', async () => {
  const client = makeProviderModelClient(
    { provider: 'anthropic', token: 'k', modelId: 'claude-x', baseUrl: 'https://api.anthropic.com' },
    { fetchImpl: async () => ({ status: 200, json: async () => ({ content: [{ type: 'text', text: '음' }, { type: 'tool_use', name: 'shell_exec', input: {} }] }) }) },
  );
  const out = await client.respond(tcFor('해줘'), { tools: TOOLS });
  assert.deepEqual(out.toolCalls, []);
});

test('도구를 준 턴은 텍스트가 비어도 빈 응답으로 보지 않는다', async () => {
  const client = makeProviderModelClient(
    { provider: 'anthropic', token: 'k', modelId: 'claude-x', baseUrl: 'https://api.anthropic.com' },
    { fetchImpl: async () => ({ status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'local_file', input: {} }] }) }) },
  );
  const out = await client.respond(tcFor('해줘'), { tools: TOOLS });
  assert.equal(out.text, '');
  assert.equal(out.toolCalls.length, 1);
});
