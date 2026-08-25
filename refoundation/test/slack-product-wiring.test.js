import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Slack은 T5 사전등록 OAuth app이 완전할 때만 제품 연결 서비스로 열린다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /T5_SLACK_OAUTH_CLIENT_ID/u);
  assert.match(source, /T5_SLACK_OAUTH_CLIENT_SECRET/u);
  assert.match(source, /slackClientId \? makeSlackMcpConnection/u);
  assert.match(source, /if \(slackConnection\) workspaceConnectionServices\.push\(slackConnection\)/u);
  assert.match(source, /T5 Slack OAuth application configuration is incomplete/u);
  assert.doesNotMatch(source, /clientSecret:\s*['"][^'"]+['"]/u);
});
