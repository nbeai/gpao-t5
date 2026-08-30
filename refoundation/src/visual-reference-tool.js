import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

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
  const reader = response.body?.getReader?.();
  if (!reader) throw previewError('image_body_unreadable', 'fetch', 'preview response body is not stream-readable');
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value ?? []); total += chunk.length;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel('image_too_large').catch(() => {});
        throw previewError('image_too_large', 'qualification', 'preview image is too large');
      }
      chunks.push(chunk);
    }
  } finally { reader.releaseLock?.(); }
  return Buffer.concat(chunks, total);
}

async function decodedImageSize(bytes, mimeType) {
  try {
    const decoder = sharp(bytes, {
      failOn: 'warning', limitInputPixels: 40_000_000, sequentialRead: true, pages: 1,
    });
    const metadata = await decoder.metadata();
    const observedMime = ({ png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' })[metadata.format];
    if (observedMime !== mimeType || !metadata.width || !metadata.height) throw new Error('decoded format mismatch');
    await decoder.clone().resize({ width: 1, height: 1, fit: 'inside', withoutEnlargement: false })
      .raw().toBuffer();
    return { width: metadata.width, height: metadata.height };
  } catch {
    throw previewError('image_decode_failed', 'qualification', 'image pixels could not be decoded');
  }
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
    const dimensions = await decodedImageSize(bytes, detected.mimeType);
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

function abortError(signal, timeout) {
  if (timeout?.aborted && !signal?.aborted) return Object.assign(
    new Error('visual reference operation timed out'), { code: 'VISUAL_REFERENCE_TIMEOUT' },
  );
  return signal?.reason instanceof Error ? signal.reason : new Error('visual reference operation cancelled');
}

function settleWithinSignal(work, operationSignal, callerSignal, timeout) {
  if (operationSignal.aborted) return Promise.reject(abortError(callerSignal, timeout));
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(abortError(callerSignal, timeout)); };
    const cleanup = () => operationSignal.removeEventListener('abort', onAbort);
    operationSignal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(work).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

export function makeVisualReferenceTool({
  imageSearchTool, attachments, sessionId, fetchImpl = globalThis.fetch,
  resolveHost = defaultResolveHost, timeoutMs = 15_000,
} = {}) {
  if (!imageSearchTool || !attachments || !sessionId) throw new TypeError('visual reference inputs are required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120_000) {
    throw new TypeError('visual reference timeout is invalid');
  }
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
        deactivatedTools: ['visual_reference'],
        completedCapabilityGroups: ['visual_reference'],
      };
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
      let search;
      try {
        search = await settleWithinSignal(imageSearchTool.execute({
          query: String(args.query ?? '').trim(), limit: Math.min(20, limit * 3),
          domains: args.domains ?? [],
        }, { ...context, signal }), signal, context.signal, timeout);
      } catch (error) {
        const timedOut = timeout.aborted && !context.signal?.aborted;
        return {
          state: context.signal?.aborted ? 'cancelled' : 'no_previews',
          query: String(args.query ?? '').trim(), requested: limit, previews: [],
          failures: [{ state: timedOut ? 'preview_failed' : 'cancelled', title: '', sourceUrl: null,
            failureCode: timedOut ? 'visual_operation_timeout' : 'cancelled', failedStage: 'candidate',
            stages: [{ stage: 'candidate', state: timedOut ? 'failed' : 'cancelled',
              failureCode: timedOut ? 'visual_operation_timeout' : 'cancelled' }],
            reason: error?.message ?? String(error) }],
          providerQualification: null, providerCalls: [],
          coverage: { requested: limit, candidates: 0, previewed: 0 },
          stopFurtherResearch: true, verificationMissing: true,
          deactivatedTools: ['visual_reference'], completedCapabilityGroups: ['visual_reference'],
        };
      }
      const candidates = search.candidates ?? [];
      const rows = await Promise.all(candidates.map(async (candidate) => {
        const stages = [{ stage: 'candidate', state: 'observed', imageUrl: candidate.imageUrl,
          contextUrl: candidate.contextUrl, provider: candidate.provider }];
        try {
          const image = await settleWithinSignal(
            fetchManagedImage(candidate.imageUrl, { fetchImpl, resolveHost, signal }),
            signal, context.signal, timeout,
          );
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
          const timedOut = timeout.aborted && !context.signal?.aborted;
          const failedStage = error?.previewStage ?? (signal.aborted ? 'fetch' : 'fetch');
          const failureCode = timedOut ? 'visual_operation_timeout'
            : signal.aborted ? 'cancelled' : (error?.previewCode ?? 'image_fetch_failed');
          stages.push({ stage: failedStage, state: timedOut ? 'failed' : signal.aborted ? 'cancelled' : 'failed',
            failureCode });
          return {
            state: signal.aborted && !timedOut ? 'cancelled' : 'preview_failed', title: candidate.title,
            sourceUrl: candidate.contextUrl, imageSourceUrl: candidate.imageUrl,
            provider: candidate.provider, stages,
            failureCode,
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
        deactivatedTools: ['visual_reference'],
        completedCapabilityGroups: ['visual_reference'],
      };
    },
  };
}
