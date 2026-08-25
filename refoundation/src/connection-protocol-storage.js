import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { connectionStateKey } from './connection-state-store.js';

export function makeConnectionProtocolStorage({
  id, serverUrl, oauthClientId, stateStore, credentialCoordinator, secretStore,
  t5UserId = 'local-owner', connectionSlotId = id, makeId = randomUUID,
  leaseMs = 30_000, leaseWaitMs = 30_000, now = Date.now,
} = {}) {
  if (!stateStore?.acquireLease || !credentialCoordinator?.read || !secretStore?.set) {
    throw new TypeError('durable connection protocol stores are required');
  }
  const connectionKey = connectionStateKey({
    t5UserId, connectionSlotId, service: id, endpoint: serverUrl,
    oauthClientId: oauthClientId || `dynamic-registration:${id}`,
  });

  async function withLease(work) {
    const ownerId = makeId(); const deadline = now() + leaseWaitMs;
    let lease = null;
    while (!lease) {
      lease = stateStore.acquireLease({ connectionKey, ownerId, leaseMs });
      if (lease) break;
      if (now() >= deadline) throw Object.assign(new Error('connection credential is busy'), { reason: 'connection_busy' });
      await delay(25);
    }
    const controller = new AbortController(); let leaseFailure = null;
    const heartbeat = setInterval(() => {
      try { lease = stateStore.heartbeatLease(lease, leaseMs); }
      catch (error) { leaseFailure = error; controller.abort(error); }
    }, Math.max(25, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();
    try {
      const result = await work({ lease, signal: controller.signal, assertLease() {
        if (leaseFailure) throw leaseFailure;
        stateStore.assertLease(lease);
      } });
      if (leaseFailure) throw leaseFailure;
      stateStore.assertLease(lease);
      return result;
    } finally {
      clearInterval(heartbeat); stateStore.releaseLease(lease);
    }
  }

  return {
    connectionKey,
    state() { return stateStore.readCredential(connectionKey); },
    read() { return credentialCoordinator.read(connectionKey); },
    drainCleanup() { return credentialCoordinator.drainCleanup(connectionKey); },
    async reconcile() {
      return withLease(async ({ lease }) => {
        stateStore.reconcileCredentialPrepares({ connectionKey, lease });
        stateStore.reconcileExpiredOAuthAttempts({ connectionKey, lease });
        return credentialCoordinator.drainCleanup(connectionKey);
      });
    },
    withLease,
    async migrateLegacy(secretName, classify) {
      return withLease(async ({ lease }) => {
        const current = stateStore.readCredential(connectionKey);
        if (current.generation !== 0) return credentialCoordinator.read(connectionKey);
        const legacy = await secretStore.get(secretName);
        const migration = typeof classify === 'function' ? classify(legacy) : null;
        if (!migration) return null;
        await credentialCoordinator.commit({ connectionKey, expectedGeneration: 0,
          credential: migration.credential, issuer: migration.issuer, identity: migration.identity,
          scopes: migration.scopes, capabilities: migration.capabilities, lease,
          additionalCleanupRefs: [secretName] });
        return credentialCoordinator.read(connectionKey);
      });
    },
    async beginAttempt({ state, redirectUri, requestedScopes, payload, ttlMs } = {}) {
      const suffix = String(makeId()).replace(/[^a-zA-Z0-9]/gu, '').slice(0, 12).toLowerCase();
      if (!suffix) throw new TypeError('OAuth attempt identity is invalid');
      const secretRef = `oauth-${connectionKey.slice(0, 12)}-${suffix}`;
      let started;
      try {
        await withLease(async () => {
          started = stateStore.beginOAuthAttempt({ connectionKey, state, secretRef, redirectUri, requestedScopes, ttlMs });
          await secretStore.set(secretRef, { schema: 't5.oauth-attempt.v1', connectionKey, payload });
          await credentialCoordinator.drainCleanup(connectionKey);
        });
        return started;
      } catch (error) {
        if (started) stateStore.settleOAuthAttempt(started.attemptId, 'failed', 'oauth_attempt_start_failed');
        else stateStore.scheduleSecretCleanup(connectionKey, [secretRef], 'oauth_attempt_start_failed');
        await credentialCoordinator.drainCleanup(connectionKey); throw error;
      }
    },
    claimAttempt(state) { return stateStore.claimOAuthAttempt(state); },
    async runClaimedAttempt(state, work) {
      return withLease(async ({ lease, signal, assertLease }) => {
        const claimed = stateStore.claimOAuthAttempt(state);
        if (!claimed) throw new Error('OAuth attempt is stale');
        const payload = await this.attemptPayload(claimed);
        try {
          return await work({ attempt: claimed, payload, lease, signal, assertLease });
        } catch (error) {
          stateStore.settleOAuthAttempt(claimed.attemptId, 'failed', error?.reason ?? 'verification_failed');
          await credentialCoordinator.drainCleanup(connectionKey); throw error;
        }
      });
    },
    async attemptPayload(attempt) {
      const stored = await secretStore.get(attempt?.secretRef);
      if (stored?.schema !== 't5.oauth-attempt.v1' || stored.connectionKey !== connectionKey) {
        throw new Error('OAuth attempt secret is unavailable');
      }
      return structuredClone(stored.payload);
    },
    async failAttempt(attempt, reason) {
      stateStore.settleOAuthAttempt(attempt.attemptId, 'failed', reason);
      await credentialCoordinator.drainCleanup(connectionKey);
    },
    async cancelAttempt(attempt, reason = 'cancelled') {
      stateStore.settleOAuthAttempt(attempt.attemptId, 'cancelled', reason);
      await credentialCoordinator.drainCleanup(connectionKey);
    },
    async commit({ credential, issuer, identity, scopes, capabilities, attemptId = null } = {}) {
      return withLease(async ({ lease, assertLease }) => {
        const current = stateStore.readCredential(connectionKey);
        assertLease();
        return credentialCoordinator.commit({ connectionKey, expectedGeneration: current.generation,
          credential, issuer, identity, scopes, capabilities, lease, attemptId });
      });
    },
    commitWithLease({ lease, expectedGeneration, credential, issuer, identity, scopes,
      capabilities, attemptId = null } = {}) {
      return credentialCoordinator.commit({ connectionKey, expectedGeneration, credential,
        issuer, identity, scopes, capabilities, lease, attemptId });
    },
    markWithLease({ lease, expectedGeneration, state, requiredScopes = [] } = {}) {
      return stateStore.setCredentialState({ connectionKey, expectedGeneration, state, requiredScopes, lease });
    },
    async mark(state) {
      return withLease(async ({ lease }) => {
        const current = stateStore.readCredential(connectionKey);
        return stateStore.setCredentialState({ connectionKey, expectedGeneration: current.generation, state, lease });
      });
    },
    async markIfCurrent(state, expectedGeneration, requiredScopes = []) {
      return withLease(async ({ lease }) => {
        const current = stateStore.readCredential(connectionKey);
        if (current.generation !== expectedGeneration) return { changed: false, state: current };
        return { changed: true, state: stateStore.setCredentialState({ connectionKey,
          expectedGeneration, state, requiredScopes, lease }) };
      });
    },
    async clear() {
      return withLease(async ({ lease }) => {
        const current = stateStore.readCredential(connectionKey);
        return credentialCoordinator.clear({ connectionKey, expectedGeneration: current.generation, lease });
      });
    },
  };
}
