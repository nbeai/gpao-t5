import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { RunLedger } from '../src/run-ledger.js';
import { TerminalOutputStore } from '../src/terminal-output-store.js';
import { WorkStore } from '../src/work-store.js';

async function seedInterruptedManagedWork(root, { request, action = 'start', qualified = true } = {}) {
  const stateDir = join(root, 'state');
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create();
  const works = new WorkStore(join(stateDir, 'work'));
  const runs = new RunLedger(join(stateDir, 'runs'));
  const outputs = new TerminalOutputStore(join(stateDir, 'terminal-outputs'));
  const work = await works.create({ sessionId: session.id, sourceMessageId: `${session.id}:user:1` });
  const run = await runs.start({ sessionId: session.id, request });
  await works.claimExecution({ workId: work.workId, revision: work.revision, runId: run.runId });
  const output = await outputs.begin({ sessionId: session.id, runId: run.runId });
  await outputs.append({ handle: output.handle, sessionId: session.id,
    stream: 'stdout', text: `PARTIAL:${request}\n` });
  await run.append({
    type: 'tool_completed',
    stepId: 'tool-managed-start',
    payload: {
      turn: 1,
      receipt: {
        toolCallId: 'managed-start',
        requestedCall: { name: 'terminal_session', args: {
          action, command: 'fixture-long-work', cwd: null, effect: { kind: 'observe' },
        } },
        result: {
          processId: 'fixture-process', state: 'running',
          ...(qualified ? { processBoundary: {
            kind: 'macos_parent_death_process_group', qualified: true,
          } } : {}),
          outputRecall: { handle: output.handle, state: 'live',
            cursor: { stdout: String(`PARTIAL:${request}\n`).length, stderr: 0 } },
        },
      },
    },
  });
  return { stateDir, session, work, run, output, request };
}

async function closeServer(server) {
  await server.closeWorkspaceConnections();
  await server.closeMessengers();
}

test('successor는 세 목적의 contained managed Work를 exact once 중단 정산하고 partial output을 다시 연다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-s4-d4b-successor-'));
  try {
    const fixtures = [];
    for (const request of [
      '월간 정산 보고서를 만들어줘',
      '프로젝트 실패 원인을 오래 분석해줘',
      '개인 사진 파일을 분류해줘',
    ]) fixtures.push(await seedInterruptedManagedWork(root, { request }));

    let modelCalls = 0;
    const makeServer = () => makeConsoleServer({
      stateDir: fixtures[0].stateDir, workspace: root,
      modelFactory: () => ({ async respond() {
        modelCalls += 1; throw new Error('successor settlement must not call the model');
      } }),
    });

    const first = makeServer();
    await first.recoverFailedWorkClaimsReady;
    await first.recoverResultPublications();
    const state = await first.workStore.read();
    assert.equal(modelCalls, 0);
    assert.equal(first.managedProcesses.list().length, 0);
    assert.equal(state.cancellations.length, 3);
    for (const fixture of fixtures) {
      const claim = state.claims.find((item) => item.runId === fixture.run.runId);
      const cancellation = state.cancellations.find((item) => item.runId === fixture.run.runId);
      const currentWork = state.works.find((item) => item.workId === fixture.work.workId);
      const result = state.results.find((item) => item.runId === fixture.run.runId);
      assert.equal(claim?.state, 'released');
      assert.equal(cancellation?.state, 'terminal');
      assert.equal(cancellation?.disposition, 'interrupted_resumable');
      assert.equal(cancellation?.unknownEffect, true);
      assert.equal(cancellation?.childrenTerminal, true);
      assert.equal(cancellation?.surfacePersisted, true);
      assert.equal(currentWork?.revision, 2);
      assert.equal(currentWork?.status, 'active');
      assert.equal(result?.state, 'delivery_terminal');
      const reopened = await new TerminalOutputStore(join(fixture.stateDir, 'terminal-outputs')).read({
        handle: fixture.output.handle, sessionId: fixture.session.id,
        stream: 'stdout', offset: 0, limit: 16_000,
      });
      assert.equal(reopened.text, `PARTIAL:${fixture.request}\n`);
      const manifest = JSON.parse(await readFile(join(fixture.stateDir, 'terminal-outputs',
        'objects', fixture.output.handle, 'manifest.json'), 'utf8'));
      assert.equal(manifest.state, 'interrupted');
      assert.match(manifest.streams.stdout.sha256, /^[a-f0-9]{64}$/u);
    }
    const eventCount = state.events.length;
    await closeServer(first);

    const second = makeServer();
    await second.recoverFailedWorkClaimsReady;
    await second.recoverResultPublications();
    const restarted = await second.workStore.read();
    assert.equal(modelCalls, 0);
    assert.equal(restarted.events.length, eventCount);
    assert.equal(restarted.cancellations.length, 3);
    await closeServer(second);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  }
});

test('successor는 parent-death containment가 증명되지 않은 PTY를 terminal로 꾸미지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-s4-d4b-unqualified-'));
  try {
    const fixture = await seedInterruptedManagedWork(root, {
      request: '대화형 개발 서버를 계속 지켜봐줘', action: 'start_tty', qualified: false,
    });
    const server = makeConsoleServer({ stateDir: fixture.stateDir, workspace: root,
      modelFactory: () => ({ async respond() { throw new Error('unused'); } }) });
    await server.recoverFailedWorkClaimsReady;
    const state = await server.workStore.read();
    assert.equal(state.cancellations.length, 0);
    assert.equal(state.claims.find((item) => item.runId === fixture.run.runId)?.state, 'active');
    const manifest = JSON.parse(await readFile(join(fixture.stateDir, 'terminal-outputs',
      'objects', fixture.output.handle, 'manifest.json'), 'utf8'));
    assert.equal(manifest.state, 'live');
    await closeServer(server);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  }
});
