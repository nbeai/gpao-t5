// P0 모델 상태 진실 — auth·health·id를 한 번만 합쳐 모든 소비자가 같은 readiness를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildSelfState, selfStateSummary } from '../src/kernel/l0-evidence/self-state.js';
import { buildCapabilityFacts } from '../src/kernel/capabilities.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildWelcomeContext } from '../src/surface/welcome.js';
import { makeModelConnection, connectionId } from '../src/surface/model-connection.js';

const state = (model) => buildSelfState({ model, connections: [] });

test('auth·health·id 결합 상태표 — usable은 두 축이 확인된 한 칸뿐이다', () => {
  const rows = [
    [{ id: 'beai5-stub', authSignal: 'ok' }, 'stub', false],
    [{ id: 'beai5-stub', authSignal: 'insufficient_quota' }, 'billing_blocked', false],
    [{ id: 'm', authSignal: 'ok' }, 'unverified', false],
    [{ id: 'm', authSignal: 'ok', healthState: 'usable' }, 'usable', true],
    [{ id: 'm', authSignal: 'invalid_api_key', healthState: 'usable' }, 'auth_failed', false],
    [{ id: 'm', authSignal: 'ok', healthState: 'auth_failed' }, 'auth_failed', false],
    [{ id: 'm', authSignal: 'ok', healthState: 'billing_blocked' }, 'billing_blocked', false],
    [{ id: 'm', authSignal: 'ok', healthState: 'rate_limited' }, 'rate_limited', false],
    [{ id: 'm', authSignal: 'ok', healthState: 'model_missing' }, 'model_missing', false],
    [{ id: 'm', authSignal: 'ok', healthState: 'unreachable' }, 'unreachable', false],
  ];
  for (const [model, expected, ready] of rows) {
    const s = state(model);
    assert.equal(s.modelStatus, expected, JSON.stringify(model));
    assert.equal(s.modelReady, ready, JSON.stringify(model));
  }
});

test('unverified는 연결 없음이 아니라 확인 중이며 호출 권한을 막지 않는다', () => {
  const s = state({ id: 'configured-model', authSignal: 'ok' });
  assert.equal(s.modelStatus, 'unverified');
  assert.equal(s.modelReady, false);
  assert.ok(s.limits.some((x) => /확인 중|미확인/.test(x)), JSON.stringify(s.limits));
  assert.doesNotMatch(String(s.nextSafeAction ?? ''), /다시 연결|키/,
    '미검증을 연결 실패로 바꾸어 사용자에게 재연결을 시켰다');
});

test('summary·task context·capability·welcome가 같은 modelStatus를 쓴다', () => {
  const s = state({ id: 'beai5-stub', authSignal: 'ok' });
  const summary = selfStateSummary(s);
  const task = buildTaskContext({
    intent: { answerMode: 'fast_chat', currentRequest: '안녕', neededTools: [] },
    selfState: s, plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [],
  });
  const capability = buildCapabilityFacts(s);
  const welcome = buildWelcomeContext(s);
  assert.equal(summary.modelStatus, 'stub');
  assert.equal(summary.modelReady, false);
  assert.equal(task.selfStateFacts.modelStatus, 'stub');
  assert.equal(capability.model.status, 'stub');
  assert.equal(capability.model.ready, false);
  assert.equal(welcome.selfStateFacts.modelStatus, 'stub');
  for (const value of [summary, task.selfStateFacts, capability.model, welcome.selfStateFacts]) {
    assert.notEqual(value.modelStatus, 'usable', 'stub을 ready로 꾸면 안 된다');
  }
});

test('화면 칩은 auth·health를 다시 합치지 않고 modelStatus 정본만 읽는다', async () => {
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /s\.modelStatus/);
  assert.doesNotMatch(html, /const healthIssue = s\.modelHealthState/,
    '화면이 auth·health 합성을 다시 소유한다');
  const welcome = /async function maybeWelcome[\s\S]*?\n}/.exec(html)?.[0] ?? '';
  assert.ok(welcome, 'maybeWelcome 제품 경로가 없다');
  assert.doesNotMatch(welcome, /\/model\/connection/,
    '웰컴 앞에 connected 이중 판정이 남아 modelStatus 정본을 가린다');
});

const TC = {
  currentRequest: '안녕', selfStateFacts: {}, admittedContext: [],
  authorityFacts: {}, answerMode: 'fast_chat', naturalness: 'method_and_language_open',
};

test('no-config stub은 respond 성공으로 usable에 승격하지 않는다', async () => {
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {} });
  const reply = await mc.model.respond(TC);
  assert.ok(reply);
  assert.notEqual(env.model.healthState, 'usable');
  assert.equal(state(env.model).modelStatus, 'stub');
});

test('실제 default provider 응답 성공은 같은 세대를 usable로 올린다', async () => {
  const env = {};
  const fetchImpl = async (url) => {
    if (String(url).includes('/chat/completions')) {
      return { status: 200, json: async () => ({ choices: [{ message: { content: '실제 응답' } }] }) };
    }
    return { status: 200, json: async () => ({ data: [{ id: 'local-model' }] }) };
  };
  const mc = makeModelConnection({
    env,
    processEnv: { GPAO_T5_MODEL_BASE_URL: 'http://127.0.0.1:9/v1', GPAO_T5_MODEL_ID: 'local-model' },
    fetchImpl,
  });
  assert.equal(state(env.model).modelStatus, 'unverified');
  assert.equal(await mc.model.respond(TC), '실제 응답');
  assert.equal(env.model.healthState, 'usable');
  assert.equal(state(env.model).modelStatus, 'usable');
});

test('느린 예전 doctor 결과가 hot swap된 새 모델 상태를 덮지 않는다', async () => {
  const env = {};
  let hold = false; let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (url) => {
    const u = String(url);
    if (hold && u.includes('/models')) { await delayed; return { status: 503, json: async () => ({}) }; }
    if (u.includes('googleapis.com')) {
      if (u.includes(':generateContent')) return { status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'gemini' }] } }] }) };
      return { status: 200, json: async () => ({ models: [{ name: 'models/gemini-flash-latest' }] }) };
    }
    if (u.includes('/models')) return { status: 200, json: async () => ({ data: [{ id: 'beai-8.6' }] }) };
    return { status: 200, json: async () => ({ choices: [{ message: { content: 'beai' } }] }) };
  };
  const mc = makeModelConnection({ env, processEnv: {}, fetchImpl });
  await mc.connect({ provider: 'beai', key: 'a' });
  await mc.connect({ provider: 'gemini', key: 'b' });
  const beai = connectionId({ provider: 'beai', modelId: 'beai-8.6' });
  const gemini = connectionId({ provider: 'gemini', modelId: 'gemini-flash-latest' });
  await mc.activate(beai);
  hold = true;
  const oldDoctor = mc.doctor();
  await mc.activate(gemini);
  release();
  await oldDoctor;
  assert.equal(env.model.id, 'gemini-flash-latest');
  assert.notEqual(env.model.healthState, 'unreachable', '예전 연결 doctor가 새 기본 모델을 연결 불가로 덮었다');
  assert.equal(state(env.model).modelStatus, 'unverified', '새 모델은 자기 확인 전에 예전 health를 받으면 안 된다');
});
