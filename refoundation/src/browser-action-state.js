export function makeBrowserObservationRegistry({ maxTabs = 20 } = {}) {
  if (!Number.isInteger(maxTabs) || maxTabs < 1) throw new TypeError('maxTabs must be positive');
  const latestByTab = new Map();

  function remember(observation) {
    const id = String(observation?.observationId ?? '');
    const tabId = String(observation?.refScope?.tabId ?? '');
    if (!id || !tabId) return false;
    latestByTab.delete(tabId);
    latestByTab.set(tabId, structuredClone(observation));
    while (latestByTab.size > maxTabs) latestByTab.delete(latestByTab.keys().next().value);
    return true;
  }

  function resolve({ observationId, tabId, ref }) {
    const requestedId = String(observationId ?? '');
    const requestedTab = String(tabId ?? '');
    const requestedRef = String(ref ?? '');
    const latest = latestByTab.get(requestedTab);
    if (!latest) {
      const elsewhere = [...latestByTab.values()].find((item) => item.observationId === requestedId);
      return elsewhere
        ? { ok: false, state: 'observation_tab_mismatch', observedTabId: elsewhere.refScope.tabId }
        : { ok: false, state: 'observation_unknown' };
    }
    if (latest.observationId !== requestedId) {
      return { ok: false, state: 'stale_observation', latestObservationId: latest.observationId };
    }
    if (!Object.hasOwn(latest.refs ?? {}, requestedRef)) {
      return { ok: false, state: 'ref_not_observed' };
    }
    return { ok: true, observation: structuredClone(latest), refFact: structuredClone(latest.refs[requestedRef]) };
  }

  function resolveEditable({ observationId, tabId, editableId }) {
    const requestedId = String(observationId ?? '');
    const requestedTab = String(tabId ?? '');
    const requestedEditable = String(editableId ?? '');
    const latest = latestByTab.get(requestedTab);
    if (!latest) return { ok: false, state: 'observation_unknown' };
    if (requestedId && latest.observationId !== requestedId) {
      return { ok: false, state: 'stale_observation', latestObservationId: latest.observationId };
    }
    const editableFact = (latest.editables ?? []).find((item) => item.editableId === requestedEditable);
    if (!editableFact) return { ok: false, state: 'editable_not_observed' };
    return {
      ok: true, observation: structuredClone(latest), editableFact: structuredClone(editableFact),
      ...(requestedId ? {} : { boundToLatestObservation: true }),
    };
  }

  return { remember, resolve, resolveEditable, size: () => latestByTab.size };
}
