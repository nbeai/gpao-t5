import assert from 'node:assert/strict';
import test from 'node:test';

import { makeAutomationTool } from '../src/automation-tool.js';
import { EFFECT_SCHEMA, makeTerminalHand } from '../src/exec-tool.js';

function assertStrictClosedObjects(schema, path = 'parameters') {
  if (!schema || typeof schema !== 'object') return;
  for (const [index, candidate] of (schema.anyOf ?? []).entries()) {
    assertStrictClosedObjects(candidate, `${path}.anyOf[${index}]`);
  }
  const objectType = schema.type === 'object'
    || (Array.isArray(schema.type) && schema.type.includes('object'));
  if (objectType && schema.additionalProperties === false) {
    const properties = Object.keys(schema.properties ?? {}).sort();
    const required = [...(schema.required ?? [])].sort();
    assert.deepEqual(required, properties, `${path} must require every closed-object property`);
  }
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    assertStrictClosedObjects(child, `${path}.properties.${name}`);
  }
  if (schema.items) assertStrictClosedObjects(schema.items, `${path}.items`);
}

test('공유 Effect schema는 provider strict closed-object 계약을 지킨다', () => {
  assertStrictClosedObjects(EFFECT_SCHEMA, 'EFFECT_SCHEMA');
  assert.ok(EFFECT_SCHEMA.required.includes('rollbackOfToolCallId'));
});

test('일반 제품 턴의 Terminal·Automation schema는 provider 요청 전에 strict하다', () => {
  const terminal = makeTerminalHand({ workingDirectory: process.cwd(), ownerId: 'schema-test' });
  const automation = makeAutomationTool({
    store: {}, scheduler: {}, sessionId: 'schema-test',
  });
  for (const tool of [...terminal.tools, automation]) {
    assertStrictClosedObjects(tool.parameters, tool.name);
  }
});
