function tokens(value) { return String(value ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }

function tokenMatches(left, right) {
  if (left === right) return true;
  return Math.min(left.length, right.length) >= 4
    && (left.startsWith(right) || right.startsWith(left));
}

function toolNameTokenMatches(left, right) {
  if (left === right) return true;
  return Math.min(left.length, right.length) >= 5
    && (left.startsWith(right) || right.startsWith(left));
}

function publicTool(tool) { return { name: tool.name, description: tool.description }; }

export function makeToolSearchTool({ tools = [], prerequisites = {} } = {}) {
  const candidates = tools.filter((tool) => tool?.name && tool?.description);
  return {
    name: 'tool_search',
    completionProposalOptional: true,
    description: 'Find and activate a specialized T5 tool only when the current request needs a capability whose schema is not already visible. Search by the user goal, such as multi-source web research, visual references, browser login, documents, automation, official candidates for a missing connection, managed capability setup, or evidence of whether a prepared skill or managed command was actually used. The matched tool schemas become available on the next model turn. Do not use this for ordinary conversation or work already covered by visible tools.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', description: 'Short capability query based on the user goal.' },
    }, required: ['query'] },
    async execute({ query } = {}) {
      const wanted = [...new Set(tokens(query))];
      if (!wanted.length) throw new TypeError('tool search query is required');
      for (const [name, prerequisite] of Object.entries(prerequisites)) {
        const requiredName = tokens(name);
        if (requiredName.length && requiredName.every((token) => wanted.includes(token))) {
          return {
            state: 'prerequisite_required', query: String(query), activatedTools: [],
            requestedTool: name, prerequisite: structuredClone(prerequisite), tools: [],
          };
        }
      }
      const ranked = candidates.map((tool) => {
        const name = tokens(tool.name); const description = tokens(tool.description);
        const searchTerms = tokens(tool.searchTerms?.join?.(' ') ?? '');
        let score = 0; let matchedTokens = 0; let matchedNameTokens = 0;
        let matchedDescriptionTokens = 0; let matchedSearchTerm = false;
        // Prefer a capability whose complete name is present in the goal over a compound
        // tool that happens to share one generic token such as "search".
        const completeNameMatch = name.length && name.every((nameToken) => (
          wanted.some((wantedToken) => toolNameTokenMatches(nameToken, wantedToken))
        ));
        if (completeNameMatch) score += 8;
        for (const token of wanted) {
          if (name.some((value) => toolNameTokenMatches(value, token))) {
            score += 4; matchedTokens += 1; matchedNameTokens += 1;
          } else if (searchTerms.some((value) => tokenMatches(value, token))) {
            score += 3; matchedTokens += 1; matchedSearchTerm = true;
          } else if (token.length >= 4
            && description.some((value) => tokenMatches(value, token))) {
            score += 1; matchedTokens += 1; matchedDescriptionTokens += 1;
          }
        }
        return {
          tool, score,
          confident: Boolean(
            completeNameMatch || matchedSearchTerm
            || (matchedNameTokens >= 1 && matchedTokens >= 2)
            || matchedDescriptionTokens >= 3
          ),
        };
      }).filter((entry) => entry.score > 0 && entry.confident)
        .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
        .slice(0, 1);
      const activated = [];
      const byName = new Map(candidates.map((tool) => [tool.name, tool]));
      for (const { tool } of ranked) {
        if (!activated.includes(tool.name)) activated.push(tool.name);
        for (const related of tool.relatedTools ?? []) {
          if (byName.has(related) && !activated.includes(related)) activated.push(related);
        }
      }
      return {
        state: ranked.length ? 'activated' : 'no_match', query: String(query),
        tools: activated.map((name) => publicTool(byName.get(name))),
        activatedTools: activated,
        ...(ranked.length ? { requiredNextTool: ranked[0].tool.name } : {}),
      };
    },
  };
}

export function deferTools(tools, { coreNames = [], includeAttachment = false } = {}) {
  const core = new Set(coreNames);
  return tools.map((tool) => ({
    ...tool,
    deferred: !(core.has(tool.name) || (includeAttachment && tool.name === 'attachment')),
  }));
}
