const STATES = new Set(['connected', 'ready', 'needs_connection', 'needs_attention', 'unavailable']);
const ROUTE_STATES = new Set(['connected', 'ready', 'needs_connection', 'needs_attention', 'unavailable']);
const DEFAULT_TIMEOUT_MS = 3_000;

function definition(inspector) {
  const id = String(inspector?.id ?? '').trim();
  const label = String(inspector?.label ?? '').trim();
  const category = String(inspector?.category ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(id) || !label || !category
    || typeof inspector?.inspect !== 'function') throw new TypeError('invalid connection inspector');
  return { id, label, category, inspect: inspector.inspect };
}

function safeCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, available]) => (
    /^[a-z][a-z0-9_]{0,63}$/u.test(key) && typeof available === 'boolean'
  )).slice(0, 32));
}

function safeRoutes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((route) => {
    const kind = String(route?.kind ?? '').trim();
    const label = String(route?.label ?? '').trim();
    const state = String(route?.state ?? '').trim();
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(kind) || !label || !ROUTE_STATES.has(state)) return [];
    let startUrl = null;
    if (route?.startUrl != null) {
      try {
        const parsed = new URL(String(route.startUrl));
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) startUrl = parsed.href;
      } catch { /* invalid start URLs are not connection truth */ }
    }
    return [{
      kind, label, state, canStart: route?.canStart === true,
      ...(startUrl ? { startUrl } : {}),
    }];
  });
}

function safeActions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((action) => {
    const id = String(action?.id ?? '').trim();
    const label = String(action?.label ?? '').trim();
    const kind = String(action?.kind ?? '').trim();
    const endpoints = ['endpoint', 'startEndpoint', 'awaitEndpoint'].flatMap((key) => {
      const path = action?.[key] == null ? null : String(action[key]);
      return path && /^\/connections\/[a-z0-9-]+\/(?:start|await|action|check|cancel|disconnect)$/u.test(path)
        ? [[key, path]] : [];
    });
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(id) || !label
      || !['oauth', 'user_action', 'cancel', 'disconnect'].includes(kind)) return [];
    return [{ id, label, kind, ...Object.fromEntries(endpoints) }];
  });
}

function safeIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ownerApplication = String(value.ownerApplication ?? '').trim().slice(0, 80);
  const accountId = String(value.accountId ?? '').trim().slice(0, 200);
  const accountLabel = String(value.accountLabel ?? '').trim().slice(0, 200);
  const transport = String(value.transport ?? '').trim().slice(0, 80);
  if (!ownerApplication || !transport) return null;
  const permissions = Array.isArray(value.permissions)
    ? [...new Set(value.permissions.map(String).filter((item) => /^[a-z][a-z0-9_:.-]{0,79}$/u.test(item)))].slice(0, 32)
    : [];
  const resources = Array.isArray(value.resources) ? value.resources.slice(0, 32).flatMap((resource) => {
    const id = String(resource?.id ?? '').trim().slice(0, 200);
    const label = String(resource?.label ?? '').trim().slice(0, 200);
    const scope = String(resource?.scope ?? '').trim().slice(0, 80);
    return id && label && scope ? [{ id, label, scope }] : [];
  }) : [];
  return {
    ownerApplication, transport,
    ...(accountId ? { accountId } : {}), ...(accountLabel ? { accountLabel } : {}),
    permissions, resources,
    observed: value.observed === true,
  };
}

function safeResult(inspector, raw) {
  const state = String(raw?.state ?? '');
  if (!STATES.has(state)) throw new TypeError(`invalid connection state: ${state || '(empty)'}`);
  const reason = raw?.reason == null ? null : String(raw.reason).slice(0, 120);
  const summary = String(raw?.userSafeSummary ?? '').trim().slice(0, 500)
    || (state === 'connected' ? '연결되어 있어요.'
      : state === 'ready' ? '사용할 준비가 되어 있어요.'
        : state === 'needs_connection' ? '연결이 필요해요.'
          : state === 'unavailable' ? '지금은 사용할 수 없어요.' : '상태를 확인해 주세요.');
  return {
    id: inspector.id, label: inspector.label, category: inspector.category,
    state, reason, userSafeSummary: summary,
    capabilities: safeCapabilities(raw?.capabilities), routes: safeRoutes(raw?.routes),
    actions: safeActions(raw?.actions),
    ...(safeIdentity(raw?.identity) ? { identity: safeIdentity(raw.identity) } : {}),
  };
}

function timedInspect(inspector, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); reject(Object.assign(new Error('connection check timed out'), { code: 'CHECK_TIMEOUT' }));
    }, timeoutMs);
  });
  return Promise.race([
    Promise.resolve().then(() => inspector.inspect({ signal: controller.signal })), timeout,
  ]).finally(() => clearTimeout(timer));
}

export function makeConnectionDoctor({ inspectors = [], timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000) {
    throw new TypeError('connection doctor timeout is invalid');
  }
  const definitions = inspectors.map(definition);
  const ids = new Set();
  for (const item of definitions) {
    if (ids.has(item.id)) throw new TypeError(`duplicate connection inspector: ${item.id}`);
    ids.add(item.id);
  }
  return {
    async inspect() {
      const connections = await Promise.all(definitions.map(async (inspector) => {
        let raw;
        try { raw = await timedInspect(inspector, timeoutMs); }
        catch (error) {
          return {
            id: inspector.id, label: inspector.label, category: inspector.category,
            state: 'needs_attention',
            reason: error?.code === 'CHECK_TIMEOUT' ? 'check_timeout' : 'check_failed',
            userSafeSummary: '연결 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.',
            capabilities: {}, routes: [], actions: [],
          };
        }
        return safeResult(inspector, raw);
      }));
      const counts = Object.fromEntries([...STATES].map((state) => [
        state, connections.filter((connection) => connection.state === state).length,
      ]));
      return {
        schema: 't5.connection-truth.v1', checkedAt: new Date().toISOString(),
        connections, counts,
        userSafeSummary: connections.some((item) => item.state === 'needs_attention')
          ? '확인이 필요한 연결이 있어요.'
          : connections.some((item) => item.state === 'needs_connection')
            ? '연결하면 사용할 수 있는 항목이 있어요.' : '현재 연결 상태를 확인했어요.',
      };
    },
  };
}
