import test from 'node:test';
import assert from 'node:assert/strict';
import { learningMethodTrace } from '../src/learning-method-evidence.js';

const completed = (command, argv) => ({ type: 'tool_completed', payload: { receipt: {
  requestedCall: { name: 'exec' }, outcome: 'succeeded', result: { commandExplanation: {
    ok: true, steps: [{ executable: command, argv }],
  } },
} } });

test('학습 method trace는 실행 순서를 보존하되 대상·비밀·절대 경로를 복제하지 않는다', () => {
  const trace = learningMethodTrace({ events: [
    completed('/Users/person/bin/ledger-inspect', ['/Users/person/bin/ledger-inspect', 'inspect', '/Users/person/private/feb.ledgerpack']),
    completed('curl', ['curl', '--header', 'Authorization: Bearer secret-token-value', 'https://private.example']),
  ] });
  assert.deepEqual(trace[0], { tool: 'exec', template: 'ledger-inspect inspect <target.ledgerpack>' });
  const text = JSON.stringify(trace); assert.equal(text.includes('/Users/person'), false);
  assert.equal(text.includes('secret-token-value'), false); assert.equal(text.includes('private.example'), false);
});
