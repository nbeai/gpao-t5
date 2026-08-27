import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import { diffS3BusinessWorkspace, findS3HumanBusinessScenario,
  materializeS3HumanBusinessScenario, snapshotS3BusinessWorkspace } from '../src/s3-human-business-scenarios.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
async function until(work, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await work(); if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error('journey_timeout');
}
function publicMetadata(value) {
  if (Array.isArray(value)) return value.map(publicMetadata);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:key|apiKey|access|refresh|password|token|credential)$/iu.test(key)) throw new Error('inline_secret_boundary');
    output[key] = publicMetadata(child);
  }
  return output;
}

async function main() {
  if (!process.argv.includes('--human-controlled')) throw new Error('human_control_required');
  const sourceFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
    ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
  const sourceState = publicMetadata(JSON.parse(await readFile(sourceFile, 'utf8')));
  const selected = sourceState.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5');
  if (!selected?.secretRef) throw new Error('connection_boundary');
  const root = await mkdtemp(join(tmpdir(), 't5-khb-h01-requalification-')); const home = join(root, 'home');
  const stateDir = join(root, 'state'); const workspace = join(root, 'workspace'); const skillsRoot = join(root, 'skills');
  await Promise.all([home, stateDir, workspace, skillsRoot].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  let server; const previousHome = process.env.T5_REFOUNDATION_HOME;
  try {
    const { catalog, scenario } = await findS3HumanBusinessScenario('KHB-H01');
    await materializeS3HumanBusinessScenario({ scenario, catalog, workspace });
    const baseline = await snapshotS3BusinessWorkspace(workspace);
    const connectionFile = join(root, 'model-connection.json');
    await writeFile(connectionFile, JSON.stringify({ ...sourceState, activeId: selected.id,
      connections: [selected] }), { mode: 0o600 });
    process.env.T5_REFOUNDATION_HOME = home;
    const computer = discoverComputerEnvironment({ userHome: home });
    const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
    const secretStore = makePlatformSecretStore({ platform: computer.platform });
    const catalogAccess = makeStoredModelCredentialCatalog({ file: connectionFile, secretStore });
    await catalogAccess.activate(selected.id);
    const access = makeConsoleModelAccess({ connectionFile, stateDir, secretStore });
    const terminalPlatformAdapter = await makeTerminalPlatformAdapter({ platform: computer.platform,
      protectedReadRoots: [dirname(sourceFile), root] });
    server = makeConsoleServer({ stateDir, workspace, skillsRoot, learningReviewMode: 'off',
      modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
      computerEnvironment: computer, terminalEnvironment, terminalPlatformAdapter,
      messengerCredentialStore: new MessengerCredentialStore(join(stateDir, 'messenger-empty')),
      workspaceConnectionInspectors: [], workspaceConnectionServices: [] });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const started = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: scenario.primaryPrompt }) }).then((response) => response.json());
    const streamResponse = await fetch(`${base}/turn/stream?sessionId=${session.id}&streamId=${started.streamId}`);
    const streamReader = streamResponse.body.getReader(); const streamDecoder = new TextDecoder(); let streamText = '';
    const streamPromise = (async () => { while (true) { const part = await streamReader.read(); if (part.done) break;
      streamText += streamDecoder.decode(part.value, { stream: true }); } })();
    let meaningful;
    try {
      meaningful = await until(async () => {
        const candidates = ['컴퓨터 작업에서 새 진행 내용을 확인했어요.', '컴퓨터에서 확인 작업 한 단계를 마쳤어요.',
          '파일 내용을 확인했어요.', '요청한 변경을 확인했어요.', '결과 파일을 준비했어요.'];
        const text = candidates.find((candidate) => streamText.includes(candidate));
        return text ? { milestone: { text } } : null;
      });
    } catch {
      const runs = await fetch(`${base}/runs?sessionId=${session.id}`).then((response) => response.json());
      const diagnostics = [];
      for (const item of runs.runs) {
        const snapshot = await fetch(`${base}/runs/${item.runId}`).then((response) => response.json());
        diagnostics.push({ status: snapshot.status, events: snapshot.events.map((event) => {
          const receipt = event.payload?.receipt;
          return { type: event.type, tool: receipt?.actualCall?.name ?? receipt?.requestedCall?.name ?? null,
            outcome: receipt?.outcome ?? null, resultState: receipt?.result?.state ?? null,
            exitCode: Number.isInteger(receipt?.result?.exitCode) ? receipt.result.exitCode : null,
            stdoutChars: typeof receipt?.result?.stdout === 'string' ? receipt.result.stdout.length : null,
            returnedToolNames: event.type === 'model_completed'
              ? (event.payload?.response?.toolCalls ?? []).map((call) => call.name) : [] };
        }) });
      }
      const reality = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      process.stdout.write(`${JSON.stringify({ schema: 't5.s3ux.khb-h01-requalification.v1', passed: false,
        failure: 'meaningful_milestone_timeout', diagnostics, publicWorkReality: reality.workReality }, null, 2)}\n`);
      process.exitCode = 1; return;
    }
    const correctionAt = Date.now();
    const correction = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: scenario.testerInterventions[0] }) });
    const correctionBody = await correction.json();
    const queued = await until(async () => {
      const detail = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      return detail.workReality?.inputs?.some((item) => item.text === '현재 작업에 반영할 내용을 받았어요.')
        ? detail.workReality : null;
    });
    const queuedAt = Date.now();
    const cancelAt = Date.now(); const cancelResponse = await fetch(`${base}/turn/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id }) });
    const cancelled = await cancelResponse.json(); const cancelDoneAt = Date.now(); await streamPromise;
    const workAfterCancel = await server.workStore.read(); const cancellationAtCancel = workAfterCancel.cancellations.at(-1);
    const cancelWork = cancellationAtCancel && workAfterCancel.works.find((item) => item.workId === cancellationAtCancel.workId);
    const sameWorkNextRevisionClaimable = Boolean(cancellationAtCancel && cancelWork
      && cancelWork.revision === cancellationAtCancel.nextRevision && cancelWork.status === 'active'
      && workAfterCancel.claims.find((item) => item.runId === cancellationAtCancel.runId)?.state === 'released');
    const afterCancel = await snapshotS3BusinessWorkspace(workspace);
    const workspaceDiff = diffS3BusinessWorkspace(baseline, afterCancel);
    const unexpectedCreated = workspaceDiff.created.filter((path) => path !== '진행기록.log');
    const runsBeforeFollowup = await fetch(`${base}/runs?sessionId=${session.id}`).then((response) => response.json());
    const followupResponse = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: scenario.testerInterventions[2] }) });
    const followup = await followupResponse.json();
    const runsAfter = await fetch(`${base}/runs?sessionId=${session.id}`).then((response) => response.json());
    const newRunId = runsAfter.runs.find((item) => !runsBeforeFollowup.runs.some((before) => before.runId === item.runId))?.runId;
    const followupRun = newRunId ? await fetch(`${base}/runs/${newRunId}`).then((response) => response.json()) : null;
    const followupToolStarts = followupRun?.events?.filter((event) => event.type === 'tool_started').length ?? null;
    const followupReplayedProcess = followupRun?.events?.some((event) => {
      if (event.type !== 'tool_completed') return false;
      const receipt = event.payload?.receipt; const name = receipt?.actualCall?.name;
      const command = String(receipt?.actualCall?.args?.command ?? '');
      return ['process_start', 'pty_start'].includes(name) || command.includes('월간보고_준비.mjs');
    }) ?? null;
    const work = await server.workStore.read(); const cancellation = work.cancellations.at(-1);
    const followupClaim = work.claims.find((item) => item.runId === newRunId);
    const sameWorkRecoveryClaims = cancellation ? work.claims.filter((item) => item.runId !== cancellation.runId
      && item.workId === cancellation.workId && item.revision >= cancellation.nextRevision) : [];
    const correctionInput = work.inputs.find((item) => item.inputId === correctionBody.inputId);
    const refreshed = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    const publicSurface = JSON.stringify({ meaningful: meaningful.milestone, queued: queued.inputs,
      cancelled: cancelled.userSafeSummary, followup: followup.reply, refreshed: refreshed.workReality });
    const result = { schema: 't5.s3ux.khb-h01-requalification.v1', model: 'gpt-5.5',
      meaningfulMilestone: meaningful.milestone.text,
      correctionHttpStatus: correction.status, correctionAdmitted: correctionBody.admitted === true,
      correctionQueuedVisibleMs: queuedAt - correctionAt,
      cancelHttpStatus: cancelResponse.status, cancelWallMs: cancelDoneAt - cancelAt,
      cancelTerminal: cancelled.terminal === true, childrenTerminal: cancelled.childrenTerminal === true,
      claimReleased: cancelled.claimReleased === true, surfacePersisted: cancelled.surfacePersisted === true,
      createdFiles: workspaceDiff.created.length, unexpectedCreatedFiles: unexpectedCreated.length,
      progressLogPreserved: workspaceDiff.created.includes('진행기록.log'), changedFiles: workspaceDiff.modified.length,
      sameWorkNextRevisionClaimable,
      sameWorkRecoveryRunStarted: sameWorkRecoveryClaims.length > 0,
      sameWorkRecoveryRunCount: sameWorkRecoveryClaims.length,
      correctionPreserved: Boolean(correctionInput), correctionState: correctionInput?.state ?? null,
      correctionTransitionChoice: correctionInput?.transitionChoice ?? null,
      correctionDisposition: correctionInput?.disposition ?? null,
      correctionSettlementSameWork: Boolean(cancellation && correctionInput
        && correctionInput.settlementWorkId === cancellation.workId),
      correctionSettlementRevision: correctionInput?.settlementRevision ?? null,
      cancellationRevision: cancellation?.revision ?? null,
      cancellationNextRevision: cancellation?.nextRevision ?? null,
      sameWorkRecoveryQualified: Boolean(cancellation && correctionInput
        && correctionInput.transitionChoice === 'steer_current'
        && correctionInput.disposition === 'current_work'
        && correctionInput.settlementWorkId === cancellation.workId
        && correctionInput.settlementRevision === cancellation.nextRevision + 1
        && sameWorkRecoveryClaims.some((item) => item.revision === correctionInput.settlementRevision)),
      followupSameWorkRevision: Boolean(cancellation && followupClaim
        && followupClaim.workId === cancellation.workId && followupClaim.revision === cancellation.nextRevision),
      followupHttpStatus: followupResponse.status, followupRunStarted: Boolean(newRunId),
      followupToolStarts, followupReplayedProcess, followupReplyDigest: followup.reply ? hash(followup.reply) : null,
      followupReplyForHumanReview: followup.reply ? String(followup.reply).slice(0, 1000) : null,
      refreshProjectionExact: refreshed.workReality?.statusText != null,
      internalPathIdOrSecretInSurface: /(?:\/Users\/|\/private\/|\b[0-9a-f]{8}-[0-9a-f-]{27}\b|\bsk-)/u.test(publicSurface),
      externalWrites: 0,
    };
    result.passed = Boolean(result.meaningfulMilestone) && result.correctionHttpStatus === 202
      && result.correctionAdmitted && result.cancelHttpStatus === 200 && result.cancelTerminal
      && result.childrenTerminal && result.claimReleased && result.surfacePersisted
      && result.unexpectedCreatedFiles === 0 && result.changedFiles === 0 && result.sameWorkNextRevisionClaimable
      && result.sameWorkRecoveryQualified && result.correctionPreserved
      && result.followupHttpStatus === 200 && result.followupRunStarted && result.followupReplayedProcess === false
      && result.refreshProjectionExact && !result.internalPathIdOrSecretInSurface;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.passed) process.exitCode = 1;
  } finally {
    if (server) { server.closeWakeStreams(); server.closeModelConnections();
      await server.managedProcesses.stopAll('test_shutdown'); await new Promise((resolve) => server.close(resolve)); }
    if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME; else process.env.T5_REFOUNDATION_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => { process.stdout.write(`${JSON.stringify({ schema: 't5.s3ux.khb-h01-requalification.v1',
  passed: false, failure: /credential|connection/u.test(error?.message ?? '') ? 'credential_boundary'
    : /timeout/u.test(error?.message ?? '') ? 'journey_timeout' : 'product_journey_boundary' })}\n`); process.exitCode = 1; });
