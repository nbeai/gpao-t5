const ACTIVE = new Set(['waiting', 'readiness_observed', 'completion_recorded', 'resume_claimed',
  'resume_completed_pending_surface']);
const RESUMABLE = new Set(['completion_recorded', 'resume_claimed', 'resume_completed_pending_surface']);
const TERMINAL = new Set(['resumed', 'cancelled', 'needs_attention']);

function surfaceHandoffs(session) {
  return (session?.transcript ?? []).flatMap((entry) => {
    const handoff = entry?.role === 'assistant' ? entry.result?.connectionHandoff : null;
    return handoff?.handoffId ? [structuredClone(handoff)] : [];
  });
}

export function makeCapabilityHandoffCoordinator({
  ledger, sessions, runLedger, authority, connectionServices,
  isSessionRunning, executeResume, emitWake = () => {}, onError = () => {},
  ensureSurfacePersisted = async () => null,
  pollIntervalMs = 2_000, pollTimeoutMs = 10 * 60_000,
} = {}) {
  if (!ledger || !sessions || !runLedger || !authority || !(connectionServices instanceof Map)) {
    throw new TypeError('capability handoff coordinator dependencies are required');
  }
  if (typeof isSessionRunning !== 'function' || typeof executeResume !== 'function') {
    throw new TypeError('capability handoff coordinator callbacks are required');
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 5 || pollIntervalMs > 60_000) {
    throw new TypeError('invalid capability handoff poll interval');
  }
  if (!Number.isInteger(pollTimeoutMs) || pollTimeoutMs < pollIntervalMs
    || pollTimeoutMs > 60 * 60_000) throw new TypeError('invalid capability handoff poll timeout');

  const watchers = new Map();
  const resumeTimers = new Map();
  const resumeInFlight = new Set();
  const resumeTasks = new Set();

  async function handoffs() { await ledger.ensure(); return (await ledger.read()).handoffs; }

  async function get(handoffId) {
    return (await handoffs()).find((entry) => entry.handoffId === String(handoffId)) ?? null;
  }

  async function appendSessionEvent(sessionId, kind, payload) {
    const session = await sessions.load(sessionId);
    if (!session) return false;
    const exists = (session.transcript ?? []).some((entry) => (
      entry?.role === 'system_event' && entry.event?.kind === kind
      && String(entry.event?.handoffId ?? '') === String(payload.handoffId ?? '')
    ));
    if (exists) return false;
    await sessions.append(sessionId, { role: 'system_event', event: { kind, ...payload } });
    return true;
  }

  function clearWatcher(connectionId) {
    const watcher = watchers.get(String(connectionId));
    if (!watcher) return;
    clearTimeout(watcher); watchers.delete(String(connectionId));
  }

  function clearResumeTimer(handoffId) {
    const timer = resumeTimers.get(String(handoffId));
    if (!timer) return;
    clearTimeout(timer); resumeTimers.delete(String(handoffId));
  }

  function scheduleResume(handoffId, delay = 0) {
    const id = String(handoffId);
    if (resumeTimers.has(id) || resumeInFlight.has(id)) return;
    const timer = setTimeout(() => {
      resumeTimers.delete(id);
      const task = resume(id).catch((error) => onError(error));
      resumeTasks.add(task); task.finally(() => resumeTasks.delete(task));
    }, delay);
    timer.unref?.(); resumeTimers.set(id, timer);
  }

  async function previousResumeRun(handoff) {
    if (!handoff.claimId) return null;
    const runs = await runLedger.list({ sessionId: handoff.sessionId });
    return runs.find((run) => run.metadata?.connectionResumeClaimId === handoff.claimId) ?? null;
  }

  async function resume(handoffId) {
    const id = String(handoffId);
    if (resumeInFlight.has(id)) return false;
    let handoff = await get(id);
    if (!handoff || TERMINAL.has(handoff.state) || !RESUMABLE.has(handoff.state)) return false;
    if (isSessionRunning(handoff.sessionId)) {
      scheduleResume(id, pollIntervalMs); return false;
    }
    resumeInFlight.add(id);
    try {
      if (handoff.state === 'resume_completed_pending_surface') {
        const recovered = await ensureSurfacePersisted({ handoff });
        if (!recovered?.surfaceReceipt) return false;
        await ledger.markResumed(id, { resumeRunId: handoff.resumeRunId,
          surfaceReceipt: recovered.surfaceReceipt });
        await appendSessionEvent(handoff.sessionId, 'connection_resumed', {
          handoffId: id, connectionId: handoff.connectionId, runId: handoff.resumeRunId,
        });
        return true;
      }
      if (handoff.state === 'completion_recorded') {
        await authority.withdrawActive(handoff.sessionId, 'capability_resume');
        handoff = await ledger.claimResume(id);
      }
      const previous = await previousResumeRun(handoff);
      if (previous?.status === 'completed'
        && previous.events.some((event) => event.type === 'surface_persisted')) {
        const ready = previous.events.find((event) => event.type === 'result_ready_pending_surface');
        if (!ready?.payload?.resultDigest) throw new Error('resume result ready evidence missing');
        await ledger.markResumeCompletedPendingSurface(id, { resumeRunId: previous.runId,
          resultPointer: `work-result:${previous.runId}`, resultDigest: ready.payload.resultDigest });
        await ledger.markResumed(id, { resumeRunId: previous.runId, surfaceReceipt: {
          surface: 'console_session', sessionId: handoff.sessionId,
          runId: previous.runId, resultDigest: ready.payload.resultDigest,
        } });
        await appendSessionEvent(handoff.sessionId, 'connection_resumed', {
          handoffId: id, connectionId: handoff.connectionId, runId: previous.runId,
        });
        return true;
      }
      if (previous && ['interrupted', 'failed', 'cancelled'].includes(previous.status)) {
        await ledger.needsAttention(id, 'resume_interrupted', previous.runId);
        await appendSessionEvent(handoff.sessionId, 'connection_resume_needs_attention', {
          handoffId: id, connectionId: handoff.connectionId, runId: previous.runId,
        });
        return false;
      }
      const completed = await executeResume({ handoff, claimId: handoff.claimId,
        beforeSurfacePersist: async ({ runId, resultPointer, resultDigest }) => (
          ledger.markResumeCompletedPendingSurface(id, { resumeRunId: runId, resultPointer, resultDigest })
        ),
        afterSurfacePersist: async ({ runId, surfaceReceipt }) => (
          ledger.markResumed(id, { resumeRunId: runId, surfaceReceipt })
        ) });
      if (completed?.kind !== 'reply' || !completed.runId) {
        await ledger.needsAttention(id, 'resume_did_not_complete', completed?.runId ?? null);
        return false;
      }
      const terminal = await get(id);
      if (terminal?.state !== 'resumed') {
        const recovered = await ensureSurfacePersisted({ handoff: await get(id) });
        if (!recovered?.surfaceReceipt) return false;
        await ledger.markResumed(id, { resumeRunId: completed.runId,
          surfaceReceipt: recovered.surfaceReceipt });
      }
      await appendSessionEvent(handoff.sessionId, 'connection_resumed', {
        handoffId: id, connectionId: handoff.connectionId, runId: completed.runId,
      });
      emitWake({
        sessionId: handoff.sessionId, handoffId: id, connectionId: handoff.connectionId,
        runId: completed.runId, reply: completed.reply ?? null,
      });
      return true;
    } catch (error) {
      const current = await get(id).catch(() => null);
      if (current?.state === 'resume_completed_pending_surface') scheduleResume(id, pollIntervalMs);
      else await ledger.needsAttention(id, 'resume_failed', error?.runId ?? null).catch(() => {});
      throw error;
    } finally { resumeInFlight.delete(id); }
  }

  async function recordReady(handoff, connectionState) {
    let current = await ledger.observeReady(handoff.handoffId, connectionState);
    if (current.state === 'readiness_observed') current = await ledger.recordCompletion(handoff.handoffId);
    await appendSessionEvent(handoff.sessionId, 'connection_completed', {
      handoffId: handoff.handoffId, connectionId: handoff.connectionId, connectionState,
    });
    scheduleResume(current.handoffId);
  }

  async function inspectWaiting(connectionId) {
    watchers.delete(String(connectionId));
    const waiting = (await handoffs()).filter((handoff) => (
      handoff.connectionId === connectionId && handoff.state === 'waiting'
    ));
    if (!waiting.length) return;
    const now = Date.now();
    const active = [];
    for (const handoff of waiting) {
      if (now - Date.parse(handoff.startedAt) >= pollTimeoutMs) {
        await ledger.needsAttention(handoff.handoffId, 'readiness_timeout');
        await appendSessionEvent(handoff.sessionId, 'connection_wait_expired', {
          handoffId: handoff.handoffId, connectionId,
        });
      } else active.push(handoff);
    }
    if (!active.length) return;
    let truth = null;
    try { truth = await connectionServices.get(connectionId)?.inspect?.(); }
    catch { /* bounded polling keeps waiting without waking the model */ }
    if (truth && ['connected', 'ready'].includes(truth.state)) {
      for (const handoff of active) await recordReady(handoff, truth.state);
    } else watch(connectionId);
  }

  function watch(connectionId) {
    const id = String(connectionId ?? '');
    if (!connectionServices.has(id) || watchers.has(id)) return;
    const timer = setTimeout(() => inspectWaiting(id).catch((error) => onError(error)), pollIntervalMs);
    timer.unref?.(); watchers.set(id, timer);
  }

  async function register({ handoffId, sessionId, connectionId, mode, originRunId = handoffId }) {
    const handoff = await ledger.start({ handoffId, sessionId, connectionId, mode, originRunId });
    if (handoff.state === 'waiting') watch(connectionId);
    return handoff;
  }

  async function hasActiveConnection(connectionId) {
    return (await handoffs()).some((handoff) => (
      handoff.connectionId === String(connectionId) && ACTIVE.has(handoff.state)
    ));
  }

  async function verifyAndComplete({ handoffId, sessionId = null, connectionId = null }) {
    const handoff = await get(handoffId);
    if (!handoff || (sessionId && handoff.sessionId !== String(sessionId))
      || (connectionId && handoff.connectionId !== String(connectionId))) return null;
    const truth = await connectionServices.get(handoff.connectionId)?.inspect?.();
    if (!truth || !['connected', 'ready'].includes(truth.state)) {
      return { completed: false, handoff, truth };
    }
    await recordReady(handoff, truth.state);
    return { completed: true, handoff: await get(handoffId), truth };
  }

  async function cancel({ handoffId, cancelProvider = true } = {}) {
    const handoff = await get(handoffId);
    if (!handoff || TERMINAL.has(handoff.state)) return {
      cancelled: false, userSafeSummary: '취소할 연결 준비가 없어요.',
    };
    const service = connectionServices.get(handoff.connectionId);
    let providerCancelled = false;
    let result = null;
    if (cancelProvider && handoff.mode === 'oauth' && typeof service?.cancelPending === 'function') {
      result = await service.cancelPending(); providerCancelled = result?.cancelled === true;
    }
    if (!result) result = {
      cancelled: true,
      userSafeSummary: '준비를 기다리지 않고 여기서 멈췄어요.',
    };
    const affected = providerCancelled
      ? (await handoffs()).filter((candidate) => (
        candidate.connectionId === handoff.connectionId && ACTIVE.has(candidate.state)
      )) : [handoff];
    if (!result.cancelled) return result;
    for (const candidate of affected) {
      if (!ACTIVE.has(candidate.state)) continue;
      await ledger.cancel(candidate.handoffId); clearResumeTimer(candidate.handoffId);
      await appendSessionEvent(candidate.sessionId, 'connection_cancelled', {
        handoffId: candidate.handoffId, connectionId: candidate.connectionId,
        reason: candidate.handoffId === handoff.handoffId
          ? 'user_cancelled' : 'shared_preparation_cancelled',
      });
    }
    return result;
  }

  async function cancelSessionHandoffs(items = []) {
    let cancelled = 0;
    for (const surface of items) {
      const current = await get(surface.handoffId);
      if (!current || !ACTIVE.has(current.state)) continue;
      const result = await cancel({
        handoffId: current.handoffId, cancelProvider: surface.mode !== 'user_action',
      });
      if (result.cancelled) cancelled += 1;
    }
    return cancelled;
  }

  async function recover() {
    await ledger.ensure();
    const summaries = [...await sessions.list(), ...await sessions.list({ archived: true })];
    for (const summary of summaries) {
      const session = await sessions.load(summary.id);
      for (const surface of surfaceHandoffs(session)) {
        await ledger.start({
          handoffId: surface.handoffId, sessionId: summary.id,
          connectionId: surface.connectionId, mode: surface.mode ?? 'oauth',
          originRunId: surface.handoffId,
        });
      }
    }
    for (const handoff of await handoffs()) {
      if (handoff.state === 'waiting') watch(handoff.connectionId);
      else if (RESUMABLE.has(handoff.state)) {
        await appendSessionEvent(handoff.sessionId, 'connection_completed', {
          handoffId: handoff.handoffId, connectionId: handoff.connectionId,
          connectionState: handoff.connectionState,
        });
        if (handoff.state === 'resume_completed_pending_surface') {
          await resume(handoff.handoffId);
        } else scheduleResume(handoff.handoffId);
      }
    }
  }

  async function close() {
    for (const timer of watchers.values()) clearTimeout(timer);
    for (const timer of resumeTimers.values()) clearTimeout(timer);
    watchers.clear(); resumeTimers.clear();
    await Promise.allSettled([...resumeTasks]);
  }

  return {
    ledger, register, hasActiveConnection, verifyAndComplete, get,
    cancel, cancelSessionHandoffs, recover, close,
  };
}
