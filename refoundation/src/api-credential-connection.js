const FIELD_ID = /^[a-z][A-Za-z0-9]{0,63}$/u;
const CAPABILITY = /^[a-z][a-z0-9_]{0,63}$/u;

function fields(value) {
  if (!Array.isArray(value) || !value.length || value.length > 16) {
    throw new TypeError('API credential fields are required');
  }
  const ids = new Set();
  return value.map((field) => {
    const id = String(field?.id ?? '').trim(); const label = String(field?.label ?? '').trim();
    const maxLength = Number(field?.maxLength ?? 4096);
    if (!FIELD_ID.test(id) || ids.has(id) || !label || !Number.isInteger(maxLength)
      || maxLength < 1 || maxLength > 16_384) throw new TypeError('API credential field is invalid');
    ids.add(id); return { id, label: label.slice(0, 120), secret: field?.secret !== false, maxLength };
  });
}

function credentials(value, definitions) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('API credentials are required');
  const allowed = new Set(definitions.map((field) => field.id));
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError('API credentials contain an unknown field');
  return Object.fromEntries(definitions.map((field) => {
    const item = String(value[field.id] ?? '').trim();
    if (!item || item.length > field.maxLength) throw new TypeError(`API credential ${field.id} is invalid`);
    return [field.id, item];
  }));
}

function capabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('API credential verification returned no capabilities');
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 32
    || entries.some(([key, available]) => !CAPABILITY.test(key) || typeof available !== 'boolean')) {
    throw new Error('API credential verification returned invalid capabilities');
  }
  return Object.fromEntries(entries);
}

function identity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('API credential verification returned no identity');
  const accountId = String(value.accountId ?? '').trim().slice(0, 200);
  const accountLabel = String(value.accountLabel ?? '').trim().slice(0, 200);
  if (!accountId) throw new Error('API credential account identity was not observed');
  const permissions = Array.isArray(value.permissions)
    ? [...new Set(value.permissions.map(String).filter(Boolean))].slice(0, 64) : [];
  const resources = Array.isArray(value.resources) ? value.resources.slice(0, 32).flatMap((resource) => {
    const id = String(resource?.id ?? '').trim().slice(0, 200);
    const label = String(resource?.label ?? '').trim().slice(0, 200);
    const scope = String(resource?.scope ?? '').trim().slice(0, 80);
    return id && label && scope ? [{ id, label, scope }] : [];
  }) : [];
  return { ownerApplication: 'GPAO-T5', transport: 'official_api', accountId,
    ...(accountLabel ? { accountLabel } : {}), permissions, resources, observed: true };
}

export function makeApiCredentialConnection({
  id, label, category = 'business', secretStore, credentialFields,
  verifyCredentials, makeTool: toolFactory = null, now = Date.now,
} = {}) {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(String(id ?? '')) || !String(label ?? '').trim()) {
    throw new TypeError('API credential connection identity is required');
  }
  if (!secretStore?.get || !secretStore?.set || !secretStore?.clear) throw new TypeError('API credential secure store is required');
  if (typeof verifyCredentials !== 'function') throw new TypeError('API credential verifier is required');
  if (toolFactory != null && typeof toolFactory !== 'function') throw new TypeError('API credential tool factory is invalid');
  const definition = fields(credentialFields); const secretName = `api-credential-${id}`;
  async function bundle() { return secretStore.get(secretName); }
  return {
    id, label, category, toolName: id,
    async inspect() {
      const current = await bundle(); const ready = Boolean(current?.verifiedAt && current?.identity);
      return { state: ready ? 'ready' : 'needs_connection',
        reason: ready ? 'verified_official_api' : 'api_credentials_required',
        userSafeSummary: ready ? `${label} 계정을 사용할 준비가 되어 있어요.` : `${label}의 공식 연결 정보를 입력해 주세요.`,
        capabilities: ready ? structuredClone(current.capabilities) : {},
        ...(ready ? { identity: structuredClone(current.identity) } : {}),
        credentialRequest: { fields: structuredClone(definition) },
        routes: [{ kind: 'official_api', label: `${label} 공식 연결`, state: ready ? 'ready' : 'needs_connection', canStart: !ready }],
        actions: ready
          ? [{ id: 'disconnect', label: '연결 해제', kind: 'disconnect', endpoint: `/connections/${id}/disconnect` }]
          : [{ id: 'connect', label: `${label} 연결 정보 입력`, kind: 'credentials', endpoint: `/connections/${id}/credentials` }],
      };
    },
    async connectCredentials(input) {
      const checked = credentials(input, definition); let observed;
      try { observed = await verifyCredentials(structuredClone(checked)); }
      catch { throw Object.assign(new Error(`${label} 연결 정보를 확인하지 못했어요.`), { reason: 'credential_verification_failed' }); }
      const verifiedIdentity = identity(observed);
      const verifiedCapabilities = capabilities(observed.capabilities);
      await secretStore.set(secretName, { version: 1, credentials: checked,
        identity: verifiedIdentity, capabilities: verifiedCapabilities, verifiedAt: now() });
      return { connected: true, ready: true, provider: id,
        account: { id: verifiedIdentity.accountId, label: verifiedIdentity.accountLabel ?? null },
        userSafeSummary: `${label} 계정을 연결했어요.` };
    },
    async credential() {
      const current = await bundle();
      if (!current?.verifiedAt || !current?.credentials) {
        throw Object.assign(new Error(`${label} 연결이 필요해요.`), { reason: 'not_connected' });
      }
      return structuredClone(current.credentials);
    },
    async makeTool(context = {}) {
      if (!toolFactory || (await this.inspect()).state !== 'ready') return null;
      return toolFactory({ credential: () => this.credential(), ...context });
    },
    async disconnect() { await secretStore.clear(secretName);
      return { disconnected: true, userSafeSummary: `${label} 연결을 해제했어요.` }; },
    async close() {},
  };
}
