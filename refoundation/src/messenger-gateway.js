import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeTelegramMessengerProvider } from './telegram-messenger-provider.js';

const AVAILABLE_PROVIDERS = Object.freeze(['telegram']);
const bindingKey = (provider, chatId) => `${provider}:${chatId}`;
const numericUserId = (value) => {
  const id = String(value ?? '').trim();
  return /^\d+$/u.test(id) && BigInt(id) > 0n ? id : null;
};
const conversationId = (message) => message.threadId == null
  ? message.chatId : `${message.chatId}:topic:${message.threadId}`;

export class MessengerStateStore {
  constructor(directory) {
    if (!directory) throw new TypeError('messenger state directory is required');
    this.directory = directory;
    this.file = join(directory, 'messenger-runtime.json');
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8'));
      if (state?.version !== 1 || !state.offsets || !state.bindings) throw new Error('unsupported messenger runtime state');
      state.allowed ??= {};
      state.pending ??= {};
      return state;
    } catch (error) {
      if (error?.code === 'ENOENT') return {
        version: 1, offsets: {}, bindings: {}, allowed: {}, pending: {},
      };
      throw error;
    }
  }

  async write(state) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.file);
  }

  serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  async offset(provider) { return Number((await this.read()).offsets[provider] ?? 0); }

  async saveOffset(provider, offset) {
    return this.serialize(async () => {
      const state = await this.read();
      state.offsets[provider] = Math.max(Number(state.offsets[provider] ?? 0), Number(offset ?? 0));
      await this.write(state);
      return state.offsets[provider];
    });
  }

  async session(provider, chatId) { return (await this.read()).bindings[bindingKey(provider, chatId)] ?? null; }

  async listBindings() {
    return Object.entries((await this.read()).bindings).map(([key, sessionId]) => {
      const split = key.indexOf(':');
      return {
        provider: split < 0 ? key : key.slice(0, split),
        chatId: split < 0 ? '' : key.slice(split + 1),
        sessionId,
      };
    });
  }

  async bind(provider, chatId, sessionId) {
    return this.serialize(async () => {
      const state = await this.read();
      const key = bindingKey(provider, chatId);
      state.bindings[key] ??= String(sessionId);
      await this.write(state);
      return state.bindings[key];
    });
  }

  async isAllowed(provider, { userId, username } = {}) {
    const id = numericUserId(userId);
    if (!id) return false;
    return ((await this.read()).allowed[provider] ?? []).some((entry) => entry.userId === id);
  }

  async notePending(provider, { userId, username } = {}) {
    if (userId == null && !username) return null;
    return this.serialize(async () => {
      const state = await this.read();
      state.pending[provider] ??= [];
      const id = userId == null ? null : String(userId);
      const normalized = String(username ?? '').replace(/^@/, '');
      let entry = state.pending[provider].find((candidate) => (
        (id && candidate.userId === id)
        || (normalized && String(candidate.username ?? '').toLowerCase() === normalized.toLowerCase())
      ));
      if (!entry) {
        entry = { userId: id, username: normalized || null, count: 0, firstSeenAt: Date.now() };
        state.pending[provider].push(entry);
      }
      entry.count += 1;
      entry.lastSeenAt = Date.now();
      await this.write(state);
      return structuredClone(entry);
    });
  }

  async listPending(provider) {
    return structuredClone((await this.read()).pending[provider] ?? []);
  }

  async listAllowed(provider) {
    return structuredClone((await this.read()).allowed[provider] ?? []);
  }

  async allow(provider, { userId, username, label } = {}) {
    const id = numericUserId(userId);
    if (!id) throw new TypeError('messenger sender requires a positive numeric user id');
    return this.serialize(async () => {
      const state = await this.read();
      state.allowed[provider] ??= [];
      const normalized = String(username ?? '').replace(/^@/, '');
      const match = (entry) => entry.userId === id;
      state.allowed[provider] = state.allowed[provider].filter((entry) => !match(entry));
      state.allowed[provider].push({
        userId: id, username: normalized || null, label: String(label ?? '').trim() || null,
        allowedAt: Date.now(),
      });
      state.pending[provider] = (state.pending[provider] ?? []).filter((entry) => !match(entry));
      await this.write(state);
      return this.listAllowed(provider);
    });
  }

  async revoke(provider, identity) {
    return this.serialize(async () => {
      const state = await this.read();
      const id = numericUserId(identity);
      state.allowed[provider] = (state.allowed[provider] ?? []).filter((entry) => entry.userId !== id);
      await this.write(state);
      return structuredClone(state.allowed[provider]);
    });
  }
}

function defaultProviderFactory({ provider, token }) {
  if (provider === 'telegram') return makeTelegramMessengerProvider({ token });
  throw new Error(`unsupported messenger provider: ${provider}`);
}

