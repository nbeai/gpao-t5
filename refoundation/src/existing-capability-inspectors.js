export function makeRegisteredCliConnectionInspector({ broker, capabilityId, label } = {}) {
  if (!broker || typeof broker.inspect !== 'function') throw new TypeError('registered CLI broker is required');
  if (!capabilityId || !label) throw new TypeError('registered CLI inspector identity is required');
  return {
    id: capabilityId, label, category: 'authenticated_cli',
    async inspect() {
      const [current] = await broker.inspect(capabilityId);
      const ready = current?.state === 'ready';
      const account = current?.identity?.accountLabel;
      return {
        state: ready ? 'ready' : current?.state === 'needs_connection'
          ? 'needs_connection' : 'needs_attention',
        reason: current?.reason ?? 'registered_cli_identity_unverified',
        userSafeSummary: ready
          ? `${account ? `${account} 계정으로 ` : ''}${label}를 다시 로그인하지 않고 사용할 수 있어요.`
          : `${label}의 현재 로그인을 확인하지 못했어요.`,
        capabilities: Object.fromEntries((current?.actions ?? []).map((action) => [action, ready])),
        routes: [], identity: current?.identity ?? undefined,
      };
    },
  };
}

export function wrapRemoteConnectionTool({ tool, service } = {}) {
  if (!tool || typeof tool.execute !== 'function' || !service?.id || typeof service.inspect !== 'function') {
    throw new TypeError('remote connection tool wrapper inputs are required');
  }
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(args, context) {
      const result = await execute(args, context);
      let connection = null;
      try { connection = await service.inspect(); } catch { /* execution result remains authoritative */ }
      const identity = connection?.identity;
      const effectKind = String(args?.effect?.kind ?? 'observe');
      const receipt = makeCapabilityUseReceipt({
        kind: 'remote_connection', capabilityId: service.id,
        action: String(args?.action ?? tool.name).replaceAll('_', '-'),
        credential: { owner: 'T5 connection', storage: 'platform_secret_store' },
        authority: identity?.observed === true ? {
          state: 'observed', accountId: identity.accountId,
          accountLabel: identity.accountLabel, permissions: identity.permissions,
        } : { state: 'unknown', permissions: [] },
        execution: { state: 'succeeded', adapter: `remote-connection:${service.id}` },
        effect: { state: effectKind === 'observe' ? 'observed' : 'unknown', kind: effectKind },
      });
      return {
        ...result,
        capabilitiesUsed: [
          ...(result?.capabilitiesUsed ?? []),
          { kind: 'remote_connection', id: service.id, action: receipt.action },
        ],
        capabilityReceipts: [...(result?.capabilityReceipts ?? []), receipt],
      };
    },
  };
}
import { makeCapabilityUseReceipt } from './capability-use-receipt.js';
