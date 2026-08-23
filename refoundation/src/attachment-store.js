import { createHash, randomUUID } from 'node:crypto';
import {
  appendFile, chmod, lstat, mkdir, open, readFile, realpath, rename, unlink,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

import { inspectZipArchive } from './archive-safety.js';
import { artifactPreviewMetadata } from './artifact-preview.js';
import { detectTextDocument } from './text-document-observer.js';

const SCHEMA = 't5.attachment-event.v1';
const DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_SESSION_BYTES = 512 * 1024 * 1024;

function clone(value) { return value == null ? value : structuredClone(value); }

function safeUuid(value, label) {
  const text = String(value ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw Object.assign(new Error(`${label} not found`), { status: 404 });
  }
  return text;
}

function safeName(value) {
  const leaf = String(value ?? '').replace(/\\/g, '/').split('/').at(-1)
    .replace(/[\u0000-\u001f\u007f]/g, '').normalize('NFC').trim();
  return (leaf || 'attachment').slice(0, 180);
}

function zipContains(bytes, name) {
  return bytes.includes(Buffer.from(name, 'utf8'));
}

export function detectAttachmentType(bytesInput, originalName = '') {
  const bytes = Buffer.from(bytesInput);
  const extension = extname(originalName).toLowerCase();
  const starts = (hex) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  if (starts('89504e470d0a1a0a')) return { mimeType: 'image/png', kind: 'image', extension: '.png' };
  if (starts('ffd8ff')) return { mimeType: 'image/jpeg', kind: 'image', extension: '.jpg' };
  if (bytes.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return { mimeType: 'image/gif', kind: 'image', extension: '.gif' };
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', kind: 'image', extension: '.webp' };
  }
  if (bytes.subarray(0, 5).toString('binary') === '%PDF-') return { mimeType: 'application/pdf', kind: 'pdf', extension: '.pdf' };
  if (starts('504b0304') || starts('504b0506') || starts('504b0708')) {
    if (zipContains(bytes, 'xl/workbook.xml')) {
      return { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'spreadsheet', extension: '.xlsx' };
    }
    if (zipContains(bytes, 'word/document.xml')) {
      return { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document', extension: '.docx' };
    }
    if (zipContains(bytes, 'ppt/presentation.xml')) {
      return { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'document', extension: '.pptx' };
    }
    try {
      const manifest = inspectZipArchive(bytes, { maxEntries: 500, maxTotalBytes: 64 * 1024 * 1024 });
      if (manifest.state === 'safe_manifest' && manifest.entries.some((entry) => entry.path === 'index.html')) {
        return { mimeType: 'application/vnd.gpao-t5.web-bundle+zip', kind: 'web_app', extension: '.zip' };
      }
    } catch { /* invalid ZIP falls through to an ordinary archive and is never preview-executed */ }
    return { mimeType: 'application/zip', kind: 'archive', extension: '.zip' };
  }
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { mimeType: 'audio/wav', kind: 'audio', extension: '.wav' };
  }
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3' || starts('fff3') || starts('fffb')) {
    return { mimeType: 'audio/mpeg', kind: 'audio', extension: '.mp3' };
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { mimeType: 'video/mp4', kind: 'video', extension: '.mp4' };
  }
  const textDocument = detectTextDocument(bytes, originalName);
  if (textDocument) {
    const mimeType = ['.html', '.htm'].includes(extension) ? 'text/html'
      : extension === '.svg' ? 'image/svg+xml'
      : extension === '.csv' ? 'text/csv'
      : extension === '.tsv' ? 'text/tab-separated-values'
      : extension === '.md' ? 'text/markdown'
        : extension === '.json' ? 'application/json' : 'text/plain';
    const kind = ['.html', '.htm'].includes(extension) ? 'web'
      : extension === '.svg' ? 'vector' : 'text';
    return {
      mimeType, kind, extension: extension || '.txt',
      ...(kind === 'text' ? {
        encoding: textDocument.encoding,
        encodingEvidence: textDocument.evidence,
      } : {}),
    };
  }
  return { mimeType: 'application/octet-stream', kind: 'binary', extension: '.bin' };
}

function publicRecord(record) {
  return {
    attachmentId: record.attachmentId,
    sessionId: record.sessionId,
    direction: record.direction,
    originalName: record.originalName,
    mimeType: record.mimeType,
    kind: record.kind,
    ...(record.encoding ? { encoding: record.encoding } : {}),
    ...(record.encodingEvidence ? { encodingEvidence: clone(record.encodingEvidence) } : {}),
    bytes: record.bytes,
    sha256: record.sha256,
    createdAt: record.createdAt,
    downloadUrl: `/attachments/${record.attachmentId}/content?sessionId=${record.sessionId}`,
    ...(record.direction === 'output' ? {
      artifactFamilyId: record.artifactFamilyId ?? record.attachmentId,
      artifactVersion: record.artifactVersion ?? 1,
      versionsUrl: `/attachments/${record.attachmentId}/versions?sessionId=${record.sessionId}`,
    } : {}),
    ...artifactPreviewMetadata(record),
    ...(record.sourcePath ? { sourcePath: record.sourcePath } : {}),
    links: clone(record.links ?? []),
  };
}

