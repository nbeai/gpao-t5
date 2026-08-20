import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('설정은 서버가 실제 제공하는 모델과 ChatGPT OAuth를 동등한 연결 선택으로 보여준다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /endpointJson\('\/model\/providers'\)/u);
  assert.match(html, /id="mcProvider"/u);
  assert.match(html, /id="mcKey"[^>]*type="password"/u);
  assert.match(html, /id="mcChatgpt"/u);
  assert.match(html, /POST|method:\s*'POST'/u);
  assert.match(html, /\/model\/connect/u);
  assert.match(html, /\/model\/connections\/activate/u);
  assert.match(html, /\/model\/connections\/remove/u);
  assert.match(html, /response\.ok/u);
});

test('메신저 설정은 provider capability로 비밀 필드를 만들고 연결·해제·allowlist를 잇는다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /endpointJson\('\/channels\/providers'\)/u);
  assert.match(html, /id="msgProvider"/u);
  assert.match(html, /id="msgToken"[^>]*type="password"/u);
  assert.match(html, /id="msgFields"/u);
  assert.match(html, /provider\?\.fields/u);
  assert.match(html, /endpointJson\('\/channels\/connect'/u);
  assert.match(html, /endpointJson\('\/channels\/disconnect'/u);
  assert.match(html, /renderPendingSenders/u);
  assert.match(html, /response\.ok/u);
});
