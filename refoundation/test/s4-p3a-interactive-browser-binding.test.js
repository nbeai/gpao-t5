import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-P3A actual은 managed server와 Browser 상호작용을 같은 사용자 여정으로 닫는다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-p3a-interactive-browser-binding-2026-08-29.json', import.meta.url), 'utf8'));
  for (const name of ['turnCompleted', 'createdWebsite', 'companyContent', 'consultationForm',
    'sourceUnchanged', 'localBrowserNavigation', 'formFilled', 'formSubmitted', 'successObserved',
    'devServerOwned', 'temporaryResidueZero', 'externalPublicationZero', 'runtimeErrorsZero',
    'runtimeCleanupVerified']) assert.equal(evidence.checks[name], true, name);
  assert.equal(evidence.firstDefectFamily, null);
  assert.equal(evidence.delivery.runningManagedProcesses, 1);
  assert.equal(evidence.delivery.previewReachableAtDelivery, true);
  assert.equal(evidence.delivery.processesAfterSettlement[0].state, 'stopped');
  assert.equal(evidence.delivery.processesAfterSettlement[0].terminationConfirmed, true);
  assert.equal(evidence.delivery.previewReachableAfterSettlement, false);
  assert.equal(evidence.browser.actions.some((item) => item.action === 'navigate' && item.outcome === 'succeeded'), true);
  assert.equal(evidence.browser.actions.filter((item) => item.action === 'fill' && item.outcome === 'succeeded').length, 2);
  assert.equal(evidence.browser.actions.some((item) => item.action === 'submit' && item.outcome === 'succeeded'), true);
  assert.equal(evidence.purposePassed, true);
});

test('S4-P3A는 최초 RED보다 wall·model/tool call·tokens·request bytes를 모두 줄였다', async () => {
  const [red, green] = await Promise.all([
    readFile(new URL('../evidence/s4-p0-project-building-baseline-2026-08-29.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../evidence/s4-p3a-interactive-browser-binding-2026-08-29.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  for (const metric of ['wallMs', 'modelCalls', 'toolCalls', 'providerTokens', 'requestBytes']) {
    assert.ok(green.performance[metric] < red.performance[metric], metric);
  }
});
