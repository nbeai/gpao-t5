export function makeAuditoryCapabilityService({
  store, qualifier, scratchRoot, assetId = store?.catalog?.defaultAssetId,
} = {}) {
  if (!store?.openActive || !store?.latestPrepared || typeof qualifier !== 'function'
    || !scratchRoot || !assetId) throw new TypeError('auditory capability service inputs are required');
  let pending = null;
  const prepareOnce = async ({ signal = null, onProgress = null } = {}) => {
    const active = await store.openActive(assetId);
    if (active.state === 'active') return { state: 'ready', reused: true, model: active };
    let prepared = await store.latestPrepared(assetId);
    if (!prepared) {
      const installed = await store.installInactive(assetId, { signal, onProgress });
      prepared = { ...installed, state: 'installed_inactive' };
    }
    if (prepared.state === 'installed_inactive') {
      await onProgress?.({ assetId, phase: 'qualifying' });
      const qualified = await store.qualify(assetId, prepared.generationId, ({ path, asset }) => (
        qualifier({ path, asset, scratchRoot, signal })
      ));
      if (qualified.state !== 'fixture_qualified') throw new Error('auditory model fixture qualification failed');
      prepared = { ...prepared, state: 'fixture_qualified' };
    }
    await store.activate(assetId, prepared.generationId);
    const ready = await store.openActive(assetId);
    if (ready.state !== 'active') throw new Error('auditory model activation readback failed');
    await onProgress?.({ assetId, phase: 'ready', receivedBytes: ready.bytes, expectedBytes: ready.bytes });
    return { state: 'ready', reused: false, model: ready };
  };
  return {
    async status() { const active = await store.openActive(assetId); return active.state === 'active'
      ? { state: 'ready', assetId, bytes: active.bytes }
      : { state: (await store.latestPrepared(assetId))?.state ?? 'not_present', assetId }; },
    async prepare(options = {}) {
      if (!pending) pending = prepareOnce(options).finally(() => { pending = null; });
      return pending;
    },
  };
}
