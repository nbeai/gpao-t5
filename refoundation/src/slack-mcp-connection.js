import { makeRemoteMcpConnection } from './remote-mcp-connection.js';

export const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';
const SLACK_AUTH_TEST_URL = 'https://slack.com/api/auth.test';

export function makeSlackMcpConnection({
  secretStore, clientId, clientSecret, callbackPort = 4185,
  fetchImpl = globalThis.fetch, runtimeFactory,
} = {}) {
  if (!String(clientId ?? '').trim() || !String(clientSecret ?? '').trim()) {
    throw new TypeError('T5 Slack OAuth application registration is required');
  }
  return makeRemoteMcpConnection({
    id: 'slack', label: 'Slack', category: 'workspace', serverUrl: SLACK_MCP_URL,
    resource: SLACK_MCP_URL, secretStore, fetchImpl, callbackPort, runtimeFactory,
    oauthClient: { client_id: String(clientId), client_secret: String(clientSecret) },
    requestedScopes: ['search:read.public'], requireObservedAccount: true,
    verifyConnection: async ({ credential, grantedScopes }) => {
      let response;
      try { response = await fetchImpl(SLACK_AUTH_TEST_URL, { headers: {
        accept: 'application/json', authorization: `Bearer ${credential.accessToken}`,
      } }); } catch { throw new Error('Slack 계정 identity를 확인하지 못했어요.'); }
      const body = await response.json().catch(() => null);
      const teamId = String(body?.team_id ?? '').trim(); const userId = String(body?.user_id ?? '').trim();
      if (!response.ok || body?.ok !== true || !teamId || !userId) {
        throw new Error('Slack 계정 identity를 확인하지 못했어요.');
      }
      const team = String(body.team ?? teamId).trim(); const user = String(body.user ?? userId).trim();
      return { accountId: `${teamId}:${userId}`, accountLabel: `${team} · ${user}`,
        permissions: grantedScopes, resources: [{ id: teamId, label: team, scope: 'workspace' }],
        capabilities: { search: true, read: true, create: false, update: false } };
    },
  });
}
