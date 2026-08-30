function distinctCandidates(candidates, limit) {
  const hosts = new Set(); const selected = [];
  for (const candidate of candidates ?? []) {
    let host;
    try { host = new URL(candidate.url).hostname.toLowerCase(); } catch { continue; }
    if (hosts.has(host)) continue;
    hosts.add(host); selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function hostFact(kind, rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    return { kind, url: url.href, host: url.hostname.toLowerCase() };
  } catch { return null; }
}

function sourceProvenance(candidate, observation) {
  const observed = observation?.source?.provenance ?? {};
  const responsePublisher = observed.responsePublisher
    ?? hostFact('observed_response_host', observation?.source?.finalUrl);
  const canonicalPublisher = observed.canonicalPublisher
    ?? hostFact('page_declared_canonical_host', observation?.source?.canonicalUrl);
  const exactOriginalPublisher = hostFact('observed_exact_original_url', observed.exactOriginalUrl);
  const exactOriginalUrl = exactOriginalPublisher?.url ?? null;
  return {
    schema: 't5.web-source-provenance.v1',
    candidatePublisher: hostFact('search_candidate_host', candidate.url),
    responsePublisher,
    canonicalPublisher,
    contentAttribution: {
      ...(observed.contentAttribution ?? {}),
      kind: 'untrusted_page_claims', instructionAuthority: 'none',
      ...(Array.isArray(observation?.source?.contentAttributionClaims)
        ? { claims: observation.source.contentAttributionClaims }
        : {}),
    },
    exactOriginalUrl,
    exactOriginalPublisher,
    directOriginalLabelAllowed: Boolean(exactOriginalUrl),
    ...(!exactOriginalUrl ? { verificationMissing: 'exact_original_url_not_observed' } : {}),
  };
}

function candidatePreviewImages(candidate, observation) {
  const images = []; const seen = new Set();
  for (const image of candidate.previewImages ?? []) {
    if (!image?.url || seen.has(image.url)) continue;
    seen.add(image.url); images.push({ ...image });
  }
  if (candidate.previewImageUrl && !seen.has(candidate.previewImageUrl)) {
    seen.add(candidate.previewImageUrl); images.push({
      url: candidate.previewImageUrl, provenance: 'search_provider_result',
      providerField: 'legacy_previewImageUrl',
    });
  }
  const pageImage = observation?.source?.previewImageUrl;
  if (pageImage && !seen.has(pageImage)) images.push({
    url: pageImage, provenance: 'source_page_metadata', providerField: 'og_or_twitter_image',
  });
  return images;
}

function compactObservation(candidate, observation) {
  return {
    rank: candidate.rank, title: candidate.title, candidateUrl: candidate.url,
    snippet: candidate.snippet, state: observation?.state ?? 'failed',
    ...(candidate.previewImageUrl ? { candidatePreviewImageUrl: candidate.previewImageUrl } : {}),
    source: observation?.source ?? null,
    provenance: sourceProvenance(candidate, observation),
    ...(observation?.reason ? { reason: observation.reason } : {}),
    ...(observation?.content ? {
      content: {
        format: observation.content.format,
        text: observation.content.text,
        observedChars: observation.content.observedChars,
        outputTruncated: observation.content.outputTruncated,
      },
    } : {}),
  };
}

export function makeWebResearchTool({ searchTool, readTool, timeoutMs = 15_000 } = {}) {
  if (!searchTool || !readTool) throw new TypeError('web research tools are required');
  return {
    name: 'web_research',
    executionMode: 'parallel',
    nestedParallelism: true,
    completionProposalOptional: true,
    capabilityGroup: 'web_observation',
    searchTerms: ['multi source research', 'current trends evidence', '웹 리서치', '시장 조사', '여러 출처'],
    description: 'Read current public-web evidence through 1 to 4 focused search queries. For one narrow current fact, use one query and sourceLimit 1; for comparisons, broad research, or claims requiring corroboration, read 3 to 6 distinct source domains. Returns observed source text and explicit failures; it does not write the conclusion for you. This is a completed bounded observation stage: synthesize from its readable sources instead of opening individual search/read loops. Use web_read directly when the exact URL is already known.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'One focused research query.' },
        queries: { type: ['array', 'null'], minItems: 1, maxItems: 4, items: { type: 'string' },
          description: 'Optional focused angle queries executed together for broad research.' },
        sourceLimit: { type: ['integer', 'null'], minimum: 1, maximum: 6 },
        domains: { type: ['array', 'null'], maxItems: 20, items: { type: 'string' } },
      },
      required: ['query', 'queries', 'sourceLimit', 'domains'],
    },
    async execute(args = {}, context = {}) {
      const query = String(args.query ?? '').trim();
      if (!query) throw new TypeError('query is required');
      const queries = [...new Set((args.queries?.length ? args.queries : [query])
        .map((value) => String(value ?? '').trim()).filter(Boolean))].slice(0, 4);
      if (!queries.length) throw new TypeError('at least one research query is required');
      const sourceLimit = args.sourceLimit == null ? 4 : Number(args.sourceLimit);
      if (!Number.isInteger(sourceLimit) || sourceLimit < 1 || sourceLimit > 6) {
        throw new TypeError('sourceLimit must be between 1 and 6');
      }
      const searches = await Promise.all(queries.map((focused, index) => searchTool.execute({
        query: focused, provider: null, limit: Math.min(20, sourceLimit * 2), domains: args.domains ?? [],
      }, { ...context, resourceChildId: `query-${index + 1}` })));
      const candidates = []; const seen = new Set();
      const largest = Math.max(0, ...searches.map((search) => search.candidates?.length ?? 0));
      for (let rank = 0; rank < largest; rank += 1) {
        for (const search of searches) {
          const candidate = search.candidates?.[rank];
          if (!candidate || seen.has(candidate.url)) continue;
          seen.add(candidate.url); candidates.push(candidate);
        }
      }
      if (!candidates.length) return {
        state: 'search_unavailable', query, queries, searches, sources: [], observedPageContent: false,
      };
      const selected = distinctCandidates(candidates, Math.min(10, sourceLimit * 2));
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
      const observations = await Promise.all(selected.map(async (candidate) => {
        try {
          return compactObservation(candidate, await readTool.execute({
            url: candidate.url, maxChars: 5_000,
          }, { signal }));
        } catch (error) {
          return compactObservation(candidate, {
            state: signal.aborted ? 'cancelled' : 'failed', reason: error?.message ?? String(error),
          });
        }
      }));
      const readable = observations.filter((item) => item.content?.text);
      const unreadable = observations.filter((item) => !item.content?.text);
      const read = readable.length;
      const sources = [...readable.slice(0, sourceLimit), ...unreadable.slice(0, 2)];
      const boundedComplete = read >= Math.min(3, sourceLimit);
      const selectedPreviewMetadata = selected.map((candidate, index) => ({
        rank: candidate.rank, title: candidate.title, candidateUrl: candidate.url,
        sourceUrl: observations[index]?.source?.finalUrl ?? candidate.url,
        provenance: observations[index]?.provenance,
        images: candidatePreviewImages(candidate, observations[index]),
      }));
      return {
        state: read ? 'researched' : 'no_readable_sources', query,
        providers: [...new Map(searches.filter((item) => item.provider).map((item) => [item.provider.id, item.provider])).values()],
        queries, candidateCount: candidates.length,
        selectedCount: selected.length, readableCount: read, sources,
        selectedPreviewMetadata,
        observedPageContent: read > 0,
        coverage: { requestedSources: sourceLimit, selectedSources: selected.length, readableSources: read },
        stopFurtherResearch: boundedComplete,
        ...(boundedComplete ? { deactivatedTools: ['web_research', 'web_search'] } : {}),
      };
    },
  };
}
