import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const consoleHtml = resolve(root, 'refoundation/ui/index.html');

test('긴 URL과 연속 문자열은 말풍선을 밀지 않고 코드·표만 내부에서 스크롤한다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /\.msg \{ min-width:0; max-width:86%/u);
  assert.match(html, /\.msg\.me, \.msg\.bot\.error,[\s\S]*overflow-wrap:anywhere; word-break:break-word;/u);
  assert.match(html, /:not\(pre\) > code/u);
  assert.match(html, /\.msg\.bot pre \{[\s\S]*overflow-x:auto; max-width:100%;/u);
  assert.match(html, /\.msg\.bot table \{[\s\S]*overflow-x:auto; max-width:100%;/u);
});

test('테마는 system·light·dark 세 상태를 저장하고 첫 paint 전에 복원한다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /localStorage\.getItem\('gpao-t5\.theme-mode'\)/u);
  assert.match(html, /const THEME_STORAGE_KEY = 'gpao-t5\.theme-mode'/u);
  assert.match(html, /localStorage\.setItem\(THEME_STORAGE_KEY, mode\)/u);
  assert.match(html, /cur === 'dark' \? 'light' : cur === 'light' \? 'system' : 'dark'/u);
  assert.match(html, /테마: \$\{label\}/u);
});

test('사용자가 대화나 다른 사이드바 화면으로 이동하면 세션 선택 상태만 정리한다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /function clearSessionSelection\(\)[\s\S]*selected\.clear\(\)[\s\S]*querySelectorAll\('\.chk'\)/u);
  assert.match(html, /getElementById\('main'\)\.addEventListener\('pointerdown',[\s\S]*clearSessionSelection/u);
  assert.match(html, /function toggleSearch\(force\)[\s\S]*if \(open\) clearSessionSelection\(\)/u);
  assert.match(html, /async function openSettings\(section = 'model'(?:, \{ updateHistory = true \} = \{\})?\) \{\s*clearSessionSelection\(\)/u);
  assert.match(html, /closest\('button\[data-view\]'\)/u);
  assert.match(html, /id="listtabs"[\s\S]*clearSessionSelection\(\);\s*listView = b\.dataset\.view/u);
  assert.match(html, /async function newSession\(\) \{\s*clearSessionSelection\(\)/u);
  assert.doesNotMatch(html, /async function selectSession\(id\) \{\s*clearSessionSelection\(\)/u);
});
