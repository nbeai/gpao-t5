import { createHash, randomUUID } from 'node:crypto';
import {
  appendFile, chmod, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile,
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
    this.prepared = join(this.directory, 'prepared');
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
    for (const directory of [this.directory, this.objects, this.incoming, this.extracted, this.prepared]) {
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
        const persisted = clone(event.payload.record);
        const legacyLeaf = persisted.storedPath ? basename(persisted.storedPath) : null;
        const objectRelativePath = String(persisted.objectRelativePath
          ?? (legacyLeaf ? `objects/${persisted.sha256}/${legacyLeaf}` : ''));
        if (!/^objects\/[0-9a-f]{64}\/content(?:\.[A-Za-z0-9]{1,16})?$/u.test(objectRelativePath)
          || !objectRelativePath.startsWith(`objects/${persisted.sha256}/`)) {
          throw new Error('attachment object identity is invalid');
        }
        delete persisted.storedPath;
        records.set(persisted.attachmentId, { ...persisted, objectRelativePath,
          storedPath: resolve(this.directory, objectRelativePath), links: [] });
      } else if (event.type === 'linked') {
        for (const attachmentId of event.payload.attachmentIds) {
          const record = records.get(attachmentId);
          if (record) record.links.push({ messageId: event.payload.messageId,
            runId: event.payload.runId ?? null,
            ...(event.payload.inputId == null ? {} : { inputId: event.payload.inputId }) });
        }
      } else if (event.type === 'input_link_aborted') {
        for (const record of records.values()) record.links = record.links.filter(
          (link) => link.inputId !== event.payload.inputId,
        );
      } else if (event.type === 'discarded') {
        records.delete(event.payload.attachmentId);
      } else if (event.type === 'output_batch_artifacts_registered') {
        for (const value of event.payload.records ?? []) {
          const persisted = clone(value); const objectRelativePath = String(persisted.objectRelativePath ?? '');
          if (!/^objects\/[0-9a-f]{64}\/content(?:\.[A-Za-z0-9]{1,16})?$/u.test(objectRelativePath)
            || !objectRelativePath.startsWith(`objects/${persisted.sha256}/`)) {
            throw new Error('attachment object identity is invalid');
          }
          records.set(persisted.attachmentId, { ...persisted, objectRelativePath,
            storedPath: resolve(this.directory, objectRelativePath), links: [{
              messageId: `${event.payload.registeringRunId}:output:${persisted.attachmentId}`,
              runId: event.payload.registeringRunId,
            }] });
        }
      }
    }
    return records;
  }

  producedOutputsFrom(events) {
    const outputs = new Map();
    for (const event of events) {
      if (event.type === 'output_produced') {
        outputs.set(event.payload.output.outputHandle, {
          ...clone(event.payload.output), state: 'produced', attachmentId: null,
        });
      } else if (event.type === 'output_batch_committed') {
        for (const item of event.payload.outputs ?? []) outputs.set(item.outputHandle, {
          ...clone(item), state: 'produced', attachmentId: null,
        });
      } else if (event.type === 'output_registered_from_provenance') {
        const output = outputs.get(event.payload.outputHandle);
        if (output) {
          output.state = 'registered';
          output.attachmentId = event.payload.attachmentId;
          output.registeringRunId = event.payload.registeringRunId;
        }
      } else if (event.type === 'output_batch_artifacts_registered') {
        for (const registration of event.payload.registrations ?? []) {
          const output = outputs.get(registration.outputHandle); if (output) {
            output.state = 'registered'; output.attachmentId = registration.attachmentId;
            output.registeringRunId = event.payload.registeringRunId;
          }
        }
      }
    }
    return outputs;
  }

  producedOutputBatchesFrom(events) {
    const batches = new Map();
    for (const event of events) {
      const batchId = event.payload?.batchId;
      if (event.type === 'output_batch_prepared') batches.set(batchId, {
        ...clone(event.payload.batch), state: 'prepared', outputs: [],
      });
      else if (event.type === 'output_batch_publication_verified') {
        const batch = batches.get(batchId); if (batch) {
          batch.state = 'publication_verified'; batch.publication = clone(event.payload.publication);
        }
      }
      else if (event.type === 'output_batch_committed') {
        const batch = batches.get(batchId); if (batch) {
          batch.state = 'committed'; batch.outputs = clone(event.payload.outputs ?? []);
          batch.reconciled = event.payload.reconciled === true;
        }
      } else if (event.type === 'output_batch_not_published') {
        const batch = batches.get(batchId); if (batch) batch.state = 'not_published';
      } else if (event.type === 'output_batch_reconciliation_unknown') {
        const batch = batches.get(batchId); if (batch) batch.state = 'partial_effect_unknown';
      } else if (event.type === 'output_batch_artifacts_registered') {
        const batch = batches.get(batchId); if (batch) {
          batch.state = 'artifacts_registered';
          batch.artifactIds = (event.payload.records ?? []).map((record) => record.attachmentId);
        }
      }
    }
    return batches;
  }

  async observeOutputTarget({ workspace, filePath } = {}) {
    const lexicalRoot = resolve(String(workspace)); const root = await realpath(lexicalRoot);
    const lexicalRequested = resolve(lexicalRoot, String(filePath ?? ''));
    const lexicalCandidate = relative(lexicalRoot, lexicalRequested);
    const requested = lexicalCandidate !== '..' && !lexicalCandidate.startsWith(`..${sep}`)
      ? resolve(root, lexicalCandidate) : lexicalRequested;
    const lexicalRel = relative(root, requested);
    if (lexicalRel === '..' || lexicalRel.startsWith(`..${sep}`) || !lexicalRel) {
      throw new Error('output path is outside workspace');
    }
    let candidate = dirname(requested); let parentMissing = false;
    while (candidate !== root) {
      try { await lstat(candidate); break; }
      catch (error) { if (error?.code !== 'ENOENT') throw error;
        parentMissing = true; candidate = dirname(candidate); }
    }
    const parent = await realpath(candidate); const path = resolve(parent, relative(candidate, requested));
    const rel = relative(root, path); const parentRel = relative(root, parent);
    if (rel === '..' || rel.startsWith(`..${sep}`) || !rel) throw new Error('output path is outside workspace');
    if (parentRel === '..' || parentRel.startsWith(`..${sep}`)) throw new Error('output parent is outside workspace');
    if (parentMissing) return { path, exists: false, bytes: null, sha256: null };
    let stat;
    try { stat = await lstat(path); }
    catch (error) { if (error?.code === 'ENOENT') return { path, exists: false, bytes: null, sha256: null }; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error('output path must be a regular single-link file');
    }
    if (stat.size > this.maxFileBytes) throw new Error('attachment file size limit exceeded');
    const bytes = await readFile(path); return { path, exists: true, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  batchResult(batch, { reconciled = batch.reconciled === true } = {}) {
    return { batchId: batch.batchId, state: batch.state, outputCount: batch.specs.length,
      outputs: clone(batch.outputs ?? []), reconciled };
  }

  assertBatchOwner(batch, { sessionId, runId, toolCallId }) {
    if (!batch || batch.sessionId !== sessionId || batch.producerRunId !== runId
      || batch.toolCallId !== String(toolCallId ?? '')) throw new Error('output batch identity mismatch');
  }

  async commitPreparedOutputBatch(batch, { workspace, reconciled }) {
    if (await realpath(workspace) !== batch.workspace) throw new Error('output batch workspace mismatch');
    const observed = [];
    for (const spec of batch.specs) {
      const value = await this.observeOutputTarget({ workspace, filePath: spec.sourcePath });
      if (!value.exists || value.sha256 !== spec.expectedSha256 || value.bytes !== spec.expectedBytes) {
        throw new Error('output batch postimage mismatch');
      }
      observed.push(value);
    }
    const createdAt = new Date().toISOString();
    const outputs = observed.map((value) => ({ outputHandle: randomUUID(),
      sessionId: batch.sessionId, producerRunId: batch.producerRunId, toolCallId: batch.toolCallId,
      sourcePath: value.path, originalName: safeName(value.path), bytes: value.bytes,
      sha256: value.sha256, createdAt }));
    await this.append('output_batch_committed', { batchId: batch.batchId, outputs, reconciled });
    return { ...this.batchResult({ ...batch, state: 'committed', outputs, reconciled }), reconciled };
  }

  async prepareProducedOutputBatch({ sessionId, workspace, runId, toolCallId, outputs } = {}) {
    const owner = safeUuid(sessionId, 'session'); const producerRunId = safeUuid(runId, 'run');
    if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > 32) {
      throw new TypeError('output batch requires one to thirty-two outputs');
    }
    return this.serialize(async () => {
      const events = await this.events(); const batches = this.producedOutputBatchesFrom(events);
      const existing = [...batches.values()].find((batch) => batch.sessionId === owner
        && batch.producerRunId === producerRunId && batch.toolCallId === String(toolCallId ?? ''));
      const specs = [];
      for (const output of outputs) {
        const expectedSha256 = String(output?.expectedSha256 ?? '');
        const expectedBytes = Number(output?.expectedBytes);
        if (!/^[a-f0-9]{64}$/u.test(expectedSha256) || !Number.isSafeInteger(expectedBytes)
          || expectedBytes < 0 || expectedBytes > this.maxFileBytes) throw new TypeError('output batch identity is invalid');
        const preimage = await this.observeOutputTarget({ workspace, filePath: output.filePath });
        specs.push({ ordinal: specs.length, sourcePath: preimage.path,
          expectedSha256, expectedBytes, preimage });
      }
      if (new Set(specs.map((spec) => spec.sourcePath)).size !== specs.length) {
        throw new Error('output batch path is duplicated');
      }
      if (existing) {
        const same = JSON.stringify(existing.specs.map(({ ordinal, sourcePath, expectedSha256, expectedBytes }) => (
          { ordinal, sourcePath, expectedSha256, expectedBytes }
        ))) === JSON.stringify(specs.map(({ ordinal, sourcePath, expectedSha256, expectedBytes }) => (
          { ordinal, sourcePath, expectedSha256, expectedBytes }
        )));
        if (!same) throw new Error('output batch request collision');
        return this.batchResult(existing);
      }
      const batch = { batchId: randomUUID(), sessionId: owner, producerRunId,
        toolCallId: String(toolCallId ?? ''), workspace: await realpath(workspace), specs,
        preparedAt: new Date().toISOString() };
      await this.append('output_batch_prepared', { batchId: batch.batchId, batch });
      return this.batchResult({ ...batch, state: 'prepared', outputs: [] });
    });
  }

  async commitProducedOutputBatch({ sessionId, workspace, runId, toolCallId, batchId } = {}) {
    const owner = safeUuid(sessionId, 'session'); const producerRunId = safeUuid(runId, 'run');
    const id = safeUuid(batchId, 'output batch');
    return this.serialize(async () => {
      const batch = this.producedOutputBatchesFrom(await this.events()).get(id);
      this.assertBatchOwner(batch, { sessionId: owner, runId: producerRunId, toolCallId });
      if (batch.state !== 'publication_verified') return this.batchResult(batch);
      return this.commitPreparedOutputBatch(batch, { workspace, reconciled: false });
    });
  }

  async registerProducedOutputBatch({ sessionId, workspace, runId, batchId } = {}) {
    const owner = safeUuid(sessionId, 'session'); const registeringRunId = safeUuid(runId, 'run');
    const id = safeUuid(batchId, 'output batch');
    return this.serialize(async () => {
      await this.ensure(); const events = await this.events();
      const batch = this.producedOutputBatchesFrom(events).get(id);
      if (!batch || batch.sessionId !== owner || batch.producerRunId !== registeringRunId) {
        throw new Error('output batch identity mismatch');
      }
      const records = this.recordsFrom(events);
      if (batch.state === 'artifacts_registered') return { batchId: id, state: 'artifacts_registered',
        artifacts: batch.artifactIds.map((attachmentId) => {
          const record = records.get(attachmentId); return { ...clone(record), ...publicRecord(record) };
        }) };
      if (batch.state !== 'committed') throw new Error('output batch is not committed');
      if (await realpath(workspace) !== batch.workspace) throw new Error('output batch workspace mismatch');
      const outputs = batch.outputs;
      const observed = [];
      for (const output of outputs) observed.push(await this.readWorkspaceOutput({ workspace,
        filePath: output.sourcePath, expectedSha256: output.sha256 }));
      const used = [...records.values()].filter((record) => record.sessionId === owner)
        .reduce((sum, record) => sum + record.bytes, 0);
      const added = observed.reduce((sum, item) => sum + item.size, 0);
      if (used + added > this.maxSessionBytes) throw Object.assign(
        new Error('session attachment limit exceeded'), { status: 413 });
      const createdAt = new Date().toISOString(); const batchRecords = [];
      for (const [index, item] of observed.entries()) {
        const content = await readFile(item.path); const output = outputs[index];
        if (content.length !== output.bytes || createHash('sha256').update(content).digest('hex') !== output.sha256) {
          throw new Error('output file identity changed after qualification');
        }
        const detected = detectAttachmentType(content, output.originalName);
        const objectDirectory = join(this.objects, output.sha256);
        const storedPath = join(objectDirectory, `content${detected.extension}`);
        await mkdir(objectDirectory, { recursive: true, mode: 0o700 }); await chmod(objectDirectory, 0o700);
        try {
          const identity = await lstat(storedPath);
          if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1
            || createHash('sha256').update(await readFile(storedPath)).digest('hex') !== output.sha256) {
            throw new Error('managed attachment object identity mismatch');
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
          const temporary = join(this.incoming, randomUUID());
          await writeFile(temporary, content, { mode: 0o600 }); await chmod(temporary, 0o600);
          await rename(temporary, storedPath); await chmod(storedPath, 0o600);
        }
        const attachmentId = randomUUID();
        batchRecords.push({ attachmentId, sessionId: owner, direction: 'output',
          originalName: output.originalName, declaredMime: null, mimeType: detected.mimeType,
          kind: detected.kind, ...(detected.encoding ? { encoding: detected.encoding } : {}),
          ...(detected.encodingEvidence ? { encodingEvidence: detected.encodingEvidence } : {}),
          bytes: output.bytes, sha256: output.sha256,
          objectRelativePath: relative(this.directory, storedPath).split(sep).join('/'), createdAt,
          artifactFamilyId: attachmentId, artifactVersion: 1, sourcePath: output.sourcePath });
      }
      const registrations = batchRecords.map((record, index) => ({
        outputHandle: outputs[index].outputHandle, attachmentId: record.attachmentId,
      }));
      await this.append('output_batch_artifacts_registered', {
        batchId: id, registeringRunId, records: batchRecords, registrations,
      });
      return { batchId: id, state: 'artifacts_registered', artifacts: batchRecords.map((record) => {
        const live = { ...clone(record), storedPath: resolve(this.directory, record.objectRelativePath),
          links: [{ messageId: `${registeringRunId}:output:${record.attachmentId}`, runId: registeringRunId }] };
        return { ...live, ...publicRecord(live) };
      }) };
    });
  }

  async markProducedOutputBatchPublicationVerified({ sessionId, runId, toolCallId,
    batchId, publication } = {}) {
    const owner = safeUuid(sessionId, 'session'); const producerRunId = safeUuid(runId, 'run');
    const id = safeUuid(batchId, 'output batch');
    if (publication?.state !== 'published_verified' || !String(publication.undoHandle ?? '').trim()) {
      throw new TypeError('verified publication receipt is required');
    }
    return this.serialize(async () => {
      const batch = this.producedOutputBatchesFrom(await this.events()).get(id);
      this.assertBatchOwner(batch, { sessionId: owner, runId: producerRunId, toolCallId });
      if (batch.state === 'publication_verified' || batch.state === 'committed') return this.batchResult(batch);
      if (batch.state !== 'prepared') throw new Error('output batch is not awaiting publication');
      const receipt = { state: 'published_verified', undoHandle: String(publication.undoHandle) };
      await this.append('output_batch_publication_verified', { batchId: id, publication: receipt });
      return this.batchResult({ ...batch, state: 'publication_verified', publication: receipt });
    });
  }

  async preparedProducedOutputBatches({ sessionId, producerRunId = null } = {}) {
    const owner = safeUuid(sessionId, 'session');
    return clone([...this.producedOutputBatchesFrom(await this.events()).values()]
      .filter((batch) => batch.sessionId === owner
        && ['prepared', 'publication_verified', 'committed'].includes(batch.state)
        && (producerRunId == null || batch.producerRunId === String(producerRunId)))
      .map((batch) => ({ batchId: batch.batchId, producerRunId: batch.producerRunId,
        toolCallId: batch.toolCallId, state: batch.state, outputCount: batch.specs.length })));
  }

  async reconcileProducedOutputBatch({ sessionId, workspace, runId, toolCallId, batchId } = {}) {
    const owner = safeUuid(sessionId, 'session'); const producerRunId = safeUuid(runId, 'run');
    const id = safeUuid(batchId, 'output batch');
    return this.serialize(async () => {
      const batch = this.producedOutputBatchesFrom(await this.events()).get(id);
      this.assertBatchOwner(batch, { sessionId: owner, runId: producerRunId, toolCallId });
      if (!['prepared', 'publication_verified'].includes(batch.state)) return this.batchResult(batch);
      if (await realpath(workspace) !== batch.workspace) throw new Error('output batch workspace mismatch');
      const observations = await Promise.all(batch.specs.map((spec) => (
        this.observeOutputTarget({ workspace, filePath: spec.sourcePath })
      )));
      const post = observations.map((value, index) => value.exists
        && value.sha256 === batch.specs[index].expectedSha256
        && value.bytes === batch.specs[index].expectedBytes);
      if (post.every(Boolean) && batch.state === 'publication_verified') {
        return this.commitPreparedOutputBatch(batch, { workspace, reconciled: true });
      }
      const pre = observations.map((value, index) => {
        const expected = batch.specs[index].preimage;
        return expected.exists === value.exists && (!expected.exists
          || (expected.sha256 === value.sha256 && expected.bytes === value.bytes));
      });
      if (pre.every(Boolean) && batch.state === 'prepared') {
        await this.append('output_batch_not_published', { batchId: id });
        return this.batchResult({ ...batch, state: 'not_published', outputs: [] });
      }
      await this.append('output_batch_reconciliation_unknown', { batchId: id,
        postimageMatches: post, preimageMatches: pre });
      return this.batchResult({ ...batch, state: 'partial_effect_unknown', outputs: [] });
    });
  }

  async readWorkspaceOutput({ workspace, filePath, expectedSha256 = null } = {}) {
    const root = await realpath(workspace);
    const requested = resolve(root, String(filePath ?? ''));
    const stat = await lstat(requested);
    if (stat.isSymbolicLink()) throw new Error('output path must not be a symbolic link');
    if (!stat.isFile()) throw new Error('output path must be a regular file');
    if (stat.nlink !== 1) throw new Error('output path must not be a hard link');
    const path = await realpath(requested);
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== path) {
      throw new Error('output path is outside workspace');
    }
    if (stat.size > this.maxFileBytes) throw new Error('attachment file size limit exceeded');
    const bytes = await readFile(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (expectedSha256 != null && sha256 !== expectedSha256) {
      throw new Error('output file identity changed after qualification');
    }
    return { path, bytes, sha256, size: stat.size };
  }

  async recordProducedOutput({ sessionId, workspace, runId, toolCallId, filePath } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const producerRunId = safeUuid(runId, 'run');
    const observed = await this.readWorkspaceOutput({ workspace, filePath });
    return this.serialize(async () => {
      const events = await this.events();
      const existing = [...this.producedOutputsFrom(events).values()].find((output) => (
        output.sessionId === owner && output.producerRunId === producerRunId
        && output.sourcePath === observed.path && output.sha256 === observed.sha256
      ));
      if (existing) return clone(existing);
      const output = {
        outputHandle: randomUUID(), sessionId: owner, producerRunId,
        toolCallId: String(toolCallId ?? ''), sourcePath: observed.path,
        originalName: safeName(observed.path), bytes: observed.size, sha256: observed.sha256,
        createdAt: new Date().toISOString(),
      };
      await this.append('output_produced', { output });
      return { ...clone(output), state: 'produced', attachmentId: null };
    });
  }

  async producedOutput({ sessionId, outputHandle } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const handle = safeUuid(outputHandle, 'output');
    const output = this.producedOutputsFrom(await this.events()).get(handle);
    if (!output || output.sessionId !== owner) {
      throw Object.assign(new Error('produced output not found'), { status: 404 });
    }
    return clone(output);
  }

  async pendingProducedOutputs({ sessionId, producerRunId = null } = {}) {
    const owner = safeUuid(sessionId, 'session');
    return clone([...this.producedOutputsFrom(await this.events()).values()]
      .filter((output) => output.sessionId === owner && output.state === 'produced'
        && (producerRunId == null || output.producerRunId === String(producerRunId)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
  }

  async markProducedOutputRegistered({ sessionId, outputHandle, attachmentId, registeringRunId } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const handle = safeUuid(outputHandle, 'output');
    const artifactId = safeUuid(attachmentId, 'attachment');
    const runId = safeUuid(registeringRunId, 'run');
    return this.serialize(async () => {
      const events = await this.events();
      const output = this.producedOutputsFrom(events).get(handle);
      if (!output || output.sessionId !== owner) {
        throw Object.assign(new Error('produced output not found'), { status: 404 });
      }
      if (output.state === 'registered') {
        if (output.attachmentId !== artifactId) throw new Error('output handle is already registered');
        return clone(output);
      }
      await this.append('output_registered_from_provenance', {
        sessionId: owner, outputHandle: handle, attachmentId: artifactId, registeringRunId: runId,
      });
      return this.producedOutput({ sessionId: owner, outputHandle: handle });
    });
  }

  async receive({
    sessionId, originalName, declaredMime = null, bytes, direction = 'input', sourcePath = null,
    revisesAttachmentId = null, providerIdentity = null,
  } = {}) {
    const content = Buffer.from(bytes ?? []);
    async function* chunks() { yield content; }
    return this.receiveStream({
      sessionId, originalName, declaredMime, stream: chunks(), direction, sourcePath, revisesAttachmentId,
      providerIdentity,
    });
  }

  async receiveStream({
    sessionId, originalName, declaredMime = null, stream, direction = 'input', sourcePath = null,
    revisesAttachmentId = null, providerIdentity = null,
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
        bytes: total, sha256: digest,
        objectRelativePath: relative(this.directory, storedPath).split(sep).join('/'),
        createdAt: new Date().toISOString(),
        ...(direction === 'output' ? {
          artifactFamilyId: revision?.artifactFamilyId ?? attachmentId,
          artifactVersion: revision?.artifactVersion ?? 1,
          ...(revision?.previousAttachmentId ? { previousAttachmentId: revision.previousAttachmentId } : {}),
        } : {}),
        ...(sourcePath ? { sourcePath } : {}),
        ...(providerIdentity ? { providerIdentity: clone(providerIdentity) } : {}),
      };
      await this.append(record.direction === 'output' ? 'output_registered' : 'received', { record });
      const liveRecord = { ...clone(record), storedPath: resolve(this.directory, record.objectRelativePath) };
      return { ...liveRecord, ...publicRecord(liveRecord) };
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

  async publicationForArtifact({ sessionId, attachmentId } = {}) {
    const owner = safeUuid(sessionId, 'session'); const id = safeUuid(attachmentId, 'attachment');
    const events = await this.events(); const record = this.recordsFrom(events).get(id);
    if (!record || record.sessionId !== owner || record.direction !== 'output') {
      throw Object.assign(new Error('result artifact not found'), { status: 404 });
    }
    const batch = [...this.producedOutputBatchesFrom(events).values()].find((candidate) => (
      candidate.sessionId === owner && candidate.artifactIds?.includes(id)
    ));
    return batch?.publication?.state === 'published_verified' && batch.publication.undoHandle
      ? clone(batch.publication) : null;
  }

  async link({ sessionId, attachmentIds = [], messageId, runId = null, inputId = null } = {}) {
    const owner = safeUuid(sessionId, 'session');
    if (!String(messageId ?? '').trim() || (!String(runId ?? '').trim() && !String(inputId ?? '').trim())) {
      throw new TypeError('messageId and runId or inputId are required');
    }
    const ids = [...new Set(attachmentIds.map((id) => safeUuid(id, 'attachment')))];
    return this.serialize(async () => {
      const records = this.recordsFrom(await this.events());
      for (const id of ids) {
        const record = records.get(id);
        if (!record || record.sessionId !== owner) throw Object.assign(new Error('attachment not found'), { status: 404 });
      }
      await this.append('linked', { sessionId: owner, attachmentIds: ids, messageId: String(messageId),
        runId: runId == null ? null : String(runId), inputId: inputId == null ? null : String(inputId) });
      return Promise.all(ids.map((attachmentId) => this.get({ sessionId: owner, attachmentId })));
    });
  }

  async abortInputLink({ sessionId, inputId } = {}) {
    const owner = safeUuid(sessionId, 'session'); const id = String(inputId ?? '').trim();
    if (!id) throw new TypeError('inputId is required');
    return this.serialize(async () => {
      await this.append('input_link_aborted', { sessionId: owner, inputId: id });
      return { inputId: id, state: 'aborted' };
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

  async registerOutput({
    sessionId, workspace, filePath, revisesAttachmentId = null, expectedSha256 = null,
    providerIdentity = null,
  } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const observed = await this.readWorkspaceOutput({ workspace, filePath, expectedSha256 });
    return this.receive({
      sessionId: owner, originalName: basename(observed.path), bytes: observed.bytes,
      direction: 'output', sourcePath: observed.path, revisesAttachmentId, providerIdentity,
    });
  }

  async registerExistingOutput({ sessionId, filePath, expectedSha256 = null } = {}) {
    const owner = safeUuid(sessionId, 'session');
    const source = await realpath(String(filePath ?? ''));
    const before = await lstat(source);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      throw new Error('existing output path must be a regular single-link file');
    }
    if (before.size > this.maxFileBytes) throw new Error('attachment file size limit exceeded');
    const bytes = await readFile(source); const after = await lstat(source);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
      || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs) throw new Error('existing output identity changed while reading');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (expectedSha256 != null && expectedSha256 !== sha256) {
      throw new Error('existing output identity changed after qualification');
    }
    return this.receive({ sessionId: owner, originalName: basename(source), bytes,
      direction: 'output', sourcePath: source });
  }

  async readContent({ sessionId, attachmentId } = {}) {
    const record = await this.get({ sessionId, attachmentId });
    return { record, bytes: await readFile(record.storedPath) };
  }

  async prepareForUpload({ sessionId, attachmentId } = {}) {
    const { record, bytes } = await this.readContent({ sessionId, attachmentId });
    if (record.direction !== 'input' || !record.links?.some((link) => link.runId)) {
      throw new Error('managed browser download artifact not found');
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== record.bytes || sha256 !== record.sha256) throw new Error('managed browser download artifact changed');
    const directory = join(this.prepared, record.attachmentId); await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, safeName(record.originalName));
    let existing = null;
    try { existing = await lstat(path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error('prepared upload path is unsafe');
    if (existing) {
      const current = await readFile(path);
      if (current.length === bytes.length && createHash('sha256').update(current).digest('hex') === sha256) {
        return { path: await realpath(path), bytes: bytes.length, sha256, mimeType: record.mimeType, attachmentId: record.attachmentId };
      }
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, path); await chmod(path, 0o600); }
    finally { await unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; }); }
    return { path: await realpath(path), bytes: bytes.length, sha256, mimeType: record.mimeType, attachmentId: record.attachmentId };
  }
}
