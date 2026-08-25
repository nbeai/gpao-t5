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
    const suffix = required(this.makeId(), 'credential id').replace(/[^a-zA-Z0-9]/gu, '').slice(0, 12);
    if (!suffix) throw new TypeError('credential id is invalid');
    return `conn-${connectionKey.slice(0, 12)}-g${generation}-${suffix}`.toLowerCase();
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

  async commit({ connectionKey, expectedGeneration, credential, issuer, identity, scopes,
    capabilities, lease, attemptId = null } = {}) {
    if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
      throw new TypeError('connection credential is required');
    }
    const previous = this.stateStore.readCredential(connectionKey);
    if (previous.generation !== expectedGeneration) throw new Error('credential generation is stale');
    const generation = expectedGeneration + 1; const secretRef = this.secretRef(connectionKey, generation);
    await this.secretStore.set(secretRef, { schema: 't5.connection-credential.v1', connectionKey,
      generation, credential: clone(credential) });
    let state;
    try {
      state = this.stateStore.commitCredential({ connectionKey, expectedGeneration, secretRef,
        issuer, identity, scopes, capabilities, lease, attemptId });
    } catch (error) {
      await this.secretStore.clear(secretRef).catch(() => {}); throw error;
    }
    let cleanupPending = false;
    if (previous.secretRef && previous.secretRef !== secretRef) {
      await this.secretStore.clear(previous.secretRef).catch(() => { cleanupPending = true; });
    }
    return { state, cleanupPending };
  }

  async clear({ connectionKey, expectedGeneration, lease } = {}) {
    const previous = this.stateStore.readCredential(connectionKey);
    const state = this.stateStore.clearCredential({ connectionKey, expectedGeneration, lease });
    let cleanupPending = false;
    if (previous.secretRef) {
      await this.secretStore.clear(previous.secretRef).catch(() => { cleanupPending = true; });
    }
    return { state, cleanupPending };
  }
}
