import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');

function clipboardFunctions() {
  const start = html.indexOf('async function writeClipboardText');
  const end = html.indexOf('function appendMessageActions', start);
  assert.ok(start >= 0 && end > start, 'clipboard truth boundary must be independently testable');
  return html.slice(start, end);
}

function clipboardContext({ primary = 'success', fallback = true } = {}) {
  const toasts = []; let removed = false; let fallbackCalls = 0;
  const helper = {
    style: {}, value: '', setAttribute() {}, select() {},
    remove() { removed = true; },
  };
  const context = vm.createContext({
    navigator: { clipboard: { async writeText() {
      if (primary === 'success') return;
      throw new Error('clipboard denied');
    } } },
    document: {
      body: { appendChild() {} }, createElement() { return helper; },
      execCommand(command) { assert.equal(command, 'copy'); fallbackCalls += 1; return fallback; },
    },
    toast(message) { toasts.push(message); },
  });
  vm.runInContext(clipboardFunctions(), context);
  return { context, toasts, get removed() { return removed; }, get fallbackCalls() { return fallbackCalls; } };
}

test('clipboard API와 fallback이 모두 실패하면 복사 성공을 주장하지 않는다', async () => {
  const fixture = clipboardContext({ primary: 'denied', fallback: false });
  assert.equal(await fixture.context.copyMessageText('원문'), false);
  assert.deepEqual(fixture.toasts, ['메시지를 복사하지 못했어요. 다시 시도해 주세요.']);
  assert.equal(fixture.fallbackCalls, 1);
  assert.equal(fixture.removed, true);
});

test('실제 clipboard 또는 fallback 성공에서만 복사 완료를 표시한다', async () => {
  const primary = clipboardContext({ primary: 'success', fallback: false });
  assert.equal(await primary.context.copyMessageText('원문'), true);
  assert.deepEqual(primary.toasts, ['메시지를 복사했어요.']);
  assert.equal(primary.fallbackCalls, 0);

  const fallback = clipboardContext({ primary: 'denied', fallback: true });
  assert.equal(await fallback.context.copyMessageText('원문'), true);
  assert.deepEqual(fallback.toasts, ['메시지를 복사했어요.']);
  assert.equal(fallback.removed, true);
});

test('streaming backup download는 iframe 오류를 부모 화면에 반영하고 비밀을 지운 뒤 재시도를 연다', () => {
  const start = html.indexOf("backupAction.onclick = async () => {");
  const end = html.indexOf('backupCard.append(', start);
  const source = html.slice(start, end);
  assert.match(source, /addEventListener\('load'/u);
  assert.match(source, /contentDocument/u);
  assert.match(source, /result\.error/u);
  assert.match(source, /addEventListener\('error'/u);
  assert.match(source, /backupAction\.disabled = false/u);
  assert.match(source, /form\.submit\(\); password\.value = ''; form\.remove\(\);[\s\S]*backupPassword\.value = ''; backupConfirm\.value = ''/u);
  assert.match(source, /암호를 다시 입력해 시도해 주세요/u);
  assert.match(source, /파일이 실제로 나타나면 완료/u);
  assert.doesNotMatch(source, /다운로드가 시작돼요/u);
});
