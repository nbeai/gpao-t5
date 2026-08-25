import { makeRemoteMcpConnection } from './remote-mcp-connection.js';

export const GOOGLE_DRIVE_MCP_URL = 'https://drivemcp.googleapis.com/mcp/v1';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_READ_TOOLS = ['download_file_content', 'get_file_metadata', 'get_file_permissions',
  'list_recent_files', 'read_file_content', 'search_files'];

export function makeGoogleWorkspaceDriveMcpConnection({
  secretStore, clientId, clientSecret, callbackPort = 4186,
  fetchImpl = globalThis.fetch, runtimeFactory, stateStore, credentialCoordinator,
  t5UserId, connectionSlotId,
} = {}) {
  if (!String(clientId ?? '').trim() || !String(clientSecret ?? '').trim()) {
    throw new TypeError('T5 Google Workspace OAuth application registration is required');
  }
  return makeRemoteMcpConnection({
    id: 'google-workspace', label: 'Google Workspace · Drive', category: 'workspace',
    serverUrl: GOOGLE_DRIVE_MCP_URL, resource: GOOGLE_DRIVE_MCP_URL,
    secretStore, fetchImpl, callbackPort, runtimeFactory,
    oauthClient: { client_id: String(clientId), client_secret: String(clientSecret) },
    stateStore, credentialCoordinator, t5UserId, connectionSlotId,
    requestedScopes: ['openid', 'email', 'profile', DRIVE_READ_SCOPE],
    authorizationParameters: { access_type: 'offline', include_granted_scopes: 'true' },
    readOnlyOnly: true, allowedToolNames: DRIVE_READ_TOOLS,
    stability: 'developer_preview',
    oauthPolicy: { issuer: 'https://accounts.google.com',
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token', expectedResource: GOOGLE_DRIVE_MCP_URL },
    requireObservedAccount: true,
    verifyConnection: async ({ credential, grantedScopes, runtime }) => {
      let response;
      try { response = await fetchImpl(GOOGLE_USERINFO_URL, { headers: {
        accept: 'application/json', authorization: `Bearer ${credential.accessToken}`,
      } }); } catch { throw new Error('Google 계정 identity를 확인하지 못했어요.'); }
      const body = await response.json().catch(() => null);
      const subject = String(body?.sub ?? '').trim(); const email = String(body?.email ?? '').trim();
      if (!response.ok || !subject || !email) throw new Error('Google 계정 identity를 확인하지 못했어요.');
      const protectedResult = await runtime.callTool({ name: 'search_files', arguments: { query: "owner = 'me'" } });
      if (protectedResult?.isError === true) throw new Error('Google Drive 읽기 권한을 확인하지 못했어요.');
      return { accountId: subject, accountLabel: email, permissions: grantedScopes,
        resources: [{ id: subject, label: email, scope: body?.hd ? `workspace:${body.hd}` : 'google-account' }],
        capabilities: { search: true, read: true, create: false, update: false } };
    },
  });
}
