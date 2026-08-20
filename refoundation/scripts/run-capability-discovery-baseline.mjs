#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

const prompts = [
  '아사나에 있는 오늘 마감 작업을 찾아줘. 아직 연결되어 있지 않다면 T5가 지금 실제로 연결할 수 있는 가장 간단한 방법을 확인해서 준비를 시작하고, 끝나면 이어서 알려줘.',
  '우리 팀은 Asana로 할 일을 관리해. T5가 내 계정과 이어서 오늘 해야 할 일들을 읽을 수 있게 해줘.',
  '이 Asana 주소의 프로젝트 업무를 같이 보고 싶어: https://app.asana.com/0/example/list 연결이 필요하면 가능한 공식 경로를 찾아서 진행해줘.',
];
const expectCandidate = process.argv.includes('--expect-candidate');

const room = await mkdtemp(join(tmpdir(), 't5-r9-capability-discovery-baseline-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
await mkdir(workspace, { recursive: true });
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const access = makeConsoleModelAccess({ connectionFile, stateDir: join(room, 'model-state') });
const modelStatus = await access.status();
if (!modelStatus.connected) throw new Error('actual model connection is required');
const errors = [];
const server = makeConsoleServer({
  stateDir, workspace,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  onError: (error) => errors.push(error?.message ?? String(error)),
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
});
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, input = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
};

try {
  const cases = [];
  for (const prompt of prompts) {
    const session = await post('/sessions');
    const result = await post('/turn', { sessionId: session.id, text: prompt });
    const runs = await server.runLedger.list({ sessionId: session.id });
    const details = await Promise.all(runs.map((run) => server.runLedger.read(run.runId)));
    const receipts = details.flatMap((run) => run.events).flatMap((event) => (
      event.type === 'tool_completed' ? [event.payload.receipt] : []
    ));
    cases.push({
      prompt,
      reply: result.reply,
      handoff: result.connectionHandoff ?? null,
      tools: receipts.map((receipt) => ({
        name: receipt.requestedCall?.name,
        action: receipt.requestedCall?.args?.action ?? null,
        outcome: receipt.outcome,
        resultState: receipt.result?.state ?? null,
      })),
      actualAsanaCapabilityUsed: receipts.some((receipt) => (
        receipt.actualCall?.name === 'asana' || receipt.actualCall?.name?.startsWith('mcp__asana')
      )),
      candidateSearches: receipts.filter((receipt) => (
        receipt.actualCall?.name === 'capability_catalog'
        && receipt.actualCall?.args?.action === 'search'
      )).length,
      officialAsanaCandidateFound: receipts.some((receipt) => (
        receipt.actualCall?.name === 'capability_catalog'
        && receipt.actualCall?.args?.action === 'search'
        && receipt.result?.candidates?.some((candidate) => candidate.id === 'asana'
          && candidate.sourceUrl?.startsWith('https://developers.asana.com/'))
      )),
    });
  }
  const evidence = {
    schema: expectCandidate
      ? 't5.r9-capability-discovery-live.v1' : 't5.r9-capability-discovery-baseline.v1',
    model: { provider: modelStatus.provider, modelId: modelStatus.modelId },
    cases,
    checks: {
      naturalExpressions: cases.length === 3,
      noFalseAsanaExecution: cases.every((entry) => !entry.actualAsanaCapabilityUsed),
      noRealAccountHandoff: cases.every((entry) => entry.handoff == null),
      noRuntimeErrors: errors.length === 0,
      ...(expectCandidate ? {
        officialCandidateFoundInEveryCase: cases.every((entry) => (
          entry.candidateSearches === 1 && entry.officialAsanaCandidateFound
        )),
        productBlockerPreserved: cases.every((entry) => /제품.*등록|제품.*준비/u.test(entry.reply)),
      } : {}),
    },
  };
  evidence[expectCandidate ? 'passed' : 'passedAsBaseline'] = Object.values(evidence.checks).every(Boolean);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence[expectCandidate ? 'passed' : 'passedAsBaseline']) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(room, { recursive: true, force: true });
}
