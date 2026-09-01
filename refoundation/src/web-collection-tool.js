import { createHash, randomUUID } from 'node:crypto';

import { runBoundedWebCollection, qualifyWebCollectionSpec } from './web-collection-contract.js';
import { inspectWebCollectionStructure } from './web-collection-structure.js';
import { makeWebReadTool } from './web-read-tool.js';

const MAX_CAPTURE_BYTES = 4_000_000;
const PRODUCT_MAX_RECORDS = 500;

async function boundedResponseText(response, maximum = MAX_CAPTURE_BYTES) {
  if (!response?.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return { text: bytes.subarray(0, maximum).toString('utf8'), bytes: Math.min(bytes.length, maximum),
      truncated: bytes.length > maximum };
  }
  const reader = response.body.getReader(); const chunks = []; let bytes = 0; let truncated = false;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    const remaining = maximum - bytes;
    if (value.byteLength > remaining) {
      chunks.push(Buffer.from(value.subarray(0, Math.max(0, remaining)))); bytes += Math.max(0, remaining);
      truncated = true; await reader.cancel().catch(() => {}); break;
    }
    chunks.push(Buffer.from(value)); bytes += value.byteLength;
  }
  return { text: Buffer.concat(chunks, bytes).toString('utf8'), bytes, truncated };
}

function matchingField(observed, field) {
  return observed.selector === field.selector && observed.source === field.source
    && (observed.attribute ?? null) === (field.attribute ?? null);
}

function validateAgainstStructure(record, spec) {
  const candidate = record.structure.candidates.find((item) => item.itemSelector === spec.itemSelector);
  if (!candidate) throw new Error('collection item selector was not observed');
  for (const field of spec.fields) {
    if (!candidate.fields.some((observed) => matchingField(observed, field))) {
      throw new Error('collection field selector was not observed');
    }
  }
}

function structureDigest(structure) {
  return createHash('sha256').update(JSON.stringify(structure)).digest('hex');
}

