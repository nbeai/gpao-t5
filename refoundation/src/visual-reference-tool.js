import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';

import { detectAttachmentType } from './attachment-store.js';
import { isPrivateWebAddress, normalizeWebUrl } from './web-read-tool.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function previewError(code, stage, message) {
  return Object.assign(new Error(message), { previewCode: code, previewStage: stage });
}

async function publicHost(url, resolveHost) {
  const host = new URL(url).hostname;
  if (isPrivateWebAddress(host)) return false;
  let rows;
  try { rows = await resolveHost(host); } catch { return false; }
  return rows.length > 0 && !rows.some(isPrivateWebAddress);
}

async function imageBytes(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw previewError('image_too_large', 'qualification', 'preview image is too large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw previewError('image_too_large', 'qualification', 'preview image is too large');
  return bytes;
}

function decodedImageSize(bytes, mimeType) {
  if (mimeType === 'image/png' && bytes.length >= 24) {
    let offset = 8; let hasIdat = false; let hasIend = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset); const end = offset + 12 + length;
      if (end > bytes.length) break;
      const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      if (type === 'IDAT') hasIdat = true;
      if (type === 'IEND' && length === 0) { hasIend = true; break; }
      offset = end;
    }
    const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
    if (width > 0 && height > 0 && hasIdat && hasIend) return { width, height };
  }
  if (mimeType === 'image/gif' && bytes.length >= 10) {
    const width = bytes.readUInt16LE(6); const height = bytes.readUInt16LE(8);
    if (width > 0 && height > 0 && bytes.includes(0x3b, 10)) return { width, height };
  }
  if (mimeType === 'image/jpeg' && bytes.length >= 4) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]; offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (startOfFrame.has(marker) && length >= 7) {
        const height = bytes.readUInt16BE(offset + 3); const width = bytes.readUInt16BE(offset + 5);
        if (width > 0 && height > 0 && bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) {
          return { width, height };
        }
      }
      offset += length;
    }
  }
  if (mimeType === 'image/webp' && bytes.length >= 30) {
    const riffComplete = bytes.readUInt32LE(4) + 8 <= bytes.length;
    const chunk = bytes.subarray(12, 16).toString('ascii');
    if (riffComplete && chunk === 'VP8X') {
      const width = 1 + bytes.readUIntLE(24, 3); const height = 1 + bytes.readUIntLE(27, 3);
      if (width > 0 && height > 0) return { width, height };
    }
    if (riffComplete && chunk === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      const width = bytes.readUInt16LE(26) & 0x3fff; const height = bytes.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
    if (riffComplete && chunk === 'VP8L' && bytes[20] === 0x2f && bytes.length >= 25) {
      const packed = bytes.readUInt32LE(21);
      const width = 1 + (packed & 0x3fff); const height = 1 + ((packed >>> 14) & 0x3fff);
      if (width > 0 && height > 0) return { width, height };
    }
  }
  throw previewError('image_decode_failed', 'qualification', 'image dimensions could not be decoded');
}

async function fetchManagedImage(rawUrl, {
  fetchImpl, resolveHost, signal, maxRedirects = 3,
} = {}) {
  let url = normalizeWebUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!await publicHost(url, resolveHost)) throw previewError('image_address_not_public', 'fetch', 'preview image address is not public');
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'manual', signal,
      headers: { accept: 'image/png,image/jpeg,image/webp,image/gif;q=0.9,*/*;q=0.1' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw previewError('redirect_without_location', 'fetch', 'preview redirect has no location');
      url = normalizeWebUrl(new URL(location, url).href); continue;
    }
    if (!response.ok) throw previewError('image_http_error', 'fetch', `preview image ${response.status}`);
    const declaredMimeType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const bytes = await imageBytes(response);
    const detected = detectAttachmentType(bytes, 'preview.img');
    if (detected.kind !== 'image' || !ALLOWED_IMAGE_TYPES.has(detected.mimeType)) {
      throw previewError('invalid_image_bytes', 'qualification', 'preview bytes are not a supported image');
    }
    const dimensions = decodedImageSize(bytes, detected.mimeType);
    return {
      url, mimeType: detected.mimeType, declaredMimeType,
      bytes, status: response.status, ...dimensions,
    };
  }
  throw previewError('too_many_redirects', 'fetch', 'too many preview redirects');
}

