const CAPABILITY = /^[a-z][a-z0-9_]{0,63}$/u;

function capabilityMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([name, available]) => (
    CAPABILITY.test(name) && typeof available === 'boolean'
  )).slice(0, 64));
}

function scopes(value) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
}

function identityMatches(expected, observed) {
  if (!observed || typeof observed !== 'object') return false;
  for (const [name, value] of Object.entries(expected ?? {})) {
    if (value != null && String(observed[name] ?? '') !== String(value)) return false;
  }
  return Boolean(String(observed.accountId ?? '').trim());
}

function closed(state, reason, generation, extra = {}) {
  return { state, reason, generation, ...extra, capabilities: {} };
}

export function qualifyConnectionReadiness({
  credential, expectedIdentity, observedIdentity, requiredScopes = [],
  catalogCapabilities, liveCapabilities, protectedProbe, runtimeHealth,
} = {}) {
  const generation = Number.isInteger(credential?.generation) ? credential.generation : 0;
  if (!credential || credential.state === 'cleared') return closed('needs_connection', 'credential_missing', generation);
  if (credential.state === 'revoked') return closed('revoked', 'credential_revoked', generation);
  if (credential.state === 'needs_reauth') return closed('needs_reauth', 'credential_reauthentication_required', generation);
  if (credential.state === 'needs_additional_permission') {
    return closed('needs_additional_permission', 'credential_additional_permission_required', generation);
  }
  if (credential.state !== 'ready') return closed('verifying', 'credential_not_verified', generation);
  if (!identityMatches(expectedIdentity, observedIdentity)) {
    return closed('needs_account_selection', 'provider_identity_mismatch', generation);
  }
  const granted = new Set(scopes(credential.scopes));
  const missingScopes = scopes(requiredScopes).filter((scope) => !granted.has(scope));
  if (missingScopes.length) return closed('needs_additional_permission', 'required_scope_missing', generation, { missingScopes });
  if (protectedProbe?.attempted !== true) return closed('verifying', 'protected_capability_not_observed', generation);
  if (protectedProbe.ok !== true) {
    const state = protectedProbe.authState === 'needs_reauth' ? 'needs_reauth'
      : protectedProbe.authState === 'needs_additional_permission' ? 'needs_additional_permission' : 'degraded';
    return closed(state, protectedProbe.reason ?? 'protected_capability_probe_failed', generation);
  }
  if (runtimeHealth?.available !== true) return closed('degraded', runtimeHealth?.reason ?? 'runtime_unavailable', generation);
  const expected = capabilityMap(catalogCapabilities); const live = capabilityMap(liveCapabilities);
  const capabilities = Object.fromEntries(Object.keys(expected).map((name) => [name,
    expected[name] === true && live[name] === true]));
  return { state: 'ready', reason: 'verified', generation, capabilities,
    ...(protectedProbe.resourceId ? { resourceId: String(protectedProbe.resourceId) } : {}) };
}
