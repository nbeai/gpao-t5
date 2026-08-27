import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const evidence = JSON.parse(await readFile(new URL(
  'refoundation/evidence/alpha4-existing-capability-completion-2026-08-27.json', root,
), 'utf8'));
const plan = await readFile(new URL('T5-THIRD-ALPHA.md', root), 'utf8');

test('Alpha4 close는 네 능력 종류와 분리된 credential·authority·execution·effect를 함께 닫는다', () => {
  assert.equal(evidence.status, 'PASS');
  assert.deepEqual(evidence.qualifiedKinds,
    ['local_file', 'authenticated_cli', 'remote_connection', 'os_native']);
  assert.match(evidence.closingPrinciple, /등록된 능력만 등록된 행동/u);
  assert.match(plan, /ALPHA4_COMPLETE · ALPHA5_COMPLETE/u);
  assert.match(plan, /t5\.capability-use-receipt\.v1/u);
});

test('Alpha4 evidence는 실제 개인 계정·비밀·Windows 미실행을 PASS에 숨기지 않는다', () => {
  assert.equal(evidence.verification.personalAccountCredentialTests, 0);
  assert.equal(evidence.verification.externalEffects, 0);
  assert.ok(evidence.notClaimed.some((item) => item.includes('Physical Windows')));
  const text = JSON.stringify(evidence);
  assert.doesNotMatch(text, /\/Users\/|C:\\Users\\|oauth_token:|sk-[A-Za-z0-9]|-----BEGIN/u);
});
