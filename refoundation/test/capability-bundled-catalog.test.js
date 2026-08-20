import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCapabilityCatalog } from '../src/capability-catalog.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'capabilities');

test('bundled 후보는 공식 최신 경로와 서로 다른 제품 blocker를 정직하게 보존한다', async () => {
  const catalog = await loadCapabilityCatalog({ directory: root });
  assert.deepEqual(catalog.entries.map((entry) => entry.id), ['airtable', 'asana', 'figma', 'linear']);
  assert.deepEqual(catalog.rejected, []);
  const byId = Object.fromEntries(catalog.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.asana.endpoint, 'https://mcp.asana.com/v2/mcp');
  assert.equal(byId.asana.preparation, 'product_registration_required');
  assert.doesNotMatch(JSON.stringify(byId.asana), /mcp\.asana\.com\/sse/u);
  assert.equal(byId.figma.preparation, 'provider_approval_required');
  assert.equal(byId.airtable.preparation, 'generic_mcp_runtime_required');
  assert.equal(byId.linear.preparation, 'user_authorization_available');
  assert.equal(byId.linear.canStart, true);
});
