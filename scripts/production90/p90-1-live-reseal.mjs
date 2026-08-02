#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { projectWorkState } from '../../src/kernel/l1-intent/work-state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SERVER = join(REPO, 'src', 'surface', 'server.js');
const CONNECTION = join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');

const marker = (domain, cycle, slot, version) =>
  `${domain.toUpperCase()}-${cycle}-${slot}-${version}`;

export function buildLiveScenario(turnCount = 12, domain = 'document') {
  if (!Number.isSafeInteger(turnCount) || turnCount < 12) throw new RangeError('turnCount must be at least 12');
  const turns = [];
  const active = new Map();
  const retired = new Set();
  let openQuestions = 0;
  let lastQuestion = null;
  const push = (text, stateChange) => turns.push({
    text,
    stateChange,
    expected: {
      active: [...active.values()], retired: [...retired], openQuestions,
    },
  });

  for (let index = 0; index < turnCount - 1; index += 1) {
    const cycle = Math.floor(index / 8) + 1;
    const step = index % 8;
    const primaryKey = `${cycle}:primary`;
    const secondaryKey = `${cycle}:secondary`;
    if (step === 0) {
      const value = marker(domain, cycle, 'A', 1);
      active.set(primaryKey, value);
      push(cycle === 1
        ? `새 ${domain} 프로젝트를 시작한다. 프로젝트 이름은 ${value}로 확정하자.`
        : `같은 프로젝트의 다음 범위 이름은 ${value}로 확정하자.`, true);
    } else if (step === 1) {
      const value = marker(domain, cycle, 'B', 1);
      active.set(secondaryKey, value);
      push(`같은 프로젝트의 두 번째 합의는 ${value}로 확정해줘.`, true);
    } else if (step === 2) {
      push('바뀐 상태는 없어. 현재 진행만 한 문장으로 말해줘.', false);
    } else if (step === 3) {
      const before = active.get(primaryKey);
      const value = marker(domain, cycle, 'A', 2);
      if (before) retired.add(before);
      active.set(primaryKey, value);
      push(`이 회차의 프로젝트 이름을 ${value}로 바꿔줘.`, true);
    } else if (step === 4) {
      lastQuestion = marker(domain, cycle, 'Q', 1);
      openQuestions += 1;
      push(`${lastQuestion}는 아직 미정이야. "${lastQuestion}을 어떻게 결정할까요?"를 답이 필요한 질문으로 남기고 그대로 물어봐.`, true);
    } else if (step === 5) {
      const value = marker(domain, cycle, 'Q', 2);
      openQuestions = Math.max(0, openQuestions - 1);
      push(`"${lastQuestion}을 어떻게 결정할까요?" 질문은 해결됐어. 답은 ${value}야.`, true);
    } else if (step === 6) {
      const before = active.get(secondaryKey);
      if (before) retired.add(before);
      active.delete(secondaryKey);
      push(`두 번째 합의 ${before}는 철회해줘. 현재 합의로 취급하지 마.`, true);
    } else {
      push('현재 합의와 미정만 요약해줘. 바뀌기 전 값은 쓰지 마.', false);
    }
  }
  const continuation = [...active.values()][0];
  push(`${continuation} 프로젝트를 새 대화에서 이어서 현재 합의와 미정만 종합해줘.`, false);
  turns.at(-1).newConversation = true;
  turns[Math.floor(turnCount / 2)].restartBefore = true;
  return { id: `${domain}-${turnCount}`, domain, turnCount, turns };
}

export function buildContinuationProbe(domain = 'document') {
  const value = marker(domain, 1, 'A', 1);
  return {
    id: `${domain}-continuation-probe`, domain, turnCount: 2,
    turns: [{
      text: `새 ${domain} 프로젝트를 시작한다. 프로젝트 이름은 ${value}로 확정하자.`,
      stateChange: true,
      expected: { active: [value], retired: [], openQuestions: 0 },
    }, {
      text: `${value} 프로젝트를 새 대화에서 이어서 현재 합의만 종합해줘.`,
      stateChange: false,
      newConversation: true,
      expected: { active: [value], retired: [], openQuestions: 0 },
    }],
  };
}

