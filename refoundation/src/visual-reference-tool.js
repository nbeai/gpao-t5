import { lookup } from 'node:dns/promises';

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
    const mimeType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw previewError('unsupported_image_mime', 'qualification', 'preview response is not an image');
    }
    const bytes = await imageBytes(response);
    const detected = detectAttachmentType(bytes, `preview.${mimeType.split('/')[1] ?? 'img'}`);
    if (detected.kind !== 'image' || !ALLOWED_IMAGE_TYPES.has(detected.mimeType)) {
      throw previewError('invalid_image_bytes', 'qualification', 'preview bytes are not a supported image');
    }
    return {
      url, mimeType: detected.mimeType, declaredMimeType: mimeType,
      bytes, status: response.status,
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
  researchTool, attachments, sessionId, fetchImpl = globalThis.fetch,
  resolveHost = defaultResolveHost, timeoutMs = 15_000,
} = {}) {
  if (!researchTool || !attachments || !sessionId) throw new TypeError('visual reference inputs are required');
  const accumulated = [];
  return {
    name: 'visual_reference',
    capabilityGroup: 'visual_reference',
    searchTerms: [
      'visual references', 'design examples', 'reference images', 'browser screenshot',
      '시각 참고자료', '디자인 참고 이미지', '인스타그램 피드',
    ],
    description: 'Find 3 to 5 visual or design references and return T5-managed preview images bound to verified source pages. A previewed or already_satisfied result means the visual-reference goal is complete: embed those previewUrl images in the answer with source links and do not call another web or browser tool. If fewer previews are available, show only those and state the shortfall; do not open a visible browser for ordinary image discovery. Do not use this for ordinary factual web research or image generation.',
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
      if (accumulated.length >= 3) return {
        state: 'already_satisfied', requested: limit, previews: accumulated.slice(0, 5), failures: [],
        coverage: { previewed: accumulated.length }, stopFurtherResearch: true,
        deactivatedTools: ['visual_reference'],
        completedCapabilityGroups: ['visual_reference'],
      };
      const research = await researchTool.execute({
        query: String(args.query ?? '').trim(), sourceLimit: Math.min(6, Math.max(3, limit + 1)),
        queries: null, domains: args.domains ?? [],
      }, context);
      const metadata = Array.isArray(research.selectedPreviewMetadata)
        ? research.selectedPreviewMetadata
        : (research.sources ?? []).map((source) => ({
          title: source.title, candidateUrl: source.candidateUrl,
          sourceUrl: source.source?.finalUrl ?? source.candidateUrl,
          images: [
            ...(source.source?.previewImageUrl ? [{ url: source.source.previewImageUrl, provenance: 'source_page_metadata' }] : []),
            ...(source.candidatePreviewImageUrl ? [{ url: source.candidatePreviewImageUrl, provenance: 'search_provider_result' }] : []),
          ],
        }));
      const candidates = []; const seenImages = new Set();
      for (const source of metadata) {
        for (const image of source.images ?? []) {
          if (!image?.url || seenImages.has(image.url)) continue;
          seenImages.add(image.url); candidates.push({ source, image }); break;
        }
        if (candidates.length >= limit) break;
      }
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
      const rows = await Promise.all(candidates.map(async ({ source, image: imageCandidate }, index) => {
        const stages = [{ stage: 'candidate', state: 'observed', imageUrl: imageCandidate.url,
          provenance: imageCandidate.provenance ?? 'unknown' }];
        try {
          const image = await fetchManagedImage(imageCandidate.url, { fetchImpl, resolveHost, signal });
          stages.push({ stage: 'fetch', state: 'succeeded', finalUrl: image.url, httpStatus: image.status });
          stages.push({
            stage: 'qualification', state: 'succeeded', mimeType: image.mimeType,
            declaredMimeType: image.declaredMimeType, bytes: image.bytes.length,
          });
          let record;
          try {
            record = await attachments.receive({
              sessionId, originalName: fileName(index, image.mimeType), declaredMime: image.mimeType,
              bytes: image.bytes, direction: 'output',
            });
          } catch (error) {
            throw previewError('attachment_store_failed', 'attachment', error?.message ?? String(error));
          }
          stages.push({ stage: 'attachment', state: 'succeeded', attachmentId: record.attachmentId });
          return {
            state: 'previewed', title: source.title,
            sourceUrl: source.sourceUrl ?? source.candidateUrl,
            imageSourceUrl: image.url, previewUrl: record.previewUrl,
            previewProvenance: imageCandidate.provenance ?? 'unknown', stages,
            attachmentId: record.attachmentId, mimeType: record.mimeType,
            bytes: record.bytes, sha256: record.sha256,
          };
        } catch (error) {
          const failedStage = error?.previewStage ?? (signal.aborted ? 'fetch' : 'fetch');
          stages.push({ stage: failedStage, state: signal.aborted ? 'cancelled' : 'failed',
            failureCode: signal.aborted ? 'cancelled' : (error?.previewCode ?? 'image_fetch_failed') });
          return {
            state: signal.aborted ? 'cancelled' : 'preview_failed', title: source.title,
            sourceUrl: source.sourceUrl ?? source.candidateUrl,
            imageSourceUrl: imageCandidate.url, stages,
            failureCode: signal.aborted ? 'cancelled' : (error?.previewCode ?? 'image_fetch_failed'),
            failedStage, reason: error?.message ?? String(error),
          };
        }
      }));
      const missing = metadata.filter((source) => !(source.images ?? []).some((image) => image?.url))
        .map((source) => ({
          state: 'preview_failed', title: source.title,
          sourceUrl: source.sourceUrl ?? source.candidateUrl,
          failureCode: 'preview_metadata_missing', failedStage: 'candidate',
          stages: [{ stage: 'candidate', state: 'failed', failureCode: 'preview_metadata_missing' }],
          reason: 'selected source has no preview image metadata',
        }));
      if (!metadata.length) missing.push({
          state: 'preview_failed', title: '', sourceUrl: null,
          failureCode: 'research_no_selected_candidates', failedStage: 'candidate',
          stages: [{ stage: 'candidate', state: 'failed', failureCode: 'research_no_selected_candidates' }],
          reason: 'research returned no selected preview candidates',
        });
      rows.push(...missing);
      const previews = rows.filter((row) => row.state === 'previewed');
      for (const preview of previews) {
        if (!accumulated.some((item) => item.sourceUrl === preview.sourceUrl
          || item.sha256 === preview.sha256)) accumulated.push(preview);
      }
      return {
        state: accumulated.length >= Math.min(3, limit) ? 'previewed' : accumulated.length ? 'partial' : 'no_previews',
        query: research.query, requested: limit, previews: accumulated.slice(0, 5),
        failures: rows.filter((row) => row.state !== 'previewed'),
        coverage: {
          searched: research.candidateCount ?? 0, read: research.readableCount ?? 0,
          previewed: accumulated.length,
        },
        stopFurtherResearch: accumulated.length >= 3,
        verificationMissing: accumulated.length < Math.min(3, limit),
        ...(accumulated.length >= 3 ? {
          deactivatedTools: ['visual_reference'],
          completedCapabilityGroups: ['visual_reference'],
        } : {}),
      };
    },
  };
}
