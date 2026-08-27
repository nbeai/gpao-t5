const PACKAGE_SCHEMA = 't5.capability-package.v1';
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const KINDS = new Set(['agent_skill', 'remote_mcp', 'local_mcp', 'managed_cli',
  'executable_extension', 'declarative_http']);
const SOURCE_KINDS = new Set(['local_directory', 'git_exact_ref', 'registry_exact_version', 'remote_mcp_url']);
const AUTH = new Set(['none', 'api_key', 'bearer', 'oauth2_pkce', 'oauth2_device', 'oidc',
  'service_account', 'hmac', 'mtls', 'cli_owned']);
const EFFECTS = new Set(['observe', 'local_change', 'external_change', 'destructive',
  'external_send', 'payment', 'secret_input']);
const IDEMPOTENCY = new Set(['not_applicable', 'provider_key', 'runtime_fenced', 'unknown']);
const PLATFORMS = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64',
  'win32-arm64', 'win32-x64']);

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError(`${label} is invalid`);
}

function text(value, label, maximum = 500) {
  const result = String(value ?? '').trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

function https(value, label) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw new TypeError(`${label} must be HTTPS`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new TypeError(`${label} must be HTTPS`);
  return parsed.href;
}

function iso(value, label) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be canonical UTC`);
  }
  return value;
}

function list(value, label, maximum, normalize) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} is invalid`);
  return value.map(normalize);
}

function knowledge(value) {
  exactKeys(value, ['summary', 'sources', 'constraints'], 'Dock Knowledge');
  const sources = list(value.sources, 'Dock Knowledge sources', 24, (source) => {
    exactKeys(source, ['url', 'publisherIdentity', 'purpose', 'lastVerifiedAt', 'volatile'], 'Dock Knowledge source');
    return { url: https(source.url, 'Dock Knowledge source URL'),
      publisherIdentity: text(source.publisherIdentity, 'publisher identity', 160),
      purpose: text(source.purpose, 'source purpose', 240), lastVerifiedAt: iso(source.lastVerifiedAt, 'source time'),
      volatile: source.volatile === true };
  });
  if (!sources.length) throw new TypeError('Dock Knowledge requires a source');
  return { summary: text(value.summary, 'Dock Knowledge summary', 2_000), sources,
    constraints: list(value.constraints ?? [], 'Dock Knowledge constraints', 32,
      (item) => text(item, 'Dock Knowledge constraint', 500)) };
}

function source(value) {
  exactKeys(value, ['kind', 'locator', 'resolvedRef', 'artifactDigest', 'publisherIdentity',
    'signature', 'license'], 'capability source');
  if (!SOURCE_KINDS.has(value.kind)) throw new TypeError('capability source kind is invalid');
  const resolvedRef = text(value.resolvedRef, 'resolved source ref', 300);
  if (['git_exact_ref', 'registry_exact_version'].includes(value.kind)
    && !resolvedRef) throw new TypeError('immutable source ref is required');
  if (!SHA256.test(value.artifactDigest ?? '')) throw new TypeError('artifact digest is invalid');
  return { kind: value.kind, locator: value.kind === 'local_directory'
    ? text(value.locator, 'local source locator', 2_000) : https(value.locator, 'source locator'),
  resolvedRef, artifactDigest: value.artifactDigest,
  publisherIdentity: text(value.publisherIdentity, 'source publisher', 160),
  signature: value.signature == null ? null : text(value.signature, 'source signature fact', 500),
  license: text(value.license, 'source license', 120) };
}

function auth(value) {
  exactKeys(value, ['strategy', 'credentialOwner', 'scopes', 'redirectOrigins'], 'capability auth');
  if (!AUTH.has(value.strategy)) throw new TypeError('capability auth strategy is invalid');
  const scopes = list(value.scopes ?? [], 'auth scopes', 64, (item) => text(item, 'auth scope', 160));
  const redirectOrigins = list(value.redirectOrigins ?? [], 'redirect origins', 8, (item) => {
    const parsed = new URL(String(item));
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password
      || (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(parsed.hostname))) {
      throw new TypeError('redirect origin is invalid');
    }
    return parsed.origin;
  });
  return { strategy: value.strategy, credentialOwner: text(value.credentialOwner, 'credential owner', 160),
    scopes, redirectOrigins };
}

