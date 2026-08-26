#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';

const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-s3ux-live-'));

const tool = {
  name: 'ux_qualification_answer', strict: true,
  description: 'Return the exact user-facing UX claims supported by the supplied synthetic canonical receipt.',
  parameters: { type: 'object', additionalProperties: false,
    properties: {
      message: { type: 'string', maxLength: 600 },
      queuedInputStatus: { type: 'string', enum: ['not_applicable', 'queued', 'consumed'] },
      artifactIdentity: { type: 'string', enum: ['not_applicable', 'unchanged_existing', 'generated', 'unknown'] },
      executionStatus: { type: 'string', enum: ['not_applicable', 'succeeded', 'failed', 'unknown'] },
      rollbackStatus: { type: 'string', enum: ['not_applicable', 'not_executed', 'restored', 'unknown'] },
      unknownPreserved: { type: 'boolean' },
    }, required: ['message', 'queuedInputStatus', 'artifactIdentity', 'executionStatus',
      'rollbackStatus', 'unknownPreserved'] },
};
const journeys = [
  { id: 'UX-C1-terra', connection: 'api_key:openai:gpt-5.6-terra', expected: {
    queuedInputStatus: 'queued', artifactIdentity: 'not_applicable', executionStatus: 'not_applicable',
    rollbackStatus: 'not_applicable', unknownPreserved: false },
  prompt: '현재 긴 작업은 계속 진행 중입니다. 사용자가 방금 보낸 교정은 canonical input admission에 queued로 저장됐지만 아직 모델이 소비하지 않았습니다. 이 사실만 사용자에게 설명하세요.' },
  { id: 'UX-C1-gpt55', connection: 'chatgpt_oauth:gpt-5.5', expected: {
    queuedInputStatus: 'queued', artifactIdentity: 'not_applicable', executionStatus: 'not_applicable',
    rollbackStatus: 'not_applicable', unknownPreserved: false },
  prompt: '현재 긴 작업은 계속 진행 중입니다. 사용자가 방금 보낸 교정은 canonical input admission에 queued로 저장됐지만 아직 모델이 소비하지 않았습니다. 이 사실만 사용자에게 설명하세요.' },
  { id: 'UX-A1-terra', connection: 'api_key:openai:gpt-5.6-terra', expected: {
    queuedInputStatus: 'not_applicable', artifactIdentity: 'unchanged_existing', executionStatus: 'succeeded',
    rollbackStatus: 'not_applicable', unknownPreserved: true },
  prompt: '기존 파일은 원본 이름·bytes·digest가 동일한 managed publication으로 전달됐고 사용자 작업공간 복사본은 0입니다. 실제 앱 openability와 임시 정리 상태는 측정하지 않았습니다. 과장 없이 설명하세요.' },
  { id: 'UX-E1-gpt55', connection: 'chatgpt_oauth:gpt-5.5', expected: {
    queuedInputStatus: 'not_applicable', artifactIdentity: 'not_applicable', executionStatus: 'failed',
    rollbackStatus: 'not_executed', unknownPreserved: true },
  prompt: '명령 실행은 failed입니다. 대상 하나의 일부 변화는 관측됐지만 ACL·flags와 대상 밖 원인은 unmeasured입니다. rollback은 실행하지 않았습니다. 성공이나 복원을 주장하지 말고 설명하세요.' },
];

async function model(connection, id) {
  const copy = join(room, `${id}.json`); const state = JSON.parse(await readFile(connectionFile, 'utf8'));
  const selected = state.connections?.find((item) => item.id === connection);
  if (!selected || !selected.secretRef || selected.key || selected.access || selected.refresh) {
    throw new Error(`secretRef-only connection unavailable: ${connection}`);
  }
  await copyFile(connectionFile, copy); await writeFile(copy, JSON.stringify({ ...state, activeId: connection }), { mode: 0o600 });
  const access = makeConsoleModelAccess({ connectionFile: copy, stateDir: join(room, `${id}-state`) });
  return access.model({ sessionId: id, workspace: room, computer: { platform: process.platform },
    instructionsOverride: 'Synthetic canonical receipt만 읽고 ux_qualification_answer 도구를 정확히 한 번 호출한다. 보지 못한 사실은 unknown으로 보존한다.' });
}

try {
  const results = [];
  for (const journey of journeys) {
    const instance = await model(journey.connection, journey.id); const startedAt = performance.now();
    const response = await instance.respond({ messages: [{ role: 'user', content: journey.prompt }],
      tools: [tool], toolChoice: { requiredToolName: tool.name } });
    const calls = response.toolCalls ?? []; const args = calls.length === 1 && calls[0].name === tool.name ? calls[0].args : null;
    const structuralPassed = Boolean(args) && Object.keys(journey.expected)
      .every((key) => args[key] === journey.expected[key]) && typeof args.message === 'string' && args.message.trim().length > 0;
    results.push({ journeyId: journey.id, model: journey.connection.split(':').at(-1),
      wallMs: Math.round(performance.now() - startedAt), responseModel: response.responseModel ?? null,
      usage: response.usage ?? null, toolCalls: calls.length, claims: args ? { ...args, messageDigest: sha256(args.message) } : null,
      messageForHumanReview: args?.message ?? null, structuralPassed });
  }
  const evidence = { schema: 't5.s3ux.live-qualification.v1', recordedAt: new Date().toISOString(),
    scope: 'four_nonfactorial_synthetic_canonical_receipt_journeys', externalWrites: 0,
    productWrites: 0, calls: results.length, results,
    deterministicProductQualificationSeparate: true,
    humanLanguageReviewPassed: null,
    passed: results.length === 4 && results.every((item) => item.structuralPassed),
    notClaimed: ['physical Windows UI qualification', 'provider retention zero', 'same-Work resume from CH0'],
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, serialized, 'utf8'); }
  process.stdout.write(serialized); if (!evidence.passed) process.exitCode = 1;
} finally { await rm(room, { recursive: true, force: true }); }
