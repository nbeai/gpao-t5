import { createHash, randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function bindableArgs(args = {}) {
  const cloned = structuredClone(args);
  if (cloned.effect) cloned.effect.approvalToken = null;
  return cloned;
}

function callDigest(toolName, args) {
  return createHash('sha256').update(JSON.stringify(canonical({
    toolName, args: bindableArgs(args),
  }))).digest('hex');
}

function safeId(pendingId) {
  const value = String(pendingId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw Object.assign(new Error('approval not found'), { status: 404 });
  return value;
}

export function boundaryForEffect(effect = {}, { requiredEffect = null } = {}) {
  if (effect.kind === 'secret_input') return 'secret_input';
  if (requiredEffect === 'destructive') return 'approval';
  if (effect.kind === 'payment') return 'approval';
  if (effect.kind === 'destructive' && effect.backupAvailable !== true) return 'approval';
  if (effect.kind === 'external_send' && effect.recipientNew === true) return 'approval';
  return null;
}

export function effectDeclarationMismatch(command, effect = {}) {
  const text = String(command ?? '');
  const destructive = /(?:^|[;&|]\s*)\s*(?:rm|rmdir|shred|unlink)\b/.test(text)
    || /\bfind\b[^\n]*\s-delete(?:\s|$)/.test(text);
  if (destructive && effect.kind !== 'destructive') return 'destructive_required';
  const externalSend = /\bcurl\b[^\n]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--request\s+(?:POST|PUT|PATCH|DELETE)|--data(?:-raw|-binary|-urlencode)?\b|-d(?:\s|$))/i.test(text)
    || /\b(?:scp|sftp|rsync)\b/.test(text);
  if (externalSend && effect.kind !== 'external_send' && effect.kind !== 'payment') return 'external_send_required';
  return null;
}

export class AuthorityStore {
  constructor(directory) {
    if (!directory) throw new TypeError('authority directory is required');
    this.directory = directory;
    this.queues = new Map();
  }

  file(pendingId) { return join(this.directory, `${safeId(pendingId)}.jsonl`); }

  serialize(pendingId, work) {
    const previous = this.queues.get(pendingId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.queues.set(pendingId, next.catch(() => {}));
    return next;
  }

  async append(pendingId, event) {
    const current = await this.read(pendingId);
    const envelope = {
      schema: 't5.authority-event.v1', pendingId,
      sequence: current.events.length + 1,
      recordedAt: new Date().toISOString(),
      ...structuredClone(event),
    };
    await appendFile(this.file(pendingId), `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', mode: 0o600 });
    return envelope;
  }

  async propose({ sessionId, toolName, args }) {
    if (!sessionId || !toolName || !args) throw new TypeError('sessionId, toolName, and args are required');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const pendingId = randomUUID();
    const file = this.file(pendingId);
    const handle = await open(file, 'ax', 0o600);
    await handle.close();
    await chmod(file, 0o600);
    const proposedArgs = bindableArgs(args);
    const event = {
      schema: 't5.authority-event.v1', pendingId, sequence: 1,
      recordedAt: new Date().toISOString(), type: 'proposed',
      payload: {
        sessionId: String(sessionId), toolName: String(toolName), args: proposedArgs,
        callDigest: callDigest(toolName, proposedArgs),
      },
    };
    await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { pendingId, file, status: 'pending', sessionId, toolName, args: proposedArgs };
  }

  async read(pendingId) {
    const id = safeId(pendingId);
    let text;
    try { text = await readFile(this.file(id), 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') throw Object.assign(new Error('approval not found'), { status: 404 });
      throw error;
    }
    const events = text.split('\n').filter(Boolean).map(JSON.parse);
    if (!events.length || events[0].type !== 'proposed') throw new Error('invalid authority ledger');
    const latest = events.at(-1).type;
    const status = latest === 'proposed' ? 'pending' : latest;
    return {
      pendingId: id,
      sessionId: events[0].payload.sessionId,
      toolName: events[0].payload.toolName,
      args: events[0].payload.args,
      callDigest: events[0].payload.callDigest,
      status,
      events,
    };
  }

  approve(pendingId) {
    const id = safeId(pendingId);
    return this.serialize(id, async () => {
      const current = await this.read(id);
      if (current.status !== 'pending') throw new Error(`approval is ${current.status}`);
      await this.append(id, { type: 'approved', payload: {} });
      return this.read(id);
    });
  }

  reject(pendingId) {
    const id = safeId(pendingId);
    return this.serialize(id, async () => {
      const current = await this.read(id);
      if (current.status !== 'pending') throw new Error(`approval is ${current.status}`);
      await this.append(id, { type: 'rejected', payload: {} });
      return this.read(id);
    });
  }

  consume(pendingId, { toolName, args }) {
    const id = safeId(pendingId);
    return this.serialize(id, async () => {
      const current = await this.read(id);
      if (current.status === 'rejected') return { allowed: false, reason: 'rejected' };
      if (current.status === 'consumed') return { allowed: false, reason: 'already_consumed' };
      if (current.status !== 'approved') return { allowed: false, reason: 'not_approved' };
      if (current.callDigest !== callDigest(toolName, args)) return { allowed: false, reason: 'call_mismatch' };
      await this.append(id, { type: 'consumed', payload: { callDigest: current.callDigest } });
      return { allowed: true, proposal: current };
    });
  }

  async listActive(sessionId) {
    let names;
    try { names = await readdir(this.directory); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    const out = [];
    for (const name of names.filter((entry) => /^[0-9a-f-]{36}\.jsonl$/i.test(entry))) {
      const item = await this.read(name.slice(0, -'.jsonl'.length));
      if (item.sessionId === sessionId && (item.status === 'pending' || item.status === 'approved')) out.push(item);
    }
    return out;
  }

  async findActiveCall(sessionId, toolName, args) {
    const digest = callDigest(toolName, args);
    return (await this.listActive(sessionId)).find((item) => item.callDigest === digest) ?? null;
  }

  async withdrawActive(sessionId, reason = 'session_recovered') {
    const active = await this.listActive(sessionId);
    for (const item of active) {
      await this.serialize(item.pendingId, async () => {
        const current = await this.read(item.pendingId);
        if (current.status !== 'pending' && current.status !== 'approved') return;
        await this.append(item.pendingId, { type: 'withdrawn', payload: { reason: String(reason) } });
      });
    }
    return active.map((item) => item.pendingId);
  }
}
