function clone(value) { return value == null ? value : structuredClone(value); }

const secretName = (provider) => `messenger-${String(provider ?? '')}`;

/**
 * Messenger credential owner backed by the platform secret adapter.
 *
 * The returned token is an internal provider capability. Callers must never
 * project the result of get() into Conversation, Run, logs, receipts, or a
 * Terminal environment. Public state is derived by describe() only.
 */
export class MessengerPlatformCredentialStore {
  constructor(secretStore, { providers = ['telegram'] } = {}) {
    if (!secretStore?.get || !secretStore?.set || !secretStore?.clear) {
      throw new TypeError('messenger platform secret store is required');
    }
    this.secretStore = secretStore;
    this.providers = [...new Set(providers.map((provider) => String(provider)))];
  }

  async get(provider) {
    const value = await this.secretStore.get(secretName(provider));
    return value ? clone(value) : null;
  }

  async setVerified(provider, { token, bot, verifiedAt = Date.now() } = {}) {
    if (!token || typeof token !== 'string') throw new TypeError('verified messenger token is required');
    await this.secretStore.set(secretName(provider), {
      version: 1,
      token,
      bot: { id: String(bot?.id ?? ''), username: String(bot?.username ?? '') },
      verifiedAt,
    });
    return true;
  }

  async clear(provider) {
    await this.secretStore.clear(secretName(provider));
    return true;
  }

  async describe() {
    const entries = await Promise.all(this.providers.map(async (provider) => {
      const entry = await this.get(provider);
      return [provider, {
        connected: Boolean(entry?.token),
        bot: entry?.bot ? clone(entry.bot) : null,
        verifiedAt: entry?.verifiedAt ?? null,
      }];
    }));
    return Object.fromEntries(entries);
  }
}

export async function migrateMessengerCredentials({ source, target, providers = ['telegram'] } = {}) {
  if (!source?.get || !source?.clear || !target?.setVerified || !target?.get) {
    throw new TypeError('messenger credential migration stores are required');
  }
  const migrated = [];
  for (const provider of providers) {
    const legacy = await source.get(provider);
    if (!legacy?.token) continue;
    await target.setVerified(provider, legacy);
    const verified = await target.get(provider);
    if (verified?.token !== legacy.token || verified?.bot?.id !== legacy.bot?.id) {
      throw new Error('messenger platform credential verification failed');
    }
    await source.clear(provider);
    migrated.push(String(provider));
  }
  return { migrated };
}
