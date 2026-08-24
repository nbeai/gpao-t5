import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { ResourceController } from '../src/resource-controller.js';
import { ResourceLedger } from '../src/resource-ledger.js';
import { resourceSituationBlock, resourceSituationTransitionKey } from '../src/resource-situation.js';

test('Resource Situation은 exact usage·Evidence·input·기존 상한을 content-free 관측으로 분리한다', async () => {
  const ledger = new ResourceLedger(await mkdtemp(join(tmpdir(), 't5-resource-situation-')));
  const run = await new ResourceController(ledger).startRun({ sessionId: 'session', runId: 'run' });
  const observer = run.modelObserver({ logicalCallId: 'main:1', purpose: 'main' });
  const handle = await observer.reserve({ provider: 'fixture', model: 'model', attempt: 1,
    contextReceipt: { requestBytes: 1234, input: { bytes: 1000 }, tools: { bytes: 200 }, source: { bytes: 700 } } });
  await observer.commit(handle, { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  await run.observeTool({ turn: 1, toolCallId: 'tool-1', name: 'exec', outcome: 'succeeded',
    startedAt: Date.now(), evidenceFingerprint: 'novel-one' });
  const situation = run.situation({
    agent: { modelTurns: 1, toolCalls: 1, providerTokens: 120 },
    limits: { maxModelTurns: 16, maxToolCalls: 24, maxProviderTokens: 500000 },
    information: { historicalConversationBytes: 300, memoryBytes: 40,
      currentRunToolReceiptBytes: 500, repeatedToolReceiptBytes: 0, activeToolDefinitionBytes: 900 },
  });
  assert.equal(situation.usage.allObservedModelCalls, 1);
  assert.equal(situation.usage.allObservedProviderTokens, 120);
  assert.equal(situation.usage.allObservedRequestBytes, 1234);
  assert.equal(situation.evidence.novel, 1);
  assert.equal(situation.input.historicalConversationBytes, 300);
  assert.equal(situation.legacyFixedBoundaries.modelTurns.used, 1);
  assert.equal(situation.legacyFixedBoundaries.modelTurns.configured, 16);
  assert.equal(situation.legacyFixedBoundaries.modelTurns.wouldReachOnNextObservedPattern, false);
  assert.equal(situation.legacyFixedBoundaries.changedBySituation, false);
  assert.doesNotMatch(JSON.stringify(situation), /session|run|tool-1|novel-one/u);
});

test('Situation은 ephemeral runtime projection에만 들어가고 canonical transcript·사용자 답을 바꾸지 않는다', async () => {
  const events = [];
  const resourceRun = {
    situation() { return {
      state: 'observed', accounting: 'exact_or_explicit_unknown', intervention: false,
      usage: { foregroundModelTurns: 2 }, evidence: { novel: 2 },
      input: { repeatedToolReceiptBytes: 500 },
      legacyFixedBoundaries: { modelTurns: { used: 0, configured: 16 }, changedBySituation: false },
      anomaly: { category: 'pathology_candidate', signals: ['repeated_evidence_only'] },
    }; },
    modelObserver() { return null; }, async observeTool() {},
  };
  const result = await runAgent({
    request: '사용자 원문', resourceRun, model: { async respond(input) {
      assert.match(input.runtimeContext, /T5 CURRENT RESOURCE SITUATION/u);
      assert.equal(input.messages.at(-1).content, '사용자 원문');
      return { text: '자연스러운 사용자 답', toolCalls: [] };
    } }, onEvent: (event) => events.push(event),
  });
  assert.equal(result.answer, '자연스러운 사용자 답');
  assert.equal(result.transcript[0].content, '사용자 원문');
  assert.equal(events.filter((event) => event.type === 'resource_situation').length, 1);
  assert.doesNotMatch(JSON.stringify(result.transcript), /RESOURCE SITUATION/u);
});

test('accounting degraded와 A1-3 off는 model projection을 바꾸지 않는다', async () => {
  const resourceRun = { situation() { return null; }, modelObserver() { return null; }, async observeTool() {} };
  for (const mode of ['current-v1', 'off']) {
    await runAgent({ request: '그대로 답해', resourceRun, resourceSituationMode: mode,
      model: { async respond(input) {
        assert.equal(input.runtimeContext, undefined);
        assert.doesNotMatch(input.messages.at(-1).content, /RESOURCE SITUATION/u);
        return { text: '그대로', toolCalls: [] };
      } } });
  }
});

test('Resource Situation Core는 fixed ratio·OS path·PID·signal·중단 정책을 포함하지 않는다', async () => {
  const source = await readFile(new URL('../src/resource-situation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /0\.5|0\.9|50%|90%|darwin|win32|WSL|SIGTERM|SIGKILL|\/Users\//u);
  assert.doesNotMatch(source, /abort\(|stop\(|throw.*runaway/u);
  const block = resourceSituationBlock({ state: 'observed', usage: {}, evidence: {}, input: {},
    legacyFixedBoundaries: { changedBySituation: false }, anomaly: null });
  assert.ok(Buffer.byteLength(block) < 8 * 1024);
  assert.equal(resourceSituationTransitionKey({
    state: 'observed', usage: {}, evidence: {}, input: {},
    legacyFixedBoundaries: { modelTurns: { wouldReachOnNextObservedPattern: false } },
    anomaly: { category: 'efficiency_candidate', signals: ['request_projection_growth'] },
  }), null);
  assert.ok(resourceSituationTransitionKey({
    state: 'observed', usage: {}, evidence: {}, input: {},
    legacyFixedBoundaries: { modelTurns: { wouldReachOnNextObservedPattern: true } }, anomaly: null,
  }));
});

test('다섯 provider adapter는 stable constitution 뒤 최신 runtime suffix를 매 요청 새로 조립한다', async () => {
  const files = [
    'openai-responses-model.js', 'chatgpt-responses-model.js', 'anthropic-messages-model.js',
    'gemini-generate-content-model.js', 'upstage-chat-completions-model.js',
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /runtimeContext/u, file);
    assert.match(source, /requestInstructions/u, file);
    assert.match(source, /runtimeContext \? `\$\{instructions\}\\n\\n\$\{runtimeContext\}` : instructions/u, file);
  }
  const upstage = await readFile(new URL('../src/upstage-chat-completions-model.js', import.meta.url), 'utf8');
  assert.match(upstage, /initialMessages\(messages, '', model\)/u);
  assert.match(upstage, /\{ role: 'system', content: requestInstructions \}/u);
});