export function scoreGateRecall(turns) {
  const changed = turns.filter((turn) => turn.stateChange);
  const captured = changed.filter((turn) => turn.stateAccurate);
  const omitted = changed.filter((turn) => !turn.reportedByMain);
  const opened = omitted.filter((turn) => turn.reviewOpened);
  return {
    changedTurns: changed.length,
    stateCaptureRecall: changed.length ? captured.length / changed.length : 1,
    omittedChangeTurns: omitted.length,
    fallbackGateRecall: omitted.length ? opened.length / omitted.length : 1,
  };
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

async function post(base, path, body = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} failed (${response.status})`);
  return text ? JSON.parse(text) : {};
}

async function readState(dataDir, sessionId) {
  const session = JSON.parse(await readFile(join(dataDir, `${sessionId}.json`), 'utf8'));
  let records = [];
  try {
    const stored = JSON.parse(await readFile(join(dataDir, 'work-events.json'), 'utf8'));
    records = stored.records ?? [];
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const scopePresent = Boolean(session.principalRef && session.workRef);
  return {
    state: scopePresent ? projectWorkState(records, {
      principalRef: session.principalRef, projectRef: session.workRef,
    }) : projectWorkState(),
    scopePresent,
    eventCount: records.length,
  };
}

function assessState(state, expected) {
  const activeText = (state.activeAgreements ?? []).map((item) => item.statement ?? '').join('\n');
  const missingActive = expected.active.filter((value) => !activeText.includes(value)).length;
  const revivedRetired = expected.retired.filter((value) => activeText.includes(value)).length;
  const openQuestionMismatch = (state.openQuestions?.length ?? 0) !== expected.openQuestions;
  return {
    accurate: missingActive === 0 && revivedRetired === 0 && !openQuestionMismatch,
    missingActive, revivedRetired, openQuestionMismatch,
  };
}

async function startServer(dataDir, homeDir) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: REPO,
    env: {
      ...process.env,
      HOME: homeDir,
      GPAO_T5_DATA_DIR: dataDir,
      GPAO_T5_BIND: '127.0.0.1',
      GPAO_T5_TICK_MS: '3600000',
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let base;
  try {
    base = await new Promise((resolveBase, reject) => {
    let output = '';
    let errors = '';
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('server start timeout')), 45_000);
    const failed = () => fail(new Error(errors.trim() || 'server exited before start'));
    child.once('exit', failed);
    child.stderr.on('data', (chunk) => { errors = `${errors}${chunk}`.slice(-8_000); });
    child.stdout.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-8_000);
      const found = /http:\/\/localhost:(\d+)/.exec(output);
      if (!found) return;
      clearTimeout(timer);
      child.off('exit', failed);
      resolveBase(`http://127.0.0.1:${found[1]}`);
    });
    });
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    throw error;
  }
  return {
    base,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolveExit) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolveExit(); }, 8_000);
        child.once('exit', () => { clearTimeout(timer); resolveExit(); });
      });
    },
  };
}

async function runScenario(runtime, scenario, maxTurns = scenario.turns.length) {
  let server = await startServer(runtime.dataDir, runtime.homeDir);
  let session = await post(server.base, '/sessions');
  let stateSessionId = session.id;
  const measured = [];
  try {
    for (let index = 0; index < Math.min(scenario.turns.length, maxTurns); index += 1) {
      const turn = scenario.turns[index];
      if (turn.restartBefore) {
        await server.stop();
        server = await startServer(runtime.dataDir, runtime.homeDir);
      }
      if (turn.newConversation) {
        session = await post(server.base, '/sessions');
        stateSessionId = session.id;
      }
      const startedAt = performance.now();
      const result = await post(server.base, '/turn', { sessionId: session.id, text: turn.text });
      const durationMs = performance.now() - startedAt;
      const snapshot = await readState(runtime.dataDir, stateSessionId);
      const diagnostic = result.workStateDiagnostic ?? {};
      const assessment = assessState(snapshot.state, turn.expected);
      measured.push({
        turn: index + 1,
        stateChange: turn.stateChange,
        stateAccurate: assessment.accurate,
        missingActive: assessment.missingActive,
        revivedRetired: assessment.revivedRetired,
        openQuestionMismatch: assessment.openQuestionMismatch,
        scopePresent: snapshot.scopePresent,
        eventCount: snapshot.eventCount,
        reportedByMain: diagnostic.reportedByMain === true,
        reviewNeeded: diagnostic.reviewNeeded === true,
        reviewOpened: diagnostic.reviewOpened === true,
        recorded: diagnostic.recorded === true,
        admissionReason: diagnostic.reason ?? null,
        candidateTypes: diagnostic.candidateTypes ?? [],
        hasOpenQuestion: diagnostic.hasOpenQuestion === true,
        hasContinueFrom: diagnostic.hasContinueFrom === true,
        settlementDurationMs: Math.round(Number(diagnostic.durationMs ?? 0)),
        durationMs: Math.round(durationMs),
      });
    }
  } finally {
    await server.stop();
  }
  const recall = scoreGateRecall(measured);
  const pass = recall.stateCaptureRecall === 1
    && recall.fallbackGateRecall === 1
    && measured.every((turn) => turn.stateAccurate);
  return { scenarioId: scenario.id, pass, recall, turns: measured };
}

async function prepareRuntime(connectionFile) {
  await access(connectionFile);
  const root = await mkdtemp(join(tmpdir(), 't5-p90-reseal-'));
  const dataDir = join(root, 'data');
  const homeDir = join(root, 'home');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(join(homeDir, 'Documents'), { recursive: true, mode: 0o700 });
  await symlink(connectionFile, join(dataDir, 'model-connection.json'));
  return { root, dataDir, homeDir };
}

async function main() {
  const countArg = process.argv.find((arg) => arg.startsWith('--turns='));
  const domainArg = process.argv.find((arg) => arg.startsWith('--domain='));
  const maxArg = process.argv.find((arg) => arg.startsWith('--max-turns='));
  const probeArg = process.argv.find((arg) => arg.startsWith('--probe='));
  const turnCount = Number(countArg?.split('=')[1] ?? 12);
  const domain = domainArg?.split('=')[1] ?? 'document';
  const maxTurns = Number(maxArg?.split('=')[1] ?? turnCount);
  const connection = process.env.GPAO_T5_MODEL_CONNECTION_FILE ?? CONNECTION;
  const runtime = await prepareRuntime(connection);
  try {
    const scenario = probeArg?.split('=')[1] === 'continuation'
      ? buildContinuationProbe(domain) : buildLiveScenario(turnCount, domain);
    const report = await runScenario(runtime, scenario, maxTurns);
    const publicReport = {
      schemaVersion: 1,
      status: report.pass ? 'PASS' : 'PRODUCT_FAIL',
      ...report,
      credentialMode: 'isolated_reference',
      evidenceDigest: digest(report),
    };
    process.stdout.write(`${JSON.stringify(publicReport, null, 2)}\n`);
    process.exitCode = report.pass ? 0 : 1;
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`P90-1 live reseal failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
