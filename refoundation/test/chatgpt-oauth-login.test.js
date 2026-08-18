import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildChatGptAuthorizeUrl, createPkce, exchangeChatGptCode, saveChatGptOAuthConnection,
} from '../src/chatgpt-oauth-login.js';

const b64url = (value) => Buffer.from(value).toString('base64url');
const idToken = (accountId) => `x.${b64url(JSON.stringify({
  'https://api.openai.com/auth': { chatgpt_account_id: accountId },
}))}.y`;

test('OAuth 로그인 URL은 PKCE S256·state·localhost callback을 결합하고 verifier를 노출하지 않는다', () => {
  const pkce = createPkce((size) => Buffer.alloc(size, 7));
  const expected = createHash('sha256').update(pkce.verifier).digest('base64url');
  assert.equal(pkce.challenge, expected);
  const authorize = new URL(buildChatGptAuthorizeUrl({ ...pkce, port: 1455 }));
  assert.equal(authorize.origin, 'https://auth.openai.com');
  assert.equal(authorize.searchParams.get('code_challenge'), expected);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('state'), pkce.state);
  assert.equal(authorize.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
  assert.ok(!authorize.search.includes(pkce.verifier));
});

test('authorization code 교환은 access·refresh·account id를 만들고 비밀을 오류에 노출하지 않는다', async () => {
  const calls = [];
  const credential = await exchangeChatGptCode({
    code: 'code-secret', verifier: 'verifier-secret', port: 1455,
  }, {
    now: () => 1_000_000,
    fetchImpl: async (_url, init) => {
      calls.push(String(init.body));
      return new Response(JSON.stringify({
        access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600,
        id_token: idToken('acct-9'),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(credential.access, 'access-secret');
  assert.equal(credential.refresh, 'refresh-secret');
  assert.equal(credential.accountId, 'acct-9');
  assert.match(calls[0], /code=code-secret/);
  assert.match(calls[0], /code_verifier=verifier-secret/);
});

test('OAuth 연결 저장은 기존 API 키 연결을 보존하고 OAuth를 활성화하며 파일을 0600으로 만든다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-oauth-save-'));
  const file = join(dir, 'model-connection.json');
  await writeFile(file, JSON.stringify({
    version: 2,
    activeId: 'openai:gpt-api',
    roleBindings: {},
    connections: [{
      id: 'openai:gpt-api', kind: 'api_key', provider: 'openai', modelId: 'gpt-api',
      baseUrl: 'https://api.openai.com/v1', key: 'api-secret',
    }],
  }), { mode: 0o600 });
  try {
    const status = await saveChatGptOAuthConnection({
      file,
      modelId: 'gpt-account',
      credential: {
        access: 'oauth-access', refresh: 'oauth-refresh', expiresAt: 99, accountId: 'acct-1',
      },
    });
    assert.deepEqual(status, {
      connected: true, id: 'chatgpt_oauth:gpt-account', modelId: 'gpt-account', connectionCount: 2,
    });
    assert.doesNotMatch(JSON.stringify(status), /oauth-access|oauth-refresh|api-secret/);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.connections.length, 2);
    assert.equal(saved.activeId, 'chatgpt_oauth:gpt-account');
    assert.equal(saved.connections[0].key, 'api-secret');
    assert.equal(saved.connections[1].credential.access, 'oauth-access');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('알 수 없는 기존 연결 파일은 OAuth 저장으로 덮어쓰지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-oauth-unknown-state-'));
  const file = join(dir, 'model-connection.json');
  const original = JSON.stringify({ version: 99, credential: 'must-survive' });
  await writeFile(file, original, { mode: 0o600 });
  try {
    await assert.rejects(() => saveChatGptOAuthConnection({
      file,
      modelId: 'gpt-account',
      credential: { access: 'oauth-access', refresh: 'oauth-refresh', expiresAt: 99 },
    }), /unsupported existing model connection format/);
    assert.equal(await readFile(file, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
