import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BULK_SESSIONS = 100;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BULK_ACTIONS = new Set(['archive', 'delete', 'restore']);

function clone(value) { return value == null ? value : structuredClone(value); }
export function isUserVisibleConsoleSession(session) { return session?.internal !== true; }
function groupName(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 40 || /[\u0000-\u001f\u007f]/u.test(text)) throw new TypeError('session group name is invalid');
  return text;
}
function groupId(value, { nullable = true } = {}) {
  if (value == null && nullable) return null;
  const id = String(value ?? ''); if (!SESSION_ID.test(id)) throw new TypeError('session group id is invalid'); return id;
}

function bulkTransitionInput(ids, action) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_BULK_SESSIONS) {
    throw new TypeError(`bulk session ids must contain between 1 and ${MAX_BULK_SESSIONS} items`);
  }
  if (!BULK_ACTIONS.has(action)) throw new TypeError('unsupported bulk session action');
  if (ids.some((id) => typeof id !== 'string' || !SESSION_ID.test(id))) {
    throw new TypeError('bulk session id is invalid');
  }
  if (new Set(ids).size !== ids.length) throw new TypeError('bulk session ids must be unique');
  return { ids: [...ids], action };
}

function sessionOrigin(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('session origin must be an object');
  }
  const channel = String(value.channel ?? value.provider ?? '').trim();
  const chatId = String(value.chatId ?? '').trim();
  if (!channel || !chatId) throw new TypeError('session origin requires channel and chatId');
  const result = { channel, chatId };
  if (value.threadId != null) result.threadId = String(value.threadId);
  if (value.senderId != null || value.userId != null) result.senderId = String(value.senderId ?? value.userId);
  if (value.sourceMessageId != null || value.messageId != null) {
    result.sourceMessageId = String(value.sourceMessageId ?? value.messageId);
  }
  if (value.replyIdentity != null || value.replyTo != null) {
    result.replyIdentity = clone(value.replyIdentity ?? value.replyTo);
  }
  return result;
}

function continuationSource(value) {
  if (value == null) return null;
  const id = String(value);
  if (!/^[0-9a-f-]{36}$/iu.test(id)) throw new TypeError('continuation source must be a session id');
  return id;
}

function modelConnection(value) {
  if (value == null) return null;
  const provider = String(value.provider ?? '').trim(); const modelId = String(value.modelId ?? '').trim();
  const wire = value.wire == null ? null : String(value.wire).trim();
  if (!provider || !modelId) throw new TypeError('model connection requires provider and modelId');
  return { provider, modelId, wire: wire || null };
}

