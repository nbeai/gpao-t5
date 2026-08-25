const MAX_CANDIDATES = 20;

function normalizedUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeDedicatedRows(rows, provider) {
  const candidates = [];
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const imageUrl = normalizedUrl(row?.imageUrl ?? row?.image_url ?? row?.link);
    const contextUrl = normalizedUrl(row?.contextUrl ?? row?.context_url ?? row?.contextLink ?? row?.sourceUrl);
    if (!imageUrl || !contextUrl) continue;
    candidates.push({
      title: String(row?.title ?? '').trim(), imageUrl, contextUrl,
      ...(positiveInteger(row?.width) ? { width: positiveInteger(row.width) } : {}),
      ...(positiveInteger(row?.height) ? { height: positiveInteger(row.height) } : {}),
      ...(positiveInteger(row?.bytes ?? row?.byteSize) ? { byteSize: positiveInteger(row?.bytes ?? row?.byteSize) } : {}),
      ...(normalizedUrl(row?.thumbnailUrl ?? row?.thumbnail_url) ? {
        thumbnailUrl: normalizedUrl(row?.thumbnailUrl ?? row?.thumbnail_url),
      } : {}),
      ...(row?.rights ? { rights: String(row.rights) } : {}),
      provider: { id: provider.id, label: provider.label ?? provider.id, tier: 'dedicated',
        rank: positiveInteger(row?.rank) ?? index + 1 },
    });
  }
  return candidates;
}

function structuredFieldRows(searchResult, provider) {
  const candidates = [];
  for (const source of searchResult?.candidates ?? []) {
    const contextUrl = normalizedUrl(source?.url);
    if (!contextUrl) continue;
    for (const [imageIndex, image] of (source.previewImages ?? []).entries()) {
      const imageUrl = normalizedUrl(image?.url);
      if (!imageUrl) continue;
      candidates.push({
        title: String(source?.title ?? '').trim(), imageUrl, contextUrl,
        ...(positiveInteger(image?.width) ? { width: positiveInteger(image.width) } : {}),
        ...(positiveInteger(image?.height) ? { height: positiveInteger(image.height) } : {}),
        provider: {
          id: provider.id, label: provider.label ?? provider.id,
          tier: 'structured_search_fields', field: image.providerField ?? 'unknown',
          rank: positiveInteger(source?.rank) ?? candidates.length + imageIndex + 1,
        },
      });
    }
  }
  return candidates;
}

async function availability(provider) {
  try { return await provider.available(); }
  catch (error) { return { available: false, reason: error?.message ?? String(error) }; }
}

