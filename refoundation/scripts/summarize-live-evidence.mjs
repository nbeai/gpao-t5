#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const room = option('--room');
const output = option('--output');
if (!room || !output) {
  console.error('사용: node summarize-live-evidence.mjs --room <격리방> --output <json>');
  process.exit(2);
}

const data = join(resolve(room), 'data');
const promptDir = join(data, 'prompt-dump');
const responseDir = join(data, 'response-dump');

async function files(dir) {
  return (await readdir(dir)).filter((file) => file.endsWith('.json')).sort();
}

function events(raw) {
  const out = [];
  for (const line of String(raw).split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try { out.push(JSON.parse(payload)); } catch { /* malformed diagnostic line is ignored, not invented */ }
  }
  return out;
}

const promptRecords = await Promise.all((await files(promptDir)).map(async (file) => (
  JSON.parse(await readFile(join(promptDir, file), 'utf8'))
)));
const responseRecords = await Promise.all((await files(responseDir)).map(async (file) => (
  JSON.parse(await readFile(join(responseDir, file), 'utf8'))
)));
const allResponseEvents = responseRecords.flatMap((record) => events(record.body?.raw));
const completed = allResponseEvents.filter((event) => event.type === 'response.completed').map((event) => event.response);
const calls = allResponseEvents
  .filter((event) => event.type === 'response.output_item.done' && event.item?.type === 'function_call')
  .map((event) => event.item)
  .filter((item, index, list) => list.findIndex((other) => other.call_id === item.call_id) === index);
const outputs = promptRecords.flatMap((record) => record.body?.input ?? [])
  .filter((item) => item.type === 'function_call_output')
  .filter((item, index, list) => list.findIndex((other) => other.call_id === item.call_id) === index)
  .map((item) => {
    let receipt = {};
    try { receipt = JSON.parse(item.output); } catch { /* output stays unknown */ }
    return {
      callId: item.call_id,
      outcome: receipt.outcome ?? null,
      exitCode: receipt.result?.exitCode ?? null,
      explanationOk: receipt.result?.commandExplanation?.ok ?? null,
      steps: (receipt.result?.commandExplanation?.steps ?? []).map((step) => step.executable),
      operators: (receipt.result?.commandExplanation?.operators ?? []).map((operator) => operator.kind),
    };
  });
const finalDeltas = events(responseRecords.at(-1)?.body?.raw)
  .filter((event) => event.type === 'response.output_text.delta')
  .map((event) => event.delta ?? '').join('');
const rawEvidence = JSON.stringify({ promptRecords, responseRecords });
const credentialLikeMatches = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /"authorization"\s*:/gi,
  /"(?:access|refresh)_token"\s*:/gi,
].flatMap((pattern) => rawEvidence.match(pattern) ?? []);
const fixtureValues = await Promise.all(['첫째.txt', '둘째.txt'].map(async (file) => (
  Number((await readFile(join(resolve(room), 'workspace', file), 'utf8')).trim())
)));
const responseModels = completed.map((response) => response?.model).filter(Boolean);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const runtimeFiles = [
  'refoundation/src/agent-loop.js',
  'refoundation/src/exec-tool.js',
  'refoundation/src/command-explainer.js',
  'refoundation/package-lock.json',
  'refoundation/src/chatgpt-oauth-credential.js',
  'refoundation/src/chatgpt-responses-model.js',
  'refoundation/scripts/run-live.mjs',
];
const runtimeHash = createHash('sha256');
for (const file of runtimeFiles) {
  runtimeHash.update(file);
  runtimeHash.update('\0');
  runtimeHash.update(await readFile(resolve(file)));
  runtimeHash.update('\0');
}
const sourceChanges = execFileSync('git', [
  'status', '--porcelain', '--', 'refoundation', 'package.json', 'T5-REFOUNDATION.md',
], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
let runtimeFilesDirty = false;
try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...runtimeFiles]); }
catch { runtimeFilesDirty = true; }
const summary = {
  schema: 't5.refoundation.live-evidence.v1',
  observedAt: new Date().toISOString(),
  sourceCommit,
  runtimeDigest: runtimeHash.digest('hex'),
  runtimeFilesDirty,
  sourceWorktreeDirty: sourceChanges.length > 0,
  sourceChanges,
  isolatedRoom: basename(resolve(room)),
  auth: promptRecords[0]?.meta?.provider ?? null,
  requestModel: promptRecords[0]?.body?.model ?? null,
  responseModels,
  modelTurns: responseRecords.length,
  toolCalls: calls.map((call) => ({
    callId: call.call_id,
    name: call.name,
    arguments: JSON.parse(call.arguments ?? '{}'),
    ...outputs.find((outputItem) => outputItem.callId === call.call_id),
  })),
  finalAnswer: finalDeltas,
  fixture: { values: fixtureValues, expectedSum: 42 },
  credentialLikeMatches,
};
summary.passed = summary.auth === 'chatgpt_oauth'
  && responseModels.length === responseRecords.length
  && summary.toolCalls.length > 0
  && summary.toolCalls.every((call) => call.outcome === 'succeeded' && call.exitCode === 0)
  && /(^|\D)42(\D|$)/.test(summary.finalAnswer)
  && fixtureValues.reduce((sum, value) => sum + value, 0) === 42
  && credentialLikeMatches.length === 0;

await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: resolve(output), passed: summary.passed }, null, 2));
if (!summary.passed) process.exit(1);
