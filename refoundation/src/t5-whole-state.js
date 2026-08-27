import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import { AttachmentStore } from './attachment-store.js';
import { AutomationStore } from './automation-store.js';
import { ConsoleSessionStore } from './console-session-store.js';
import { ConversationLedger } from './conversation-ledger.js';
import { MemoryLedger } from './memory-ledger.js';
import { MessengerStateStore } from './messenger-gateway.js';
import { RunLedger } from './run-ledger.js';
import { WorkStore } from './work-store.js';
import { WholeStateComponentRegistry } from './whole-state-component-registry.js';

async function regularFiles(stateRoot, subdirectory, { include = () => true } = {}) {
  const root = resolve(stateRoot, subdirectory); const output = [];
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name); const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('whole-state source contains a symbolic link');
      if (info.isDirectory()) await walk(path);
      else if (info.isFile() && include(path)) output.push(relative(stateRoot, path).replaceAll('\\', '/'));
    }
  }
  await walk(root); return output;
}

export async function makeT5WholeStateRegistry(stateRoot) {
  const registry = new WholeStateComponentRegistry(stateRoot);
  const add = (id, files, restoreOrder, relationships = [], required = false, options = {}) => registry.register({
    id, files, restoreOrder, relationships, required, ...options,
  });
  add('sessions', ['console-sessions.json'], 10);
  add('conversations', await regularFiles(stateRoot, 'conversations', { include: (path) => path.endsWith('.jsonl') }), 20, ['sessions']);
  add('work', ['work/events.jsonl'], 30, ['sessions', 'conversations']);
  add('runs', await regularFiles(stateRoot, 'runs', { include: (path) => path.endsWith('.jsonl') }), 40, ['sessions', 'work']);
  add('memory', ['memory/memory.jsonl'], 50, ['sessions']);
  add('automation', ['automation/state.json'], 60, ['sessions', 'work']);
  add('attachments', ['attachments/ledger.jsonl'], 70, ['sessions', 'work', 'runs'], false,
    { capture: 'attachment_portable' });
  add('artifact-objects', await regularFiles(stateRoot, 'attachments/objects'), 71, ['attachments']);
  add('capability-handoffs', ['capability-handoffs/capability-handoffs.jsonl'], 80, ['sessions', 'runs']);
  add('capability-lifecycle', ['capability-lifecycle/events.jsonl'], 90, ['work', 'runs']);
  add('resources', ['resources/events.jsonl'], 100, ['runs']);
  add('authority', await regularFiles(stateRoot, 'authority', { include: (path) => path.endsWith('.jsonl') }), 110, ['sessions', 'runs']);
  add('connections', await regularFiles(stateRoot, 'connections', {
    include: (path) => basename(path) === 'connection-state.sqlite',
  }), 120, [], false, { capture: 'sqlite_online' });
  add('messenger', ['messenger/messenger-runtime.json'], 130, ['sessions', 'work']);
  add('terminal-outputs', await regularFiles(stateRoot, 'terminal-outputs'), 140, ['sessions', 'runs']);
  add('managed-skills', await regularFiles(stateRoot, 'managed-skills'), 150, ['capability-lifecycle']);
  add('capability-packages', await regularFiles(stateRoot, 'capability-packages'), 155, ['capability-lifecycle']);
  add('file-activity', await regularFiles(stateRoot, 'file-activity'), 160);
  add('app-activity', await regularFiles(stateRoot, 'app-activity'), 170);
  add('runtime-continuity', ['runtime-continuity/events.json'], 180);
  add('user-notes', await regularFiles(stateRoot, 'user-notes'), 190);
  return registry;
}

function included(manifest, id) {
  return manifest.components.some((component) => component.id === id && component.state !== 'unavailable');
}

