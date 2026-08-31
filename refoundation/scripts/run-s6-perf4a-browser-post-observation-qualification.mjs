#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeBrowserObservationTool } from '../src/browser-observation-tool.js';
import { makeStoredChatGptCredentialSource } from '../src/chatgpt-oauth-credential.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';

const sourceFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = source.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? source.connections?.find((item) => item.id === source.activeId && item.kind === 'chatgpt_oauth');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') {
  throw new Error('exact secret-backed gpt-5.5 ChatGPT OAuth connection is required');
}
const room = await mkdtemp(join(tmpdir(), 't5-perf4a-')); const stateDir = join(room, 'state');
await mkdir(stateDir, { recursive: true });
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({
  version: source.version, activeId: selected.id, roleBindings: {}, connections: [selected],
}), { mode: 0o600 });
const credentials = makeStoredChatGptCredentialSource({
  file: connectionFile, secretStore: makePlatformSecretStore({ platform: process.platform }),
});
const fixtureDriver = { async available() { return { available: true }; } };
const baseTool = makeBrowserObservationTool({ driver: fixtureDriver });
const afterObservation = {
  observationId: 'after-observation-1',
  refScope: { observationId: 'after-observation-1', tabId: 'tab-1', targetId: 'target-1',
    url: 'http://127.0.0.1:8765/' },
  page: { text: 'Counter 1', totalChars: 9, shownChars: 9, truncated: false },
  refs: { counter: { role: 'status', name: 'Counter 1' } }, editables: [],
};
const variants = [
  { id: 'current_description', extra: '' },
  { id: 'explicit_after_observation_fact', extra: [
    ' click, fill, select, and fill_editable already return a fresh after observation from the same action.',
    ' Use that returned URL, page text, refs, editables, and network facts directly;',
    ' call snapshot afterward only when the required physical fact is absent from after.',
  ].join('') },
];

async function runVariant(variant) {
  const tool = { ...baseTool, description: `${baseTool.description}${variant.extra}` };
  const model = makeChatGptResponsesModel({ credentials, model: selected.modelId, maxAttempts: 1 });
  const messages = [{ role: 'user', content: [
    '로컬 대시보드 http://127.0.0.1:8765/ 를 열고 다음 버튼을 한 번 눌러',
    '화면의 Counter가 0에서 1로 바뀌었는지 확인해서 답해줘.',
  ].join(' ') }];
  const actions = []; let clicked = false; let redundantSnapshots = 0; let final = '';
  let tokens = 0; let requestBytes = 0; const started = performance.now();
  for (let turn = 1; turn <= 6; turn += 1) {
    const response = await model.respond({ messages, tools: [tool] });
    tokens += Number(response.usage?.total_tokens ?? 0);
    requestBytes += Number(response.contextReceipt?.requestBytes ?? 0);
    messages.push({ role: 'assistant', content: response.text ?? '', toolCalls: response.toolCalls ?? [] });
    if (!(response.toolCalls ?? []).length) { final = response.text ?? ''; break; }
    for (const call of response.toolCalls) {
      const action = call.args?.action; actions.push(action ?? 'unknown');
      let result;
      if (action === 'navigate') result = {
        state: 'observed', effect: 'observe',
        tab: { tabId: 'tab-1', targetId: 'target-1', title: 'Dashboard', url: 'http://127.0.0.1:8765/' },
        observation: { observationId: 'before-observation-0',
          refScope: { observationId: 'before-observation-0', tabId: 'tab-1', targetId: 'target-1',
            url: 'http://127.0.0.1:8765/' }, page: { text: 'Counter 0; button Next', totalChars: 22,
            shownChars: 22, truncated: false }, refs: { next: { role: 'button', name: 'Next' } }, editables: [] },
      };
      else if (action === 'click') {
        clicked = true;
        result = { state: 'acted', action: { kind: 'click', ref: 'next' },
          tab: { tabId: 'tab-1', targetId: 'target-1', title: 'Dashboard', url: 'http://127.0.0.1:8765/' },
          after: afterObservation,
          navigation: { changed: false, from: 'http://127.0.0.1:8765/', to: 'http://127.0.0.1:8765/' } };
      } else if (action === 'snapshot') {
        if (clicked) redundantSnapshots += 1;
        result = { state: 'observed', effect: 'observe',
          tab: { tabId: 'tab-1', targetId: 'target-1', title: 'Dashboard', url: 'http://127.0.0.1:8765/' },
          observation: clicked ? afterObservation : { ...afterObservation,
            observationId: 'before-observation-0', page: { ...afterObservation.page, text: 'Counter 0' } } };
      } else if (action === 'tabs') result = { state: 'observed', tabs: [{
        tabId: 'tab-1', title: 'Dashboard', url: 'http://127.0.0.1:8765/',
      }] };
      else result = { state: 'not_executed', reason: 'unsupported_fixture_action' };
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify({
        toolCallId: call.id, requestedCall: { name: call.name, args: call.args },
        actualCall: { name: call.name, args: call.args }, outcome: 'succeeded', result,
      }) });
    }
  }
  return {
    id: variant.id, passed: clicked && /1/u.test(final), actions, redundantSnapshots,
    modelCalls: actions.length + 1, tokens, requestBytes,
    wallMs: Number((performance.now() - started).toFixed(3)), finalAnswerPresent: Boolean(final),
  };
}

try {
  const results = [];
  for (const variant of variants) results.push(await runVariant(variant));
  process.stdout.write(`${JSON.stringify({
    schema: 't5.s6-perf4a-browser-post-observation-qualification.v1',
    model: selected.modelId, provider: 'chatgpt_oauth', actualUserData: false,
    externalWrites: 0, actualBrowserActions: 0, productDefaultChanged: false, results,
  }, null, 2)}\n`);
} finally {
  await rm(room, { recursive: true, force: true });
}
