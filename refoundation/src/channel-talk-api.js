const API_ROOT = 'https://api.channel.io/open/v5';
const DEFAULT_TIMEOUT_MS = 15_000;

function boundedLimit(value) {
  const number = Number(value ?? 25);
  if (!Number.isInteger(number) || number < 1 || number > 100) throw new TypeError('Channel Talk limit is invalid');
  return number;
}

function exactId(value, label) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 200) throw new TypeError(`${label} is invalid`);
  return id;
}

function requestTimeout() {
  return Object.assign(new Error('Channel Talk 응답을 기다리는 시간이 초과됐어요.'), {
    reason: 'request_timeout',
  });
}

async function boundedRead(operation, timeoutMs) {
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(requestTimeout());
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export function makeChannelTalkApi({ credential, fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof credential !== 'function') throw new TypeError('Channel Talk credential source is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120_000) {
    throw new TypeError('Channel Talk timeout is invalid');
  }
  async function request(path, query = {}) {
    const current = await credential();
    if (!current?.accessKey || !current?.accessSecret) throw new Error('Channel Talk 연결 정보가 없어요.');
    const url = new URL(`${API_ROOT}${path}`);
    for (const [name, value] of Object.entries(query)) if (value != null) url.searchParams.set(name, String(value));
    let response; let body;
    try {
      ({ response, body } = await boundedRead(async (signal) => {
        const received = await fetchImpl(url, { method: 'GET', signal, headers: {
          accept: 'application/json', 'x-access-key': current.accessKey, 'x-access-secret': current.accessSecret,
        } });
        return { response: received, body: await received.json().catch(() => null) };
      }, timeoutMs));
    } catch (error) {
      if (error?.reason === 'request_timeout') throw error;
      throw Object.assign(new Error('Channel Talk에 연결하지 못했어요.'), { reason: 'transport_failed' });
    }
    if (!response.ok || !body || typeof body !== 'object') throw Object.assign(
      new Error(response.status === 401 || response.status === 403
        ? 'Channel Talk 연결 정보를 확인해 주세요.' : 'Channel Talk 응답을 확인하지 못했어요.'),
      { status: response.status || 502, reason: response.status === 401 || response.status === 403
        ? 'authentication_failed' : 'provider_failed' });
    return body;
  }
  return {
    async probe() {
      const result = await request('/managers', { limit: 1 }); const manager = result.managers?.[0];
      const channelId = String(manager?.channelId ?? '').trim();
      if (!channelId) throw new Error('Channel Talk 채널 identity를 확인하지 못했어요.');
      return { channelId, label: `${String(manager?.name ?? 'Channel Talk').trim()} 채널`, managerId: manager?.id ?? null };
    },
    async listChats({ state = 'opened', limit = 25 } = {}) {
      if (!['opened', 'snoozed', 'closed'].includes(state)) throw new TypeError('Channel Talk chat state is invalid');
      const result = await request('/user-chats', { state, sortOrder: 'desc', limit: boundedLimit(limit) });
      return { userChats: Array.isArray(result.userChats) ? result.userChats.slice(0, 100) : [], next: result.next ?? null };
    },
    async readMessages({ chatId, limit = 25 } = {}) {
      const id = exactId(chatId, 'Channel Talk chat id');
      const result = await request(`/user-chats/${encodeURIComponent(id)}/messages`, { sortOrder: 'desc', limit: boundedLimit(limit) });
      return { messages: Array.isArray(result.messages) ? result.messages.slice(0, 100) : [], next: result.next ?? null };
    },
  };
}
