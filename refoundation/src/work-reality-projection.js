import { createHash } from 'node:crypto';

const INTERNAL_STATES = new Set([
  'idle', 'starting', 'model_working', 'tool_working', 'process_working', 'verifying', 'publishing',
  'waiting_for_user', 'waiting_external', 'cancelling', 'recovery_pending', 'paused',
  'resumable', 'completed', 'cancelled', 'failed', 'unknown_effect',
]);
const INPUT_STATES = new Set(['queued', 'presented', 'consumed', 'followup', 'separate', 'unconsumed', 'cancel']);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clone = (value) => structuredClone(value);

function bounded(value, label) {
  const text = String(value ?? '');
  if (!text || text.length > 256 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new TypeError(`${label} is invalid`);
  }
  return text;
}
function runEvents(run) { return Array.isArray(run?.events) ? run.events : []; }
function eventTime(event) { const time = Date.parse(event?.recordedAt ?? ''); return Number.isFinite(time) ? time : 0; }
function latest(items) { return [...items].sort((left, right) => eventTime(right.event) - eventTime(left.event)
  || right.sequence - left.sequence || left.source.localeCompare(right.source))[0] ?? null; }

function selectIdentity(workState, sessionId, run) {
  const sessionWorks = (workState.works ?? []).filter((work) => work.sessionId === sessionId);
  if (!run) return { work: sessionWorks.findLast((work) => work.status === 'active')
    ?? sessionWorks.at(-1) ?? null, claim: null, cancellation: null };
  if (run.sessionId !== sessionId) throw new TypeError('foreign Session Run cannot enter Work reality');
  const claim = (workState.claims ?? []).filter((item) => item.runId === run.runId).at(-1);
  if (!claim) throw new TypeError('Run is not bound to a canonical Work claim');
  const work = sessionWorks.find((item) => item.workId === claim.workId);
  if (!work) throw new TypeError('Run Work claim is foreign to the Session');
  const runCancellations = (workState.cancellations ?? []).filter((item) => item.runId === run.runId);
  const cancellation = runCancellations.filter((item) => item.workId === claim.workId
    && item.revision === claim.revision).at(-1) ?? null;
  if (runCancellations.length && !cancellation) {
    throw new TypeError('Run cancellation is not bound to the claimed Work revision');
  }
  const revisionMatches = work.revision === claim.revision
    || (cancellation && work.revision === cancellation.nextRevision && cancellation.revision === claim.revision);
  if (!revisionMatches) throw new TypeError('Run claim is stale for the Work revision');
  return { work, claim, cancellation };
}

function workEvents(workState, work, run) {
  if (!work) return [];
  const safeRunOnly = new Set(['result_surface_persisted', 'result_delivery_started', 'result_delivery_terminal']);
  const milestoneEvents = new Set(['completion_verified', 'result_ready_pending_surface',
    'result_surface_persisted', 'result_delivery_started', 'result_delivery_terminal']);
  return (workState.events ?? []).filter((event) => {
    if (event.workId === work.workId) {
      return !run || !milestoneEvents.has(event.type) || event.runId === run.runId;
    }
    return event.runId === run?.runId && safeRunOnly.has(event.type);
  });
}
function effectKind(receipt) { return receipt?.actualCall?.args?.effect?.kind
  ?? receipt?.requestedCall?.args?.effect?.kind ?? null; }
function exactSource(result) { const source = result?.source; return source?.availability === 'available'
  && source?.digestMatched === true && typeof source?.recordId === 'string'
  && /^[a-f0-9]{64}$/u.test(source?.observedSha256 ?? ''); }
