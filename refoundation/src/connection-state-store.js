import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MAX_JSON_BYTES = 64 * 1024;
const ATTEMPT_STATUS = new Set(['pending', 'claimed', 'superseded', 'expired', 'cancelled', 'failed', 'completed']);
const CREDENTIAL_STATE = new Set(['ready', 'needs_reauth', 'needs_additional_permission', 'revoked', 'cleared']);
const CONNECTION_KEY = /^[0-9a-f]{64}$/u;

function required(value, label, max = 500) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new TypeError(`${label} is invalid`);
  return text;
}

function opaqueConnectionKey(value) {
  const key = required(value, 'connection key', 64);
  if (!CONNECTION_KEY.test(key)) throw new TypeError('connection key must be an opaque digest');
  return key;
}

export function connectionStateKey({ t5UserId, connectionSlotId, service, endpoint, oauthClientId } = {}) {
  const identity = {
    t5UserId: required(t5UserId, 'T5 user identity'),
    connectionSlotId: required(connectionSlotId, 'connection slot identity'),
    service: required(service, 'connection service'),
    endpoint: required(endpoint, 'connection endpoint', 2_000),
    oauthClientId: required(oauthClientId, 'OAuth client identity'),
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function scopes(value) {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError('OAuth scopes are invalid');
  const result = [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  if (result.some((item) => item.length > 200 || /\s/u.test(item))) throw new TypeError('OAuth scopes are invalid');
  return result;
}

function json(value, label) {
  const text = JSON.stringify(value ?? null);
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) throw new TypeError(`${label} is too large`);
  return text;
}

function parsed(value, fallback) {
  try { return value == null ? fallback : JSON.parse(value); } catch { throw new Error('connection state JSON is invalid'); }
}

function attempt(row) {
  if (!row) return null;
  if (!ATTEMPT_STATUS.has(row.status)) throw new Error('OAuth attempt state is invalid');
  return { attemptId: row.attempt_id, connectionKey: row.connection_key, state: row.oauth_state,
    secretRef: row.secret_ref, redirectUri: row.redirect_uri,
    requestedScopes: parsed(row.requested_scopes_json, []), status: row.status,
    baseGeneration: Number(row.base_generation ?? 0),
    createdAt: row.created_at, expiresAt: row.expires_at,
    supersededBy: row.superseded_by, claimedAt: row.claimed_at,
    terminalReason: row.terminal_reason };
}

function credential(row) {
  if (!row) return { generation: 0, state: 'cleared', secretRef: null, issuer: null,
    identity: null, scopes: [], pendingScopes: [], capabilities: {}, verifiedAt: null, updatedAt: null };
  if (!CREDENTIAL_STATE.has(row.state)) throw new Error('credential state is invalid');
  return { connectionKey: row.connection_key, generation: row.generation, state: row.state,
    secretRef: row.secret_ref, issuer: row.issuer,
    identity: parsed(row.identity_json, null), scopes: parsed(row.scopes_json, []),
    pendingScopes: parsed(row.pending_scopes_json, []),
    capabilities: parsed(row.capabilities_json, {}), verifiedAt: row.verified_at, updatedAt: row.updated_at };
}

export class ConnectionStateStore {
  constructor(file, { now = Date.now, makeId = randomUUID } = {}) {
    if (!file) throw new TypeError('connection state file is required');
    this.file = file; this.now = now; this.makeId = makeId;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); chmodSync(dirname(file), 0o700);
    this.database = new DatabaseSync(file);
    this.database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS connection_credentials (
        connection_key TEXT PRIMARY KEY,
        generation INTEGER NOT NULL,
        state TEXT NOT NULL,
        secret_ref TEXT,
        issuer TEXT,
        identity_json TEXT,
        scopes_json TEXT NOT NULL,
        pending_scopes_json TEXT NOT NULL DEFAULT '[]',
        capabilities_json TEXT NOT NULL,
        verified_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connection_leases (
        connection_key TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        fence_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_attempts (
        attempt_id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        oauth_state TEXT NOT NULL UNIQUE,
        secret_ref TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        requested_scopes_json TEXT NOT NULL,
        base_generation INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        superseded_by TEXT,
        claimed_at INTEGER,
        terminal_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS oauth_attempt_connection_status
        ON oauth_attempts(connection_key, status);
      CREATE TABLE IF NOT EXISTS connection_secret_cleanup (
        secret_ref TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS connection_secret_cleanup_key
        ON connection_secret_cleanup(connection_key, created_at);
      CREATE TABLE IF NOT EXISTS connection_credential_prepares (
        secret_ref TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        expected_generation INTEGER NOT NULL,
        candidate_generation INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS connection_credential_prepare_key
        ON connection_credential_prepares(connection_key, created_at);
    `);
    const attemptColumns = this.database.prepare('PRAGMA table_info(oauth_attempts)').all();
    if (!attemptColumns.some((column) => column.name === 'base_generation')) {
      this.database.exec('ALTER TABLE oauth_attempts ADD COLUMN base_generation INTEGER NOT NULL DEFAULT 0;');
    }
    const credentialColumns = this.database.prepare('PRAGMA table_info(connection_credentials)').all();
    if (!credentialColumns.some((column) => column.name === 'pending_scopes_json')) {
      this.database.exec("ALTER TABLE connection_credentials ADD COLUMN pending_scopes_json TEXT NOT NULL DEFAULT '[]';");
    }
    chmodSync(file, 0o600);
  }

  transaction(work) {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.database.exec('COMMIT'); return result; }
    catch (error) { try { this.database.exec('ROLLBACK'); } catch {} throw error; }
  }

  queueSecretCleanup(database, connectionKey, refs, reason) {
    const statement = database.prepare(`INSERT INTO connection_secret_cleanup
      (secret_ref,connection_key,reason,created_at) VALUES (?,?,?,?)
      ON CONFLICT(secret_ref) DO NOTHING`);
    for (const ref of new Set(refs.filter(Boolean).map(String))) statement.run(ref, connectionKey, reason, this.now());
  }

  beginOAuthAttempt({ connectionKey, state, secretRef, redirectUri, requestedScopes = [], ttlMs = 600_000 } = {}) {
    const key = opaqueConnectionKey(connectionKey); const oauthState = required(state, 'OAuth state');
    const reference = required(secretRef, 'OAuth attempt secret reference');
    const redirect = required(redirectUri, 'OAuth redirect URI', 2_000); const requested = scopes(requestedScopes);
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 60 * 60_000) throw new TypeError('OAuth attempt TTL is invalid');
    const attemptId = this.makeId(); const current = this.now();
    return this.transaction(() => {
      const currentCredential = this.readCredential(key);
      const supersededSecretRefs = this.database.prepare(`SELECT secret_ref FROM oauth_attempts
        WHERE connection_key=? AND status IN ('pending','claimed')`).all(key).map((row) => row.secret_ref);
      this.database.prepare(`UPDATE oauth_attempts SET status='superseded', superseded_by=?, terminal_reason='new_attempt'
        WHERE connection_key=? AND status IN ('pending','claimed')`).run(attemptId, key);
      this.database.prepare(`INSERT INTO oauth_attempts
        (attempt_id, connection_key, oauth_state, secret_ref, redirect_uri, requested_scopes_json,
         base_generation, status, created_at, expires_at, superseded_by, claimed_at, terminal_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL)`)
        .run(attemptId, key, oauthState, reference, redirect, json(requested, 'OAuth scopes'),
          currentCredential.generation, current, current + ttlMs);
      this.queueSecretCleanup(this.database, key, supersededSecretRefs, 'oauth_attempt_superseded');
      return { ...this.readOAuthAttempt(attemptId), supersededSecretRefs };
    });
  }

  readOAuthAttempt(attemptId) {
    return attempt(this.database.prepare('SELECT * FROM oauth_attempts WHERE attempt_id=?').get(String(attemptId)));
  }

  readOAuthAttemptByState(state) {
    return attempt(this.database.prepare('SELECT * FROM oauth_attempts WHERE oauth_state=?').get(String(state)));
  }

  claimOAuthAttempt(state) {
    const oauthState = required(state, 'OAuth state'); const current = this.now();
    return this.transaction(() => {
      const row = this.database.prepare('SELECT * FROM oauth_attempts WHERE oauth_state=?').get(oauthState);
      if (!row || row.status !== 'pending') return null;
      if (row.expires_at < current) {
        this.database.prepare("UPDATE oauth_attempts SET status='expired', terminal_reason='ttl_expired' WHERE attempt_id=? AND status='pending'")
          .run(row.attempt_id); return null;
      }
      const updated = this.database.prepare("UPDATE oauth_attempts SET status='claimed', claimed_at=? WHERE attempt_id=? AND status='pending'")
        .run(current, row.attempt_id);
      return updated.changes === 1 ? this.readOAuthAttempt(row.attempt_id) : null;
    });
  }

  settleOAuthAttempt(attemptId, status, reason = null) {
    if (!['cancelled', 'failed'].includes(status)) throw new TypeError('OAuth terminal status is invalid');
    const id = required(attemptId, 'OAuth attempt id');
    return this.transaction(() => {
      const current = this.database.prepare('SELECT * FROM oauth_attempts WHERE attempt_id=?').get(id);
      const result = this.database.prepare(`UPDATE oauth_attempts SET status=?, terminal_reason=?
        WHERE attempt_id=? AND status IN ('pending','claimed')`).run(status, reason == null ? null : String(reason).slice(0, 200), id);
      if (result.changes === 1 && current?.secret_ref) {
        this.queueSecretCleanup(this.database, current.connection_key, [current.secret_ref], `oauth_attempt_${status}`);
      }
      return result.changes === 1 ? this.readOAuthAttempt(id) : null;
    });
  }

  acquireLease({ connectionKey, ownerId, leaseMs = 60_000 } = {}) {
    const key = opaqueConnectionKey(connectionKey); const owner = required(ownerId, 'lease owner');
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 10 * 60_000) throw new TypeError('connection lease is invalid');
    const current = this.now(); const fenceToken = this.makeId();
    return this.transaction(() => {
      const existing = this.database.prepare('SELECT * FROM connection_leases WHERE connection_key=?').get(key);
      if (existing && existing.expires_at >= current && existing.owner_id !== owner) return null;
      this.database.prepare(`INSERT INTO connection_leases(connection_key, owner_id, fence_token, expires_at, heartbeat_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(connection_key) DO UPDATE SET
        owner_id=excluded.owner_id, fence_token=excluded.fence_token,
        expires_at=excluded.expires_at, heartbeat_at=excluded.heartbeat_at`)
        .run(key, owner, fenceToken, current + leaseMs, current);
      return { connectionKey: key, ownerId: owner, fenceToken, expiresAt: current + leaseMs };
    });
  }

  assertLease(lease) {
    const row = this.database.prepare('SELECT * FROM connection_leases WHERE connection_key=?').get(lease?.connectionKey);
    if (!row || row.owner_id !== lease?.ownerId || row.fence_token !== lease?.fenceToken || row.expires_at < this.now()) {
      throw new Error('connection lease is stale');
    }
    return row;
  }

  heartbeatLease(lease, leaseMs = 60_000) {
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 10 * 60_000) throw new TypeError('connection lease is invalid');
    const current = this.now();
    return this.transaction(() => {
      this.assertLease(lease);
      const result = this.database.prepare(`UPDATE connection_leases SET heartbeat_at=?, expires_at=?
        WHERE connection_key=? AND owner_id=? AND fence_token=?`)
        .run(current, current + leaseMs, lease.connectionKey, lease.ownerId, lease.fenceToken);
      if (result.changes !== 1) throw new Error('connection lease is stale');
      return { ...lease, expiresAt: current + leaseMs };
    });
  }

  releaseLease(lease) {
    return this.database.prepare(`DELETE FROM connection_leases WHERE connection_key=? AND owner_id=? AND fence_token=?`)
      .run(lease?.connectionKey, lease?.ownerId, lease?.fenceToken).changes === 1;
  }

  readCredential(connectionKey) {
    return credential(this.database.prepare('SELECT * FROM connection_credentials WHERE connection_key=?')
      .get(opaqueConnectionKey(connectionKey)));
  }

  prepareCredentialSecret({ connectionKey, expectedGeneration, secretRef, lease } = {}) {
    const key = opaqueConnectionKey(connectionKey); const reference = required(secretRef, 'credential secret reference');
    if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) throw new TypeError('credential generation is invalid');
    return this.transaction(() => {
      this.assertLease(lease); const current = this.readCredential(key);
      if (current.generation !== expectedGeneration) throw new Error('credential generation is stale');
      this.database.prepare(`INSERT INTO connection_credential_prepares
        (secret_ref,connection_key,expected_generation,candidate_generation,created_at)
        VALUES (?,?,?,?,?) ON CONFLICT(secret_ref) DO UPDATE SET
        connection_key=excluded.connection_key,expected_generation=excluded.expected_generation,
        candidate_generation=excluded.candidate_generation,created_at=excluded.created_at`)
        .run(reference, key, expectedGeneration, expectedGeneration + 1, this.now());
      return { connectionKey: key, secretRef: reference, expectedGeneration, candidateGeneration: expectedGeneration + 1 };
    });
  }

  cancelCredentialPrepare({ connectionKey, secretRef, reason = 'credential_prepare_failed', lease } = {}) {
    const key = opaqueConnectionKey(connectionKey); const reference = required(secretRef, 'credential secret reference');
    return this.transaction(() => {
      this.assertLease(lease);
      this.database.prepare('DELETE FROM connection_credential_prepares WHERE connection_key=? AND secret_ref=?')
        .run(key, reference);
      this.queueSecretCleanup(this.database, key, [reference], reason);
    });
  }

  reconcileCredentialPrepares({ connectionKey, lease } = {}) {
    const key = opaqueConnectionKey(connectionKey);
    return this.transaction(() => {
      this.assertLease(lease); const current = this.readCredential(key);
      const rows = this.database.prepare('SELECT * FROM connection_credential_prepares WHERE connection_key=?').all(key);
      for (const row of rows) {
        if (current.secretRef !== row.secret_ref) {
          this.queueSecretCleanup(this.database, key, [row.secret_ref], 'credential_prepare_recovered');
        }
        this.database.prepare('DELETE FROM connection_credential_prepares WHERE secret_ref=?').run(row.secret_ref);
      }
      return rows.length;
    });
  }

  reconcileExpiredOAuthAttempts({ connectionKey, lease } = {}) {
    const key = opaqueConnectionKey(connectionKey);
    return this.transaction(() => {
      this.assertLease(lease); const current = this.now();
      const rows = this.database.prepare(`SELECT attempt_id,secret_ref FROM oauth_attempts
        WHERE connection_key=? AND status IN ('pending','claimed') AND expires_at<?`).all(key, current);
      this.database.prepare(`UPDATE oauth_attempts SET status='expired', terminal_reason='ttl_expired'
        WHERE connection_key=? AND status IN ('pending','claimed') AND expires_at<?`).run(key, current);
      this.queueSecretCleanup(this.database, key, rows.map((row) => row.secret_ref), 'oauth_attempt_expired');
      return rows.length;
    });
  }

  setCredentialState({ connectionKey, expectedGeneration, state, requiredScopes = [], lease } = {}) {
    const key = opaqueConnectionKey(connectionKey);
    if (!['needs_reauth', 'needs_additional_permission', 'revoked'].includes(state)) throw new TypeError('credential state transition is invalid');
    if (!Number.isInteger(expectedGeneration) || expectedGeneration < 1) throw new TypeError('credential generation is invalid');
    return this.transaction(() => {
      this.assertLease(lease); const current = this.readCredential(key);
      if (current.generation !== expectedGeneration || !current.secretRef) throw new Error('credential generation is stale');
      const timestamp = this.now(); const pending = state === 'needs_additional_permission'
        ? scopes([...current.pendingScopes, ...requiredScopes]) : current.pendingScopes;
      const updated = this.database.prepare(`UPDATE connection_credentials SET state=?, pending_scopes_json=?, updated_at=?
        WHERE connection_key=? AND generation=? AND secret_ref=?`)
        .run(state, json(pending, 'pending credential scopes'), timestamp, key, expectedGeneration, current.secretRef);
      if (updated.changes !== 1) throw new Error('credential generation is stale');
      return this.readCredential(key);
    });
  }

  commitCredential({ connectionKey, expectedGeneration, secretRef, issuer, identity, scopes: grantedScopes = [],
    capabilities = {}, lease, attemptId = null, verifiedAt = this.now(), additionalCleanupRefs = [] } = {}) {
    const key = opaqueConnectionKey(connectionKey); const reference = required(secretRef, 'credential secret reference');
    const issuedBy = required(issuer, 'credential issuer', 2_000); const granted = scopes(grantedScopes);
    if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) throw new TypeError('credential generation is invalid');
    const identityJson = json(identity, 'credential identity'); const capabilityJson = json(capabilities, 'credential capabilities');
    return this.transaction(() => {
      this.assertLease(lease); const current = this.readCredential(key);
      if (current.generation !== expectedGeneration) throw new Error('credential generation is stale');
      const prepared = this.database.prepare(`SELECT * FROM connection_credential_prepares
        WHERE connection_key=? AND secret_ref=? AND expected_generation=? AND candidate_generation=?`)
        .get(key, reference, expectedGeneration, expectedGeneration + 1);
      if (!prepared) throw new Error('credential secret was not durably prepared');
      const authorizationAttempt = attemptId == null ? null
        : this.database.prepare('SELECT * FROM oauth_attempts WHERE attempt_id=?').get(String(attemptId));
      if (attemptId != null && (!authorizationAttempt || authorizationAttempt.connection_key !== key
        || authorizationAttempt.status !== 'claimed' || authorizationAttempt.expires_at < this.now()
        || Number(authorizationAttempt.base_generation ?? 0) !== expectedGeneration)) {
        throw new Error('OAuth attempt is stale');
      }
      const generation = expectedGeneration + 1; const timestamp = this.now();
      this.database.prepare(`INSERT INTO connection_credentials
        (connection_key,generation,state,secret_ref,issuer,identity_json,scopes_json,pending_scopes_json,capabilities_json,verified_at,updated_at)
        VALUES (?,?,'ready',?,?,?,?,'[]',?,?,?) ON CONFLICT(connection_key) DO UPDATE SET
        generation=excluded.generation,state='ready',secret_ref=excluded.secret_ref,issuer=excluded.issuer,
        identity_json=excluded.identity_json,scopes_json=excluded.scopes_json,
        pending_scopes_json='[]',capabilities_json=excluded.capabilities_json,verified_at=excluded.verified_at,updated_at=excluded.updated_at`)
        .run(key, generation, reference, issuedBy, identityJson, json(granted, 'credential scopes'), capabilityJson, verifiedAt, timestamp);
      if (authorizationAttempt) {
        const completed = this.database.prepare(`UPDATE oauth_attempts SET status='completed', terminal_reason=NULL
          WHERE attempt_id=? AND status='claimed'`).run(authorizationAttempt.attempt_id);
        if (completed.changes !== 1) throw new Error('OAuth attempt is stale');
      }
      this.queueSecretCleanup(this.database, key, [
        ...(current.secretRef && current.secretRef !== reference ? [current.secretRef] : []),
        ...(authorizationAttempt?.secret_ref ? [authorizationAttempt.secret_ref] : []),
        ...additionalCleanupRefs,
      ], authorizationAttempt ? 'credential_commit' : 'credential_rotation');
      this.database.prepare('DELETE FROM connection_credential_prepares WHERE secret_ref=?').run(reference);
      return this.readCredential(key);
    });
  }

  clearCredential({ connectionKey, expectedGeneration, lease } = {}) {
    const key = opaqueConnectionKey(connectionKey);
    if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) throw new TypeError('credential generation is invalid');
    return this.transaction(() => {
      this.assertLease(lease); const current = this.readCredential(key);
      if (current.generation !== expectedGeneration) throw new Error('credential generation is stale');
      const generation = expectedGeneration + 1; const timestamp = this.now();
      this.database.prepare(`INSERT INTO connection_credentials
        (connection_key,generation,state,secret_ref,issuer,identity_json,scopes_json,pending_scopes_json,capabilities_json,verified_at,updated_at)
        VALUES (?,?,'cleared',NULL,NULL,NULL,'[]','[]','{}',NULL,?) ON CONFLICT(connection_key) DO UPDATE SET
        generation=excluded.generation,state='cleared',secret_ref=NULL,issuer=NULL,identity_json=NULL,
        scopes_json='[]',pending_scopes_json='[]',capabilities_json='{}',verified_at=NULL,updated_at=excluded.updated_at`)
        .run(key, generation, timestamp);
      const activeAttempts = this.database.prepare(`SELECT attempt_id,secret_ref FROM oauth_attempts
        WHERE connection_key=? AND status IN ('pending','claimed')`).all(key);
      this.database.prepare(`UPDATE oauth_attempts SET status='cancelled', terminal_reason='credential_cleared'
        WHERE connection_key=? AND status IN ('pending','claimed')`).run(key);
      this.queueSecretCleanup(this.database, key, [current.secretRef,
        ...activeAttempts.map((row) => row.secret_ref)], 'credential_cleared');
      return this.readCredential(key);
    });
  }

  listSecretCleanup(connectionKey, limit = 100) {
    const key = opaqueConnectionKey(connectionKey);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new TypeError('cleanup limit is invalid');
    return this.database.prepare(`SELECT secret_ref AS secretRef, reason, created_at AS createdAt
      FROM connection_secret_cleanup WHERE connection_key=? ORDER BY created_at,secret_ref LIMIT ?`).all(key, limit);
  }

  completeSecretCleanup(connectionKey, secretRef) {
    return this.database.prepare('DELETE FROM connection_secret_cleanup WHERE connection_key=? AND secret_ref=?')
      .run(opaqueConnectionKey(connectionKey), required(secretRef, 'secret reference')).changes === 1;
  }

  scheduleSecretCleanup(connectionKey, secretRefs, reason = 'cleanup_required') {
    const key = opaqueConnectionKey(connectionKey);
    return this.transaction(() => { this.queueSecretCleanup(this.database, key,
      Array.isArray(secretRefs) ? secretRefs : [secretRefs], String(reason).slice(0, 100)); });
  }

  close() { this.database.close(); }
}
