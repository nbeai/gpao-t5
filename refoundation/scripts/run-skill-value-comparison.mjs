#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { scoreFileDiscoveryAnswer } from '../src/skill-value-comparison.js';

const here = dirname(fileURLToPath(import.meta.url));
const refoundationRoot = resolve(here, '..');
const bundledSkillsRoot = join(refoundationRoot, 'skills');
const keep = process.argv.includes('--keep');
const roundsIndex = process.argv.indexOf('--rounds');
const rounds = Number(roundsIndex >= 0 ? process.argv[roundsIndex + 1] : 1);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
  throw new TypeError('--rounds must be an integer from 1 to 10');
}
const room = await mkdtemp(join(tmpdir(), 't5-skill-value-'));
const isolatedHome = join(room, 'home');
const workspace = join(room, 'workspace');
const emptySkillsRoot = join(room, 'empty-skills');
const testSkillsRoot = join(room, 'skills-under-test');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));

const cases = [
  {
    id: 'exact-extension-latest-created',
    request: '현재 작업 공간에서 가장 최근에 생성된 비아이5.txt 파일을 찾아줘.',
    expectedPath: join(workspace, 'recent', '비아이5.txt'),
  },
  {
    id: 'title-with-unknown-extension',
    request: '여기서 제목이 비아이5인 문서를 찾아줘. 확장자는 기억 안 나는데 가장 최근에 생성된 하나면 돼.',
    expectedPath: join(workspace, 'recent', '비아이5.txt'),
  },
  {
    id: 'missing-stops-without-repeat',
    request: '현재 작업 공간에서 존재하지않는보고서.zzz를 찾아줘. 없으면 같은 검색을 반복하지 말고 어디까지 확인했는지만 알려줘.',
    expectedPath: null,
  },
];

async function makeFixture() {
  await Promise.all([
    isolatedHome, join(workspace, 'old'), join(workspace, 'recent'), join(workspace, 'other'), emptySkillsRoot,
    join(testSkillsRoot, 'file-discovery'),
  ].map((path) => mkdir(path, { recursive: true })));
  await copyFile(
    join(bundledSkillsRoot, 'file-discovery', 'SKILL.md'),
    join(testSkillsRoot, 'file-discovery', 'SKILL.md'),
  );
  await Promise.all([
    writeFile(join(workspace, 'old', '비아이5.txt'), 'old text candidate\n'),
    writeFile(join(workspace, 'other', '비아이5.pdf'), 'different extension candidate\n'),
    writeFile(join(workspace, 'other', '비아이50.txt'), 'partial title distractor\n'),
  ]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  await writeFile(join(workspace, 'recent', '비아이5.txt'), 'newest text candidate\n');
}

async function startArm(name, skillsRoot) {
  const stateDir = join(room, `state-${name}`);
  await mkdir(stateDir, { recursive: true });
  const access = makeConsoleModelAccess({ connectionFile, stateDir });
  const computerEnvironment = discoverComputerEnvironment({ userHome: workspace });
  const errors = [];
  const server = makeConsoleServer({
    stateDir, workspace, skillsRoot,
    modelFactory: (context) => access.model(context),
    modelStatus: () => access.status(),
    computerEnvironment,
    onError: (error) => errors.push(error?.message ?? String(error)),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return {
    name,
    server,
    errors,
    base: `http://127.0.0.1:${server.address().port}`,
  };
}

async function closeArm(arm) {
  arm.server.closeWakeStreams();
  await arm.server.managedProcesses.stopAll('skill_comparison_shutdown');
  await new Promise((resolveClose) => arm.server.close(resolveClose));
}

async function runCase(arm, spec) {
  const session = await fetch(`${arm.base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const surface = await fetch(`${arm.base}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: spec.request }),
  }).then(async (response) => {
    const value = await response.json();
    if (!response.ok) throw new Error(`${arm.name}/${spec.id}: ${JSON.stringify(value)}`);
    return value;
  });
  const [run, speed] = await Promise.all([
    fetch(`${arm.base}/runs/${surface.runId}`).then((response) => response.json()),
    fetch(`${arm.base}/runs/${surface.runId}/speed`).then((response) => response.json()),
  ]);
  const receipts = run.events.filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt);
  const skillViews = receipts.filter((receipt) => (
    receipt.actualCall?.name === 'skill' && receipt.result?.state === 'viewed'
  )).length;
  const execReceipts = receipts.filter((receipt) => receipt.actualCall?.name === 'exec');
  const answer = String(surface.reply ?? '');
  const score = scoreFileDiscoveryAnswer({
    answer, expectedPath: spec.expectedPath, workspace, execCalls: execReceipts.length,
  });
  return {
    arm: arm.name,
    caseId: spec.id,
    runId: run.runId,
    status: run.status,
    passed: score.passed,
    absolutePathReported: score.absolutePathReported,
    answer,
    skillViews,
    execCalls: execReceipts.length,
    failedToolCalls: receipts.filter((receipt) => receipt.outcome !== 'succeeded').length,
    commands: execReceipts.map((receipt) => receipt.actualCall.args.command),
    wallMs: speed.wallMs,
    modelCalls: speed.model.calls,
    inputTokens: speed.model.inputTokens,
    outputTokens: speed.model.outputTokens,
    totalTokens: speed.model.totalTokens,
  };
}

