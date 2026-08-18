import { appendFile, chmod, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = 't5.conversation-event.v1';

function clone(value) { return value == null ? value : structuredClone(value); }

function safeSessionId(sessionId) {
  const value = String(sessionId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw Object.assign(new Error('conversation not found'), { status: 404 });
  return value;
}

function validMessage(message) {
  if (!message || !['user', 'assistant', 'tool'].includes(message.role)) return false;
  if (typeof message.content !== 'string') return false;
  if (message.role === 'tool') {
    return Boolean(message.toolCallId && message.name);
  }
  if (message.role === 'assistant' && message.toolCalls !== undefined) {
    return Array.isArray(message.toolCalls) && message.toolCalls.every((call) => (
      call && call.id && call.name && call.args && typeof call.args === 'object' && !Array.isArray(call.args)
    ));
  }
  return true;
}

function parseEvents(text, sessionId) {
  const events = String(text ?? '').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (!events.length || events[0].type !== 'conversation_started') throw new Error('invalid conversation ledger');
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.schema !== SCHEMA || event.sessionId !== sessionId || event.sequence !== index + 1) {
      throw new Error('invalid conversation event sequence');
    }
    if (event.type === 'message' && (!event.messageId || !validMessage(event.message))) {
      throw new Error('invalid conversation message');
    }
  }
  return events;
}

export class ConversationLedger {
  constructor(directory) {
    if (!directory) throw new TypeError('conversation ledger directory is required');
    this.directory = directory;
    this.queue = Promise.resolve();
  }

  serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  file(sessionId) {
    return join(this.directory, `${safeSessionId(sessionId)}.jsonl`);
  }

  async ensure({ sessionId, legacyMessages = [] } = {}) {
    const id = safeSessionId(sessionId);
    return this.serialize(async () => {
      try {
        return await this.read(id);
      } catch (error) {
        if (error?.status !== 404) throw error;
      }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const file = this.file(id);
      const handle = await open(file, 'ax', 0o600);
      await handle.close();
      await chmod(file, 0o600);
      const now = new Date().toISOString();
      const events = [{
        schema: SCHEMA, sessionId: id, sequence: 1, recordedAt: now,
        type: 'conversation_started', payload: { importedLegacyMessages: legacyMessages.length },
      }];
      for (const [index, message] of legacyMessages.entries()) {
        if (!validMessage(message) || message.role === 'tool') throw new TypeError('invalid legacy conversation message');
        events.push({
          schema: SCHEMA, sessionId: id, sequence: events.length + 1, recordedAt: now,
          type: 'message', messageId: `legacy:${index + 1}`, runId: null, message: clone(message),
        });
      }
      await appendFile(file, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, {
        encoding: 'utf8', mode: 0o600,
      });
      return this.read(id);
    });
  }

  async read(sessionId) {
    const id = safeSessionId(sessionId);
    let text;
    try { text = await readFile(this.file(id), 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') throw Object.assign(new Error('conversation not found'), { status: 404 });
      throw error;
    }
    const events = parseEvents(text, id);
    return {
      sessionId: id,
      events: clone(events),
      messages: events.filter((event) => event.type === 'message').map((event) => clone(event.message)),
    };
  }

  async appendMessage({ sessionId, messageId, runId = null, turn = null, message } = {}) {
    const id = safeSessionId(sessionId);
    if (!String(messageId ?? '').trim()) throw new TypeError('conversation message id is required');
    if (!validMessage(message)) throw new TypeError('valid conversation message is required');
    return this.serialize(async () => {
      const current = await this.read(id);
      const existing = current.events.find((event) => event.type === 'message' && event.messageId === messageId);
      if (existing) {
        if (JSON.stringify(existing.message) !== JSON.stringify(message)) {
          throw new Error(`conversation message id conflict: ${messageId}`);
        }
        return clone(existing);
      }
      const event = {
        schema: SCHEMA, sessionId: id, sequence: current.events.length + 1,
        recordedAt: new Date().toISOString(), type: 'message', messageId: String(messageId),
        ...(runId ? { runId: String(runId) } : {}),
        ...(Number.isInteger(turn) ? { turn } : {}),
        message: clone(message),
      };
      await appendFile(this.file(id), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      return clone(event);
    });
  }
}
