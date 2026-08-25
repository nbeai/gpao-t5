import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyAuthChallenge, runWithAuthRecovery } from '../src/connection-auth-recovery.js';

test('401은 refresh 뒤 원래 요청을 exact 한 번만 재시도한다', async () => {
  let calls = 0; let refreshes = 0; let reconnects = 0;
  const result = await runWithAuthRecovery({
    operation: async () => { calls += 1; return calls === 1
      ? { ok: false, status: 401, wwwAuthenticate: 'Bearer error="invalid_token"' }
      : { ok: true, status: 200, value: { id: 'resource-1' } }; },
    refresh: async () => { refreshes += 1; return { refreshed: true, generation: 2 }; },
    reconnect: async () => { reconnects += 1; },
  });
  assert.deepEqual(result, { state: 'succeeded', value: { id: 'resource-1' }, retryCount: 1, credentialGeneration: 2 });
  assert.equal(calls, 2); assert.equal(refreshes, 1); assert.equal(reconnects, 1);
});

test('두 번째 401은 needs_reauth이며 refresh·request를 더 반복하지 않는다', async () => {
  let calls = 0; let refreshes = 0;
  const result = await runWithAuthRecovery({ operation: async () => { calls += 1;
    return { ok: false, status: 401, wwwAuthenticate: 'Bearer error="invalid_token"' }; },
  refresh: async () => { refreshes += 1; return { refreshed: true, generation: 3 }; }, reconnect: async () => {} });
  assert.deepEqual(result, { state: 'needs_reauth', retryCount: 1, credentialGeneration: 3 });
  assert.equal(calls, 2); assert.equal(refreshes, 1);
});

test('403 insufficient_scope는 기존 권한과 추가 권한을 합치되 refresh·요청을 반복하지 않는다', async () => {
  const challenge = classifyAuthChallenge({ status: 403,
    wwwAuthenticate: 'Bearer error="insufficient_scope", scope="chat:write files:read"',
    currentScopes: ['search:read.public', 'files:read'] });
  assert.deepEqual(challenge, { kind: 'step_up', requiredScopes: ['chat:write', 'files:read'],
    authorizationScopes: ['search:read.public', 'files:read', 'chat:write'] });
  let refreshes = 0; let calls = 0;
  const result = await runWithAuthRecovery({ currentScopes: ['search:read.public'],
    operation: async () => { calls += 1; return { ok: false, status: 403,
      wwwAuthenticate: 'Bearer error="insufficient_scope", scope="chat:write"' }; },
    refresh: async () => { refreshes += 1; return { refreshed: true }; }, reconnect: async () => {} });
  assert.deepEqual(result, { state: 'needs_additional_permission', requiredScopes: ['chat:write'],
    authorizationScopes: ['search:read.public', 'chat:write'], retryCount: 0 });
  assert.equal(calls, 1); assert.equal(refreshes, 0);
});

test('일반 403은 scope 문제로 확대하지 않고 provider forbidden을 그대로 보존한다', async () => {
  assert.deepEqual(classifyAuthChallenge({ status: 403, wwwAuthenticate: 'Bearer error="access_denied"',
    currentScopes: ['read'] }), { kind: 'forbidden' });
  const result = await runWithAuthRecovery({ operation: async () => ({ ok: false, status: 403,
    wwwAuthenticate: 'Bearer error="access_denied"' }), refresh: async () => ({ refreshed: true }), reconnect: async () => {} });
  assert.deepEqual(result, { state: 'forbidden', status: 403, retryCount: 0 });
});

test('write 전송 뒤 응답 유실은 unknown effect이며 refresh나 blind retry를 하지 않는다', async () => {
  let calls = 0; let refreshes = 0;
  const result = await runWithAuthRecovery({ mutation: true,
    operation: async () => { calls += 1; throw Object.assign(new Error('socket lost'), { requestDispatched: true }); },
    refresh: async () => { refreshes += 1; return { refreshed: true }; }, reconnect: async () => {} });
  assert.deepEqual(result, { state: 'unknown_external_effect', retryCount: 0 });
  assert.equal(calls, 1); assert.equal(refreshes, 0);
});

test('refresh가 새 generation을 만들지 못하면 요청 재시도 없이 needs_reauth다', async () => {
  let calls = 0;
  const result = await runWithAuthRecovery({ operation: async () => { calls += 1;
    return { ok: false, status: 401, wwwAuthenticate: 'Bearer error="invalid_token"' }; },
  refresh: async () => ({ refreshed: false }), reconnect: async () => { throw new Error('must not reconnect'); } });
  assert.deepEqual(result, { state: 'needs_reauth', retryCount: 0, credentialGeneration: null });
  assert.equal(calls, 1);
});
