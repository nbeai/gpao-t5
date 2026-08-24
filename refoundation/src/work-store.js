import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = 't5.work-event.v1';
const RELATIONS = new Set(['steer', 'followup', 'new_work', 'cancel']);
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
    const proposals = new Map();
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
      if (event.type === 'input_classified') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input,
          { state: 'classified', relation: event.relation, workId: event.workId, revision: event.revision });
        const work = works.get(event.workId); if (work) work.revision = event.revision;
      }
      if (event.type === 'input_execution_claimed') {
        const input = inputs.get(event.inputId); if (input) Object.assign(input,
          { state: 'executing', executionRunId: event.runId });
      }
      if (event.type === 'input_executed') {
        const input = inputs.get(event.inputId); if (input) input.state = 'executed';
      }
      if (event.type === 'work_settled') {
        const work = works.get(event.workId); if (work) work.status = event.outcome === 'achieved'
          ? 'completed' : event.outcome === 'cancelled' ? 'cancelled' : 'active';
      }
      if (event.type === 'work_status_changed') {
        const work = works.get(event.workId); if (work) work.status = event.status;
      }
      if (event.type === 'execution_claimed') claims.set(event.runId,
        { runId: event.runId, workId: event.workId, revision: event.revision });
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
    }
    return { events: clone(events), works: clone([...works.values()]), inputs: clone([...inputs.values()]),
      claims: clone([...claims.values()]), proposals: clone([...proposals.values()]) };
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
      input.sessionId === sessionId && input.state === 'admitted'
    ));
  }
  async queuedInputs(sessionId) {
    const state = await this.read(); return state.inputs.filter((input) => (
      input.sessionId === sessionId && input.state === 'classified'
      && ['followup', 'new_work'].includes(input.relation)
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
  async classifyInput({ inputId, relation, workId, expectedRevision }) {
    if (!RELATIONS.has(relation)) throw new TypeError('invalid work relation');
    const state = await this.read(); const input = state.inputs.find((item) => item.inputId === inputId);
    const work = state.works.find((item) => item.workId === workId);
    if (!input || input.state !== 'admitted') throw new Error('work input is not pending');
    if (!work || work.revision !== expectedRevision) throw new Error('stale work revision');
    const revision = work.revision + 1;
    await this.append('input_classified', { inputId, relation, workId, revision, expectedRevision });
    return { workId, revision, relation };
  }
  async proposeCompletion({ workId, revision, runId, proposedOutcome = 'unresolved',
    verifiedOutcome = 'unresolved', blockerDigest = null, blockers = [] }) {
    const state = await this.read(); const work = state.works.find((item) => item.workId === workId);
    if (!work || work.revision !== revision) throw new Error('stale work revision');
    const claim = state.claims.find((item) => item.runId === runId);
    if (!claim || claim.workId !== workId || claim.revision !== revision) throw new Error('work execution claim mismatch');
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
    if (!claim || claim.workId !== workId || claim.revision !== revision) {
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
    const existing = state.claims.find((item) => item.runId === runId);
    if (existing) {
      if (existing.workId !== workId) throw new Error('work execution claim mismatch');
      if (existing.revision === revision) return existing;
    }
    const owner = state.claims.find((item) => item.workId === workId && item.revision === revision
      && !state.events.some((event) => event.type === 'work_settled' && event.runId === item.runId));
    if (owner && owner.runId !== runId) throw new Error('work revision execution already claimed');
    await this.append('execution_claimed', { workId, revision, runId });
    return { workId, revision, runId };
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
    const state = await this.read(); const input = state.inputs.find((item) => item.inputId === inputId);
    if (!input || input.state !== 'executing' || input.executionRunId !== runId) {
      throw new Error('work input execution claim mismatch');
    }
    await this.append('input_executed', { inputId, runId }); return { inputId, state: 'executed' };
  }
}
