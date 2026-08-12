import test from 'node:test';
import assert from 'node:assert/strict';

import { 숨은표면고정물 } from '../scripts/live/ux-hidden-fixtures.mjs';

test('UX 전수 걷기에서 못 본 여덟 표면을 고정한다', () => {
  assert.deepEqual(숨은표면고정물.map((x) => x.id), [
    'approval',
    'secret-input',
    'capability-resolution',
    'memory-change',
    'automation-proposal',
    'pattern-candidate',
    'delivery-failure',
    'recovery',
  ]);
  for (const 고정물 of 숨은표면고정물) {
    assert.ok(고정물.기대글.length > 0, `${고정물.id}: 화면 판별 문장이 없다`);
    assert.ok(고정물.기대버튼.length > 0 || 고정물.id === 'recovery', `${고정물.id}: 실제 행동 입구가 없다`);
  }
});
