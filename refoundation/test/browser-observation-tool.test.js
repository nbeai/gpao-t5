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
            e8: { role: 'button', name: '파일 선택' },
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
    async editables(options) {
      calls.push(['editables', options]);
      return {
        tab: { tabId: 't1', targetId: 'target-1', title: 'Editor', url: 'https://example.com/editor' },
        editables: [
          { editableId: 'title-field', label: '제목', kind: 'title', textChars: 0, multiline: false },
          { editableId: 'body-field', label: '본문', kind: 'body', textChars: 0, multiline: true },
        ],
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
      if (ref === 'e8') return { type: 'file', autocomplete: null, href: null, download: null };
      return { type: 'button', autocomplete: null, href: null, download: null };
    },
    async modalControlFacts() {
      return {
        modalId: 'modal-1', controlId: 'control-1', frameId: 'frame-1',
      };
    },
    async submitFacts({ ref }) {
      calls.push(['submitFacts', ref]);
      const element = ref === 'e5'
        ? { type: 'submit', autocomplete: null, href: null, download: null }
        : { type: 'button', autocomplete: null, href: null, download: null };
      return { element, secretFieldCount: 0, fileInputCount: 0 };
    },
    async pageSecretFacts() { return { secretFieldCount: 0, secretValuesObserved: false }; },
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
    async fillEditable(options) {
      calls.push(['fillEditable', options]);
      return {
        action: { kind: 'fill_editable', editableId: options.editableId, textChars: options.text.length },
        tab: { tabId: 't1', targetId: 'target-1', title: 'Editor', url: 'https://example.com/editor' },
        snapshot: {
          text: '- button "발행" [ref=e9]', refs: { e9: { role: 'button', name: '발행' } },
          totalChars: 23, truncated: false,
          editables: [
            { editableId: options.editableId, label: '제목', kind: 'title', textChars: options.text.length, multiline: false },
          ],
        },
        network: { totalRequests: 0, truncated: false, requests: [] },
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
    async download(options) {
      calls.push(['download', options]);
      return {
        action: { kind: 'download', ref: options.ref },
        tab: { tabId: 't1', targetId: 'target-1', title: 'Example', url: 'https://example.com/' },
        snapshot: { text: '- link "받기" [ref=e6]', refs: { e6: { role: 'link', name: '받기' } }, totalChars: 23, truncated: false },
        network: { totalRequests: 1, truncated: false, requests: [{ method: 'GET', address: 'https://example.com/report.pdf', resourceType: 'Document', status: 200, mimeType: 'application/pdf' }] },
        file: { path: '/private/tmp/t5/downloads/report.pdf', bytes: 120, sha256: 'c'.repeat(64), mimeType: 'application/pdf', trust: 'untrusted_external' },
        source: { address: 'https://example.com/report.pdf', queryOmitted: false },
      };
    },
    async uploadFileFacts(filePath) {
      calls.push(['uploadFileFacts', filePath]);
      return { path: filePath, bytes: 25, sha256: 'e'.repeat(64), mimeType: 'application/pdf', trust: 'user_selected_local' };
    },
    async readTextFile(filePath, options) {
      calls.push(['readTextFile', filePath, options]);
      return {
        path: filePath, bytes: 24, sha256: 'f'.repeat(64), mimeType: 'text/plain',
        text: '긴 본문 원문', textChars: 7, startLine: options.startLine,
      };
    },
    async upload(options) {
      calls.push(['upload', options]);
      return {
        action: { kind: 'upload', ref: options.ref },
        tab: { tabId: 't1', targetId: 'target-1', title: 'Upload', url: 'https://example.com/upload' },
        snapshot: { text: '- button "파일 선택" [ref=e8]: report.pdf', refs: { e8: { role: 'button', name: '파일 선택' } }, totalChars: 42, truncated: false },
        network: { totalRequests: 1, truncated: false, requests: [{ method: 'POST', address: 'https://example.com/upload', resourceType: 'Fetch', status: 200, mimeType: 'application/json' }] },
        file: { path: options.filePath, bytes: 25, sha256: 'e'.repeat(64), mimeType: 'application/pdf', trust: 'user_selected_local' },
      };
    },
  };
}

test('browser W5 schema는 download·upload를 열고 credential·cookie 기능은 없다', () => {
  const tool = makeBrowserObservationTool({ driver: fixtureDriver() });
  assert.equal(tool.name, 'browser');
  assert.deepEqual(tool.parameters.properties.action.enum, [
    'status', 'profiles', 'tabs', 'navigate', 'snapshot', 'screenshot', 'click', 'fill', 'fill_editable', 'submit',
    'login_start', 'login_status', 'login_cancel', 'download', 'upload',
  ]);
  assert.ok(tool.parameters.required.includes('filePath'));
  assert.ok(tool.parameters.required.includes('attachmentId'));
  assert.ok(Object.hasOwn(tool.parameters.properties, 'attachmentId'));
  assert.ok(tool.parameters.required.includes('editableId'));
  assert.ok(tool.parameters.required.includes('modalIntent'));
  assert.ok(tool.parameters.required.includes('textFilePath'));
  assert.ok(tool.parameters.required.includes('textFileStartLine'));
  assert.match(tool.parameters.properties.action.description, /local file.*browser text input.*not file upload/i);
  assert.match(tool.parameters.properties.text.description, /user-authorized local file.*not a file upload/i);
  const forbidden = ['type', 'press', 'evaluate', 'password', 'otp', 'cookies', 'storage'];
  assert.deepEqual(Object.keys(tool.parameters.properties).filter((key) => forbidden.includes(key)), []);
});

test('사용자가 지정한 로컬 text는 모델이 본문을 재복사하지 않고 path·hash 결속으로 입력한다', async () => {
  const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  const tool = makeBrowserObservationTool({
    driver, observationRegistry: registry,
    authorizeEffect: async () => ({ allowed: true }),
    authorizeUploadPath: async (path) => path === '/Users/test/approved.txt',
  });
  const observed = await tool.execute({
    action: 'snapshot', url: null, tabId: 't1', full: false, maxChars: 5000,
    fullPage: null, observationId: null, ref: null, editableId: null,
    modalIntent: null, text: null, textFilePath: null, textFileStartLine: null,
    filePath: null, effect: null,
  });
  const result = await tool.execute({
    action: 'fill_editable', url: null, tabId: 't1', full: null, maxChars: 5000,
    fullPage: null, observationId: observed.observation.observationId, ref: null,
    editableId: 'body-field', modalIntent: null, text: null,
    textFilePath: '/Users/test/approved.txt', textFileStartLine: 2, filePath: null,
    effect: effect('external_send'),
  });
  assert.equal(result.action.textChars, 7);
  assert.equal(result.textSource.sha256, 'f'.repeat(64));
  assert.equal(result.textSource.startLine, 2);
  assert.equal(result.textSource.text, undefined);
  assert.ok(driver.calls.some((call) => call[0] === 'fillEditable'
    && call[1].text === '긴 본문 원문'));
});

test('contenteditable 편집기는 관측된 영역 ID에만 입력하고 같은 화면에서 글자 수를 재확인한다', async () => {
  const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  const tool = makeBrowserObservationTool({
    driver, observationRegistry: registry, authorizeEffect: async () => ({ allowed: true }),
  });
  const observed = await tool.execute({
    action: 'snapshot', url: null, tabId: 't1', full: false, maxChars: 5000, fullPage: null,
    observationId: null, ref: null, editableId: null, text: null, filePath: null, effect: null,
  });
  assert.equal(observed.observation.editables.length, 2);
  assert.equal(observed.observation.editables[0].label, '제목');
  const base = {
    action: 'fill_editable', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: observed.observation.observationId, ref: null, editableId: 'title-field',
    text: '티파이브 소개', filePath: null,
  };
  const editorEffect = effect('external_send', { targets: ['https://example.com/'] });
  const stale = await tool.preflight({ ...base, editableId: 'unknown', effect: editorEffect });
  assert.equal(stale.result.state, 'editable_not_observed');
  assert.deepEqual(await tool.preflight({ ...base, effect: editorEffect }), { allowed: true });
  const withoutObservationId = await tool.preflight({ ...base, observationId: null, effect: editorEffect });
  assert.deepEqual(withoutObservationId, { allowed: true });
  const result = await tool.execute({ ...base, effect: editorEffect });
  assert.equal(result.action.kind, 'fill_editable');
  assert.equal(result.action.textChars, 7);
  assert.equal(result.after.editables[0].textChars, 7);
  assert.equal(driver.calls.some((call) => call[0] === 'fillEditable'), true);
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
  assert.equal(blockedSnapshot.nextAction, 'login_status');
  assert.equal(blockedSnapshot.reason, 'login_handoff_requires_status_check');
  assert.equal(blockedSnapshot.effect, 'not_executed');
  const blockedTabs = await tool.execute({ action: 'tabs', ...common, url: null });
  assert.equal(blockedTabs.state, 'user_control_in_progress');
  assert.equal(blockedTabs.nextAction, 'login_status');
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
  assert.deepEqual(result.inputCapabilities, {
    fillEditable: true, acceptsObservedText: true, maxChars: 20_000, fileUploadRequired: false,
  });
  assert.equal(result.observation.refs.e1.role, 'heading');
  assert.deepEqual(driver.calls, [
    ['navigate', 'https://example.com/'], ['editables', { tabId: 't1' }],
  ]);
});

test('navigate가 secret field를 보면 사용자 handoff가 아니라 login_start 경계를 반환한다', async () => {
  const driver = fixtureDriver(); driver.pageSecretFacts = async () => ({ secretFieldCount: 1, secretValuesObserved: false });
  const tool = makeBrowserObservationTool({ driver });
  const result = await tool.execute({
    action: 'navigate', url: 'https://example.com/login', tabId: null,
    full: null, maxChars: 20_000, fullPage: null,
  });
  assert.equal(result.state, 'observed'); assert.equal(result.secretFieldsPresent, true);
  assert.equal(result.secretValuesObserved, false);
  assert.deepEqual(result.loginBoundary, {
    state: 'user_login_required', nextAction: 'login_start', url: 'https://example.com/login',
  });
  assert.equal(result.handoff, undefined);
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
  assert.deepEqual(driver.calls, [
    ['snapshot', { tabId: 't1', full: false, maxChars: 5000 }],
    ['editables', { tabId: 't1' }],
  ]);
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

test('modal 행동은 명시적 intent를 요구하고 discard·replace를 destructive로 고정한다', async () => {
  const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  registry.remember({
    observationId: 'modal-observation', text: '- dialog "기존 작업"\n  - button "선택" [ref=e2]',
    refs: { e2: {
      role: 'button', name: '선택', context: {
        modal: true, modalId: 'modal-1', controlId: 'control-1', frameId: 'frame-1',
        documentRevision: 'modal-observation',
        ancestors: [{ role: 'dialog', name: '기존 작업' }],
      },
    } }, editables: [],
    refScope: {
      observationId: 'modal-observation', tabId: 't1', targetId: 'target-1', url: 'https://example.com/',
    },
  });
  const authorityContexts = [];
  const tool = makeBrowserObservationTool({
    driver, observationRegistry: registry, authorizeEffect: async (_args, context) => {
      authorityContexts.push(context); return { allowed: true };
    },
  });
  const base = {
    action: 'click', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: 'modal-observation', ref: 'e2', editableId: null,
    modalIntent: null, text: null, filePath: null,
  };
  const missing = await tool.preflight({ ...base, effect: effect('external_change') });
  assert.equal(missing.result.state, 'modal_intent_required');
  const lowered = await tool.preflight({
    ...base, modalIntent: 'discard_existing', effect: effect('external_change'),
  });
  assert.equal(lowered.result.reason, 'destructive_required');
  const clickCount = driver.calls.filter((call) => call[0] === 'click').length;
  const blockedExecution = await tool.execute({
    ...base, modalIntent: 'discard_existing', effect: effect('external_change'),
  });
  assert.equal(blockedExecution.state, 'effect_declaration_mismatch');
  assert.equal(driver.calls.filter((call) => call[0] === 'click').length, clickCount);
  assert.deepEqual(await tool.preflight({
    ...base, modalIntent: 'discard_existing', effect: effect('destructive'),
  }), { allowed: true });
  assert.equal(authorityContexts.at(-1).requiredEffect, 'destructive');
  const result = await tool.execute({
    ...base, modalIntent: 'discard_existing', effect: effect('destructive'),
  });
  assert.equal(result.modalAction.intent, 'discard_existing');
  assert.equal(result.effectTruth.actualKind, 'destructive');
  assert.equal(result.modalAction.context.modalId, 'modal-1');
  assert.equal(result.modalAction.context.controlId, 'control-1');
  assert.equal(result.modalAction.context.frameId, 'frame-1');
});

test('modal 또는 exact control identity가 관측 뒤 바뀌면 click 전에 멈춘다', async () => {
  const driver = fixtureDriver();
  driver.modalControlFacts = async () => ({
    modalId: 'modal-2', controlId: 'control-2', frameId: 'frame-1',
  });
  const registry = makeBrowserObservationRegistry();
  registry.remember({
    observationId: 'modal-observation', text: '- button "계속" [ref=e2]',
    refs: { e2: {
      role: 'button', name: '계속', context: {
        modal: true, modalId: 'modal-1', controlId: 'control-1', frameId: 'frame-1',
        documentRevision: 'modal-observation', ancestors: [{ role: 'dialog', name: '기존 작업' }],
      },
    } }, editables: [],
    refScope: {
      observationId: 'modal-observation', tabId: 't1', targetId: 'target-1', url: 'https://example.com/',
    },
  });
  const tool = makeBrowserObservationTool({
    driver, observationRegistry: registry, authorizeEffect: async () => ({ allowed: true }),
  });
  const args = {
    action: 'click', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: 'modal-observation', ref: 'e2', editableId: null,
    modalIntent: 'continue', text: null, filePath: null, effect: effect('external_change'),
  };
  const before = driver.calls.filter((call) => call[0] === 'click').length;
  const result = await tool.execute(args);
  assert.equal(result.state, 'modal_identity_changed');
  assert.equal(driver.calls.filter((call) => call[0] === 'click').length, before);
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

test('submit·download control은 일반 click으로 우회할 수 없다', async () => {
  for (const [ref, state] of [['e5', 'submit_requires_explicit_action'], ['e6', 'download_requires_explicit_action']]) {
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

test('download는 최신 ref와 local_change 선언 뒤 완성 파일·source·새 snapshot을 반환한다', async () => {
  const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  const tool = makeBrowserObservationTool({ driver, observationRegistry: registry, authorizeEffect: async () => ({ allowed: true }) });
  const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
  const base = {
    action: 'download', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: before.observation.observationId, ref: 'e6', text: null,
  };
  const rejected = await tool.preflight({ ...base, effect: effect('observe') });
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.result.state, 'effect_declaration_mismatch');
  const args = { ...base, effect: effect('local_change') };
  assert.deepEqual(await tool.preflight(args), { allowed: true });
  const result = await tool.execute(args);
  assert.equal(result.state, 'acted');
  assert.equal(result.action.kind, 'download');
  assert.equal(result.file.path, '/private/tmp/t5/downloads/report.pdf');
  assert.equal(result.file.bytes, 120);
  assert.match(result.file.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.file.trust, 'untrusted_external');
  assert.equal(result.source.address, 'https://example.com/report.pdf');
  assert.equal(result.network.requests[0].mimeType, 'application/pdf');
  assert.equal(result.after.refScope.tabId, 't1');
});

test('upload는 현재 사용자 요청의 exact path·file input·external_send 뒤 file/network/snapshot을 반환한다', async () => {
  const path = '/Users/test/Documents/report.pdf';
  const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  const tool = makeBrowserObservationTool({
    driver, observationRegistry: registry,
    authorizeUploadPath: (candidate) => candidate === path,
    authorizeEffect: async () => ({ allowed: true }),
  });
  const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
  const base = {
    action: 'upload', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: before.observation.observationId, ref: 'e8', text: null, filePath: path,
  };
  const observe = await tool.preflight({ ...base, effect: effect('observe') });
  assert.equal(observe.result.state, 'effect_declaration_mismatch');
  const args = { ...base, effect: effect('external_send') };
  assert.deepEqual(await tool.preflight(args), { allowed: true });
  const result = await tool.execute(args);
  assert.equal(result.action.kind, 'upload');
  assert.equal(result.file.path, path);
  assert.equal(result.file.sha256, 'e'.repeat(64));
  assert.equal(result.file.trust, 'user_selected_local');
  assert.equal(result.network.requests[0].method, 'POST');
  assert.match(result.after.text, /report\.pdf/);
  const call = driver.calls.find((item) => item[0] === 'upload');
  assert.equal(call[1].expectedSha256, 'e'.repeat(64));
});

test('upload는 prior browser download의 exact attachmentId를 managed path·hash로 해석한다', async () => {
  const path = '/managed/attachments/download.pdf'; const driver = fixtureDriver();
  const registry = makeBrowserObservationRegistry();
  const tool = makeBrowserObservationTool({
    driver, observationRegistry: registry,
    resolveUploadArtifact: async (attachmentId) => attachmentId === 'download-1' ? {
      attachmentId, path, bytes: 25, sha256: 'e'.repeat(64), mimeType: 'application/pdf', trust: 'untrusted_external',
    } : null,
    authorizeEffect: async () => ({ allowed: true }),
  });
  const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
  const args = {
    action: 'upload', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
    observationId: before.observation.observationId, ref: 'e8', text: null,
    filePath: null, attachmentId: 'download-1', effect: effect('external_send'),
  };
  assert.deepEqual(await tool.preflight(args), { allowed: true });
  const ambiguous = await tool.preflight({ ...args, filePath: '/also/path.pdf' });
  assert.equal(ambiguous.allowed, false); assert.equal(ambiguous.result.state, 'upload_source_ambiguous');
  const missing = await tool.preflight({ ...args, attachmentId: 'missing' });
  assert.equal(missing.allowed, false); assert.equal(missing.result.state, 'upload_artifact_not_authorized');
  const result = await tool.execute(args); const call = driver.calls.find((item) => item[0] === 'upload');
  assert.equal(call[1].filePath, path); assert.equal(call[1].expectedSha256, 'e'.repeat(64));
  assert.equal(result.artifact.attachmentId, 'download-1');
});

test('upload는 사용자 요청에 없는 경로·file이 아닌 ref·새 상대를 실행 전에 막는다', async () => {
  const path = '/Users/test/Documents/report.pdf';
  for (const fixture of [
    { ref: 'e8', authorize: false, effect: effect('external_send'), state: 'upload_path_not_user_authorized' },
    { ref: 'e2', authorize: true, effect: effect('external_send'), state: 'ref_not_file_input' },
    { ref: 'e8', authorize: true, effect: effect('external_send', { recipientNew: true }), state: 'upload_new_recipient_not_open' },
  ]) {
    const driver = fixtureDriver();
    const registry = makeBrowserObservationRegistry();
    const tool = makeBrowserObservationTool({
      driver, observationRegistry: registry,
      authorizeUploadPath: () => fixture.authorize,
      authorizeEffect: async () => ({ allowed: true }),
    });
    const before = await tool.execute({ action: 'navigate', url: 'https://example.com/', tabId: null, full: null, maxChars: 20_000, fullPage: null });
    const gate = await tool.preflight({
      action: 'upload', url: null, tabId: 't1', full: null, maxChars: 5000, fullPage: null,
      observationId: before.observation.observationId, ref: fixture.ref, text: null, filePath: path,
      effect: fixture.effect,
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.result.state, fixture.state);
    assert.equal(driver.calls.some((item) => item[0] === 'upload'), false);
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
