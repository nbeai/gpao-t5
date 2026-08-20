import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestoPath = resolve(root, 'docs', '00-product', 'GPAO-T5-FOUNDER-MANIFESTO-ko.md');

test('창립 선언문은 제품 정본과 분리해 원문과 역할을 보존한다', async () => {
  const manifesto = await readFile(manifestoPath, 'utf8');
  assert.match(manifesto, /상태: `FOUNDER_MANIFESTO`/u);
  assert.match(manifesto, /제품 계약이나 구현 명세가 아니다/u);
  assert.match(manifesto, /도구를 쥐어주면 목수는 집을 짓는다/u);
  assert.match(manifesto, /본질은 효율 획득/u);
  assert.match(manifesto, /운영의 주체력만은 오리지널을 만들고 싶었습니다/u);
});

test('설치된 T5는 같은 선언문을 설정에서 필요할 때만 읽는다', async () => {
  const [server, html, build, verify] = await Promise.all([
    readFile(resolve(root, 'refoundation', 'src', 'console-server.js'), 'utf8'),
    readFile(resolve(root, 'src', 'surface', 'web', 'index.html'), 'utf8'),
    readFile(resolve(root, 'refoundation', 'scripts', 'build-macos-installer.mjs'), 'utf8'),
    readFile(resolve(root, 'refoundation', 'scripts', 'verify-macos-installer.mjs'), 'utf8'),
  ]);
  assert.match(server, /founderManifestoPath/u);
  assert.match(server, /url\.pathname === '\/about\/manifesto'/u);
  assert.match(html, /\['about', 'T5에 대하여'\]/u);
  assert.match(html, /fetch\('\/about\/manifesto'\)/u);
  assert.match(html, /renderMarkdownInto\(content, manifesto\.markdown/u);
  assert.match(build, /GPAO-T5-FOUNDER-MANIFESTO-ko\.md/u);
  assert.match(verify, /GPAO-T5-FOUNDER-MANIFESTO-ko\.md/u);
});

test('창립 선언문은 매 턴 모델 입력에 결합되지 않는다', async () => {
  const factory = await readFile(resolve(root, 'refoundation', 'src', 'console-model-factory.js'), 'utf8');
  assert.doesNotMatch(factory, /FOUNDER_MANIFESTO|GPAO-T5-FOUNDER-MANIFESTO/u);
});
