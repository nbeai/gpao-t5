import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Google 자격 콘솔은 별도 owner·상태에서 Google만 열고 공용 메신저 자격을 읽지 않는다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /T5_REFOUNDATION_GOOGLE_QUALIFICATION/u);
  assert.match(source, /google-qualification-\$\{createHash/u);
  assert.match(source, /clientId: googleOAuthClientId, t5UserId: connectionOwnerId/u);
  assert.match(source, /googleQualificationMode \? memorySecretStore\(\) : platformSecretStore/u);
  assert.match(source, /if \(!googleQualificationMode\) \{\s*await migrateMessengerCredentials/u);
  assert.match(source, /googleQualificationMode\s*\? \[googleConnectionService\]\s*:\s*\[googleConnectionService, notionConnection, linearConnection, channelTalkConnection\]/u);
});
