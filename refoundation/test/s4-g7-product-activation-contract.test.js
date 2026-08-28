import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('G7 계약은 pre-source oracle·unpublished preview·single publish와 단순 요청 비선택을 고정한다',async()=>{
  const value=JSON.parse(await readFile(new URL('../fixtures/s4-g7-product-activation-contract.json',import.meta.url),'utf8'));
  assert.equal(value.status,'CONTRACT_ONLY_PRODUCT_WIRING_PENDING');
  assert.deepEqual(value.protocol,['freeze_oracle_before_source','run_and_preview_unpublished','publish_verified_handle_once']);
  assert.ok(value.invariants.some(item=>item.includes('accepts no program source')));
  assert.ok(value.invariants.some(item=>item.includes('writes no user target')));
  assert.ok(value.invariants.some(item=>item.includes('zero capsule model or tool calls')));
  assert.ok(value.nonGoals.includes('business-specific router'));
});
