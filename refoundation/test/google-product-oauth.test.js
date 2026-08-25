import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('제품 Google OAuth 설정은 공개 Desktop client ID만 담고 설치 런타임에서 간편 연결을 연다', async () => {
  const configUrl = new URL('../config/google-oauth.json', import.meta.url);
  const configText = await readFile(configUrl, 'utf8');
  const config = JSON.parse(configText);
  const start = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  const packaging = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');

  assert.equal(config.schema, 't5.google-oauth-client.v1');
  assert.equal(config.projectId, 'gpao-t5');
  assert.equal(config.officialApiEnabled, true);
  assert.match(config.clientId, /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/u);
  assert.doesNotMatch(configText, /client_secret|GOCSPX-|refresh_token|access_token/iu);
  assert.match(start, /bundledGoogleOAuthConfig/u);
  assert.match(start, /officialApiEnabled/u);
  assert.match(packaging, /'config'/u);
});
