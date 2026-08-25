import { makeApiCredentialConnection } from './api-credential-connection.js';
import { makeChannelTalkApi } from './channel-talk-api.js';
import { makeChannelTalkTool } from './channel-talk-tool.js';

export function makeChannelTalkConnection({ secretStore, fetchImpl = globalThis.fetch } = {}) {
  return makeApiCredentialConnection({
    id: 'channel-talk', label: 'Channel Talk', category: 'customer_channel', secretStore,
    credentialFields: [
      { id: 'accessKey', label: 'Access Key', secret: true },
      { id: 'accessSecret', label: 'Access Secret', secret: true },
    ],
    verifyCredentials: async (credentials) => {
      const api = makeChannelTalkApi({ credential: async () => credentials, fetchImpl });
      const observed = await api.probe();
      return { accountId: observed.channelId, accountLabel: observed.label,
        permissions: [], resources: [{ id: observed.channelId, label: observed.label, scope: 'channel' }],
        capabilities: { read: true, reply: false } };
    },
    makeTool: ({ credential }) => makeChannelTalkTool({
      api: makeChannelTalkApi({ credential, fetchImpl }),
    }),
  });
}
