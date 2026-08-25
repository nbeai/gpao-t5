function uniqueScopes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((scope) => scope.trim()).filter(Boolean))];
}

function authParameter(header, name) {
  const source = String(header ?? '');
  const quoted = source.match(new RegExp(`(?:^|[,\\s])${name}="([^"]*)"`, 'iu'));
  if (quoted) return quoted[1];
  const plain = source.match(new RegExp(`(?:^|[,\\s])${name}=([^,\\s]+)`, 'iu'));
  return plain?.[1] ?? null;
}

export function classifyAuthChallenge({ status, wwwAuthenticate, currentScopes = [] } = {}) {
  const code = Number(status); const header = String(wwwAuthenticate ?? '');
  if (code === 401) return { kind: 'refresh', reason: authParameter(header, 'error') ?? 'unauthorized' };
  if (code !== 403) return { kind: 'none' };
  if (authParameter(header, 'error') !== 'insufficient_scope') return { kind: 'forbidden' };
  const requiredScopes = uniqueScopes(String(authParameter(header, 'scope') ?? '').split(/\s+/u));
  if (!requiredScopes.length) return { kind: 'forbidden' };
  return { kind: 'step_up', requiredScopes,
    authorizationScopes: uniqueScopes([...uniqueScopes(currentScopes), ...requiredScopes]) };
}

function completed(response, retryCount, credentialGeneration = null) {
  if (response?.ok === true) return { state: 'succeeded', value: response.value,
    retryCount, ...(credentialGeneration == null ? {} : { credentialGeneration }) };
  return null;
}

function transportFailure(error, mutation, retryCount) {
  if (mutation && error?.requestDispatched === true) return { state: 'unknown_external_effect', retryCount };
  return { state: 'failed', retrySafe: !mutation && error?.requestDispatched !== true, retryCount };
}

export async function runWithAuthRecovery({
  operation, refresh, reconnect, currentScopes = [], mutation = false,
} = {}) {
  if (typeof operation !== 'function' || typeof refresh !== 'function' || typeof reconnect !== 'function') {
    throw new TypeError('connection auth recovery functions are required');
  }
  let first;
  try { first = await operation({ attempt: 0 }); }
  catch (error) { return transportFailure(error, mutation, 0); }
  const immediate = completed(first, 0); if (immediate) return immediate;
  const challenge = classifyAuthChallenge({ status: first?.status,
    wwwAuthenticate: first?.wwwAuthenticate, currentScopes });
  if (challenge.kind === 'step_up') return { state: 'needs_additional_permission',
    requiredScopes: challenge.requiredScopes, authorizationScopes: challenge.authorizationScopes, retryCount: 0 };
  if (challenge.kind === 'forbidden' || challenge.kind === 'none') {
    return { state: challenge.kind === 'forbidden' ? 'forbidden' : 'failed', status: Number(first?.status ?? 0), retryCount: 0 };
  }

  let refreshed;
  try { refreshed = await refresh({ rejectedResponse: first }); }
  catch { return { state: 'degraded', retryCount: 0, credentialGeneration: null }; }
  const credentialGeneration = Number.isInteger(refreshed?.generation) ? refreshed.generation : null;
  if (refreshed?.refreshed !== true) return { state: refreshed?.state === 'degraded' ? 'degraded' : 'needs_reauth',
    retryCount: 0, credentialGeneration };
  try { await reconnect({ credentialGeneration }); }
  catch { return { state: 'degraded', retryCount: 0, credentialGeneration }; }

  let second;
  try { second = await operation({ attempt: 1, credentialGeneration }); }
  catch (error) { return transportFailure(error, mutation, 1); }
  const retried = completed(second, 1, credentialGeneration); if (retried) return retried;
  const secondChallenge = classifyAuthChallenge({ status: second?.status,
    wwwAuthenticate: second?.wwwAuthenticate, currentScopes });
  if (secondChallenge.kind === 'step_up') return { state: 'needs_additional_permission',
    requiredScopes: secondChallenge.requiredScopes,
    authorizationScopes: secondChallenge.authorizationScopes, retryCount: 1, credentialGeneration };
  if (secondChallenge.kind === 'refresh') return { state: 'needs_reauth', retryCount: 1, credentialGeneration };
  return { state: secondChallenge.kind === 'forbidden' ? 'forbidden' : 'failed',
    status: Number(second?.status ?? 0), retryCount: 1, credentialGeneration };
}
