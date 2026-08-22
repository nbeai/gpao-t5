const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const TRACKING_QUERY = /^(?:utm_.+|fbclid|gclid|dclid|mc_[ce]id|ref_src)$/i;

function normalizeCandidateUrl(raw) {
  try {
    const url = new URL(String(raw ?? '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY.test(key)) url.searchParams.delete(key);
    }
    return url.href.replace(/\?$/, '');
  } catch {
    return null;
  }
}

function normalizeLimit(value) {
  if (value == null) return DEFAULT_LIMIT;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_LIMIT) {
    throw new TypeError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return number;
}

function normalizeResults(rows, limit, domains = []) {
  const seen = new Set();
  const candidates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const url = normalizeCandidateUrl(row?.url);
    if (!url || seen.has(url)) continue;
    if (domains.length) {
      const host = new URL(url).hostname.toLowerCase();
      if (!domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) continue;
    }
    seen.add(url);
    candidates.push({
      rank: candidates.length + 1,
      title: String(row?.title ?? '').trim(),
      url,
      snippet: String(row?.snippet ?? row?.description ?? '')
        .replace(/cite[^]+/g, '').replace(/\[wordlim:\s*\d+\]/gi, '')
        .trim().slice(0, 1_000),
      trust: 'untrusted_external', instructionAuthority: 'none',
      ...(row?.publishedAt ? { publishedAt: String(row.publishedAt) } : {}),
      ...(row?.sourceType ? { sourceType: String(row.sourceType) } : {}),
      ...(normalizeCandidateUrl(row?.imageUrl) ? { previewImageUrl: normalizeCandidateUrl(row.imageUrl) } : {}),
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

async function providerFacts(providers) {
  const facts = [];
  for (const provider of providers) {
    let availability;
    try { availability = await provider.available(); }
    catch (error) {
      availability = { available: false, reason: error?.message ?? String(error) };
    }
    facts.push({
      id: provider.id,
      label: provider.label ?? provider.id,
      available: availability?.available === true,
      ...(availability?.reason ? { reason: String(availability.reason) } : {}),
    });
  }
  return facts;
}

export function makeWebSearchTool({ providers = [] } = {}) {
  for (const provider of providers) {
    if (!provider?.id || typeof provider.available !== 'function' || typeof provider.search !== 'function') {
      throw new TypeError('web search providers require id, available, and search');
    }
  }
  return {
    name: 'web_search',
    capabilityGroup: 'web_observation',
    searchTerms: [
      'public web candidate source list only without reading pages',
      '공개 웹 검색 후보 목록만 페이지 읽기 전',
    ],
    description: 'Search the public web and return candidate sources only. This does not read page contents; choose a candidate and call web_read to inspect it.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Exact search query.' },
        provider: { type: ['string', 'null'], description: 'Provider id, or null to use the first available configured provider.' },
        limit: { type: ['integer', 'null'], minimum: 1, maximum: MAX_LIMIT },
        domains: {
          type: ['array', 'null'], items: { type: 'string' }, maxItems: 20,
          description: 'Optional hostnames to restrict search, without http:// or paths.',
        },
      },
      required: ['query', 'provider', 'limit', 'domains'],
      additionalProperties: false,
    },
    async execute(args = {}, context = {}) {
      const query = String(args.query ?? '').trim();
      if (!query) throw new TypeError('query is required');
      const limit = normalizeLimit(args.limit);
      const domains = args.domains == null ? [] : args.domains.map((item) => String(item).trim().toLowerCase())
        .filter((item) => /^[a-z0-9.-]+$/i.test(item) && !item.startsWith('.') && !item.endsWith('.'));
      const facts = await providerFacts(providers);
      const requested = args.provider == null ? null : String(args.provider).trim();
      const selectedFacts = requested
        ? facts.filter((item) => item.id === requested && item.available)
        : facts.filter((item) => item.available);
      if (!selectedFacts.length) {
        return {
          state: 'unavailable', query, providers: facts,
          ...(requested ? { requestedProvider: requested } : {}),
          observedPageContent: false,
        };
      }
      const attempts = [];
      for (const selectedFact of selectedFacts) {
        const selected = providers.find((provider) => provider.id === selectedFact.id);
        try {
          const rows = await selected.search(query, { limit, domains, signal: context.signal });
          const candidates = normalizeResults(rows, limit, domains);
          if (!candidates.length) throw new Error('search returned no usable candidates');
          return {
            state: 'candidates', query,
            provider: { id: selectedFact.id, label: selectedFact.label }, attempts,
            candidates, readState: 'candidates_only', observedPageContent: false,
            networkEffect: { kind: 'external_observe', sent: 'search_query' },
          };
        } catch (error) {
          attempts.push({ provider: { id: selectedFact.id, label: selectedFact.label }, error: error?.message ?? String(error) });
          if (context.signal?.aborted) break;
        }
      }
      return {
        state: context.signal?.aborted ? 'cancelled' : 'failed', query, attempts,
        ...(selectedFacts.length === 1 ? { attemptedProvider: {
          id: selectedFacts[0].id, label: selectedFacts[0].label,
        } } : {}),
        error: attempts.at(-1)?.error ?? 'search failed',
        availableAlternatives: facts.filter((item) => item.available
          && !selectedFacts.some((selected) => selected.id === item.id)).map(({ id, label }) => ({ id, label })),
        observedPageContent: false,
      };
    },
  };
}
