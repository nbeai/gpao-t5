import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { consoleInstructions } from '../src/console-model-factory.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const load = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('CJ0은 4차 증거 재사용과 current source known facts만으로 최초 Context 결함을 연다', async () => {
  const evidence = JSON.parse(await load('../evidence/fifth-cj0-context-reality-2026-08-30.json'));
  assert.equal(evidence.status, 'CJ0_COMPLETE_CJ1_OPEN');
  assert.equal(evidence.productChanges, 0); assert.equal(evidence.newLiveRuns, 0);
  assert.deepEqual(evidence.evidenceOrder, [
    'reuse_fourth_exact_runs', 'recalculate_current_context_metrics',
    'confirm_source_known_facts', 'open_one_context_defect_family',
  ]);
  assert.deepEqual(evidence.reusedRuns.map((item) => item.category), [
    'direct', 'new_project', 'existing_project',
  ]);
  const direct = evidence.reusedRuns[0];
  assert.equal(direct.userOutcome, 'passed'); assert.equal(direct.modelCalls, 1); assert.equal(direct.toolCalls, 0);
  assert.equal(direct.instructionBytes, 30693); assert.equal(direct.toolDefinitionBytes, 20781);
  assert.equal(evidence.firstOpenedDefect.family, 'direct_turn_global_instruction_and_tool_surface');
  assert.equal(evidence.firstOpenedDefect.candidateAdopted, false);
});

test('CJ0 instruction inventory와 cache·authority known facts는 current source와 일치한다', async () => {
  const evidence = JSON.parse(await load('../evidence/fifth-cj0-context-reality-2026-08-30.json'));
  const instructions = consoleInstructions('/T5/WORKSPACE', {
    platform: 'darwin', architecture: 'arm64', userHome: '/T5/HOME',
    commandFamily: 'posix', commandProgram: '/bin/zsh',
  });
  assert.equal(Buffer.byteLength(instructions), evidence.instructionInventory.bytes);
  assert.equal(instructions.split('\n').length, evidence.instructionInventory.lines);
  assert.equal(instructions.trim().split(/\s+/u).length, evidence.instructionInventory.words);
  assert.equal(digest(instructions), evidence.instructionInventory.sha256);
  const files = {
    consoleModelFactory: await load('../src/console-model-factory.js'),
    consoleServer: await load('../src/console-server.js'), agentLoop: await load('../src/agent-loop.js'),
    openAI: await load('../src/openai-responses-model.js'),
    chatgptOAuth: await load('../src/chatgpt-responses-model.js'),
    anthropic: await load('../src/anthropic-messages-model.js'),
    gemini: await load('../src/gemini-generate-content-model.js'),
    upstage: await load('../src/upstage-chat-completions-model.js'),
  };
  for (const [name, source] of Object.entries(files)) assert.equal(digest(source), evidence.sourceDigests[name], name);
  assert.match(files.consoleModelFactory, /call tool_search once[\s\S]*T5_DOCUMENT_CLI/u);
  assert.match(files.consoleServer, /workStore\.create[\s\S]*workingMemoryProjection/u);
  assert.match(files.consoleServer, /const agentRequest = `\$\{modelRequest\}\\n\\n\$\{runtimeContexts\}`/u);
  for (const name of ['openAI', 'chatgptOAuth', 'anthropic', 'gemini', 'upstage']) {
    assert.match(files[name], /runtimeContext \? `\$\{instructions\}\\n\\n\$\{runtimeContext\}` : instructions/u, name);
  }
  assert.doesNotMatch(files.anthropic, /cache_control/u);
  assert.doesNotMatch(files.openAI, /prompt_cache_key|compact(?:ion)?/u);
  assert.doesNotMatch(files.chatgptOAuth, /prompt_cache_key|compact(?:ion)?/u);
  assert.equal(evidence.knownFacts.authorityClassification.currentTimeAfterUserContent,
    'user_authority_and_focus');
});
