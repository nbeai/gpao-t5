export function deriveResourceReport(events = []) {
  const reservations = new Map();
  const settlements = new Map();
  const report = {
    scopes: 0, reservations: 0, committed: 0, released: 0, unknown: 0, unsettled: 0,
    requestBytesReserved: 0, providerTokensCommitted: 0,
    modelCallsObserved: 0, toolCallsObserved: 0, internalCallsObserved: 0, wallMsObserved: 0,
  };
  for (const event of events) {
    if (event.type === 'ScopeCreated') report.scopes += 1;
    if (event.type === 'ResourceReserved') {
      reservations.set(event.payload.reservationId, event);
      report.reservations += 1;
      report.requestBytesReserved += Number(event.payload.resources?.requestBytes ?? 0);
    }
    if (['ReservationCommitted', 'ReservationReleased', 'UsageMarkedUnknown'].includes(event.type)) {
      settlements.set(event.payload.reservationId, event);
    }
    if (event.type === 'ReservationCommitted') {
      report.committed += 1;
      report.providerTokensCommitted += Number(event.payload.resources?.totalTokens ?? 0);
    }
    if (event.type === 'ReservationReleased') report.released += 1;
    if (event.type === 'UsageMarkedUnknown') report.unknown += 1;
    if (event.type === 'ResourceObserved') {
      report.modelCallsObserved += Number(event.payload.resources?.modelCalls ?? 0);
      report.toolCallsObserved += Number(event.payload.resources?.toolCalls ?? 0);
      report.internalCallsObserved += Number(event.payload.resources?.internalCalls ?? 0);
      report.wallMsObserved += Number(event.payload.resources?.wallMs ?? 0);
    }
  }
  report.unsettled = [...reservations].filter(([id]) => !settlements.has(id)).length;
  return report;
}
