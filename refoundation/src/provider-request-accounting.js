export async function reserveProviderAttempt(resourceObserver, facts) {
  if (!resourceObserver) return null;
  return resourceObserver.reserve(facts);
}

export async function settleProviderSuccess(resourceObserver, handle, { usage, responseId = null }) {
  if (!resourceObserver || !handle) return;
  if (usage == null) {
    await resourceObserver.unknown(handle, { reason: 'provider_usage_missing', facts: { responseReceived: true } });
    return;
  }
  await resourceObserver.commit(handle, { usage, responseId });
}

export async function settleProviderUnknown(resourceObserver, handle, reason, facts = {}) {
  if (!resourceObserver || !handle) return;
  await resourceObserver.unknown(handle, { reason, facts });
}
