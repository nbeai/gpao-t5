import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function clone(value) { return value == null ? value : structuredClone(value); }

function sessionOrigin(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('session origin must be an object');
  }
  const channel = String(value.channel ?? '').trim();
  const chatId = String(value.chatId ?? '').trim();
  if (!channel || !chatId) throw new TypeError('session origin requires channel and chatId');
  return { channel, chatId };
}

function continuationSource(value) {
  if (value == null) return null;
  const id = String(value);
  if (!/^[0-9a-f-]{36}$/iu.test(id)) throw new TypeError('continuation source must be a session id');
  return id;
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
      if (state?.version === 1 && Array.isArray(state.sessions)) return state;
      throw new Error('unsupported console session state');
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, nextOrder: 1, sessions: [] };
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

  async create({ origin = null, continuationOf = null } = {}) {
    return this.serialize(async () => {
      const state = await this.read();
      const now = Date.now();
      const session = {
        id: randomUUID(), title: '새 대화', manualTitle: false,
        createdAt: now, updatedAt: now, order: state.nextOrder++, transcript: [], pinned: false,
        origin: sessionOrigin(origin),
        continuationOf: continuationSource(continuationOf),
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
      if (deleted) return Boolean(session.deletedAt);
      if (archived) return Boolean(session.archivedAt) && !session.deletedAt;
      return !session.archivedAt && !session.deletedAt;
    }).sort((left, right) => (right.updatedAt - left.updatedAt) || (right.order - left.order))
      .map((session) => {
        const lastAssistant = [...session.transcript].reverse()
          .find((entry) => entry?.role === 'assistant');
        return {
          id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt,
          pinned: Boolean(session.pinned), archivedAt: session.archivedAt ?? null,
          deletedAt: session.deletedAt ?? null, turns: session.transcript.length,
          origin: clone(session.origin ?? null),
          continuationOf: session.continuationOf ?? null,
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
      if (typeof fields.pinned === 'boolean') session.pinned = fields.pinned;
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
}
