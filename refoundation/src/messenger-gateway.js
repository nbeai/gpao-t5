import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeTelegramMessengerProvider } from './telegram-messenger-provider.js';

const AVAILABLE_PROVIDERS = Object.freeze(['telegram']);
const bindingKey = (provider, chatId) => `${provider}:${chatId}`;
const ingressKey = (provider, updateId) => `${provider}:${Number(updateId)}`;
const INGRESS_TERMINAL = new Set(['completed', 'rejected', 'adopted_unknown']);
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
      state.ingress ??= {};
      return state;
    } catch (error) {
      if (error?.code === 'ENOENT') return {
        version: 1, offsets: {}, bindings: {}, allowed: {}, pending: {}, ingress: {},
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

  async ingress(provider, updateId) {
    return structuredClone((await this.read()).ingress[ingressKey(provider, updateId)] ?? null);
  }

  async receiveIngress(provider, updateId, message = {}) {
    return this.serialize(async () => {
      const state = await this.read();
      const key = ingressKey(provider, updateId);
      if (!state.ingress[key]) {
        state.ingress[key] = {
          provider, updateId: Number(updateId), state: 'received', attempts: 0,
          receivedAt: Date.now(),
          messageId: message.messageId == null ? null : String(message.messageId),
          chatId: String(message.chatId ?? ''),
          threadId: message.threadId == null ? null : String(message.threadId),
          userId: String(message.userId ?? ''), username: message.username ? String(message.username) : null,
          text: String(message.text ?? '').slice(0, 64_000),
          isDirectMessage: message.isDirectMessage === true, isMention: message.isMention === true,
        };
      }
      await this.write(state);
      return structuredClone(state.ingress[key]);
    });
  }

  async markIngress(provider, updateId, nextState, payload = {}) {
    if (!['received', 'adopted', 'completed', 'rejected', 'adopted_unknown'].includes(nextState)) {
      throw new TypeError('invalid messenger ingress state');
    }
    return this.serialize(async () => {
      const state = await this.read();
      const key = ingressKey(provider, updateId);
      const current = state.ingress[key];
      if (!current) throw new Error('messenger ingress record not found');
      const terminal = INGRESS_TERMINAL.has(current.state);
      if (terminal && current.state !== nextState) return structuredClone(current);
      state.ingress[key] = {
        ...current, ...structuredClone(payload), state: nextState, updatedAt: Date.now(),
      };
      if (INGRESS_TERMINAL.has(nextState)) delete state.ingress[key].text;
      const keys = Object.keys(state.ingress).sort((left, right) => (
        Number(state.ingress[left]?.updatedAt ?? state.ingress[left]?.receivedAt ?? 0)
        - Number(state.ingress[right]?.updatedAt ?? state.ingress[right]?.receivedAt ?? 0)
      ));
      for (const stale of keys.slice(0, Math.max(0, keys.length - 500))) {
        if (INGRESS_TERMINAL.has(state.ingress[stale]?.state)) delete state.ingress[stale];
      }
      await this.write(state);
      return structuredClone(state.ingress[key]);
    });
  }

  async noteIngressFailure(provider, updateId, code) {
    return this.serialize(async () => {
      const state = await this.read();
      const key = ingressKey(provider, updateId);
      const current = state.ingress[key];
      if (!current) throw new Error('messenger ingress record not found');
      current.attempts = Number(current.attempts ?? 0) + 1;
      current.lastError = String(code ?? 'unknown').slice(0, 160);
      current.updatedAt = Date.now();
      await this.write(state);
      return structuredClone(current);
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

  async claimFirstOwner(provider, message = {}) {
    const id = numericUserId(message.userId);
    if (!id || message.isDirectMessage !== true) return { allowed: false, claimed: false };
    return this.serialize(async () => {
      const state = await this.read();
      state.allowed[provider] ??= [];
      const existing = state.allowed[provider].find((entry) => entry.userId === id);
      if (existing) return { allowed: true, claimed: false, owner: structuredClone(existing) };
      if (state.allowed[provider].length > 0) return { allowed: false, claimed: false };
      const username = String(message.username ?? '').replace(/^@/, '') || null;
      const owner = {
        userId: id, username, label: '내 계정', allowedAt: Date.now(),
        source: 'first_private_message',
      };
      state.allowed[provider].push(owner);
      state.pending[provider] = [];
      await this.write(state);
      return { allowed: true, claimed: true, owner: structuredClone(owner) };
    });
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

  async resetProvider(provider) {
    return this.serialize(async () => {
      const state = await this.read();
      delete state.offsets[provider];
      delete state.allowed[provider];
      delete state.pending[provider];
      state.ingress = Object.fromEntries(Object.entries(state.ingress)
        .filter(([, entry]) => entry.provider !== provider));
      state.bindings = Object.fromEntries(Object.entries(state.bindings)
        .filter(([key]) => !key.startsWith(`${provider}:`)));
      await this.write(state);
      return true;
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
  attachmentStore = null,
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
  let lastError = null;

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
      const updateId = Number(update.updateId ?? 0);
      const acknowledgedOffset = Math.max(nextOffset, updateId + 1);
      if (!update.message) {
        nextOffset = await stateStore.saveOffset(provider, acknowledgedOffset);
        continue;
      }
      received += 1;
      const ingress = await stateStore.receiveIngress(provider, updateId, update.message);
      if (INGRESS_TERMINAL.has(ingress.state)) {
        nextOffset = await stateStore.saveOffset(provider, acknowledgedOffset);
        continue;
      }
      // A process can crash after marking adoption but before recording the final result. Re-running the
      // user's turn could repeat an external effect, so close it as unknown and let conversation recovery
      // expose the truth instead of replaying the message.
      if (ingress.state === 'adopted') {
        await stateStore.markIngress(provider, updateId, 'adopted_unknown', {
          sessionId: ingress.sessionId ?? null, reason: 'runtime_restarted_after_adoption',
        });
        nextOffset = await stateStore.saveOffset(provider, acknowledgedOffset);
        continue;
      }

      let adopted = false;
      let sessionId = null;
      let progress = null;
      let ownedDelivery = null;
      let typing = { stop() {} };
      try {
        if (!await authorizeInbound(structuredClone(update.message))) {
          await stateStore.markIngress(provider, updateId, 'rejected', { reason: 'sender_not_allowed' });
          log('messenger_inbound_rejected', { provider });
          nextOffset = await stateStore.saveOffset(provider, acknowledgedOffset);
          continue;
        }
        accepted += 1;
        sessionId = await sessionFor(update.message);
        const attachmentIds = [];
        const attachmentIssues = [];
        for (const descriptor of update.message.attachments ?? []) {
          try {
            if (!attachmentStore || typeof runtime.downloadAttachment !== 'function') {
              throw Object.assign(new Error('messenger attachment hand is unavailable'), {
                code: 'messenger_attachment_unavailable',
              });
            }
            const downloaded = await runtime.downloadAttachment({
              ...descriptor, mediaGroupId: update.message.mediaGroupId,
            }, { signal });
            const stored = await attachmentStore.receiveStream({
              sessionId, originalName: downloaded.originalName,
              declaredMime: downloaded.declaredMime, stream: downloaded.stream,
              providerIdentity: downloaded.providerIdentity,
            });
            attachmentIds.push(stored.attachmentId);
          } catch (error) {
            attachmentIssues.push({
              originalName: String(descriptor.originalName ?? 'attachment').slice(0, 180),
              state: error?.code === 'telegram_attachment_too_large' ? 'too_large' : 'unavailable',
              reason: String(error?.code ?? 'messenger_attachment_failed').slice(0, 120),
            });
          }
        }
        await stateStore.markIngress(provider, updateId, 'adopted', {
          sessionId, adoptedAt: Date.now(), attachmentIds, attachmentIssues,
        });
        adopted = true;
        typing = runtime.startTyping?.({
          chatId: update.message.chatId, threadId: update.message.threadId,
        }) ?? typing;
        progress = runtime.createProgress?.({
          chatId: update.message.chatId, threadId: update.message.threadId,
        }) ?? null;
        const deliver = async ({ text, artifactIds = [] } = {}) => {
          if (ownedDelivery) return structuredClone(ownedDelivery);
          const messageIds = []; const files = [];
          if (String(text ?? '').trim()) {
            const textDelivery = progress ? await progress.finalize(text, { signal })
              : await runtime.sendReply({
                chatId: update.message.chatId, threadId: update.message.threadId, text, signal,
              });
            messageIds.push(...(textDelivery?.messageIds ?? []));
          }
          for (const attachmentId of artifactIds) {
            if (!attachmentStore || typeof runtime.sendDocument !== 'function') {
              throw Object.assign(new Error('messenger artifact delivery unavailable'), {
                code: 'messenger_artifact_delivery_unavailable',
              });
            }
            const artifact = await attachmentStore.readContent({ sessionId, attachmentId });
            const sent = await runtime.sendDocument({
              chatId: update.message.chatId, threadId: update.message.threadId,
              artifact, signal,
            });
            if (sent.messageId) messageIds.push(sent.messageId);
            files.push(sent);
          }
          ownedDelivery = { sent: true, provider, chatId: update.message.chatId, messageIds, files };
          return structuredClone(ownedDelivery);
        };
        const reply = await onInbound({
          ...update.message, sessionId, attachmentIds, attachmentIssues,
        }, {
          progress: (text) => progress?.update(text), deliver,
        });
        const text = typeof reply === 'string' ? reply : reply?.text;
        let delivery = ownedDelivery ?? reply?.delivery ?? null;
        if (!delivery && String(text ?? '').trim()) delivery = await deliver({ text });
        if (delivery?.sent) {
          replied += 1;
        }
        await stateStore.markIngress(provider, updateId, 'completed', {
          sessionId, completedAt: Date.now(),
          messageIds: structuredClone(delivery?.messageIds ?? []),
          files: structuredClone(delivery?.files ?? []),
        });
        nextOffset = await stateStore.saveOffset(provider, acknowledgedOffset);
      } catch (error) {
        const code = error?.code ?? error?.message ?? 'unknown';
        log('messenger_inbound_failed', { provider, code });
        if (adopted) {
          const failure = error?.surfaceResult;
          if (failure?.channelDelivery?.sent === true
            && (failure.channelDelivery.messageIds ?? []).length > 0) {
            replied += 1;
            await stateStore.markIngress(provider, updateId, 'completed', {
              sessionId, completedAt: Date.now(), failedTurn: true,
              messageIds: structuredClone(failure.channelDelivery.messageIds),
              files: structuredClone(failure.channelDelivery.files ?? []),
            });
            nextOffset = await stateStore.saveOffset(provider, acknowledgedOffset);
            continue;
          }
          const failureText = failure?.reply
            ? `${failure.reply}${failure.nextSafeAction ? `\n\n${failure.nextSafeAction}` : ''}`
            : undefined;
          await progress?.fail(failureText).catch(() => {});
          await stateStore.markIngress(provider, updateId, 'adopted_unknown', {
            sessionId, reason: String(code).slice(0, 160), failedAt: Date.now(),
          });
          nextOffset = await stateStore.saveOffset(provider, acknowledgedOffset);
          continue;
        }
        const failed = await stateStore.noteIngressFailure(provider, updateId, code);
        throw Object.assign(new Error('messenger inbound failed before adoption'), {
          code: failed.attempts >= 3
            ? 'messenger_inbound_needs_attention' : 'messenger_inbound_pre_adoption_failed',
          cause: error,
        });
      } finally {
        typing.stop();
      }
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
      lastError = null;
      return {
        provider, connected: true, bot, inboundMode: runtime.inboundMode,
        webhook: { active: false, reason: 'local_runtime_uses_long_polling' },
      };
    },

    pollOnce,

    async sendToSession({ sessionId, text, signal } = {}) {
      if (!sessionId || !String(text ?? '').trim()) throw new TypeError('messenger session and text are required');
      const binding = (await stateStore.listBindings()).find((entry) => entry.sessionId === String(sessionId));
      if (!binding) return { sent: false, reason: 'session_not_bound_to_messenger' };
      const loaded = activeProvider?.id === binding.provider
        ? { provider: activeProvider } : await providerFromStore(binding.provider);
      if (loaded.provider !== activeProvider) await loaded.provider.validate({ signal });
      const topic = binding.chatId.match(/^(.*):topic:([^:]+)$/u);
      const chatId = topic ? topic[1] : binding.chatId;
      const threadId = topic ? topic[2] : null;
      return loaded.provider.sendReply({ chatId, threadId, text: String(text), signal });
    },

    async resolveOwnerDelivery(provider = 'telegram') {
      supported(provider);
      const [allowed, bindings] = await Promise.all([
        stateStore.listAllowed(provider), stateStore.listBindings(),
      ]);
      if (allowed.length !== 1) return {
        ready: false, reason: allowed.length ? 'telegram_owner_ambiguous' : 'telegram_owner_missing',
      };
      const ownerId = allowed[0].userId;
      const providerBindings = bindings.filter((binding) => binding.provider === provider);
      const ownerMatches = providerBindings.filter((binding) => binding.chatId.split(':topic:')[0] === ownerId);
      const matches = ownerMatches.length ? ownerMatches : providerBindings.length === 1 ? providerBindings : [];
      if (matches.length !== 1) return {
        ready: false, reason: matches.length ? 'telegram_binding_ambiguous' : 'telegram_binding_missing',
      };
      try { await providerFromStore(provider); }
      catch { return { ready: false, reason: 'telegram_not_connected' }; }
      return { ready: true, provider, sessionId: matches[0].sessionId };
    },

    async start({ provider = 'telegram' } = {}) {
      supported(provider);
      if (running) return { started: true, reason: 'already_running', provider };
      const loaded = await providerFromStore(provider);
      await loaded.provider.validate();
      lastError = null;
      activeProvider = loaded.provider;
      stopController = new AbortController();
      running = true;
      loopPromise = (async () => {
        while (running) {
          try {
            await pollOnce({ provider, signal: stopController.signal });
          } catch (error) {
            if (!running || stopController.signal.aborted || error?.code === 'telegram_poll_stopped') break;
            lastError = {
              code: error?.code ?? 'unknown', at: Date.now(),
              needsAttention: error?.code === 'messenger_inbound_needs_attention',
            };
            log('messenger_poll_failed', { provider, code: error?.code ?? 'unknown' });
            if (lastError.needsAttention) break;
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
      await stateStore.resetProvider(provider);
      return { provider, connected: false };
    },

    async status() {
      return {
        availableProviders: [...AVAILABLE_PROVIDERS],
        running,
        activeProvider: running ? activeProvider?.id ?? null : null,
        lastError: lastError ? structuredClone(lastError) : null,
        inboundReality: {
          telegram: { mode: 'long_polling', webhook: { active: false, reason: 'local_runtime_uses_long_polling' } },
        },
        connections: await credentialStore.describe(),
      };
    },
  };
}
