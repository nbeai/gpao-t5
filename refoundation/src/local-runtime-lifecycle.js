import { lstat, readFile } from 'node:fs/promises';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function validPort(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 65_535;
}

export async function observeLocalRuntime({
  portFile,
  fetcher = globalThis.fetch,
  healthTimeoutMs = 1_000,
} = {}) {
  if (!portFile || typeof fetcher !== 'function') {
    throw new TypeError('local runtime observation requires a port file and fetcher');
  }
  try {
    const metadata = await lstat(portFile);
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size <= 0 || metadata.size > 4_096) {
      return { state: 'unavailable', reason: 'invalid_port_fact' };
    }
    const fact = JSON.parse(await readFile(portFile, 'utf8'));
    if (!validPort(fact?.port) || !Number.isSafeInteger(fact?.pid) || fact.pid <= 0) {
      return { state: 'unavailable', reason: 'invalid_port_fact' };
    }
    const url = `http://127.0.0.1:${fact.port}`;
    const response = await fetcher(`${url}/health`, { signal: AbortSignal.timeout(healthTimeoutMs) });
    if (!response?.ok) return { state: 'unavailable', reason: 'health_unavailable' };
    const health = await response.json();
    if (health?.ok !== true || health.product !== 'gpao-t5-refoundation') {
      return { state: 'unavailable', reason: 'health_identity_mismatch' };
    }
    return { state: 'healthy', port: fact.port, pid: fact.pid, url };
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError'
      || error?.code === 'ENOENT' || error instanceof SyntaxError || error instanceof TypeError) {
      return { state: 'unavailable', reason: 'health_unavailable' };
    }
    throw error;
  }
}

export async function waitForLocalRuntime({
  portFile,
  fetcher = globalThis.fetch,
  timeoutMs = 45_000,
  pollMs = 200,
  healthTimeoutMs = 1_000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const observed = await observeLocalRuntime({ portFile, fetcher, healthTimeoutMs });
    if (observed.state === 'healthy') return observed;
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  } while (true);
  throw Object.assign(new Error('local runtime did not become healthy'), {
    code: 'T5_LOCAL_RUNTIME_UNAVAILABLE',
  });
}

export async function ensureLocalRuntime({
  portFile,
  startRuntime,
  fetcher = globalThis.fetch,
  timeoutMs = 45_000,
  pollMs = 200,
  healthTimeoutMs = 1_000,
} = {}) {
  if (typeof startRuntime !== 'function') throw new TypeError('local runtime start adapter is required');
  const current = await observeLocalRuntime({ portFile, fetcher, healthTimeoutMs });
  if (current.state === 'healthy') return { ...current, started: false };
  const startReceipt = await startRuntime();
  const ready = await waitForLocalRuntime({ portFile, fetcher, timeoutMs, pollMs, healthTimeoutMs });
  return { ...ready, started: true, startReceipt };
}

export async function stopLocalRuntime({
  portFile,
  reason,
  fetcher = globalThis.fetch,
  timeoutMs = 15_000,
  pollMs = 100,
} = {}) {
  if (!['user_full_stop', 'product_update', 'product_uninstall'].includes(reason)) {
    throw new TypeError('local runtime stop reason is invalid');
  }
  const current = await observeLocalRuntime({ portFile, fetcher });
  if (current.state !== 'healthy') return { stopped: true, alreadyStopped: true };
  const root = await fetcher(`${current.url}/`);
  const cookie = root?.headers?.get?.('set-cookie')?.split(';', 1)[0];
  await root?.arrayBuffer?.();
  if (!root?.ok || !cookie) throw Object.assign(new Error('local runtime stop identity is unavailable'), {
    code: 'T5_RUNTIME_STOP_IDENTITY_UNAVAILABLE',
  });
  const response = await fetcher(`${current.url}/runtime/stop`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: current.url },
    body: JSON.stringify({ confirm: true, reason }),
  });
  if (response?.status !== 202) throw Object.assign(new Error('local runtime refused to stop'), {
    code: 'T5_RUNTIME_STOP_REFUSED', status: response?.status ?? null,
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await lstat(portFile); }
    catch (error) {
      if (error?.code === 'ENOENT') return { stopped: true, alreadyStopped: false };
      throw error;
    }
    await sleep(pollMs);
  }
  throw Object.assign(new Error('local runtime stop timed out'), { code: 'T5_RUNTIME_STOP_TIMEOUT' });
}
