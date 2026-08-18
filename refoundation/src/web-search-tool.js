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

function normalizeResults(rows, limit) {
  const seen = new Set();
  const candidates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const url = normalizeCandidateUrl(row?.url);
    if (!url || seen.has(url)) continue;
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
      const selectedFact = requested
        ? facts.find((item) => item.id === requested)
        : facts.find((item) => item.available);
      if (!selectedFact?.available) {
        return {
          state: 'unavailable', query, providers: facts,
          ...(requested ? { requestedProvider: requested } : {}),
          observedPageContent: false,
        };
      }
      const selected = providers.find((provider) => provider.id === selectedFact.id);
      try {
        const rows = await selected.search(query, { limit, domains, signal: context.signal });
        return {
          state: 'candidates', query,
          provider: { id: selectedFact.id, label: selectedFact.label },
          candidates: normalizeResults(rows, limit),
          readState: 'candidates_only', observedPageContent: false,
          networkEffect: { kind: 'external_observe', sent: 'search_query' },
        };
      } catch (error) {
        return {
          state: context.signal?.aborted ? 'cancelled' : 'failed', query,
          attemptedProvider: { id: selectedFact.id, label: selectedFact.label },
          error: error?.message ?? String(error),
          availableAlternatives: facts.filter((item) => item.available && item.id !== selectedFact.id)
            .map(({ id, label }) => ({ id, label })),
          observedPageContent: false,
        };
      }
    },
  };
}