function aggregate(results, arm) {
  const rows = results.filter((result) => result.arm === arm);
  const sum = (field) => rows.reduce((total, row) => total + (row[field] ?? 0), 0);
  return {
    cases: rows.length,
    passed: rows.filter((row) => row.passed && row.status === 'completed').length,
    wallMs: sum('wallMs'),
    modelCalls: sum('modelCalls'),
    totalTokens: sum('totalTokens'),
    skillViews: sum('skillViews'),
    execCalls: sum('execCalls'),
    failedToolCalls: sum('failedToolCalls'),
    absolutePathsReported: rows.filter((row) => row.absolutePathReported === true).length,
  };
}

await makeFixture();
const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = isolatedHome;
const arms = {
  withoutSkill: await startArm('without-skill', emptySkillsRoot),
  withSkill: await startArm('with-skill', testSkillsRoot),
};
const results = [];
try {
  const schedule = [];
  for (let round = 0; round < rounds; round += 1) {
    const first = round % 2 === 0 ? arms.withoutSkill : arms.withSkill;
    const second = first === arms.withoutSkill ? arms.withSkill : arms.withoutSkill;
    schedule.push(
      [first, cases[0], round + 1], [second, cases[0], round + 1],
      [second, cases[1], round + 1], [first, cases[1], round + 1],
      [first, cases[2], round + 1], [second, cases[2], round + 1],
    );
  }
  for (const [arm, spec, round] of schedule) {
    results.push({ ...(await runCase(arm, spec)), round });
  }
  const withoutSkill = aggregate(results, 'without-skill');
  const withSkill = aggregate(results, 'with-skill');
  const output = {
    schema: 't5.skill-value-comparison.v1',
    recordedAt: new Date().toISOString(),
    fixture: { workspace, actualUserData: false },
    model: (await makeConsoleModelAccess({
      connectionFile, stateDir: join(room, 'status'),
    }).status()).modelId,
    rounds,
    schedule: schedule.map(([arm, spec, round]) => `${round}:${arm.name}:${spec.id}`),
    results,
    aggregate: {
      withoutSkill,
      withSkill,
      deltaWithMinusWithout: {
        passed: withSkill.passed - withoutSkill.passed,
        wallMs: withSkill.wallMs - withoutSkill.wallMs,
        modelCalls: withSkill.modelCalls - withoutSkill.modelCalls,
        totalTokens: withSkill.totalTokens - withoutSkill.totalTokens,
        execCalls: withSkill.execCalls - withoutSkill.execCalls,
      },
    },
    runtimeErrors: {
      withoutSkill: arms.withoutSkill.errors,
      withSkill: arms.withSkill.errors,
    },
    room: keep ? room : null,
  };
  console.log(JSON.stringify(output, null, 2));
  const expectedCases = cases.length * rounds;
  if (withoutSkill.passed !== expectedCases || withSkill.passed !== expectedCases) process.exitCode = 1;
} finally {
  await Promise.all(Object.values(arms).map(closeArm));
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
