import test from 'node:test';
import assert from 'node:assert/strict';

import { makeApiCredentialConnection } from '../src/api-credential-connection.js';
import { makeConnectionDoctor } from '../src/connection-truth.js';

function memoryStore() {
  const values = new Map();
  return { async get(key) { return structuredClone(values.get(key) ?? null); },
    async set(key, value) { values.set(key, structuredClone(value)); },
    async clear(key) { values.delete(key); }, values };
}

test('사업자 key-pair 연결은 전용 필드에서 받아 검증·계정 관측 뒤에만 ready가 된다', async () => {
  const store = memoryStore(); let probes = 0;
  const connection = makeApiCredentialConnection({
    id: 'channel-talk', label: 'Channel Talk', category: 'customer_channel', secretStore: store,
    credentialFields: [
      { id: 'accessKey', label: 'Access Key', secret: true },
      { id: 'accessSecret', label: 'Access Secret', secret: true },
    ],
    verifyCredentials: async (credentials) => {
      probes += 1; assert.equal(credentials.accessKey, 'CHANNEL-ACCESS'); assert.equal(credentials.accessSecret, 'CHANNEL-SECRET');
      return { accountId: 'channel-42', accountLabel: '우리 가게 상담',
        permissions: ['customers:read', 'conversations:write'],
        capabilities: { read: true, reply: true } };
    },
  });
  const before = await connection.inspect();
  assert.equal(before.state, 'needs_connection');
  assert.deepEqual(before.credentialRequest.fields.map((field) => field.id), ['accessKey', 'accessSecret']);
  assert.equal(before.actions[0].kind, 'credentials');
  const connected = await connection.connectCredentials({ accessKey: 'CHANNEL-ACCESS', accessSecret: 'CHANNEL-SECRET' });
  assert.equal(connected.ready, true); assert.equal(probes, 1);
  const after = await connection.inspect();
  assert.equal(after.state, 'ready'); assert.equal(after.identity.accountId, 'channel-42');
  assert.deepEqual(after.capabilities, { read: true, reply: true });
  assert.doesNotMatch(JSON.stringify(after), /CHANNEL-ACCESS|CHANNEL-SECRET/u);
  assert.equal(store.values.size, 1);
  await connection.disconnect(); assert.equal((await connection.inspect()).state, 'needs_connection');
});

test('사업자 자격 검증 실패는 공급자 오류가 key를 메아리쳐도 저장·공개하지 않는다', async () => {
  const store = memoryStore(); const secret = 'COUPANG-SECRET';
  const connection = makeApiCredentialConnection({
    id: 'coupang-wing', label: 'Coupang Wing', category: 'commerce', secretStore: store,
    credentialFields: [
      { id: 'vendorId', label: '업체 코드', secret: false },
      { id: 'accessKey', label: 'Access Key', secret: true },
      { id: 'secretKey', label: 'Secret Key', secret: true },
    ],
    verifyCredentials: async () => { throw new Error(`invalid ${secret}`); },
  });
  await assert.rejects(connection.connectCredentials({ vendorId: 'VENDOR', accessKey: 'ACCESS', secretKey: secret }),
    (error) => error.reason === 'credential_verification_failed' && !String(error).includes(secret));
  assert.equal(store.values.size, 0);
  assert.doesNotMatch(JSON.stringify(await connection.inspect()), new RegExp(secret));
});

test('Connection Truth는 credential 입력 구조만 공개하고 값이나 verifier 원문을 버린다', async () => {
  const connection = makeApiCredentialConnection({
    id: 'channel-talk', label: 'Channel Talk', category: 'customer_channel', secretStore: memoryStore(),
    credentialFields: [{ id: 'accessKey', label: 'Access Key', secret: true }],
    verifyCredentials: async () => ({ accountId: 'channel-1', accountLabel: '상담', capabilities: { read: true } }),
  });
  const doctor = makeConnectionDoctor({ inspectors: [connection] });
  const report = await doctor.inspect(); const shown = report.connections[0];
  assert.deepEqual(shown.credentialRequest, { fields: [{ id: 'accessKey', label: 'Access Key', secret: true, maxLength: 4096 }] });
  assert.equal(shown.actions[0].kind, 'credentials');
  assert.equal(shown.actions[0].endpoint, '/connections/channel-talk/credentials');
});
