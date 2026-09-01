const MODES = new Set(['keep_signed_in_not_selected', 'keep_signed_in_selected']);
const STATES = new Set(['ready', 'login_required', 'unknown']);

function bounded(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function qualifyRound(value, expectedMode) {
  if (!value || value.mode !== expectedMode || !MODES.has(value.mode)) {
    throw new TypeError('Naver opposing-test round is invalid');
  }
  const profileHandle = bounded(value.profileHandle, 'profileHandle');
  const before = value.beforeRestart ?? {}; const after = value.afterRestart ?? {};
  for (const state of [before.mailWeb, before.blogWeb, after.mailWeb, after.blogWeb]) {
    if (!STATES.has(state)) throw new TypeError('Naver service state is invalid');
  }
  if (value.cleanShutdown !== true || value.runtimeRestarted !== true) {
    throw new Error('clean shutdown and runtime restart receipts are required');
  }
  if (value.cookieExported === true || value.secretObserved === true
    || value.userChromeProfileControlled === true) {
    throw new Error('Naver login qualification violated the privacy boundary');
  }
  return Object.freeze({ mode: value.mode, profileHandle,
    beforeRestart: Object.freeze({ mailWeb: before.mailWeb, blogWeb: before.blogWeb }),
    afterRestart: Object.freeze({ mailWeb: after.mailWeb, blogWeb: after.blogWeb }),
    cleanShutdown: true, runtimeRestarted: true, cookieExported: false,
    secretObserved: false, userChromeProfileControlled: false });
}

export function qualifyNaverLoginPersistence({ withoutPersistence, withPersistence } = {}) {
  const control = qualifyRound(withoutPersistence, 'keep_signed_in_not_selected');
  const candidate = qualifyRound(withPersistence, 'keep_signed_in_selected');
  if (control.profileHandle !== candidate.profileHandle) {
    throw new Error('Naver opposing test must use the same managed profile identity');
  }
  const beforeReady = [candidate.beforeRestart.mailWeb, candidate.beforeRestart.blogWeb]
    .every((state) => state === 'ready');
  const afterReady = [candidate.afterRestart.mailWeb, candidate.afterRestart.blogWeb]
    .every((state) => state === 'ready');
  return Object.freeze({ schema: 't5.naver-login-persistence-qualification.v1',
    state: beforeReady && afterReady ? 'qualified' : 'not_qualified',
    profileHandle: candidate.profileHandle,
    control, candidate,
    claim: beforeReady && afterReady
      ? 'same managed Naver identity remained usable for Mail and Blog after clean restart'
      : 'Naver login persistence is not established',
    cookieContentObserved: false, secretContentObserved: false });
}
