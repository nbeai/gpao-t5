export const TRANSITION_CHOICES = Object.freeze([
  'steer_current', 'followup_after_delivery', 'new_work',
  'resume_paused', 'cancel', 'ambiguous',
]);

export function transitionDecisionTool() {
  return {
    name: 'transition_decision', informationFamily: 'continuity',
    description: 'Classify one newly admitted user input against the active purpose. Select exactly one transition lane. Use a paused target handle only for resume_paused. Use ambiguous when the intended lane or target is not sufficiently identified.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      choice: { type: 'string', enum: TRANSITION_CHOICES },
      targetHandle: { type: ['string', 'null'] },
      currentWorkDisposition: { type: ['string', 'null'], enum: ['pause', 'cancel', null] },
    }, required: ['choice', 'targetHandle', 'currentWorkDisposition'] },
  };
}

export async function decideTransition({ model, currentWork, input, pausedCandidates = [], signal,
  resourceObserver = null, onContextReceipt = null } = {}) {
  if (!model || !currentWork || !input) throw new TypeError('transition decision input is required');
  const tool = transitionDecisionTool();
  const response = await model.respond({
    messages: [{ role: 'user', content: JSON.stringify({
      activePurpose: { objective: String(currentWork.objective ?? '').slice(0, 2_000),
        status: currentWork.status ?? 'active' },
      admittedInput: { text: String(input.text ?? '').slice(0, 8_000),
        attachmentCount: Math.min(10, input.attachmentCount ?? 0), sourceKind: input.sourceKind ?? 'conversation' },
      pausedCandidates: pausedCandidates.slice(0, 8).map((candidate) => ({
        handle: candidate.handle, title: String(candidate.title ?? '').slice(0, 160),
        lastActivity: candidate.lastActivity ?? null, sourceKind: candidate.sourceKind ?? 'conversation',
      })),
    }) }],
    tools: [{ name: tool.name, description: tool.description, parameters: tool.parameters }],
    toolChoice: { requiredToolName: tool.name }, signal,
    ...(resourceObserver ? { resourceObserver } : {}),
    ...(onContextReceipt ? { onContextReceipt } : {}),
  });
  const calls = response?.toolCalls ?? [];
  if (calls.length !== 1 || calls[0]?.name !== tool.name) {
    throw new Error('transition decision receipt is missing');
  }
  const args = calls[0].args ?? {};
  if (!TRANSITION_CHOICES.includes(args.choice)
    || !['pause', 'cancel', null].includes(args.currentWorkDisposition ?? null)
    || (args.choice === 'resume_paused' ? !String(args.targetHandle ?? '') : args.targetHandle != null)) {
    throw new Error('transition decision receipt is invalid');
  }
  return { choice: args.choice, targetHandle: args.targetHandle ?? null,
    currentWorkDisposition: args.currentWorkDisposition ?? null,
    usage: response.usage ?? null, responseId: response.responseId ?? null };
}
