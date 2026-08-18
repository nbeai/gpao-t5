#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

const roundsIndex = process.argv.indexOf('--rounds');
const rounds = Number(roundsIndex >= 0 ? process.argv[roundsIndex + 1] : 2);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
  throw new TypeError('--rounds must be an integer from 1 to 10');
}
const keep = process.argv.includes('--keep');
const room = await mkdtemp(join(tmpdir(), 't5-skill-catalog-'));
const workspace = join(room, 'workspace');
const isolatedHome = join(room, 'home');
const skillsRoot = join(room, 'skills');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const TARGET_SKILL = 'cobalt-quasar-recovery';
const RECOVERY_CODE = 'QUASAR-RESET-7391';

const cases = [
  {
    id: 'specialized-procedure',
    request: '내 Quasar Widget이 cobalt-lock 상태야. 터미널은 사용하지 말고 검증된 절차에서 정확한 복구 코드만 알려줘. 추측하면 안 돼.',
    expected: RECOVERY_CODE,
    needsSkill: true,
  },
  {
    id: 'ordinary-no-skill',
    request: '17 곱하기 19의 답만 알려줘.',
    expected: '323',
    needsSkill: false,
  },
];

async function writeSkill(name, description, body) {
  const directory = join(skillsRoot, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), [
    '---', `name: ${name}`, `description: ${description}`, '---', '', body,
  ].join('\n'));
}

async function makeSkills() {
  await writeSkill(
    TARGET_SKILL,
    'Recover a Quasar Widget from the specialized cobalt-lock failure state when the user needs the exact validated recovery code.',
    `# Quasar recovery\n\nFor cobalt-lock, the exact validated recovery code is ${RECOVERY_CODE}.`,
  );
  const domains = [
    'calendar planning', 'email triage', 'diagram rendering', 'database migration',
    'photo conversion', 'audio cleanup', 'spreadsheet review', 'repository release',
    'meeting followup', 'browser automation', 'invoice checking', 'document formatting',
    'backup inspection', 'network diagnosis', 'package publishing', 'video compression',
  ];
  for (const [index, domain] of domains.entries()) {
    const number = String(index + 1).padStart(2, '0');
    await writeSkill(
      `distractor-${number}`,
      `A focused procedure for ${domain}. Use only when the user explicitly requests this domain and needs its detailed operational workflow, prerequisite checks, pitfalls, and result verification sequence.`,
      `# Distractor ${number}\n\nProcedure for ${domain}.`,
    );
  }
}

async function startArm(name, skillCatalogMode) {
  const stateDir = join(room, `state-${name}`);
  await mkdir(stateDir, { recursive: true });
  const access = makeConsoleModelAccess({ connectionFile, stateDir });
  const server = makeConsoleServer({
    stateDir, workspace, skillsRoot, skillCatalogMode,
    modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    computerEnvironment: discoverComputerEnvironment({ userHome: workspace }),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return { name, server, base: `http://127.0.0.1:${server.address().port}` };
}

async function closeArm(arm) {
  arm.server.closeWakeStreams();
  await arm.server.managedProcesses.stopAll('skill_catalog_comparison_shutdown');
  await new Promise((resolveClose) => arm.server.close(resolveClose));
}

async function runCase(arm, spec, round) {
  const session = await fetch(`${arm.base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const surface = await fetch(`${arm.base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: spec.request }),
  }).then(async (response) => {
    const value = await response.json();
    if (!response.ok) throw new Error(`${arm.name}/${spec.id}: ${JSON.stringify(value)}`);
    return value;
  });
  const [run, context, speed] = await Promise.all([
    fetch(`${arm.base}/runs/${surface.runId}`).then((response) => response.json()),
    fetch(`${arm.base}/runs/${surface.runId}/context`).then((response) => response.json()),
    fetch(`${arm.base}/runs/${surface.runId}/speed`).then((response) => response.json()),
  ]);
  const receipts = run.events.filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt);
  const skillReceipts = receipts.filter((receipt) => receipt.actualCall?.name === 'skill');
  const actions = skillReceipts.map((receipt) => receipt.actualCall.args.action);
  const terminalCalls = receipts.filter((receipt) => receipt.actualCall?.name !== 'skill').length;
  const viewedTarget = skillReceipts.some((receipt) => (
    receipt.actualCall.args.action === 'view' && receipt.actualCall.args.name === TARGET_SKILL
  ));
  const firstContext = context.calls[0]?.context;
  return {
    arm: arm.name, round, caseId: spec.id, runId: run.runId,
    passed: surface.reply.includes(spec.expected)
      && terminalCalls === 0 && (spec.needsSkill ? viewedTarget : skillReceipts.length === 0),
    answer: surface.reply,
    modelCalls: speed.model.calls,
    wallMs: speed.wallMs,
    providerInputTokens: context.aggregate.providerInputTokens,
    requestBytes: context.aggregate.requestBytes,
    firstRequestBytes: firstContext?.requestBytes ?? null,
    firstSkillSchemaBytes: firstContext?.tools.byName.skill?.bytes ?? null,
    skillActions: actions,
    terminalCalls,
  };
}

function aggregate(results, arm, caseId) {
  const rows = results.filter((row) => row.arm === arm && row.caseId === caseId);
  const sum = (key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  return {
    cases: rows.length, passed: rows.filter((row) => row.passed).length,
    modelCalls: sum('modelCalls'), wallMs: sum('wallMs'),
    providerInputTokens: sum('providerInputTokens'), requestBytes: sum('requestBytes'),
    skillCalls: rows.reduce((total, row) => total + row.skillActions.length, 0),
    terminalCalls: sum('terminalCalls'),
  };
}

await Promise.all([workspace, isolatedHome, skillsRoot].map((path) => mkdir(path, { recursive: true })));
await makeSkills();
const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = isolatedHome;
const arms = {
  inline: await startArm('inline', 'inline'),
  onDemand: await startArm('on-demand', 'on-demand'),
};
const results = [];
try {
  for (let round = 1; round <= rounds; round += 1) {
    for (const [caseIndex, spec] of cases.entries()) {
      const inlineFirst = (round + caseIndex) % 2 === 1;
      const order = inlineFirst ? [arms.inline, arms.onDemand] : [arms.onDemand, arms.inline];
      for (const arm of order) results.push(await runCase(arm, spec, round));
    }
  }
  const aggregateByCase = {};
  for (const spec of cases) {
    aggregateByCase[spec.id] = {
      inline: aggregate(results, 'inline', spec.id),
      onDemand: aggregate(results, 'on-demand', spec.id),
    };
  }
  const output = {
    schema: 't5.skill-catalog-comparison.v1', recordedAt: new Date().toISOString(),
    model: (await makeConsoleModelAccess({ connectionFile, stateDir: join(room, 'status') }).status()).modelId,
    rounds, skills: 17, actualUserData: false, results, aggregateByCase,
    room: keep ? room : null,
  };
  console.log(JSON.stringify(output, null, 2));
  const expected = rounds;
  if (Object.values(aggregateByCase).some((armsForCase) => (
    armsForCase.inline.passed !== expected || armsForCase.onDemand.passed !== expected
  ))) process.exitCode = 1;
} finally {
  await Promise.all(Object.values(arms).map(closeArm));
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
