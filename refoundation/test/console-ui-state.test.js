import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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

test('대화 입력은 Enter 한 번으로 전송하고 Shift+Enter만 줄바꿈하며 한글 조합도 중복 전송하지 않는다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  const start = html.indexOf('function installChatEnterBehavior');
  const end = html.indexOf('installChatEnterBehavior(text, submit);');
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ queueMicrotask });
  vm.runInContext(html.slice(start, end), context);

  const listeners = new Map(); let submits = 0; let prevented = 0;
  const input = { addEventListener(type, listener) { listeners.set(type, listener); } };
  context.installChatEnterBehavior(input, () => { submits += 1; });
  const event = (overrides = {}) => ({ key: 'Enter', shiftKey: false, isComposing: false,
    keyCode: 13, preventDefault() { prevented += 1; }, ...overrides });

  listeners.get('keydown')(event());
  assert.equal(submits, 1); assert.equal(prevented, 1);
  listeners.get('keydown')(event({ shiftKey: true }));
  assert.equal(submits, 1); assert.equal(prevented, 1);

  listeners.get('compositionstart')();
  listeners.get('keydown')(event({ isComposing: true, keyCode: 229 }));
  assert.equal(submits, 1); assert.equal(prevented, 2);
  listeners.get('compositionend')();
  await new Promise((resolveMicrotask) => queueMicrotask(resolveMicrotask));
  listeners.get('keyup')(event());
  assert.equal(submits, 2, 'composition Enter must submit exactly once');

  listeners.get('compositionstart')();
  listeners.get('keydown')(event({ isComposing: true, keyCode: 229 }));
  listeners.get('keyup')(event({ isComposing: false }));
  await new Promise((resolveMicrotask) => queueMicrotask(resolveMicrotask));
  assert.equal(submits, 3, 'keyup fallback closes IME variants without compositionend');
});

test('IME의 연속 submit callback은 서버 admission 전 단일-flight로 합치고 null 시각을 epoch로 오인하지 않는다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  const submitSource = html.slice(html.indexOf('let submitAdmissionInFlight'),
    html.indexOf('function renderRecovery'));
  assert.match(submitSource, /if \(submitAdmissionInFlight\) return;/u);
  assert.ok(submitSource.indexOf('submitAdmissionInFlight = true')
    < submitSource.indexOf('await startTurn('));
  assert.ok(submitSource.indexOf("text.value = ''; text.style.height = 'auto'")
    < submitSource.lastIndexOf('submitAdmissionInFlight = false'));
  assert.match(submitSource, /catch \(error\) \{\s*submitAdmissionInFlight = false;/u);
  assert.match(html, /startedAt != null && Number\.isFinite\(Number\(startedAt\)\)/u);
  assert.match(html, /startedAt > 1_000_000_000_000/u);
  assert.doesNotMatch(html, /if \(Number\.isFinite\(Number\(startedAt\)\)\) trace\.dataset/u);
});
