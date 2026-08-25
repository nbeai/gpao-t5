import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('제품 진입점은 Channel Talk를 platform secret store와 설정 연결 목록에 실제 등록한다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /makeChannelTalkConnection/u);
  assert.match(source, /makeChannelTalkConnection\(\{ secretStore: platformSecretStore \}\)/u);
  assert.match(source, /const googleConnectionService = googleWorkspaceRemoteConnection[\s\S]*\?\? googleWorkspaceApiConnection \?\? googleDriveService/u);
  assert.match(source, /\[googleConnectionService, notionConnection, linearConnection, channelTalkConnection\]/u);
  assert.doesNotMatch(source, /CHANNEL_TALK_ACCESS|CHANNEL_TALK_SECRET/u);
});
