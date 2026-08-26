import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const consoleHtml = resolve(root, 'refoundation/ui/index.html');

test('알려진 API 키 형태는 대화로 보내지 않고 전용 연결 입력면으로 돌린다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  const source = html.match(/const CHAT_SECRET_PATTERNS = \[[\s\S]*?function containsCredentialLikeText\(value\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(source);
  const detect = Function(`${source}; return containsCredentialLikeText;`)();
  assert.equal(detect(`sk-proj-${'a'.repeat(30)}`), true);
  assert.equal(detect(`AIza${'A'.repeat(30)}`), true);
  assert.equal(detect('API 키라는 단어를 설명하는 일반 문장'), false);
  assert.match(html, /if \(containsCredentialLikeText\(t\)\)[\s\S]*renderChatSecretBoundary\(\)[\s\S]*return/u);
  assert.match(html, /addEventListener\('paste'[\s\S]*event\.preventDefault\(\)/u);
  assert.match(html, /내용은 저장하거나 모델에 전달하지 않았어요/u);
});

test('모델 비밀 입력과 저장 목록은 실제 값을 다시 표시하지 않는다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /id="mcKey"[^>]*type="password"[^>]*autocomplete="off"/u);
  assert.match(html, /API 키는 대화가 아닌 이 입력칸에서만 받아요/u);
  assert.match(html, /연결 이름과 저장 상태만 표시해요/u);
  assert.match(html, /keyMasked/u);
  assert.match(html, /box\.querySelector\('#mcKey'\)\.value = ''/u);
});

test('여러 모델 연결은 선택과 적용을 분리하고 현재 사용 상태를 한 곳에서 갱신한다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /input\[name="mcActive"\]:checked/u);
  assert.match(html, /선택됨 — 적용 전/u);
  assert.match(html, /선택한 모델 적용/u);
  assert.match(html, /\/model\/connections\/activate/u);
  assert.match(html, /refreshActiveModelSurface/u);
  assert.doesNotMatch(html, /radio\.onchange\s*=\s*async/u);
});
