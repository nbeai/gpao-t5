import test from 'node:test';
import assert from 'node:assert/strict';

import { qualifyConnectionReadiness } from '../src/connection-readiness.js';

const base = {
  credential: { state: 'ready', generation: 2, scopes: ['openid', 'drive.readonly'] },
  expectedIdentity: { accountId: 'account-a', tenantId: 'tenant-a' },
  observedIdentity: { accountId: 'account-a', tenantId: 'tenant-a' },
  requiredScopes: ['openid', 'drive.readonly'],
  catalogCapabilities: { search: true, read: true, create: true, update: true },
  liveCapabilities: { search: true, read: true, create: false, update: false },
  protectedProbe: { attempted: true, ok: true, resourceId: 'drive-root' },
  runtimeHealth: { available: true },
};

test('token과 public tools/list만 있고 protected probe가 없으면 ready가 아니다', () => {
  assert.deepEqual(qualifyConnectionReadiness({ ...base, protectedProbe: { attempted: false, ok: false } }), {
    state: 'verifying', reason: 'protected_capability_not_observed', generation: 2, capabilities: {},
  });
});

test('OAuth가 다른 계정·tenant로 끝나면 자동 교체하지 않고 identity mismatch로 닫힌다', () => {
  const result = qualifyConnectionReadiness({ ...base,
    observedIdentity: { accountId: 'account-b', tenantId: 'tenant-a' } });
  assert.equal(result.state, 'needs_account_selection'); assert.equal(result.reason, 'provider_identity_mismatch');
  assert.deepEqual(result.capabilities, {});
});

test('필수 scope 일부가 없으면 추가 권한만 계산하고 capability를 열지 않는다', () => {
  const result = qualifyConnectionReadiness({ ...base,
    credential: { state: 'ready', generation: 2, scopes: ['openid'] } });
  assert.deepEqual(result, { state: 'needs_additional_permission', reason: 'required_scope_missing',
    generation: 2, missingScopes: ['drive.readonly'], capabilities: {} });
});

test('ready capability는 catalog 기대와 live probe의 교집합이며 tool 이름을 추측하지 않는다', () => {
  const result = qualifyConnectionReadiness(base);
  assert.deepEqual(result, { state: 'ready', reason: 'verified', generation: 2,
    capabilities: { search: true, read: true, create: false, update: false }, resourceId: 'drive-root' });
});

test('catalog에 없는 live capability와 live가 부정한 write는 모델 표면에 열리지 않는다', () => {
  const result = qualifyConnectionReadiness({ ...base,
    catalogCapabilities: { read: true, update: true },
    liveCapabilities: { read: true, update: false, destructive_admin: true } });
  assert.deepEqual(result.capabilities, { read: true, update: false });
  assert.equal(Object.hasOwn(result.capabilities, 'destructive_admin'), false);
});

test('probe가 성공해도 runtime health가 없으면 ready가 아니라 degraded다', () => {
  assert.deepEqual(qualifyConnectionReadiness({ ...base, runtimeHealth: { available: false, reason: 'transport_closed' } }), {
    state: 'degraded', reason: 'transport_closed', generation: 2, capabilities: {},
  });
});

test('revoked·needs_reauth credential은 probe 없이 terminal auth state를 보존한다', () => {
  assert.equal(qualifyConnectionReadiness({ ...base, credential: { state: 'revoked', generation: 3, scopes: [] } }).state, 'revoked');
  assert.equal(qualifyConnectionReadiness({ ...base, credential: { state: 'needs_reauth', generation: 3, scopes: [] } }).state, 'needs_reauth');
  assert.equal(qualifyConnectionReadiness({ ...base,
    credential: { state: 'needs_additional_permission', generation: 3, scopes: [] } }).state,
  'needs_additional_permission');
});
