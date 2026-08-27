const KINDS = new Set(['local_file', 'authenticated_cli', 'remote_connection', 'os_native']);
const EXECUTION_STATES = new Set(['succeeded', 'failed', 'unknown']);
const AUTHORITY_STATES = new Set(['observed', 'unknown', 'not_applicable']);
const EFFECT_STATES = new Set(['observed', 'unknown', 'not_applicable']);

function identifier(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}

function bounded(value, label, maximum = 200) {
  const result = String(value ?? '').trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

function permissions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter((item) => (
    /^[a-zA-Z0-9][a-zA-Z0-9_:.,/*-]{0,119}$/u.test(item)
  )))].slice(0, 64);
}

function safeAuthority(value = {}) {
  const state = String(value.state ?? 'unknown');
  if (!AUTHORITY_STATES.has(state)) throw new TypeError('capability authority state is invalid');
  const accountId = value.accountId == null ? null : String(value.accountId).trim().slice(0, 200);
  const accountLabel = value.accountLabel == null ? null : String(value.accountLabel).trim().slice(0, 200);
  return {
    state, permissions: permissions(value.permissions),
    ...(accountId ? { accountId } : {}), ...(accountLabel ? { accountLabel } : {}),
  };
}

function safeCredential(value = {}) {
  const owner = bounded(value.owner ?? 'none', 'capability credential owner', 120);
  const storage = bounded(value.storage ?? 'not_applicable', 'capability credential storage', 120);
  return {
    owner, storage,
    rawExposedToModel: false,
    rawExposedToGeneralTerminal: false,
  };
}

function safeExecution(value = {}) {
  const state = String(value.state ?? 'unknown');
  if (!EXECUTION_STATES.has(state)) throw new TypeError('capability execution state is invalid');
  const adapter = bounded(value.adapter, 'capability execution adapter', 160);
  const result = { state, adapter };
  if (Number.isInteger(value.exitCode)) result.exitCode = value.exitCode;
  return result;
}

function safeEffect(value = {}) {
  const state = String(value.state ?? 'unknown');
  if (!EFFECT_STATES.has(state)) throw new TypeError('capability effect state is invalid');
  return { state, kind: bounded(value.kind ?? 'observe', 'capability effect kind', 80) };
}

export function makeCapabilityUseReceipt({
  kind, capabilityId, action, credential, authority, execution, effect,
} = {}) {
  if (!KINDS.has(kind)) throw new TypeError('capability kind is invalid');
  return Object.freeze({
    schema: 't5.capability-use-receipt.v1', kind,
    capabilityId: identifier(capabilityId, 'capability id'),
    action: identifier(action, 'capability action'),
    credential: safeCredential(credential),
    authority: safeAuthority(authority),
    execution: safeExecution(execution),
    effect: safeEffect(effect),
  });
}

export function settleCapabilityUse({ admission, result, effectObservation } = {}) {
  if (!admission) return null;
  const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : null;
  const executionState = exitCode === 0 ? 'succeeded' : exitCode == null ? 'unknown' : 'failed';
  const effectState = effectObservation?.after == null && effectObservation?.changed == null
    ? 'unknown' : 'observed';
  return makeCapabilityUseReceipt({
    ...admission,
    execution: { ...admission.execution, state: executionState, ...(exitCode == null ? {} : { exitCode }) },
    effect: { kind: effectObservation?.declared?.kind ?? admission.effect?.kind ?? 'observe', state: effectState },
  });
}
