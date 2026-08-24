export async function reserveProviderAttempt(resourceObserver, facts) {
  if (!resourceObserver) return null;
  try { return await resourceObserver.reserve(facts); }
  catch (error) {
    await resourceObserver.degraded?.({ stage: 'reservation', error }).catch?.(() => {});
    return { degraded: true };
  }
}

export async function settleProviderSuccess(resourceObserver, handle, { usage, responseId = null }) {
  if (!resourceObserver || !handle) return;
  if (handle.degraded === true) return;
  if (usage == null) {
    try {
      await resourceObserver.unknown(handle, {
        reason: 'provider_usage_missing', facts: { responseReceived: true },
      });
    } catch (error) {
      await resourceObserver.degraded?.({ stage: 'settlement', error }).catch?.(() => {});
    }
    return;
  }
  try { await resourceObserver.commit(handle, { usage, responseId }); }
  catch (error) {
    await resourceObserver.degraded?.({ stage: 'settlement', error }).catch?.(() => {});
  }
}

export async function settleProviderUnknown(resourceObserver, handle, reason, facts = {}) {
  if (!resourceObserver || !handle) return;
  if (handle.degraded === true) return;
  try { await resourceObserver.unknown(handle, { reason, facts }); }
  catch (error) {
    await resourceObserver.degraded?.({ stage: 'settlement', error }).catch?.(() => {});
  }
}
