import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const configPath = new URL('refoundation/config/s3-memory-incidents.json', root);

test('S3-M0는 구현 전에 열다섯 기억 사고 가족과 절대 불변식을 고정한다', async () => {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.status, 'm0_locked_before_product_change');
  assert.equal(config.incidents.length, 15);
  assert.equal(new Set(config.incidents.map((incident) => incident.id)).size, 15);
  assert.deepEqual(config.incidents.map((incident) => incident.id), Array.from({ length: 15 },
    (_, index) => `M0-${String(index + 1).padStart(2, '0')}`));
  assert.equal(config.absoluteInvariants.length, 8);
  assert.ok(config.incidents.every((incident) => (
    incident.userFailure && incident.fixture && incident.oracle
    && incident.expectedBaseline && incident.ownerStage
  )));
});

test('S3-M0 fixture는 실제 사용자·계정·비밀·경로를 저장소에 복제하지 않는다', async () => {
  const text = await readFile(configPath, 'utf8');
  const config = JSON.parse(text);
  assert.equal(config.privacy.realUserData, false);
  assert.equal(config.privacy.realAccounts, false);
  assert.equal(config.privacy.rawSecrets, false);
  assert.doesNotMatch(text, /\/Users\/|C:\\Users\\|sk-[A-Za-z0-9]|gh[pousr]_/u);
});
