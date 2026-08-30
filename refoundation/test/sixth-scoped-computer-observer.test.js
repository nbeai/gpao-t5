import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { makeScopedComputerObserver } from '../src/scoped-computer-observer.js';

test('S6-F observer는 허용된 foreground app의 bounded non-secret AX 사실만 반환한다', async () => {
  const calls = [];
  const observer = makeScopedComputerObserver({ program: '/managed/t5-macos-scoped-accessibility',
    run: async (input) => { calls.push(input); return { state: 'observed', appId: 'com.example.fixture',
      window: { focused: true }, coverage: { nodes: 2, maximumNodes: 20, maximumDepth: 3, truncated: false },
      elements: [
        { role: 'AXButton', depth: 1, label: '확인', enabled: true, selected: false,
          focused: false, secret: false, valuePresent: false },
        { role: 'AXSecureTextField', depth: 1, enabled: true, selected: false,
          focused: true, secret: true, valuePresent: true },
      ] }; } });
  const result = await observer.observe({ allowedAppId: 'com.example.fixture', maxNodes: 20, maxDepth: 3 });
  assert.equal(result.state, 'observed'); assert.equal(result.elements.length, 2);
  assert.equal('text' in result.elements[1], false);
  assert.deepEqual(calls[0].args, ['--allow-app-id', 'com.example.fixture', '--max-nodes', '20', '--max-depth', '3']);
});

test('권한 부재·app mismatch·secret text·과대 tree는 성공 관측이 아니다', async () => {
  const permission = makeScopedComputerObserver({ program: '/helper',
    run: async () => ({ state: 'needs_accessibility_permission' }) });
  assert.deepEqual(await permission.observe({ allowedAppId: 'com.example.fixture' }), {
    state: 'needs_accessibility_permission',
  });
  const mismatch = makeScopedComputerObserver({ program: '/helper', run: async () => ({ state: 'observed',
    appId: 'com.other.app', coverage: { maximumNodes: 120, maximumDepth: 6 }, elements: [] }) });
  await assert.rejects(mismatch.observe({ allowedAppId: 'com.example.fixture' }), /scope mismatch/u);
  const secret = makeScopedComputerObserver({ program: '/helper', run: async () => ({ state: 'observed',
    appId: 'com.example.fixture', coverage: { maximumNodes: 120, maximumDepth: 6 },
    elements: [{ role: 'AXSecureTextField', depth: 1, secret: true, text: 'must-not-pass' }] }) });
  await assert.rejects(secret.observe({ allowedAppId: 'com.example.fixture' }), /invalid element/u);
});

test('native helper는 AX read만 사용하고 action·screenshot·permission prompt를 열지 않는다', async () => {
  const source = await readFile(new URL('../native/macos-scoped-accessibility.m', import.meta.url), 'utf8');
  assert.match(source, /AXIsProcessTrusted\(\)/u);
  assert.match(source, /AXUIElementCopyAttributeValue/u);
  assert.match(source, /kAXFocusedWindowAttribute/u);
  assert.doesNotMatch(source, /AXIsProcessTrustedWithOptions|AXUIElementPerformAction|AXUIElementSetAttributeValue/u);
  assert.doesNotMatch(source, /ScreenCaptureKit|CGWindowListCreateImage|screencapture/u);
});
