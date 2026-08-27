import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('파일 활동은 기억·개인정보 설정에서만 metadata 범위와 삭제를 사용자가 통제한다', async () => {
  const html=await readFile(new URL('../ui/index.html',import.meta.url),'utf8');
  const memory=html.slice(html.indexOf('async memory()'),html.indexOf('async looks()'));
  assert.match(memory,/파일 활동 기록/u);assert.match(memory,/파일 내용은 기록하지 않아요/u);
  assert.match(memory,/fetch\('\/file-activity\/state'\)/u);assert.match(memory,/기록할 폴더 선택/u);
  assert.match(memory,/\/file-activity\/select', \{\}/u);
  assert.match(memory,/잠시 멈추기/u);assert.match(memory,/기록 모두 지우기/u);assert.match(memory,/confirm\(/u);
  assert.match(memory,/fetch\('\/file-activity\/history\?limit=10'\)/u);
  assert.doesNotMatch(html.slice(0,html.indexOf('const SET_RENDER')),/file-activity\/state/u);
  assert.doesNotMatch(memory,/innerHTML|activityHandle|cursor|rootId|contentCapture\s*:/u);
});
