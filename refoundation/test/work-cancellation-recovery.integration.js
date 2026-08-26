import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { RunLedger } from '../src/run-ledger.js';
import { WorkCancellationCoordinator } from '../src/work-cancellation-coordinator.js';
import { WorkStore } from '../src/work-store.js';

function publicSurface(receipt) {
  const cancellation = { terminal: receipt.state === 'terminal',
    resumable: receipt.disposition === 'interrupted_resumable' && receipt.childrenTerminal === true,
    runTerminal: receipt.runTerminal, childrenTerminal: receipt.childrenTerminal,
    claimReleased: receipt.claimReleased, unknownEffect: receipt.unknownEffect,
    userSafeSummary: receipt.userSafeSummary, nextSafeAction: receipt.nextSafeAction };
  return { kind: receipt.state === 'recovery_pending' ? 'cancel_recovery_pending' : 'cancelled',
    reply: receipt.userSafeSummary,
    ...(receipt.nextSafeAction ? { nextSafeAction: receipt.nextSafeAction } : {}), cancellation };
}

async function seed(root, { pendingWithSurface }) {
  const stateDir = join(root, 'state'); const workspace = join(root, 'workspace'); await mkdir(workspace);
  const sessions = new ConsoleSessionStore(stateDir); const session = await sessions.create();
  const workStore = new WorkStore(join(stateDir, 'work'));
  const runLedger = new RunLedger(join(stateDir, 'runs'));
  const run = await runLedger.start({ sessionId: session.id, request: '취소 복구 시험' });
  const work = await workStore.create({ sessionId: session.id, sourceMessageId: 'message-safe' });
  await workStore.claimExecution({ workId: work.workId, revision: 1, runId: run.runId });
  const coordinator = new WorkCancellationCoordinator({ workStore, runLedger,
    processRegistry: { async stopOwner() { return []; } } });
  const admission = await coordinator.admit({ sessionId: session.id, runId: run.runId });
  await run.finish('cancelled');
  if (pendingWithSurface) {
    const child = await coordinator.requestStop({ admission, controller: new AbortController() });
    const receipt = await coordinator.settle({ admission, childSettlementReceipt: child });
    const surface = publicSurface(receipt);
    const resultDigest = createHash('sha256').update(JSON.stringify(surface)).digest('hex');
    await workStore.recordResultReady({ runId: run.runId, sessionId: session.id,
      workId: work.workId, revision: 1, objectiveOutcome: 'cancelled', resultDigest,
      surfaceResult: surface });
    await sessions.append(session.id, { role: 'assistant', runId: run.runId, result: surface });
  }
  return { stateDir, workspace, session, run };
}

test('restart cancellation recovery는 missing result를 만들고 existing exact surface를 중복하지 않는다', async () => {
  for (const pendingWithSurface of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), `t5-cancel-restart-${pendingWithSurface}-`));
    try {
      const seeded = await seed(root, { pendingWithSurface });
      const server = makeConsoleServer({ stateDir: seeded.stateDir, workspace: seeded.workspace,
        modelFactory: () => ({ async respond() { throw new Error('cancel recovery must not call model'); } }) });
      await server.recoverResultPublications();
      const state = await server.workStore.read(); const cancellation = state.cancellations[0];
      const result = state.results.find((item) => item.runId === seeded.run.runId);
      const session = await server.sessionStore.load(seeded.session.id);
      const surfaces = session.transcript.filter((entry) => entry.role === 'assistant'
        && entry.runId === seeded.run.runId
        && ['cancelled', 'cancel_recovery_pending'].includes(entry.result?.kind));
      assert.equal(surfaces.length, 1); assert.ok(result);
      assert.equal(result.state, 'delivery_terminal'); assert.equal(cancellation.surfacePersisted, true);
      assert.equal(cancellation.unknownEffect, pendingWithSurface ? false : true);
      assert.equal(state.claims.find((item) => item.runId === seeded.run.runId).state, 'released');
      if (pendingWithSurface) assert.equal(state.works[0].status, 'active');
      else {
        assert.equal(state.works[0].status, 'paused');
        assert.equal(surfaces[0].result.kind, 'cancel_recovery_pending');
        assert.equal(surfaces[0].result.cancellation.childrenTerminal, null);
        assert.match(surfaces[0].result.nextSafeAction, /외부 상태/u);
      }
      await server.closeBrowsers(); await server.closeMessengers();
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
  }
});