function action(value) {
  exactKeys(value, ['id', 'effect', 'hosts', 'idempotency', 'inputSchema'], 'capability action');
  if (!ID.test(value.id ?? '') || !EFFECTS.has(value.effect)
    || !IDEMPOTENCY.has(value.idempotency)) throw new TypeError('capability action contract is invalid');
  const hosts = list(value.hosts ?? [], 'action hosts', 16, (item) => {
    const host = String(item).toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(host) || host.includes('..')) {
      throw new TypeError('action host is invalid');
    }
    return host;
  });
  if (!value.inputSchema || typeof value.inputSchema !== 'object' || Array.isArray(value.inputSchema)
    || value.inputSchema.type !== 'object' || value.inputSchema.additionalProperties !== false) {
    throw new TypeError('closed action input schema is required');
  }
  return { id: value.id, effect: value.effect, hosts: [...new Set(hosts)],
    idempotency: value.idempotency, inputSchema: structuredClone(value.inputSchema) };
}

function machineManifest(value) {
  exactKeys(value, ['kind', 'source', 'platforms', 'entrypoint', 'auth', 'actions', 'dependencies',
    'isolation', 'lifecycle', 'qualification'], 'Machine Manifest');
  if (!KINDS.has(value.kind)) throw new TypeError('capability kind is invalid');
  const platforms = list(value.platforms, 'capability platforms', 12, (item) => {
    if (!PLATFORMS.has(item)) throw new TypeError('capability platform is invalid'); return item;
  });
  if (!platforms.length) throw new TypeError('capability platform is required');
  exactKeys(value.entrypoint, ['kind', 'value'], 'capability entrypoint');
  if (!['none', 'executable', 'remote_http', 'stdio'].includes(value.entrypoint.kind)) {
    throw new TypeError('capability entrypoint kind is invalid');
  }
  const actions = list(value.actions, 'capability actions', 64, action);
  if (!actions.length || new Set(actions.map((item) => item.id)).size !== actions.length) {
    throw new TypeError('capability actions must be unique');
  }
  const dependencies = list(value.dependencies ?? [], 'capability dependencies', 64, (dependency) => {
    exactKeys(dependency, ['name', 'version', 'digest'], 'capability dependency');
    if (!SHA256.test(dependency.digest ?? '')) throw new TypeError('dependency digest is invalid');
    return { name: text(dependency.name, 'dependency name', 160),
      version: text(dependency.version, 'dependency version', 120), digest: dependency.digest };
  });
  exactKeys(value.isolation, ['process', 'filesystem', 'network'], 'capability isolation');
  if (value.isolation.process !== 'separate_process') throw new TypeError('extension must use a separate process');
  exactKeys(value.lifecycle, ['install', 'update', 'remove', 'rollback'], 'capability lifecycle');
  if (Object.values(value.lifecycle).some((item) => !['declarative', 'not_applicable'].includes(item))) {
    throw new TypeError('arbitrary lifecycle hooks are not allowed');
  }
  exactKeys(value.qualification, ['fixtureId', 'probeAction', 'expectedObservation'], 'capability qualification');
  return { kind: value.kind, source: source(value.source), platforms: [...new Set(platforms)],
    entrypoint: { kind: value.entrypoint.kind, value: text(value.entrypoint.value, 'entrypoint value', 2_000) },
    auth: auth(value.auth), actions, dependencies,
    isolation: { process: value.isolation.process,
      filesystem: list(value.isolation.filesystem ?? [], 'isolation filesystem', 32,
        (item) => text(item, 'isolation filesystem entry', 500)),
      network: list(value.isolation.network ?? [], 'isolation network', 32,
        (item) => text(item, 'isolation network entry', 253)) },
    lifecycle: structuredClone(value.lifecycle),
    qualification: { fixtureId: text(value.qualification.fixtureId, 'qualification fixture', 160),
      probeAction: text(value.qualification.probeAction, 'qualification probe', 160),
      expectedObservation: text(value.qualification.expectedObservation, 'qualification observation', 500) } };
}

export function validateCapabilityPackage(input) {
  exactKeys(input, ['schema', 'id', 'version', 'knowledge', 'manifest'], 'capability package');
  if (input.schema !== PACKAGE_SCHEMA || !ID.test(input.id ?? '') || !VERSION.test(input.version ?? '')) {
    throw new TypeError('capability package identity is invalid');
  }
  return Object.freeze({ schema: PACKAGE_SCHEMA, id: input.id, version: input.version,
    knowledge: knowledge(input.knowledge), manifest: machineManifest(input.manifest) });
}

export const CAPABILITY_PACKAGE_SCHEMA = PACKAGE_SCHEMA;
