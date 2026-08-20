const DEFAULT_API = 'https://api.telegram.org';
const TELEGRAM_TEXT_LIMIT = 4_000;

export function splitTelegramText(value, limit = TELEGRAM_TEXT_LIMIT) {
  const text = String(value ?? '');
  if (!text) return [];
  const chunks = [];
  let current = '';
  for (const symbol of text) {
    if (current && current.length + symbol.length > limit) {
      chunks.push(current);
      current = '';
    }
    current += symbol;
  }
  if (current) chunks.push(current);
  return chunks;
}

export class TelegramMessengerError extends Error {
  constructor(code, { status = null, retriable = false } = {}) {
    super(code);
    this.name = 'TelegramMessengerError';
    this.code = code;
    this.status = status;
    this.retriable = retriable;
  }
}

function normalizedMessage(update, botUsername) {
  const source = update?.message ?? update?.edited_message;
  const text = typeof source?.text === 'string' ? source.text.trim() : '';
  if (!text) return null;
  const username = String(botUsername ?? '').replace(/^@/, '');
  const mentioned = username
    ? new RegExp(`@${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
    : /^\//.test(text);
  return {
    provider: 'telegram',
    updateId: Number(update.update_id),
    messageId: source.message_id == null ? null : String(source.message_id),
    chatId: String(source.chat?.id ?? ''),
    threadId: source.message_thread_id == null ? null : String(source.message_thread_id),
    userId: String(source.from?.id ?? ''),
    username: source.from?.username ? String(source.from.username) : null,
    text,
    isDirectMessage: source.chat?.type === 'private',
    isMention: mentioned,
  };
}

export function makeTelegramMessengerProvider({
  token,
  apiBase = DEFAULT_API,
  fetchImpl = globalThis.fetch,
  pollTimeoutSeconds = 25,
  requestTimeoutMs = (pollTimeoutSeconds + 10) * 1000,
  typingIntervalMs = 4_000,
  typingTtlMs = 300_000,
} = {}) {
  if (!token || typeof token !== 'string') throw new TypeError('telegram bot token is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  let bot = null;

  async function call(method, body, externalSignal, timeoutOverride) {
    const controller = new AbortController();
    const abort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error('request_timeout')),
      timeoutOverride ?? requestTimeoutMs,
    );
    timer.unref?.();
    try {
      const response = await fetchImpl(`${String(apiBase).replace(/\/$/, '')}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });
      const json = await response.json().catch(() => null);
      if (response.status === 401 || json?.error_code === 401) {
        throw new TelegramMessengerError('telegram_auth_failed', { status: response.status });
      }
      if (response.status === 429 || json?.error_code === 429) {
        throw new TelegramMessengerError('telegram_rate_limited', { status: response.status, retriable: true });
      }
      if (!response.ok || json?.ok !== true) {
        throw new TelegramMessengerError('telegram_request_failed', {
          status: response.status, retriable: response.status >= 500,
        });
      }
      return json.result;
    } catch (error) {
      if (error instanceof TelegramMessengerError) throw error;
      if (externalSignal?.aborted) throw new TelegramMessengerError('telegram_poll_stopped');
      throw new TelegramMessengerError('telegram_network_failed', { retriable: true });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    }
  }

  return {
    id: 'telegram',
    inboundMode: 'long_polling',

    async validate({ signal } = {}) {
      const result = await call('getMe', {}, signal);
      if (!result?.id || !result?.username) throw new TelegramMessengerError('telegram_identity_invalid');
      bot = { id: String(result.id), username: String(result.username) };
      return structuredClone(bot);
    },

    async poll({ offset = 0, signal } = {}) {
      const updates = await call('getUpdates', {
        offset, timeout: pollTimeoutSeconds, allowed_updates: ['message', 'edited_message'],
      }, signal);
      return (Array.isArray(updates) ? updates : []).map((update) => ({
        updateId: Number(update?.update_id ?? 0),
        message: normalizedMessage(update, bot?.username),
      }));
    },

    startTyping({ chatId, threadId } = {}) {
      if (!chatId) return { stop() {} };
      let stopped = false;
      let inFlight = null;
      let failures = 0;
      const controller = new AbortController();
      const body = {
        chat_id: String(chatId), action: 'typing',
        ...(threadId != null ? { message_thread_id: Number(threadId) } : {}),
      };
      const ping = () => {
        if (stopped || inFlight || failures >= 3) return;
        inFlight = call('sendChatAction', body, controller.signal, 5_000)
          .then(() => { failures = 0; })
          .catch((error) => {
            if (!stopped && error?.code !== 'telegram_poll_stopped') failures += 1;
          })
          .finally(() => { inFlight = null; });
      };
      ping();
      const interval = setInterval(ping, Math.max(10, typingIntervalMs));
      interval.unref?.();
      const ttl = setTimeout(() => {
        stopped = true; clearInterval(interval); controller.abort();
      }, Math.max(100, typingTtlMs));
      ttl.unref?.();
      return {
        stop() {
          if (stopped) return;
          stopped = true;
          clearInterval(interval); clearTimeout(ttl); controller.abort();
        },
      };
    },

    async sendReply({ chatId, threadId, text, signal } = {}) {
      if (!chatId) throw new TypeError('telegram reply chat is required');
      if (!String(text ?? '').trim()) throw new TypeError('telegram reply text is required');
      const messageIds = [];
      const chunks = splitTelegramText(text);
      for (const chunk of chunks) {
        let result;
        try {
          result = await call('sendMessage', {
            chat_id: String(chatId), text: chunk,
            ...(threadId != null && String(threadId) !== '1'
              ? { message_thread_id: Number(threadId) } : {}),
          }, signal);
        } catch (error) {
          error.deliveryState = messageIds.length ? 'partial' : 'not_confirmed';
          error.deliveredMessageIds = [...messageIds];
          throw error;
        }
        if (result?.message_id != null) messageIds.push(String(result.message_id));
      }
      return {
        sent: true, provider: 'telegram', chatId: String(chatId),
        messageId: messageIds.at(-1) ?? null, messageIds, chunks: chunks.length,
      };
    },
  };
}