export function makeImageSearchTool({ providers = [], sourceSearchTool = null } = {}) {
  for (const provider of providers) {
    if (!provider?.id || typeof provider.available !== 'function'
      || (typeof provider.searchImages !== 'function'
        && !(provider.imageCandidateMode === 'structured_search_fields'
          && typeof provider.search === 'function'))) {
      throw new TypeError('image search providers require id, available, and a qualified candidate route');
    }
  }
  const dedicated = providers.filter((provider) => typeof provider?.searchImages === 'function');
  const structured = providers.filter((provider) => (
    provider?.imageCandidateMode === 'structured_search_fields'
    && typeof provider?.search === 'function'
  ));
  return {
    name: 'image_search',
    async execute(args = {}, context = {}) {
      const query = String(args.query ?? '').trim();
      if (!query) throw new TypeError('query is required');
      const requested = args.limit == null ? 6 : Number(args.limit);
      if (!Number.isInteger(requested) || requested < 1 || requested > MAX_CANDIDATES) {
        throw new TypeError(`limit must be between 1 and ${MAX_CANDIDATES}`);
      }
      const domains = args.domains == null ? [] : args.domains;
      const candidates = []; const failures = []; const calls = [];
      const seen = new Set();
      const dedicatedFacts = await Promise.all(dedicated.map(async (provider) => ({
        provider, fact: await availability(provider),
      })));
      const structuredFacts = await Promise.all(structured.map(async (provider) => ({
        provider, fact: await availability(provider),
      })));
      const add = (rows) => {
        for (const row of rows) {
          const identity = `${row.imageUrl}\n${row.contextUrl}`;
          if (seen.has(identity)) continue;
          seen.add(identity); candidates.push({ ...row, rank: candidates.length + 1 });
          if (candidates.length >= requested) break;
        }
      };
      for (const { provider, fact } of dedicatedFacts) {
        if (candidates.length >= requested) break;
        if (fact?.available !== true) {
          failures.push({ stage: 'candidate', code: 'image_provider_unavailable',
            provider: provider.id, reason: fact?.reason ?? 'provider unavailable' });
          continue;
        }
        const startedAt = performance.now();
        try {
          const rows = await provider.searchImages(query, {
            limit: requested - candidates.length, domains, signal: context.signal,
            resourceObserver: context.resourceRun?.modelObserver?.({
              logicalCallId: ['tool', context.toolCallId, 'image-search', provider.id].join(':'),
              purpose: 'tool_internal_image_search',
            }),
          });
          const normalized = normalizeDedicatedRows(rows, provider);
          calls.push({ provider: provider.id, tier: 'dedicated', wallMs: performance.now() - startedAt,
            candidates: normalized.length });
          if (!normalized.length) failures.push({ stage: 'candidate', code: 'image_provider_no_candidates',
            provider: provider.id, reason: 'dedicated image provider returned no usable candidates' });
          add(normalized);
        } catch (error) {
          calls.push({ provider: provider.id, tier: 'dedicated', wallMs: performance.now() - startedAt,
            candidates: 0 });
          failures.push({ stage: 'candidate', code: context.signal?.aborted ? 'cancelled' : 'image_provider_failed',
            provider: provider.id, reason: error?.message ?? String(error) });
        }
      }
      if (candidates.length < requested && sourceSearchTool) {
        for (const { provider, fact } of structuredFacts) {
          if (candidates.length >= requested) break;
          if (fact?.available !== true) {
            failures.push({ stage: 'candidate', code: 'structured_image_fields_unavailable',
              provider: provider.id, reason: fact?.reason ?? 'provider unavailable' });
            continue;
          }
          const startedAt = performance.now();
          try {
            const result = await sourceSearchTool.execute({
              query, provider: provider.id, limit: Math.min(MAX_CANDIDATES, requested * 2), domains,
            }, context);
            const normalized = structuredFieldRows(result, provider);
            calls.push({ provider: provider.id, tier: 'structured_search_fields',
              wallMs: performance.now() - startedAt, candidates: normalized.length });
            if (!normalized.length) failures.push({
              stage: 'candidate',
              code: result?.state === 'candidates' ? 'provider_image_fields_absent' : 'structured_image_search_failed',
              provider: provider.id,
              reason: result?.state === 'candidates'
                ? 'search response contained no structured image fields'
                : (result?.error ?? `structured search ended as ${result?.state ?? 'unknown'}`),
            });
            add(normalized);
          } catch (error) {
            calls.push({ provider: provider.id, tier: 'structured_search_fields',
              wallMs: performance.now() - startedAt, candidates: 0 });
            failures.push({ stage: 'candidate', code: context.signal?.aborted ? 'cancelled' : 'structured_image_search_failed',
              provider: provider.id, reason: error?.message ?? String(error) });
          }
        }
      }
      if (!candidates.length && !failures.length) failures.push({
        stage: 'candidate', code: 'dedicated_image_provider_unavailable',
        provider: null, reason: 'no qualified dedicated image provider or structured image-field fallback is configured',
      });
      return {
        state: candidates.length ? 'candidates' : 'unavailable', query, requested,
        candidates, failures, calls,
        providerQualification: {
          dedicated: dedicatedFacts.some(({ fact }) => fact?.available === true)
            ? 'available' : 'unavailable',
          structuredImageFields: structuredFacts.some(({ fact }) => fact?.available === true)
            ? 'available_not_guaranteed' : 'unavailable',
        },
        observedPageContent: false,
      };
    },
  };
}
