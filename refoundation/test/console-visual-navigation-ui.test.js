import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const consoleHtml = resolve(root, 'src/surface/web/index.html');

test('주요 픽토그램은 18px 시각 크기와 36px 클릭 영역을 함께 가진다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /\.brand \.ic, \.sidefoot \.ic \{[^}]*font-size:18px;[^}]*width:36px; height:36px/su);
  assert.match(html, /\.nav \.em \{ width:20px; height:20px;[^}]*font-size:16px/su);
  assert.match(html, /class="hb" id="hb" type="button"[^>]*aria-label="대화 목록 열기"/u);
  assert.match(html, /\.tb-head \.tb-x \{[^}]*width:36px; height:36px/su);
  assert.match(html, /@media \(max-width:720px\)[\s\S]*\.crumb \.hb \{ display:grid; \}/u);
});

test('설정 세부 영역은 현재 위치와 설정으로 돌아가는 경로를 함께 보인다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /id="set-title">설정</u);
  assert.match(html, /setTitle\.textContent = section === 'model' \? '설정' : `설정 › \$\{currentLabel\}`/u);
  assert.match(html, /setBack\.textContent = section === 'model' \? '← 대화로 돌아가기' : '← 설정으로 돌아가기'/u);
  assert.match(html, /setBack\.onclick = section === 'model' \? closeSettings : \(\) => openSettings\('model'\)/u);
});

test('음영은 사이드바·상단·입력·오버레이처럼 실제 레이어 경계에만 적용한다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /#side \{[^}]*box-shadow:var\(--sh-sm\)/su);
  assert.match(html, /\.crumb \{[^}]*background:var\(--surface\); box-shadow:var\(--sh-sm\)/su);
  assert.match(html, /\.composer \{[^}]*box-shadow:0 -4px 14px var\(--accent-glow\)/su);
  assert.match(html, /#tbpanel, #setpanel \{[^}]*box-shadow:var\(--sh-lg\)/su);
  assert.doesNotMatch(html, /\.msg \{[^}]*box-shadow:var\(--sh-lg\)/su);
});
