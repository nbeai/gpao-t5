export function makeConnectionTool({ doctor } = {}) {
  if (!doctor || typeof doctor.inspect !== 'function') throw new TypeError('connection doctor is required');
  return {
    name: 'connection',
    description: 'Inspect the current truth before claiming that T5 can connect, link, integrate, or use account data from an external workspace, service, channel, local sync folder, CLI, API, or browser login. Use for any natural-language request with that purpose; do not keyword-classify the user. list returns every known connection and route. inspect returns one exact service. A ready browser route is not an official connector or a confirmed site login. Never claim connected unless state=connected, and never invent a connect action that this tool does not provide.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'inspect'] },
        id: { type: ['string', 'null'], maxLength: 64 },
      },
      required: ['action', 'id'],
    },
    async execute({ action, id }) {
      const report = await doctor.inspect();
      if (action === 'list') return {
        state: 'listed', checkedAt: report.checkedAt,
        userSafeSummary: report.userSafeSummary, connections: report.connections,
      };
      if (action !== 'inspect') throw new Error(`Unknown connection action: ${action}`);
      const connection = report.connections.find((item) => item.id === String(id ?? ''));
      if (!connection) throw new Error('connection not found');
      return { state: 'inspected', checkedAt: report.checkedAt, connection };
    },
  };
}
