import { randomBytes } from 'node:crypto';

const API_ROOT = 'https://www.googleapis.com/drive/v3';
const UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3';
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,parents,webViewLink,capabilities(canDownload,canEdit),md5Checksum';
const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';
const DEFAULT_EXPORT = Object.freeze({
  'application/vnd.google-apps.document': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx',
  },
  'application/vnd.google-apps.drawing': { mime: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.script': { mime: 'application/vnd.google-apps.script+json', extension: '.json' },
  'application/vnd.google-apps.vid': { mime: 'video/mp4', extension: '.mp4' },
});
const EXPORT_EXTENSIONS = new Map(Object.values(DEFAULT_EXPORT).map((entry) => [entry.mime, entry.extension]));

function fileId(value) {
  const id = String(value ?? '');
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(id)) throw new TypeError('valid Google Drive file id is required');
  return id;
}

function safeFile(value) {
  if (!value?.id || !value?.name || !value?.mimeType) throw new Error('Google Drive returned invalid file metadata');
  return {
    id: String(value.id), name: String(value.name), mimeType: String(value.mimeType),
    modifiedTime: value.modifiedTime == null ? null : String(value.modifiedTime),
    size: value.size == null ? null : String(value.size),
    parents: Array.isArray(value.parents) ? value.parents.map(String).slice(0, 20) : [],
    webViewLink: value.webViewLink == null ? null : String(value.webViewLink),
    capabilities: {
      canDownload: value.capabilities?.canDownload === true,
      canEdit: value.capabilities?.canEdit === true,
    },
    md5Checksum: value.md5Checksum == null ? null : String(value.md5Checksum),
  };
}

function escapeQuery(value) {
  return String(value ?? '').normalize('NFKC').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function safeName(name) {
  const value = String(name ?? '').normalize('NFC').trim();
  if (!value || value.length > 255 || /[\0/]/u.test(value)) throw new TypeError('valid Google Drive file name is required');
  return value;
}

function parentList(parentId) { return parentId == null ? undefined : [fileId(parentId)]; }

function withExtension(name, extension) {
  return name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase()) ? name : `${name}${extension}`;
}