function milestoneForRun(event) {
  if (event.type === 'resource_accounting_degraded' || event.type === 'run_failed') return 'degraded';
  if (event.type === 'process_output_observed' && event.payload?.deltaChars > 0
    && ['stdout', 'stderr'].includes(event.payload?.stream)) return 'process_progress_observed';
  if (event.type === 'output_produced' && event.payload?.verified === true
    && event.payload?.reopened === true && Number.isSafeInteger(event.payload?.bytes)
    && /^[a-f0-9]{64}$/u.test(event.payload?.sha256 ?? '')) return 'artifact_created';
  if (event.type !== 'tool_completed') return null;
  const receipt = event.payload?.receipt;
  if (receipt?.outcome === 'unknown' || receipt?.result?.effectUnknown === true
    || receipt?.outcome === 'failed') return 'degraded';
  if (receipt?.outcome !== 'succeeded') return null;
  const toolName = receipt?.actualCall?.name ?? receipt?.requestedCall?.name ?? null;
  const effect = effectKind(receipt);
  if (effect && !['observe', 'none'].includes(effect)
    && receipt.result?.effectUnknown !== true
    && receipt.result?.effectObservation?.changed === true
    && (/^[a-f0-9]{64}$/u.test(receipt.result?.effectObservation?.observationDigest ?? '')
      || (receipt.result?.effectObservation?.schema === 't5.effect-observation.v2'
        && /^[a-f0-9]{64}$/u.test(receipt.result.effectObservation.receiptDigest ?? '')))) {
    return 'effect_confirmed';
  }
  if (toolName === 'attachment' && receipt.result?.state === 'observed'
    && receipt.result?.observation && receipt.result?.trust === 'untrusted_external') return 'file_observed';
  if (toolName === 'attachment' && receipt.result?.state === 'registered'
    && receipt.result?.artifact?.originalName && Number.isSafeInteger(receipt.result.artifact.bytes)
    && /^[a-f0-9]{64}$/u.test(receipt.result.artifact.sha256 ?? '')) return 'artifact_registered';
  if (toolName === 'exec' && receipt.result?.exitCode === 0
    && !['running', 'stop_requested'].includes(receipt.result?.state)) return 'computer_step_completed';
  if (toolName === 'terminal_session' && receipt.result?.state === 'completed'
    && receipt.result?.exitCode === 0) return 'computer_step_completed';
  if (toolName === 'terminal_session' && receipt.result?.state === 'running'
    && (String(receipt.result?.stdout ?? '').length > 0 || String(receipt.result?.stderr ?? '').length > 0)) {
    return 'process_progress_observed';
  }
  return exactSource(receipt.result) ? 'evidence_observed' : null;
}
function milestoneForWork(event) {
  if (event.type === 'completion_verified') return event.verifiedOutcome === 'achieved'
    ? 'result_verified' : 'result_incomplete';
  if (event.type === 'result_surface_persisted') return 'result_visible';
  if (event.type === 'result_delivery_terminal') {
    if (['persisted', 'sent', 'succeeded', 'not_requested'].includes(event.delivery?.state)) return 'delivery_succeeded';
    return event.delivery?.state === 'unknown' ? 'delivery_unknown' : 'delivery_failed';
  }
  return null;
}
function lastMilestone(workState, work, run) {
  const candidates = [];
  for (const event of workEvents(workState, work, run)) { const kind = milestoneForWork(event);
    if (kind) candidates.push({ source: 'work', event, sequence: Number(event.sequence ?? 0), kind }); }
  for (const event of runEvents(run)) { const kind = milestoneForRun(event);
    if (kind) candidates.push({ source: 'run', event, sequence: Number(event.sequence ?? 0), kind }); }
  const item = latest(candidates); return item ? { kind: item.kind, occurredAt: item.event.recordedAt ?? null,
    source: item.source, sourceEventSequence: item.sequence,
    eventDigest: hash({ source: item.source, event: item.event }) } : null;
}

function inputState(input) {
  if (input.state === 'cancel_recovery_pending' || input.disposition === 'cancelled_work') return 'cancel';
  if (input.state === 'executed' && input.settlementDisposition === 'answered') return 'consumed';
  if (input.state === 'scheduled' || input.settlementDisposition === 'deferred') return 'followup';
  if (input.disposition === 'independent_work' || input.disposition === 'resumed_work') return 'separate';
  if (input.settlementDisposition === 'unresolved' || input.settlementDisposition === 'superseded'
    || input.schedule === 'settlement_retry') return 'unconsumed';
  if (['presented', 'executing', 'completed_pending_surface'].includes(input.state)) return 'presented';
  return 'queued';
}
function relevantInput(input, work, sessionId) {
  if (!work || input.sessionId !== sessionId) return false;
  if (input.state === 'prepared') return false;
  if (input.settlementWorkId === work.workId) return input.settlementRevision === work.revision;
  if (input.workId === work.workId) return input.revision === work.revision
    || (input.state === 'scheduled' && input.baseRevision === work.revision);
  if (input.baseWorkId === work.workId) return input.baseRevision === work.revision;
  return input.state === 'admitted' && input.workId == null;
}
function projectInputs(workState, work, sessionId) {
  const relevant = (workState.inputs ?? []).filter((input) => relevantInput(input, work, sessionId));
  const unique = [...new Map(relevant.map((input) => [String(input.inputId), input])).values()].slice(-16);
  return unique.map((input) => ({ handle: hash(['input', input.inputId]).slice(0, 24),
    state: inputState(input) })).filter((item) => INPUT_STATES.has(item.state));
}

