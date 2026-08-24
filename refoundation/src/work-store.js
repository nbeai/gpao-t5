import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = 't5.work-event.v1';
const OUTCOMES = new Set(['achieved', 'unresolved', 'cancelled']);
const clone = (value) => structuredClone(value);

export class WorkStore {
  constructor(directory, { makeId = randomUUID, now = () => new Date().toISOString() } = {}) {
    if (!directory) throw new TypeError('work directory is required');
    this.directory = directory; this.file = join(directory, 'events.jsonl');
    this.makeId = makeId; this.now = now; this.queue = Promise.resolve();
  }

  serialize(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  async events() {
    let text = ''; try { text = await readFile(this.file, 'utf8'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const events = text.split('\n').filter(Boolean).map(JSON.parse);
    events.forEach((event, index) => {
      if (event.schema !== SCHEMA || event.sequence !== index + 1) throw new Error('invalid work event sequence');
    });
    return events;
  }
  async append(type, payload) {
    return this.serialize(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
      const events = await this.events();
      const event = { schema: SCHEMA, sequence: events.length + 1, recordedAt: this.now(), type, ...clone(payload) };
      await appendFile(this.file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(this.file, 0o600); return clone(event);
    });
  }
  async read() {
    const events = await this.events(); const works = new Map(); const inputs = new Map(); const claims = new Map();
    const proposals = new Map(); const results = new Map();
    for (const event of events) {
      if (event.type === 'work_created') works.set(event.workId, { workId: event.workId,
        sessionId: event.sessionId, revision: 1, status: 'active', sourceMessageId: event.sourceMessageId });
      if (event.type === 'input_admission_prepared') inputs.set(event.inputId, { inputId: event.inputId,
        sessionId: event.sessionId, messageId: event.messageId, origin: event.origin,
        attachmentIds: event.attachmentIds ?? [], source: event.source ?? {}, state: 'prepared' });
      if (event.type === 'input_admitted') {
        const input = inputs.get(event.inputId);
        if (input) input.state = 'admitted';
        else inputs.set(event.inputId, { inputId: event.inputId, sessionId: event.sessionId,
          messageId: event.messageId, origin: event.origin, attachmentIds: event.attachmentIds ?? [],
          source: event.source ?? {}, state: 'admitted' });
      }
      if (event.type === 'input_admission_aborted') {
        const input = inputs.get(event.inputId); if (input) input.state = 'aborted';
      }
      if (event.type === 'input_presented') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input, {
          state: 'presented', presentedRunId: event.runId,
          baseWorkId: event.workId, baseRevision: event.revision,
        });
      }
      if (event.type === 'input_applied_to_current_work') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input, {
          state: 'executing', disposition: 'current_work', workId: event.workId,
          revision: event.revision, executionRunId: event.runId,
        });
        const work = works.get(event.workId); if (work) { work.revision = event.revision; work.status = 'active'; }
      }
      if (event.type === 'input_deferred_after_delivery') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input, {
          state: 'scheduled', disposition: 'deferred_after_delivery', schedule: 'after_current_delivery',
          workId: event.workId, baseRevision: event.baseRevision, revision: null,
          deferredByRunId: event.runId ?? null,
        });
      }
      if (event.type === 'input_forked_to_work' || event.type === 'input_resumed_on_work') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input, {
          state: 'classified', disposition: event.type === 'input_forked_to_work'
            ? 'independent_work' : 'resumed_work', schedule: 'independent_work',
          workId: event.workId, revision: event.revision,
        });
        const work = works.get(event.workId); if (work) { work.revision = event.revision; work.status = 'active'; }
      }
      if (event.type === 'input_cancelled_current_work') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input, {
          state: 'executing', disposition: 'cancelled_work', workId: event.workId,
          revision: event.revision, executionRunId: event.runId,
        });
        const work = works.get(event.workId); if (work) { work.revision = event.revision; work.status = 'cancelled'; }
      }
      if (event.type === 'input_classified') {
        const legacy = { steer: ['revise_current_work', 'within_current_work'],
          followup: ['extend_current_work', 'after_current_delivery'],
          new_work: ['start_independent_work', 'independent_work'],
          cancel: ['cancel_current_work', 'stop'] }[event.relation];
        const input = inputs.get(event.inputId); if (input) Object.assign(input,
          { state: 'classified', meaning: event.meaning ?? legacy?.[0],
            schedule: event.schedule ?? legacy?.[1], workId: event.workId, revision: event.revision });
        const work = works.get(event.workId); if (work) work.revision = event.revision;
      }
      if (event.type === 'input_scheduled_after_delivery') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input, {
          state: 'scheduled', meaning: event.meaning, schedule: 'after_current_delivery',
          workId: event.workId, baseRevision: event.baseRevision, revision: null,
          deferredByRunId: event.runId ?? null,
        });
      }
      if (event.type === 'input_schedule_activated') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input, {
          state: 'classified', revision: event.revision,
        });
        const work = works.get(event.workId); if (work) {
          work.revision = event.revision; work.status = 'active';
        }
      }
      if (event.type === 'input_execution_claimed') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input,
          { state: 'executing', executionRunId: event.runId });
      }
      if (event.type === 'input_executed') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input, {
          state: 'executed', surfaceReceipt: clone(event.surfaceReceipt ?? null),
        });
      }
      if (event.type === 'input_completed_pending_surface') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input, {
          state: 'completed_pending_surface', completionRunId: event.runId,
          resultPointer: event.resultPointer, resultDigest: event.resultDigest,
        });
      }
      if (event.type === 'work_settled') {
        const work = works.get(event.workId); if (work) work.status = event.outcome === 'achieved'
          ? 'completed' : event.outcome === 'cancelled' ? 'cancelled' : 'active';
      }
      if (event.type === 'work_status_changed') {
        const work = works.get(event.workId); if (work) work.status = event.status;
      }
      if (event.type === 'execution_claimed') claims.set(event.runId,
        { runId: event.runId, workId: event.workId, revision: event.revision, state: 'active' });
      if (event.type === 'execution_released') {
        const claim = claims.get(event.runId);
        if (claim) Object.assign(claim, { state: 'released', reason: event.reason });
      }
      if (event.type === 'completion_proposed') proposals.set(event.runId, {
        runId: event.runId, workId: event.workId, revision: event.revision,
        proposedOutcome: event.proposedOutcome, verifiedOutcome: event.verifiedOutcome,
        blockerDigest: event.blockerDigest ?? null, blockers: event.blockers ?? [],
      });
      if (event.type === 'completion_verified') {
        const proposal = proposals.get(event.runId); if (proposal) Object.assign(proposal,
          { verifiedOutcome: event.verifiedOutcome, blockerDigest: event.blockerDigest,
            blockers: event.blockers ?? [] });
      }
      if (event.type === 'result_ready_pending_surface') results.set(event.runId, {
        runId: event.runId, sessionId: event.sessionId, workId: event.workId ?? null,
        revision: event.revision ?? null, objectiveOutcome: event.objectiveOutcome,
        resultDigest: event.resultDigest, surfaceResult: clone(event.surfaceResult),
        state: 'pending_surface', delivery: null,
      });
      if (event.type === 'result_surface_persisted') {
        const result = results.get(event.runId); if (result) result.state = 'surface_persisted';
      }
      if (event.type === 'result_delivery_started') {
        const result = results.get(event.runId); if (result) {
          result.state = 'delivery_started'; result.delivery = clone(event.delivery);
        }
      }
      if (event.type === 'result_delivery_terminal') {
        const result = results.get(event.runId); if (result) {
          result.state = 'delivery_terminal'; result.delivery = clone(event.delivery);
        }
      }
    }
    return { events: clone(events), works: clone([...works.values()]), inputs: clone([...inputs.values()]),
      claims: clone([...claims.values()]), proposals: clone([...proposals.values()]),
      results: clone([...results.values()]) };
  }
  async create({ sessionId, sourceMessageId }) {
    const workId = this.makeId(); await this.append('work_created', { workId, sessionId, sourceMessageId });
    return { workId, revision: 1, status: 'active' };
  }
  async activeForSession(sessionId) {
    const state = await this.read();
    return state.works.filter((work) => work.sessionId === sessionId && work.status === 'active').at(-1) ?? null;
  }
  async latestForSession(sessionId) {
    const state = await this.read(); return state.works.filter((work) => work.sessionId === sessionId).at(-1) ?? null;
  }
  async pendingInputs(sessionId) {
    const state = await this.read(); return state.inputs.filter((input) => (
      input.sessionId === sessionId && ['admitted', 'presented'].includes(input.state)
    ));
  }
  async presentInputs({ sessionId, workId, revision, runId }) {
    const state = await this.read(); const inputs = state.inputs.filter((input) => (
      input.sessionId === sessionId && input.state === 'admitted'
    ));
    for (const input of inputs) await this.append('input_presented', {
      inputId: input.inputId, sessionId, workId, revision, runId,
    });
    return (await this.read()).inputs.filter((input) => input.sessionId === sessionId
      && input.state === 'presented' && input.presentedRunId === runId);
  }
  async applyPresentedToCurrentWork({ sessionId, workId, runId, excludeInputIds = [] }) {
    const excluded = new Set(excludeInputIds.map(String)); const state = await this.read();
    const inputs = state.inputs.filter((item) => item.sessionId === sessionId
      && item.state === 'presented' && item.presentedRunId === runId && !excluded.has(item.inputId));
    if (!inputs.length) return [];
    const work = state.works.find((item) => item.workId === workId);
    if (!work || work.status !== 'active') throw new Error('active work not found');
    const revision = work.revision + 1; const applied = [];
    for (const input of inputs) {
      await this.append('input_applied_to_current_work', { inputId: input.inputId,
        workId, baseRevision: work.revision, revision, runId });
      applied.push({ inputId: input.inputId, revision });
    }
    await this.claimExecution({ workId, revision, runId });
    return applied;
  }
  async presentedInputs(sessionId, runId) {
    return (await this.read()).inputs.filter((input) => input.sessionId === sessionId
      && input.state === 'presented' && input.presentedRunId === runId);
  }
  async deferPresentedAfterDelivery({ inputId, workId, runId }) {
    return (await this.deferPresentedBatchAfterDelivery({ inputIds: [inputId], workId, runId }))[0];
  }
  async deferPresentedBatchAfterDelivery({ inputIds, workId, runId }) {
    const wanted = new Set(inputIds.map(String)); const state = await this.read();
    const inputs = state.inputs.filter((item) => wanted.has(item.inputId));
    const work = state.works.find((item) => item.workId === workId);
    if (!inputs.length || inputs.length !== wanted.size || inputs.some((input) => input.state !== 'presented'
      || input.presentedRunId !== runId)) throw new Error('input is not presented');
    if (!work || work.status !== 'active' || inputs.some((input) => work.revision !== input.baseRevision)) {
      throw new Error('stale work revision');
    }
    const deferred = [];
    for (const input of inputs) {
      await this.append('input_deferred_after_delivery', {
        inputId: input.inputId, workId, baseRevision: work.revision, runId });
      deferred.push({ inputId: input.inputId, workId, baseRevision: work.revision, state: 'scheduled' });
    }
    return deferred;
  }
  async forkPresentedToNewWork({ inputId, currentWorkId, runId, currentWorkDisposition = 'pause' }) {
    const result = await this.forkPresentedBatchToNewWork({ inputIds: [inputId], currentWorkId,
      runId, currentWorkDisposition }); return result.inputs[0];
  }
  async forkPresentedBatchToNewWork({ inputIds, currentWorkId, runId,
    currentWorkDisposition = 'pause' }) {
    const wanted = new Set(inputIds.map(String)); const state = await this.read();
    const inputs = state.inputs.filter((item) => wanted.has(item.inputId));
    const current = state.works.find((item) => item.workId === currentWorkId);
    if (!inputs.length || inputs.length !== wanted.size || inputs.some((input) => input.state !== 'presented'
      || input.presentedRunId !== runId)) throw new Error('input is not presented');
    if (!current || current.status !== 'active') throw new Error('active work not found');
    await this.setStatus({ workId: current.workId, expectedRevision: current.revision,
      status: currentWorkDisposition === 'cancel' ? 'cancelled' : 'paused' });
    const next = await this.create({ sessionId: inputs[0].sessionId, sourceMessageId: inputs[0].messageId });
    const forked = [];
    for (const input of inputs) {
      await this.append('input_forked_to_work', { inputId: input.inputId, previousWorkId: current.workId,
        currentWorkDisposition, workId: next.workId, revision: next.revision, runId });
      forked.push({ inputId: input.inputId, workId: next.workId, revision: next.revision, state: 'classified' });
    }
    return { workId: next.workId, inputs: forked };
  }
  async cancelPresentedWork({ inputId, workId, runId }) {
    const result = await this.cancelPresentedBatchWork({ inputIds: [inputId], workId, runId });
    return result.inputs[0];
  }
  async cancelPresentedBatchWork({ inputIds, workId, runId }) {
    const wanted = new Set(inputIds.map(String)); const state = await this.read();
    const inputs = state.inputs.filter((item) => wanted.has(item.inputId));
    const work = state.works.find((item) => item.workId === workId);
    if (!inputs.length || inputs.length !== wanted.size || inputs.some((input) => input.state !== 'presented'
      || input.presentedRunId !== runId)) throw new Error('input is not presented');
    if (!work || work.status !== 'active') throw new Error('active work not found');
    const revision = work.revision + 1;
    for (const input of inputs) await this.append('input_cancelled_current_work', {
      inputId: input.inputId, workId, revision, runId });
    await this.claimExecution({ workId, revision, runId });
    await this.append('work_settled', { workId, revision, outcome: 'cancelled', runId });
    return { workId, revision, inputs: inputs.map((input) => ({
      inputId: input.inputId, workId, revision, state: 'executing' })) };
  }
  async resumePresentedOnPausedWork({ inputId, currentWorkId, targetWorkId, runId,
    currentWorkDisposition = 'pause' }) {
    const result = await this.resumePresentedBatchOnPausedWork({ inputIds: [inputId], currentWorkId,
      targetWorkId, runId, currentWorkDisposition }); return result.inputs[0];
  }
  async resumePresentedBatchOnPausedWork({ inputIds, currentWorkId, targetWorkId, runId,
    currentWorkDisposition = 'pause' }) {
    const wanted = new Set(inputIds.map(String)); const state = await this.read();
    const inputs = state.inputs.filter((item) => wanted.has(item.inputId));
    const current = state.works.find((item) => item.workId === currentWorkId);
    const target = state.works.find((item) => item.workId === targetWorkId);
    if (!inputs.length || inputs.length !== wanted.size || inputs.some((input) => input.state !== 'presented'
      || input.presentedRunId !== runId)) throw new Error('input is not presented');
    if (!current || current.status !== 'active' || !target || target.status !== 'paused') {
      throw new Error('work resume target is unavailable');
    }
    await this.setStatus({ workId: current.workId, expectedRevision: current.revision,
      status: currentWorkDisposition === 'cancel' ? 'cancelled' : 'paused' });
    await this.setStatus({ workId: target.workId, expectedRevision: target.revision, status: 'active' });
    const revision = target.revision + 1;
    const resumed = [];
    for (const input of inputs) {
      await this.append('input_resumed_on_work', { inputId: input.inputId, previousWorkId: current.workId,
        currentWorkDisposition, workId: target.workId, revision, runId });
      resumed.push({ inputId: input.inputId, workId: target.workId, revision, state: 'classified' });
    }
    return { workId: target.workId, revision, inputs: resumed };
  }
  async queuedInputs(sessionId) {
    const state = await this.read(); return state.inputs.filter((input) => (
      input.sessionId === sessionId && ((input.state === 'scheduled' && input.schedule === 'after_current_delivery')
        || (input.state === 'classified' && input.schedule === 'independent_work'))
    ));
  }
  async prepareInputAdmission({ sessionId, messageId, origin = 'console', attachmentIds = [], source = {} }) {
    const inputId = this.makeId(); await this.append('input_admission_prepared', {
      inputId, sessionId, messageId, origin, attachmentIds: [...attachmentIds].map(String), source,
    });
    return { inputId, state: 'prepared' };
  }
  async commitInputAdmission(inputId) {
    const state = await this.read(); const input = state.inputs.find((item) => item.inputId === inputId);
    if (!input || input.state !== 'prepared') throw new Error('work input admission is not prepared');
    await this.append('input_admitted', { inputId });
    return { inputId, state: 'admitted' };
  }
  async abortInputAdmission(inputId, reason = 'admission_failed') {
    const state = await this.read(); const input = state.inputs.find((item) => item.inputId === inputId);
    if (!input || input.state === 'aborted') return { inputId, state: 'aborted' };
    if (input.state !== 'prepared') throw new Error('committed work input cannot be aborted');
    await this.append('input_admission_aborted', { inputId, reason });
    return { inputId, state: 'aborted' };
  }
  async admitInput(fields) {
    const prepared = await this.prepareInputAdmission(fields);
    return this.commitInputAdmission(prepared.inputId);
  }
  async activateScheduledInput(inputId) {
    const state = await this.read(); const input = state.inputs.find((item) => item.inputId === String(inputId));
    if (!input || input.state !== 'scheduled' || input.schedule !== 'after_current_delivery') {
      throw new Error('work input is not scheduled after delivery');
    }
    const work = state.works.find((item) => item.workId === input.workId);
    if (!work || work.revision !== input.baseRevision) throw new Error('stale scheduled work revision');
    const revision = input.baseRevision + 1;
    await this.append('input_schedule_activated', { inputId: input.inputId,
      workId: input.workId, baseRevision: input.baseRevision, revision });
    return { ...input, state: 'classified', revision };
  }
  async proposeCompletion({ workId, revision, runId, proposedOutcome = 'unresolved',
    verifiedOutcome = 'unresolved', blockerDigest = null, blockers = [] }) {
    const state = await this.read(); const work = state.works.find((item) => item.workId === workId);
    if (!work || work.revision !== revision) throw new Error('stale work revision');
    const claim = state.claims.find((item) => item.runId === runId);
    if (!claim || claim.state !== 'active' || claim.workId !== workId || claim.revision !== revision) {
      throw new Error('work execution claim mismatch');
    }
    return this.append('completion_proposed', { workId, revision, runId, proposedOutcome, verifiedOutcome,
      blockerDigest, blockers });
  }
  async verifyCompletion({ workId, revision, runId, verifiedOutcome, blockerDigest, blockers = [] }) {
    const state = await this.read(); const proposal = state.proposals.find((item) => item.runId === runId);
    if (!proposal || proposal.workId !== workId || proposal.revision !== revision) {
      throw new Error('completion proposal mismatch');
    }
    return this.append('completion_verified', { workId, revision, runId, verifiedOutcome,
      blockerDigest, blockers });
  }
  async settle({ workId, revision, outcome, runId }) {
    if (!OUTCOMES.has(outcome)) throw new TypeError('invalid work outcome');
    const state = await this.read(); const work = state.works.find((item) => item.workId === workId);
    if (!work || work.revision !== revision) throw new Error('stale work revision');
    const claim = state.claims.filter((item) => item.runId === runId).at(-1);
    if (!claim || claim.state !== 'active' || claim.workId !== workId || claim.revision !== revision) {
      throw new Error('work execution claim mismatch');
    }
    return this.append('work_settled', { workId, revision, outcome, runId });
  }
  async setStatus({ workId, expectedRevision, status }) {
    if (!['active', 'paused', 'cancelled'].includes(status)) throw new TypeError('invalid work status');
    const state = await this.read(); const work = state.works.find((item) => item.workId === workId);
    if (!work || work.revision !== expectedRevision) throw new Error('stale work revision');
    await this.append('work_status_changed', { workId, revision: expectedRevision, status });
    return { workId, revision: expectedRevision, status };
  }
  async claimExecution({ workId, revision, runId }) {
    const state = await this.read(); const work = state.works.find((item) => item.workId === workId);
    if (!work || work.revision !== revision) throw new Error('stale work revision');
    const existing = state.claims.find((item) => item.runId === runId && item.state === 'active');
    if (existing) {
      if (existing.workId !== workId) throw new Error('work execution claim mismatch');
      if (existing.revision === revision) return existing;
    }
    const owner = state.claims.find((item) => item.state === 'active' && item.workId === workId
      && item.revision === revision
      && !state.events.some((event) => event.type === 'work_settled' && event.runId === item.runId));
    if (owner && owner.runId !== runId) throw new Error('work revision execution already claimed');
    await this.append('execution_claimed', { workId, revision, runId });
    return { workId, revision, runId };
  }
  async releaseExecution({ runId, reason = 'run_failed' }) {
    const state = await this.read();
    const claim = state.claims.find((item) => item.runId === runId && item.state === 'active');
    if (!claim || state.events.some((event) => event.type === 'work_settled' && event.runId === runId)) {
      return { runId, released: false };
    }
    await this.append('execution_released', { runId, workId: claim.workId,
      revision: claim.revision, reason: String(reason).slice(0, 120) });
    return { ...claim, state: 'released', reason: String(reason).slice(0, 120), released: true };
  }
  async workForRun(runId) {
    const state = await this.read(); const claim = state.claims.filter((item) => item.runId === runId).at(-1);
    return claim ? { ...state.works.find((work) => work.workId === claim.workId), claimedRevision: claim.revision } : null;
  }
  async proposalForRun(runId) { return (await this.read()).proposals.find((item) => item.runId === runId) ?? null; }
  async claimInputExecution({ inputId, runId }) {
    const state = await this.read(); const input = state.inputs.find((item) => item.inputId === inputId);
    if (!input || input.state !== 'classified') throw new Error('work input is not queued');
    await this.append('input_execution_claimed', { inputId, runId }); return { inputId, runId };
  }
  async completeInputExecution({ inputId, runId }) {
    throw new Error('completeInputExecution requires pending-surface prepare and commit');
  }
  async prepareInputCompletion({ inputId, runId, resultPointer, resultDigest }) {
    const state = await this.read(); const input = state.inputs.find((item) => item.inputId === inputId);
    if (!input || input.state !== 'executing' || input.executionRunId !== runId) {
      throw new Error('work input execution claim mismatch');
    }
    if (!String(resultPointer ?? '').trim() || !String(resultDigest ?? '').trim()) {
      throw new TypeError('input completion result pointer and digest are required');
    }
    await this.append('input_completed_pending_surface', { inputId, runId,
      resultPointer: String(resultPointer), resultDigest: String(resultDigest) });
    return { inputId, state: 'completed_pending_surface', runId,
      resultPointer: String(resultPointer), resultDigest: String(resultDigest) };
  }
  async commitInputExecuted({ inputId, runId, surfaceReceipt }) {
    const state = await this.read(); const input = state.inputs.find((item) => item.inputId === inputId);
    if (!input || input.state !== 'completed_pending_surface' || input.completionRunId !== runId) {
      throw new Error('input completion is not pending surface');
    }
    if (!surfaceReceipt || surfaceReceipt.surface !== 'console_session'
      || surfaceReceipt.sessionId !== input.sessionId || surfaceReceipt.runId !== runId
      || surfaceReceipt.resultDigest !== input.resultDigest) {
      throw new Error('exact input surface receipt is required');
    }
    await this.append('input_executed', { inputId, runId, surfaceReceipt });
    return { inputId, state: 'executed', surfaceReceipt: clone(surfaceReceipt) };
  }
  async executingInputsForRun(runId) {
    const state = await this.read(); return state.inputs.filter((input) => (
      input.state === 'executing' && input.executionRunId === runId
    ));
  }
  async pendingSurfaceInputsForRun(runId) {
    return (await this.read()).inputs.filter((input) => input.state === 'completed_pending_surface'
      && input.completionRunId === runId);
  }
  async recordResultReady({ runId, sessionId, workId = null, revision = null,
    objectiveOutcome = 'unresolved', resultDigest, surfaceResult }) {
    const state = await this.read(); const existing = state.results.find((item) => item.runId === runId);
    if (existing) {
      if (existing.resultDigest !== resultDigest) throw new Error('result ready digest mismatch');
      return existing;
    }
    await this.append('result_ready_pending_surface', { runId, sessionId, workId, revision,
      objectiveOutcome, resultDigest, surfaceResult });
    return (await this.read()).results.find((item) => item.runId === runId);
  }
  async markResultSurfacePersisted(runId) {
    const state = await this.read(); const result = state.results.find((item) => item.runId === runId);
    if (!result) throw new Error('result ready state missing');
    if (['surface_persisted', 'delivery_terminal'].includes(result.state)) return result;
    await this.append('result_surface_persisted', { runId });
    return (await this.read()).results.find((item) => item.runId === runId);
  }
  async markResultDeliveryTerminal(runId, delivery) {
    const state = await this.read(); const result = state.results.find((item) => item.runId === runId);
    if (!result || result.state === 'pending_surface') throw new Error('surface is not persisted');
    if (result.state === 'delivery_terminal') return result;
    await this.append('result_delivery_terminal', { runId, delivery });
    return (await this.read()).results.find((item) => item.runId === runId);
  }
  async markResultDeliveryStarted(runId, delivery) {
    const state = await this.read(); const result = state.results.find((item) => item.runId === runId);
    if (!result || result.state !== 'surface_persisted') throw new Error('surface is not ready for delivery');
    await this.append('result_delivery_started', { runId, delivery });
    return (await this.read()).results.find((item) => item.runId === runId);
  }
  async pendingSurfaceResults() {
    return (await this.read()).results.filter((item) => item.state === 'pending_surface');
  }
}
