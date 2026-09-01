import { appendFile, chmod, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { projectSelectableMessage } from './selectable-message-projection.js';
import { projectSelectionExplorations } from './selection-exploration-projection.js';

const SCHEMA = 't5.conversation-event.v1';

function clone(value) { return value == null ? value : structuredClone(value); }

function validAttachment(attachment) {
  return attachment && /^[0-9a-f-]{36}$/i.test(attachment.attachmentId ?? '')
    && ['input', 'output'].includes(attachment.direction)
    && typeof attachment.originalName === 'string'
    && typeof attachment.mimeType === 'string'
    && typeof attachment.kind === 'string'
    && Number.isInteger(attachment.bytes) && attachment.bytes >= 0
    && /^[0-9a-f]{64}$/.test(attachment.sha256 ?? '')
    && typeof attachment.downloadUrl === 'string';
}

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
  if (message.attachments !== undefined) {
    if (message.role !== 'user' || !Array.isArray(message.attachments)
      || message.attachments.length > 10 || !message.attachments.every(validAttachment)) return false;
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
    if (event.type === 'checkpoint' && (!event.checkpointId || !event.coversThroughMessageId
      || typeof event.summary !== 'string' || !event.summary.trim())) {
      throw new Error('invalid conversation checkpoint');
    }
    if (event.type === 'selection_exploration_opened' && (!event.explorationId
      || event.anchor?.schema !== 't5.selection-anchor.v1' || event.anchor.sessionId !== sessionId)) {
      throw new Error('invalid selection exploration');
    }
    if (event.type === 'selection_side_message_appended' && (!event.explorationId
      || !event.sideMessageId || !['user', 'assistant'].includes(event.role)
      || typeof event.content !== 'string')) throw new Error('invalid selection side message');
    if (event.type === 'selection_side_run_started' && (!event.explorationId || !event.runId)) {
      throw new Error('invalid selection side run');
    }
    if (event.type === 'selection_side_run_settled' && (!event.explorationId || !event.runId
      || !['completed', 'stopped', 'failed', 'interrupted'].includes(event.state))) {
      throw new Error('invalid selection side settlement');
    }
    if (event.type === 'selection_exploration_closed' && !event.explorationId) {
      throw new Error('invalid selection exploration close');
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
    const aborted = new Set(events.filter((event) => event.type === 'message_aborted')
      .map((event) => event.messageId));
    const entries = events.filter((event) => event.type === 'message' && !aborted.has(event.messageId)).map((event) => ({
      messageId: event.messageId,
      runId: event.runId ?? null,
      turn: event.turn ?? null,
      recordedAt: event.recordedAt,
      message: clone(event.message),
    }));
    return {
      sessionId: id,
      events: clone(events),
      entries,
      messages: entries.map((entry) => clone(entry.message)),
      checkpoints: events.filter((event) => event.type === 'checkpoint').map((event) => ({
        checkpointId: event.checkpointId,
        coversThroughMessageId: event.coversThroughMessageId,
        summary: event.summary,
        sourceMessageCount: event.sourceMessageCount,
        sourceBytes: event.sourceBytes,
        tailMessageCount: event.tailMessageCount,
        recordedAt: event.recordedAt,
      })),
      explorations: projectSelectionExplorations(events),
    };
  }

  async appendSelectionEvent(sessionId, event) {
    const id = safeSessionId(sessionId);
    return this.serialize(async () => {
      const current = await this.read(id);
      if (event.requestId) {
        const existing = current.events.find((item) => item.type === event.type
          && item.requestId === event.requestId);
        if (existing) {
          const comparable = { ...existing }; delete comparable.sequence; delete comparable.recordedAt;
          if (JSON.stringify(comparable) !== JSON.stringify({ schema: SCHEMA, sessionId: id,
            ...clone(event) })) throw new Error('selection request identity conflict');
          return clone(existing);
        }
      }
      const appended = { schema: SCHEMA, sessionId: id, sequence: current.events.length + 1,
        recordedAt: new Date().toISOString(), ...clone(event) };
      await appendFile(this.file(id), `${JSON.stringify(appended)}\n`, { encoding: 'utf8', mode: 0o600 });
      return clone(appended);
    });
  }

  async openSelectionExploration({ sessionId, explorationId, anchor, requestId } = {}) {
    const current = await this.read(sessionId);
    const source = current.events.find((event) => event.type === 'message'
      && event.messageId === anchor?.sourceMessageId);
    if (!source || source.sequence !== anchor.sourceMessageSequence
      || source.message.role !== anchor.sourceRole || (source.runId ?? null) !== anchor.sourceRunId) {
      throw new Error('selection source identity mismatch');
    }
    const projection = projectSelectableMessage(source.message.content, { role: source.message.role });
    if (anchor.projectionVersion !== projection.version || anchor.projectionDigest !== projection.digest
      || projection.text.slice(anchor.startUtf16, anchor.endUtf16) !== anchor.quote) {
      throw new Error('stale selection projection');
    }
    return this.appendSelectionEvent(sessionId, { type: 'selection_exploration_opened',
      explorationId: String(explorationId), requestId: String(requestId), anchor: clone(anchor) });
  }

  async appendSelectionSideMessage({ sessionId, explorationId, sideMessageId,
    role, content, runId = null, requestId = null } = {}) {
    const current = await this.read(sessionId);
    const branch = current.explorations.find((item) => item.explorationId === explorationId);
    if (!branch || branch.state === 'closed') throw new Error('selection exploration is unavailable');
    return this.appendSelectionEvent(sessionId, { type: 'selection_side_message_appended',
      explorationId: String(explorationId), sideMessageId: String(sideMessageId),
      role, content: String(content), ...(runId ? { runId: String(runId) } : {}),
      ...(requestId ? { requestId: String(requestId) } : {}) });
  }

  async startSelectionSideRun({ sessionId, explorationId, runId, requestId } = {}) {
    const current = await this.read(sessionId);
    const branch = current.explorations.find((item) => item.explorationId === explorationId);
    if (!branch || branch.state === 'closed') throw new Error('selection exploration is unavailable');
    return this.appendSelectionEvent(sessionId, { type: 'selection_side_run_started',
      explorationId: String(explorationId), runId: String(runId), requestId: String(requestId) });
  }

  async settleSelectionSideRun({ sessionId, explorationId, runId, state, requestId } = {}) {
    return this.appendSelectionEvent(sessionId, { type: 'selection_side_run_settled',
      explorationId: String(explorationId), runId: String(runId), state,
      requestId: String(requestId) });
  }

  async closeSelectionExploration({ sessionId, explorationId, requestId } = {}) {
    const current = await this.read(sessionId);
    const branch = current.explorations.find((item) => item.explorationId === explorationId);
    if (!branch) throw new Error('selection exploration is unavailable');
    if (branch.state === 'closed') return null;
    return this.appendSelectionEvent(sessionId, { type: 'selection_exploration_closed',
      explorationId: String(explorationId), requestId: String(requestId) });
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

  async abortMessage({ sessionId, messageId, inputId, reason = 'admission_failed' } = {}) {
    const id = safeSessionId(sessionId); const target = String(messageId ?? '').trim();
    if (!target || !String(inputId ?? '').trim()) throw new TypeError('message and input identity are required');
    return this.serialize(async () => {
      const current = await this.read(id);
      const events = parseEvents(await readFile(this.file(id), 'utf8'), id);
      if (events.some((event) => event.type === 'message_aborted' && event.messageId === target)) return null;
      const event = { schema: SCHEMA, sessionId: id, sequence: events.length + 1,
        recordedAt: new Date().toISOString(), type: 'message_aborted', messageId: target,
        inputId: String(inputId), reason: String(reason) };
      await appendFile(this.file(id), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      return clone(event);
    });
  }

  async appendCheckpoint({
    sessionId, checkpointId, coversThroughMessageId, summary,
    sourceMessageCount, sourceBytes, tailMessageCount,
  } = {}) {
    const id = safeSessionId(sessionId);
    if (!String(checkpointId ?? '').trim() || !String(coversThroughMessageId ?? '').trim()
      || !String(summary ?? '').trim()) throw new TypeError('checkpoint id, coverage, and summary are required');
    return this.serialize(async () => {
      const current = await this.read(id);
      if (!current.entries.some((entry) => entry.messageId === coversThroughMessageId)) {
        throw new Error('checkpoint coverage message not found');
      }
      const existing = current.events.find((event) => (
        event.type === 'checkpoint' && event.checkpointId === checkpointId
      ));
      if (existing) return clone(existing);
      const event = {
        schema: SCHEMA, sessionId: id, sequence: current.events.length + 1,
        recordedAt: new Date().toISOString(), type: 'checkpoint',
        checkpointId: String(checkpointId), coversThroughMessageId: String(coversThroughMessageId),
        summary: String(summary),
        sourceMessageCount: Number(sourceMessageCount) || 0,
        sourceBytes: Number(sourceBytes) || 0,
        tailMessageCount: Number(tailMessageCount) || 0,
      };
      await appendFile(this.file(id), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      return clone(event);
    });
  }
}