function latestToolUnknown(run) {
  const terminal = runEvents(run).filter((event) => event.type === 'tool_completed').at(-1);
  return terminal?.payload?.receipt?.outcome === 'unknown'
    || terminal?.payload?.receipt?.result?.effectUnknown === true;
}
function cancelTruth(cancellation, claim, run) {
  if (!cancellation) return null;
  const runTerminal = ['cancelled', 'failed', 'interrupted'].includes(run?.status);
  const unknownObserved = runEvents(run).some((event) => event.type === 'tool_completed'
    && (event.payload?.receipt?.outcome === 'unknown'
      || event.payload?.receipt?.result?.effectUnknown === true));
  const unknownPreserved = !unknownObserved || cancellation.unknownEffect === true;
  const claimReleased = claim?.state === 'released' && cancellation.claimReleased === true;
  const complete = cancellation.state === 'terminal' && runTerminal
    && cancellation.childrenTerminal === true && claimReleased
    && cancellation.surfacePersisted === true && unknownPreserved;
  return { admitted: true, runTerminal, childrenTerminal: cancellation.childrenTerminal === true,
    unknownEffectsPreserved: unknownPreserved, claimReleased,
    dispositionCommitted: cancellation.state === 'terminal',
    surfacePersisted: cancellation.surfacePersisted === true, complete,
    recoveryPending: cancellation.state === 'recovery_pending' || (runTerminal && !complete),
    hard: cancellation.disposition === 'hard_cancelled' };
}
function waitingBoundary(run) {
  const receipt = runEvents(run).filter((event) => event.type === 'tool_completed').at(-1)?.payload?.receipt;
  const state = receipt?.result?.state;
  if (state === 'approval_required') return 'approval';
  if (state === 'secret_input_required') return 'secret_input';
  if (state === 'login_required') return 'login';
  return null;
}
function unmatched(events, startType, endType, identity) {
  const ended = new Set(events.filter((event) => event.type === endType).map(identity).filter(Boolean));
  return events.some((event) => event.type === startType && !ended.has(identity(event)));
}
function currentState({ work, run, workState, cancellation, claim }) {
  const cancel = cancelTruth(cancellation, claim, run);
  if (cancel) {
    if (cancel.complete) return cancel.hard ? 'cancelled' : 'resumable';
    return cancel.recoveryPending ? 'recovery_pending' : 'cancelling';
  }
  const boundary = waitingBoundary(run); if (boundary) return 'waiting_for_user';
  if (run?.status === 'failed') return 'failed';
  if (latestToolUnknown(run)) return 'unknown_effect';
  const result = (workState.results ?? []).find((item) => item.runId === run?.runId);
  if (result?.state === 'delivery_terminal') return ['persisted', 'sent', 'succeeded', 'not_requested']
    .includes(result.delivery?.state) ? 'completed' : result.delivery?.state === 'unknown'
      ? 'unknown_effect' : 'failed';
  if (result?.state === 'pending_surface') return 'publishing';
  if (result?.state === 'delivery_started') return 'waiting_external';
  const events = runEvents(run); const last = events.at(-1);
  const processReceipt = events.filter((event) => event.type === 'tool_completed'
    && event.payload?.receipt?.result?.processId).at(-1)?.payload?.receipt;
  if (processReceipt && ['running', 'busy'].includes(processReceipt.result?.state)) return 'process_working';
  if (unmatched(events, 'tool_started', 'tool_completed', (event) => (
    event.payload?.toolCallId ?? event.payload?.receipt?.toolCallId ?? event.stepId
  ))) return 'tool_working';
  if (unmatched(events, 'model_started', 'model_completed', (event) => (
    event.payload?.turn ?? event.stepId
  ))) return 'model_working';
  if (last?.type === 'model_completed' || last?.type === 'tool_completed') return 'verifying';
  if (run?.status === 'completed') return 'verifying';
  if (work?.status === 'paused') return 'paused';
  if (work?.status === 'cancelled') return 'cancelled';
  return run ? 'starting' : work ? 'paused' : 'idle';
}
function recap(snapshot) {
  const lines = [];
  if (snapshot.lastMilestone) lines.push({ kind: 'milestone', code: snapshot.lastMilestone.kind });
  if (!['idle', 'completed'].includes(snapshot.state)) lines.push({ kind: 'state', code: snapshot.state });
  if (snapshot.userBoundary) lines.push({ kind: 'action', code: snapshot.userBoundary });
  if (snapshot.result.surfacePersisted) lines.push({ kind: 'result', code: snapshot.result.resumable ? 'resumable' : 'preserved' });
  return lines.slice(0, 4);
}

