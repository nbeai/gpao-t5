import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = resolve(root, 'refoundation/evidence/k0-korea-business-connection-contracts-2026-08-25.json');

test('한국 1인기업 연결 계약은 공식 route 우선순위와 목표 서비스의 blocker를 기계적으로 보존한다', async () => {
  const seal = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(seal.schema, 't5.korea-business-connection-contracts.v1');
  assert.deepEqual(seal.targetAudience, ['solo_business', 'small_business', 'self_employed']);
  assert.deepEqual(seal.routePreference, [
    'official_remote_mcp_oauth', 'official_api_oauth', 'official_api_key',
    'official_partner_contract', 'verified_local_standard',
  ]);
  const byId = Object.fromEntries(seal.contracts.map((entry) => [entry.id, entry]));
  for (const id of ['kakao', 'naver', 'naver-works', 'google-workspace', 'microsoft-365', 'notion',
    'slack', 'telegram', 'naver-smartstore', 'coupang-wing', 'kakao-channel', 'naver-smartplace',
    'instagram-business', 'youtube', 'channel-talk', 'shopify', 'shopee', 'delivery-platforms']) {
    assert.ok(byId[id], `missing ${id}`);
    assert.match(byId[id].source, /^https:\/\//u);
    assert.ok(byId[id].closeoutProbe);
  }
  assert.equal(byId.notion.readiness, 'qualified_positive_control');
  assert.equal(byId['google-workspace'].authMode, 'oauth_preregistered_confidential');
  assert.equal(byId['channel-talk'].authMode, 'key_pair');
  assert.equal(byId['coupang-wing'].authMode, 'key_pair');
  assert.equal(byId['naver-smartplace'].readiness, 'blocked_pending_official_management_api');
  assert.equal(byId['delivery-platforms'].readiness, 'blocked_pending_provider_contracts');
  assert.equal(new Set(seal.contracts.map((entry) => entry.id)).size, seal.contracts.length);
  assert.doesNotMatch(JSON.stringify(seal), /access[_-]?token|refresh[_-]?token|client[_-]?secret/i);
});
