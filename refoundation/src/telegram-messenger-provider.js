const DEFAULT_API = 'https://api.telegram.org';
const TELEGRAM_TEXT_LIMIT = 4_000;
const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

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

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function telegramMarkdownToHtml(value) {
  const parts = String(value ?? '').split(/```(?:[a-zA-Z0-9_-]*\n)?/u);
  return parts.map((part, index) => {
    if (index % 2 === 1) return `<pre>${escapeHtml(part.replace(/\n$/u, ''))}</pre>`;
    return part.split('\n').map((sourceLine) => {
      let line = sourceLine;
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/u);
      if (heading) line = `**${heading[1]}**`;
      line = line.replace(/^(\s*)[-*•]\s+/u, '$1· ');
      let text = escapeHtml(line);
      text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/gu, '<a href="$2">$1</a>');
      text = text.replace(/`([^`]+)`/gu, '<code>$1</code>');
      text = text.replace(/\*\*([^*]+)\*\*/gu, '<b>$1</b>');
      text = text.replace(/(^|[^*])\*([^*\n]+)\*(?=[^*]|$)/gu, '$1<i>$2</i>');
      return text;
    }).join('\n');
  }).join('').trim();
}

export function stripMarkdownForTelegram(value) {
  return String(value ?? '')
    .replace(/```(?:[a-zA-Z0-9_-]*\n)?/gu, '')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^(\s*)[-*•]\s+/gmu, '$1· ')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/gu, '$1 ($2)')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?=[^*]|$)/gu, '$1$2')
    .trim();
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
  const text = typeof source?.text === 'string' ? source.text.trim()
    : typeof source?.caption === 'string' ? source.caption.trim() : '';
  const attachment = source?.document ? {
    providerFileId: String(source.document.file_id ?? ''),
    providerUniqueId: String(source.document.file_unique_id ?? ''),
    originalName: String(source.document.file_name ?? 'telegram-document'),
    declaredMime: source.document.mime_type ? String(source.document.mime_type) : null,
    declaredBytes: Number.isFinite(source.document.file_size) ? Number(source.document.file_size) : null,
    nativeKind: 'document',
  } : Array.isArray(source?.photo) && source.photo.length ? (() => {
    const photo = source.photo.at(-1);
    return {
      providerFileId: String(photo?.file_id ?? ''),
      providerUniqueId: String(photo?.file_unique_id ?? ''),
      originalName: `telegram-photo-${source.message_id}.jpg`,
      declaredMime: 'image/jpeg',
      declaredBytes: Number.isFinite(photo?.file_size) ? Number(photo.file_size) : null,
      nativeKind: 'photo',
    };
  })() : null;
  if (!text && !attachment) return null;
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
    attachments: attachment?.providerFileId ? [attachment] : [],
    mediaGroupId: source.media_group_id == null ? null : String(source.media_group_id),
    replyIdentity: source.reply_to_message?.message_id == null ? null : {
      provider: 'telegram', messageId: String(source.reply_to_message.message_id),
    },
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
  mediaGroupQuietMs = 120,
  mediaGroupMaxWaitMs = 600,
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

  async function callMultipart(method, form, externalSignal, timeoutOverride = requestTimeoutMs) {
    const controller = new AbortController();
    const abort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('request_timeout')), timeoutOverride);
    timer.unref?.();
    try {
      const response = await fetchImpl(`${String(apiBase).replace(/\/$/, '')}/bot${token}/${method}`, {
        method: 'POST', body: form, signal: controller.signal,
      });
      const json = await response.json().catch(() => null);
      if (response.status === 401 || json?.error_code === 401) {
        throw new TelegramMessengerError('telegram_auth_failed', { status: response.status });
      }
      if (!response.ok || json?.ok !== true) throw new TelegramMessengerError('telegram_request_failed', {
        status: response.status, retriable: response.status === 429 || response.status >= 500,
      });
      return json.result;
    } catch (error) {
      if (error instanceof TelegramMessengerError) throw error;
      if (externalSignal?.aborted) throw new TelegramMessengerError('telegram_poll_stopped');
      const unknown = new TelegramMessengerError('telegram_delivery_unknown');
      unknown.effectUnknown = true; unknown.retrySafe = false; unknown.deliveryState = 'unknown';
      throw unknown;
    } finally {
      clearTimeout(timer); externalSignal?.removeEventListener('abort', abort);
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
      let updates = await call('getUpdates', {
        offset, timeout: pollTimeoutSeconds, allowed_updates: ['message', 'edited_message'],
      }, signal);
      updates = Array.isArray(updates) ? updates : [];
      if (updates.some((update) => (update?.message ?? update?.edited_message)?.media_group_id)) {
        const deadline = Date.now() + Math.max(mediaGroupQuietMs, mediaGroupMaxWaitMs);
        let cursor = updates.reduce((max, update) => Math.max(max, Number(update?.update_id ?? 0) + 1), Number(offset));
        let quietObservations = 0;
        while (Date.now() < deadline && quietObservations < 2) {
          await new Promise((resolve, reject) => {
            const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
            const timer = setTimeout(finish, Math.max(5, mediaGroupQuietMs)); timer.unref?.();
            const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort);
              reject(new TelegramMessengerError('telegram_poll_stopped')); };
            if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
          });
          const extra = await call('getUpdates', {
            offset: cursor, timeout: 0, allowed_updates: ['message', 'edited_message'],
          }, signal);
          if (!Array.isArray(extra) || !extra.length) { quietObservations += 1; continue; }
          quietObservations = 0; updates.push(...extra);
          cursor = extra.reduce((max, update) => Math.max(max, Number(update?.update_id ?? 0) + 1), cursor);
        }
      }
      const normalized = (Array.isArray(updates) ? updates : []).map((update) => ({
        updateId: Number(update?.update_id ?? 0),
        message: normalizedMessage(update, bot?.username),
      }));
      const output = [];
      const groups = new Map();
      for (const item of normalized) {
        const groupId = item.message?.mediaGroupId;
        if (!groupId) { output.push(item); continue; }
        const key = [item.message.chatId, item.message.threadId ?? '', groupId].join(':');
        const existing = groups.get(key);
        if (!existing) {
          groups.set(key, {
            updateId: item.updateId, coveredUpdateIds: [item.updateId],
            message: structuredClone(item.message),
          });
          continue;
        }
        existing.updateId = Math.max(existing.updateId, item.updateId);
        existing.coveredUpdateIds.push(item.updateId);
        existing.message.messageId = item.message.messageId;
        existing.message.attachments.push(...item.message.attachments);
        if (item.message.text && !existing.message.text.split('\n').includes(item.message.text)) {
          existing.message.text = existing.message.text
            ? `${existing.message.text}\n${item.message.text}` : item.message.text;
        }
      }
      output.push(...groups.values());
      return output.sort((left, right) => left.updateId - right.updateId);
    },

    async downloadAttachment(descriptor, { signal, maxBytes = TELEGRAM_DOWNLOAD_LIMIT } = {}) {
      const declared = Number(descriptor?.declaredBytes ?? 0);
      const limit = Math.min(Number(maxBytes) || TELEGRAM_DOWNLOAD_LIMIT, TELEGRAM_DOWNLOAD_LIMIT);
      if (declared > limit) throw new TelegramMessengerError('telegram_attachment_too_large', { status: 413 });
      const file = await call('getFile', { file_id: String(descriptor?.providerFileId ?? '') }, signal);
      if (!file?.file_path) throw new TelegramMessengerError('telegram_file_identity_missing');
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      try {
        const base = String(apiBase).replace(/\/$/, '');
        const response = await fetchImpl(`${base}/file/bot${token}/${String(file.file_path).replace(/^\//, '')}`, {
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new TelegramMessengerError('telegram_attachment_download_failed', {
          status: response.status, retriable: response.status === 429 || response.status >= 500,
        });
        const contentLength = Number(response.headers.get('content-length') ?? 0);
        if (contentLength > limit) throw new TelegramMessengerError('telegram_attachment_too_large', { status: 413 });
        async function* boundedStream() {
          let total = 0;
          for await (const chunk of response.body) {
            total += chunk.length;
            if (total > limit) throw new TelegramMessengerError('telegram_attachment_too_large', { status: 413 });
            yield chunk;
          }
        }
        return {
          stream: boundedStream(),
          originalName: descriptor.originalName,
          declaredMime: descriptor.declaredMime,
          providerIdentity: {
            provider: 'telegram', fileId: descriptor.providerFileId,
            fileUniqueId: descriptor.providerUniqueId || null,
            mediaGroupId: descriptor.mediaGroupId ?? null,
          },
        };
      } catch (error) {
        if (error instanceof TelegramMessengerError) throw error;
        throw new TelegramMessengerError('telegram_attachment_download_failed', { retriable: true });
      } finally {
        signal?.removeEventListener('abort', abort);
      }
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

    createProgress({ chatId, threadId } = {}) {
      let messageId = null;
      let lastText = null;
      let stopped = false;
      let queue = Promise.resolve();
      const thread = threadId != null && String(threadId) !== '1'
        ? { message_thread_id: Number(threadId) } : {};
      const update = (value) => {
        const text = String(value ?? '').trim();
        if (!text || text === lastText || stopped) return queue;
        lastText = text;
        queue = queue.then(async () => {
          try {
            if (messageId == null) {
              const result = await call('sendMessage', {
                chat_id: String(chatId), text: `${text}…`, ...thread,
              }, undefined, 8_000);
              messageId = result?.message_id == null ? null : String(result.message_id);
            } else {
              await call('editMessageText', {
                chat_id: String(chatId), message_id: Number(messageId), text: `${text}…`, ...thread,
              }, undefined, 8_000);
            }
          } catch { /* 진행 표시 실패가 본 답을 막지 않는다 */ }
        });
        return queue;
      };
      const formattedCall = async (method, base, source) => {
        try {
          return await call(method, {
            ...base, text: telegramMarkdownToHtml(source), parse_mode: 'HTML', ...thread,
          });
        } catch (error) {
          if (error?.status !== 400) throw error;
          return call(method, { ...base, text: stripMarkdownForTelegram(source), ...thread });
        }
      };
      return {
        update,
        async finalize(value, { signal } = {}) {
          const chunks = splitTelegramText(value);
          if (!chunks.length) { stopped = true; return { sent: false, messageIds: [] }; }
          await queue;
          const messageIds = [];
          if (messageId != null) {
            const edited = await formattedCall('editMessageText', {
              chat_id: String(chatId), message_id: Number(messageId),
            }, chunks.shift());
            messageIds.push(String(edited?.message_id ?? messageId));
          }
          for (const chunk of chunks) {
            const sent = await formattedCall('sendMessage', { chat_id: String(chatId) }, chunk, signal);
            if (sent?.message_id != null) messageIds.push(String(sent.message_id));
          }
          stopped = true;
          return { sent: true, provider: 'telegram', chatId: String(chatId), messageIds };
        },
        async fail(text = '작업을 완료하지 못했어요.') {
          await queue;
          if (messageId != null) {
            try {
              await call('editMessageText', {
                chat_id: String(chatId), message_id: Number(messageId), text, ...thread,
              }, undefined, 8_000);
            } catch { /* 실패 안내도 best effort */ }
          }
          stopped = true;
        },
        async discard() {
          await queue;
          if (messageId != null) {
            try {
              await call('deleteMessage', {
                chat_id: String(chatId), message_id: Number(messageId), ...thread,
              }, undefined, 8_000);
            } catch { /* 진행 표시 정리는 best effort */ }
          }
          stopped = true;
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
          const base = {
            chat_id: String(chatId),
            ...(threadId != null && String(threadId) !== '1'
              ? { message_thread_id: Number(threadId) } : {}),
          };
          try {
            result = await call('sendMessage', {
              ...base, text: telegramMarkdownToHtml(chunk), parse_mode: 'HTML',
            }, signal);
          } catch (formatError) {
            if (formatError?.status !== 400) throw formatError;
            result = await call('sendMessage', {
              ...base, text: stripMarkdownForTelegram(chunk),
            }, signal);
          }
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

    async sendDocument({ chatId, threadId, artifact, caption = null, signal } = {}) {
      if (!chatId || !artifact?.bytes || !artifact?.record) throw new TypeError('telegram document delivery requires chat and artifact');
      const form = new FormData();
      form.set('chat_id', String(chatId));
      if (threadId != null && String(threadId) !== '1') form.set('message_thread_id', String(threadId));
      if (String(caption ?? '').trim()) form.set('caption', String(caption).slice(0, 1024));
      form.set('document', new Blob([artifact.bytes], {
        type: artifact.record.mimeType ?? 'application/octet-stream',
      }), artifact.record.originalName ?? 'result');
      try {
        const sent = await callMultipart('sendDocument', form, signal, 60_000);
        return {
          sent: true, provider: 'telegram', chatId: String(chatId),
          messageId: sent?.message_id == null ? null : String(sent.message_id),
          file: sent?.document ? {
            fileId: String(sent.document.file_id ?? ''),
            fileUniqueId: String(sent.document.file_unique_id ?? ''),
            fileName: String(sent.document.file_name ?? artifact.record.originalName ?? 'result'),
            mimeType: sent.document.mime_type ? String(sent.document.mime_type) : artifact.record.mimeType,
            bytes: Number(sent.document.file_size ?? artifact.record.bytes),
          } : null,
          artifact: {
            attachmentId: artifact.record.attachmentId,
            sha256: artifact.record.sha256, bytes: artifact.record.bytes,
          },
        };
      } catch (error) {
        if (error?.retriable) {
          error.effectUnknown = true; error.retrySafe = false; error.deliveryState = 'unknown';
        }
        throw error;
      }
    },
  };
}
