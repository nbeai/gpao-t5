const STATE = Object.freeze({
  supported: 'supported', unsupported: 'unsupported', unknown: 'unknown',
});

const KEYS = Object.freeze([
  'text', 'tools', 'parallelTools', 'visionInput', 'imageToolResult',
  'audioInput', 'videoInput', 'reasoningEffort', 'promptCaching', 'streaming',
]);

function capabilities(values = {}) {
  return Object.fromEntries(KEYS.map((key) => [key, STATE[values[key]] ?? STATE.unknown]));
}

function knownOpenAIModel(modelId) {
  return /^gpt-(?:5(?:\.|-)|4o)/iu.test(String(modelId ?? ''));
}

function knownClaudeModel(modelId) {
  return /^claude-/iu.test(String(modelId ?? ''));
}

function knownGeminiModel(modelId) {
  return /^gemini-/iu.test(String(modelId ?? ''));
}

/**
 * Public, non-secret adapter contract. It describes what this T5 adapter can safely send,
 * not every feature the provider may offer. Unknown stays unknown until a provider profile
 * or an observed qualification result establishes it.
 */
export function modelCapabilityManifest({ kind, provider, modelId } = {}) {
  const normalizedKind = String(kind ?? '');
  const normalizedProvider = String(provider ?? '').toLowerCase();
  const id = String(modelId ?? '');
  if (normalizedKind === 'chatgpt_oauth') {
    return {
      schema: 't5.model-capabilities.v1', provider: 'chatgpt_oauth', modelId: id,
      wire: 'openai-responses-sse', source: 't5_adapter_contract',
      capabilities: capabilities({
        text: 'supported', tools: 'supported', parallelTools: 'unknown',
        visionInput: knownOpenAIModel(id) ? 'supported' : 'unknown',
        imageToolResult: 'unknown', audioInput: 'unknown', videoInput: 'unknown',
        reasoningEffort: 'supported', promptCaching: 'unknown', streaming: 'supported',
      }),
    };
  }
  const profiles = {
    openai: {
      wire: 'openai-responses', values: {
        text: 'supported', tools: 'supported', parallelTools: 'unknown',
        visionInput: knownOpenAIModel(id) ? 'supported' : 'unknown', imageToolResult: 'unknown',
        reasoningEffort: 'supported', promptCaching: 'unknown', streaming: 'unsupported',
      },
    },
    anthropic: {
      wire: 'anthropic-messages', values: {
        text: 'supported', tools: knownClaudeModel(id) ? 'supported' : 'unknown',
        parallelTools: 'unknown', visionInput: knownClaudeModel(id) ? 'supported' : 'unknown',
        imageToolResult: 'unknown', reasoningEffort: 'unknown', promptCaching: 'unsupported',
        streaming: 'unsupported',
      },
    },
    gemini: {
      wire: 'gemini-generate-content', values: {
        text: 'supported', tools: knownGeminiModel(id) ? 'supported' : 'unknown',
        parallelTools: 'unknown', visionInput: knownGeminiModel(id) ? 'supported' : 'unknown',
        imageToolResult: 'unknown', reasoningEffort: 'unknown', promptCaching: 'unsupported',
        streaming: 'unsupported',
      },
    },
    upstage: {
      wire: 'openai-chat-completions', values: {
        text: 'supported', tools: id === 'solar-pro4' ? 'supported' : 'unknown',
        parallelTools: 'unsupported', visionInput: id === 'solar-pro4' ? 'unsupported' : 'unknown',
        imageToolResult: 'unsupported', audioInput: 'unsupported', videoInput: 'unsupported',
        reasoningEffort: 'supported', promptCaching: 'unsupported', streaming: 'unsupported',
      },
    },
  };
  const profile = profiles[normalizedProvider];
  if (!profile) throw new TypeError('unsupported model capability provider');
  return {
    schema: 't5.model-capabilities.v1', provider: normalizedProvider, modelId: id,
    wire: profile.wire, source: 't5_adapter_contract', capabilities: capabilities(profile.values),
  };
}

export function supportsModelCapability(manifest, capability) {
  return manifest?.capabilities?.[capability] === STATE.supported;
}

export const MODEL_CAPABILITY_STATE = STATE;