export class ConsoleSessionStore {
  constructor(directory) {
    if (!directory) throw new TypeError('console state directory is required');
    this.directory = directory;
    this.file = join(directory, 'console-sessions.json');
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8'));
      if (state?.version === 1 && Array.isArray(state.sessions)) return { ...state,
        groups: Array.isArray(state.groups) ? state.groups : [] };
      throw new Error('unsupported console session state');
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, nextOrder: 1, sessions: [], groups: [] };
      throw error;
    }
  }

  async write(state) {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.file);
  }

  serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  async create({ origin = null, continuationOf = null, internal = false } = {}) {
    return this.serialize(async () => {
      const state = await this.read();
      const now = Date.now();
      const session = {
        id: randomUUID(), title: '새 대화', manualTitle: false,
        createdAt: now, updatedAt: now, order: state.nextOrder++, transcript: [], pinned: false,
        groupId: null,
        origin: sessionOrigin(origin),
        continuationOf: continuationSource(continuationOf),
        ...(internal === true ? { internal: true } : {}),
      };
      state.sessions.push(session);
      await this.write(state);
      return clone(session);
    });
  }

  async load(id) {
    const state = await this.read();
    return clone(state.sessions.find((session) => session.id === id) ?? null);
  }

  async list({ archived = false, deleted = false } = {}) {
    const state = await this.read();
    return state.sessions.filter((session) => {
      if (!isUserVisibleConsoleSession(session)) return false;
      if (deleted) return Boolean(session.deletedAt);
      if (archived) return Boolean(session.archivedAt) && !session.deletedAt;
      return !session.archivedAt && !session.deletedAt;
    }).sort((left, right) => (right.updatedAt - left.updatedAt) || (right.order - left.order))
      .map((session) => {
        const lastAssistant = [...session.transcript].reverse()
          .find((entry) => entry?.role === 'assistant');
        return {
          id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt,
          pinned: Boolean(session.pinned), pinnedAt: session.pinnedAt ?? null, archivedAt: session.archivedAt ?? null,
          groupId: session.groupId ?? null,
          deletedAt: session.deletedAt ?? null, turns: session.transcript.length,
          origin: clone(session.origin ?? null),
          continuationOf: session.continuationOf ?? null,
          lastModelConnection: clone(session.lastModelConnection ?? null),
          lastResultKind: lastAssistant?.result?.kind ?? null,
        };
      });
  }

  async append(id, entry) {
    return this.serialize(async () => {
      const state = await this.read();
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (!session) return null;
      session.transcript.push(clone(entry));
      session.updatedAt = Date.now();
      if (entry?.role === 'user' && !session.manualTitle && session.title === '새 대화') {
        session.title = String(entry.text ?? '').trim().slice(0, 48) || '새 대화';
      }
      await this.write(state);
      return clone(session);
    });
  }

  async updateMeta(id, fields = {}) {
    return this.serialize(async () => {
      const state = await this.read();
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (!session) return null;
      if (typeof fields.title === 'string' && fields.title.trim()) {
        session.title = fields.title.trim().slice(0, 80);
        session.manualTitle = true;
      }
      if (typeof fields.pinned === 'boolean') {
        session.pinned = fields.pinned;
        if (fields.pinned) session.pinnedAt ??= Date.now(); else delete session.pinnedAt;
      }
      if (Object.hasOwn(fields, 'groupId')) {
        const target = groupId(fields.groupId);
        if (target && !state.groups.some((group) => group.groupId === target)) throw new Error('session group not found');
        session.groupId = target;
      }
      if (fields.lastModelConnection !== undefined) {
        session.lastModelConnection = modelConnection(fields.lastModelConnection);
      }
      session.updatedAt = Date.now();
      await this.write(state);
      return clone(session);
    });
  }

  async setOrigin(id, origin) {
    const normalized = sessionOrigin(origin);
    return this.serialize(async () => {
      const state = await this.read();
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (!session) return null;
      if (!session.origin) {
        session.origin = normalized;
        await this.write(state);
      }
      return clone(session);
    });
  }

  async setArchived(id, archived = true) {
    return this.serialize(async () => {
      const state = await this.read();
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (!session) return null;
      if (archived) session.archivedAt = Date.now(); else delete session.archivedAt;
      session.updatedAt = Date.now();
      await this.write(state);
      return clone(session);
    });
  }

  async softDelete(id) {
    return this.serialize(async () => {
      const state = await this.read();
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (!session) return null;
      session.deletedAt = Date.now();
      delete session.archivedAt;
      session.updatedAt = Date.now();
      await this.write(state);
      return clone(session);
    });
  }

  async restore(id) {
    return this.serialize(async () => {
      const state = await this.read();
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (!session) return null;
      delete session.deletedAt;
      delete session.archivedAt;
      session.updatedAt = Date.now();
      await this.write(state);
      return clone(session);
    });
  }

  async bulkTransition({ ids, action } = {}) {
    const input = bulkTransitionInput(ids, action);
    return this.serialize(async () => {
      const state = await this.read();
      const byId = new Map(state.sessions.map((session) => [session.id, session]));
      const selected = input.ids.map((id) => byId.get(id));
      if (selected.some((session) => !session)) throw new Error('bulk session not found');

      const now = Date.now();
      const changed = [];
      for (const session of selected) {
        const before = `${session.archivedAt ?? ''}:${session.deletedAt ?? ''}`;
        if (input.action === 'archive') session.archivedAt ??= now;
        if (input.action === 'delete') {
          session.deletedAt ??= now;
          delete session.archivedAt;
        }
        if (input.action === 'restore') {
          delete session.deletedAt;
          delete session.archivedAt;
        }
        const after = `${session.archivedAt ?? ''}:${session.deletedAt ?? ''}`;
        if (before !== after) {
          session.updatedAt = now;
          changed.push(clone(session));
        }
      }
      if (changed.length) await this.write(state);
      return { action: input.action, count: changed.length, sessions: changed };
    });
  }

  async listGroups() {
    const state = await this.read(); return state.groups.toSorted((left, right) => left.order - right.order)
      .map((group) => clone(group));
  }

  async createGroup(name) {
    return this.serialize(async () => {
      const state = await this.read(); const displayName = groupName(name);
      if (state.groups.some((group) => group.displayName.toLocaleLowerCase() === displayName.toLocaleLowerCase())) {
        throw new Error('session group already exists');
      }
      const group = { groupId: randomUUID(), displayName,
        order: state.groups.reduce((max, item) => Math.max(max, item.order), 0) + 1 };
      state.groups.push(group); await this.write(state); return clone(group);
    });
  }

  async deleteGroup(value) {
    return this.serialize(async () => {
      const state = await this.read(); const id = groupId(value, { nullable: false });
      const index = state.groups.findIndex((group) => group.groupId === id);
      if (index < 0) throw new Error('session group not found');
      state.groups.splice(index, 1); let moved = 0;
      for (const session of state.sessions) if (session.groupId === id) { session.groupId = null; moved += 1; }
      await this.write(state); return { groupId: id, moved };
    });
  }

  async assignGroup({ ids, groupId: value }) {
    const normalized = bulkTransitionInput(ids, 'archive').ids; const target = groupId(value);
    return this.serialize(async () => {
      const state = await this.read();
      if (target && !state.groups.some((group) => group.groupId === target)) throw new Error('session group not found');
      const selected = normalized.map((id) => state.sessions.find((session) => session.id === id));
      if (selected.some((session) => !session || session.deletedAt)) throw new Error('session group target not found');
      let changed = 0; const now = Date.now();
      for (const session of selected) if ((session.groupId ?? null) !== target) {
        session.groupId = target; session.updatedAt = now; changed += 1;
      }
      if (changed) await this.write(state); return { groupId: target, count: changed };
    });
  }
}
