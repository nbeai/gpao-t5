function catalogConnection(entry) {
  return {
    id: entry.id, label: entry.label, category: entry.category,
    state: 'not_connected', reason: 'catalog_route_not_connected',
    userSafeSummary: entry.userSafeSummary ?? `${entry.label}은 현재 연결되어 있지 않아요.`,
    capabilities: entry.capabilities ?? {}, routes: entry.routes ?? [], actions: [],
    ...(entry.privacyDefaults ? { privacyDefaults: entry.privacyDefaults } : {}),
  };
}

export function makeConnectionTool({ doctor, startConnection, performConnection, catalog = null } = {}) {
  if (!doctor || typeof doctor.inspect !== 'function') throw new TypeError('connection doctor is required');
  return {
    name: 'connection',
    description: 'Inspect the current truth before claiming that T5 can connect, link, integrate, or use account data from an external workspace, service, channel, local sync folder, CLI, API, or browser login. Use for any natural-language request with that purpose; do not keyword-classify the user. list returns every known connection and route. inspect returns one exact service. When requested services contain routes, the user answer must preserve each relevant route data and effects separately, including read-only local export versus account-changing API effects. When privacyDefaults exist, name the fields excluded by default instead of silently omitting that boundary. perform starts one listed user_action such as opening an official installer or login app. start begins only a registered OAuth handoff and never receives credentials. Do not repeat or expose authorizeUrl in the answer; the console renders it as a user-controlled connection card. Never claim connected unless state=connected, or usable unless state=ready.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'inspect', 'perform', 'start'] },
        id: { type: ['string', 'null'], maxLength: 64 },
        actionId: { type: ['string', 'null'], maxLength: 64 },
      },
      required: ['action', 'id', 'actionId'],
    },
    activateToolsFromResult(result) {
      const connections = result?.state === 'inspected' && result.connection
        ? [result.connection] : result?.state === 'listed' ? result.connections ?? [] : [];
      return connections.some((connection) => (connection.routes ?? []).some((route) => (
        route.kind === 'browser' && ['ready', 'needs_connection', 'waiting_for_user'].includes(route.state)
      ))) ? ['browser'] : [];
    },
    async execute({ action, id, actionId }) {
      const report = await doctor.inspect();
      const catalogSnapshot = typeof catalog === 'function' ? await catalog() : null;
      const connections = [...report.connections];
      const currentIds = new Set(connections.map((item) => item.id));
      for (const entry of catalogSnapshot?.entries ?? []) {
        if (!currentIds.has(entry.id)) connections.push(catalogConnection(entry));
      }
      if (action === 'list') return {
        state: 'listed', checkedAt: report.checkedAt,
        userSafeSummary: report.userSafeSummary, connections,
      };
      if (action === 'start') {
        if (typeof startConnection !== 'function') throw new Error('connection start is unavailable');
        const started = await startConnection(String(id ?? ''));
        return {
          state: started.handoffMode === 'user_action'
            ? 'user_action_started' : 'user_authorization_required',
          ...started,
        };
      }
      if (action === 'perform') {
        if (typeof performConnection !== 'function') throw new Error('connection action is unavailable');
        const performed = await performConnection(String(id ?? ''), String(actionId ?? ''));
        return { state: 'user_action_started', ...performed };
      }
      if (action !== 'inspect') throw new Error(`Unknown connection action: ${action}`);
      const connection = connections.find((item) => item.id === String(id ?? ''));
      if (!connection) throw new Error('connection not found');
      return { state: 'inspected', checkedAt: report.checkedAt, connection };
    },
  };
}
