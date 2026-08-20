import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

import { detectAttachmentType } from './attachment-store.js';
import { EFFECT_SCHEMA } from './exec-tool.js';

const ACTIONS = ['search', 'metadata', 'download', 'create_folder', 'rename', 'upload', 'replace'];
const EFFECT_ACTIONS = new Set(['download', 'create_folder', 'rename', 'upload', 'replace']);
const MAX_FILE_BYTES = 128 * 1024 * 1024;

async function localFile(path, authorize) {
  const value = String(path ?? '');
  if (!isAbsolute(value) || authorize(value) !== true) throw new Error('Google Drive upload path is not authorized');
  const facts = await lstat(value);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1) {
    throw new Error('Google Drive upload requires one regular non-linked file');
  }
  if (facts.size <= 0 || facts.size > MAX_FILE_BYTES) throw new Error('Google Drive upload file size is invalid');
  const bytes = await readFile(value);
  return {
    path: value, bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  };
}

function effectState(args) {
  if (!args.effect?.kind) return 'effect_declaration_required';
  if (args.action === 'download' && args.effect.kind !== 'local_change') return 'local_change_required';
  if (['create_folder', 'rename'].includes(args.action)
    && args.effect.kind !== 'external_change') return 'external_change_required';
  if (['upload', 'replace'].includes(args.action) && args.effect.kind !== 'external_send') return 'external_send_required';
  return null;
}

export function makeGoogleDriveTool({
  api, attachments, sessionId, authorizeEffect, authorizeUploadPath = () => false,
} = {}) {
  if (!api || typeof api.search !== 'function') throw new TypeError('Google Drive API is required');
  if (!attachments || typeof attachments.receive !== 'function') throw new TypeError('attachment store is required');
  if (!sessionId) throw new TypeError('Google Drive tool session is required');
  const tool = {
    name: 'google_drive',
    description: 'Use the verified official Google Drive connection to search file metadata, inspect one file, download or export one file as a T5 result attachment, create a folder, rename one editable file, upload one exact user-authorized local file, or replace one editable non-Google-native blob file. Google Docs, Sheets, Slides, Forms, and other native document content require their specialized Workspace APIs and must not be replaced here. Search results can be incomplete; preserve that fact. Never accept OAuth tokens or secrets in arguments.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ACTIONS },
        query: { type: ['string', 'null'], maxLength: 500 },
        fileId: { type: ['string', 'null'], maxLength: 200 },
        pageSize: { type: ['integer', 'null'], minimum: 1, maximum: 100 },
        pageToken: { type: ['string', 'null'], maxLength: 2_000 },
        exportMime: { type: ['string', 'null'], maxLength: 200 },
        name: { type: ['string', 'null'], maxLength: 255 },
        parentId: { type: ['string', 'null'], maxLength: 200 },
        filePath: { type: ['string', 'null'], description: 'Exact absolute path present in the current user request for upload or replace.' },
        mimeType: { type: ['string', 'null'], maxLength: 200 },
        effect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }] },
      },
      required: [
        'action', 'query', 'fileId', 'pageSize', 'pageToken', 'exportMime',
        'name', 'parentId', 'filePath', 'mimeType', 'effect',
      ],
    },
    async preflight(args = {}, context = {}) {
      if (!ACTIONS.includes(args.action)) throw new TypeError(`unsupported Google Drive action: ${args.action}`);
      if (!EFFECT_ACTIONS.has(args.action)) return { allowed: true };
      const state = effectState(args);
      if (state) return { allowed: false, outcome: 'not_executed', result: { state } };
      if (['upload', 'replace'].includes(args.action)
        && authorizeUploadPath(String(args.filePath ?? '')) !== true) {
        return { allowed: false, outcome: 'not_executed', result: { state: 'upload_path_not_authorized' } };
      }
      if (typeof authorizeEffect !== 'function') return { allowed: true };
      return authorizeEffect(args, context);
    },
    async execute(args = {}) {
      if (args.action === 'search') return { state: 'found', ...(await api.search({
        query: args.query, pageSize: args.pageSize ?? 20, pageToken: args.pageToken,
      })) };
      if (args.action === 'metadata') return { state: 'observed', file: await api.metadata(args.fileId) };
      if (args.action === 'download') {
        const downloaded = await api.download({ fileId: args.fileId, exportMime: args.exportMime });
        const artifact = await attachments.receive({
          sessionId, originalName: downloaded.originalName, declaredMime: downloaded.mimeType,
          bytes: downloaded.bytes, direction: 'output', sourcePath: `google-drive:${downloaded.file.id}`,
        });
        return {
          state: 'downloaded', file: downloaded.file, artifact,
          source: { provider: 'google-workspace', fileId: downloaded.file.id },
        };
      }
      if (args.action === 'create_folder') return {
        state: 'created', file: await api.createFolder({ name: args.name, parentId: args.parentId }),
      };
      if (args.action === 'rename') return {
        state: 'renamed', file: await api.rename({ fileId: args.fileId, name: args.name }),
      };
      const source = await localFile(args.filePath, authorizeUploadPath);
      const detected = detectAttachmentType(source.bytes, basename(source.path));
      const mimeType = args.mimeType ?? detected.mimeType;
      if (args.action === 'upload') return {
        state: 'uploaded',
        file: await api.upload({
          name: args.name ?? basename(source.path), mimeType, bytes: source.bytes, parentId: args.parentId,
        }),
        source: { path: source.path, sha256: source.sha256, bytes: source.size, mimeType },
      };
      return {
        state: 'replaced',
        file: await api.replace({ fileId: args.fileId, mimeType, bytes: source.bytes }),
        source: { path: source.path, sha256: source.sha256, bytes: source.size, mimeType },
      };
    },
  };
  return tool;
}
