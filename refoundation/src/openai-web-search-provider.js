import { makeContextReceipt } from './context-receipt.js';
import { makeTransmissionReceipt } from './transmission-receipt.js';
import {
  reserveProviderAttempt, settleProviderSuccess, settleProviderUnknown,
} from './provider-request-accounting.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function outputCitations(output = []) {
  const titles = new Map();
  for (const item of output) {
    if (item?.type !== 'message') continue;
    for (const content of item.content ?? []) {
      for (const annotation of content?.annotations ?? []) {
        if (annotation?.type !== 'url_citation' || !annotation.url) continue;
        titles.set(String(annotation.url), String(annotation.title ?? '').trim());
      }
    }
  }
  return titles;
}

function searchSources(output = [], limit = 8) {
  const titles = outputCitations(output);
  const seen = new Set();
  const rows = [];
  for (const item of output) {
    if (item?.type !== 'web_search_call') continue;
    const ranked = Array.isArray(item.results) && item.results.length
      ? item.results : item.action?.sources;
    if (!Array.isArray(ranked)) continue;
    for (const source of ranked) {
      const url = String(source?.url ?? '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      rows.push({
        title: String(source?.title ?? titles.get(url) ?? '').trim(),
        url,
        snippet: String(source?.snippet ?? '').trim(),
        sourceType: String(source?.type ?? 'url'),
        ...(source?.image_url ? { image_url: source.image_url } : {}),
        ...(source?.imageUrl ? { imageUrl: source.imageUrl } : {}),
        ...(source?.thumbnail_url ? { thumbnail_url: source.thumbnail_url } : {}),
        ...(source?.thumbnailUrl ? { thumbnailUrl: source.thumbnailUrl } : {}),
        ...(source?.image?.url ? { image: {
          url: source.image.url, width: source.image.width, height: source.image.height,
        } } : {}),
        ...(source?.thumbnail?.url ? { thumbnail: {
          url: source.thumbnail.url, width: source.thumbnail.width, height: source.thumbnail.height,
        } } : {}),
      });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

function safeError(value, secret) {
  const text = String(value ?? '').slice(0, 2_000);
  return secret ? text.split(secret).join('[REDACTED]') : text;
}

export function makeStoredOpenAIWebSearchProvider({
  credentialCatalog,
  connectionId,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!credentialCatalog || typeof credentialCatalog.list !== 'function') {
    throw new TypeError('credential catalog is required');
  }

  async function connection() {
    const available = await credentialCatalog.list();
    return connectionId
      ? available.find((item) => item.id === connectionId && item.kind === 'api_key') ?? null
      : available.find((item) => item.kind === 'api_key' && item.provider === 'openai') ?? null;
  }

  return {
    id: 'openai',
    label: 'OpenAI Web Search',
    // Responses web search may return structured image fields, but it is not a
    // dedicated image-search endpoint and those fields must never be assumed.
    imageCandidateMode: 'structured_search_fields',
    async available() {
      return await connection()
        ? { available: true }
        : { available: false, reason: 'openai_api_connection_missing' };
    },
    async search(query, { limit = 8, domains = [], signal, resourceObserver } = {}) {
      const selected = await connection();
      if (!selected) throw new Error('OpenAI API connection is not available');
      const credential = await credentialCatalog.select(selected.id);
      const key = String(credential.apiKey ?? '').trim();
      if (!key) throw new Error('OpenAI API connection has no key');
      const baseUrl = String(credential.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
      const body = {
        model: credential.modelId,
        reasoning: { effort: 'low' },
        tools: [{
          type: 'web_search',
          ...(domains.length ? { filters: { allowed_domains: domains } } : {}),
        }],
        tool_choice: 'required',
        include: ['web_search_call.results', 'web_search_call.action.sources'],
        input: [
          `Search the public web for this exact query: ${query}`,
          'Return ranked source pages that directly answer the query.',
          'For today/latest/current requests, prioritize genuinely recent dated articles or primary updates.',
          'Do not rank topic hubs, category pages, search pages, generic indexes, or unrelated aggregators above a directly relevant dated source.',
        ].join(' '),
        store: false,
      };
      const serializedBody = JSON.stringify(body);
      const contextReceipt = makeContextReceipt({
        provider: 'openai_web_search', model: credential.modelId,
        instructions: '', input: body.input, tools: body.tools, sourceMessages: [], body, serializedBody,
      });
      if (signal?.aborted) throw new Error('OpenAI web search cancelled before dispatch');
      contextReceipt.transmissionReceipt = makeTransmissionReceipt({ provider: 'openai_web_search',
        model: credential.modelId, endpoint: `${baseUrl}/responses`, serializedBody });
      const resourceHandle = await reserveProviderAttempt(resourceObserver, {
        provider: 'openai_web_search', model: credential.modelId, attempt: 1, contextReceipt,
      });
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/responses`, {
          method: 'POST', signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: serializedBody,
        });
      } catch (error) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_transport_unknown');
        throw new Error(`OpenAI web search request failed: ${safeError(error?.message ?? error, key)}`);
      }
      const raw = await response.text();
      if (!response.ok) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_http_error', {
          httpStatus: response.status,
        });
        let message = raw;
        try { message = JSON.parse(raw)?.error?.message ?? raw; } catch { /* keep raw */ }
        throw new Error(`OpenAI web search ${response.status}: ${safeError(message, key)}`);
      }
      let json;
      try { json = JSON.parse(raw); }
      catch {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_response_invalid');
        throw new Error('OpenAI web search returned invalid JSON');
      }
      const rows = searchSources(json.output, limit);
      if (!rows.length) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_response_invalid');
        throw new Error('OpenAI web search returned no source candidates');
      }
      await settleProviderSuccess(resourceObserver, resourceHandle, {
        usage: json.usage ?? null, responseId: json.id ?? null,
      });
      return rows;
    },
  };
}
