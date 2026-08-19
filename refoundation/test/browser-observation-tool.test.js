import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBrowserObservationTool } from '../src/browser-observation-tool.js';

function fixtureDriver() {
  const calls = [];
  return {
    calls,
    async available() { return { available: true, version: '0.34.0' }; },
    async status() { calls.push(['status']); return { state: 'ready', session: 't5-test', running: false }; },
    async profiles() { calls.push(['profiles']); return { profiles: [{ id: 'isolated', kind: 'managed_isolated', selected: true }] }; },
    async tabs() { calls.push(['tabs']); return { tabs: [{ tabId: 't1', targetId: 'target-1', title: '첫 탭', url: 'https://example.com/' }] }; },
    async navigate(url) {
      calls.push(['navigate', url]);
      return {
        tab: { tabId: 't1', targetId: 'target-1', title: 'Example', url },
        snapshot: { text: '- heading "Example" [ref=e1]', refs: { e1: { role: 'heading', name: 'Example' } }, totalChars: 28, truncated: false },
      };
    },
    async snapshot(options) {
      calls.push(['snapshot', options]);
      return {
        tab: { tabId: 't1', targetId: 'target-1', title: 'Example', url: 'https://example.com/' },
        snapshot: { text: '- link "More" [ref=e2]', refs: { e2: { role: 'link', name: 'More' } }, totalChars: 22, truncated: false },
      };
    },
    async screenshot(options) {
      calls.push(['screenshot', options]);
      return {
        tab: { tabId: 't1', targetId: 'target-1', title: 'Example', url: 'https://example.com/' },
        file: { path: '/private/tmp/t5-browser/shot.png', bytes: 1200, sha256: 'a'.repeat(64), mimeType: 'image/png' },
      };
    },
  };
}

test('browser W1 schema에는 관측 행동만 있고 클릭·입력·평가가 없다', () => {
  const tool = makeBrowserObservationTool({ driver: fixtureDriver() });
  assert.equal(tool.name, 'browser');
  assert.deepEqual(tool.parameters.properties.action.enum, [
    'status', 'profiles', 'tabs', 'navigate', 'snapshot', 'screenshot',
  ]);
  const forbidden = ['click', 'type', 'fill', 'press', 'upload', 'download', 'evaluate', 'submit'];
  assert.deepEqual(Object.keys(tool.parameters.properties).filter((key) => forbidden.includes(key)), []);
});

test('navigate는 실제 탭과 같은 snapshot의 observationId·refs를 한 Receipt로 돌려준다', async () => {
  const driver = fixtureDriver();
  const tool = makeBrowserObservationTool({ driver });
  const result = await tool.execute({
    action: 'navigate', url: 'https://example.com/', tabId: null,
    full: null, maxChars: 20_000, fullPage: null,
  });
  assert.equal(result.state, 'observed');
  assert.equal(result.effect, 'observe');
  assert.equal(result.profile.kind, 'managed_isolated');
  assert.equal(result.tab.tabId, 't1');
  assert.match(result.observation.observationId, /^[0-9a-f]{64}$/);
  assert.equal(result.observation.refScope.observationId, result.observation.observationId);
  assert.equal(result.observation.refScope.tabId, 't1');
  assert.equal(result.observation.refs.e1.role, 'heading');
  assert.deepEqual(driver.calls, [['navigate', 'https://example.com/']]);
});

test('snapshot은 관측 범위와 잘림을 숨기지 않고 ref를 해당 observation에만 묶는다', async () => {
  const driver = fixtureDriver();
  const result = await makeBrowserObservationTool({ driver }).execute({
    action: 'snapshot', url: null, tabId: 't1', full: false, maxChars: 5000, fullPage: null,
  });
  assert.equal(result.state, 'observed');
  assert.equal(result.observation.totalChars, 22);
  assert.equal(result.observation.truncated, false);
  assert.equal(result.observation.refScope.tabId, 't1');
  assert.deepEqual(driver.calls, [['snapshot', { tabId: 't1', full: false, maxChars: 5000 }]]);
});

test('screenshot은 픽셀을 봤다는 주장 대신 실제 파일 사실을 돌려준다', async () => {
  const driver = fixtureDriver();
  const result = await makeBrowserObservationTool({ driver }).execute({
    action: 'screenshot', url: null, tabId: 't1', full: null, maxChars: null, fullPage: true,
  });
  assert.equal(result.state, 'captured');
  assert.equal(result.file.bytes, 1200);
  assert.match(result.file.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(driver.calls, [['screenshot', { tabId: 't1', fullPage: true }]]);
});

test('driver가 없으면 브라우저를 실행한 척하지 않는다', async () => {
  const driver = fixtureDriver();
  driver.available = async () => ({ available: false, reason: 'binary_missing' });
  const result = await makeBrowserObservationTool({ driver }).execute({
    action: 'status', url: null, tabId: null, full: null, maxChars: null, fullPage: null,
  });
  assert.deepEqual(result, { state: 'unavailable', reason: 'binary_missing', effect: 'observe' });
  assert.deepEqual(driver.calls, []);
});

test('browser navigate는 HTTP(S) 밖 주소와 URL 내 자격정보를 실행 전에 거부한다', async () => {
  const driver = fixtureDriver();
  const tool = makeBrowserObservationTool({ driver });
  const base = { action: 'navigate', tabId: null, full: null, maxChars: null, fullPage: null };
  await assert.rejects(() => tool.execute({ ...base, url: 'file:///Users/test/secret' }), /protocol/i);
  await assert.rejects(() => tool.execute({ ...base, url: 'https://user:secret@example.com/' }), /credentials/i);
  assert.deepEqual(driver.calls, []);
});
