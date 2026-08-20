import test from 'node:test';
import assert from 'node:assert/strict';

import { consoleInstructions } from '../src/console-model-factory.js';

test('시각 참고자료 요청은 검색 후보와 실제 출처를 구분해 3~5개 preview로 끝낸다', () => {
  const instructions = consoleInstructions('/private/tmp/t5-visual-reference');
  assert.match(instructions, /visual or design references/i);
  assert.match(instructions, /do not stop at a text list/i);
  assert.match(instructions, /web_search[\s\S]*read[\s\S]*browser[\s\S]*screenshot 3 to 5/iu);
  assert.match(instructions, /managed preview image/iu);
  assert.match(instructions, /source title[\s\S]*verified original page URL/iu);
  assert.match(instructions, /searched candidates, read sources, browser captures, and newly generated images clearly distinct/iu);
  assert.match(instructions, /fewer than 3[\s\S]*explain the shortfall/iu);
});
