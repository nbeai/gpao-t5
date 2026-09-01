export const NX_REALITY_AFFORDANCE_TOOL_SEARCH_DESCRIPTION = [
  'Find and activate a specialized T5 tool only when the current goal may depend on computer or external reality that has not been observed, even if the user does not know a file name, location, service, or T5 capability name.',
  'Search by the user goal, such as current local evidence, multi-source web research, visual references, browser interaction, documents, automation, missing connections, managed capability setup, or evidence of actual capability use.',
  'The matched tool schema becomes available on the next model turn.',
  'Do not use this for definitions, opinions, brainstorming, creative work, or work already covered by visible tools.',
].join(' ');

export function wrapNxRealityAffordanceModel(model) {
  if (!model || typeof model.respond !== 'function') throw new TypeError('model is required');
  return { ...model,
    respond: (request = {}) => model.respond({ ...request,
      tools: (request.tools ?? []).map((tool) => tool.name === 'tool_search'
        ? { ...tool, description: NX_REALITY_AFFORDANCE_TOOL_SEARCH_DESCRIPTION } : tool),
    }),
    supersedeLastResponse: (...args) => model.supersedeLastResponse?.(...args),
    close: (...args) => model.close?.(...args),
  };
}