export class AttachmentStore {
  constructor(directory, {
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxSessionBytes = DEFAULT_MAX_SESSION_BYTES,
  } = {}) {
    if (!directory) throw new TypeError('attachment directory is required');
    this.directory = resolve(directory);
    this.objects = join(this.directory, 'objects');
    this.incoming = join(this.directory, 'incoming');
    this.extracted = join(this.directory, 'extracted');
    this.ledger = join(this.directory, 'ledger.jsonl');
    this.maxFileBytes = maxFileBytes;
    this.maxSessionBytes = maxSessionBytes;
    this.queue = Promise.resolve();
  }

  serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  async ensure() {
    for (const directory of [this.directory, this.objects, this.incoming, this.extracted]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    }
    try { await lstat(this.ledger); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const handle = await open(this.ledger, 'ax', 0o600);
      await handle.close();
    }
    await chmod(this.ledger, 0o600);
  }

  async events() {
    await this.ensure();
    const text = await readFile(this.ledger, 'utf8');
    const events = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    events.forEach((event, index) => {
      if (event.schema !== SCHEMA || event.sequence !== index + 1 || !event.type) {
        throw new Error('invalid attachment ledger');
      }
    });
    return events;
  }

  async append(type, payload) {
    const events = await this.events();
    const event = {
      schema: SCHEMA, sequence: events.length + 1, recordedAt: new Date().toISOString(),
      type, payload: clone(payload),
    };
    await appendFile(this.ledger, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return event;
  }

  recordsFrom(events) {
    const records = new Map();
    for (const event of events) {
      if (event.type === 'received' || event.type === 'output_registered') {
        records.set(event.payload.record.attachmentId, { ...clone(event.payload.record), links: [] });
      } else if (event.type === 'linked') {
        for (const attachmentId of event.payload.attachmentIds) {
          const record = records.get(attachmentId);
          if (record) record.links.push({ messageId: event.payload.messageId, runId: event.payload.runId });
        }
      } else if (event.type === 'discarded') {
        records.delete(event.payload.attachmentId);
      }
    }
    return records;
  }

  async receive({
    sessionId, originalName, declaredMime = null, bytes, direction = 'input', sourcePath = null,
    revisesAttachmentId = null,
  } = {}) {
    const content = Buffer.from(bytes ?? []);
    async function* chunks() { yield content; }
    return this.receiveStream({
      sessionId, originalName, declaredMime, stream: chunks(), direction, sourcePath, revisesAttachmentId,
    });
  }

  async receiveStream({
    sessionId, originalName, declaredMime = null, stream, direction = 'input', sourcePath = null,
    revisesAttachmentId = null,
  } = {}) {
    const owner = safeUuid(sessionId, 'session');
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw new TypeError('attachment stream is required');
    return this.serialize(async () => {
      await this.ensure();
      const records = this.recordsFrom(await this.events());
      let revision = null;
      if (revisesAttachmentId != null) {
        const previousId = safeUuid(revisesAttachmentId, 'attachment');
        const previous = records.get(previousId);
        if (!previous || previous.sessionId !== owner || previous.direction !== 'output') {
          throw Object.assign(new Error('previous result artifact not found'), { status: 404 });
        }
        revision = {
          previousAttachmentId: previous.attachmentId,
          artifactFamilyId: previous.artifactFamilyId ?? previous.attachmentId,
          artifactVersion: Number(previous.artifactVersion ?? 1) + 1,
        };
      }
      const used = [...records.values()].filter((record) => record.sessionId === owner)
        .reduce((sum, record) => sum + record.bytes, 0);
      const temp = join(this.incoming, randomUUID());
      const handle = await open(temp, 'wx', 0o600);
      const hash = createHash('sha256');
      let total = 0;
      try {
        for await (const chunkValue of stream) {
          const chunk = Buffer.from(chunkValue);
          total += chunk.length;
          if (total > this.maxFileBytes) throw Object.assign(new Error('attachment file size limit exceeded'), { status: 413 });
          if (used + total > this.maxSessionBytes) throw Object.assign(new Error('session attachment limit exceeded'), { status: 413 });
          hash.update(chunk);
          await handle.write(chunk);
        }
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(temp).catch(() => {});
        throw error;
      }
      await handle.close();
      await chmod(temp, 0o600);
      const digest = hash.digest('hex');
      const content = await readFile(temp);
      const detected = detectAttachmentType(content, originalName);
      const objectDirectory = join(this.objects, digest);
      const storedPath = join(objectDirectory, `content${detected.extension}`);
      await mkdir(objectDirectory, { recursive: true, mode: 0o700 });
      await chmod(objectDirectory, 0o700);
      try {
        await lstat(storedPath);
        await unlink(temp);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        await rename(temp, storedPath);
        await chmod(storedPath, 0o600);
      }
      const attachmentId = randomUUID();
      const record = {
        attachmentId, sessionId: owner,
        direction: direction === 'output' ? 'output' : 'input',
        originalName: safeName(originalName),
        declaredMime: declaredMime ? String(declaredMime).slice(0, 200) : null,
        mimeType: detected.mimeType, kind: detected.kind,
        ...(detected.encoding ? { encoding: detected.encoding } : {}),
        ...(detected.encodingEvidence ? { encodingEvidence: detected.encodingEvidence } : {}),
        bytes: total, sha256: digest, storedPath: await realpath(storedPath),
        createdAt: new Date().toISOString(),
        ...(direction === 'output' ? {
          artifactFamilyId: revision?.artifactFamilyId ?? attachmentId,
          artifactVersion: revision?.artifactVersion ?? 1,
          ...(revision?.previousAttachmentId ? { previousAttachmentId: revision.previousAttachmentId } : {}),
        } : {}),
        ...(sourcePath ? { sourcePath } : {}),
      };
      await this.append(record.direction === 'output' ? 'output_registered' : 'received', { record });
      return { ...clone(record), ...publicRecord(record) };
    });
  }

  async list({ sessionId } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const records = this.recordsFrom(await this.events());
    return [...records.values()].filter((record) => record.sessionId === owner).map((record) => ({
      ...clone(record), ...publicRecord(record),
    }));
  }

  async versions({ sessionId, attachmentId } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const id = safeUuid(attachmentId, 'attachment');
    const records = this.recordsFrom(await this.events());
    const current = records.get(id);
    if (!current || current.sessionId !== owner || current.direction !== 'output') {
      throw Object.assign(new Error('result artifact not found'), { status: 404 });
    }
    const family = current.artifactFamilyId ?? current.attachmentId;
    return [...records.values()].filter((record) => record.sessionId === owner
      && record.direction === 'output' && (record.artifactFamilyId ?? record.attachmentId) === family)
      .sort((left, right) => Number(left.artifactVersion ?? 1) - Number(right.artifactVersion ?? 1))
      .map((record) => ({ ...clone(record), ...publicRecord(record) }));
  }

  async get({ sessionId, attachmentId } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const id = safeUuid(attachmentId, 'attachment');
    const record = this.recordsFrom(await this.events()).get(id);
    if (!record || record.sessionId !== owner) throw Object.assign(new Error('attachment not found'), { status: 404 });
    return { ...clone(record), ...publicRecord(record) };
  }

  async link({ sessionId, attachmentIds = [], messageId, runId } = {}) {
    const owner = safeUuid(sessionId, 'session');
    if (!String(messageId ?? '').trim() || !String(runId ?? '').trim()) throw new TypeError('messageId and runId are required');
    const ids = [...new Set(attachmentIds.map((id) => safeUuid(id, 'attachment')))];
    return this.serialize(async () => {
      const records = this.recordsFrom(await this.events());
      for (const id of ids) {
        const record = records.get(id);
        if (!record || record.sessionId !== owner) throw Object.assign(new Error('attachment not found'), { status: 404 });
      }
      await this.append('linked', { sessionId: owner, attachmentIds: ids, messageId: String(messageId), runId: String(runId) });
      return Promise.all(ids.map((attachmentId) => this.get({ sessionId: owner, attachmentId })));
    });
  }

  async discard({ sessionId, attachmentId } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const id = safeUuid(attachmentId, 'attachment');
    return this.serialize(async () => {
      const records = this.recordsFrom(await this.events());
      const record = records.get(id);
      if (!record || record.sessionId !== owner) throw Object.assign(new Error('attachment not found'), { status: 404 });
      if (record.links.length) throw new Error('attachment is already linked to a message');
      if (record.direction !== 'input') throw new Error('output artifact cannot be discarded as staged input');
      await this.append('discarded', { sessionId: owner, attachmentId: id });
      return { discarded: true, attachmentId: id };
    });
  }

  async registerOutput({ sessionId, workspace, filePath, revisesAttachmentId = null } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const requested = resolve(String(filePath ?? ''));
    const stat = await lstat(requested);
    if (stat.isSymbolicLink()) throw new Error('output path must not be a symbolic link');
    if (!stat.isFile()) throw new Error('output path must be a regular file');
    if (stat.nlink !== 1) throw new Error('output path must not be a hard link');
    const root = await realpath(workspace);
    const path = await realpath(requested);
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== path) {
      throw new Error('output path is outside workspace');
    }
    if (stat.size > this.maxFileBytes) throw new Error('attachment file size limit exceeded');
    return this.receive({
      sessionId: owner, originalName: basename(path), bytes: await readFile(path),
      direction: 'output', sourcePath: path, revisesAttachmentId,
    });
  }

  async readContent({ sessionId, attachmentId } = {}) {
    const record = await this.get({ sessionId, attachmentId });
    return { record, bytes: await readFile(record.storedPath) };
  }
}
