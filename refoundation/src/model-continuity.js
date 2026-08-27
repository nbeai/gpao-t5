import { supportsModelCapability } from './model-capabilities.js';

const ELIGIBLE_STATUS = new Set([401, 403, 408, 409, 425, 429]);

function connection(value) {
  if (!value?.id || !value?.provider || !value?.modelId || typeof value.create !== 'function') {
    throw new TypeError('model continuity connection is invalid');
  }
  return value;
}

function publicConnection(value) {
  return { id: value.id, provider: value.provider, modelId: value.modelId,
    wire: value.capabilityManifest?.wire ?? null };
}

function requirements(input = {}) {
  const required = new Set(['text']);
  if ((input.tools ?? []).length) required.add('tools');
  if ((input.messages ?? []).some((message) => (message.modelAttachments ?? []).some((item) => (
    item?.type === 'input_image'
  )))) required.add('visionInput');
  return [...required];
}

function capabilityState(candidate, required) {
  const manifest = candidate.capabilityManifest;
  const unsupported = required.filter((name) => manifest?.capabilities?.[name] === 'unsupported');
  const supported = required.filter((name) => supportsModelCapability(manifest, name));
  return { admitted: unsupported.length === 0, unsupported, supported };
}

export function modelContinuityFailure(error) {
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return null;
  const status = Number(error?.status);
  if (status === 401 || status === 403) return 'credential_failure';
  if (ELIGIBLE_STATUS.has(status) || status >= 500) return 'provider_health_failure';
  if (error?.retriable === true || error?.code === 'network_error') return 'transport_failure';
  const message = String(error?.message ?? '');
  if (/request failed|network|transport|timed out|timeout|empty response|no content blocks|no output items|no candidate content|invalid json/iu.test(message)
    && !/invalid (?:function|tool) call|function arguments|attachment/iu.test(message)) return 'transport_failure';
  return null;
}

function receipt(from, to, reason, required) {
  return Object.freeze({
    schema: 't5.model-continuity-receipt.v1',
    from: publicConnection(from), to: publicConnection(to), reason,
    requiredCapabilities: [...required],
    stateSource: 'canonical_t5_messages_and_tool_receipts',
    providerRawTranscriptUsed: false,
    priorToolEffectsReexecutionAuthorized: false,
  });
}

export function makeModelContinuity({ connections = [] } = {}) {
  const candidates = connections.map(connection);
  if (!candidates.length) throw new TypeError('model continuity requires at least one connection');
  let activeIndex = 0; let activeModel = null; let latestReceipt = null;
  const modelAt = async (index) => {
    if (index === activeIndex && activeModel) return activeModel;
    const created = await candidates[index].create();
    if (!created || typeof created.respond !== 'function') throw new TypeError('model continuity factory returned no model');
    activeIndex = index; activeModel = created; return created;
  };
  const nextCandidate = (tried, required) => candidates.findIndex((candidate, index) => (
    !tried.has(index) && capabilityState(candidate, required).admitted
  ));
  return {
    id: candidates[0].modelId,
    capabilities: candidates[0].capabilityManifest,
    async respond(input = {}) {
      const required = requirements(input); const tried = new Set();
      let index = activeIndex;
      if (!capabilityState(candidates[index], required).admitted) {
        tried.add(index); const next = nextCandidate(tried, required);
        if (next < 0) throw Object.assign(new Error('No allowed model has the required capability'), {
          reason: 'required_model_capability_unavailable', requiredCapabilities: required,
        });
        latestReceipt = receipt(candidates[index], candidates[next], 'required_capability_absent', required);
        index = next; activeModel = null;
      }
      for (;;) {
        tried.add(index);
        try {
          const model = await modelAt(index);
          const continuityContext = latestReceipt ? [
            input.runtimeContext,
            '[T5 MODEL CONTINUITY — runtime fact]',
            'Continue from the canonical T5 messages and ToolReceipts below.',
            'Do not repeat a prior successful Tool call or external effect.',
            `transition=${latestReceipt.from.provider}:${latestReceipt.from.modelId}->${latestReceipt.to.provider}:${latestReceipt.to.modelId}`,
          ].filter(Boolean).join('\n') : input.runtimeContext;
          const response = await model.respond({ ...input, ...(continuityContext ? { runtimeContext: continuityContext } : {}) });
          return { ...response, ...(latestReceipt ? { continuityReceipt: latestReceipt } : {}) };
        } catch (error) {
          if (input.signal?.aborted) throw error;
          const reason = modelContinuityFailure(error); if (!reason) throw error;
          const next = nextCandidate(tried, required); if (next < 0) throw error;
          latestReceipt = receipt(candidates[index], candidates[next], reason, required);
          index = next; activeModel = null;
        }
      }
    },
    async supersedeLastResponse() { await activeModel?.supersedeLastResponse?.(); },
  };
}
