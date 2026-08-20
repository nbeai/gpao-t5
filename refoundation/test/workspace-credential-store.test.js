import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkspaceCredentialStore } from '../src/workspace-credential-store.js';

test('업무공간 자격은 0600에 원자 저장되고 공개 상태에는 토큰이 없다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-workspace-credential-'));
  try {
    const store = new WorkspaceCredentialStore(room);
    await store.setVerified('google-workspace', {
      credential: { accessToken: 'ACCESS-SECRET', refreshToken: 'REFRESH-SECRET', expiresAt: 12345 },
      scopes: ['drive'], verifiedAt: 1000,
    });
    assert.equal((await stat(store.file)).mode & 0o777, 0o600);
    assert.equal((await stat(room)).mode & 0o777, 0o700);
    assert.equal((await store.get('google-workspace')).credential.refreshToken, 'REFRESH-SECRET');
    const publicState = await store.describe();
    assert.equal(publicState['google-workspace'].connected, true);
    assert.deepEqual(publicState['google-workspace'].scopes, ['drive']);
    assert.doesNotMatch(JSON.stringify(publicState), /ACCESS-SECRET|REFRESH-SECRET|accessToken|refreshToken/u);
    await store.clear('google-workspace');
    assert.equal(await store.get('google-workspace'), null);
  } finally { await rm(room, { recursive: true, force: true }); }
});