export function projectWorkReality({ sessionId, workState, run = null } = {}) {
  const session = bounded(sessionId, 'sessionId');
  if (!workState || typeof workState !== 'object') throw new TypeError('WorkStore projection is required');
  const inputDigest = hash({ sessionId: session, workState, run });
  const { work, claim, cancellation } = selectIdentity(workState, session, run);
  const state = currentState({ work, run, workState, cancellation, claim });
  const resultRecord = (workState.results ?? []).find((item) => item.runId === run?.runId) ?? null;
  const snapshot = { schema: 't5.work-reality-snapshot.v1', identity: { sessionId: session,
    workId: work?.workId ?? null, workRevision: work?.revision ?? null, runId: run?.runId ?? null },
  state, currentActivity: ['idle', 'completed', 'cancelled', 'failed'].includes(state) ? null : {
    kind: state, startedAt: run?.startedAt ?? null, lastChangedAt: runEvents(run).at(-1)?.recordedAt ?? null },
  lastMilestone: lastMilestone(workState, work, run), inputs: projectInputs(workState, work, session),
  userBoundary: waitingBoundary(run), result: { ready: Boolean(resultRecord),
    surfacePersisted: ['surface_persisted', 'delivery_started', 'delivery_terminal'].includes(resultRecord?.state),
    delivery: resultRecord?.state === 'delivery_terminal' ? (['persisted', 'sent', 'succeeded', 'not_requested']
      .includes(resultRecord.delivery?.state) ? 'succeeded' : resultRecord.delivery?.state === 'unknown'
        ? 'unknown' : 'failed') : resultRecord?.state === 'delivery_started' ? 'started' : 'not_started',
    resumable: Boolean(resultRecord) && (work?.status === 'active' || work?.status === 'paused')
      && cancellation?.state !== 'recovery_pending' && cancellation?.disposition !== 'hard_cancelled' },
  cancellation: cancelTruth(cancellation, claim, run), generation: '' };
  snapshot.recap = recap(snapshot);
  snapshot.generation = hash({ state: snapshot.state, milestone: snapshot.lastMilestone,
    inputs: snapshot.inputs.map((item) => item.state), userBoundary: snapshot.userBoundary,
    result: snapshot.result, cancellation: snapshot.cancellation, recap: snapshot.recap });
  if (hash({ sessionId: session, workState, run }) !== inputDigest) throw new Error('Work reality mutated canonical input');
  return clone(snapshot);
}

const STATE_TEXT = Object.freeze({ idle: '진행 중인 작업이 없어요.', starting: '작업을 시작하고 있어요.',
  model_working: '요청을 바탕으로 다음 단계를 준비하고 있어요.', tool_working: '필요한 작업을 진행하고 있어요.',
  process_working: '컴퓨터 작업을 계속 진행하고 있어요.',
  verifying: '확인한 결과를 검증하고 있어요.', publishing: '결과를 전달할 준비를 하고 있어요.',
  waiting_for_user: '사용자 확인을 기다리고 있어요.', waiting_external: '외부 결과를 기다리고 있어요.',
  cancelling: '멈추는 중이에요.', recovery_pending: '실행은 멈췄지만 추가 확인이 필요해요.',
  paused: '작업을 잠시 멈춰 두었어요.', resumable: '작업을 멈췄고 이어갈 수 있어요.',
  completed: '작업을 마쳤어요.', cancelled: '작업을 취소했어요.', failed: '작업을 끝내지 못했어요.',
  unknown_effect: '외부 변화 여부를 아직 확인하지 못했어요.' });
