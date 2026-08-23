import { lookup } from 'node:dns/promises';

import { isPrivateWebAddress, normalizeWebUrl } from './web-read-tool.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

async function publicHost(url, resolveHost) {
  const host = new URL(url).hostname;
  if (isPrivateWebAddress(host)) return false;
  let rows;
  try { rows = await resolveHost(host); } catch { return false; }
  return rows.length > 0 && !rows.some(isPrivateWebAddress);
}

async function imageBytes(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error('preview image is too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('preview image is too large');
  return bytes;
}

async function fetchManagedImage(rawUrl, {
  fetchImpl, resolveHost, signal, maxRedirects = 3,
} = {}) {
  let url = normalizeWebUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!await publicHost(url, resolveHost)) throw new Error('preview image address is not public');
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'manual', signal,
      headers: { accept: 'image/png,image/jpeg,image/webp,image/gif;q=0.9,*/*;q=0.1' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('preview redirect has no location');
      url = normalizeWebUrl(new URL(location, url).href); continue;
    }
    if (!response.ok) throw new Error(`preview image ${response.status}`);
    const mimeType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) throw new Error('preview response is not an image');
    return { url, mimeType, bytes: await imageBytes(response) };
  }
  throw new Error('too many preview redirects');
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
      const candidates = (research.sources ?? []).filter((source) => (
        source.source?.previewImageUrl || source.candidatePreviewImageUrl
      )).slice(0, limit);
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
      const rows = await Promise.all(candidates.map(async (source, index) => {
        try {
          const pageImage = source.source?.previewImageUrl;
          const image = await fetchManagedImage(pageImage ?? source.candidatePreviewImageUrl, { fetchImpl, resolveHost, signal });
          const record = await attachments.receive({
            sessionId, originalName: fileName(index, image.mimeType), declaredMime: image.mimeType,
            bytes: image.bytes, direction: 'output',
          });
          return {
            state: 'previewed', title: source.title,
            sourceUrl: source.source.finalUrl ?? source.candidateUrl,
            imageSourceUrl: image.url, previewUrl: record.previewUrl,
            previewProvenance: pageImage ? 'source_page_metadata' : 'search_result_image',
            attachmentId: record.attachmentId, mimeType: record.mimeType,
            bytes: record.bytes, sha256: record.sha256,
          };
        } catch (error) {
          return {
            state: signal.aborted ? 'cancelled' : 'preview_failed', title: source.title,
            sourceUrl: source.source?.finalUrl ?? source.candidateUrl,
            reason: error?.message ?? String(error),
          };
        }
      }));
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
        ...(accumulated.length >= 3 ? {
          deactivatedTools: ['visual_reference'],
          completedCapabilityGroups: ['visual_reference'],
        } : {}),
      };
    },
  };
}