export function makeGoogleDriveApi({
  credential, fetchImpl = globalThis.fetch, onUnauthorized = null, onAuthRejected = null,
} = {}) {
  if (typeof credential !== 'function') throw new TypeError('Google Drive credential source is required');

  async function request(url, options = {}, { json = true } = {}) {
    let current = await credential();
    const send = (value) => fetchImpl(url, {
      ...options,
      headers: { ...(options.headers ?? {}), authorization: `Bearer ${value.accessToken}` },
    });
    let response = await send(current);
    if (response.status === 401 && typeof onUnauthorized === 'function'
      && Number.isInteger(current.generation)) {
      await response.body?.cancel().catch(() => {});
      current = await onUnauthorized({ failedGeneration: current.generation });
      response = await send(current);
      if (response.status === 401 && typeof onAuthRejected === 'function') {
        await onAuthRejected({ failedGeneration: current.generation });
      }
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Google Drive 요청을 완료하지 못했어요 (${response.status}).`), {
        status: response.status, reason: response.status === 401 ? 'credential_rejected'
          : response.status === 403 ? 'permission_denied' : 'drive_request_failed',
      });
    }
    if (!json) return response;
    const parsed = await response.json().catch(() => null);
    if (!parsed || typeof parsed !== 'object') throw Object.assign(new Error('Google Drive 응답을 읽지 못했어요.'), {
      status: 502, reason: 'invalid_drive_response',
    });
    return parsed;
  }

  async function metadata(id) {
    const url = new URL(`${API_ROOT}/files/${encodeURIComponent(fileId(id))}`);
    url.searchParams.set('fields', FILE_FIELDS);
    url.searchParams.set('supportsAllDrives', 'true');
    return safeFile(await request(url));
  }

  return {
    async search({ query, pageSize = 20, pageToken = null } = {}) {
      const needle = String(query ?? '').normalize('NFKC').trim();
      if (!needle || needle.length > 500) throw new TypeError('Google Drive search query is required');
      const size = Number(pageSize);
      if (!Number.isInteger(size) || size < 1 || size > 100) throw new TypeError('Google Drive page size is invalid');
      const escaped = escapeQuery(needle);
      const url = new URL(`${API_ROOT}/files`);
      url.searchParams.set('q', `trashed = false and (name contains '${escaped}' or fullText contains '${escaped}')`);
      url.searchParams.set('spaces', 'drive');
      url.searchParams.set('orderBy', 'modifiedTime desc');
      url.searchParams.set('pageSize', String(size));
      url.searchParams.set('fields', `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`);
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken != null) {
        const token = String(pageToken);
        if (!token || token.length > 2_000) throw new TypeError('Google Drive page token is invalid');
        url.searchParams.set('pageToken', token);
      }
      const result = await request(url);
      return {
        files: Array.isArray(result.files) ? result.files.map(safeFile).slice(0, size) : [],
        nextPageToken: result.nextPageToken == null ? null : String(result.nextPageToken),
        incompleteSearch: result.incompleteSearch === true,
      };
    },
    metadata,
    async download({ fileId: id, exportMime = null } = {}) {
      const file = await metadata(id);
      if (!file.capabilities.canDownload) throw new Error('Google Drive download is not allowed for this file');
      let url;
      let mimeType = file.mimeType;
      let originalName = file.name;
      if (file.mimeType.startsWith(GOOGLE_NATIVE_PREFIX)) {
        const defaultExport = DEFAULT_EXPORT[file.mimeType];
        const requestedMime = exportMime == null ? defaultExport?.mime : String(exportMime);
        if (!defaultExport || (!EXPORT_EXTENSIONS.has(requestedMime) && requestedMime !== defaultExport.mime)) {
          throw new Error('Google Drive native file export format is not supported');
        }
        url = new URL(`${API_ROOT}/files/${encodeURIComponent(file.id)}/export`);
        url.searchParams.set('mimeType', requestedMime);
        mimeType = requestedMime;
        originalName = withExtension(file.name, EXPORT_EXTENSIONS.get(requestedMime) ?? defaultExport.extension);
      } else {
        url = new URL(`${API_ROOT}/files/${encodeURIComponent(file.id)}`);
        url.searchParams.set('alt', 'media');
      }
      const response = await request(url, {}, { json: false });
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) throw new Error('Google Drive file exceeds the download limit');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('Google Drive file exceeds the download limit');
      return { file, originalName, mimeType, bytes };
    },
    async createFolder({ name, parentId = null } = {}) {
      const body = {
        name: safeName(name), mimeType: 'application/vnd.google-apps.folder',
        ...(parentList(parentId) ? { parents: parentList(parentId) } : {}),
      };
      const url = new URL(`${API_ROOT}/files`);
      url.searchParams.set('fields', FILE_FIELDS);
      url.searchParams.set('supportsAllDrives', 'true');
      return safeFile(await request(url, {
        method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      }));
    },
    async rename({ fileId: id, name } = {}) {
      const file = await metadata(id);
      if (!file.capabilities.canEdit) throw new Error('Google Drive edit is not allowed for this file');
      const url = new URL(`${API_ROOT}/files/${encodeURIComponent(file.id)}`);
      url.searchParams.set('fields', FILE_FIELDS);
      url.searchParams.set('supportsAllDrives', 'true');
      return safeFile(await request(url, {
        method: 'PATCH', headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ name: safeName(name) }),
      }));
    },
    async upload({ name, mimeType, bytes, parentId = null } = {}) {
      const content = Buffer.from(bytes ?? []);
      if (!content.length || content.length > MAX_DOWNLOAD_BYTES) throw new TypeError('Google Drive upload bytes are invalid');
      const type = String(mimeType ?? 'application/octet-stream');
      const metadataBody = {
        name: safeName(name), ...(parentList(parentId) ? { parents: parentList(parentId) } : {}),
      };
      const boundary = `t5_${randomBytes(16).toString('hex')}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadataBody)}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: ${type}\r\n\r\n`), content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const url = new URL(`${UPLOAD_ROOT}/files`);
      url.searchParams.set('uploadType', 'multipart');
      url.searchParams.set('fields', FILE_FIELDS);
      url.searchParams.set('supportsAllDrives', 'true');
      return safeFile(await request(url, {
        method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body,
      }));
    },
    async replace({ fileId: id, mimeType, bytes } = {}) {
      const file = await metadata(id);
      if (!file.capabilities.canEdit) throw new Error('Google Drive edit is not allowed for this file');
      if (file.mimeType.startsWith(GOOGLE_NATIVE_PREFIX)) {
        throw new Error('Google native document content requires a specialized Google Workspace API');
      }
      const content = Buffer.from(bytes ?? []);
      if (!content.length || content.length > MAX_DOWNLOAD_BYTES) throw new TypeError('Google Drive replacement bytes are invalid');
      const url = new URL(`${UPLOAD_ROOT}/files/${encodeURIComponent(file.id)}`);
      url.searchParams.set('uploadType', 'media');
      url.searchParams.set('fields', FILE_FIELDS);
      url.searchParams.set('supportsAllDrives', 'true');
      return safeFile(await request(url, {
        method: 'PATCH', headers: { 'content-type': String(mimeType ?? file.mimeType) }, body: content,
      }));
    },
  };
}
