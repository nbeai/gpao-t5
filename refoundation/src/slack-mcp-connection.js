import { makeRemoteMcpConnection } from './remote-mcp-connection.js';

export const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';
const SLACK_RESOURCE = 'https://mcp.slack.com';
const SLACK_AUTH_TEST_URL = 'https://slack.com/api/auth.test';

export function makeSlackMcpConnection({
  secretStore, clientId, clientSecret, callbackPort = 4185,
  fetchImpl = globalThis.fetch, runtimeFactory, stateStore, credentialCoordinator,
  t5UserId, connectionSlotId, publicSearchPolicy,
} = {}) {
  if (!String(clientId ?? '').trim() || !String(clientSecret ?? '').trim()) {
    throw new TypeError('T5 Slack OAuth application registration is required');
  }
  const publicSearchTool = String(publicSearchPolicy?.toolName ?? '').trim();
  const publicSearchArguments = publicSearchPolicy?.probeArguments;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(publicSearchTool)
    || !publicSearchArguments || typeof publicSearchArguments !== 'object' || Array.isArray(publicSearchArguments)) {
    throw new TypeError('T5 Slack public search tool qualification is required');
  }
  return makeRemoteMcpConnection({
    id: 'slack', label: 'Slack', category: 'workspace', serverUrl: SLACK_MCP_URL,
    resource: SLACK_RESOURCE, secretStore, fetchImpl, callbackPort, runtimeFactory,
    oauthClient: { client_id: String(clientId), client_secret: String(clientSecret) },
    stateStore, credentialCoordinator, t5UserId, connectionSlotId,
    requestedScopes: ['search:read.public'], requireObservedAccount: true,
    readOnlyOnly: true, allowedToolNames: [publicSearchTool],
    oauthPolicy: { issuer: 'https://mcp.slack.com',
      authorizationEndpoint: 'https://slack.com/oauth/v2_user/authorize',
      tokenEndpoint: 'https://slack.com/api/oauth.v2.user.access', expectedResource: SLACK_RESOURCE },
    verifyConnection: async ({ credential, grantedScopes, runtime }) => {
      let response;
      try { response = await fetchImpl(SLACK_AUTH_TEST_URL, { headers: {
        accept: 'application/json', authorization: `Bearer ${credential.accessToken}`,
      } }); } catch { throw new Error('Slack 계정 identity를 확인하지 못했어요.'); }
      const body = await response.json().catch(() => null);
      const teamId = String(body?.team_id ?? '').trim(); const userId = String(body?.user_id ?? '').trim();
      if (!response.ok || body?.ok !== true || !teamId || !userId) {
        throw new Error('Slack 계정 identity를 확인하지 못했어요.');
      }
      const protectedResult = await runtime.callTool({ name: publicSearchTool,
        arguments: structuredClone(publicSearchArguments) });
      if (protectedResult?.isError === true) throw new Error('Slack 공개 검색 권한을 확인하지 못했어요.');
      const team = String(body.team ?? teamId).trim(); const user = String(body.user ?? userId).trim();
      return { accountId: `${teamId}:${userId}`, accountLabel: `${team} · ${user}`,
        permissions: grantedScopes, resources: [{ id: teamId, label: team, scope: 'workspace' }],
        capabilities: { search: true, read: false, create: false, update: false } };
    },
  });
}