const MILESTONE_TEXT = Object.freeze({ evidence_observed: '필요한 근거를 확인했어요.',
  effect_confirmed: '요청한 변경을 확인했어요.', artifact_created: '검증된 결과 파일을 만들었어요.',
  computer_step_completed: '컴퓨터에서 확인 작업 한 단계를 마쳤어요.', file_observed: '파일 내용을 확인했어요.',
  artifact_registered: '결과 파일을 준비했어요.',
  process_progress_observed: '컴퓨터 작업에서 새 진행 내용을 확인했어요.',
  result_verified: '결과가 요청과 맞는지 확인했어요.', result_incomplete: '아직 끝내지 못한 부분을 확인했어요.',
  result_visible: '결과를 화면에 준비했어요.', delivery_succeeded: '결과 전달을 확인했어요.',
  delivery_failed: '결과를 전달하지 못했어요.', delivery_unknown: '결과 전달 여부를 확인하지 못했어요.',
  degraded: '확인이 필요한 문제가 생겼어요.' });
const INPUT_TEXT = Object.freeze({ queued: '현재 작업에 반영할 내용을 받았어요.',
  presented: '현재 작업에 반영할지 확인하고 있어요.', consumed: '현재 결과에 반영했어요.',
  followup: '현재 결과를 전달한 뒤 이어서 할게요.', separate: '별도 작업으로 기다리고 있어요.',
  unconsumed: '이번에는 반영되지 않아 다음 입력으로 보존했어요.', cancel: '중지 요청을 접수했어요.' });

export function projectPublicWorkReality(snapshot) {
  if (!snapshot || snapshot.schema !== 't5.work-reality-snapshot.v1' || !INTERNAL_STATES.has(snapshot.state)) {
    throw new TypeError('validated internal Work reality snapshot is required');
  }
  const recap = snapshot.recap.map((line) => line.kind === 'milestone' ? MILESTONE_TEXT[line.code]
    : line.kind === 'state' ? STATE_TEXT[line.code] : line.kind === 'action'
      ? '계속하려면 사용자 확인이 필요해요.' : line.code === 'resumable'
        ? '지금까지 확인한 결과를 보존했고 이어갈 수 있어요.' : '지금까지 확인한 결과를 보존해 두었어요.')
    .filter(Boolean).slice(0, 4);
  const output = { schema: 't5.public-work-reality.v1', statusText: STATE_TEXT[snapshot.state],
    activity: snapshot.currentActivity ? { text: STATE_TEXT[snapshot.currentActivity.kind] } : null,
    milestone: snapshot.lastMilestone ? { text: MILESTONE_TEXT[snapshot.lastMilestone.kind] } : null,
    inputs: snapshot.inputs.map((item) => ({ text: INPUT_TEXT[item.state] })),
    userActionNeeded: Boolean(snapshot.userBoundary), result: {
      visible: snapshot.result.surfacePersisted,
      deliveryText: snapshot.result.delivery === 'succeeded' ? '전달됨'
        : snapshot.result.delivery === 'failed' ? '전달하지 못함'
          : snapshot.result.delivery === 'unknown' ? '전달 여부 확인 필요' : null,
      resumable: snapshot.result.resumable,
    }, recap, showPanel: !['idle', 'completed'].includes(snapshot.state)
      || snapshot.inputs.length > 0 || Boolean(snapshot.userBoundary) };
  const serialized = JSON.stringify(output);
  for (const value of Object.values(snapshot.identity)) if (typeof value === 'string' && value.length >= 3
    && serialized.includes(value)) throw new Error('public Work reality leaked canonical identity');
  if (/\b(?:active|pending_surface|RecordRef)\b|[0-9a-f]{8}-[0-9a-f-]{27}/iu.test(serialized)
    || serialized.length > 16 * 1024) throw new Error('public Work reality leaked internal state');
  return output;
}
