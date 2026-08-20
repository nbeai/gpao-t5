export function makeConnectionTool({ doctor, startConnection, performConnection } = {}) {
  if (!doctor || typeof doctor.inspect !== 'function') throw new TypeError('connection doctor is required');
  return {
    name: 'connection',
    description: 'Inspect the current truth before claiming that T5 can connect, link, integrate, or use account data from an external workspace, service, channel, local sync folder, CLI, API, or browser login. Use for any natural-language request with that purpose; do not keyword-classify the user. list returns every known connection and route. inspect returns one exact service. perform starts one listed user_action such as opening an official installer or login app. start begins only a registered OAuth handoff and never receives credentials. Do not repeat or expose authorizeUrl in the answer; the console renders it as a user-controlled connection card. Never claim connected unless state=connected, or usable unless state=ready.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'inspect', 'perform', 'start'] },
        id: { type: ['string', 'null'], maxLength: 64 },
        actionId: { type: ['string', 'null'], maxLength: 64 },
      },
      required: ['action', 'id', 'actionId'],
    },
    async execute({ action, id, actionId }) {
      const report = await doctor.inspect();
      if (action === 'list') return {
        state: 'listed', checkedAt: report.checkedAt,
        userSafeSummary: report.userSafeSummary, connections: report.connections,
      };
      if (action === 'start') {
        if (typeof startConnection !== 'function') throw new Error('connection start is unavailable');
        const started = await startConnection(String(id ?? ''));
        return { state: 'user_authorization_required', ...started };
      }
      if (action === 'perform') {
        if (typeof performConnection !== 'function') throw new Error('connection action is unavailable');
        const performed = await performConnection(String(id ?? ''), String(actionId ?? ''));
        return { state: 'user_action_started', ...performed };
      }
      if (action !== 'inspect') throw new Error(`Unknown connection action: ${action}`);
      const connection = report.connections.find((item) => item.id === String(id ?? ''));
      if (!connection) throw new Error('connection not found');
      return { state: 'inspected', checkedAt: report.checkedAt, connection };
    },
  };
}