function defaultResolveHost(host) {
  return lookup(host, { all: true, verbatim: true }).then((rows) => rows.map((row) => row.address));
}

function fileName(index, mimeType) {
  const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' })[mimeType] ?? '.img';
  return `visual-reference-${index + 1}${extension}`;
}

export function makeVisualReferenceTool({
  imageSearchTool, attachments, sessionId, fetchImpl = globalThis.fetch,
  resolveHost = defaultResolveHost, timeoutMs = 15_000,
} = {}) {
  if (!imageSearchTool || !attachments || !sessionId) throw new TypeError('visual reference inputs are required');
  const accumulated = [];
  return {
    name: 'visual_reference',
    capabilityGroup: 'visual_reference',
    searchTerms: [
      'visual references', 'design examples', 'reference images', 'browser screenshot',
      '시각 참고자료', '디자인 참고 이미지', '인스타그램 피드',
    ],
    description: 'Find 3 to 5 visual or design references through typed image candidates and return T5-managed preview images bound to source pages. Embed only returned previewUrl images. The result exhausts the configured image-provider route in one call: if fewer previews are available, state the typed shortfall and do not retry through ordinary web research, scraping, a visible browser, or page screenshots. Do not use this for ordinary factual web research or image generation.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string' }, limit: { type: ['integer', 'null'], minimum: 3, maximum: 5 },
        domains: { type: ['array', 'null'], maxItems: 20, items: { type: 'string' } },
      }, required: ['query', 'limit', 'domains'],
    },
    async execute(args = {}, context = {}) {
      const limit = args.limit == null ? 3 : Number(args.limit);
      if (!Number.isInteger(limit) || limit < 3 || limit > 5) throw new TypeError('limit must be between 3 and 5');
      if (accumulated.length >= limit) return {
        state: 'already_satisfied', requested: limit, previews: accumulated.slice(0, 5), failures: [],
        coverage: { requested: limit, previewed: accumulated.length }, stopFurtherResearch: true,
        deactivatedTools: ['visual_reference', 'web_research', 'web_search', 'web_read', 'browser'],
        completedCapabilityGroups: ['visual_reference'],
      };
      const search = await imageSearchTool.execute({
        query: String(args.query ?? '').trim(), limit: Math.min(20, limit * 3),
        domains: args.domains ?? [],
      }, context);
      const candidates = search.candidates ?? [];
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
      const rows = await Promise.all(candidates.map(async (candidate) => {
        const stages = [{ stage: 'candidate', state: 'observed', imageUrl: candidate.imageUrl,
          contextUrl: candidate.contextUrl, provider: candidate.provider }];
        try {
          const image = await fetchManagedImage(candidate.imageUrl, { fetchImpl, resolveHost, signal });
          stages.push({ stage: 'fetch', state: 'succeeded', finalUrl: image.url, httpStatus: image.status });
          stages.push({
            stage: 'qualification', state: 'succeeded', mimeType: image.mimeType,
            declaredMimeType: image.declaredMimeType, bytes: image.bytes.length,
            width: image.width, height: image.height,
          });
          return {
            state: 'qualified', title: candidate.title, sourceUrl: candidate.contextUrl,
            imageSourceUrl: image.url, provider: candidate.provider, stages,
            candidateMetadata: {
              ...(candidate.width ? { width: candidate.width } : {}),
              ...(candidate.height ? { height: candidate.height } : {}),
              ...(candidate.byteSize ? { byteSize: candidate.byteSize } : {}),
              ...(candidate.thumbnailUrl ? { thumbnailUrl: candidate.thumbnailUrl } : {}),
              ...(candidate.rights ? { rights: candidate.rights } : {}),
            },
            image,
          };
        } catch (error) {
          const failedStage = error?.previewStage ?? (signal.aborted ? 'fetch' : 'fetch');
          stages.push({ stage: failedStage, state: signal.aborted ? 'cancelled' : 'failed',
            failureCode: signal.aborted ? 'cancelled' : (error?.previewCode ?? 'image_fetch_failed') });
          return {
            state: signal.aborted ? 'cancelled' : 'preview_failed', title: candidate.title,
            sourceUrl: candidate.contextUrl, imageSourceUrl: candidate.imageUrl,
            provider: candidate.provider, stages,
            failureCode: signal.aborted ? 'cancelled' : (error?.previewCode ?? 'image_fetch_failed'),
            failedStage, reason: error?.message ?? String(error),
          };
        }
      }));
      const failures = rows.filter((row) => row.state !== 'qualified');
      for (const failure of search.failures ?? []) failures.push({
        state: 'preview_failed', title: '', sourceUrl: null,
        failureCode: failure.code, failedStage: failure.stage ?? 'candidate',
        provider: failure.provider ? { id: failure.provider } : null,
        stages: [{ stage: failure.stage ?? 'candidate', state: 'failed', failureCode: failure.code }],
        reason: failure.reason,
      });
      const knownHashes = new Set(accumulated.map((item) => item.sha256));
      for (const qualified of rows.filter((row) => row.state === 'qualified')) {
        const sha256 = qualified.image.bytes.length
          ? createHash('sha256').update(qualified.image.bytes).digest('hex') : null;
        if (knownHashes.has(sha256)) {
          qualified.stages.push({ stage: 'qualification', state: 'failed', failureCode: 'duplicate_image_sha' });
          failures.push({ ...qualified, state: 'preview_failed', failureCode: 'duplicate_image_sha',
            failedStage: 'qualification', reason: 'image bytes duplicate an already selected preview' });
          continue;
        }
        if (accumulated.length >= limit) break;
        let record;
        try {
          record = await attachments.receive({
            sessionId, originalName: fileName(accumulated.length, qualified.image.mimeType),
            declaredMime: qualified.image.mimeType, bytes: qualified.image.bytes, direction: 'output',
          });
        } catch (error) {
          qualified.stages.push({ stage: 'attachment', state: 'failed', failureCode: 'attachment_store_failed' });
          failures.push({ ...qualified, state: 'preview_failed', failureCode: 'attachment_store_failed',
            failedStage: 'attachment', reason: error?.message ?? String(error) });
          continue;
        }
        knownHashes.add(record.sha256);
        qualified.stages.push({ stage: 'attachment', state: 'succeeded', attachmentId: record.attachmentId });
        accumulated.push({
          state: 'previewed', title: qualified.title, sourceUrl: qualified.sourceUrl,
          imageSourceUrl: qualified.imageSourceUrl, previewUrl: record.previewUrl,
          provider: qualified.provider, candidateMetadata: qualified.candidateMetadata,
          stages: qualified.stages,
          attachmentId: record.attachmentId, mimeType: record.mimeType,
          width: qualified.image.width, height: qualified.image.height,
          bytes: record.bytes, sha256: record.sha256,
        });
      }
      if (accumulated.length < limit && !failures.length) failures.push({
        state: 'preview_failed', title: '', sourceUrl: null,
        failureCode: 'image_candidate_shortfall', failedStage: 'candidate',
        stages: [{ stage: 'candidate', state: 'failed', failureCode: 'image_candidate_shortfall' }],
        reason: `provider returned ${candidates.length} usable candidates for ${limit} requested previews`,
      });
      return {
        state: accumulated.length >= limit ? 'previewed' : accumulated.length ? 'partial' : 'no_previews',
        query: search.query, requested: limit, previews: accumulated.slice(0, 5), failures,
        providerQualification: search.providerQualification, providerCalls: search.calls ?? [],
        coverage: {
          requested: limit, candidates: candidates.length, previewed: accumulated.length,
        },
        stopFurtherResearch: true,
        verificationMissing: accumulated.length < limit,
        deactivatedTools: ['visual_reference', 'web_research', 'web_search', 'web_read', 'browser'],
        completedCapabilityGroups: ['visual_reference'],
      };
    },
  };
}