export function makeMessengerGateway({
  credentialStore,
  stateStore,
  providerFactory = defaultProviderFactory,
  createSession,
  authorizeInbound,
  onInbound,
  log = () => {},
  retryDelayMs = 1_000,
} = {}) {
  if (!credentialStore || !stateStore) throw new TypeError('messenger credential and state stores are required');
  if (typeof createSession !== 'function' || typeof authorizeInbound !== 'function'
    || typeof onInbound !== 'function') {
    throw new TypeError('messenger authorization, session factory, and inbound handler are required');
  }
  let running = false;
  let activeProvider = null;
  let stopController = null;
  let loopPromise = null;

  function supported(provider) {
    if (!AVAILABLE_PROVIDERS.includes(provider)) throw new Error(`unsupported messenger provider: ${provider}`);
  }

  async function providerFromStore(provider) {
    supported(provider);
    const credential = await credentialStore.get(provider);
    if (!credential?.token) throw new Error('messenger_not_connected');
    return {
      credential,
      provider: providerFactory({ provider, token: credential.token }),
    };
  }

  async function sessionFor(message) {
    const scopedChatId = conversationId(message);
    const existing = await stateStore.session(message.provider, scopedChatId);
    if (existing) return existing;
    const created = await createSession({
      origin: { provider: message.provider, chatId: scopedChatId },
    });
    const id = typeof created === 'string' ? created : created?.id;
    if (!id) throw new Error('messenger_session_creation_failed');
    return stateStore.bind(message.provider, scopedChatId, id);
  }

  async function pollOnce({ provider = 'telegram', signal } = {}) {
    const active = activeProvider?.id === provider;
    const runtime = active ? activeProvider : (await providerFromStore(provider)).provider;
    if (!active) await runtime.validate({ signal });
    const offset = await stateStore.offset(provider);
    const updates = await runtime.poll({ offset, signal });
    let received = 0;
    let accepted = 0;
    let replied = 0;
    let nextOffset = offset;
    for (const update of updates) {
      nextOffset = Math.max(nextOffset, Number(update.updateId ?? 0) + 1);
      if (update.message) {
        received += 1;
        try {
          if (!await authorizeInbound(structuredClone(update.message))) {
            log('messenger_inbound_rejected', { provider });
            await stateStore.saveOffset(provider, nextOffset);
            continue;
          }
          accepted += 1;
          const sessionId = await sessionFor(update.message);
          const typing = runtime.startTyping?.({
            chatId: update.message.chatId, threadId: update.message.threadId,
          }) ?? { stop() {} };
          try {
            const reply = await onInbound({ ...update.message, sessionId });
            const text = typeof reply === 'string' ? reply : reply?.text;
            if (String(text ?? '').trim()) {
              await runtime.sendReply({
                chatId: update.message.chatId, threadId: update.message.threadId,
                text, signal,
              });
              replied += 1;
            }
          } finally {
            typing.stop();
          }
        } catch (error) {
          log('messenger_inbound_failed', { provider, code: error?.code ?? error?.message ?? 'unknown' });
        }
      }
      await stateStore.saveOffset(provider, nextOffset);
    }
    return { received, accepted, replied, offset: nextOffset };
  }

  return {
    async connect({ provider, token } = {}) {
      supported(provider);
      if (!String(token ?? '').trim()) throw new TypeError('messenger token is required');
      const runtime = providerFactory({ provider, token: String(token) });
      const bot = await runtime.validate();
      await credentialStore.setVerified(provider, { token: String(token), bot });
      return {
        provider, connected: true, bot, inboundMode: runtime.inboundMode,
        webhook: { active: false, reason: 'local_runtime_uses_long_polling' },
      };
    },

    pollOnce,

    async start({ provider = 'telegram' } = {}) {
      supported(provider);
      if (running) return { started: true, reason: 'already_running', provider };
      const loaded = await providerFromStore(provider);
      await loaded.provider.validate();
      activeProvider = loaded.provider;
      stopController = new AbortController();
      running = true;
      loopPromise = (async () => {
        while (running) {
          try {
            await pollOnce({ provider, signal: stopController.signal });
          } catch (error) {
            if (!running || stopController.signal.aborted || error?.code === 'telegram_poll_stopped') break;
            log('messenger_poll_failed', { provider, code: error?.code ?? 'unknown' });
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, retryDelayMs);
              timer.unref?.();
            });
          }
        }
      })().finally(() => {
        running = false;
        activeProvider = null;
      });
      return { started: true, provider, inboundMode: activeProvider.inboundMode };
    },

    async stop() {
      running = false;
      stopController?.abort();
      await loopPromise?.catch(() => {});
      stopController = null;
      loopPromise = null;
      activeProvider = null;
      return { stopped: true };
    },

    async disconnect(provider = 'telegram') {
      supported(provider);
      await this.stop();
      await credentialStore.clear(provider);
      return { provider, connected: false };
    },

    async status() {
      return {
        availableProviders: [...AVAILABLE_PROVIDERS],
        running,
        activeProvider: running ? activeProvider?.id ?? null : null,
        inboundReality: {
          telegram: { mode: 'long_polling', webhook: { active: false, reason: 'local_runtime_uses_long_polling' } },
        },
        connections: await credentialStore.describe(),
      };
    },
  };
}
