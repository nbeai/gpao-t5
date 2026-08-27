import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CH2 UI는 기억·개인정보 설정에서만 title·URL 없는 app/AFK 통제를 보인다',async()=>{
  const html=await readFile(new URL('../ui/index.html',import.meta.url),'utf8');const memory=html.slice(html.indexOf('async memory()'),html.indexOf('async looks()'));
  assert.match(memory,/앞에 떠 있는 앱 이름/u);assert.match(memory,/창 제목·문서·URL·입력 내용은 기록하지 않아요/u);
  for(const value of ['/app-activity/state','/app-activity/configure','private mode','이 앱 제외','모든 앱 다시 포함','내보내기','기록 모두 지우기'])
    assert.ok(memory.includes(value),value);
  assert.doesNotMatch(memory,/innerHTML|appId|windowTitle|documentTitle|rawUrl/u);
  assert.doesNotMatch(html.slice(0,html.indexOf('const SET_RENDER')),/\/app-activity\/state/u);
});
