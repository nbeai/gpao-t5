import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBrowserObservationTool } from '../src/browser-observation-tool.js';
import { makeBrowserObservationRegistry } from '../src/browser-action-state.js';

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
        snapshot: {
          text: '- heading "Example" [ref=e1]\n- button "다음" [ref=e2]\n- textbox "검색" [ref=e4]\n- button "제출" [ref=e5]\n- link "받기" [ref=e6]',
          refs: {
            e1: { role: 'heading', name: 'Example' },
            e2: { role: 'button', name: '다음' },
            e4: { role: 'textbox', name: '검색' },
            e5: { role: 'button', name: '제출' },
            e6: { role: 'link', name: '받기' },
          },
          totalChars: 80, truncated: false,
        },
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
    async elementFacts({ ref }) {
      calls.push(['elementFacts', ref]);
      if (ref === 'e4') return { type: 'text', autocomplete: null, href: null, download: null };
      if (ref === 'e5') return { type: 'submit', autocomplete: null, href: null, download: null };
      if (ref === 'e6') return { type: null, autocomplete: null, href: 'https://example.com/file.zip', download: '' };
      return { type: 'button', autocomplete: null, href: null, download: null };
    },
    async submitFacts({ ref }) {
      calls.push(['submitFacts', ref]);
      const element = ref === 'e5'
        ? { type: 'submit', autocomplete: null, href: null, download: null }
        : { type: 'button', autocomplete: null, href: null, download: null };
      return { element, secretFieldCount: 0, fileInputCount: 0 };
    },
    async click(options) {
      calls.push(['click', options]);
      return {
        action: { kind: 'click', ref: options.ref },
        tab: { tabId: 't1', targetId: 'target-1', title: 'After', url: 'https://example.com/after' },
        snapshot: { text: '- heading "After" [ref=e5]', refs: { e5: { role: 'heading', name: 'After' } }, totalChars: 32, truncated: false },
        network: { totalRequests: 1, truncated: false, requests: [{ method: 'GET', address: 'https://example.com/after', resourceType: 'Document', status: 200 }] },
      };
    },
    async fill(options) {
      calls.push(['fill', options]);
      return {
        action: { kind: 'fill', ref: options.ref, textChars: options.text.length },
        tab: { tabId: 't1', targetId: 'target-1', title: 'Search', url: 'https://example.com/' },
        snapshot: { text: '- textbox "검색" [ref=e4]: coffee', refs: { e4: { role: 'textbox', name: '검색' } }, totalChars: 38, truncated: false },
        network: { totalRequests: 1, truncated: false, requests: [{ method: 'GET', address: 'https://example.com/suggest', queryOmitted: true, resourceType: 'Fetch', status: 200 }] },
      };
    },
    async submit(options) {
      calls.push(['submit', options]);
      return {
        action: { kind: 'submit', ref: options.ref },
        tab: { tabId: 't1', targetId: 'target-1', title: '접수 완료', url: 'https://example.com/submit' },
        snapshot: { text: '- heading "접수 완료" [ref=e7]', refs: { e7: { role: 'heading', name: '접수 완료' } }, totalChars: 34, truncated: false },
        network: { totalRequests: 1, truncated: false, requests: [{ method: 'POST', address: 'https://example.com/submit', resourceType: 'Document', status: 200, mimeType: 'text/html' }] },
      };
    },
  };
}

test('browser W4 schema는 user-controlled login handoff만 더하고 credential·cookie·upload 기능은 없다', () => {
  const tool = makeBrowserObservationTool({ driver: fixtureDriver() });
  assert.equal(tool.name, 'browser');
  assert.deepEqual(tool.parameters.properties.action.enum, [
    'status', 'profiles', 'tabs', 'navigate', 'snapshot', 'screenshot', 'click', 'fill', 'submit',
    'login_start', 'login_status', 'login_cancel',
  ]);
  const forbidden = ['type', 'press', 'upload', 'download', 'evaluate', 'password', 'otp', 'cookies', 'storage'];
  assert.deepEqual(Object.keys(tool.parameters.properties).filter((key) => forbidden.includes(key)), []);
});

