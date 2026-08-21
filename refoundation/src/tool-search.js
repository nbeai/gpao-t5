function tokens(value) { return String(value ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }

function publicTool(tool) { return { name: tool.name, description: tool.description }; }

export function makeToolSearchTool({ tools = [] } = {}) {
  const candidates = tools.filter((tool) => tool?.name && tool?.description);
  return {
    name: 'tool_search',
    description: 'Find and activate a specialized T5 tool only when the current request needs a capability whose schema is not already visible. Search by the user goal, such as multi-source web research, visual references, browser login, documents, automation, connected apps, or managed capability setup. The matched tool schemas become available on the next model turn. Do not use this for ordinary conversation or work already covered by visible tools.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', description: 'Short capability query based on the user goal.' },
    }, required: ['query'] },
    async execute({ query } = {}) {
      const wanted = [...new Set(tokens(query))];
      if (!wanted.length) throw new TypeError('tool search query is required');
      const ranked = candidates.map((tool) => {
        const name = tokens(tool.name); const description = tokens(tool.description);
        const searchTerms = tokens(tool.searchTerms?.join?.(' ') ?? ''); let score = 0;
        for (const token of wanted) {
          if (name.some((value) => value.includes(token) || token.includes(value))) score += 4;
          else if (searchTerms.some((value) => value.includes(token) || token.includes(value))) score += 3;
          else if (description.some((value) => value.includes(token) || token.includes(value))) score += 1;
        }
        return { tool, score };
      }).filter((entry) => entry.score > 0)
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