export async function validateT5WholeStateRelationships({ root, manifest } = {}) {
  const sessions = included(manifest, 'sessions') ? await new ConsoleSessionStore(root).read() : { sessions: [] };
  const sessionIds = new Set(sessions.sessions.map((session) => session.id));
  if (included(manifest, 'conversations')) {
    const conversations = new ConversationLedger(join(root, 'conversations'));
    for (const file of manifest.components.find((component) => component.id === 'conversations').files) {
      if (file.state) continue; const sessionId = basename(file.path, '.jsonl');
      if (!sessionIds.has(sessionId)) throw new Error('restored Conversation has no Session');
      await conversations.read(sessionId);
    }
  }
  const work = included(manifest, 'work') ? await new WorkStore(join(root, 'work')).read()
    : { works: [], inputs: [], results: [], claims: [], cancellations: [] };
  const workIds = new Set(work.works.map((item) => item.workId));
  for (const item of work.works) if (!sessionIds.has(item.sessionId)) throw new Error('restored Work has no Session');
  for (const item of work.inputs) if (!sessionIds.has(item.sessionId)) throw new Error('restored Work input has no Session');
  let automationState = null;
  if (included(manifest, 'automation')) {
    automationState = await new AutomationStore(join(root, 'automation', 'state.json')).read();
    for (const job of automationState.jobs) {
      if (!sessionIds.has(job.sessionId)) throw new Error('restored Automation has no Session');
      if (job.sourceWorkId && !workIds.has(job.sourceWorkId)) throw new Error('restored Automation has no source Work');
    }
  }
  if (included(manifest, 'memory')) await new MemoryLedger(join(root, 'memory')).read();
  if (included(manifest, 'connections')) {
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(join(root, 'connections', 'connection-state.sqlite'), { readOnly: true });
    try {
      if (database.prepare('PRAGMA quick_check').get().quick_check !== 'ok') {
        throw new Error('restored Connection SQLite integrity check failed');
      }
    } finally { database.close(); }
  }
  if (included(manifest, 'messenger')) {
    const messenger = new MessengerStateStore(join(root, 'messenger')); await messenger.read();
    for (const binding of await messenger.listBindings()) {
      if (!sessionIds.has(binding.sessionId)) throw new Error('restored Messenger binding has no Session');
    }
  }
  const runIds = new Set();
  if (included(manifest, 'runs')) {
    const runs = new RunLedger(join(root, 'runs'));
    for (const file of manifest.components.find((component) => component.id === 'runs').files) {
      if (file.state) continue; const runId = basename(file.path, '.jsonl'); const run = await runs.read(runId);
      if (!sessionIds.has(run.sessionId)) throw new Error('restored Run has no Session'); runIds.add(runId);
    }
  }
  for (const occurrence of automationState?.runs ?? []) {
    if (occurrence.sourceRunId && !runIds.has(occurrence.sourceRunId)) throw new Error('restored Automation result has no Run');
    if (occurrence.executionWorkId && !workIds.has(occurrence.executionWorkId)) throw new Error('restored Automation result has no Work');
  }
  if (included(manifest, 'attachments')) {
    const attachments = new AttachmentStore(join(root, 'attachments')); const events = await attachments.events();
    for (const event of events) {
      if (event.sessionId && !sessionIds.has(event.sessionId)) throw new Error('restored Artifact has no Session');
      if (event.runId && !runIds.has(event.runId)) throw new Error('restored Artifact has no Run');
    }
    for (const sessionId of sessionIds) for (const record of await attachments.list({ sessionId })) {
      const reopened = await attachments.readContent({ sessionId, attachmentId: record.attachmentId });
      if (reopened.bytes.length !== record.bytes
        || createHash('sha256').update(reopened.bytes).digest('hex') !== record.sha256) {
        throw new Error('restored Artifact object does not match its portable identity');
      }
    }
  }
  const unavailableArtifacts = manifest.components.find((component) => component.id === 'artifact-objects')
    ?.files.filter((file) => file.state === 'excluded_large').length ?? 0;
  return { valid: true, sessions: sessionIds.size, works: workIds.size, runs: runIds.size,
    unavailableArtifacts,
    externalEffectsRetried: 0, credentialsRestored: 0 };
}
