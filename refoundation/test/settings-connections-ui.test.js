import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('설정은 서버가 실제 제공하는 모델과 ChatGPT OAuth를 동등한 연결 선택으로 보여준다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  assert.match(html, /endpointJson\('\/model\/providers'\)/u);
  assert.match(html, /id="mcProvider"/u);
  assert.match(html, /id="mcKey"[^>]*type="password"/u);
  assert.match(html, /id="mcChatgpt"/u);
  assert.match(html, /POST|method:\s*'POST'/u);
  assert.match(html, /\/model\/connect/u);
  assert.match(html, /\/model\/connections\/activate/u);
  assert.match(html, /\/model\/connections\/remove/u);
  assert.match(html, /response\.ok/u);
  assert.match(html, /id="mcResult"[^>]*role="status"[^>]*aria-live="polite"/u);
  assert.match(html, /연결 중…/u);
  assert.match(html, /연결이 완료됐어요/u);
  assert.match(html, /apply\.id = 'mcApply'/u);
  assert.match(html, /선택한 모델 적용/u);
  assert.match(html, /모델을 변경하는 중…/u);
  assert.match(html, /refreshActiveModelSurface/u);
  assert.match(html, /사용 중/u);
  assert.doesNotMatch(html, /radio\.onchange\s*=\s*async/u);
});

test('메신저 설정은 token 뒤 첫 개인 메시지를 자동 연결하고 현재 내 계정만 보여준다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  assert.match(html, /endpointJson\('\/channels\/providers'\)/u);
  assert.match(html, /id="msgProvider"/u);
  assert.match(html, /id="msgToken"[^>]*type="password"/u);
  assert.match(html, /id="msgFields"/u);
  assert.match(html, /provider\?\.fields/u);
  assert.match(html, /endpointJson\('\/channels\/connect'/u);
  assert.match(html, /endpointJson\('\/channels\/disconnect'/u);
  assert.match(html, /id="msgRestartBtn"/u);
  assert.match(html, /endpointJson\('\/channels\/restart'/u);
  assert.match(html, /current\?\.needsAttention/u);
  assert.match(html, /watchMessengerReady/u);
  assert.match(html, /renderTelegramOwner/u);
  assert.match(html, /내 계정 연결 해제/u);
  assert.doesNotMatch(html, /이 사람 허용/u);
  assert.doesNotMatch(html, /if \(result\.ok\) watchMessengerReady/u);
  assert.match(html, /#mcResult:empty, #msgResult:empty \{ display:none; \}/u);
  assert.match(html, /response\.ok/u);
});

test('연결 설정은 설치·로그인 사용자 행동을 내부 용어 없이 실행하고 상태를 다시 확인한다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  assert.match(html, /action\.kind === 'user_action'/u);
  assert.match(html, /필요한 화면을 열고 있어요/u);
  assert.match(html, /JSON\.stringify\(\{ actionId: action\.id \}\)/u);
  assert.match(html, /performed\.data\?\.userSafeSummary/u);
});
