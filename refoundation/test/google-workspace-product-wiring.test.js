import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Google Workspace OAuth app이 완전하면 공식 remote MCP가 우선하고 아니면 기존 Drive 경로를 유지한다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /T5_GOOGLE_WORKSPACE_OAUTH_CLIENT_ID/u);
  assert.match(source, /T5_GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET/u);
  assert.match(source, /googleWorkspaceClientId\s*\? makeGoogleWorkspaceDriveMcpConnection/u);
  assert.match(source, /googleWorkspaceRemoteConnection \?\? googleDriveService/u);
  assert.match(source, /T5 Google Workspace OAuth application configuration is incomplete/u);
  assert.doesNotMatch(source, /clientSecret:\s*['"][^'"]+['"]/u);
});