export function makeWebCollectionTool({ webReadOptions = {}, makeId = randomUUID, publishResult = null } = {}) {
  const baseFetch = webReadOptions.fetchImpl ?? globalThis.fetch;
  if (typeof baseFetch !== 'function') throw new TypeError('Web collection fetch is required');
  const structures = new Map();

  function registerStructure({ html, url }) {
    const structure = inspectWebCollectionStructure({ html, url });
    if (structure.state !== 'structure_observed') return structure;
    const structureHandle = `web-structure-${makeId()}`;
    const record = { structureHandle, origin: new URL(structure.page.requestedUrl).origin,
      firstUrl: structure.page.requestedUrl, digest: structureDigest(structure), structure };
    structures.set(structureHandle, record);
    return { ...structure, structureHandle, structureDigest: record.digest };
  }

  async function readStaticPage({ url, context = {}, signal = null }) {
    const captures = [];
    const reader = makeWebReadTool({ ...webReadOptions, fetchImpl: async (input, init) => {
      const response = await baseFetch(input, init);
      const status = Number(response.status); const type = String(response.headers?.get?.('content-type') ?? '').toLowerCase();
      if (!(status >= 300 && status < 400) && /(?:text\/html|application\/xhtml\+xml)/u.test(type)
        && typeof response.clone === 'function') {
        const copy = response.clone(); captures.push({ url: String(input), read: boundedResponseText(copy) });
      }
      return response;
    } });
    const observation = await reader.execute({ url, maxChars: 500, visibleBrowser: 'never' }, { ...context, signal });
    const settled = await Promise.all(captures.map(async (capture) => ({ ...capture, ...await capture.read })));
    const captured = settled.at(-1) ?? null;
    const htmlType = ['text/html', 'application/xhtml+xml'].includes(observation?.source?.contentType);
    if (observation?.state !== 'read' || !htmlType || !captured || captured.truncated) {
      return { state: observation?.state ?? 'failed', reason: captured?.truncated
        ? 'collection_page_too_large' : observation?.reason ?? 'collection_static_html_unavailable',
      finalUrl: observation?.source?.finalUrl ?? url, bytes: captured?.bytes ?? 0,
      source: observation?.source ?? null,
      ...(observation?.state === 'dynamic_required' || observation?.state === 'partial_dynamic'
        ? { requiresBrowser: true } : {}) };
    }
    return { state: 'read', finalUrl: observation.source.finalUrl, html: captured.text,
      bytes: captured.bytes, source: observation.source };
  }

  return {
    name: 'web_collection',
    completionProposalOptional: (args = {}) => args.action === 'inspect' || args.outputForm == null,
    capabilityGroup: 'web_collection',
    searchTerms: [
      'collect repeated public website records pages fields pagination dataset spreadsheet',
      '공개 사이트 여러 페이지 목록 항목 필드 수집 크롤링 스크래핑 엑셀',
    ],
    description: 'Collect repeated structured records from bounded public HTML pages without Terminal network code or a second browser. Use inspect once on the exact first page to receive observed item, field, and pagination candidates. Then use collect with that opaque structureHandle, only observed selectors, exact same-origin URLs, required fields, unique keys, and an expected record range. When the user requested an Excel result, set outputForm=xlsx and a user-facing outputName; the Runtime publishes the verified records directly, so do not recreate them with exec or attachment. Use ordinary web_read or web_research for prose and a few sources; use Browser only when inspect reports rendered content is required. This tool never logs in, bypasses access controls, executes page scripts, or writes user files.',
    observePage({ html, url } = {}) {
      const registered = registerStructure({ html, url });
      return registered.state === 'structure_observed' ? registered : null;
    },
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['inspect', 'collect'] },
      url: { type: ['string', 'null'] }, structureHandle: { type: ['string', 'null'], maxLength: 64 },
      urls: { type: ['array', 'null'], maxItems: 12, items: { type: 'string' } },
      itemSelector: { type: ['string', 'null'], maxLength: 300 },
      fields: { type: ['array', 'null'], maxItems: 20, items: { type: 'object', additionalProperties: false,
        properties: { key: { type: 'string', maxLength: 64 }, selector: { type: 'string', maxLength: 300 },
          source: { type: 'string', enum: ['text', 'attribute'] },
          attribute: { type: ['string', 'null'], maxLength: 64 }, required: { type: 'boolean' } },
        required: ['key', 'selector', 'source', 'attribute', 'required'] } },
      uniqueBy: { type: ['array', 'null'], maxItems: 20, items: { type: 'string', maxLength: 64 } },
      expectedMinimum: { type: ['integer', 'null'], minimum: 0, maximum: PRODUCT_MAX_RECORDS },
      expectedMaximum: { type: ['integer', 'null'], minimum: 1, maximum: PRODUCT_MAX_RECORDS },
      outputForm: { type: ['string', 'null'], enum: ['xlsx', null] },
      outputName: { type: ['string', 'null'], maxLength: 180 },
    }, required: ['action', 'url', 'structureHandle', 'urls', 'itemSelector', 'fields', 'uniqueBy',
      'expectedMinimum', 'expectedMaximum', 'outputForm', 'outputName'] },
    projectResultForModel(result) {
      if (result?.state !== 'verified_collection' || !result.artifact) return result;
      return { ...result, records: undefined, recordSample: result.records.slice(0, 3),
        artifact: { attachmentId: result.artifact.attachmentId, originalName: result.artifact.originalName,
          mimeType: result.artifact.mimeType, kind: result.artifact.kind, bytes: result.artifact.bytes,
          artifactFamilyId: result.artifact.artifactFamilyId, artifactVersion: result.artifact.artifactVersion } };
    },
    async execute(args, context = {}) {
      if (args.action === 'inspect') {
        if (!args.url || args.structureHandle || args.urls || args.itemSelector || args.fields || args.uniqueBy
          || args.expectedMinimum != null || args.expectedMaximum != null || args.outputForm || args.outputName) {
          throw new TypeError('inspect arguments are invalid');
        }
        const page = await readStaticPage({ url: args.url, context, signal: context.signal });
        if (page.state !== 'read') return { state: page.state, reason: page.reason,
          source: page.source, ...(page.requiresBrowser ? { activatedTools: ['browser'] } : {}) };
        const structure = registerStructure({ html: page.html, url: page.finalUrl });
        return structure.state === 'structure_observed'
          ? { ...structure, network: { origin: new URL(page.finalUrl).origin, requestCount: 1, bounded: true } }
          : structure;
      }
      if (args.action !== 'collect' || args.url || !args.structureHandle || !Array.isArray(args.urls)
        || !args.itemSelector || !Array.isArray(args.fields) || !Array.isArray(args.uniqueBy)
        || args.expectedMinimum == null || args.expectedMaximum == null
        || (args.outputForm === 'xlsx' && !args.outputName)
        || (args.outputForm == null && args.outputName != null)) throw new TypeError('collect arguments are invalid');
      const record = structures.get(args.structureHandle);
      if (!record) throw new Error('collection structure handle is unavailable');
      const spec = qualifyWebCollectionSpec({ schema: 't5.web-collection-spec.v1', urls: args.urls,
        itemSelector: args.itemSelector, fields: args.fields, uniqueBy: args.uniqueBy,
        expectedRecords: { minimum: args.expectedMinimum, maximum: args.expectedMaximum } });
      if (spec.origin !== record.origin || spec.expectedRecords.maximum > PRODUCT_MAX_RECORDS) {
        throw new Error('collection scope exceeds the observed structure');
      }
      validateAgainstStructure(record, spec);
      const result = await runBoundedWebCollection({ spec, signal: context.signal,
        fetchPage: ({ url, signal }) => readStaticPage({ url, context, signal }) });
      let publication = null;
      if (result.verified && args.outputForm === 'xlsx') {
        if (typeof publishResult !== 'function') throw new Error('Web collection publication is unavailable');
        publication = await publishResult({ result, fields: result.fields,
          outputName: args.outputName, structureDigest: record.digest });
      }
      if (result.verified) structures.delete(args.structureHandle);
      return { ...result, structureHandle: args.structureHandle, structureDigest: record.digest,
        ...(publication ?? {}),
        collector: { kind: 'runtime_selector_collection', generatedProgramExecutions: 0,
          terminalNetworkCalls: 0, pageScriptsExecuted: 0 },
        ...(result.verified ? { stopFurtherResearch: true,
          deactivatedTools: ['web_search', 'web_research'] } : {}) };
    },
  };
}
