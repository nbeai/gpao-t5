import test from 'node:test';
import assert from 'node:assert/strict';

import { consoleInstructions } from '../src/console-model-factory.js';

test('시각 참고자료 요청은 링크 목록이 아니라 관리 preview와 출처로 끝낸다', () => {
  const instructions = consoleInstructions('/private/tmp/t5-visual-reference');
  assert.match(instructions, /find images or visual\/design references/i);
  assert.match(instructions, /do not stop at links or a text list/i);
  assert.match(instructions, /Use visual_reference.*embed each returned previewUrl.*actual Markdown image/iu);
  assert.match(instructions, /observed source-page link/iu);
  assert.match(instructions, /verificationMissing=true.*state the shortfall/iu);
  assert.match(instructions, /fewer than requested.*state the shortfall/iu);
  assert.match(instructions, /ordinary image discovery must not open a visible browser/iu);
});