test('login handoff 중에는 page content와 action을 모델에 열지 않고 완료 후보 뒤 새 observation만 연다', async () => {
  const driver = fixtureDriver();
  let active = false;
  let completed = false;
  driver.userControlActive = () => active;
  driver.beginUserLogin = async (url) => {
    active = true;
    return {
      state: 'user_control_required', pageObserved: false, secretValuesObserved: false,
      tab: { tabId: 't1', targetId: 'target-1', title: '', url },
    };
  };
  driver.loginStatus = async () => {
    if (!completed) return {
      state: 'user_action_required', pageObserved: false,
      secretFieldsPresent: true, secretValuesObserved: false,
      tab: { tabId: 't1', targetId: 'target-1', title: '', url: 'https://example.com/login' },
    };
    active = false;
    return {
      state: 'handoff_complete_candidate', secretFieldsPresent: false,
      continuityEstablished: true,
      tab: { tabId: 't1', targetId: 'target-1', title: 'Dashboard', url: 'https://example.com/dashboard' },
      snapshot: { text: '- heading "Dashboard" [ref=e1]', refs: { e1: { role: 'heading', name: 'Dashboard' } }, totalChars: 36, truncated: false },
    };
  };
  driver.cancelUserLogin = async () => {
    active = false;
    return { state: 'user_control_cancelled', pageObserved: false, secretValuesObserved: false };
  };
  const registry = makeBrowserObservationRegistry();
  const tool = makeBrowserObservationTool({ driver, observationRegistry: registry });
  const common = {
    tabId: null, full: null, maxChars: 20_000, fullPage: null,
    observationId: null, ref: null, text: null, effect: null,
  };
  const started = await tool.execute({ action: 'login_start', ...common, url: 'https://example.com/login' });
  assert.equal(started.state, 'user_control_required');
  assert.equal(started.pageObserved, false);
  const blockedSnapshot = await tool.execute({ action: 'snapshot', ...common, url: null, tabId: 't1' });
  assert.equal(blockedSnapshot.state, 'user_control_in_progress');
  assert.equal(blockedSnapshot.effect, 'not_executed');
  const blockedTabs = await tool.execute({ action: 'tabs', ...common, url: null });
  assert.equal(blockedTabs.state, 'user_control_in_progress');
  const waiting = await tool.execute({ action: 'login_status', ...common, url: null, tabId: 't1' });
  assert.equal(waiting.state, 'user_action_required');
  assert.equal(waiting.observation, undefined);
  completed = true;
  const result = await tool.execute({ action: 'login_status', ...common, url: null, tabId: 't1' });
  assert.equal(result.state, 'handoff_complete_candidate');
  assert.equal(result.continuityEstablished, true);
  assert.equal(result.observation.refScope.url, 'https://example.com/dashboard');
  assert.equal(registry.resolve({ observationId: result.observation.observationId, tabId: 't1', ref: 'e1' }).ok, true);
  await tool.execute({ action: 'login_start', ...common, url: 'https://example.com/login' });
  const cancelled = await tool.execute({ action: 'login_cancel', ...common, url: null });
  assert.equal(cancelled.state, 'user_control_cancelled');
  assert.equal(active, false);
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

const effect = (kind, overrides = {}) => ({
  kind, summary: '브라우저 행동', targets: ['https://example.com/'],
  reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
  ...overrides,
});

test('click은 최신 observation/ref와 external_change 선언을 확인한 뒤 행동 후 새 관측을 남긴다', async () => {
  const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  const authorized = [];
  const tool = makeBrowserObservationTool({
    driver, observationRegistry: registry,
    authorizeEffect: async (args) => { authorized.push(args); return { allowed: true }; },
  });
  const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
  const args = {
    action: 'click', url: null, tabId: 't1', full: null, maxChars: 20_000, fullPage: null,
    observationId: before.observation.observationId, ref: 'e2', text: null,
    effect: effect('external_change'),
  };
  assert.deepEqual(await tool.preflight(args), { allowed: true });
  const result = await tool.execute(args);
  assert.equal(result.state, 'acted');
  assert.equal(result.action.kind, 'click');
  assert.equal(result.before.observationId, before.observation.observationId);
  assert.notEqual(result.after.observationId, before.observation.observationId);
  assert.equal(result.after.refScope.tabId, 't1');
  assert.equal(result.network.requests[0].address, 'https://example.com/after');
  assert.equal(authorized.length, 1);
});

test('stale observation과 관측하지 않은 ref는 driver 행동 전에 not_executed다', async () => {
  const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  const tool = makeBrowserObservationTool({ driver, observationRegistry: registry, authorizeEffect: async () => ({ allowed: true }) });
  const first = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
  await tool.execute({ action: 'snapshot', url: null, tabId: 't1', full: false, maxChars: 5000, fullPage: null });
  const gate = await tool.preflight({
    action: 'click', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: first.observation.observationId, ref: 'e2', text: null, effect: effect('external_change'),
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.outcome, 'not_executed');
  assert.equal(gate.result.state, 'stale_observation');
  assert.equal(driver.calls.some((call) => call[0] === 'click'), false);
});

test('fill은 observe로 낮출 수 없고 일반 external_send 뒤 network와 새 snapshot을 남긴다', async () => {
  const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  const tool = makeBrowserObservationTool({ driver, observationRegistry: registry, authorizeEffect: async () => ({ allowed: true }) });
  const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
  const base = {
    action: 'fill', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: before.observation.observationId, ref: 'e4', text: 'coffee',
  };
  const rejected = await tool.preflight({ ...base, effect: effect('observe') });
  assert.equal(rejected.result.state, 'effect_declaration_mismatch');
  const args = { ...base, effect: effect('external_send') };
  assert.deepEqual(await tool.preflight(args), { allowed: true });
  const result = await tool.execute(args);
  assert.equal(result.state, 'acted');
  assert.equal(result.action.textChars, 6);
  assert.equal(result.network.requests[0].queryOmitted, true);
  assert.match(result.after.text, /coffee/);
});

test('password·OTP·결제정보 표준 필드는 text가 주어져도 실행 전에 secret_input_required다', async () => {
  const driver = fixtureDriver();
  driver.elementFacts = async () => ({ type: 'password', autocomplete: 'current-password', href: null });
  const registry = makeBrowserObservationRegistry();
  const tool = makeBrowserObservationTool({ driver, observationRegistry: registry, authorizeEffect: async () => ({ allowed: true }) });
  const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
  const gate = await tool.preflight({
    action: 'fill', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: before.observation.observationId, ref: 'e4', text: 'should-not-run',
    effect: effect('external_send'),
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.result.state, 'secret_input_required');
  assert.equal(driver.calls.some((call) => call[0] === 'fill'), false);
});

test('submit control은 일반 click으로 우회할 수 없고 download도 계속 열리지 않는다', async () => {
  for (const [ref, state] of [['e5', 'submit_requires_explicit_action'], ['e6', 'download_action_not_open']]) {
    const driver = fixtureDriver();
    const registry = makeBrowserObservationRegistry();
    const tool = makeBrowserObservationTool({ driver, observationRegistry: registry, authorizeEffect: async () => ({ allowed: true }) });
    const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
    const gate = await tool.preflight({
      action: 'click', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
      observationId: before.observation.observationId, ref, text: null,
      effect: effect('external_send'),
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.result.state, state);
    assert.equal(driver.calls.some((call) => call[0] === 'click'), false);
  }
});

test('submit은 명시적 submit control과 외부 전송 선언 뒤 POST·새 화면을 같은 Receipt에 남긴다', async () => {
  const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  const authorized = [];
  const tool = makeBrowserObservationTool({
    driver, observationRegistry: registry,
    authorizeEffect: async (args) => { authorized.push(args); return { allowed: true }; },
  });
  const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
  const base = {
    action: 'submit', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: before.observation.observationId, ref: 'e5', text: null,
  };
  const observe = await tool.preflight({ ...base, effect: effect('observe') });
  assert.equal(observe.allowed, false);
  assert.equal(observe.result.state, 'effect_declaration_mismatch');
  const args = { ...base, effect: effect('external_send') };
  assert.deepEqual(await tool.preflight(args), { allowed: true });
  const result = await tool.execute(args);
  assert.equal(result.state, 'acted');
  assert.equal(result.action.kind, 'submit');
  assert.equal(result.network.requests[0].method, 'POST');
  assert.equal(result.navigation.to, 'https://example.com/submit');
  assert.match(result.after.text, /접수 완료/);
  assert.equal(authorized.length, 1);
});

test('submit은 다른 button, 비밀 필드가 있는 페이지, file input이 있는 페이지에서 실행 전에 멈춘다', async () => {
  for (const fixture of [
    { ref: 'e2', facts: { element: { type: 'button' }, secretFieldCount: 0, fileInputCount: 0 }, state: 'ref_not_submit_control' },
    { ref: 'e5', facts: { element: { type: 'submit' }, secretFieldCount: 1, fileInputCount: 0 }, state: 'secret_input_required' },
    { ref: 'e5', facts: { element: { type: 'submit' }, secretFieldCount: 0, fileInputCount: 1 }, state: 'upload_action_not_open' },
  ]) {
    const driver = fixtureDriver();
    driver.submitFacts = async () => fixture.facts;
    const registry = makeBrowserObservationRegistry();
    const tool = makeBrowserObservationTool({ driver, observationRegistry: registry, authorizeEffect: async () => ({ allowed: true }) });
    const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
    const gate = await tool.preflight({
      action: 'submit', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
      observationId: before.observation.observationId, ref: fixture.ref, text: null,
      effect: effect('external_send'),
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.result.state, fixture.state);
    assert.equal(driver.calls.some((call) => call[0] === 'submit'), false);
  }
});
