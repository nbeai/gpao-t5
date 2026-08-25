function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

function clone(value) { return value == null ? value : structuredClone(value); }

export class ConnectionCredentialCoordinator {
  constructor({ stateStore, secretStore, makeId } = {}) {
    if (!stateStore?.readCredential || !stateStore?.commitCredential || !stateStore?.clearCredential) {
      throw new TypeError('connection state store is required');
    }
    if (!secretStore?.get || !secretStore?.set || !secretStore?.clear) {
      throw new TypeError('connection secret store is required');
    }
    if (typeof makeId !== 'function') throw new TypeError('credential id factory is required');
    this.stateStore = stateStore; this.secretStore = secretStore; this.makeId = makeId;
  }

  secretRef(connectionKey, generation) {
    return `conn-${connectionKey.slice(0, 32)}-g${generation}`.toLowerCase();
  }

  async read(connectionKey) {
    const state = this.stateStore.readCredential(connectionKey);
    if (state.state !== 'ready' || !state.secretRef) return null;
    const bundle = await this.secretStore.get(state.secretRef);
    if (!bundle || bundle.schema !== 't5.connection-credential.v1'
      || bundle.generation !== state.generation || bundle.connectionKey !== connectionKey) {
      throw new Error('connection credential bundle is unavailable or stale');
    }
    return { state, credential: clone(bundle.credential) };
  }

  async drainCleanup(connectionKey) {
    if (!this.stateStore.listSecretCleanup || !this.stateStore.completeSecretCleanup) return { pending: 0 };
    for (const item of this.stateStore.listSecretCleanup(connectionKey)) {
      try { await this.secretStore.clear(item.secretRef); this.stateStore.completeSecretCleanup(connectionKey, item.secretRef); }
      catch { /* durable queue remains authoritative for the next boundary */ }
    }
    return { pending: this.stateStore.listSecretCleanup(connectionKey).length };
  }

  async commit({ connectionKey, expectedGeneration, credential, issuer, identity, scopes,
    capabilities, lease, attemptId = null, additionalCleanupRefs = [] } = {}) {
    if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
      throw new TypeError('connection credential is required');
    }
    const previous = this.stateStore.readCredential(connectionKey);
    if (previous.generation !== expectedGeneration) throw new Error('credential generation is stale');
    const generation = expectedGeneration + 1; const secretRef = this.secretRef(connectionKey, generation);
    this.stateStore.prepareCredentialSecret({ connectionKey, expectedGeneration, secretRef, lease });
    try {
      await this.secretStore.set(secretRef, { schema: 't5.connection-credential.v1', connectionKey,
        generation, credential: clone(credential) });
    } catch (error) {
      try { this.stateStore.cancelCredentialPrepare({ connectionKey, secretRef,
        reason: 'credential_secret_write_failed', lease }); } catch { /* restart reconciliation owns the prepare */ }
      await this.drainCleanup(connectionKey); throw error;
    }
    let state;
    try {
      state = this.stateStore.commitCredential({ connectionKey, expectedGeneration, secretRef,
        issuer, identity, scopes, capabilities, lease, attemptId, additionalCleanupRefs });
    } catch (error) {
      if (this.stateStore.cancelCredentialPrepare) {
        try { this.stateStore.cancelCredentialPrepare({ connectionKey, secretRef,
          reason: 'credential_commit_failed', lease }); } catch { /* restart reconciliation owns the prepare */ }
        await this.drainCleanup(connectionKey);
      } else await this.secretStore.clear(secretRef).catch(() => {});
      throw error;
    }
    const cleanupPending = (await this.drainCleanup(connectionKey)).pending > 0;
    return { state, cleanupPending };
  }

  async clear({ connectionKey, expectedGeneration, lease } = {}) {
    const previous = this.stateStore.readCredential(connectionKey);
    const state = this.stateStore.clearCredential({ connectionKey, expectedGeneration, lease });
    const cleanupPending = (await this.drainCleanup(connectionKey)).pending > 0;
    return { state, cleanupPending };
  }
}
