import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Slack은 사전등록 OAuth app과 실측 public-search 정책이 모두 있을 때만 제품 연결 서비스로 열린다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /T5_SLACK_OAUTH_CLIENT_ID/u);
  assert.match(source, /T5_SLACK_OAUTH_CLIENT_SECRET/u);
  assert.match(source, /T5_SLACK_PUBLIC_SEARCH_TOOL_NAME/u);
  assert.match(source, /slackClientId && slackPublicSearchPolicy \? makeSlackMcpConnection/u);
  assert.match(source, /if \(slackConnection\) workspaceConnectionServices\.push\(slackConnection\)/u);
  assert.match(source, /T5 Slack OAuth application configuration is incomplete/u);
  assert.doesNotMatch(source, /clientSecret:\s*['"][^'"]+['"]/u);
});
